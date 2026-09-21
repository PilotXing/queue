import { describe, it, expect } from 'vitest';
import {
    formatHistoryRow,
    appendHistoryRow,
    repairHistoryTableContent,
    dryRunRepair
} from '../src/core/history';

describe('formatHistoryRow', () => {
    it('formats correct answer row with green checkmark', () => {
        expect(formatHistoryRow('2026-09-21 10:00:00', 'A', true))
            .toBe('| 2026-09-21 10:00:00 | A | ✅ |');
    });

    it('formats wrong or show answer row with red cross', () => {
        expect(formatHistoryRow('2026-09-21 10:00:00', 'S', false))
            .toBe('| 2026-09-21 10:00:00 | S | ❌ |');
    });
});

describe('appendHistoryRow', () => {
    it('creates header if Practice History section does not exist', () => {
        const content = '# Question\nWhat is 1+1?';
        const updated = appendHistoryRow(content, '2026-09-21 10:00:00', 'B', true);
        expect(updated).toContain('# Practice History\n| Date | Selected | Correct? |\n|---|---|---|\n| 2026-09-21 10:00:00 | B | ✅ |');
    });

    it('strips trailing blank lines before appending to existing table', () => {
        const content = '# Question\n\n# Practice History\n| Date | Selected | Correct? |\n|---|---|---|\n| 2026-09-21 09:00:00 | A | ✅ |\n\n\n';
        const updated = appendHistoryRow(content, '2026-09-21 10:00:00', 'S', false);
        expect(updated).toBe('# Question\n\n# Practice History\n| Date | Selected | Correct? |\n|---|---|---|\n| 2026-09-21 09:00:00 | A | ✅ |\n| 2026-09-21 10:00:00 | S | ❌ |');
    });
});

describe('repairHistoryTableContent', () => {
    it('removes blank line between table separator and first data row', () => {
        const brokenContent = `# Question Stem

# Practice History
| Date | Selected | Correct? |
|---|---|---|

| 2026-09-21 09:00:00 | A | ✅ |
| 2026-09-21 10:00:00 | S | ❌ |
`;

        const { repairedContent, changed } = repairHistoryTableContent(brokenContent);
        expect(changed).toBe(true);
        expect(repairedContent).toContain('|---|---|---|\n| 2026-09-21 09:00:00 | A | ✅ |');
        expect(repairedContent).not.toContain('|---|---|---|\n\n|');
    });

    it('is idempotent on already valid tables', () => {
        const validContent = `# Question Stem

# Practice History
| Date | Selected | Correct? |
|---|---|---|
| 2026-09-21 09:00:00 | A | ✅ |
`;

        const { repairedContent, changed } = repairHistoryTableContent(validContent);
        expect(changed).toBe(false);
        expect(repairedContent).toBe(validContent);
    });

    it('works with CRLF line endings', () => {
        const crlfBroken = "# Practice History\r\n| Date | Selected | Correct? |\r\n|---|---|---|\r\n\r\n| 2026-09-21 09:00:00 | A | ✅ |\r\n";
        const { repairedContent, changed } = repairHistoryTableContent(crlfBroken);
        expect(changed).toBe(true);
        expect(repairedContent).toContain("|---|---|---|\r\n| 2026-09-21 09:00:00 | A | ✅ |");
    });

    it('does not repair unrelated tables elsewhere in a question file', () => {
        const content = `# Notes
| Col A | Col B |
|---|---|

| Keep | This break |

# Practice History
| Date | Selected | Correct? |
|---|---|---|

| 2026-09-21 09:00:00 | A | ✅ |
`;
        const { repairedContent, changed } = repairHistoryTableContent(content);
        expect(changed).toBe(true);
        expect(repairedContent).toContain('|---|---|\n\n| Keep | This break |');
        expect(repairedContent).toContain('|---|---|---|\n| 2026-09-21 09:00:00 | A | ✅ |');
    });
});

describe('dryRunRepair', () => {
    it('returns only files that need repair without modifying disk', () => {
        const files = [
            { path: 'file1.md', content: '# Practice History\n| Date | Selected | Correct? |\n|---|---|---|\n\n| 2026-09-21 | A | ✅ |' },
            { path: 'file2.md', content: '# Practice History\n| Date | Selected | Correct? |\n|---|---|---|\n| 2026-09-21 | A | ✅ |' }
        ];

        const report = dryRunRepair(files);
        expect(report.length).toBe(1);
        expect(report[0].path).toBe('file1.md');
        expect(report[0].after).not.toContain('\n\n|');
    });
});
