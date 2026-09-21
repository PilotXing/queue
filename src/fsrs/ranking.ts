import { FSRS, State } from 'ts-fsrs';
import { QueueFsrsStateV1, calculateRetrievability } from './adapter';
import { QueueRankingSettings } from './settings';

/**
 * Concise ranking reason explaining why an item was placed at its priority.
 */
export type RankingReason =
    | 'overdue'
    | 'low recall probability'
    | 'high difficulty'
    | 'exploration'
    | 'mastered';

/**
 * An item candidate to be ranked in the review queue.
 */
export interface QueueItemCandidate {
    /** Unique identifier or note path */
    id: string;
    /** Current FSRS memory state */
    state: QueueFsrsStateV1;
}

/**
 * Scored and ranked queue item output.
 */
export interface RankedQueueItem {
    id: string;
    state: QueueFsrsStateV1;
    /** Priority score (higher score = higher review priority in queue) */
    priorityScore: number;
    /** Concise primary reason for priority assignment */
    reason: RankingReason;
    /** Current retrievability R in [0, 1] */
    retrievability: number;
    /** Days overdue (positive if past due date, negative if future) */
    daysOverdue: number;
    /** Difficulty value D in [1, 10] */
    difficulty: number;
    /** Whether this card was picked via exploration */
    isExploration: boolean;
}

/**
 * Pure 32-bit integer hash function (MurmurHash3-like or simple djb2/FNV)
 * to deterministically hash (seed + id) into [0, 1) float.
 * Eliminates any dependence on Math.random.
 */
export function hashStringToUnitInterval(str: string, seed: number = 0): number {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0);
    return (hash % 1000000) / 1000000;
}

/**
 * Deterministically ranks candidates into a prioritized queue.
 *
 * Ranking Invariants:
 * 1. Mastered items are excluded unless settings.includeMastered is true. Mastered cards receive lowest priority.
 * 2. Overdue status and low retrievability are primary.
 * 3. Difficulty is strictly a secondary boost/tiebreaker.
 * 4. Invariant: A difficult just-reviewed card must NOT outrank an overdue low-retrievability card under default settings.
 * 5. Deterministic exploration: Not-yet-due cards can be explored using injected seed/hash.
 */
export function rankQueueItems(
    candidates: QueueItemCandidate[],
    now: Date,
    fsrsInstance: FSRS,
    settings: QueueRankingSettings,
    seed: number = 42
): RankedQueueItem[] {
    const nowMs = now.getTime();
    const ranked: RankedQueueItem[] = [];

    for (const item of candidates) {
        const { id, state } = item;

        // Invariant 1: mastered filter
        if (state.mastered) {
            if (!settings.includeMastered) {
                continue;
            }
            ranked.push({
                id,
                state,
                priorityScore: -1000,
                reason: 'mastered',
                retrievability: 1.0,
                daysOverdue: -999,
                difficulty: state.card.difficulty,
                isExploration: false
            });
            continue;
        }

        const dueMs = state.card.due.getTime();
        const daysOverdue = (nowMs - dueMs) / (1000 * 60 * 60 * 24);
        const retrievability = calculateRetrievability(state, now, fsrsInstance);
        const difficulty = state.card.difficulty;

        // Is it new or due/overdue?
        const isNew = state.card.state === State.New && state.card.reps === 0;
        const isDueOrOverdue = isNew || daysOverdue >= 0;

        // Deterministic pseudo-random exploration roll
        const explorationRoll = hashStringToUnitInterval(`${seed}:${id}`, seed);
        const isExploration = !isDueOrOverdue && explorationRoll < settings.explorationShare;

        // Priority calculation:
        // Due / overdue cards get large base bonus (+100.0) so not-yet-due cards (unless explored) stay behind.
        // Retrievability factor: (1 - R) * retrievabilityWeight (max ~10.0)
        // Overdue factor: Math.max(0, daysOverdue) * 2.0
        // Difficulty boost: (difficulty / 10.0) * difficultyWeight (max ~0.5)
        let priorityScore = 0;
        let reason: RankingReason = 'low recall probability';

        if (isDueOrOverdue) {
            const overdueBoost = Math.max(0, daysOverdue) * settings.overdueWeight;
            const recallDeficit = (1 - retrievability) * settings.retrievabilityWeight;
            const difficultyBoost = (difficulty / 10.0) * settings.difficultyWeight;

            priorityScore = 100.0 + overdueBoost + recallDeficit + difficultyBoost;

            if (daysOverdue > 0.05) {
                reason = 'overdue';
            } else if (retrievability < 0.85) {
                reason = 'low recall probability';
            } else if (difficulty > 6.0) {
                reason = 'high difficulty';
            } else {
                reason = 'overdue';
            }
        } else if (isExploration) {
            // Explored card gets boosted into active consideration, but secondary to genuinely overdue cards
            const difficultyBoost = (difficulty / 10.0) * settings.difficultyWeight;
            priorityScore = 50.0 + (1 - retrievability) * settings.retrievabilityWeight + difficultyBoost;
            reason = 'exploration';
        } else {
            // FSRS intervals are meaningful only if not-yet-due cards stay out of
            // the active queue. The exploration share is the explicit opt-in
            // exception for inspecting a deterministic sample during evaluation.
            continue;
        }

        ranked.push({
            id,
            state,
            priorityScore,
            reason,
            retrievability,
            daysOverdue,
            difficulty,
            isExploration
        });
    }

    // Sort descending by priorityScore; tie-break deterministically by ID
    ranked.sort((a, b) => {
        if (Math.abs(b.priorityScore - a.priorityScore) > 1e-6) {
            return b.priorityScore - a.priorityScore;
        }
        return a.id.localeCompare(b.id);
    });

    return ranked;
}
