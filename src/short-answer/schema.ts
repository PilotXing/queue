/**
 * Pure parser, validator, and renderer for versioned short-answer Markdown documents.
 * 
 * Requirements:
 * - Versioned schema: queue_schema: 1, permanent queue_id, type short-answer,
 *   category, exact q tag, optional source citation, current serialized QueueFsrsStateV1,
 *   optional generated rubric metadata.
 * - Stable visible sections:
 *   # Question
 *   # Reference Answer
 *   # Source (optional)
 *   # Human Grading Notes (optional)
 *   # Generated Rubric (optional)
 *   Followed by append-only fenced queue-history JSONL block at the end.
 * - Reference answer is required for automatic AI grading; missing reference answer is valid only for manual self-assessment.
 * - Preserve multiline Markdown, Unicode, lists, quotes, symbols, pipes, and embedded ordinary code fences.
 * - Parse/validate/render deterministically.
 * - Schema upgrades must fail explicitly for unsupported versions rather than silently rewrite.
 */

import {
    SerializedQueueFsrsStateV1,
    deserializeQueueFsrsState,
    serializeQueueFsrsState
} from '../fsrs/adapter';
import {
    ShortAnswerCard,
    ShortAnswerDiagnostic,
    ShortAnswerFrontmatter,
    ShortAnswerHistoryEvent,
    ShortAnswerRubricMetadata,
    QUEUE_SHORT_ANSWER_SCHEMA_VERSION
} from './types';
import {
    detectNewline,
    appendHistoryEvent,
    parseHistoryBlock,
    renderHistoryBlock
} from './history';

export interface ParseCardResult {
    card?: ShortAnswerCard;
    diagnostics: ShortAnswerDiagnostic[];
    isValid: boolean;
}

/**
 * Parses simple YAML-like frontmatter without external dependencies.
 * Handles top-level keys, nested simple objects (like fsrs and rubric), and string arrays (tags).
 */
export function parseFrontmatterYaml(yamlText: string): Record<string, unknown> {
    const lines = yamlText.split(/\r?\n/);
    const result: Record<string, unknown> = {};

    let currentObjKey: string | null = null;
    let currentObj: Record<string, unknown> | null = null;
    let currentArrayKey: string | null = null;
    let currentArray: unknown[] | null = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        // Check array item indented: '  - value'
        const arrayItemMatch = line.match(/^[ \t]+-[ \t]+(.*)$/);
        if (arrayItemMatch && currentArrayKey && currentArray) {
            currentArray.push(parseYamlValue(arrayItemMatch[1]));
            continue;
        }

        // Check nested key indented: '  key: value'
        const nestedMatch = line.match(/^[ \t]+([a-zA-Z0-9_-]+):(?:[ \t]+(.*))?$/);
        if (nestedMatch && currentObjKey && currentObj) {
            const nKey = nestedMatch[1];
            const nValRaw = nestedMatch[2];
            if (nValRaw === undefined || nValRaw.trim() === '') {
                // Nested object or start of nested array?
                currentObj[nKey] = {};
            } else {
                currentObj[nKey] = parseYamlValue(nValRaw);
            }
            continue;
        }

        // Top level key: 'key: value' or 'key:'
        const topMatch = line.match(/^([a-zA-Z0-9_-]+):(?:[ \t]+(.*))?$/);
        if (topMatch) {
            const key = topMatch[1];
            const valRaw = topMatch[2];

            // Reset current contexts
            currentObjKey = null;
            currentObj = null;
            currentArrayKey = null;
            currentArray = null;

            if (valRaw === undefined || valRaw.trim() === '') {
                // Could be start of object or array
                // Lookahead next non-empty line
                let isArray = false;
                for (let j = i + 1; j < lines.length; j++) {
                    const nextTrim = lines[j].trim();
                    if (!nextTrim || nextTrim.startsWith('#')) continue;
                    if (lines[j].match(/^[ \t]+-[ \t]+/)) {
                        isArray = true;
                    }
                    break;
                }

                if (isArray) {
                    currentArrayKey = key;
                    currentArray = [];
                    result[key] = currentArray;
                } else {
                    currentObjKey = key;
                    currentObj = {};
                    result[key] = currentObj;
                }
            } else {
                // If it starts with [ ... ], parse as inline JSON array
                const trimmedVal = valRaw.trim();
                if (trimmedVal.startsWith('[') && trimmedVal.endsWith(']')) {
                    try {
                        result[key] = JSON.parse(trimmedVal);
                    } catch {
                        result[key] = trimmedVal;
                    }
                } else if (trimmedVal.startsWith('{') && trimmedVal.endsWith('}')) {
                    try {
                        result[key] = JSON.parse(trimmedVal);
                    } catch {
                        result[key] = trimmedVal;
                    }
                } else {
                    result[key] = parseYamlValue(trimmedVal);
                }
            }
        }
    }

    return result;
}

function parseYamlValue(val: string): unknown {
    const v = val.trim();
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (v === 'null' || v === '~') return null;
    if (/^-?\d+$/.test(v)) return parseInt(v, 10);
    if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);
    if ((v.startsWith('[') && v.endsWith(']')) || (v.startsWith('{') && v.endsWith('}'))) {
        try {
            return JSON.parse(v);
        } catch {
            return v;
        }
    }
    if (v.startsWith('"') && v.endsWith('"')) {
        try {
            return JSON.parse(v);
        } catch {
            return v.slice(1, -1);
        }
    }
    if (v.startsWith("'") && v.endsWith("'")) {
        return v.slice(1, -1).replace(/''/g, "'");
    }
    return v;
}

/**
 * Formats a plain JavaScript object or primitive into clean YAML lines.
 */
export function formatYaml(obj: Record<string, unknown>, indent = 0): string {
    const spaces = ' '.repeat(indent);
    const lines: string[] = [];

    for (const [key, value] of Object.entries(obj)) {
        if (value === undefined) continue;

        if (value === null) {
            lines.push(`${spaces}${key}: null`);
        } else if (typeof value === 'boolean' || typeof value === 'number') {
            lines.push(`${spaces}${key}: ${value}`);
        } else if (typeof value === 'string') {
            lines.push(`${spaces}${key}: ${formatYamlString(value)}`);
        } else if (Array.isArray(value)) {
            // Inline JSON arrays are valid YAML and keep nested rubric arrays
            // within this deliberately small parser's supported subset.
            lines.push(`${spaces}${key}: ${JSON.stringify(value)}`);
        } else if (typeof value === 'object') {
            lines.push(`${spaces}${key}:`);
            lines.push(formatYaml(value as Record<string, unknown>, indent + 2));
        }
    }

    return lines.join('\n');
}

function formatYamlString(str: string): string {
    if (/[\n\r:#\[\]\{\},'"`]/.test(str) || str.trim() !== str || str === '') {
        return JSON.stringify(str);
    }
    return str;
}

/**
 * Extracts YAML frontmatter and body from a Markdown document.
 */
export function extractFrontmatterAndBody(markdown: string): {
    rawYaml: string | null;
    body: string;
} {
    const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n([\s\S]*)$/.exec(markdown);
    if (!match) {
        return { rawYaml: null, body: markdown };
    }
    return {
        rawYaml: match[1],
        body: match[2]
    };
}

/**
 * Parses markdown body sections divided by top-level headers (# Header).
 * Ignores # headers that are inside ordinary code fences (```).
 */
export function parseBodySections(body: string): Record<string, string> {
    const sections: Record<string, string[]> = {};
    const lines = body.split(/\r?\n/);

    let currentSection: string | null = null;
    let inCodeFence = false;
    const knownSections = new Set([
        'Question',
        'Reference Answer',
        'Source',
        'Human Grading Notes',
        'Generated Rubric'
    ]);

    for (const line of lines) {
        if (/^```/.test(line)) {
            inCodeFence = !inCodeFence;
        }

        if (!inCodeFence) {
            const headerMatch = /^# +([^\r\n#]+)$/.exec(line);
            if (headerMatch && knownSections.has(headerMatch[1].trim())) {
                currentSection = headerMatch[1].trim();
                if (!sections[currentSection]) {
                    sections[currentSection] = [];
                }
                continue;
            }
        }

        if (currentSection) {
            sections[currentSection].push(line);
        }
    }

    const result: Record<string, string> = {};
    for (const [key, valLines] of Object.entries(sections)) {
        result[key] = valLines.join('\n').trim();
    }
    return result;
}

/**
 * Parses, validates, and builds a ShortAnswerCard from raw Markdown text.
 */
export function parseShortAnswerCard(markdown: string): ParseCardResult {
    const diagnostics: ShortAnswerDiagnostic[] = [];

    // 1. Separate queue-history block from end of file
    const historyResult = parseHistoryBlock(markdown);
    diagnostics.push(...historyResult.diagnostics);

    // 2. Extract YAML frontmatter
    const { rawYaml, body } = extractFrontmatterAndBody(historyResult.contentWithoutBlock);

    if (!rawYaml) {
        diagnostics.push({
            code: 'MISSING_FRONTMATTER',
            message: 'Question file must start with YAML frontmatter bounded by ---',
            severity: 'error'
        });
        return { diagnostics, isValid: false };
    }

    const rawFm = parseFrontmatterYaml(rawYaml);

    // Validate schema version
    const schemaVersion = rawFm.queue_schema;
    if (schemaVersion === undefined || schemaVersion === null) {
        diagnostics.push({
            code: 'MISSING_SCHEMA_VERSION',
            message: 'Frontmatter missing queue_schema version',
            severity: 'error'
        });
    } else if (schemaVersion !== QUEUE_SHORT_ANSWER_SCHEMA_VERSION) {
        diagnostics.push({
            code: 'UNSUPPORTED_SCHEMA_VERSION',
            message: `Unsupported queue_schema version: ${schemaVersion}. Expected ${QUEUE_SHORT_ANSWER_SCHEMA_VERSION}`,
            severity: 'error',
            context: schemaVersion
        });
        return { diagnostics, isValid: false };
    }

    // Validate type
    if (rawFm.type !== 'short-answer') {
        diagnostics.push({
            code: 'INVALID_TYPE',
            message: `Expected type "short-answer", got "${rawFm.type}"`,
            severity: 'error'
        });
    }

    // Validate queue_id
    if (!rawFm.queue_id || typeof rawFm.queue_id !== 'string') {
        diagnostics.push({
            code: 'MISSING_QUEUE_ID',
            message: 'Question card requires a permanent string queue_id',
            severity: 'error'
        });
    }

    // Validate category
    if (!rawFm.category || typeof rawFm.category !== 'string') {
        diagnostics.push({
            code: 'MISSING_CATEGORY',
            message: 'Question card requires a string category',
            severity: 'warning'
        });
    }

    // Validate tags: must contain exact 'q'
    let tags: string[] = [];
    if (Array.isArray(rawFm.tags)) {
        tags = rawFm.tags.map(t => String(t));
    } else if (typeof rawFm.tags === 'string') {
        tags = [rawFm.tags];
    }

    const hasExactQ = tags.some(t => {
        let tagStr = t.trim();
        if (tagStr.startsWith('#')) tagStr = tagStr.slice(1).trim();
        return tagStr === 'q';
    });

    if (!hasExactQ) {
        diagnostics.push({
            code: 'MISSING_Q_TAG',
            message: 'Question card frontmatter must include the exact tag "q"',
            severity: 'warning'
        });
    }

    // Parse FSRS state
    let fsrsState: SerializedQueueFsrsStateV1;
    if (rawFm.fsrs && typeof rawFm.fsrs === 'object') {
        fsrsState = serializeQueueFsrsState(deserializeQueueFsrsState(rawFm.fsrs));
    } else {
        diagnostics.push({
            code: 'MISSING_FSRS_STATE',
            message: 'Question card missing fsrs frontmatter; initialized default state',
            severity: 'warning'
        });
        const fresh = deserializeQueueFsrsState(null);
        fsrsState = serializeQueueFsrsState(fresh);
    }

    // Parse sections
    const sections = parseBodySections(body);

    const question = sections['Question'] || '';
    if (!question) {
        diagnostics.push({
            code: 'MISSING_QUESTION_SECTION',
            message: 'Card body must contain a "# Question" section with non-empty text',
            severity: 'error'
        });
    }

    const referenceAnswer = sections['Reference Answer'];
    const source = sections['Source'] || (typeof rawFm.source === 'string' ? rawFm.source : undefined);
    const humanGradingNotes = sections['Human Grading Notes'];
    const generatedRubric = sections['Generated Rubric'];

    const rubricMeta = (rawFm.rubric && typeof rawFm.rubric === 'object')
        ? (rawFm.rubric as ShortAnswerRubricMetadata)
        : undefined;

    const frontmatter: ShortAnswerFrontmatter = {
        ...rawFm,
        queue_schema: QUEUE_SHORT_ANSWER_SCHEMA_VERSION,
        queue_id: String(rawFm.queue_id || ''),
        type: 'short-answer',
        category: String(rawFm.category || 'Uncategorized'),
        tags,
        source,
        fsrs: fsrsState,
        rubric: rubricMeta
    };

    const hasErrors = diagnostics.some(d => d.severity === 'error');

    return {
        card: {
            frontmatter,
            question,
            referenceAnswer,
            source,
            humanGradingNotes,
            generatedRubric,
            historyEvents: historyResult.events
        },
        diagnostics,
        isValid: !hasErrors
    };
}

/**
 * Deterministically renders a ShortAnswerCard back into a Markdown document string.
 */
export function renderShortAnswerCard(
    card: ShortAnswerCard,
    newline: '\n' | '\r\n' = '\n'
): string {
    const { frontmatter, question, referenceAnswer, source, humanGradingNotes, generatedRubric, historyEvents } = card;

    // Build frontmatter object
    const fmToRender: Record<string, unknown> = {
        ...frontmatter,
        queue_schema: QUEUE_SHORT_ANSWER_SCHEMA_VERSION,
        queue_id: frontmatter.queue_id,
        type: 'short-answer',
        category: frontmatter.category,
        tags: frontmatter.tags
    };

    if (source) {
        fmToRender.source = source;
    }
    if (frontmatter.fsrs) {
        fmToRender.fsrs = frontmatter.fsrs;
    }
    if (frontmatter.rubric) {
        fmToRender.rubric = frontmatter.rubric;
    }

    const yamlStr = formatYaml(fmToRender);

    // Build body sections
    const parts: string[] = [];
    parts.push(`---${newline}${yamlStr}${newline}---`);

    parts.push(`# Question${newline}${question}`);

    if (referenceAnswer !== undefined && referenceAnswer !== null && referenceAnswer.trim() !== '') {
        parts.push(`# Reference Answer${newline}${referenceAnswer}`);
    }

    if (source && source.trim() !== '') {
        parts.push(`# Source${newline}${source}`);
    }

    if (humanGradingNotes && humanGradingNotes.trim() !== '') {
        parts.push(`# Human Grading Notes${newline}${humanGradingNotes}`);
    }

    if (generatedRubric && generatedRubric.trim() !== '') {
        parts.push(`# Generated Rubric${newline}${generatedRubric}`);
    }

    let doc = parts.join(`${newline}${newline}`);

    // Append history block if any events exist
    if (historyEvents && historyEvents.length > 0) {
        const histBlock = renderHistoryBlock(historyEvents, newline);
        doc = `${doc}${newline}${newline}${histBlock}`;
    }

    return `${doc}${newline}`;
}

function upsertTopLevelFrontmatterValue(markdown: string, key: string, value: unknown): string {
    const newline = detectNewline(markdown);
    const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown);
    if (!match) throw new Error('Short-answer document is missing YAML frontmatter.');

    const lines = match[1].split(/\r?\n/);
    const keyPattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(?:[ \\t]+.*)?$`);
    const index = lines.findIndex(line => keyPattern.test(line));
    const replacement = `${key}: ${JSON.stringify(value)}`;
    if (index < 0) {
        lines.push(replacement);
    } else {
        let end = index + 1;
        const existingHasInlineValue = lines[index].slice(lines[index].indexOf(':') + 1).trim().length > 0;
        if (!existingHasInlineValue) {
            while (end < lines.length && (/^[ \t]+\S/.test(lines[end]) || !lines[end].trim())) end++;
        }
        lines.splice(index, end - index, replacement);
    }

    const rebuiltFrontmatter = `---${newline}${lines.join(newline)}${newline}---${newline}`;
    return rebuiltFrontmatter + markdown.slice(match[0].length);
}

/**
 * Applies one authoritative short-answer review in a single document transform.
 * The visible body is preserved byte-for-byte; only the cached frontmatter values
 * and append-only history block change. Duplicate review IDs remain idempotent.
 */
export function updateShortAnswerReviewDocument(
    markdown: string,
    fsrs: SerializedQueueFsrsStateV1,
    familiarity: number,
    event: ShortAnswerHistoryEvent
): { content: string; appended: boolean; diagnostics: ShortAnswerDiagnostic[] } {
    const history = appendHistoryEvent(markdown, event);
    if (!history.appended) {
        return {
            content: markdown,
            appended: false,
            diagnostics: history.diagnostics
        };
    }
    let content = upsertTopLevelFrontmatterValue(history.content, 'fsrs', fsrs);
    content = upsertTopLevelFrontmatterValue(content, 'familiarity', familiarity);
    return {
        content,
        appended: true,
        diagnostics: history.diagnostics
    };
}
