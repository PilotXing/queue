import { describe, it, expect } from 'vitest';
import {
    parseAviationQA,
    renderMigratedCard
} from '../src/short-answer/migration';
import { parseShortAnswerCard } from '../src/short-answer/schema';

describe('Short-Answer Aviation Migration Module', () => {
    const sampleAviationDeck = `#flashcards/aviation

**[91.16.17]** 航空器在结冰条件下起飞有什么规定？
> *来源: CCAR-91-R2 91.16*
?
除非航空器按照批准的程序进行除冰或防冰，且机翼、控制面等关键表面没有霜、冰或雪粘附，否则不得起飞。
<!--SR:!2025-09-01,1,250-->
---
**[91.16.18]** 简述V1决策速度的定义。
> *来源: CCAR-25*
?
在起飞滑跑过程中发生关键发动机故障时，驾驶员决定继续起飞或中断起飞的速度。
<!--SR:!2025-09-02,2,260-->
---
**[91.16.19]** 包含多行和列表的答案。
?
要求包括：
1. 燃油储备不少于45分钟。
2. 备降机场天气符合要求。
3. 检查放行单。
---
**[91.16.17]** 这是具有重复ID的卡片。
?
重复ID的答案内容。
---
这是没有问号分隔符的问题
---
**[91.16.20]** 答案极短的问题。
?
无
`;

    it('parses source cards, extracts IDs, sources, questions, and answers without mutating input', () => {
        const report = parseAviationQA(sampleAviationDeck);
        expect(report.totalCardsFound).toBe(6);
        expect(report.validCards.length).toBe(5); // 5 cards have valid '?' separator; card 5 has missing '?' and is invalid

        const card1 = report.validCards[0];
        expect(card1.rawId).toBe('91.16.17');
        expect(card1.proposedQueueId).toBe('aviation_91.16.17');
        expect(card1.sourceCitation).toBe('*来源: CCAR-91-R2 91.16*');
        expect(card1.question).toContain('航空器在结冰条件下起飞有什么规定？');
        expect(card1.referenceAnswer).toContain('除非航空器按照批准的程序进行除冰或防冰');
        expect(card1.orphanedSrComment).toBe('<!--SR:!2025-09-01,1,250-->');
        expect(card1.proposedPath).toBe('Queue_Cards/Aviation/aviation_91.16.17.md');
    });

    it('preserves multiline and list answers byte-for-byte', () => {
        const report = parseAviationQA(sampleAviationDeck);
        const listCard = report.validCards.find(c => c.rawId === '91.16.19');
        expect(listCard).toBeDefined();
        expect(listCard?.referenceAnswer).toContain('1. 燃油储备不少于45分钟。\n2. 备降机场天气符合要求。\n3. 检查放行单。');
    });

    it('detects duplicate IDs and generates collision-safe queue IDs and paths', () => {
        const report = parseAviationQA(sampleAviationDeck);
        expect(report.duplicateIds).toContain('91.16.17');

        const card1 = report.validCards.find(c => c.rawIndex === 1);
        const cardDup = report.validCards.find(c => c.rawIndex === 4);

        expect(card1?.proposedQueueId).toBe('aviation_91.16.17');
        expect(cardDup?.proposedQueueId).toBe('aviation_91.16.17_dup2');
        expect(cardDup?.proposedFilename).toContain('_2.md');
    });

    it('detects missing answer separators and suspiciously short answers', () => {
        const report = parseAviationQA(sampleAviationDeck);

        // Missing separator
        const missingSepDiag = report.diagnostics.find(d => d.code === 'MISSING_ANSWER_SEPARATOR');
        expect(missingSepDiag).toBeDefined();

        // Suspiciously short answer ("无")
        const shortAnswerDiag = report.diagnostics.find(d => d.code === 'SUSPICIOUSLY_SHORT_ANSWER');
        expect(shortAnswerDiag).toBeDefined();
        expect(shortAnswerDiag?.context).toBe('无');
    });

    it('detects duplicate normalized questions', () => {
        const duplicateQDeck = `
**[id1]** 什么是失速？
?
机翼升力突然减小。
---
**[id2]** 什么是失速？？？
?
机翼升力突然减小超过临界迎角。
`;
        const report = parseAviationQA(duplicateQDeck);
        expect(report.duplicateQuestions.length).toBe(1);
        expect(report.diagnostics.some(d => d.code === 'DUPLICATE_QUESTION')).toBe(true);
    });

    it('renders valid Queue short-answer Markdown without filesystem writes', () => {
        const report = parseAviationQA(sampleAviationDeck);
        const card = report.validCards[0];

        const renderedMarkdown = renderMigratedCard(card, new Date('2026-09-21T00:00:00Z'));
        expect(renderedMarkdown).toContain('queue_schema: 1');
        expect(renderedMarkdown).toContain('queue_id: aviation_91.16.17');
        expect(renderedMarkdown).toContain('type: short-answer');
        expect(renderedMarkdown).toContain('# Question');
        expect(renderedMarkdown).toContain('# Reference Answer');
        expect(renderedMarkdown).toContain('# Source');

        // Verify the rendered card is immediately valid under Queue schema parser
        const recheck = parseShortAnswerCard(renderedMarkdown);
        expect(recheck.isValid).toBe(true);
        expect(recheck.card?.question).toContain('航空器在结冰条件下起飞有什么规定？');
        expect(recheck.card?.referenceAnswer).toContain('除非航空器按照批准的程序进行除冰或防冰');
    });

    it('handles extra separators and orphan SR comments cleanly', () => {
        const extraSepDeck = `
---
---
**[solo]** 单独的卡片
?
答案
<!--SR:!2025-09-01,1,250-->
---
---
<!--SR:!orphan-->
---
`;
        const report = parseAviationQA(extraSepDeck);
        expect(report.validCards.length).toBe(1);
        expect(report.diagnostics.some(d => d.code === 'ORPHANED_SR_COMMENT')).toBe(true);
    });
});
