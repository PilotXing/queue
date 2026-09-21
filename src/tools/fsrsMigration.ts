import { FSRS } from 'ts-fsrs';
import { isQuestionTag } from '../core/tag';
import { serializeQueueFsrsState } from '../fsrs/adapter';
import {
    LegacyHistoryEvent,
    LegacyReplayDiagnostic,
    parseLegacyTimestamp,
    replayLegacyHistory
} from '../fsrs/legacyReplay';
import { extractFrontmatterAndBody, parseFrontmatterYaml } from '../short-answer/schema';

export interface ParsedLegacyPracticeHistory {
    events: LegacyHistoryEvent[];
    malformedRows: string[];
}

export interface FsrsMigrationPreview {
    eligible: boolean;
    changed: boolean;
    reason?: 'not-question' | 'short-answer' | 'missing-frontmatter' | 'no-history' | 'already-initialized';
    eventCount: number;
    diagnostics: LegacyReplayDiagnostic[];
    malformedRows: string[];
    after: string;
}

const HISTORY_HEADING = /^# Practice History[\t ]*$/;
const HISTORY_HEADER = /^\|[\t ]*Date[\t ]*\|[\t ]*Selected[\t ]*\|[\t ]*Correct\?[\t ]*\|[\t ]*$/i;
const HISTORY_SEPARATOR = /^\|[\t ]*:?-+:?[\t ]*\|[\t ]*:?-+:?[\t ]*\|[\t ]*:?-+:?[\t ]*\|[\t ]*$/;
const HISTORY_ROW = /^\|[\t ]*(.*?)[\t ]*\|[\t ]*(.*?)[\t ]*\|[\t ]*(✅|❌)[\t ]*\|[\t ]*$/;

export function parseLegacyPracticeHistory(content: string): ParsedLegacyPracticeHistory {
    const lines = content.split(/\r?\n/);
    const headingIndex = lines.findIndex(line => HISTORY_HEADING.test(line));
    if (headingIndex < 0) return { events: [], malformedRows: [] };

    let headerIndex = headingIndex + 1;
    while (headerIndex < lines.length && !lines[headerIndex].trim()) headerIndex++;
    if (!HISTORY_HEADER.test(lines[headerIndex] || '')) return { events: [], malformedRows: [] };

    let separatorIndex = headerIndex + 1;
    while (separatorIndex < lines.length && !lines[separatorIndex].trim()) separatorIndex++;
    if (!HISTORY_SEPARATOR.test(lines[separatorIndex] || '')) return { events: [], malformedRows: [] };

    const parsedRows: Array<{ timestamp: string; selected: string; isCorrect: boolean; parsedDate: Date }> = [];
    const malformedRows: string[] = [];
    for (const line of lines.slice(separatorIndex + 1)) {
        if (!line.trim()) continue;
        if (!line.trimStart().startsWith('|')) break;
        const match = HISTORY_ROW.exec(line);
        if (!match) {
            malformedRows.push(line);
            continue;
        }
        const timestamp = match[1].trim();
        const parsedDate = parseLegacyTimestamp(timestamp);
        if (!parsedDate) {
            malformedRows.push(line);
            continue;
        }
        parsedRows.push({
            timestamp,
            selected: match[2].trim(),
            isCorrect: match[3] === '✅',
            parsedDate
        });
    }

    const events = parsedRows.map((row, index): LegacyHistoryEvent => {
        const previous = parsedRows[index - 1];
        const gap = previous ? row.parsedDate.getTime() - previous.parsedDate.getTime() : undefined;
        return {
            timestamp: row.timestamp,
            selected: row.selected,
            isCorrect: row.isCorrect,
            estimatedDurationMs: gap && gap > 0 && gap <= 300000 ? gap : undefined
        };
    });
    return { events, malformedRows };
}

function injectInlineFrontmatterValue(content: string, key: string, value: unknown): string {
    const newline = content.includes('\r\n') ? '\r\n' : '\n';
    const match = /^---[\t ]*\r?\n([\s\S]*?)\r?\n---[\t ]*(\r?\n|$)/.exec(content);
    if (!match) return content;
    const insertionPoint = match.index + match[0].length - match[2].length - 3;
    const prefix = content.slice(0, insertionPoint).replace(/[\r\n]+$/, '');
    const suffix = content.slice(insertionPoint);
    return `${prefix}${newline}${key}: ${JSON.stringify(value)}${newline}${suffix}`;
}

export function previewFsrsMigration(
    content: string,
    fsrs: FSRS,
    now: Date = new Date()
): FsrsMigrationPreview {
    const { rawYaml } = extractFrontmatterAndBody(content);
    if (!rawYaml) {
        return { eligible: false, changed: false, reason: 'missing-frontmatter', eventCount: 0, diagnostics: [], malformedRows: [], after: content };
    }
    const frontmatter = parseFrontmatterYaml(rawYaml);
    if (frontmatter.type === 'short-answer') {
        return { eligible: false, changed: false, reason: 'short-answer', eventCount: 0, diagnostics: [], malformedRows: [], after: content };
    }
    if (!isQuestionTag(frontmatter.tags)) {
        return { eligible: false, changed: false, reason: 'not-question', eventCount: 0, diagnostics: [], malformedRows: [], after: content };
    }
    if (frontmatter.queue_fsrs && typeof frontmatter.queue_fsrs === 'object') {
        return { eligible: true, changed: false, reason: 'already-initialized', eventCount: 0, diagnostics: [], malformedRows: [], after: content };
    }

    const parsed = parseLegacyPracticeHistory(content);
    if (parsed.events.length === 0) {
        return {
            eligible: true,
            changed: false,
            reason: 'no-history',
            eventCount: 0,
            diagnostics: [],
            malformedRows: parsed.malformedRows,
            after: content
        };
    }

    const replay = replayLegacyHistory(parsed.events, fsrs, now);
    const serialized = serializeQueueFsrsState(replay.finalState);
    const after = injectInlineFrontmatterValue(content, 'queue_fsrs', serialized);
    return {
        eligible: true,
        changed: after !== content,
        eventCount: replay.replayedCount,
        diagnostics: replay.diagnostics,
        malformedRows: parsed.malformedRows,
        after
    };
}
