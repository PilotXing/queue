import { describe, it, expect } from 'vitest';
import {
    parseHistoryBlock,
    renderHistoryBlock,
    appendHistoryEvent,
    deriveLatestFsrsFromHistory
} from '../src/short-answer/history';
import { ShortAnswerHistoryEvent } from '../src/short-answer/types';
import { createNewQueueFsrsState, serializeQueueFsrsState } from '../src/fsrs/adapter';

describe('Short-Answer History Block Module', () => {
    const baseFsrs = serializeQueueFsrsState(createNewQueueFsrsState(new Date('2026-09-21T00:00:00Z')));
    const nextFsrs = {
        ...baseFsrs,
        reps: 1,
        stability: 2.5
    };

    const sampleEvent1: ShortAnswerHistoryEvent = {
        schemaVersion: 1,
        reviewId: 'rev-001',
        timestamp: '2026-09-21T01:00:00.000Z',
        wallDurationMs: 4500,
        activeDurationMs: 4200,
        submittedAnswer: 'Dual ignition provides redundancy and improved combustion efficiency.',
        eventType: 'ai-grade',
        correctness: true,
        score: 1.0,
        aiFeedback: 'Accurate and covers both required points.',
        confidence: 0.95,
        proposedRating: 3,
        finalRating: 3,
        isOverride: false,
        provider: 'mock-llm',
        model: 'model-x',
        transition: {
            rating: 3,
            previousState: baseFsrs,
            nextState: nextFsrs
        },
        futureCustomField: { nested: 'preserved' }
    };

    const sampleEvent2: ShortAnswerHistoryEvent = {
        schemaVersion: 1,
        reviewId: 'rev-002',
        timestamp: '2026-09-21T02:00:00.000Z',
        wallDurationMs: 2500,
        activeDurationMs: 2000,
        submittedAnswer: 'It gives more spark.',
        eventType: 'override',
        correctness: false,
        score: 0.4,
        proposedRating: 1,
        finalRating: 1,
        isOverride: true,
        transition: {
            rating: 1,
            previousState: nextFsrs,
            nextState: { ...nextFsrs, reps: 2, lapses: 1 }
        }
    };

    it('parses valid queue-history JSONL block at the end of Markdown', () => {
        const markdown = `# Question
Why do aircraft engines use dual ignition?

# Reference Answer
Redundancy and efficiency.

\`\`\`queue-history
${JSON.stringify(sampleEvent1)}
${JSON.stringify(sampleEvent2)}
\`\`\`
`;

        const parsed = parseHistoryBlock(markdown);
        expect(parsed.events.length).toBe(2);
        expect(parsed.events[0].reviewId).toBe('rev-001');
        expect(parsed.events[1].reviewId).toBe('rev-002');
        expect(parsed.events[0].futureCustomField).toEqual({ nested: 'preserved' });
        expect(parsed.diagnostics.length).toBe(0);
        expect(parsed.contentWithoutBlock.trim()).toContain('# Reference Answer');
    });

    it('handles multiline answers, code fences, emoji, and pipes within JSON lines', () => {
        const multilineEvent: ShortAnswerHistoryEvent = {
            schemaVersion: 1,
            reviewId: 'rev-complex',
            timestamp: '2026-09-21T03:00:00.000Z',
            wallDurationMs: 6000,
            activeDurationMs: 5500,
            submittedAnswer: 'Line 1: ✈️ Aircraft check\nLine 2: | pipe | symbols |\n```python\nprint("code inside answer")\n```\n"Quoted text"',
            eventType: 'ai-grade',
            correctness: true,
            score: 0.95,
            aiFeedback: 'Great answer with formatting: 👍',
            proposedRating: 3,
            finalRating: 3,
            isOverride: false,
            transition: {
                rating: 3,
                previousState: baseFsrs,
                nextState: nextFsrs
            }
        };

        const rendered = renderHistoryBlock([multilineEvent]);
        expect(rendered.startsWith('```queue-history\n')).toBe(true);
        expect(rendered.endsWith('\n```')).toBe(true);

        const reparsed = parseHistoryBlock(rendered);
        expect(reparsed.events.length).toBe(1);
        expect(reparsed.events[0].submittedAnswer).toBe(multilineEvent.submittedAnswer);
        expect(reparsed.events[0].aiFeedback).toBe(multilineEvent.aiFeedback);
    });

    it('preserves CRLF vs LF line endings', () => {
        const crlfContent = '# Question\r\nWhat is V1?\r\n\r\n# Reference Answer\r\nTakeoff decision speed.\r\n\r\n```queue-history\r\n'
            + JSON.stringify(sampleEvent1) + '\r\n```\r\n';

        const parsed = parseHistoryBlock(crlfContent);
        expect(parsed.newline).toBe('\r\n');

        const appendResult = appendHistoryEvent(crlfContent, sampleEvent2);
        expect(appendResult.appended).toBe(true);
        expect(appendResult.content).toContain('\r\n');
        expect(appendResult.content.includes('\r\n```queue-history\r\n')).toBe(true);
    });

    it('is duplicate-safe by reviewId', () => {
        const initialDoc = `# Question\nTest\n\n\`\`\`queue-history\n${JSON.stringify(sampleEvent1)}\n\`\`\``;
        
        // Attempt to append sampleEvent1 again
        const appendResult = appendHistoryEvent(initialDoc, sampleEvent1);
        expect(appendResult.appended).toBe(false);
        expect(appendResult.content).toBe(initialDoc);
        expect(appendResult.diagnostics.length).toBe(1);
        expect(appendResult.diagnostics[0].code).toBe('DUPLICATE_REVIEW_ID');
    });

    it('reports diagnostics on malformed JSON without losing valid lines', () => {
        const raw = `# Question\nTest\n\n\`\`\`queue-history\n${JSON.stringify(sampleEvent1)}\n{ malformed json line\n${JSON.stringify(sampleEvent2)}\n\`\`\``;

        const parsed = parseHistoryBlock(raw);
        expect(parsed.events.length).toBe(2);
        expect(parsed.diagnostics.length).toBe(1);
        expect(parsed.diagnostics[0].code).toBe('MALFORMED_JSON_LINE');

        const appended = appendHistoryEvent(raw, {
            ...sampleEvent2,
            reviewId: 'rev-after-malformed'
        });
        expect(appended.appended).toBe(true);
        expect(appended.content).toContain('{ malformed json line');
        expect(appended.content).toContain('rev-after-malformed');
    });

    it('rejects invalid new events without changing the document', () => {
        const markdown = '# Question\nTest\n';
        const invalid = { ...sampleEvent1, score: 5 };
        const result = appendHistoryEvent(markdown, invalid);
        expect(result.appended).toBe(false);
        expect(result.content).toBe(markdown);
        expect(result.diagnostics.some(d => d.code === 'INVALID_HISTORY_SCORE')).toBe(true);
    });

    it('derives the latest cached FSRS snapshot from history', () => {
        const latest = deriveLatestFsrsFromHistory([sampleEvent1, sampleEvent2]);
        expect(latest).not.toBeNull();
        expect(latest?.reps).toBe(2);
        expect(latest?.lapses).toBe(1);

        expect(deriveLatestFsrsFromHistory([])).toBeNull();
    });
});
