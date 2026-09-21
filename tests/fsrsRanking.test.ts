import { describe, it, expect } from 'vitest';
import { Rating, State } from 'ts-fsrs';
import { rankQueueItems, hashStringToUnitInterval, QueueItemCandidate } from '../src/fsrs/ranking';
import { createFsrsInstance, createNewQueueFsrsState, applyReviewGrade, setMasteredState } from '../src/fsrs/adapter';
import { createDefaultQueueFsrsSettings } from '../src/fsrs/settings';

describe('Deterministic Queue Ranking and Core Invariants', () => {
    const settings = createDefaultQueueFsrsSettings();
    const fsrs = createFsrsInstance(settings, { enable_fuzz: false });
    const fixedNow = new Date('2026-09-21T12:00:00.000Z');

    it('produces deterministic hash values in [0, 1) without Math.random', () => {
        const hash1 = hashStringToUnitInterval('test-key', 42);
        const hash2 = hashStringToUnitInterval('test-key', 42);
        const hash3 = hashStringToUnitInterval('test-key', 43);

        expect(hash1).toBe(hash2);
        expect(hash1).toBeGreaterThanOrEqual(0);
        expect(hash1).toBeLessThan(1);
        expect(hash1).not.toBe(hash3);
    });

    it('core invariant: a difficult just-reviewed card must NOT outrank an overdue low-retrievability card', () => {
        // Card A: Overdue low-retrievability card
        // Due 5 days ago, stability 1.0, retrievability low (~0.3), moderate difficulty 4.0
        const overdueState = createNewQueueFsrsState(new Date('2026-09-10T12:00:00.000Z'));
        const reviewedOverdue = applyReviewGrade(overdueState, Rating.Good, new Date('2026-09-10T12:00:00.000Z'), fsrs);
        // Force due date to 5 days ago
        reviewedOverdue.nextState.card.due = new Date('2026-09-16T12:00:00.000Z');
        reviewedOverdue.nextState.card.difficulty = 4.0;
        reviewedOverdue.nextState.card.state = State.Review;

        // Card B: Difficult card that was just reviewed a few minutes ago
        // Difficulty 9.5 (very high!), but retrievability ~1.0, not due for several days
        const justReviewedState = createNewQueueFsrsState(fixedNow);
        const reviewedDifficult = applyReviewGrade(justReviewedState, Rating.Hard, fixedNow, fsrs);
        reviewedDifficult.nextState.card.difficulty = 9.5;
        // Due is in the future
        reviewedDifficult.nextState.card.due = new Date('2026-09-24T12:00:00.000Z');
        reviewedDifficult.nextState.card.state = State.Review;

        const candidates: QueueItemCandidate[] = [
            { id: 'just-reviewed-difficult', state: reviewedDifficult.nextState },
            { id: 'overdue-low-recall', state: reviewedOverdue.nextState }
        ];

        // Include the future card via exploration so ordering can be compared.
        const rankingSettings = {
            ...settings.ranking,
            explorationShare: 1
        };

        const ranked = rankQueueItems(candidates, fixedNow, fsrs, rankingSettings);

        expect(ranked.length).toBe(2);
        // Overdue low-recall card must rank FIRST
        expect(ranked[0].id).toBe('overdue-low-recall');
        expect(ranked[0].reason).toBe('overdue');
        expect(ranked[1].id).toBe('just-reviewed-difficult');
        expect(ranked[0].priorityScore).toBeGreaterThan(ranked[1].priorityScore);
    });

    it('excludes mastered cards unless includeMastered is enabled', () => {
        const normalCard = createNewQueueFsrsState(fixedNow);
        const masteredCard = setMasteredState(createNewQueueFsrsState(fixedNow), true);

        const candidates: QueueItemCandidate[] = [
            { id: 'normal-1', state: normalCard },
            { id: 'mastered-1', state: masteredCard }
        ];

        // Default: includeMastered = false
        const rankedDefault = rankQueueItems(candidates, fixedNow, fsrs, {
            ...settings.ranking,
            includeMastered: false
        });
        expect(rankedDefault.some(c => c.id === 'mastered-1')).toBe(false);
        expect(rankedDefault.length).toBe(1);

        // Enabled: includeMastered = true
        const rankedWithMastered = rankQueueItems(candidates, fixedNow, fsrs, {
            ...settings.ranking,
            includeMastered: true
        });
        expect(rankedWithMastered.some(c => c.id === 'mastered-1')).toBe(true);
        const masteredItem = rankedWithMastered.find(c => c.id === 'mastered-1');
        expect(masteredItem?.reason).toBe('mastered');
        // Mastered card must be ranked last
        expect(rankedWithMastered[rankedWithMastered.length - 1].id).toBe('mastered-1');
    });

    it('deterministic exploration boosts not-yet-due cards consistently with seed', () => {
        // Card that is due in the future (not due)
        const futureCard = createNewQueueFsrsState(fixedNow);
        const reviewedFuture = applyReviewGrade(futureCard, Rating.Good, fixedNow, fsrs);
        reviewedFuture.nextState.card.due = new Date('2026-09-30T12:00:00.000Z');
        reviewedFuture.nextState.card.state = State.Review;

        const candidates: QueueItemCandidate[] = [
            { id: 'future-card-A', state: reviewedFuture.nextState }
        ];

        // 100% exploration share guarantees exploration trigger
        const ranked100 = rankQueueItems(
            candidates,
            fixedNow,
            fsrs,
            { ...settings.ranking, explorationShare: 1.0 },
            123
        );
        expect(ranked100[0].isExploration).toBe(true);
        expect(ranked100[0].reason).toBe('exploration');

        // 0% exploration share never explores
        const ranked0 = rankQueueItems(
            candidates,
            fixedNow,
            fsrs,
            { ...settings.ranking, explorationShare: 0 },
            123
        );
        expect(ranked0).toEqual([]);
    });
});
