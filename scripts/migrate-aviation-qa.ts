import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseAviationQA, renderMigratedCard } from '../src/short-answer/migration';

interface Arguments {
    source?: string;
    output?: string;
    backupDirectory?: string;
    expectedCount?: number;
    write: boolean;
    allowWarnings: boolean;
}

function parseArguments(argv: string[]): Arguments {
    const args: Arguments = { write: false, allowWarnings: false };
    for (let index = 0; index < argv.length; index++) {
        const value = argv[index];
        if (value === '--source') args.source = argv[++index];
        else if (value === '--output') args.output = argv[++index];
        else if (value === '--backup-dir') args.backupDirectory = argv[++index];
        else if (value === '--expected-count') args.expectedCount = Number(argv[++index]);
        else if (value === '--write') args.write = true;
        else if (value === '--allow-warnings') args.allowWarnings = true;
        else if (value === '--help' || value === '-h') return args;
        else throw new Error(`Unknown argument: ${value}`);
    }
    return args;
}

function usage() {
    return [
        'Dry run:',
        '  npm run aviation:migration -- --source /path/to/Aviation_QA.md --expected-count 255',
        '',
        'Write (requires a new output directory and a new backup directory):',
        '  npm run aviation:migration -- --source /path/to/Aviation_QA.md --expected-count 255 --write --output /path/to/new/cards --backup-dir /path/to/backup --allow-warnings',
        '',
        'Write mode refuses warnings unless --allow-warnings is explicitly supplied after review.'
    ].join('\n');
}

function isInside(parent: string, child: string): boolean {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function main() {
    const args = parseArguments(process.argv.slice(2));
    if (!args.source) {
        console.log(usage());
        process.exitCode = process.argv.includes('--help') || process.argv.includes('-h') ? 0 : 2;
        return;
    }

    const sourcePath = path.resolve(args.source);
    const sourceText = await fs.readFile(sourcePath, 'utf8');
    const outputFolder = args.output ? path.resolve(args.output) : 'Queue_Cards/Aviation';
    const report = parseAviationQA(sourceText, 'Aviation', outputFolder);
    const errorCount = report.diagnostics.filter(item => item.severity === 'error').length;
    const warningCount = report.diagnostics.filter(item => item.severity === 'warning').length;

    console.log(`Cards found: ${report.totalCardsFound}`);
    console.log(`Valid cards: ${report.validCards.length}`);
    console.log(`Diagnostics: ${errorCount} error(s), ${warningCount} warning(s)`);
    for (const diagnostic of report.diagnostics) {
        console.log(`[${diagnostic.severity}] ${diagnostic.code}: ${diagnostic.message}`);
        if (diagnostic.context !== undefined) {
            console.log(`  context: ${JSON.stringify(diagnostic.context).slice(0, 500)}`);
        }
    }

    if (args.expectedCount !== undefined && report.validCards.length !== args.expectedCount) {
        throw new Error(`Expected ${args.expectedCount} valid cards, found ${report.validCards.length}.`);
    }
    if (!args.write) return;
    if (!args.output || !args.backupDirectory || args.expectedCount === undefined) {
        throw new Error('--write requires --output, --backup-dir, and --expected-count.');
    }
    if (errorCount > 0) throw new Error('Refusing to write while migration diagnostics contain errors.');
    if (warningCount > 0 && !args.allowWarnings) {
        throw new Error(`Refusing to write with ${warningCount} warning(s); review them and explicitly pass --allow-warnings.`);
    }

    const outputDirectory = path.resolve(args.output);
    const backupDirectory = path.resolve(args.backupDirectory);
    if (isInside(outputDirectory, backupDirectory) || isInside(backupDirectory, outputDirectory)) {
        throw new Error('Output and backup directories must be separate and must not contain one another.');
    }
    for (const target of [outputDirectory, backupDirectory]) {
        try {
            await fs.stat(target);
            throw new Error(`Target already exists; refusing to overwrite: ${target}`);
        } catch (error: any) {
            if (error?.code !== 'ENOENT') throw error;
        }
    }

    await fs.mkdir(backupDirectory, { recursive: true });
    await fs.copyFile(sourcePath, path.join(backupDirectory, path.basename(sourcePath)));
    await fs.mkdir(outputDirectory, { recursive: true });
    for (const card of report.validCards) {
        const target = path.join(outputDirectory, card.proposedFilename);
        await fs.writeFile(target, renderMigratedCard(card), { encoding: 'utf8', flag: 'wx' });
    }
    console.log(`Wrote ${report.validCards.length} new cards to ${outputDirectory}`);
    console.log(`Source backup: ${backupDirectory}`);
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
