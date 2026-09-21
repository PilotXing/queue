/**
 * Domain types for Pure Short-Answer questions, history, grading, rubrics, and migration.
 * Strictly decoupled from Obsidian API and external network.
 */

import { SerializedQueueFsrsStateV1 } from '../fsrs/adapter';

/**
 * Queue short-answer schema version.
 */
export const QUEUE_SHORT_ANSWER_SCHEMA_VERSION = 1 as const;
export type QueueShortAnswerSchemaVersion = typeof QUEUE_SHORT_ANSWER_SCHEMA_VERSION;

/**
 * Valid FSRS Rating enum values (1: Again, 2: Hard, 3: Good, 4: Easy).
 */
export type FsrsRating = 1 | 2 | 3 | 4;

/**
 * Rubric metadata attached to a question card.
 */
export interface ShortAnswerRubricMetadata {
    version: number;
    referenceHash: string;
    generatorModel?: string;
    generatedAt?: string;
    requiredPoints?: string[];
    optionalPoints?: string[];
    acceptableParaphrases?: string[];
    contradictions?: string[];
}

/**
 * Frontmatter structure for short-answer questions.
 */
export interface ShortAnswerFrontmatter {
    queue_schema: QueueShortAnswerSchemaVersion;
    queue_id: string;
    type: 'short-answer';
    category: string;
    tags: string[];
    source?: string;
    fsrs: SerializedQueueFsrsStateV1;
    rubric?: ShortAnswerRubricMetadata;
    [key: string]: unknown;
}

/**
 * In-memory parsed representation of a short-answer card.
 */
export interface ShortAnswerCard {
    frontmatter: ShortAnswerFrontmatter;
    question: string;
    referenceAnswer?: string;
    source?: string;
    humanGradingNotes?: string;
    generatedRubric?: string;
    historyEvents: ShortAnswerHistoryEvent[];
}

/**
 * Event types for short-answer review attempts.
 */
export type ShortAnswerEventType = 'ai-grade' | 'manual-grade' | 'show-answer' | 'override';

/**
 * FSRS state transition snapshot recorded in history.
 */
export interface ShortAnswerFsrsTransition {
    rating: FsrsRating;
    previousState?: SerializedQueueFsrsStateV1;
    nextState: SerializedQueueFsrsStateV1;
}

/**
 * Append-only structured history event stored as one line in queue-history JSONL block.
 */
export interface ShortAnswerHistoryEvent {
    schemaVersion: 1;
    reviewId: string;
    timestamp: string; // ISO 8601
    wallDurationMs: number;
    activeDurationMs: number;
    timingValid?: boolean;
    timingOutlier?: boolean;
    timingIneligibleReason?: string;
    submittedAnswer: string;
    eventType: ShortAnswerEventType;
    correctness: boolean;
    score: number; // Normalized 0.0 - 1.0 or custom numeric score
    aiFeedback?: string;
    confidence?: number; // 0.0 - 1.0
    proposedRating: FsrsRating;
    finalRating: FsrsRating;
    isOverride: boolean;
    provider?: string;
    model?: string;
    rubricVersion?: number;
    rubricHash?: string;
    transition: ShortAnswerFsrsTransition;
    [key: string]: unknown; // Preserve unknown future fields on read/write
}

/**
 * Diagnostic severity for validation and migration.
 */
export type DiagnosticSeverity = 'info' | 'warning' | 'error';

export interface ShortAnswerDiagnostic {
    code: string;
    message: string;
    severity: DiagnosticSeverity;
    location?: string;
    context?: unknown;
}

/**
 * Response time context supplied during grading.
 */
export interface ResponseTimeContext {
    activeDurationMs: number;
    wallDurationMs?: number;
    learnerBaselineMs?: number;
    questionMedianMs?: number;
}

/**
 * Raw or untrusted output returned by a grading provider.
 */
export interface UntrustedGradingOutput {
    score?: unknown;
    matchedPoints?: unknown;
    missingPoints?: unknown;
    materialErrors?: unknown;
    feedback?: unknown;
    confidence?: unknown;
    proposedRating?: unknown;
    [key: string]: unknown;
}

/**
 * Strictly validated structured grading result.
 */
export interface ValidatedGradingResult {
    score: number; // 0.0 to 1.0
    matchedPoints: string[];
    missingPoints: string[];
    materialErrors: string[];
    conciseFeedback: string;
    confidence: number; // 0.0 to 1.0
    proposedRating: FsrsRating;
}

/**
 * Status of the grading decision: whether it is accepted directly or fails closed to manual confirmation.
 */
export type GradingConfirmationReason =
    | 'auto_accepted'
    | 'malformed_output'
    | 'provider_error'
    | 'timeout'
    | 'low_confidence'
    | 'near_score_threshold'
    | 'material_contradiction';

export interface GradingEvaluation {
    requiresManualConfirmation: boolean;
    confirmationReasons: GradingConfirmationReason[];
    gradingResult?: ValidatedGradingResult;
    diagnostics: ShortAnswerDiagnostic[];
}

/**
 * Input contract for AI-assisted grading providers.
 */
export interface GradingProviderRequest {
    question: string;
    referenceAnswer: string;
    rubric?: ShortAnswerRubricMetadata;
    submittedAnswer: string;
    timeContext?: ResponseTimeContext;
    signal?: AbortSignal;
}

/**
 * Grading provider interface. Pure function or contract without network implementation.
 */
export interface GradingProvider {
    readonly providerId: string;
    readonly modelId: string;
    grade(request: GradingProviderRequest): Promise<UntrustedGradingOutput>;
}

export interface RubricProviderRequest {
    question: string;
    referenceAnswer: string;
    signal?: AbortSignal;
}

export interface UntrustedRubricOutput {
    requiredPoints?: unknown;
    optionalPoints?: unknown;
    acceptableParaphrases?: unknown;
    contradictions?: unknown;
    [key: string]: unknown;
}

export interface RubricProvider {
    readonly providerId: string;
    readonly modelId: string;
    generateRubric(request: RubricProviderRequest): Promise<UntrustedRubricOutput>;
}
