import { describe, it, expect } from 'vitest';
import {
    parseShortAnswerCard,
    renderShortAnswerCard,
    parseFrontmatterYaml,
    formatYaml,
    updateShortAnswerReviewDocument
} from '../src/short-answer/schema';
import { ShortAnswerCard, ShortAnswerHistoryEvent } from '../src/short-answer/types';
import { createNewQueueFsrsState, serializeQueueFsrsState } from '../src/fsrs/adapter';

describe('Short-Answer Schema Module', () => {
    const baseFsrs = serializeQueueFsrsState(createNewQueueFsrsState(new Date('2026-09-21T00:00:00Z')));

    it('parses and formats YAML frontmatter faithfully', () => {
        const yaml = `queue_schema: 1
queue_id: "aviation_91.16.17"
type: short-answer
category: "CCAR-91 航空法规"
tags:
  - q
  - aviation
fsrs:
  schemaVersion: 1
  modelVersion: "v5.4.2 using FSRS-6.0"
  mastered: false
  reps: 0
`;
        const parsed = parseFrontmatterYaml(yaml);
        expect(parsed.queue_schema).toBe(1);
        expect(parsed.queue_id).toBe('aviation_91.16.17');
        expect(parsed.type).toBe('short-answer');
        expect(parsed.category).toBe('CCAR-91 航空法规');
        expect(parsed.tags).toEqual(['q', 'aviation']);
        expect((parsed.fsrs as any).schemaVersion).toBe(1);
        expect((parsed.fsrs as any).reps).toBe(0);

        const formatted = formatYaml(parsed);
        expect(formatted).toContain('queue_schema: 1');
        expect(formatted).toContain('queue_id: aviation_91.16.17');
        expect(formatted).toContain('category: CCAR-91 航空法规');
    });

    it('parses complete valid short-answer markdown file with all sections', () => {
        const markdown = `---
queue_schema: 1
queue_id: "aviation_91.16.17"
type: short-answer
category: "法规"
tags:
  - q
  - test
source: "CCAR-91.16"
fsrs:
  schemaVersion: 1
  modelVersion: "v5.4.2 using FSRS-6.0"
  mastered: false
  due: "2026-09-21T00:00:00.000Z"
  stability: 2
  difficulty: 5
  elapsed_days: 0
  scheduled_days: 0
  reps: 0
  lapses: 0
  state: 0
  learning_steps: 0
  last_review: null
---

# Question
What are the minimum fuel requirements for VFR flight during day?

# Reference Answer
Enough fuel to fly to the first point of intended landing and, assuming normal cruising speed:
1. Day VFR: at least 30 minutes extra.
2. Night VFR: at least 45 minutes extra.

# Source
CCAR-91.151 Fuel requirements for flight in VFR conditions.

# Human Grading Notes
Must mention 30 minutes for day, 45 minutes for night.

# Generated Rubric
Required: 30 minutes day, 45 minutes night.
`;

        const parseResult = parseShortAnswerCard(markdown);
        expect(parseResult.isValid).toBe(true);
        expect(parseResult.diagnostics.length).toBe(0);

        const card = parseResult.card!;
        expect(card.frontmatter.queue_id).toBe('aviation_91.16.17');
        expect(card.frontmatter.type).toBe('short-answer');
        expect(card.question).toContain('What are the minimum fuel requirements');
        expect(card.referenceAnswer).toContain('Day VFR: at least 30 minutes extra');
        expect(card.source).toContain('CCAR-91.151');
        expect(card.humanGradingNotes).toContain('Must mention 30 minutes');
        expect(card.generatedRubric).toContain('Required: 30 minutes day');
    });

    it('roundtrips card rendering and parsing deterministically', () => {
        const card: ShortAnswerCard = {
            frontmatter: {
                queue_schema: 1,
                queue_id: 'q_roundtrip_001',
                type: 'short-answer',
                category: 'Turbine Engines 涡轮发动机',
                tags: ['q', 'propulsion'],
                source: 'Doc 8168',
                fsrs: baseFsrs
            },
            question: 'Explain hot start vs hung start.\n\n- Hot start: EGT exceeds limits.\n- Hung start: RPM stagnates.',
            referenceAnswer: 'A hot start occurs when exhaust gas temperature exceeds maximum starting limit. A hung start occurs when engine fails to accelerate to idle speed.',
            source: 'Doc 8168 Vol 1',
            humanGradingNotes: 'Accept abbreviations EGT and RPM.',
            historyEvents: []
        };

        const rendered = renderShortAnswerCard(card);
        const parsedResult = parseShortAnswerCard(rendered);

        expect(parsedResult.isValid).toBe(true);
        const parsedCard = parsedResult.card!;
        expect(parsedCard.frontmatter.queue_id).toBe(card.frontmatter.queue_id);
        expect(parsedCard.question).toBe(card.question);
        expect(parsedCard.referenceAnswer).toBe(card.referenceAnswer);
        expect(parsedCard.source).toBe(card.source);
        expect(parsedCard.humanGradingNotes).toBe(card.humanGradingNotes);
    });

    it('roundtrips escaped strings, rubric arrays, and Markdown subheadings', () => {
        const card: ShortAnswerCard = {
            frontmatter: {
                queue_schema: 1,
                queue_id: 'q_escaped',
                type: 'short-answer',
                category: 'Pilot: "A"',
                tags: ['q'],
                source: 'O\'Brien: section "2"',
                fsrs: baseFsrs,
                rubric: {
                    version: 1,
                    referenceHash: 'abc',
                    requiredPoints: ['Point: one', 'Point "two"'],
                    optionalPoints: ['可选项']
                }
            },
            question: 'Explain the rule.',
            referenceAnswer: 'Main answer\n\n# Supporting heading\nMore detail.',
            source: 'O\'Brien: section "2"',
            historyEvents: []
        };

        const parsed = parseShortAnswerCard(renderShortAnswerCard(card));
        expect(parsed.isValid).toBe(true);
        expect(parsed.card?.frontmatter.category).toBe(card.frontmatter.category);
        expect(parsed.card?.source).toBe(card.source);
        expect(parsed.card?.frontmatter.rubric?.requiredPoints).toEqual(card.frontmatter.rubric?.requiredPoints);
        expect(parsed.card?.referenceAnswer).toContain('# Supporting heading');
    });

    it('fails explicitly for unsupported schema version', () => {
        const futureDoc = `---
queue_schema: 2
queue_id: "q_future"
type: short-answer
category: "General"
tags:
  - q
fsrs:
  schemaVersion: 1
---

# Question
What is supersonic speed?
`;

        const parsed = parseShortAnswerCard(futureDoc);
        expect(parsed.isValid).toBe(false);
        expect(parsed.diagnostics.some(d => d.code === 'UNSUPPORTED_SCHEMA_VERSION')).toBe(true);
    });

    it('preserves code fences, markdown tables, quotes, and pipes inside question and answer', () => {
        const complexBody = `# Question
Consider the following Python snippet:

\`\`\`python
def calculate_v2(vs: float) -> float:
    return vs * 1.2 # Regulation factor
\`\`\`

What is the factor for V2? | Table Header |
|---|---|
| Item | Value |

> "Quotes must remain intact"

# Reference Answer
The factor is \`1.2 * Vs\`.
`;

        const fullDoc = `---
queue_schema: 1
queue_id: "q_complex_body"
type: short-answer
category: "Performance"
tags:
  - q
fsrs:
  schemaVersion: 1
  modelVersion: "v5.4.2 using FSRS-6.0"
  mastered: false
  due: "2026-09-21T00:00:00.000Z"
  stability: 1
  difficulty: 5
  elapsed_days: 0
  scheduled_days: 0
  reps: 0
  lapses: 0
  state: 0
  learning_steps: 0
  last_review: null
---

${complexBody}
`;

        const parsed = parseShortAnswerCard(fullDoc);
        expect(parsed.isValid).toBe(true);
        expect(parsed.card?.question).toContain('```python');
        expect(parsed.card?.question).toContain('def calculate_v2');
        expect(parsed.card?.question).toContain('| Table Header |');
        expect(parsed.card?.question).toContain('> "Quotes must remain intact"');
        expect(parsed.card?.referenceAnswer).toBe('The factor is `1.2 * Vs`.');
    });

    it('allows missing reference answer for manual self-assessment but flags error for missing question', () => {
        const noRefAnswerDoc = `---
queue_schema: 1
queue_id: "q_no_ref"
type: short-answer
category: "Manual"
tags:
  - q
fsrs:
  schemaVersion: 1
  modelVersion: "v5.4.2 using FSRS-6.0"
  mastered: false
  due: "2026-09-21T00:00:00.000Z"
  stability: 1
  difficulty: 5
  elapsed_days: 0
  scheduled_days: 0
  reps: 0
  lapses: 0
  state: 0
  learning_steps: 0
  last_review: null
---

# Question
What are your thoughts on airmanship?
`;

        const parsed = parseShortAnswerCard(noRefAnswerDoc);
        expect(parsed.isValid).toBe(true);
        expect(parsed.card?.referenceAnswer).toBeUndefined();

        const noQuestionDoc = `---
queue_schema: 1
queue_id: "q_no_q"
type: short-answer
category: "Manual"
tags:
  - q
---

# Reference Answer
Some answer without question.
`;
        const badParsed = parseShortAnswerCard(noQuestionDoc);
        expect(badParsed.isValid).toBe(false);
        expect(badParsed.diagnostics.some(d => d.code === 'MISSING_QUESTION_SECTION')).toBe(true);
    });

    it('atomically updates cached state and append-only history while preserving body text', () => {
        const card: ShortAnswerCard = {
            frontmatter: {
                queue_schema: 1,
                queue_id: 'atomic-review',
                type: 'short-answer',
                category: 'Test',
                tags: ['q'],
                fsrs: baseFsrs
            },
            question: 'Question with  中文 and | pipes.',
            referenceAnswer: 'Reference\n\n- exact list',
            historyEvents: []
        };
        const original = renderShortAnswerCard(card);
        const nextFsrs = { ...baseFsrs, reps: 1, stability: 2, last_review: '2026-09-21T04:00:00.000Z' };
        const event: ShortAnswerHistoryEvent = {
            schemaVersion: 1,
            reviewId: 'review-atomic-1',
            timestamp: '2026-09-21T04:00:00.000Z',
            wallDurationMs: 2000,
            activeDurationMs: 1800,
            submittedAnswer: 'My answer\nwith two lines',
            eventType: 'manual-grade',
            correctness: true,
            score: 0.85,
            proposedRating: 3,
            finalRating: 3,
            isOverride: false,
            transition: { rating: 3, previousState: baseFsrs, nextState: nextFsrs }
        };

        const updated = updateShortAnswerReviewDocument(original, nextFsrs, 99.5, event);
        expect(updated.appended).toBe(true);
        expect(updated.content).toContain('familiarity: 99.5');
        expect(updated.content).toContain('Question with  中文 and | pipes.');
        expect(updated.content).toContain('- exact list');
        const parsed = parseShortAnswerCard(updated.content);
        expect(parsed.card?.frontmatter.fsrs.reps).toBe(1);
        expect(parsed.card?.historyEvents).toHaveLength(1);

        const duplicate = updateShortAnswerReviewDocument(updated.content, nextFsrs, 99.5, event);
        expect(duplicate.appended).toBe(false);
        expect(duplicate.content).toBe(updated.content);
    });
});
