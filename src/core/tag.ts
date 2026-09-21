/**
 * Pure helper module for question tag recognition.
 */

/**
 * Checks whether the given frontmatter tag or tags contain an exact 'q' tag.
 * Normalizes strings by trimming whitespace and stripping a single leading '#'.
 * Partial matches like 'quiz', 'faq', or 'quality' are NOT recognized.
 */
export function isQuestionTag(tags: unknown): boolean {
    if (!tags) return false;

    const tagList: string[] = Array.isArray(tags)
        ? tags.map(t => String(t ?? ''))
        : [String(tags)];

    return tagList.some(tag => normalizeTag(tag) === 'q');
}

/**
 * Normalizes a tag string by trimming whitespace and stripping a leading '#' if present.
 */
export function normalizeTag(tag: string): string {
    let t = tag.trim();
    if (t.startsWith('#')) {
        t = t.slice(1).trim();
    }
    return t;
}
