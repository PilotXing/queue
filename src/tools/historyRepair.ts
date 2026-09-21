import { promises as fs } from 'node:fs';
import path from 'node:path';
import { repairHistoryTableContent } from '../core/history';

export interface HistoryRepairCandidate {
    absolutePath: string;
    relativePath: string;
    before: string;
    after: string;
}

async function collectMarkdownFiles(root: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
        const absolutePath = path.join(root, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
            if (entry.name === '.git') continue;
            files.push(...await collectMarkdownFiles(absolutePath));
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
            files.push(absolutePath);
        }
    }
    return files;
}

export async function collectHistoryRepairs(root: string): Promise<HistoryRepairCandidate[]> {
    const absoluteRoot = path.resolve(root);
    const stat = await fs.stat(absoluteRoot);
    if (!stat.isDirectory()) throw new Error(`Not a directory: ${absoluteRoot}`);

    const candidates: HistoryRepairCandidate[] = [];
    for (const absolutePath of await collectMarkdownFiles(absoluteRoot)) {
        const before = await fs.readFile(absolutePath, 'utf8');
        const { repairedContent: after, changed } = repairHistoryTableContent(before);
        if (changed) {
            candidates.push({
                absolutePath,
                relativePath: path.relative(absoluteRoot, absolutePath),
                before,
                after
            });
        }
    }
    return candidates.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function isInside(parent: string, child: string): boolean {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export async function applyHistoryRepairs(
    root: string,
    backupDirectory: string,
    candidates: HistoryRepairCandidate[]
): Promise<void> {
    const absoluteRoot = path.resolve(root);
    const absoluteBackup = path.resolve(backupDirectory);
    if (isInside(absoluteRoot, absoluteBackup)) {
        throw new Error('Backup directory must be outside the vault/root being repaired.');
    }

    try {
        await fs.stat(absoluteBackup);
        throw new Error(`Backup directory already exists: ${absoluteBackup}`);
    } catch (error: any) {
        if (error?.code !== 'ENOENT') throw error;
    }

    await fs.mkdir(absoluteBackup, { recursive: true });
    for (const candidate of candidates) {
        const current = await fs.readFile(candidate.absolutePath, 'utf8');
        if (current !== candidate.before) {
            throw new Error(`File changed after the dry run; refusing to overwrite: ${candidate.relativePath}`);
        }

        const backupPath = path.join(absoluteBackup, candidate.relativePath);
        await fs.mkdir(path.dirname(backupPath), { recursive: true });
        await fs.copyFile(candidate.absolutePath, backupPath);

        const stat = await fs.stat(candidate.absolutePath);
        const temporaryPath = `${candidate.absolutePath}.queue-repair-${process.pid}.tmp`;
        try {
            await fs.writeFile(temporaryPath, candidate.after, { encoding: 'utf8', mode: stat.mode });
            await fs.rename(temporaryPath, candidate.absolutePath);
        } finally {
            await fs.rm(temporaryPath, { force: true });
        }
    }
}
