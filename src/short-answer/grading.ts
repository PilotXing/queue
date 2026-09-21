/**
 * AI-assisted grading contracts, strict schema validation, rubric caching, and timeout wrappers.
 * Completely decoupled from external network implementations, real HTTP calls, or filesystem access.
 *
 * Requirements:
 * - Provider-neutral interface accepting question, reference answer, optional rubric, submitted answer, and response-time context.
 * - Strict runtime validation of untrusted structured output: score, matched/missing points, material errors, concise feedback, confidence, proposed Again/Hard/Good/Easy.
 * - Fail closed to manual confirmation for malformed output, timeout/provider errors, low confidence, near score threshold, or material contradiction.
 * - Always allow user override and expose a pure finalization function preserving both proposal and final decision.
 * - Wrong answers and Show Answer map to Again without model override; response time only refines correct Hard/Good/Easy.
 * - Rubric generation/cache types: short references may use direct semantic equivalence; longer references may cache required/optional points, acceptable paraphrases, contradictions. Hash reference content deterministically; invalidate rubric when reference changes.
 * - Deterministic grading cache key from queue_id + reference/rubric hash + submitted answer + provider/model.
 * - Never include credentials in domain types/history.
 * - Timeout wrapper testable with injected timers/AbortSignal.
 */

import { Grade } from 'ts-fsrs';
import {
    SerializedQueueFsrsStateV1,
    applyReviewGrade,
    createFsrsInstance,
    deserializeQueueFsrsState,
    serializeQueueFsrsState
} from '../fsrs/adapter';
import { QueueFsrsSettings, createDefaultQueueFsrsSettings } from '../fsrs/settings';
import {
    FsrsRating,
    GradingConfirmationReason,
    GradingEvaluation,
    GradingProvider,
    GradingProviderRequest,
    RubricProvider,
    RubricProviderRequest,
    ResponseTimeContext,
    ShortAnswerDiagnostic,
    ShortAnswerEventType,
    ShortAnswerHistoryEvent,
    ShortAnswerRubricMetadata,
    UntrustedRubricOutput,
    UntrustedGradingOutput,
    ValidatedGradingResult
} from './types';

/**
 * Standard configuration thresholds for AI evaluation.
 */
export interface GradingEvaluationConfig {
    /**
     * Confidence below this threshold forces manual confirmation (e.g. 0.75).
     */
    minConfidenceThreshold: number;
    /**
     * Scores within [passThreshold - margin, passThreshold + margin] require confirmation (e.g. 0.60 +- 0.15).
     */
    passThreshold: number;
    thresholdMargin: number;
    easyTimeRatio: number;
    hardTimeRatio: number;
}

export const DEFAULT_GRADING_CONFIG: GradingEvaluationConfig = {
    minConfidenceThreshold: 0.80,
    passThreshold: 0.60,
    thresholdMargin: 0.15,
    easyTimeRatio: 0.6,
    hardTimeRatio: 1.5
};

/**
 * Deterministic hash function (FNV-1a 32-bit hex) for strings.
 * Safe for UTF-8 Unicode, pure, fast, and deterministic.
 */
export function hashString(str: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Generates a deterministic grading cache key.
 */
export function createGradingCacheKey(
    queueId: string,
    referenceContent: string,
    submittedAnswer: string,
    providerId: string,
    modelId: string,
    rubricHash?: string
): string {
    const refHash = rubricHash || hashString(referenceContent.trim());
    const ansHash = hashString(submittedAnswer.trim());
    return [
        'v1',
        encodeURIComponent(queueId),
        refHash,
        ansHash,
        encodeURIComponent(providerId),
        encodeURIComponent(modelId)
    ].join(':');
}

/** Extracts a direct or OpenAI-compatible JSON grading payload. */
function extractStructuredObject(payload: unknown): Record<string, unknown> {
    if (payload && typeof payload === 'object' && !Array.isArray(payload) && !('choices' in payload)) {
        return payload as Record<string, unknown>;
    }
    const content = (payload as any)?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
        throw new Error('The grading proxy did not return structured JSON content.');
    }
    const cleaned = content.trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');
    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('The proxy response was not a structured JSON object.');
    }
    return parsed as Record<string, unknown>;
}

export function extractStructuredGradingOutput(payload: unknown): UntrustedGradingOutput {
    return extractStructuredObject(payload) as UntrustedGradingOutput;
}

export function extractStructuredRubricOutput(payload: unknown): UntrustedRubricOutput {
    return extractStructuredObject(payload) as UntrustedRubricOutput;
}

export function validateUntrustedRubricOutput(
    raw: unknown,
    referenceAnswer: string,
    model?: string,
    generatedAt: Date = new Date()
): { rubric?: ShortAnswerRubricMetadata; diagnostics: ShortAnswerDiagnostic[] } {
    const diagnostics: ShortAnswerDiagnostic[] = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return {
            diagnostics: [{ code: 'MALFORMED_RUBRIC', message: 'Rubric output must be a JSON object', severity: 'error' }]
        };
    }
    const obj = raw as UntrustedRubricOutput;
    const readList = (key: keyof UntrustedRubricOutput): string[] | undefined => {
        const value = obj[key];
        if (value === undefined) return undefined;
        if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
            diagnostics.push({
                code: 'INVALID_RUBRIC_FIELD',
                message: `${String(key)} must be an array of strings`,
                severity: 'error'
            });
            return undefined;
        }
        return value.map(item => (item as string).trim()).filter(Boolean);
    };
    const requiredPoints = readList('requiredPoints');
    const optionalPoints = readList('optionalPoints');
    const acceptableParaphrases = readList('acceptableParaphrases');
    const contradictions = readList('contradictions');
    if (!requiredPoints || requiredPoints.length === 0) {
        diagnostics.push({
            code: 'MISSING_REQUIRED_POINTS',
            message: 'Generated rubric must contain at least one required point',
            severity: 'error'
        });
    }
    if (diagnostics.some(item => item.severity === 'error')) return { diagnostics };
    return {
        rubric: createRubricMetadata(
            referenceAnswer,
            model,
            requiredPoints,
            optionalPoints,
            acceptableParaphrases,
            contradictions,
            generatedAt
        ),
        diagnostics
    };
}

/**
 * Validates untrusted structured output from an AI grading provider.
 */
export function validateUntrustedGradingOutput(
    raw: unknown
): { result?: ValidatedGradingResult; diagnostics: ShortAnswerDiagnostic[] } {
    const diagnostics: ShortAnswerDiagnostic[] = [];

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        diagnostics.push({
            code: 'MALFORMED_OUTPUT',
            message: 'Grading provider output is not a valid JSON object',
            severity: 'error'
        });
        return { diagnostics };
    }

    const output = raw as UntrustedGradingOutput;

    // Score validation (must be finite number between 0 and 1)
    const score = output.score;
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) {
        diagnostics.push({
            code: 'INVALID_SCORE',
            message: `Score must be a number between 0.0 and 1.0, got: ${output.score}`,
            severity: 'error'
        });
    }

    // Confidence validation (must be finite number between 0 and 1)
    const confidence = output.confidence;
    if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        diagnostics.push({
            code: 'INVALID_CONFIDENCE',
            message: `Confidence must be a number between 0.0 and 1.0, got: ${output.confidence}`,
            severity: 'error'
        });
    }

    // Matched points (must be array of strings)
    let matchedPoints: string[] = [];
    if (Array.isArray(output.matchedPoints)) {
        matchedPoints = output.matchedPoints.map(p => String(p).trim()).filter(Boolean);
        if (output.matchedPoints.some(point => typeof point !== 'string')) {
            diagnostics.push({ code: 'INVALID_MATCHED_POINTS', message: 'matchedPoints must contain only strings', severity: 'error' });
        }
    } else {
        diagnostics.push({
            code: 'INVALID_MATCHED_POINTS',
            message: 'matchedPoints must be an array of strings',
            severity: 'error'
        });
    }

    // Missing points (must be array of strings)
    let missingPoints: string[] = [];
    if (Array.isArray(output.missingPoints)) {
        missingPoints = output.missingPoints.map(p => String(p).trim()).filter(Boolean);
        if (output.missingPoints.some(point => typeof point !== 'string')) {
            diagnostics.push({ code: 'INVALID_MISSING_POINTS', message: 'missingPoints must contain only strings', severity: 'error' });
        }
    } else {
        diagnostics.push({
            code: 'INVALID_MISSING_POINTS',
            message: 'missingPoints must be an array of strings',
            severity: 'error'
        });
    }

    // Material errors (must be array of strings)
    let materialErrors: string[] = [];
    if (Array.isArray(output.materialErrors)) {
        materialErrors = output.materialErrors.map(p => String(p).trim()).filter(Boolean);
        if (output.materialErrors.some(point => typeof point !== 'string')) {
            diagnostics.push({ code: 'INVALID_MATERIAL_ERRORS', message: 'materialErrors must contain only strings', severity: 'error' });
        }
    } else {
        diagnostics.push({
            code: 'INVALID_MATERIAL_ERRORS',
            message: 'materialErrors must be an array of strings',
            severity: 'error'
        });
    }

    // Feedback
    let conciseFeedback = '';
    if (typeof output.feedback === 'string') {
        conciseFeedback = output.feedback.trim();
    } else {
        diagnostics.push({
            code: 'INVALID_FEEDBACK',
            message: 'feedback must be a string',
            severity: 'error'
        });
    }

    // Proposed rating: 1 (Again), 2 (Hard), 3 (Good), 4 (Easy)
    let proposedRating: FsrsRating = 3;
    const rawRating = Number(output.proposedRating);
    if (rawRating === 1 || rawRating === 2 || rawRating === 3 || rawRating === 4) {
        proposedRating = rawRating as FsrsRating;
    } else if (typeof output.proposedRating === 'string') {
        const lower = output.proposedRating.trim().toLowerCase();
        if (lower === 'again') proposedRating = 1;
        else if (lower === 'hard') proposedRating = 2;
        else if (lower === 'good') proposedRating = 3;
        else if (lower === 'easy') proposedRating = 4;
        else {
            diagnostics.push({
                code: 'INVALID_PROPOSED_RATING',
                message: `Unknown rating string "${output.proposedRating}", default to Good (3)`,
                severity: 'error'
            });
        }
    } else {
        diagnostics.push({
            code: 'MISSING_PROPOSED_RATING',
            message: 'proposedRating is missing or not a valid rating',
            severity: 'error'
        });
    }

    const hasErrors = diagnostics.some(d => d.severity === 'error');
    if (hasErrors) {
        return { diagnostics };
    }

    return {
        result: {
            score: score as number,
            matchedPoints,
            missingPoints,
            materialErrors,
            conciseFeedback,
            confidence: confidence as number,
            proposedRating
        },
        diagnostics
    };
}

/**
 * Evaluates a validated grading result to decide whether it fails closed to manual confirmation.
 *
 * Rules:
 * - If output is malformed or missing: fails closed ('malformed_output')
 * - Low confidence (< minConfidenceThreshold): requires manual confirmation ('low_confidence')
 * - Near score threshold (e.g. score between 0.45 and 0.75): requires manual confirmation ('near_score_threshold')
 * - Claimed material contradictions / material errors present: requires manual confirmation ('material_contradiction')
 * - If score < passThreshold, rating must map to Again (1). Model cannot override wrong answers.
 */
export function evaluateGradingResult(
    result: ValidatedGradingResult | undefined,
    config: GradingEvaluationConfig = DEFAULT_GRADING_CONFIG,
    timeContext?: ResponseTimeContext
): GradingEvaluation {
    const reasons: GradingConfirmationReason[] = [];
    const diagnostics: ShortAnswerDiagnostic[] = [];

    if (!result) {
        reasons.push('malformed_output');
        return {
            requiresManualConfirmation: true,
            confirmationReasons: reasons,
            diagnostics
        };
    }

    let finalProposedRating = result.proposedRating;

    // Check wrong answer rule:
    // If score < passThreshold, it is incorrect and must map to Again (1) without model override.
    if (result.score < config.passThreshold) {
        finalProposedRating = 1;
    } else {
        // Correct answer: response time may optionally refine rating between Hard (2), Good (3), Easy (4)
        const timingBaseline = timeContext?.questionMedianMs && timeContext.questionMedianMs > 0
            ? timeContext.questionMedianMs
            : timeContext?.learnerBaselineMs;
        if (timeContext && timeContext.activeDurationMs > 0 && timingBaseline && timingBaseline > 0) {
            const ratio = timeContext.activeDurationMs / timingBaseline;
            if (ratio >= config.hardTimeRatio && finalProposedRating > 2) {
                finalProposedRating = 2; // Hard
            } else if (ratio <= config.easyTimeRatio && finalProposedRating < 4 && result.score >= 0.95) {
                finalProposedRating = 4; // Easy
            }
        }
    }

    // Check low confidence
    if (result.confidence < config.minConfidenceThreshold) {
        reasons.push('low_confidence');
    }

    // Check near score threshold
    const minThreshold = config.passThreshold - config.thresholdMargin;
    const maxThreshold = config.passThreshold + config.thresholdMargin;
    if (result.score >= minThreshold && result.score <= maxThreshold) {
        reasons.push('near_score_threshold');
    }

    // Check material contradiction
    if (result.materialErrors.length > 0) {
        reasons.push('material_contradiction');
    }

    const requiresManualConfirmation = reasons.length > 0;
    if (!requiresManualConfirmation) {
        reasons.push('auto_accepted');
    }

    return {
        requiresManualConfirmation,
        confirmationReasons: reasons,
        gradingResult: {
            ...result,
            proposedRating: finalProposedRating
        },
        diagnostics
    };
}

/**
 * Wraps a GradingProvider call with a timeout / AbortSignal wrapper.
 * Pure and testable with mock providers or injected signals.
 */
export interface TimeoutScheduler {
    setTimeout(handler: () => void, timeoutMs: number): unknown;
    clearTimeout(id: unknown): void;
}

const defaultTimeoutScheduler: TimeoutScheduler = {
    setTimeout: (handler, timeoutMs) => globalThis.setTimeout(handler, timeoutMs),
    clearTimeout: id => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>)
};

export async function executeGradingWithTimeout(
    provider: GradingProvider,
    request: GradingProviderRequest,
    timeoutMs: number = 10000,
    scheduler: TimeoutScheduler = defaultTimeoutScheduler
): Promise<{ output?: UntrustedGradingOutput; errorReason?: GradingConfirmationReason; error?: Error }> {
    const controller = new AbortController();
    const compositeSignal = request.signal;

    if (compositeSignal?.aborted) {
        return { errorReason: 'provider_error', error: new Error('Request already aborted') };
    }

    let timeoutId: unknown;
    let abortedExternally = false;
    let externalAbortHandler: (() => void) | undefined;
    const timeoutPromise = new Promise<{ output?: UntrustedGradingOutput; errorReason?: GradingConfirmationReason; error?: Error }>((resolve) => {
        timeoutId = scheduler.setTimeout(() => {
            controller.abort();
            resolve({
                errorReason: 'timeout',
                error: new Error(`Grading request timed out after ${timeoutMs}ms`)
            });
        }, timeoutMs);
    });

    const externalAbortPromise = new Promise<{ errorReason: GradingConfirmationReason; error: Error }>(resolve => {
        externalAbortHandler = () => {
            abortedExternally = true;
            controller.abort();
            resolve({ errorReason: 'provider_error', error: new Error('Grading request was cancelled') });
        };
        compositeSignal?.addEventListener('abort', externalAbortHandler, { once: true });
    });

    const executionPromise = (async () => {
        try {
            const output = await provider.grade({
                ...request,
                signal: controller.signal
            });
            return { output };
        } catch (err: any) {
            if (controller.signal.aborted || err.name === 'AbortError') {
                return {
                    errorReason: (abortedExternally ? 'provider_error' : 'timeout') as GradingConfirmationReason,
                    error: err
                };
            }
            return { errorReason: 'provider_error' as GradingConfirmationReason, error: err };
        }
    })();

    const result = await Promise.race([executionPromise, timeoutPromise, externalAbortPromise]);
    scheduler.clearTimeout(timeoutId);
    if (externalAbortHandler) compositeSignal?.removeEventListener('abort', externalAbortHandler);
    return result;
}

export async function executeRubricGenerationWithTimeout(
    provider: RubricProvider,
    request: RubricProviderRequest,
    timeoutMs: number = 10000,
    scheduler: TimeoutScheduler = defaultTimeoutScheduler
): Promise<{ output?: UntrustedRubricOutput; errorReason?: GradingConfirmationReason; error?: Error }> {
    const controller = new AbortController();
    if (request.signal?.aborted) {
        return { errorReason: 'provider_error', error: new Error('Request already aborted') };
    }

    let timeoutId: unknown;
    const timeoutPromise = new Promise<{ errorReason: GradingConfirmationReason; error: Error }>(resolve => {
        timeoutId = scheduler.setTimeout(() => {
            controller.abort();
            resolve({ errorReason: 'timeout', error: new Error(`Rubric request timed out after ${timeoutMs}ms`) });
        }, timeoutMs);
    });
    const executionPromise = provider.generateRubric({ ...request, signal: controller.signal })
        .then(output => ({ output }))
        .catch((error: Error) => ({
            errorReason: (controller.signal.aborted ? 'timeout' : 'provider_error') as GradingConfirmationReason,
            error
        }));
    const result = await Promise.race([executionPromise, timeoutPromise]);
    scheduler.clearTimeout(timeoutId);
    return result;
}

/**
 * Parameters to finalize a grading decision and record the resulting history event.
 */
export interface FinalizeReviewParams {
    reviewId: string;
    now: Date;
    wallDurationMs: number;
    activeDurationMs: number;
    submittedAnswer: string;
    eventType: ShortAnswerEventType;
    score: number;
    isCorrect?: boolean;
    aiFeedback?: string;
    confidence?: number;
    proposedRating: FsrsRating;
    finalRating: FsrsRating;
    provider?: string;
    model?: string;
    rubricMetadata?: ShortAnswerRubricMetadata;
    currentFsrsState: SerializedQueueFsrsStateV1;
    fsrsSettings?: QueueFsrsSettings;
}

/**
 * Pure finalization function that applies the FSRS transition, preserves both proposed and final ratings,
 * and creates the single authoritative history event and updated FSRS state.
 */
export function finalizeGradingReview(params: FinalizeReviewParams): {
    historyEvent: ShortAnswerHistoryEvent;
    nextFsrsState: SerializedQueueFsrsStateV1;
} {
    const isOverride = params.proposedRating !== params.finalRating;
    const correctness = params.isCorrect !== undefined
        ? params.isCorrect
        : params.finalRating > 1;

    // Apply FSRS review grade
    const inMemoryState = deserializeQueueFsrsState(params.currentFsrsState, params.now);
    const fsrsInstance = createFsrsInstance(params.fsrsSettings || createDefaultQueueFsrsSettings());
    const reviewResult = applyReviewGrade(
        inMemoryState,
        params.finalRating as Grade,
        params.now,
        fsrsInstance,
        params.fsrsSettings || createDefaultQueueFsrsSettings()
    );
    const nextSerializedFsrs = serializeQueueFsrsState(reviewResult.nextState);

    const historyEvent: ShortAnswerHistoryEvent = {
        schemaVersion: 1,
        reviewId: params.reviewId,
        timestamp: params.now.toISOString(),
        wallDurationMs: params.wallDurationMs,
        activeDurationMs: params.activeDurationMs,
        submittedAnswer: params.submittedAnswer,
        eventType: params.eventType,
        correctness,
        score: params.score,
        aiFeedback: params.aiFeedback,
        confidence: params.confidence,
        proposedRating: params.proposedRating,
        finalRating: params.finalRating,
        isOverride,
        provider: params.provider,
        model: params.model,
        rubricVersion: params.rubricMetadata?.version,
        rubricHash: params.rubricMetadata?.referenceHash,
        transition: {
            rating: params.finalRating,
            previousState: params.currentFsrsState,
            nextState: nextSerializedFsrs
        }
    };

    return {
        historyEvent,
        nextFsrsState: nextSerializedFsrs
    };
}

/**
 * Creates rubric metadata from reference answer text.
 * Deterministically hashes the reference content.
 */
export function createRubricMetadata(
    referenceAnswer: string,
    model?: string,
    requiredPoints?: string[],
    optionalPoints?: string[],
    acceptableParaphrases?: string[],
    contradictions?: string[],
    generatedAt: Date = new Date()
): ShortAnswerRubricMetadata {
    const trimmed = referenceAnswer.trim();
    const referenceHash = hashString(trimmed);

    return {
        version: 1,
        referenceHash,
        generatorModel: model,
        generatedAt: generatedAt.toISOString(),
        requiredPoints,
        optionalPoints,
        acceptableParaphrases,
        contradictions
    };
}

/**
 * Checks whether an existing rubric metadata is still valid for the given reference answer.
 * Invalidates the rubric if the reference answer content changed.
 */
export function isRubricValid(
    rubric: ShortAnswerRubricMetadata | undefined,
    currentReferenceAnswer: string
): boolean {
    if (!rubric || !rubric.referenceHash) return false;
    const currentHash = hashString(currentReferenceAnswer.trim());
    return rubric.referenceHash === currentHash;
}
