import { Grade, Rating } from 'ts-fsrs';
import { ResponseTimingSettings } from './settings';

/**
 * An injectable monotonic clock providing time in milliseconds.
 */
export interface MonotonicClock {
    now(): number;
}

/**
 * System default monotonic clock using performance.now() or Date.now().
 */
export const defaultSystemClock: MonotonicClock = {
    now(): number {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
        return Date.now();
    }
};

/**
 * Fixed mock clock for tests.
 */
export class MockClock implements MonotonicClock {
    private currentTimeMs: number;

    constructor(initialTimeMs: number = 0) {
        this.currentTimeMs = initialTimeMs;
    }

    now(): number {
        return this.currentTimeMs;
    }

    advance(ms: number): void {
        this.currentTimeMs += ms;
    }

    setTime(ms: number): void {
        this.currentTimeMs = ms;
    }
}

/**
 * Status of the response timer lifecycle.
 */
export type TimerState = 'idle' | 'running' | 'paused' | 'invalidated' | 'submitted';

/**
 * Auditable result of a completed or submitted timer session.
 */
export interface ResponseTimingSample {
    wallClockDurationMs: number;
    activeDurationMs: number;
    isValid: boolean;
    isOutlier: boolean;
    ineligibleReason?: 'invalidated' | 'outlier' | 'paused_too_long' | 'negative';
}

/**
 * ResponseTimer tracks user response time monotonically with support for
 * pausing, resuming, invalidating, and outlier detection.
 */
export class ResponseTimer {
    private clock: MonotonicClock;
    private state: TimerState = 'idle';
    private wallStartMs: number = 0;
    private activeAccumulatedMs: number = 0;
    private segmentStartMs: number = 0;
    private outlierCutoffMs: number;
    private invalidReason?: 'invalidated' | 'outlier' | 'paused_too_long' | 'negative';

    constructor(clock: MonotonicClock = defaultSystemClock, outlierCutoffMs: number = 60000) {
        this.clock = clock;
        this.outlierCutoffMs = outlierCutoffMs;
    }

    getState(): TimerState {
        return this.state;
    }

    /**
     * Starts the timer for an actionable question.
     */
    start(): void {
        const now = this.clock.now();
        this.state = 'running';
        this.wallStartMs = now;
        this.segmentStartMs = now;
        this.activeAccumulatedMs = 0;
        this.invalidReason = undefined;
    }

    /**
     * Pauses the timer (e.g. window blurred, tab backgrounded, app suspended).
     * Background / paused time does NOT count toward active duration.
     */
    pause(): void {
        if (this.state !== 'running') return;
        const now = this.clock.now();
        this.activeAccumulatedMs += Math.max(0, now - this.segmentStartMs);
        this.state = 'paused';
    }

    /**
     * Resumes the timer when the app/question becomes active again.
     */
    resume(): void {
        if (this.state !== 'paused') return;
        this.segmentStartMs = this.clock.now();
        this.state = 'running';
    }

    /**
     * Explicitly invalidates timing (e.g. question navigated away, interrupted, or reset).
     * Keeps sample for audit but prevents rating inference.
     */
    invalidate(reason: 'invalidated' | 'outlier' | 'paused_too_long' = 'invalidated'): void {
        if (this.state === 'running') {
            const now = this.clock.now();
            this.activeAccumulatedMs += Math.max(0, now - this.segmentStartMs);
        }
        this.state = 'invalidated';
        this.invalidReason = reason;
    }

    /**
     * Submits the review and returns the final auditable timing sample.
     */
    submit(): ResponseTimingSample {
        const now = this.clock.now();
        if (this.state === 'running') {
            this.activeAccumulatedMs += Math.max(0, now - this.segmentStartMs);
        }

        const wallClockDurationMs = Math.max(0, now - this.wallStartMs);
        const activeDurationMs = Math.max(0, this.activeAccumulatedMs);

        const isOutlier = activeDurationMs > this.outlierCutoffMs;
        const isExplicitlyInvalid = this.state === 'invalidated';
        const isValid = !isExplicitlyInvalid && !isOutlier && activeDurationMs > 0;

        let ineligibleReason = this.invalidReason;
        if (!ineligibleReason) {
            if (isOutlier) ineligibleReason = 'outlier';
            else if (activeDurationMs <= 0) ineligibleReason = 'negative';
        }

        this.state = 'submitted';

        return {
            wallClockDurationMs,
            activeDurationMs,
            isValid,
            isOutlier,
            ineligibleReason
        };
    }
}

/**
 * Calculates the median of an array of numbers.
 */
export function calculateMedian(numbers: number[]): number | null {
    if (!numbers || numbers.length === 0) return null;
    const sorted = [...numbers].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 !== 0) {
        return sorted[mid];
    }
    return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Input for rating inference.
 */
export interface RatingInferenceInput {
    /** Whether the user answered correctly. False for wrong or Show Answer. */
    isCorrect: boolean;
    /** Whether the action was Show Answer (S) */
    isShowAnswer?: boolean;
    /** Whether the user chose Skip (which marks mastered, no FSRS rating) */
    isSkip?: boolean;
    /** Measured active duration in ms. If undefined or invalid, defaults to Good when correct. */
    measuredActiveDurationMs?: number;
    /** Historical valid active durations for this specific question (up to rolling window size) */
    questionHistoricalDurationsMs?: number[];
    /** Historical valid active durations for the learner overall (or learner median) */
    learnerHistoricalDurationsMs?: number[];
    /** Timing configuration settings */
    settings: ResponseTimingSettings;
    /** Flag indicating whether the timing duration was estimated (e.g. from legacy history timestamps). Must NOT infer Hard/Easy by default. */
    isEstimatedDuration?: boolean;
    /** Explicit flag indicating whether this sample is valid and eligible for rating inference */
    isEligibleSample?: boolean;
}

/**
 * Result of pure response-time rating inference.
 */
export interface RatingInferenceResult {
    /** The inferred FSRS Grade (Rating.Again, Rating.Hard, Rating.Good, Rating.Easy), or null if skipped/mastered */
    grade: Grade | null;
    /** Whether the item should be marked mastered */
    isMastered: boolean;
    /** Explanation of how the grade was determined */
    reason: string;
    /** Baseline median used for comparison (if applicable) */
    baselineMedianMs?: number;
    /** Whether a per-question or learner baseline was used */
    baselineSource?: 'question' | 'learner' | 'default_learner';
}

/**
 * Pure response-time rating inference:
 * - Wrong answer or Show Answer => Again
 * - Skip => mastered / no FSRS rating (null)
 * - Correct answer => Hard / Good / Easy using per-question median only after minimum samples;
 *   otherwise learner median; otherwise default Good.
 * - Historical estimated durations must not infer Hard/Easy by default.
 * - Ineligible/invalid samples fall back to Good.
 */
export function inferRatingFromResponse(input: RatingInferenceInput): RatingInferenceResult {
    // 1. Skip => Mastered, no FSRS rating
    if (input.isSkip) {
        return {
            grade: null,
            isMastered: true,
            reason: 'Question skipped; marked as mastered without FSRS rating.'
        };
    }

    // 2. Show Answer => Again
    if (input.isShowAnswer) {
        return {
            grade: Rating.Again as Grade,
            isMastered: false,
            reason: 'Show Answer recorded as failed attempt (Again).'
        };
    }

    // 3. Incorrect => Again
    if (!input.isCorrect) {
        return {
            grade: Rating.Again as Grade,
            isMastered: false,
            reason: 'Incorrect answer recorded as failed attempt (Again).'
        };
    }

    // 4. Correct answer: determine Hard, Good, or Easy
    // If duration is estimated, do NOT infer Hard/Easy by default.
    if (input.isEstimatedDuration) {
        return {
            grade: Rating.Good as Grade,
            isMastered: false,
            reason: 'Estimated duration from historical logs; defaulting to neutral Good.'
        };
    }

    // If timing sample is not eligible or duration is missing, fall back to Good
    if (
        input.isEligibleSample === false ||
        typeof input.measuredActiveDurationMs !== 'number' ||
        input.measuredActiveDurationMs <= 0 ||
        input.measuredActiveDurationMs > input.settings.outlierCutoffMs
    ) {
        return {
            grade: Rating.Good as Grade,
            isMastered: false,
            reason: 'Ineligible, missing, or outlier response duration; defaulting to neutral Good.'
        };
    }

    const duration = input.measuredActiveDurationMs;
    const { minSamplesPerQuestion, rollingWindowSize, easyRatio, hardRatio, defaultLearnerMedianMs } = input.settings;

    let baselineMedian: number | null = null;
    let baselineSource: 'question' | 'learner' | 'default_learner' = 'default_learner';

    // Check per-question historical samples
    const validQuestionSamples = (input.questionHistoricalDurationsMs || [])
        .filter(d => typeof d === 'number' && d > 0 && d <= input.settings.outlierCutoffMs)
        .slice(-rollingWindowSize);

    if (validQuestionSamples.length >= minSamplesPerQuestion) {
        baselineMedian = calculateMedian(validQuestionSamples);
        baselineSource = 'question';
    } else {
        // Fall back to learner samples
        const validLearnerSamples = (input.learnerHistoricalDurationsMs || [])
            .filter(d => typeof d === 'number' && d > 0 && d <= input.settings.outlierCutoffMs)
            .slice(-rollingWindowSize);

        if (validLearnerSamples.length >= minSamplesPerQuestion) {
            baselineMedian = calculateMedian(validLearnerSamples);
            baselineSource = 'learner';
        } else {
            baselineMedian = defaultLearnerMedianMs;
            baselineSource = 'default_learner';
        }
    }

    if (!baselineMedian || baselineMedian <= 0) {
        return {
            grade: Rating.Good as Grade,
            isMastered: false,
            reason: 'No valid baseline median available; defaulting to Good.'
        };
    }

    const ratio = duration / baselineMedian;

    if (ratio <= easyRatio) {
        return {
            grade: Rating.Easy as Grade,
            isMastered: false,
            reason: `Fast response (${Math.round(duration)}ms <= ${easyRatio}x baseline ${Math.round(baselineMedian)}ms); rated Easy.`,
            baselineMedianMs: baselineMedian,
            baselineSource
        };
    }

    if (ratio >= hardRatio) {
        return {
            grade: Rating.Hard as Grade,
            isMastered: false,
            reason: `Slow response (${Math.round(duration)}ms >= ${hardRatio}x baseline ${Math.round(baselineMedian)}ms); rated Hard.`,
            baselineMedianMs: baselineMedian,
            baselineSource
        };
    }

    return {
        grade: Rating.Good as Grade,
        isMastered: false,
        reason: `Normal response time within [${easyRatio}x, ${hardRatio}x] of baseline (${Math.round(duration)}ms vs ${Math.round(baselineMedian)}ms); rated Good.`,
        baselineMedianMs: baselineMedian,
        baselineSource
    };
}
