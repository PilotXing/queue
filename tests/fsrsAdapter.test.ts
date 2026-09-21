import { describe, it, expect } from 'vitest';
import { Rating, State } from 'ts-fsrs';
import {
    createNewQueueFsrsState,
    serializeQueueFsrsState,
    deserializeQueueFsrsState,
    createFsrsInstance,
    applyReviewGrade,
    calculateRetrievability,
    setMasteredState,
    QUEUE_FSRS_SCHEMA_VERSION,
    QUEUE_FSRS_MODEL_VERSION
} from '../src/fsrs/adapter';
import {
    createDefaultQueueFsrsSettings,
    validateFsrsParameters
} from '../src/fsrs/settings';

describe('FSRS Adapter and State Serialization', () => {
    it('creates fresh new card state with correct versioning and defaults', () => {
        const fixedNow = new Date('2026-09-21T10:00:00.000Z');
        const state = createNewQueueFsrsState(fixedNow);

        expect(state.schemaVersion).toBe(QUEUE_FSRS_SCHEMA_VERSION);
        expect(state.modelVersion).toBe(QUEUE_FSRS_MODEL_VERSION);
        expect(state.mastered).toBe(false);
        expect(state.card.state).toBe(State.New);
        expect(state.card.reps).toBe(0);
        expect(state.card.due.toISOString()).toBe(fixedNow.toISOString());
    });

    it('serializes QueueFsrsStateV1 into ISO date strings and safe numbers', () => {
        const fixedNow = new Date('2026-09-21T10:00:00.000Z');
        const state = createNewQueueFsrsState(fixedNow);
        const serialized = serializeQueueFsrsState(state);

        expect(serialized.schemaVersion).toBe(1);
        expect(serialized.modelVersion).toBe(QUEUE_FSRS_MODEL_VERSION);
        expect(serialized.mastered).toBe(false);
        expect(typeof serialized.due).toBe('string');
        expect(serialized.due).toBe('2026-09-21T10:00:00.000Z');
        expect(serialized.last_review).toBeNull();
    });

    it('safely deserializes untrusted frontmatter data, handling missing or corrupted fields', () => {
        const corrupted = {
            schemaVersion: 1,
            modelVersion: 'custom-model',
            mastered: 'yes', // untrusted strings must not be treated as true
            due: 'invalid-date-string',
            stability: 'not-a-number',
            difficulty: 15, // should clamp to 10
            state: 99, // invalid enum should fallback to State.New
            reps: -5
        };

        const fallbackDate = new Date('2026-09-21T12:00:00.000Z');
        const deserialized = deserializeQueueFsrsState(corrupted, fallbackDate);

        expect(deserialized.schemaVersion).toBe(1);
        expect(deserialized.modelVersion).toBe('custom-model');
        expect(deserialized.mastered).toBe(false);
        expect(deserialized.card.due.toISOString()).toBe(fallbackDate.toISOString());
        expect(deserialized.card.stability).toBe(0);
        expect(deserialized.card.difficulty).toBe(10);
        expect(deserialized.card.state).toBe(State.New);
        expect(deserialized.card.reps).toBe(0);
    });

    it('rejects unsupported schemas and non-finite numeric fields', () => {
        const fallbackDate = new Date('2026-09-21T12:00:00.000Z');
        const unsupported = deserializeQueueFsrsState({
            schemaVersion: 99,
            due: '2025-01-01T00:00:00.000Z',
            stability: 10
        }, fallbackDate);
        expect(unsupported.card.due.toISOString()).toBe(fallbackDate.toISOString());
        expect(unsupported.card.stability).toBe(0);

        const nonFinite = deserializeQueueFsrsState({
            schemaVersion: 1,
            due: fallbackDate.toISOString(),
            stability: Infinity,
            difficulty: 'Infinity'
        }, fallbackDate);
        expect(nonFinite.card.stability).toBe(0);
        expect(nonFinite.card.difficulty).toBe(0);
    });

    it('deserializes null or non-object safely into a fresh card state', () => {
        const fallbackDate = new Date('2026-09-21T12:00:00.000Z');
        const deserialized = deserializeQueueFsrsState(null, fallbackDate);
        expect(deserialized.schemaVersion).toBe(1);
        expect(deserialized.card.due.toISOString()).toBe(fallbackDate.toISOString());
    });
});

describe('FSRS Review Rating Transitions and Deterministic Scheduling', () => {
    const defaultSettings = createDefaultQueueFsrsSettings();
    const fsrs = createFsrsInstance(defaultSettings, { enable_fuzz: false });
    const fixedNow = new Date('2026-09-21T10:00:00.000Z');

    it('transitions New card through Again, Hard, Good, Easy deterministically', () => {
        const initial = createNewQueueFsrsState(fixedNow);

        const reviewAgain = applyReviewGrade(initial, Rating.Again, fixedNow, fsrs);
        const reviewHard = applyReviewGrade(initial, Rating.Hard, fixedNow, fsrs);
        const reviewGood = applyReviewGrade(initial, Rating.Good, fixedNow, fsrs);
        const reviewEasy = applyReviewGrade(initial, Rating.Easy, fixedNow, fsrs);

        // Good or Easy should produce higher stability than Again
        expect(reviewAgain.stability).toBeLessThan(reviewGood.stability);
        expect(reviewAgain.stability).toBeLessThan(reviewHard.stability);
        expect(reviewGood.stability).toBeLessThan(reviewEasy.stability);

        // Difficulty for Again should be higher than Easy
        expect(reviewAgain.difficulty).toBeGreaterThan(reviewEasy.difficulty);

        // Next review date must be after review time
        expect(reviewGood.due.getTime()).toBeGreaterThan(fixedNow.getTime());
        expect(reviewGood.nextState.card.reps).toBe(1);
    });

    it('calculates retrievability decay dynamically over time', () => {
        const initial = createNewQueueFsrsState(fixedNow);
        const reviewed = applyReviewGrade(initial, Rating.Good, fixedNow, fsrs);

        // Immediately at review time, retrievability should be 1.0 (100%)
        const retAtReview = calculateRetrievability(reviewed.nextState, fixedNow, fsrs);
        expect(retAtReview).toBeCloseTo(1.0, 2);

        // 10 days later, retrievability should decay below 1.0
        const tenDaysLater = new Date(fixedNow.getTime() + 10 * 24 * 60 * 60 * 1000);
        const ret10Days = calculateRetrievability(reviewed.nextState, tenDaysLater, fsrs);
        expect(ret10Days).toBeLessThan(retAtReview);
        expect(ret10Days).toBeGreaterThan(0.0);

        // 100 days later, retrievability should decay even further
        const hundredDaysLater = new Date(fixedNow.getTime() + 100 * 24 * 60 * 60 * 1000);
        const ret100Days = calculateRetrievability(reviewed.nextState, hundredDaysLater, fsrs);
        expect(ret100Days).toBeLessThan(ret10Days);
    });

    it('preserves mastered card invariant: retrievability stays 1.0 and FSRS review does not alter card', () => {
        const initial = createNewQueueFsrsState(fixedNow);
        const masteredState = setMasteredState(initial, true);
        expect(masteredState.mastered).toBe(true);

        const ret = calculateRetrievability(masteredState, fixedNow, fsrs);
        expect(ret).toBe(1.0);

        // Further time passing still reports 1.0 retrievability
        const oneYearLater = new Date(fixedNow.getTime() + 365 * 24 * 60 * 60 * 1000);
        expect(calculateRetrievability(masteredState, oneYearLater, fsrs)).toBe(1.0);

        // Applying a review grade to a mastered card leaves its card state untouched
        const reviewResult = applyReviewGrade(masteredState, Rating.Again, oneYearLater, fsrs);
        expect(reviewResult.nextState.mastered).toBe(true);
        expect(reviewResult.stability).toBe(masteredState.card.stability);
    });

    it('rejects invalid review timestamps and runtime grades', () => {
        const initial = createNewQueueFsrsState(fixedNow);
        expect(() => applyReviewGrade(initial, Rating.Good, new Date('invalid'), fsrs)).toThrow('valid Date');
        expect(() => applyReviewGrade(initial, 99 as any, fixedNow, fsrs)).toThrow('Unsupported');
    });

    it('applies configured interval bounds to long-term review cards', () => {
        const initial = createNewQueueFsrsState(fixedNow);
        const result = applyReviewGrade(initial, Rating.Easy, fixedNow, fsrs, {
            minimumInterval: 100,
            maximumInterval: 100
        });
        expect(result.nextState.card.state).toBe(State.Review);
        expect(result.scheduledDays).toBe(100);
        expect(result.due.getTime()).toBe(fixedNow.getTime() + 100 * 86400000);
    });
});

describe('FSRS Parameters Validation', () => {
    it('validates standard 19-number parameter array successfully', () => {
        const defaultW = [
            0.40255, 1.18385, 3.173, 15.69105,
            7.1949, 0.5345, 1.4604, 0.0046,
            1.54575, 0.1192, 1.01925,
            1.9395, 0.11, 0.29605, 0.22695,
            0.5698, 2.85535, 0.468, 0.333
        ];
        const res = validateFsrsParameters(defaultW);
        expect(res.valid).toBe(true);
        expect(res.parameters?.length).toBe(19);
    });

    it('rejects invalid length or empty parameter array', () => {
        const resShort = validateFsrsParameters([1, 2, 3]);
        expect(resShort.valid).toBe(false);
        expect(resShort.error).toContain('must contain 19 or 21 numbers');
    });
});
