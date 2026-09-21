import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseShortAnswerCard } from '../src/short-answer/schema';

describe('Aviation Generated Flashcards Validation', () => {
    const cardsDir = path.resolve(__dirname, '../cards/aviation');

    it('should have generated all 373 markdown flashcards', () => {
        expect(fs.existsSync(cardsDir)).toBe(true);
        const files = fs.readdirSync(cardsDir).filter(f => f.endsWith('.md'));
        expect(files.length).toBe(373);
    });

    it('should validate all 373 cards against Queue ShortAnswerCard schema with 0 errors', () => {
        const files = fs.readdirSync(cardsDir).filter(f => f.endsWith('.md'));
        let totalErrors = 0;
        const failedCards: string[] = [];

        for (const file of files) {
            const filePath = path.join(cardsDir, file);
            const content = fs.readFileSync(filePath, 'utf8');
            const result = parseShortAnswerCard(content);

            if (!result.isValid) {
                totalErrors++;
                failedCards.push(file);
            }
            expect(result.isValid).toBe(true);
            expect(result.card).toBeDefined();
            expect(result.card?.frontmatter.type).toBe('short-answer');
            expect(result.card?.frontmatter.tags).toContain('q');
            expect(result.card?.frontmatter.tags).toContain('aviation');
            expect(result.card?.question.trim().length).toBeGreaterThan(0);
            expect(result.card?.referenceAnswer?.trim().length).toBeGreaterThan(0);
        }

        expect(totalErrors).toBe(0);
    });

    it('should have extracted all 9 diagram images for marshalling signals', () => {
        const assetsDir = path.join(cardsDir, 'assets');
        expect(fs.existsSync(assetsDir)).toBe(true);
        const images = fs.readdirSync(assetsDir).filter(f => f.endsWith('.jpg'));
        expect(images.length).toBe(9);
    });
});
