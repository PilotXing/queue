import { describe, it, expect } from 'vitest';
import { sanitizeCategoryFilename, getAutosaveFilePath } from '../src/core/filename';

describe('sanitizeCategoryFilename', () => {
    it('preserves Chinese and Unicode characters', () => {
        expect(sanitizeCategoryFilename('发动机')).toBe('发动机');
        expect(sanitizeCategoryFilename('航空法')).toBe('航空法');
        expect(sanitizeCategoryFilename('Aviation 航空')).toMatch(/^Aviation_航空_[a-z0-9]+$/);
    });

    it('replaces path-unsafe characters and converts whitespace to underscores', () => {
        const safe = sanitizeCategoryFilename('Math / Physics: 101');
        expect(safe).toContain('Math___Physics__101');
        // Contains deterministic collision hash because it had unsafe chars / and :
        expect(safe).toMatch(/^Math___Physics__101_[a-z0-9]+$/);
    });

    it('prevents collision between categories that sanitize to the same base name', () => {
        const name1 = sanitizeCategoryFilename('A/B');
        const name2 = sanitizeCategoryFilename('A_B');
        expect(name1).not.toBe(name2);
        expect(sanitizeCategoryFilename('A B')).not.toBe(name2);
        expect(sanitizeCategoryFilename('Math')).not.toBe(sanitizeCategoryFilename('math'));
    });

    it('handles empty, blank, or null category gracefully', () => {
        expect(sanitizeCategoryFilename('')).toBe('uncategorized');
        expect(sanitizeCategoryFilename('   ')).toBe('uncategorized');
        expect(sanitizeCategoryFilename(null as any)).toBe('uncategorized');
    });

    it('generates correct autosave file path', () => {
        expect(getAutosaveFilePath('发动机')).toBe('Practice_Sessions/autosave_发动机.md');
    });
});
