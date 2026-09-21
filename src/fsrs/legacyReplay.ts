import { FSRS, Grade, Rating } from 'ts-fsrs';
import { QueueFsrsStateV1, applyReviewGrade, createNewQueueFsrsState } from './adapter';

/**
 * Pure legacy practice history row event input.
 */
export interface LegacyHistoryEvent {
    /** ISO timestamp string or Date, e.g. "2026-09-20 14:30:00" or "2026-09-20T14:30:00.000Z" */
    timestamp: string | Date;
    /** Whether the review was marked correct */
    isCorrect: boolean;
    /** Choice selected, e.g. "A", "B", or "S" for Show Answer */
    selected: string;
    /** Optional estimated duration in milliseconds between submissions */
    estimatedDurationMs?: number;
}

/**
 * Diagnostic record produced during replay when encountering malformed or suspicious events.
 */
export interface LegacyReplayDiagnostic {
    index: number;
    event: LegacyHistoryEvent;
    type: 'malformed_timestamp' | 'future_timestamp' | 'out_of_order' | 'implausible_duration';
    message: string;
}

/**
 * Result of replaying historical review events.
 */
export interface LegacyReplayResult {
    /** Final accumulated FSRS state after all valid reviews */
    finalState: QueueFsrsStateV1;
    /** Count of successfully applied review events */
    replayedCount: number;
    /** Diagnostics for problematic rows without throwing or mutating source */
    diagnostics: LegacyReplayDiagnostic[];
    /** Chronological review transitions logged */
    transitions: Array<{
        timestamp: Date;
        grade: Grade;
        stability: number;
        difficulty: number;
        scheduledDays: number;
    }>;
}

/**
 * Parses timestamp string or Date safely into a Date object.
 */
export function parseLegacyTimestamp(ts: string | Date): Date | null {
    if (ts instanceof Date) {
        return isNaN(ts.getTime()) ? null : ts;
    }
    if (typeof ts === 'string') {
        const trimmed = ts.trim();
        // Replace space between date and time with T if needed (e.g. "2026-09-20 14:30:00" -> "2026-09-20T14:30:00")
        const normalized = trimmed.includes(' ') && !trimmed.includes('T')
            ? trimmed.replace(' ', 'T')
            : trimmed;
        const d = new Date(normalized);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
}

/**
 * Pure legacy history replay:
 * - Chronological replay of events: correct => Good, incorrect or selected "S" => Again.
 * - Historical estimated durations must NOT infer Hard/Easy by default (always mapped to Good/Again).
 * - Collects diagnostics for malformed, out-of-order, future timestamps, or implausible durations.
 * - Does NOT mutate source events or fail catastrophically.
 */
export function replayLegacyHistory(
    events: readonly LegacyHistoryEvent[],
    fsrsInstance: FSRS,
    now: Date = new Date(),
    maxPlausibleDurationMs: number = 300000 // 5 minutes
): LegacyReplayResult {
    const diagnostics: LegacyReplayDiagnostic[] = [];
    const validChronologicalEvents: Array<{
        originalIndex: number;
        event: LegacyHistoryEvent;
        parsedDate: Date;
    }> = [];

    // Step 1: Validate dates and diagnostics
    let lastValidTime = 0;

    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const parsedDate = parseLegacyTimestamp(event.timestamp);

        if (!parsedDate) {
            diagnostics.push({
                index: i,
                event,
                type: 'malformed_timestamp',
                message: `Unable to parse legacy timestamp: "${event.timestamp}"`
            });
            continue;
        }

        const timeMs = parsedDate.getTime();

        // Check if timestamp is in the future
        if (timeMs > now.getTime() + 60000) { // 1 min margin of error
            diagnostics.push({
                index: i,
                event,
                type: 'future_timestamp',
                message: `Timestamp ${parsedDate.toISOString()} is in the future relative to ${now.toISOString()}`
            });
            continue;
        }

        // Check chronological order
        if (timeMs < lastValidTime) {
            diagnostics.push({
                index: i,
                event,
                type: 'out_of_order',
                message: `Event timestamp ${parsedDate.toISOString()} is earlier than previous event (${new Date(lastValidTime).toISOString()})`
            });
        }

        // Check estimated duration plausibility if provided
        if (typeof event.estimatedDurationMs === 'number') {
            if (event.estimatedDurationMs <= 0 || event.estimatedDurationMs > maxPlausibleDurationMs) {
                diagnostics.push({
                    index: i,
                    event,
                    type: 'implausible_duration',
                    message: `Estimated duration ${event.estimatedDurationMs}ms is out of plausible range (0 to ${maxPlausibleDurationMs}ms)`
                });
            }
        }

        lastValidTime = Math.max(lastValidTime, timeMs);
        validChronologicalEvents.push({
            originalIndex: i,
            event,
            parsedDate
        });
    }

    // Step 2: Sort valid events chronologically for clean replay
    validChronologicalEvents.sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime());

    // Step 3: Replay sequentially using FSRS
    const initialTime = validChronologicalEvents.length > 0
        ? validChronologicalEvents[0].parsedDate
        : now;

    let currentState = createNewQueueFsrsState(initialTime);
    const transitions: LegacyReplayResult['transitions'] = [];
    let replayedCount = 0;

    for (const item of validChronologicalEvents) {
        const { event, parsedDate } = item;

        // Contract: correct => Good, incorrect or selected 'S' => Again
        // Historical estimated duration is strictly ignored for Hard/Easy
        const isFailed = !event.isCorrect || event.selected.trim().toUpperCase() === 'S';
        const grade: Grade = isFailed ? (Rating.Again as Grade) : (Rating.Good as Grade);

        const result = applyReviewGrade(currentState, grade, parsedDate, fsrsInstance);
        currentState = result.nextState;
        replayedCount++;

        transitions.push({
            timestamp: parsedDate,
            grade,
            stability: result.stability,
            difficulty: result.difficulty,
            scheduledDays: result.scheduledDays
        });
    }

    return {
        finalState: currentState,
        replayedCount,
        diagnostics,
        transitions
    };
}
