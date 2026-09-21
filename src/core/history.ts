/**
 * Pure helper module for practice history row formatting, appending, and table repair.
 */

export function formatHistoryRow(timestamp: string, selected: string, isCorrect: boolean): string {
    const status = isCorrect ? "✅" : "❌";
    return `| ${timestamp} | ${selected} | ${status} |`;
}

/**
 * Appends a history row to question content.
 * Strips trailing blank lines at the end of the Practice History table before appending.
 */
export function appendHistoryRow(
    content: string,
    timestamp: string,
    selected: string,
    isCorrect: boolean
): string {
    const row = formatHistoryRow(timestamp, selected, isCorrect);
    const hasHeader = content.includes('# Practice History');

    if (!hasHeader) {
        // Strip trailing whitespace/newlines from content first
        const trimmed = content.trimEnd();
        const separator = trimmed.length > 0 ? '\n\n' : '';
        return `${trimmed}${separator}# Practice History\n| Date | Selected | Correct? |\n|---|---|---|\n${row}`;
    }

    // Header exists. Remove any trailing blank lines/spaces at the end of content
    const trimmed = content.replace(/[\r\n\s]+$/, '');
    return `${trimmed}\n${row}`;
}

/**
 * Repairs a Practice History table in Markdown content.
 * Specifically removes blank lines occurring between the table separator line
 * (|---|---|---| or similar) and its following data rows.
 * Works with both LF and CRLF line endings, and is idempotent.
 */
export function repairHistoryTableContent(content: string): { repairedContent: string; changed: boolean } {
    const sectionMatch = /^# Practice History[\t ]*\r?$/m.exec(content);
    if (!sectionMatch) {
        return { repairedContent: content, changed: false };
    }

    const sectionStart = sectionMatch.index;
    const beforeSection = content.slice(0, sectionStart);
    const section = content.slice(sectionStart);
    const brokenHistoryHeader = /(^# Practice History[\t ]*\r?\n[\t ]*\|[\t ]*Date[\t ]*\|[\t ]*Selected[\t ]*\|[\t ]*Correct\?[\t ]*\|[\t ]*\r?\n[\t ]*\|[\t ]*:?-+:?[\t ]*\|[\t ]*:?-+:?[\t ]*\|[\t ]*:?-+:?[\t ]*\|[\t ]*\r?\n)(?:[\t ]*\r?\n)+(?=[\t ]*\|)/m;
    const repairedSection = section.replace(brokenHistoryHeader, '$1');
    const repaired = beforeSection + repairedSection;
    const changed = repaired !== content;

    return { repairedContent: repaired, changed };
}

/**
 * Runs a dry-run repair on a list of file path/content pairs.
 * Returns an array of files that would be modified, along with their before/after contents.
 * Does NOT modify any files on disk.
 */
export function dryRunRepair(files: Array<{ path: string; content: string }>): Array<{
    path: string;
    before: string;
    after: string;
}> {
    const results: Array<{ path: string; before: string; after: string }> = [];

    for (const file of files) {
        const { repairedContent, changed } = repairHistoryTableContent(file.content);
        if (changed) {
            results.push({
                path: file.path,
                before: file.content,
                after: repairedContent
            });
        }
    }

    return results;
}
