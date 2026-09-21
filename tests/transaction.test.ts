import { describe, it, expect } from 'vitest';
import { GradingLock } from '../src/core/transaction';

describe('GradingLock', () => {
    it('executes action and releases lock on success', async () => {
        const lock = new GradingLock();
        expect(lock.isGrading).toBe(false);

        let executedInside = false;
        const res = await lock.executeTransaction(async () => {
            expect(lock.isGrading).toBe(true);
            executedInside = true;
            return 42;
        });

        expect(res).toEqual({ executed: true, result: 42 });
        expect(executedInside).toBe(true);
        expect(lock.isGrading).toBe(false);
    });

    it('blocks secondary submissions while lock is active', async () => {
        const lock = new GradingLock();

        let resolveFirst: (val: string) => void = () => {};
        const firstAction = lock.executeTransaction(() => new Promise(res => { resolveFirst = res; }));

        expect(lock.isGrading).toBe(true);

        // Attempt secondary submission while first is still pending
        const secondRes = await lock.executeTransaction(async () => 'second');
        expect(secondRes).toEqual({ executed: false });

        resolveFirst('first');
        const firstRes = await firstAction;
        expect(firstRes).toEqual({ executed: true, result: 'first' });
        expect(lock.isGrading).toBe(false);
    });

    it('releases lock via try/finally even if an exception is thrown', async () => {
        const lock = new GradingLock();

        await expect(lock.executeTransaction(async () => {
            throw new Error('Write failed');
        })).rejects.toThrow('Write failed');
        expect(lock.isGrading).toBe(false);
    });
});
