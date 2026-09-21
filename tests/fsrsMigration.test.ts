import { describe, expect, it } from 'vitest';
import { createDefaultQueueFsrsSettings } from '../src/fsrs/settings';
import { createFsrsInstance } from '../src/fsrs/adapter';
import { parseLegacyPracticeHistory, previewFsrsMigration } from '../src/tools/fsrsMigration';

const question = `---
tags: ["q"]
category: Test
familiarity: 50
---
# Question
Example

# Practice History
| Date | Selected | Correct? |
|---|---|---|

| 2026-09-20 10:00:00 | A | ✅ |
| 2026-09-20 10:01:00 | S | ❌ |
`;

describe('legacy MCQ FSRS migration preview', () => {
    const fsrs = createFsrsInstance(createDefaultQueueFsrsSettings());

    it('parses broken-table rows and estimates only plausible adjacent gaps', () => {
        const parsed = parseLegacyPracticeHistory(question);
        expect(parsed.events).toHaveLength(2);
        expect(parsed.events[1]).toMatchObject({ selected: 'S', isCorrect: false, estimatedDurationMs: 60000 });
    });

    it('injects one inline queue_fsrs value without changing history or familiarity', () => {
        const preview = previewFsrsMigration(question, fsrs, new Date('2026-09-21T00:00:00Z'));
        expect(preview.changed).toBe(true);
        expect(preview.eventCount).toBe(2);
        expect(preview.after).toContain('queue_fsrs: {');
        expect(preview.after).toContain('familiarity: 50');
        expect(preview.after).toContain('| 2026-09-20 10:01:00 | S | ❌ |');

        const second = previewFsrsMigration(preview.after, fsrs, new Date('2026-09-21T00:00:00Z'));
        expect(second.changed).toBe(false);
        expect(second.reason).toBe('already-initialized');
    });

    it('skips non-question and short-answer notes', () => {
        const nonQuestion = previewFsrsMigration(question.replace('["q"]', '["quiz"]'), fsrs);
        expect(nonQuestion.reason).toBe('not-question');
        const shortAnswer = previewFsrsMigration(question.replace('category: Test', 'type: short-answer\ncategory: Test'), fsrs);
        expect(shortAnswer.reason).toBe('short-answer');
    });
});
