import { describe, it, expect } from 'vitest';
import { Rating } from 'ts-fsrs';
import {
    MockClock,
    ResponseTimer,
    calculateMedian,
    inferRatingFromResponse
} from '../src/fsrs/timer';
import { createDefaultQueueFsrsSettings } from '../src/fsrs/settings';

describe('ResponseTimer Lifecycle and Invariants', () => {
    it('accurately tracks active duration across pause and resume', () => {
        const clock = new MockClock(1000);
        const timer = new ResponseTimer(clock, 60000);

        timer.start();
        expect(timer.getState()).toBe('running');

        // Advance 2000ms while active
        clock.advance(2000);
        timer.pause();
        expect(timer.getState()).toBe('paused');

        // Background / paused time: advance 5000ms (should NOT count toward active duration)
        clock.advance(5000);

        // Resume and advance another 1500ms
        timer.resume();
        expect(timer.getState()).toBe('running');
        clock.advance(1500);

        const sample = timer.submit();
        expect(timer.getState()).toBe('submitted');

        // Active duration should be exactly 2000 + 1500 = 3500ms
        expect(sample.activeDurationMs).toBe(3500);
        // Wall clock duration should be 2000 + 5000 + 1500 = 8500ms
        expect(sample.wallClockDurationMs).toBe(8500);
        expect(sample.isValid).toBe(true);
        expect(sample.isOutlier).toBe(false);
    });

    it('marks explicitly invalidated sessions as ineligible for rating inference while preserving duration', () => {
        const clock = new MockClock(1000);
        const timer = new ResponseTimer(clock, 60000);

        timer.start();
        clock.advance(4000);
        timer.invalidate('invalidated');

        expect(timer.getState()).toBe('invalidated');

        const sample = timer.submit();
        expect(sample.activeDurationMs).toBe(4000);
        expect(sample.isValid).toBe(false);
        expect(sample.ineligibleReason).toBe('invalidated');
    });

    it('identifies duration exceeding outlier cutoff as outlier', () => {
        const clock = new MockClock(0);
        const timer = new ResponseTimer(clock, 30000); // 30s cutoff

        timer.start();
        clock.advance(35000); // 35s active

        const sample = timer.submit();
        expect(sample.isOutlier).toBe(true);
        expect(sample.isValid).toBe(false);
        expect(sample.ineligibleReason).toBe('outlier');
    });
});

describe('calculateMedian', () => {
    it('calculates median for odd and even number collections', () => {
        expect(calculateMedian([5, 1, 9])).toBe(5);
        expect(calculateMedian([1, 2, 3, 4])).toBe(2.5);
        expect(calculateMedian([])).toBeNull();
    });
});

describe('inferRatingFromResponse', () => {
    const settings = createDefaultQueueFsrsSettings().timing;

    it('maps wrong answers and Show Answer to Again regardless of duration', () => {
        const wrongRes = inferRatingFromResponse({
            isCorrect: false,
            measuredActiveDurationMs: 1000,
            settings
        });
        expect(wrongRes.grade).toBe(Rating.Again);
        expect(wrongRes.isMastered).toBe(false);

        const showAnswerRes = inferRatingFromResponse({
            isCorrect: false,
            isShowAnswer: true,
            measuredActiveDurationMs: 500,
            settings
        });
        expect(showAnswerRes.grade).toBe(Rating.Again);
    });

    it('maps Skip to mastered with no FSRS grade', () => {
        const skipRes = inferRatingFromResponse({
            isCorrect: false,
            isSkip: true,
            settings
        });
        expect(skipRes.grade).toBeNull();
        expect(skipRes.isMastered).toBe(true);
    });

    it('uses question-level median when at least minSamples are available', () => {
        // Question baseline samples: [10000, 10000, 10000, 10000, 10000] -> median 10000ms
        // Easy ratio: 0.6 -> <= 6000ms is Easy
        // Hard ratio: 1.5 -> >= 15000ms is Hard
        const questionHist = [10000, 10000, 10000, 10000, 10000];

        const fastRes = inferRatingFromResponse({
            isCorrect: true,
            measuredActiveDurationMs: 5000, // <= 6000ms
            questionHistoricalDurationsMs: questionHist,
            settings
        });
        expect(fastRes.grade).toBe(Rating.Easy);
        expect(fastRes.baselineSource).toBe('question');

        const slowRes = inferRatingFromResponse({
            isCorrect: true,
            measuredActiveDurationMs: 16000, // >= 15000ms
            questionHistoricalDurationsMs: questionHist,
            settings
        });
        expect(slowRes.grade).toBe(Rating.Hard);
        expect(slowRes.baselineSource).toBe('question');

        const normalRes = inferRatingFromResponse({
            isCorrect: true,
            measuredActiveDurationMs: 10000,
            questionHistoricalDurationsMs: questionHist,
            settings
        });
        expect(normalRes.grade).toBe(Rating.Good);
    });

    it('falls back to learner median when question samples are below minimum', () => {
        // Only 2 question samples (< min 5)
        const questionHist = [20000, 20000];
        // Learner has 5 samples with median 8000ms
        const learnerHist = [8000, 8000, 8000, 8000, 8000];

        const res = inferRatingFromResponse({
            isCorrect: true,
            measuredActiveDurationMs: 4000, // 4000 / 8000 = 0.5 <= 0.6 -> Easy
            questionHistoricalDurationsMs: questionHist,
            learnerHistoricalDurationsMs: learnerHist,
            settings
        });
        expect(res.grade).toBe(Rating.Easy);
        expect(res.baselineSource).toBe('learner');
        expect(res.baselineMedianMs).toBe(8000);
    });

    it('falls back to default learner baseline when both question and learner samples are sparse', () => {
        // defaultLearnerMedianMs = 10000ms
        const res = inferRatingFromResponse({
            isCorrect: true,
            measuredActiveDurationMs: 10000,
            settings
        });
        expect(res.grade).toBe(Rating.Good);
        expect(res.baselineSource).toBe('default_learner');
    });

    it('does NOT infer Hard or Easy when duration is marked as estimated', () => {
        const questionHist = [10000, 10000, 10000, 10000, 10000];

        // Even though 2000ms is much faster than baseline (normally Easy)
        const res = inferRatingFromResponse({
            isCorrect: true,
            measuredActiveDurationMs: 2000,
            questionHistoricalDurationsMs: questionHist,
            isEstimatedDuration: true,
            settings
        });
        expect(res.grade).toBe(Rating.Good);
        expect(res.reason).toContain('Estimated duration');
    });

    it('ineligible or outlier samples fall back to Good for correct answers', () => {
        const resOutlier = inferRatingFromResponse({
            isCorrect: true,
            measuredActiveDurationMs: 90000, // exceeds outlierCutoffMs 60000
            settings
        });
        expect(resOutlier.grade).toBe(Rating.Good);
        expect(resOutlier.reason).toContain('outlier');

        const resIneligible = inferRatingFromResponse({
            isCorrect: true,
            measuredActiveDurationMs: 2000,
            isEligibleSample: false,
            settings
        });
        expect(resIneligible.grade).toBe(Rating.Good);
    });
});
