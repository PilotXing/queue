/**
 * Pure helper module for grading transactions and locking.
 */

export class GradingLock {
    private _isGrading: boolean = false;

    get isGrading(): boolean {
        return this._isGrading;
    }

    /**
     * Executes an async grading action if not already grading.
     * Lock acquisition is synchronous before any async work starts.
     * Releases lock in try/finally block even if an exception occurs.
     */
    async executeTransaction<T>(action: () => Promise<T>): Promise<{ executed: boolean; result?: T }> {
        if (this._isGrading) {
            return { executed: false };
        }
        this._isGrading = true;
        try {
            const result = await action();
            return { executed: true, result };
        } finally {
            this._isGrading = false;
        }
    }
}
