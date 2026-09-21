import {
    Card,
    FSRS,
    FSRSParameters,
    Grade,
    Rating,
    State,
    createEmptyCard,
    generatorParameters
} from 'ts-fsrs';
import { QueueFsrsSettings, defaultFsrsParameters } from './settings';

/**
 * Persisted schema version for Queue FSRS state.
 */
export const QUEUE_FSRS_SCHEMA_VERSION = 1;

/**
 * Default ts-fsrs model version tag.
 */
export const QUEUE_FSRS_MODEL_VERSION = 'v5.4.2 using FSRS-6.0';

/**
 * Serialized representation of Queue FSRS state stored in frontmatter or JSON.
 */
export interface SerializedQueueFsrsStateV1 {
    schemaVersion: 1;
    modelVersion: string;
    mastered: boolean;
    due: string;
    stability: number;
    difficulty: number;
    elapsed_days: number;
    scheduled_days: number;
    reps: number;
    lapses: number;
    state: number;
    learning_steps: number;
    last_review?: string | null;
}

/**
 * Pure in-memory FSRS card state for Queue.
 * Extends ts-fsrs Card properties with Queue metadata.
 */
export interface QueueFsrsStateV1 {
    schemaVersion: 1;
    modelVersion: string;
    mastered: boolean;
    card: Card;
}

/**
 * Creates an initial FSRS state for a brand new question card.
 */
export function createNewQueueFsrsState(
    now: Date = new Date(),
    modelVersion: string = QUEUE_FSRS_MODEL_VERSION
): QueueFsrsStateV1 {
    const card = createEmptyCard(now);
    return {
        schemaVersion: QUEUE_FSRS_SCHEMA_VERSION,
        modelVersion,
        mastered: false,
        card
    };
}

/**
 * Converts pure QueueFsrsStateV1 into a JSON-safe plain object where Dates are ISO strings.
 */
export function serializeQueueFsrsState(state: QueueFsrsStateV1): SerializedQueueFsrsStateV1 {
    return {
        schemaVersion: state.schemaVersion,
        modelVersion: state.modelVersion,
        mastered: Boolean(state.mastered),
        due: state.card.due.toISOString(),
        stability: state.card.stability,
        difficulty: state.card.difficulty,
        elapsed_days: state.card.elapsed_days,
        scheduled_days: state.card.scheduled_days,
        reps: state.card.reps,
        lapses: state.card.lapses,
        state: state.card.state,
        learning_steps: state.card.learning_steps,
        last_review: state.card.last_review ? state.card.last_review.toISOString() : null
    };
}

/**
 * Safely parses and validates untrusted data (e.g. from YAML frontmatter or data.json)
 * into a valid QueueFsrsStateV1, falling back to a fresh card or defaults where necessary.
 */
export function deserializeQueueFsrsState(
    raw: unknown,
    fallbackNow: Date = new Date()
): QueueFsrsStateV1 {
    if (!raw || typeof raw !== 'object') {
        return createNewQueueFsrsState(fallbackNow);
    }

    const obj = raw as Record<string, unknown>;

    if (obj.schemaVersion !== undefined && obj.schemaVersion !== QUEUE_FSRS_SCHEMA_VERSION) {
        return createNewQueueFsrsState(fallbackNow);
    }

    // Model version
    const modelVersion = typeof obj.modelVersion === 'string' && obj.modelVersion.trim()
        ? obj.modelVersion
        : QUEUE_FSRS_MODEL_VERSION;

    const mastered = obj.mastered === true;

    // Parse dates safely
    let due: Date;
    if (obj.due instanceof Date && !isNaN(obj.due.getTime())) {
        due = obj.due;
    } else if (typeof obj.due === 'string' || typeof obj.due === 'number') {
        const d = new Date(obj.due);
        due = isNaN(d.getTime()) ? new Date(fallbackNow) : d;
    } else {
        due = new Date(fallbackNow);
    }

    let last_review: Date | undefined = undefined;
    if (obj.last_review instanceof Date && !isNaN(obj.last_review.getTime())) {
        last_review = obj.last_review;
    } else if (typeof obj.last_review === 'string' || typeof obj.last_review === 'number') {
        const lr = new Date(obj.last_review);
        if (!isNaN(lr.getTime())) {
            last_review = lr;
        }
    }

    // Number parsing helper with fallback
    const parseNum = (val: unknown, fallback: number): number => {
        if (typeof val === 'number' && Number.isFinite(val)) return val;
        if (typeof val === 'string') {
            const parsed = parseFloat(val);
            if (Number.isFinite(parsed)) return parsed;
        }
        return fallback;
    };

    const parseIntNum = (val: unknown, fallback: number): number => {
        if (typeof val === 'number' && Number.isFinite(val)) return Math.floor(val);
        if (typeof val === 'string') {
            const parsed = parseInt(val, 10);
            if (Number.isFinite(parsed)) return parsed;
        }
        return fallback;
    };

    const stability = Math.max(0, parseNum(obj.stability, 0));
    const difficulty = Math.max(0, Math.min(10, parseNum(obj.difficulty, 0)));
    const elapsed_days = Math.max(0, parseNum(obj.elapsed_days, 0));
    const scheduled_days = Math.max(0, parseNum(obj.scheduled_days, 0));
    const reps = Math.max(0, parseIntNum(obj.reps, 0));
    const lapses = Math.max(0, parseIntNum(obj.lapses, 0));
    const learning_steps = Math.max(0, parseIntNum(obj.learning_steps, 0));

    // State enum: 0 = New, 1 = Learning, 2 = Review, 3 = Relearning
    let stateVal = parseIntNum(obj.state, State.New);
    if (stateVal < State.New || stateVal > State.Relearning) {
        stateVal = State.New;
    }

    const card: Card = {
        due,
        stability,
        difficulty,
        elapsed_days,
        scheduled_days,
        reps,
        lapses,
        state: stateVal as State,
        learning_steps,
        last_review
    };

    return {
        schemaVersion: QUEUE_FSRS_SCHEMA_VERSION,
        modelVersion,
        mastered,
        card
    };
}

/**
 * Builds an instance of ts-fsrs FSRS based on QueueFsrsSettings.
 * Allows overriding parameters and explicitly disabling fuzz for deterministic testing.
 */
export function createFsrsInstance(
    settings: QueueFsrsSettings,
    overrideParams?: Partial<FSRSParameters>
): FSRS {
    const baseParams = settings.fsrsParameters ?? defaultFsrsParameters;
    const mergedParams: Partial<FSRSParameters> = {
        ...baseParams,
        request_retention: settings.requestedRetention,
        maximum_interval: settings.maximumInterval,
        ...overrideParams
    };

    const params = generatorParameters(mergedParams);
    return new FSRS(params);
}

/**
 * Result of scheduling an item review.
 */
export interface ReviewResult {
    nextState: QueueFsrsStateV1;
    rating: Grade;
    reviewTime: Date;
    scheduledDays: number;
    due: Date;
    stability: number;
    difficulty: number;
}

/**
 * Applies an FSRS review grade (Again, Hard, Good, Easy) at an injected timestamp.
 */
export function applyReviewGrade(
    currentState: QueueFsrsStateV1,
    grade: Grade,
    reviewTime: Date,
    fsrsInstance: FSRS,
    intervalBounds?: Pick<QueueFsrsSettings, 'minimumInterval' | 'maximumInterval'>
): ReviewResult {
    if (!Number.isFinite(reviewTime.getTime())) {
        throw new Error('Review time must be a valid Date.');
    }
    if (![Rating.Again, Rating.Hard, Rating.Good, Rating.Easy].includes(grade as Rating)) {
        throw new Error(`Unsupported FSRS grade: ${String(grade)}`);
    }
    // Mastered cards stay mastered and are not modified by FSRS
    if (currentState.mastered) {
        return {
            nextState: { ...currentState },
            rating: grade,
            reviewTime,
            scheduledDays: currentState.card.scheduled_days,
            due: currentState.card.due,
            stability: currentState.card.stability,
            difficulty: currentState.card.difficulty
        };
    }

    const recordLogItem = fsrsInstance.next(currentState.card, reviewTime, grade);
    let nextCard = recordLogItem.card;
    if (intervalBounds && nextCard.state === State.Review) {
        const minimum = Math.max(0, Math.floor(intervalBounds.minimumInterval));
        const maximum = Math.max(minimum, Math.floor(intervalBounds.maximumInterval));
        const boundedDays = Math.max(minimum, Math.min(maximum, nextCard.scheduled_days));
        if (boundedDays !== nextCard.scheduled_days) {
            nextCard = {
                ...nextCard,
                scheduled_days: boundedDays,
                due: new Date(reviewTime.getTime() + boundedDays * 86400000)
            };
        }
    }

    const nextState: QueueFsrsStateV1 = {
        schemaVersion: currentState.schemaVersion,
        modelVersion: currentState.modelVersion,
        mastered: false,
        card: nextCard
    };

    return {
        nextState,
        rating: grade,
        reviewTime,
        scheduledDays: nextCard.scheduled_days,
        due: nextCard.due,
        stability: nextCard.stability,
        difficulty: nextCard.difficulty
    };
}

/**
 * Calculates current retrievability for a given state at an injected evaluation timestamp.
 * - Mastered cards return 1.0 (100% familiarity).
 * - New cards (never reviewed) return 0.0.
 * - Otherwise delegates dynamically to ts-fsrs forgetting curve / retrievability calculation.
 */
export function calculateRetrievability(
    state: QueueFsrsStateV1,
    now: Date,
    fsrsInstance: FSRS
): number {
    if (state.mastered) {
        return 1.0;
    }

    if (state.card.state === State.New && state.card.reps === 0) {
        return 0.0;
    }

    const r = fsrsInstance.get_retrievability(state.card, now, false);
    if (typeof r === 'number' && !isNaN(r)) {
        return Math.max(0, Math.min(1, r));
    }
    return 0.0;
}

/**
 * Sets mastered flag on a card.
 * Skip/mastered is outside FSRS; mastered cards remain 100 familiarity.
 */
export function setMasteredState(
    state: QueueFsrsStateV1,
    mastered: boolean = true
): QueueFsrsStateV1 {
    return {
        ...state,
        mastered
    };
}
