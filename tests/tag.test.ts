import { describe, it, expect } from 'vitest';
import { isQuestionTag, normalizeTag } from '../src/core/tag';

describe('isQuestionTag', () => {
    it('normalizes single tag strings with or without leading #', () => {
        expect(normalizeTag('q')).toBe('q');
        expect(normalizeTag('#q')).toBe('q');
        expect(normalizeTag('  #q  ')).toBe('q');
    });

    it('matches exact q tag', () => {
        expect(isQuestionTag('q')).toBe(true);
        expect(isQuestionTag('#q')).toBe(true);
        expect(isQuestionTag(['math', 'q'])).toBe(true);
        expect(isQuestionTag(['math', '#q'])).toBe(true);
    });

    it('rejects partial matches like quiz, faq, quality', () => {
        expect(isQuestionTag('quiz')).toBe(false);
        expect(isQuestionTag('#quiz')).toBe(false);
        expect(isQuestionTag('faq')).toBe(false);
        expect(isQuestionTag('quality')).toBe(false);
        expect(isQuestionTag(['math', 'quiz'])).toBe(false);
        expect(isQuestionTag('q/sub')).toBe(false);
    });

    it('handles null, undefined, empty inputs safely', () => {
        expect(isQuestionTag(null)).toBe(false);
        expect(isQuestionTag(undefined)).toBe(false);
        expect(isQuestionTag([])).toBe(false);
        expect(isQuestionTag('')).toBe(false);
    });
});
