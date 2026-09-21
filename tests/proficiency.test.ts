import { describe, it, expect } from 'vitest';
import { calculateNewFamiliarity, parseFailOffsets, reinsertFailedQuestion } from '../src/core/proficiency';

describe('calculateNewFamiliarity', () => {
    it('increases familiarity on correct answer', () => {
        // f = 50 -> 100 - ((50 / 3) * 2) = 66.666...
        expect(calculateNewFamiliarity(50, true)).toBeCloseTo(66.666, 2);
        // f = 0 -> 100 - (100 / 3 * 2) = 33.333...
        expect(calculateNewFamiliarity(0, true)).toBeCloseTo(33.333, 2);
    });

    it('decreases familiarity on failed answer or show answer', () => {
        // f = 50 -> 50 / 3 = 16.666...
        expect(calculateNewFamiliarity(50, false)).toBeCloseTo(16.666, 2);
        // f = 90 -> 90 / 3 = 30
        expect(calculateNewFamiliarity(90, false)).toBe(30);
    });

    it('handles NaN or invalid familiarity values with fallback 50', () => {
        expect(calculateNewFamiliarity(NaN, false)).toBeCloseTo(50 / 3, 2);
    });
});

describe('parseFailOffsets', () => {
    it('parses valid comma-separated string', () => {
        expect(parseFailOffsets("3, 10, -1")).toEqual([3, 10, -1]);
        expect(parseFailOffsets("1, 5")).toEqual([1, 5]);
    });

    it('provides default fallback on invalid input', () => {
        expect(parseFailOffsets("invalid")).toEqual([3, 10, -1]);
        expect(parseFailOffsets("")).toEqual([3, 10, -1]);
    });
});

describe('reinsertFailedQuestion', () => {
    it('re-inserts question at specified relative offsets', () => {
        const queue = ['Q0', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5'];
        // Failed Q0 (index 0). Offsets 2, -1 (offset 2 -> target idx 2, offset -1 -> end)
        const updated = reinsertFailedQuestion(queue, 0, "2, -1");
        // Q0 removed, queue is ['Q1', 'Q2', 'Q3', 'Q4', 'Q5']
        // Insert Q0 at idx 2 -> ['Q1', 'Q2', 'Q0', 'Q3', 'Q4', 'Q5']
        // Insert Q0 at end -> ['Q1', 'Q2', 'Q0', 'Q3', 'Q4', 'Q5', 'Q0']
        expect(updated).toEqual(['Q1', 'Q2', 'Q0', 'Q3', 'Q4', 'Q5', 'Q0']);
    });

    it('counts offsets against upcoming questions, not earlier inserted copies', () => {
        const queue = ['Q0', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'];
        const updated = reinsertFailedQuestion(queue, 0, '2, 5');
        expect(updated).toEqual(['Q1', 'Q2', 'Q0', 'Q3', 'Q4', 'Q5', 'Q0', 'Q6']);
    });
});
