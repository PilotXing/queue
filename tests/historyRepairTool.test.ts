import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyHistoryRepairs, collectHistoryRepairs } from '../src/tools/historyRepair';

const temporaryRoots: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    temporaryRoots.push(directory);
    return directory;
}

afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

describe('history repair filesystem workflow', () => {
    it('dry-runs narrowly, applies with an external backup, and is idempotent', async () => {
        const root = await temporaryDirectory('queue-history-root-');
        const backupParent = await temporaryDirectory('queue-history-backups-');
        const backup = path.join(backupParent, 'snapshot');
        const brokenPath = path.join(root, 'broken.md');
        const unrelatedPath = path.join(root, 'unrelated.md');
        const broken = '# Practice History\n| Date | Selected | Correct? |\n|---|---|---|\n\n| 2026-09-21 | A | ✅ |\n';
        const unrelated = '# Notes\n| A | B |\n|---|---|\n\n| 1 | 2 |\n';
        await fs.writeFile(brokenPath, broken);
        await fs.writeFile(unrelatedPath, unrelated);

        const candidates = await collectHistoryRepairs(root);
        expect(candidates.map(candidate => candidate.relativePath)).toEqual(['broken.md']);
        expect(await fs.readFile(brokenPath, 'utf8')).toBe(broken);

        await applyHistoryRepairs(root, backup, candidates);
        expect(await fs.readFile(path.join(backup, 'broken.md'), 'utf8')).toBe(broken);
        expect(await fs.readFile(brokenPath, 'utf8')).not.toContain('|---|---|---|\n\n|');
        expect(await fs.readFile(unrelatedPath, 'utf8')).toBe(unrelated);
        expect(await collectHistoryRepairs(root)).toEqual([]);
    });

    it('refuses to place a backup inside the repaired root', async () => {
        const root = await temporaryDirectory('queue-history-root-');
        await expect(applyHistoryRepairs(root, path.join(root, 'backup'), []))
            .rejects.toThrow('outside the vault');
    });

    it('refuses to overwrite a file that changed after the dry run', async () => {
        const root = await temporaryDirectory('queue-history-root-');
        const backupParent = await temporaryDirectory('queue-history-backups-');
        const brokenPath = path.join(root, 'broken.md');
        await fs.writeFile(brokenPath, '# Practice History\n| Date | Selected | Correct? |\n|---|---|---|\n\n| old | A | ✅ |');
        const candidates = await collectHistoryRepairs(root);
        await fs.writeFile(brokenPath, `${candidates[0].before}\nnew content`);

        await expect(applyHistoryRepairs(root, path.join(backupParent, 'snapshot'), candidates))
            .rejects.toThrow('changed after the dry run');
        expect(await fs.readFile(brokenPath, 'utf8')).toContain('new content');
    });
});
