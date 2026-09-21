import { describe, expect, it } from 'vitest';
import {
    extractStructuredGradingOutput,
    extractStructuredRubricOutput
} from '../src/short-answer/grading';
import { buildBearerAuthHeaders, normalizeChatCompletionsEndpoint } from '../src/integration/apiAuth';

describe('local proxy grading response extraction', () => {
    it('builds bearer authentication only when a token is configured', () => {
        expect(buildBearerAuthHeaders(' secret-token ')).toEqual({
            Authorization: 'Bearer secret-token'
        });
        expect(buildBearerAuthHeaders('   ')).toEqual({});
    });

    it('accepts direct structured payloads', () => {
        expect(extractStructuredGradingOutput({ score: 1, confidence: 1 }).score).toBe(1);
    });

    it('extracts JSON from OpenAI-compatible fenced content', () => {
        const result = extractStructuredGradingOutput({
            choices: [{ message: { content: '```json\n{"score":0.8,"confidence":0.9}\n```' } }]
        });
        expect(result.score).toBe(0.8);
    });

    it('rejects responses without structured content', () => {
        expect(() => extractStructuredGradingOutput({ choices: [] })).toThrow('structured JSON');
    });

    it('extracts OpenAI-compatible rubric JSON', () => {
        const result = extractStructuredRubricOutput({
            choices: [{ message: { content: '{"requiredPoints":["A"],"optionalPoints":[]}' } }]
        });
        expect(result.requiredPoints).toEqual(['A']);
    });
});

describe('normalizeChatCompletionsEndpoint', () => {
    it('normalizes base URLs without /chat/completions', () => {
        expect(normalizeChatCompletionsEndpoint('https://api.deepseek.com')).toBe('https://api.deepseek.com/chat/completions');
        expect(normalizeChatCompletionsEndpoint('https://api.deepseek.com/')).toBe('https://api.deepseek.com/chat/completions');
        expect(normalizeChatCompletionsEndpoint('https://api.deepseek.com/v1')).toBe('https://api.deepseek.com/v1/chat/completions');
        expect(normalizeChatCompletionsEndpoint('https://api.deepseek.com/chat/completions')).toBe('https://api.deepseek.com/chat/completions');
    });

    it('handles openai and local endpoints appropriately', () => {
        expect(normalizeChatCompletionsEndpoint('https://api.openai.com')).toBe('https://api.openai.com/v1/chat/completions');
        expect(normalizeChatCompletionsEndpoint('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/chat/completions');
        expect(normalizeChatCompletionsEndpoint('http://127.0.0.1:11434/v1')).toBe('http://127.0.0.1:11434/v1/chat/completions');
        expect(normalizeChatCompletionsEndpoint('http://127.0.0.1:11434/v1/chat/completions')).toBe('http://127.0.0.1:11434/v1/chat/completions');
    });

    it('handles empty or whitespace strings', () => {
        expect(normalizeChatCompletionsEndpoint('')).toBe('');
        expect(normalizeChatCompletionsEndpoint('   ')).toBe('');
    });
});
