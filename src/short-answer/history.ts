/**
 * Pure parsing, appending, and rebuilding helpers for short-answer queue-history JSONL blocks.
 *
 * Requirements:
 * - Block is anchored at the end:
 *   ```queue-history
 *   {"reviewId":"...", ...}
 *   ```
 * - One JSON object per line.
 * - Multiline answers are cleanly escaped inside JSON string values.
 * - Atomic duplicate-safe append by reviewId.
 * - Preserves LF and CRLF style.
 * - Unknown fields survive read and rewrite.
 * - Malformed JSON is detected and diagnostics are reported without crashing.
 * - Rebuilding helper can derive the latest cached FSRS snapshot from valid history events.
 */

import { SerializedQueueFsrsStateV1 } from '../fsrs/adapter';
import {
    ShortAnswerDiagnostic,
    ShortAnswerHistoryEvent,
    FsrsRating
} from './types';

export const QUEUE_HISTORY_BLOCK_TAG = 'queue-history';

/**
 * Result of parsing a queue-history block from document content.
 */
export interface ParseHistoryBlockResult {
    events: ShortAnswerHistoryEvent[];
    diagnostics: ShortAnswerDiagnostic[];
    rawBlockText?: string;
    contentWithoutBlock: string;
    newline: '\n' | '\r\n';
}

const EVENT_TYPES = new Set(['ai-grade', 'manual-grade', 'show-answer', 'override']);

function isRating(value: unknown): value is FsrsRating {
    return value === 1 || value === 2 || value === 3 || value === 4;
}

function validateHistoryEvent(
    parsed: Record<string, unknown>,
    lineNumber: number
): { event?: ShortAnswerHistoryEvent; diagnostics: ShortAnswerDiagnostic[] } {
    const diagnostics: ShortAnswerDiagnostic[] = [];
    const error = (code: string, message: string) => diagnostics.push({
        code,
        message: `Line ${lineNumber}: ${message}`,
        severity: 'error',
        context: parsed
    });

    if (parsed.schemaVersion !== 1) error('UNSUPPORTED_HISTORY_SCHEMA', 'schemaVersion must be 1');
    if (typeof parsed.reviewId !== 'string' || !parsed.reviewId.trim()) error('MISSING_REVIEW_ID', 'reviewId must be a non-empty string');
    if (typeof parsed.timestamp !== 'string' || !Number.isFinite(new Date(parsed.timestamp).getTime())) error('INVALID_HISTORY_TIMESTAMP', 'timestamp must be valid ISO text');
    for (const field of ['wallDurationMs', 'activeDurationMs'] as const) {
        if (typeof parsed[field] !== 'number' || !Number.isFinite(parsed[field]) || parsed[field] < 0) {
            error('INVALID_HISTORY_DURATION', `${field} must be a finite non-negative number`);
        }
    }
    if (parsed.timingValid !== undefined && typeof parsed.timingValid !== 'boolean') error('INVALID_TIMING_VALIDITY', 'timingValid must be boolean when present');
    if (parsed.timingOutlier !== undefined && typeof parsed.timingOutlier !== 'boolean') error('INVALID_TIMING_OUTLIER', 'timingOutlier must be boolean when present');
    if (parsed.timingIneligibleReason !== undefined && typeof parsed.timingIneligibleReason !== 'string') error('INVALID_TIMING_REASON', 'timingIneligibleReason must be a string when present');
    if (typeof parsed.submittedAnswer !== 'string') error('INVALID_SUBMITTED_ANSWER', 'submittedAnswer must be a string');
    if (typeof parsed.eventType !== 'string' || !EVENT_TYPES.has(parsed.eventType)) error('INVALID_EVENT_TYPE', 'eventType is unsupported');
    if (typeof parsed.correctness !== 'boolean') error('INVALID_HISTORY_CORRECTNESS', 'correctness must be boolean');
    if (typeof parsed.score !== 'number' || !Number.isFinite(parsed.score) || parsed.score < 0 || parsed.score > 1) error('INVALID_HISTORY_SCORE', 'score must be between 0 and 1');
    if (!isRating(parsed.proposedRating) || !isRating(parsed.finalRating)) error('INVALID_HISTORY_RATING', 'proposedRating and finalRating must be FSRS ratings 1-4');
    if (typeof parsed.isOverride !== 'boolean') error('INVALID_OVERRIDE_FLAG', 'isOverride must be boolean');
    const transition = parsed.transition as Record<string, unknown> | undefined;
    if (!transition || typeof transition !== 'object' || !isRating(transition.rating) || !transition.nextState || typeof transition.nextState !== 'object') {
        error('INVALID_FSRS_TRANSITION', 'transition must include a valid rating and nextState');
    }

    return diagnostics.length > 0
        ? { diagnostics }
        : { event: parsed as unknown as ShortAnswerHistoryEvent, diagnostics };
}

/**
 * Detects whether content predominantly uses CRLF or LF.
 */
export function detectNewline(content: string): '\n' | '\r\n' {
    return content.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * Extracts and parses the queue-history fenced block from the end of the markdown content.
 */
export function parseHistoryBlock(content: string): ParseHistoryBlockResult {
    const newline = detectNewline(content);
    const diagnostics: ShortAnswerDiagnostic[] = [];
    const events: ShortAnswerHistoryEvent[] = [];

    // Match fenced block anchored at the end (allowing optional trailing whitespace/newlines)
    // Supports ```queue-history ... ```
    const regex = /(?:\r?\n|^)```queue-history[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*(?:\r?\n)*$/;
    const match = regex.exec(content);

    if (!match) {
        return {
            events: [],
            diagnostics: [],
            contentWithoutBlock: content,
            newline
        };
    }

    const rawBlockInner = match[1];
    const matchIndex = match.index;
    const contentWithoutBlock = content.slice(0, matchIndex);

    // Split inner lines
    const lines = rawBlockInner.split(/\r?\n/);
    const seenReviewIds = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue; // Skip empty lines inside fence

        try {
            const parsed = JSON.parse(line);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                diagnostics.push({
                    code: 'INVALID_JSON_OBJECT',
                    message: `Line ${i + 1} in queue-history block is not a valid JSON object`,
                    severity: 'error',
                    context: line
                });
                continue;
            }

            const validation = validateHistoryEvent(parsed as Record<string, unknown>, i + 1);
            diagnostics.push(...validation.diagnostics);
            if (!validation.event) continue;
            const event = validation.event;

            if (seenReviewIds.has(event.reviewId)) {
                diagnostics.push({
                    code: 'DUPLICATE_REVIEW_ID',
                    message: `Duplicate reviewId "${event.reviewId}" at line ${i + 1}`,
                    severity: 'warning',
                    context: event.reviewId
                });
                // Duplicate events are ignored to maintain idempotency
                continue;
            }

            seenReviewIds.add(event.reviewId);
            events.push(event);
        } catch (err: unknown) {
            diagnostics.push({
                code: 'MALFORMED_JSON_LINE',
                message: `Failed to parse JSON on line ${i + 1}: ${err instanceof Error ? err.message : String(err)}`,
                severity: 'error',
                context: line
            });
        }
    }

    return {
        events,
        diagnostics,
        rawBlockText: match[0],
        contentWithoutBlock,
        newline
    };
}

/**
 * Serializes an array of history events into a fenced queue-history block string.
 * Preserves all unknown fields in each event.
 */
export function renderHistoryBlock(
    events: ShortAnswerHistoryEvent[],
    newline: '\n' | '\r\n' = '\n'
): string {
    if (events.length === 0) {
        return '';
    }

    const lines = events.map(e => JSON.stringify(e));
    return `\`\`\`${QUEUE_HISTORY_BLOCK_TAG}${newline}${lines.join(newline)}${newline}\`\`\``;
}

/**
 * Appends a history event atomically at the string level.
 * If an event with the same reviewId already exists in the content, the content is returned untouched.
 * Preserves the file's newline style (LF or CRLF).
 */
export function appendHistoryEvent(
    markdownContent: string,
    event: ShortAnswerHistoryEvent
): { content: string; appended: boolean; diagnostics: ShortAnswerDiagnostic[] } {
    const parseResult = parseHistoryBlock(markdownContent);
    const newline = parseResult.newline;

    // Check duplicate
    const exists = parseResult.events.some(e => e.reviewId === event.reviewId);
    if (exists) {
        return {
            content: markdownContent,
            appended: false,
            diagnostics: [
                {
                    code: 'DUPLICATE_REVIEW_ID',
                    message: `ReviewId "${event.reviewId}" already exists in history; skipped duplicate append`,
                    severity: 'warning'
                }
            ]
        };
    }

    const eventValidation = validateHistoryEvent(event as unknown as Record<string, unknown>, 1);
    if (!eventValidation.event) {
        return { content: markdownContent, appended: false, diagnostics: eventValidation.diagnostics };
    }

    let joined: string;
    if (parseResult.rawBlockText) {
        const closingFence = /\r?\n```[ \t]*(?:\r?\n)*$/.exec(parseResult.rawBlockText);
        if (!closingFence) {
            return {
                content: markdownContent,
                appended: false,
                diagnostics: [...parseResult.diagnostics, {
                    code: 'INVALID_HISTORY_BLOCK',
                    message: 'Could not find the closing queue-history fence.',
                    severity: 'error'
                }]
            };
        }
        const raw = parseResult.rawBlockText;
        const updatedRaw = `${raw.slice(0, closingFence.index)}${newline}${JSON.stringify(event)}${raw.slice(closingFence.index)}`;
        joined = `${markdownContent.slice(0, markdownContent.length - raw.length)}${updatedRaw}`;
    } else {
        const newBlock = renderHistoryBlock([event], newline);
        const baseContent = markdownContent.trimEnd();
        joined = baseContent.length > 0
            ? `${baseContent}${newline}${newline}${newBlock}${newline}`
            : `${newBlock}${newline}`;
    }

    return {
        content: joined,
        appended: true,
        diagnostics: parseResult.diagnostics
    };
}

/**
 * Derives the latest FSRS state snapshot from a sequence of history events.
 * Returns null if no valid transitions are present.
 */
export function deriveLatestFsrsFromHistory(
    events: ShortAnswerHistoryEvent[]
): SerializedQueueFsrsStateV1 | null {
    if (!events || events.length === 0) return null;

    // Find the latest event with a valid transition.nextState
    for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        if (ev.transition && ev.transition.nextState) {
            return ev.transition.nextState;
        }
    }

    return null;
}
