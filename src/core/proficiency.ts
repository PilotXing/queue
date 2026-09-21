/**
 * Pure helper module for familiarity calculation and queue re-insertion offsets.
 */

/**
 * Calculates new familiarity score based on correctness.
 * - Correct: 100 - ((100 - f) / 3) * 2
 * - Failed (Wrong / Show Answer): f / 3
 */
export function calculateNewFamiliarity(currentFam: number, isCorrect: boolean): number {
    const f = typeof currentFam === 'number' && !isNaN(currentFam) ? currentFam : 50;
    if (isCorrect) {
        return 100 - ((100 - f) / 3) * 2;
    } else {
        return f / 3;
    }
}

/**
 * Parses raw offsets string like "3, 10, -1" into an array of integers.
 */
export function parseFailOffsets(offsetsStr: string): number[] {
    if (!offsetsStr || typeof offsetsStr !== 'string') {
        return [3, 10, -1];
    }
    const parsed = offsetsStr
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !isNaN(n));
    
    return parsed.length > 0 ? parsed : [3, 10, -1];
}

/**
 * Re-inserts a failed question item at specified offsets relative to the current index.
 * - offset -1 means the end of the queue.
 * - Clamps target indices within [0, newQueueLength].
 */
export function reinsertFailedQuestion<T>(queue: T[], currentIndex: number, offsetsStr: string): T[] {
    if (currentIndex < 0 || currentIndex >= queue.length) {
        return [...queue];
    }

    const newQueue = [...queue];
    const [failedItem] = newQueue.splice(currentIndex, 1);
    const offsets = parseFailOffsets(offsetsStr);
    const positionalOffsets = offsets
        .filter(offset => offset !== -1)
        .map(offset => Math.max(0, Math.min(currentIndex + offset, newQueue.length)))
        .sort((a, b) => a - b);

    let inserted = 0;
    for (const baseTarget of positionalOffsets) {
        newQueue.splice(baseTarget + inserted, 0, failedItem);
        inserted++;
    }

    for (const offset of offsets) {
        if (offset === -1) {
            newQueue.push(failedItem);
        }
    }

    return newQueue;
}
