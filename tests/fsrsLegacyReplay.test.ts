import { describe, it, expect } from 'vitest';
import { Rating } from 'ts-fsrs';
import { replayLegacyHistory, parseLegacyTimestamp, LegacyHistoryEvent } from '../src/fsrs/legacyReplay';
import { createFsrsInstance } from '../src/fsrs/adapter';
import { createDefaultQueueFsrsSettings } from '../src/fsrs/settings';

describe('parseLegacyTimestamp', () => {
    it('parses various standard date formats', () => {
        const d1 = parseLegacyTimestamp('2026-09-20 14:30:00');
        expect(d1).not.toBeNull();
        expect(d1?.getFullYear()).toBe(2026);

        const d2 = parseLegacyTimestamp('2026-09-20T14:30:00.000Z');
        expect(d2).not.toBeNull();

        const invalid = parseLegacyTimestamp('not-a-date');
        expect(invalid).toBeNull();
    });
});

describe('replayLegacyHistory', () => {
    const settings = createDefaultQueueFsrsSettings();
    const fsrs = createFsrsInstance(settings, { enable_fuzz: false });
    const fixedNow = new Date('2026-09-21T12:00:00.000Z');

    it('replays chronological events mapping correct to Good and incorrect/Show Answer to Again', () => {
        const events: LegacyHistoryEvent[] = [
            { timestamp: '2026-09-18 10:00:00', isCorrect: true, selected: 'A' },
            { timestamp: '2026-09-19 10:00:00', isCorrect: false, selected: 'B' },
            { timestamp: '2026-09-20 10:00:00', isCorrect: false, selected: 'S' } // Show answer
        ];

        const result = replayLegacyHistory(events, fsrs, fixedNow);

        expect(result.replayedCount).toBe(3);
        expect(result.diagnostics.length).toBe(0);
        expect(result.transitions[0].grade).toBe(Rating.Good);
        expect(result.transitions[1].grade).toBe(Rating.Again);
        expect(result.transitions[2].grade).toBe(Rating.Again);
        expect(result.finalState.card.reps).toBe(3);
    });

    it('ignores estimated durations when determining rating transitions', () => {
        // Even with extremely fast estimated duration (100ms)
        const events: LegacyHistoryEvent[] = [
            { timestamp: '2026-09-18 10:00:00', isCorrect: true, selected: 'A', estimatedDurationMs: 100 }
        ];

        const result = replayLegacyHistory(events, fsrs, fixedNow);
        expect(result.replayedCount).toBe(1);
        expect(result.transitions[0].grade).toBe(Rating.Good); // Must stay Good, NOT inferred as Easy
    });

    it('collects diagnostics for malformed, out-of-order, future, and implausible duration data without failing', () => {
        const events: LegacyHistoryEvent[] = [
            // Out of order: 2026-09-19 before 2026-09-18
            { timestamp: '2026-09-19 10:00:00', isCorrect: true, selected: 'A' },
            { timestamp: '2026-09-18 10:00:00', isCorrect: true, selected: 'B' },
            // Malformed
            { timestamp: 'invalid-date', isCorrect: true, selected: 'C' },
            // Future date relative to fixedNow (2026-09-21)
            { timestamp: '2026-12-01 10:00:00', isCorrect: true, selected: 'D' },
            // Implausible duration: negative or > 5 min
            { timestamp: '2026-09-20 10:00:00', isCorrect: true, selected: 'E', estimatedDurationMs: 9999999 }
        ];

        const result = replayLegacyHistory(events, fsrs, fixedNow);

        // Valid events should be sorted and replayed
        expect(result.replayedCount).toBe(3); // future date is diagnosed but not applied
        expect(result.diagnostics.length).toBeGreaterThanOrEqual(4);

        const diagTypes = result.diagnostics.map(d => d.type);
        expect(diagTypes).toContain('out_of_order');
        expect(diagTypes).toContain('malformed_timestamp');
        expect(diagTypes).toContain('future_timestamp');
        expect(diagTypes).toContain('implausible_duration');
    });
});
