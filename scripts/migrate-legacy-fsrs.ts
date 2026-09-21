import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createFsrsInstance } from '../src/fsrs/adapter';
import { createDefaultQueueFsrsSettings } from '../src/fsrs/settings';
import { previewFsrsMigration } from '../src/tools/fsrsMigration';

interface Arguments {
    root?: string;
    backupDirectory?: string;
    expectedCount?: number;
    apply: boolean;
    summaryOnly: boolean;
    allowDiagnostics: boolean;
}

interface Candidate {
    absolutePath: string;
    relativePath: string;
    before: string;
    after: string;
    eventCount: number;
}

function parseArguments(argv: string[]): Arguments {
    const args: Arguments = { apply: false, summaryOnly: false, allowDiagnostics: false };
    for (let index = 0; index < argv.length; index++) {
        const value = argv[index];
        if (value === '--root') args.root = argv[++index];
        else if (value === '--backup-dir') args.backupDirectory = argv[++index];
        else if (value === '--expected-count') args.expectedCount = Number(argv[++index]);
        else if (value === '--summary-only') args.summaryOnly = true;
        else if (value === '--allow-diagnostics') args.allowDiagnostics = true;
        else if (value === '--apply') args.apply = true;
        else if (value === '--help' || value === '-h') return args;
        else throw new Error(`Unknown argument: ${value}`);
    }
    return args;
}

function usage(): string {
    return [
        'Dry run:',
        '  npm run fsrs:migrate -- --root /path/to/vault',
        '',
        'Apply (requires the exact dry-run count and a new backup directory outside the vault):',
        '  npm run fsrs:migrate -- --root /path/to/vault --apply --expected-count 123 --backup-dir /path/to/new/backup',
        '',
        'Apply refuses malformed/out-of-order history unless --allow-diagnostics is explicitly supplied.'
    ].join('\n');
}

async function collectMarkdownFiles(root: string): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
        const absolutePath = path.join(root, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
            if (entry.name === '.git' || entry.name === '.obsidian') continue;
            files.push(...await collectMarkdownFiles(absolutePath));
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
            files.push(absolutePath);
        }
    }
    return files;
}

function isInside(parent: string, child: string): boolean {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function main() {
    const args = parseArguments(process.argv.slice(2));
    if (!args.root) {
        console.log(usage());
        process.exitCode = process.argv.includes('--help') || process.argv.includes('-h') ? 0 : 2;
        return;
    }
    if (args.apply && (!args.backupDirectory || args.expectedCount === undefined)) {
        throw new Error('--apply requires --backup-dir and --expected-count from a fresh dry run.');
    }

    const root = path.resolve(args.root);
    const rootStat = await fs.stat(root);
    if (!rootStat.isDirectory()) throw new Error(`Not a directory: ${root}`);

    const fsrs = createFsrsInstance(createDefaultQueueFsrsSettings());
    const now = new Date();
    const candidates: Candidate[] = [];
    let eligible = 0;
    let alreadyInitialized = 0;
    let withoutHistory = 0;
    let malformedRows = 0;
    let replayDiagnostics = 0;
    const issues: string[] = [];

    for (const absolutePath of await collectMarkdownFiles(root)) {
        const before = await fs.readFile(absolutePath, 'utf8');
        const preview = previewFsrsMigration(before, fsrs, now);
        if (!preview.eligible) continue;
        eligible++;
        if (preview.reason === 'already-initialized') alreadyInitialized++;
        if (preview.reason === 'no-history') withoutHistory++;
        malformedRows += preview.malformedRows.length;
        replayDiagnostics += preview.diagnostics.length;
        const relativePath = path.relative(root, absolutePath);
        for (const row of preview.malformedRows) {
            issues.push(`${relativePath}: malformed history row: ${row.slice(0, 240)}`);
        }
        for (const diagnostic of preview.diagnostics) {
            issues.push(`${relativePath}: ${diagnostic.type}: ${diagnostic.message}`);
        }
        if (preview.changed) {
            candidates.push({
                absolutePath,
                relativePath,
                before,
                after: preview.after,
                eventCount: preview.eventCount
            });
        }
    }
    candidates.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    console.log(`${args.apply ? 'Apply' : 'Dry run'}: ${candidates.length} file(s) would receive replayed FSRS state.`);
    console.log(`Eligible MCQ notes: ${eligible}; already initialized: ${alreadyInitialized}; no history: ${withoutHistory}.`);
    console.log(`Malformed rows: ${malformedRows}; replay diagnostics: ${replayDiagnostics}.`);
    for (const issue of issues) console.log(`[warning] ${issue}`);
    if (!args.summaryOnly) {
        for (const candidate of candidates) {
            console.log(`${candidate.relativePath} (${candidate.eventCount} review event(s))`);
        }
    }

    if (args.expectedCount !== undefined && candidates.length !== args.expectedCount) {
        throw new Error(`Expected ${args.expectedCount} migration candidates, found ${candidates.length}.`);
    }
    if (!args.apply) return;
    if (issues.length > 0 && !args.allowDiagnostics) {
        throw new Error(`Refusing to apply with ${issues.length} history diagnostic(s); fix them or explicitly pass --allow-diagnostics.`);
    }

    const backupDirectory = path.resolve(args.backupDirectory!);
    if (isInside(root, backupDirectory)) {
        throw new Error('Backup directory must be outside the vault/root being migrated.');
    }
    try {
        await fs.stat(backupDirectory);
        throw new Error(`Backup directory already exists: ${backupDirectory}`);
    } catch (error: any) {
        if (error?.code !== 'ENOENT') throw error;
    }
    await fs.mkdir(backupDirectory, { recursive: true });

    for (const candidate of candidates) {
        const current = await fs.readFile(candidate.absolutePath, 'utf8');
        if (current !== candidate.before) {
            throw new Error(`File changed after scan; refusing to overwrite: ${candidate.relativePath}`);
        }
        const backupPath = path.join(backupDirectory, candidate.relativePath);
        await fs.mkdir(path.dirname(backupPath), { recursive: true });
        await fs.copyFile(candidate.absolutePath, backupPath);

        const stat = await fs.stat(candidate.absolutePath);
        const temporaryPath = `${candidate.absolutePath}.queue-fsrs-${process.pid}.tmp`;
        try {
            await fs.writeFile(temporaryPath, candidate.after, { encoding: 'utf8', mode: stat.mode });
            await fs.rename(temporaryPath, candidate.absolutePath);
        } finally {
            await fs.rm(temporaryPath, { force: true });
        }
    }
    console.log(`Migrated ${candidates.length} file(s). Backup: ${backupDirectory}`);
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
