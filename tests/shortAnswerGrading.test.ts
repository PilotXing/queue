import { describe, it, expect } from 'vitest';
import {
    hashString,
    createGradingCacheKey,
    validateUntrustedGradingOutput,
    evaluateGradingResult,
    executeGradingWithTimeout,
    executeRubricGenerationWithTimeout,
    finalizeGradingReview,
    createRubricMetadata,
    isRubricValid,
    validateUntrustedRubricOutput
} from '../src/short-answer/grading';
import {
    GradingProvider,
    GradingProviderRequest,
    RubricProvider,
    UntrustedGradingOutput,
    ValidatedGradingResult
} from '../src/short-answer/types';
import { createNewQueueFsrsState, serializeQueueFsrsState } from '../src/fsrs/adapter';

describe('Short-Answer AI Grading Module', () => {
    const baseFsrs = serializeQueueFsrsState(createNewQueueFsrsState(new Date('2026-09-21T00:00:00Z')));

    it('generates deterministic hash and cache key', () => {
        const hash1 = hashString('Twin-engine turbojet with dual FADEC.');
        const hash2 = hashString('Twin-engine turbojet with dual FADEC.');
        expect(hash1).toBe(hash2);
        expect(hash1.length).toBe(8);

        const cacheKey1 = createGradingCacheKey(
            'q_123',
            'Twin-engine turbojet with dual FADEC.',
            'It has 2 engines and FADEC',
            'test-provider',
            'gpt-model'
        );

        const cacheKey2 = createGradingCacheKey(
            'q_123',
            'Twin-engine turbojet with dual FADEC.',
            'It has 2 engines and FADEC',
            'test-provider',
            'gpt-model'
        );
        expect(cacheKey1).toBe(cacheKey2);
    });

    it('validates untrusted grading output strictly', () => {
        const validOutput: UntrustedGradingOutput = {
            score: 0.9,
            matchedPoints: ['Redundancy', 'Efficiency'],
            missingPoints: [],
            materialErrors: [],
            feedback: 'Well explained.',
            confidence: 0.95,
            proposedRating: 3
        };

        const { result, diagnostics } = validateUntrustedGradingOutput(validOutput);
        expect(result).toBeDefined();
        expect(result?.score).toBe(0.9);
        expect(result?.confidence).toBe(0.95);
        expect(result?.proposedRating).toBe(3);
        expect(diagnostics.length).toBe(0);

        // Invalid score
        const badScore = validateUntrustedGradingOutput({
            score: 'not-a-number',
            confidence: 0.8
        });
        expect(badScore.result).toBeUndefined();
        expect(badScore.diagnostics.some(d => d.code === 'INVALID_SCORE')).toBe(true);

        // String rating normalization
        const stringRating = validateUntrustedGradingOutput({
            score: 0.85,
            confidence: 0.9,
            proposedRating: 'Easy',
            matchedPoints: [],
            missingPoints: [],
            materialErrors: [],
            feedback: 'Correct.'
        });
        expect(stringRating.result?.proposedRating).toBe(4);
    });

    it('fails closed to manual confirmation under edge conditions', () => {
        const baseResult: ValidatedGradingResult = {
            score: 0.95,
            matchedPoints: ['Point 1'],
            missingPoints: [],
            materialErrors: [],
            conciseFeedback: 'Good',
            confidence: 0.9,
            proposedRating: 3
        };

        // 1. Normal accepted case
        const normalEval = evaluateGradingResult(baseResult);
        expect(normalEval.requiresManualConfirmation).toBe(false);
        expect(normalEval.confirmationReasons).toContain('auto_accepted');

        // 2. Low confidence (< 0.75)
        const lowConfResult = { ...baseResult, confidence: 0.65 };
        const lowConfEval = evaluateGradingResult(lowConfResult);
        expect(lowConfEval.requiresManualConfirmation).toBe(true);
        expect(lowConfEval.confirmationReasons).toContain('low_confidence');

        // 3. Near threshold (score 0.62 is near 0.60 threshold)
        const nearThreshResult = { ...baseResult, score: 0.62 };
        const nearThreshEval = evaluateGradingResult(nearThreshResult);
        expect(nearThreshEval.requiresManualConfirmation).toBe(true);
        expect(nearThreshEval.confirmationReasons).toContain('near_score_threshold');

        // 4. Material contradiction / errors
        const contResult = { ...baseResult, materialErrors: ['Stated reverse pitch when prohibited'] };
        const contEval = evaluateGradingResult(contResult);
        expect(contEval.requiresManualConfirmation).toBe(true);
        expect(contEval.confirmationReasons).toContain('material_contradiction');

        // 5. Malformed / undefined output
        const malformedEval = evaluateGradingResult(undefined);
        expect(malformedEval.requiresManualConfirmation).toBe(true);
        expect(malformedEval.confirmationReasons).toContain('malformed_output');
    });

    it('enforces wrong answer maps to Again (1) without model override', () => {
        const wrongResult: ValidatedGradingResult = {
            score: 0.3,
            matchedPoints: [],
            missingPoints: ['Definition of V1'],
            materialErrors: [],
            conciseFeedback: 'Incorrect speed concept',
            confidence: 0.95,
            proposedRating: 3 // Model erroneously suggested Good
        };

        const evaluation = evaluateGradingResult(wrongResult);
        expect(evaluation.gradingResult?.proposedRating).toBe(1); // Mapped to Again
    });

    it('refines correct answers with response-time context', () => {
        const correctResult: ValidatedGradingResult = {
            score: 1.0,
            matchedPoints: ['Point A', 'Point B'],
            missingPoints: [],
            materialErrors: [],
            conciseFeedback: 'Flawless',
            confidence: 0.95,
            proposedRating: 3
        };

        // Very fast response (< 0.5 of baseline 10s -> 3s)
        const fastEval = evaluateGradingResult(correctResult, undefined, {
            activeDurationMs: 3000,
            learnerBaselineMs: 10000
        });
        expect(fastEval.gradingResult?.proposedRating).toBe(4); // Refined to Easy

        // Slow response (> 1.8 of baseline 10s -> 20s)
        const slowEval = evaluateGradingResult(correctResult, undefined, {
            activeDurationMs: 20000,
            learnerBaselineMs: 10000
        });
        expect(slowEval.gradingResult?.proposedRating).toBe(2); // Refined to Hard

        const questionSpecificEval = evaluateGradingResult(correctResult, undefined, {
            activeDurationMs: 7000,
            questionMedianMs: 4000,
            learnerBaselineMs: 20000
        });
        expect(questionSpecificEval.gradingResult?.proposedRating).toBe(2);
    });

    it('executes grading with timeout wrapper cleanly without HTTP or network calls', async () => {
        const fastProvider: GradingProvider = {
            providerId: 'mock-fast',
            modelId: 'fast-v1',
            grade: async (_req: GradingProviderRequest) => {
                return {
                    score: 0.9,
                    confidence: 0.9,
                    proposedRating: 3
                };
            }
        };

        const res = await executeGradingWithTimeout(fastProvider, {
            question: 'Q',
            referenceAnswer: 'A',
            submittedAnswer: 'A'
        }, 500);

        expect(res.output?.score).toBe(0.9);
        expect(res.errorReason).toBeUndefined();

        const hangingProvider: GradingProvider = {
            providerId: 'mock-hang',
            modelId: 'hang-v1',
            grade: (req: GradingProviderRequest) => {
                return new Promise((_, reject) => {
                    req.signal?.addEventListener('abort', () => {
                        const err = new Error('Aborted');
                        err.name = 'AbortError';
                        reject(err);
                    });
                });
            }
        };

        const timeoutRes = await executeGradingWithTimeout(hangingProvider, {
            question: 'Q',
            referenceAnswer: 'A',
            submittedAnswer: 'A'
        }, 50);

        expect(timeoutRes.errorReason).toBe('timeout');

        const externalController = new AbortController();
        const cancelled = executeGradingWithTimeout(hangingProvider, {
            question: 'Q',
            referenceAnswer: 'A',
            submittedAnswer: 'A',
            signal: externalController.signal
        }, 500);
        externalController.abort();
        await expect(cancelled).resolves.toMatchObject({ errorReason: 'provider_error' });
    });

    it('finalizes grading review, preserves proposal and user override, and produces exactly one history event', () => {
        const now = new Date('2026-09-21T02:00:00Z');
        const finalization = finalizeGradingReview({
            reviewId: 'rev-override-01',
            now,
            wallDurationMs: 5000,
            activeDurationMs: 4800,
            submittedAnswer: 'Minor detail missed',
            eventType: 'override',
            score: 0.75,
            proposedRating: 3, // AI proposed Good
            finalRating: 2, // User overrode to Hard
            provider: 'mock-ai',
            model: 'model-1',
            currentFsrsState: baseFsrs
        });

        expect(finalization.historyEvent.reviewId).toBe('rev-override-01');
        expect(finalization.historyEvent.isOverride).toBe(true);
        expect(finalization.historyEvent.proposedRating).toBe(3);
        expect(finalization.historyEvent.finalRating).toBe(2);
        expect(finalization.nextFsrsState.reps).toBe(1);
        expect(finalization.historyEvent.transition.nextState.reps).toBe(1);
    });

    it('creates and invalidates rubric when reference answer changes', () => {
        const originalRef = 'Dual magneto ignition system with independent circuits.';
        const rubric = createRubricMetadata(originalRef, 'gpt-rubric-gen', ['Dual magneto', 'Independent circuits']);
        expect(isRubricValid(rubric, originalRef)).toBe(true);

        const modifiedRef = 'Dual magneto ignition system with integrated electronic control.';
        expect(isRubricValid(rubric, modifiedRef)).toBe(false);
    });

    it('strictly validates generated rubric arrays and hashes the reference', () => {
        const now = new Date('2026-09-21T03:00:00Z');
        const valid = validateUntrustedRubricOutput({
            requiredPoints: ['Definition', 'Operational effect'],
            optionalPoints: [],
            acceptableParaphrases: ['Equivalent wording'],
            contradictions: ['Opposite condition']
        }, 'Reference text', 'rubric-model', now);
        expect(valid.rubric?.requiredPoints).toEqual(['Definition', 'Operational effect']);
        expect(valid.rubric?.generatedAt).toBe(now.toISOString());
        expect(isRubricValid(valid.rubric, 'Reference text')).toBe(true);

        const invalid = validateUntrustedRubricOutput({ requiredPoints: 'not-an-array' }, 'Reference');
        expect(invalid.rubric).toBeUndefined();
        expect(invalid.diagnostics.some(item => item.severity === 'error')).toBe(true);
    });

    it('wraps rubric generation with the same timeout boundary', async () => {
        const provider: RubricProvider = {
            providerId: 'mock-rubric',
            modelId: 'mock-v1',
            generateRubric: async () => ({
                requiredPoints: ['One'],
                optionalPoints: [],
                acceptableParaphrases: [],
                contradictions: []
            })
        };
        const result = await executeRubricGenerationWithTimeout(provider, {
            question: 'Q',
            referenceAnswer: 'A'
        }, 500);
        expect(result.output?.requiredPoints).toEqual(['One']);
    });
});
