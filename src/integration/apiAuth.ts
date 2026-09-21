/**
 * Builds the optional bearer-auth header for an OpenAI-compatible endpoint.
 * The token is intentionally never logged or included in grading/history data.
 */
export function buildBearerAuthHeaders(apiToken: string): Record<string, string> {
    const token = apiToken.trim();
    return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Normalizes an OpenAI-compatible endpoint URL.
 * Automatically appends '/chat/completions' (or '/v1/chat/completions')
 * if the user configured a base URL (such as https://api.deepseek.com or https://api.openai.com/v1).
 */
export function normalizeChatCompletionsEndpoint(rawEndpoint: string): string {
    const trimmed = (rawEndpoint || '').trim().replace(/\/+$/, '');
    if (!trimmed) return trimmed;
    if (trimmed.endsWith('/chat/completions')) {
        return trimmed;
    }
    if (trimmed.endsWith('/v1')) {
        return `${trimmed}/chat/completions`;
    }
    if (trimmed.includes('api.openai.com')) {
        return `${trimmed}/v1/chat/completions`;
    }
    return `${trimmed}/chat/completions`;
}

