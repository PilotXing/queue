/**
 * Pure parser and dry-run migration model for legacy Aviation_QA markdown files.
 *
 * Observed format:
 * - Preamble with `#flashcards/aviation`
 * - Individual cards separated by `---`
 * - First line of card: `**[91.16.17]** question text`
 * - Optional source citation blockquote: `> *来源: ...*`
 * - Separator line: `?`
 * - Multiline reference answer
 * - Optional Obsidian Spaced Repetition comment: `<!--SR:!2025-09-01,1,250-->`
 *
 * Requirements:
 * - Ignore old SR scheduling fields, but detect/report orphaned/malformed comments.
 * - Return parsed cards + diagnostics without mutating input.
 * - Detect missing answers, suspiciously short (< 3 chars) or truncated answers.
 * - Detect duplicate IDs, duplicate normalized questions, malformed separators, and collisions.
 * - Produce collision-safe `queue_id` and proposed output filename/path for every valid card.
 * - Preserve question/reference/source text byte-for-byte except unavoidable delimiter trimming.
 * - Provide a renderer to Queue's schema, with NO filesystem writes.
 */

import { ShortAnswerCard, ShortAnswerDiagnostic } from './types';
import { renderShortAnswerCard } from './schema';
import { createNewQueueFsrsState, serializeQueueFsrsState } from '../fsrs/adapter';

export interface LegacyAviationCard {
    rawIndex: number;
    rawId?: string;
    proposedQueueId: string;
    proposedFilename: string;
    proposedPath: string;
    question: string;
    referenceAnswer: string;
    sourceCitation?: string;
    category: string;
    orphanedSrComment?: string;
    isSuspiciouslyShortAnswer: boolean;
}

export interface AviationMigrationReport {
    totalCardsFound: number;
    validCards: LegacyAviationCard[];
    diagnostics: ShortAnswerDiagnostic[];
    duplicateIds: string[];
    duplicateQuestions: string[];
}

/**
 * Normalizes question text for duplicate detection (strips card ID prefix, punctuation, whitespace, lowercases).
 */
export function normalizeQuestionText(q: string): string {
    const withoutId = q.replace(/^(\*\*\[[a-zA-Z0-9_.\-]+\]\*\*|\[[a-zA-Z0-9_.\-]+\])\s*/, '');
    return withoutId
        .toLowerCase()
        .replace(/[\s\p{P}\p{S}]+/gu, '')
        .trim();
}

/**
 * Parses raw Aviation_QA.md content into cards and dry-run migration report.
 */
export function parseAviationQA(
    sourceText: string,
    defaultCategory: string = 'Aviation',
    outputFolder: string = 'Queue_Cards/Aviation'
): AviationMigrationReport {
    const diagnostics: ShortAnswerDiagnostic[] = [];
    const validCards: LegacyAviationCard[] = [];

    // Split on card delimiter `---` lines
    // Note: preamble might be before the first `---` or cards begin after
    const rawChunks = sourceText.split(/(?:\r?\n|^)---[ \t]*(?:\r?\n|$)/);

    const seenIds = new Map<string, number>(); // id -> count
    const seenNormalizedQuestions = new Map<string, number>(); // normalized -> count
    const idCountMap = new Map<string, number>(); // for collision resolution

    let cardIndex = 0;

    for (let c = 0; c < rawChunks.length; c++) {
        const chunk = rawChunks[c];
        const trimmed = chunk.trim();
        if (!trimmed) continue;

        // A source file may contain more than one deck preamble. They are not cards.
        if (!/(?:\r?\n|^)[ \t]*\?[ \t]*(?:\r?\n|$)/.test(chunk) && /^#flashcards\//m.test(trimmed)) {
            continue;
        }

        cardIndex++;

        // Check for ? separator
        // Must be a line with exactly '?' (surrounded by optional whitespace)
        const qmarkRegex = /(?:\r?\n|^)[ \t]*\?[ \t]*(?:\r?\n|$)/;
        const qmarkMatch = qmarkRegex.exec(chunk);

        if (!qmarkMatch) {
            // Check if there is an orphaned SR comment or if question/answer separator is missing
            const srMatch = /<!--SR:!?[^>]+-->/.exec(chunk);
            diagnostics.push({
                code: 'MISSING_ANSWER_SEPARATOR',
                message: `Card ${cardIndex}: Missing '?' separator between question and answer`,
                severity: 'error',
                location: `chunk #${c + 1}`,
                context: chunk.slice(0, 80)
            });
            if (srMatch) {
                diagnostics.push({
                    code: 'ORPHANED_SR_COMMENT',
                    message: `Card ${cardIndex}: Contains orphaned SR comment without question separator`,
                    severity: 'warning',
                    context: srMatch[0]
                });
            }
            continue;
        }

        const questionPart = chunk.slice(0, qmarkMatch.index).trim();
        let answerPart = chunk.slice(qmarkMatch.index + qmarkMatch[0].length).trim();

        // Check for and strip SR comment: <!--SR:!2025-09-01,1,250-->
        let srComment: string | undefined;
        const srCommentRegex = /<!--SR:!?[^>]+-->/;
        const srMatch = srCommentRegex.exec(answerPart);
        if (srMatch) {
            srComment = srMatch[0];
            answerPart = answerPart.replace(srCommentRegex, '').trim();
        }

        // Check for malformed SR comments in question or answer
        const malformedSrRegex = /<!--SR:[^>]*$/;
        if (malformedSrRegex.test(chunk)) {
            diagnostics.push({
                code: 'MALFORMED_SR_COMMENT',
                message: `Card ${cardIndex}: Contains unclosed or malformed SR comment`,
                severity: 'warning',
                location: `chunk #${c + 1}`
            });
        }

        // Extract ID and Source from questionPart
        // Expected format: **[91.16.17]** Question text...
        // and optionally a blockquote: > *来源: ...* or similar
        const qLines = questionPart.split(/\r?\n/);
        let rawId: string | undefined;
        let sourceCitation: string | undefined;
        const cleanQLines: string[] = [];

        for (const line of qLines) {
            const lineTrim = line.trim();
            // Check source citation line
            if (lineTrim.startsWith('>') && /来源/i.test(lineTrim)) {
                // e.g. > *来源: CCAR-91-R2 91.16*
                sourceCitation = lineTrim.replace(/^>[ \t]*/, '').trim();
                continue;
            }

            // Extract ID: **[91.16.17]** or [91.16.17]
            if (!rawId) {
                const idMatch = /\*\*\[([a-zA-Z0-9_.\-]+)\]\*\*/.exec(lineTrim) || /\[([a-zA-Z0-9_.\-]+)\]/.exec(lineTrim);
                if (idMatch) {
                    rawId = idMatch[1];
                }
            }

            cleanQLines.push(line);
        }

        const questionText = cleanQLines.join('\n').trim();
        const referenceAnswer = answerPart.trim();

        if (!questionText) {
            diagnostics.push({
                code: 'EMPTY_QUESTION',
                message: `Card ${cardIndex}: Question text is empty`,
                severity: 'error'
            });
            continue;
        }

        if (!referenceAnswer) {
            diagnostics.push({
                code: 'MISSING_ANSWER',
                message: `Card ${cardIndex}: Reference answer is empty; automatic AI grading will be disabled until one is added`,
                severity: 'warning',
                context: questionText.slice(0, 60)
            });
        }

        const isSuspiciouslyShortAnswer = referenceAnswer.length > 0 && referenceAnswer.length < 3;
        if (isSuspiciouslyShortAnswer) {
            diagnostics.push({
                code: 'SUSPICIOUSLY_SHORT_ANSWER',
                message: `Card ${cardIndex}: Reference answer is suspiciously short ("${referenceAnswer}")`,
                severity: 'warning',
                context: referenceAnswer
            });
        }

        // Duplicate tracking
        if (rawId) {
            seenIds.set(rawId, (seenIds.get(rawId) || 0) + 1);
        }

        const normQ = normalizeQuestionText(questionText);
        seenNormalizedQuestions.set(normQ, (seenNormalizedQuestions.get(normQ) || 0) + 1);

        // Generate collision-safe queue_id
        const baseId = rawId ? `aviation_${rawId}` : `aviation_card_${cardIndex}`;
        const count = (idCountMap.get(baseId) || 0) + 1;
        idCountMap.set(baseId, count);

        const proposedQueueId = count > 1 ? `${baseId}_dup${count}` : baseId;

        // Generate safe filename and path
        const rawName = rawId ? `aviation_${rawId}` : `aviation_q${cardIndex}`;
        const safeBaseName = rawName.normalize('NFC').replace(/[\/\\:*?"<>| \t]+/g, '_').replace(/^[\._]+|[\._]+$/g, '');
        const filename = count > 1 ? `${safeBaseName}_${count}.md` : `${safeBaseName}.md`;
        const path = `${outputFolder.replace(/\/+$/, '')}/${filename}`;

        validCards.push({
            rawIndex: cardIndex,
            rawId,
            proposedQueueId,
            proposedFilename: filename,
            proposedPath: path,
            question: questionText,
            referenceAnswer,
            sourceCitation,
            category: defaultCategory,
            orphanedSrComment: srComment,
            isSuspiciouslyShortAnswer
        });
    }

    const duplicateIds = Array.from(seenIds.entries())
        .filter(([_, count]) => count > 1)
        .map(([id]) => id);

    const duplicateQuestions = Array.from(seenNormalizedQuestions.entries())
        .filter(([_, count]) => count > 1)
        .map(([normQ]) => normQ);

    for (const dupId of duplicateIds) {
        diagnostics.push({
            code: 'DUPLICATE_ID',
            message: `Found duplicate card ID in source: "${dupId}"`,
            severity: 'warning',
            context: dupId
        });
    }

    for (const dupQ of duplicateQuestions) {
        diagnostics.push({
            code: 'DUPLICATE_QUESTION',
            message: `Found duplicate question content across cards (normalized: "${dupQ.slice(0, 30)}...")`,
            severity: 'warning',
            context: dupQ
        });
    }

    return {
        totalCardsFound: cardIndex,
        validCards,
        diagnostics,
        duplicateIds,
        duplicateQuestions
    };
}

/**
 * Converts a parsed legacy Aviation card to a new ShortAnswerCard and renders its Markdown.
 * Pure in-memory rendering: performs NO filesystem writes.
 */
export function renderMigratedCard(
    card: LegacyAviationCard,
    now: Date = new Date(),
    newline: '\n' | '\r\n' = '\n'
): string {
    const freshFsrs = serializeQueueFsrsState(createNewQueueFsrsState(now));

    const domainCard: ShortAnswerCard = {
        frontmatter: {
            queue_schema: 1,
            queue_id: card.proposedQueueId,
            type: 'short-answer',
            category: card.category,
            tags: ['q', 'aviation'],
            source: card.sourceCitation,
            fsrs: freshFsrs
        },
        question: card.question,
        referenceAnswer: card.referenceAnswer,
        source: card.sourceCitation,
        historyEvents: []
    };

    return renderShortAnswerCard(domainCard, newline);
}
