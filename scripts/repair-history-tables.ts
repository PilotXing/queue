import path from 'node:path';
import { applyHistoryRepairs, collectHistoryRepairs } from '../src/tools/historyRepair';

interface Arguments {
    root?: string;
    apply: boolean;
    backupDirectory?: string;
    expectedCount?: number;
    summaryOnly: boolean;
}

function parseArguments(argv: string[]): Arguments {
    const parsed: Arguments = { apply: false, summaryOnly: false };
    for (let index = 0; index < argv.length; index++) {
        const value = argv[index];
        if (value === '--root') parsed.root = argv[++index];
        else if (value === '--apply') parsed.apply = true;
        else if (value === '--backup-dir') parsed.backupDirectory = argv[++index];
        else if (value === '--expected-count') parsed.expectedCount = Number(argv[++index]);
        else if (value === '--summary-only') parsed.summaryOnly = true;
        else if (value === '--help' || value === '-h') return parsed;
        else throw new Error(`Unknown argument: ${value}`);
    }
    return parsed;
}

function usage(): string {
    return [
        'Usage:',
        '  npm run history:repair -- --root /path/to/vault',
        '  npm run history:repair -- --root /path/to/vault --apply --expected-count 292 --backup-dir /path/outside/vault/backup',
        '',
        'The default mode is read-only and only reports files that would change.',
        'Apply mode refuses to run without a new backup directory outside the target root.'
    ].join('\n');
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
    const candidates = await collectHistoryRepairs(root);
    console.log(`${args.apply ? 'Apply' : 'Dry run'}: ${candidates.length} file(s) match the exact broken Practice History pattern.`);
    if (!args.summaryOnly) {
        for (const candidate of candidates) console.log(candidate.relativePath);
    }

    if (args.expectedCount !== undefined && candidates.length !== args.expectedCount) {
        throw new Error(`Expected ${args.expectedCount} repair candidates, found ${candidates.length}.`);
    }

    if (!args.apply) return;
    await applyHistoryRepairs(root, args.backupDirectory!, candidates);
    console.log(`Repaired ${candidates.length} file(s). Backup: ${path.resolve(args.backupDirectory!)}`);
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
