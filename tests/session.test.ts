import { describe, it, expect } from 'vitest';
import {
    createDefaultSessionState,
    serializeSessionState,
    deserializeSessionState,
    parseMarkdownSession,
    quoteYamlString,
    SessionState
} from '../src/core/session';

describe('SessionState management', () => {
    it('creates valid default session state', () => {
        const state = createDefaultSessionState();
        expect(state.version).toBe(1);
        expect(state.savedQueuePaths).toEqual([]);
        expect(state.savedIndex).toBe(0);
        expect(state.filterCategory).toBe('All');
        expect(state.filterFamiliarity).toBe(100);
        expect(state.isFinished).toBe(false);
    });

    it('serializes and deserializes SessionState accurately', () => {
        const original: SessionState = {
            version: 1,
            savedQueuePaths: ['q1.md', 'q2.md'],
            savedIndex: 1,
            filterCategory: 'Math',
            filterFamiliarity: 80,
            isFinished: false,
            showingAnswer: true,
            selectedChoices: ['A', 'B'],
            correctAnswers: 5,
            wrongAnswers: 2,
            sessionResults: [['q1.md', 'correct'], ['q2.md', 'wrong']]
        };

        const json = serializeSessionState(original);
        const restored = deserializeSessionState(json);
        expect(restored).toEqual(original);
    });

    it('clamps index and filters missing paths during deserialization', () => {
        const validPaths = new Set(['q1.md', 'q2.md']);
        const raw = JSON.stringify({
            savedQueuePaths: ['q1.md', 'deleted.md', 'q2.md'],
            savedIndex: 10 // out of bounds index
        });

        const restored = deserializeSessionState(raw, validPaths);
        expect(restored.savedQueuePaths).toEqual(['q1.md', 'q2.md']);
        expect(restored.savedIndex).toBe(1); // clamped to max index 1
    });

    it('keeps the same selected question when earlier missing paths are removed', () => {
        const restored = deserializeSessionState({
            savedQueuePaths: ['deleted.md', 'q1.md', 'q2.md'],
            savedIndex: 1,
            sessionResults: [['deleted.md', 'wrong'], ['q1.md', 'correct']]
        }, new Set(['q1.md', 'q2.md']));

        expect(restored.savedIndex).toBe(0);
        expect(restored.savedQueuePaths[restored.savedIndex]).toBe('q1.md');
        expect(restored.sessionResults).toEqual([['q1.md', 'correct']]);
    });

    it('provides safe defaults for legacy frontmatter missing fields', () => {
        const frontmatter = {
            category: 'Physics',
            currentIndex: 2,
            isFinished: false
        };
        const content = '## Queue\n[[q1.md|Q1]]\n[[q2.md|Q2]]\n[[q3.md|Q3]]';

        const parsed = parseMarkdownSession(content, frontmatter);
        expect(parsed.savedIndex).toBe(2);
        expect(parsed.filterCategory).toBe('Physics');
        expect(parsed.parsedPaths).toEqual(['q1.md', 'q2.md', 'q3.md']);
        expect(parsed.filterFamiliarity).toBe(100);
        expect(parsed.correctAnswers).toBe(0);
        expect(parsed.wrongAnswers).toBe(0);
    });

    it('restores the complete state embedded in Markdown frontmatter', () => {
        const state: SessionState = {
            version: 1,
            savedQueuePaths: ["folder/O'Brien.md", 'q2.md'],
            savedIndex: 0,
            filterCategory: "Pilot's: Notes",
            filterFamiliarity: 72,
            isFinished: false,
            showingAnswer: true,
            selectedChoices: ['A', 'C'],
            correctAnswers: 4,
            wrongAnswers: 3,
            sessionResults: [["folder/O'Brien.md", 'wrong'], ['q2.md', 'correct']]
        };
        const json = serializeSessionState(state);
        expect(quoteYamlString(json)).toContain("Pilot''s: Notes");

        const parsed = parseMarkdownSession('', { sessionState: json });
        expect(parsed).toMatchObject({ ...state, parsedPaths: state.savedQueuePaths });
    });
});
