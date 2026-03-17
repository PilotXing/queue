import { TFile, TFolder, moment } from 'obsidian';
import { QuestionMeta } from '../types';
import PracticePlugin from '../../main';

export class SessionManager {
    plugin: PracticePlugin;

    currentQueue: QuestionMeta[] = [];
    currentQIndex: number = 0;
    isFinished: boolean = false;
    showingAnswer: boolean = false;
    correctAnswers: number = 0;
    wrongAnswers: number = 0;
    
    filterCategory: string = "All";
    filterFamiliarity: number = 100;
    categories: string[] = ["All"];
    sessionResults: Map<string, 'correct' | 'wrong'> = new Map();
    selectedChoices: Set<string> = new Set();
    activeChoices: { char: string, text: string }[] = [];

    constructor(plugin: PracticePlugin) {
        this.plugin = plugin;
    }

    async loadSessionFromFile(file: TFile) {
        const content = await this.plugin.app.vault.read(file);
        const cache = this.plugin.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter || {};

        this.filterCategory = fm.category || "All";
        this.currentQIndex = fm.currentIndex || 0;
        this.isFinished = fm.isFinished || false;

        this.currentQueue = [];
        const linkRegex = /\[\[(.*?)(?:\|.*?)?\]\]/g;
        let match;
        while ((match = linkRegex.exec(content)) !== null) {
            const path = match[1];
            const qFile = this.plugin.app.vault.getAbstractFileByPath(path);
            if (qFile instanceof TFile) {
                const qCache = this.plugin.app.metadataCache.getFileCache(qFile);
                const qFm = qCache?.frontmatter || {};
                this.currentQueue.push({
                    file: qFile,
                    id: qFm.id || 0,
                    familiarity: qFm.familiarity ?? 50,
                    answer: qFm.answer?.toString() || ''
                });
            }
        }

        if (this.currentQueue.length > 0) {
            await this.saveSession();
            await this.plugin.viewManager.activateView();
            this.plugin.viewManager.refreshAllViews();
        }
    }

    refreshQueue() {
        this.currentQueue = [];
        const files = this.plugin.app.vault.getMarkdownFiles();
        const cats = new Set<string>();

        for (const file of files) {
            const cache = this.plugin.app.metadataCache.getFileCache(file);
            const tags = cache?.frontmatter?.tags || [];
            const tagArray = Array.isArray(tags) ? tags : [tags];

            if (tagArray.some(t => String(t).includes('q'))) {
                const fm = cache!.frontmatter!;
                const category = (fm.category || "Uncategorized").toString().trim();
                cats.add(category);

                const currentFilterCat = this.filterCategory.trim();
                if (currentFilterCat !== "All" && category !== currentFilterCat) continue;

                let fam = fm.familiarity;
                if (fam === undefined || fam === null) fam = 50;
                if (fam > this.filterFamiliarity) continue;

                if (fam < 100) {
                    this.currentQueue.push({
                        file,
                        id: fm.id,
                        familiarity: fam,
                        answer: fm.answer?.toString() || ''
                    });
                }
            }
        }

        this.categories = ["All", ...Array.from(cats).sort()];
        this.currentQueue.sort((a, b) => a.familiarity - b.familiarity);
        this.currentQIndex = 0;
        this.isFinished = false;
        this.showingAnswer = false;
        this.selectedChoices.clear();
        this.saveSession();
        this.plugin.viewManager.refreshAllViews();
    }

    async saveSession() {
        this.plugin.settings.savedQueuePaths = this.currentQueue.map(q => q.file.path);
        this.plugin.settings.savedIndex = this.currentQIndex;
        await this.plugin.saveSettings();
    }

    async restoreSession() {
        const paths = this.plugin.settings.savedQueuePaths || [];
        const index = this.plugin.settings.savedIndex || 0;

        this.currentQueue = [];
        for (const path of paths) {
            const file = this.plugin.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile) {
                const cache = this.plugin.app.metadataCache.getFileCache(file);
                const fm = cache?.frontmatter || {};
                this.currentQueue.push({
                    file,
                    id: fm.id || 0,
                    familiarity: fm.familiarity ?? 50,
                    answer: fm.answer?.toString() || ''
                });
            }
        }

        this.currentQIndex = index;
        if (this.currentQIndex >= this.currentQueue.length) {
            this.currentQIndex = 0;
        }

        const files = this.plugin.app.vault.getMarkdownFiles();
        const cats = new Set<string>();
        for (const file of files) {
            const cache = this.plugin.app.metadataCache.getFileCache(file);
            const tags = cache?.frontmatter?.tags || [];
            if (Array.isArray(tags) ? tags.includes('q') : tags === 'q') {
                cats.add(cache?.frontmatter?.category || "Uncategorized");
            }
        }
        this.categories = ["All", ...Array.from(cats).sort()];
    }

    async autosaveSession() {
        const timestamp = (moment as any)().format("YYYY-MM-DD_HH-mm-ss");
        const folderPath = "Practice_Sessions";
        if (!(this.plugin.app.vault.getAbstractFileByPath(folderPath) instanceof TFolder)) {
            await this.plugin.app.vault.createFolder(folderPath);
        }

        const fileName = this.filterCategory.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const path = `${folderPath}/autosave_${fileName}.md`;
        
        const links = this.currentQueue.map(q => `[[${q.file.path}|${q.file.basename}]]`).join('\n');
        const content = `---
type: practice_session
currentIndex: ${this.currentQIndex}
isFinished: ${this.isFinished}
category: ${this.filterCategory}
timestamp: ${timestamp}
---
# Autosaved Session - ${this.filterCategory}

#practice_resume

## Queue
${links}`;

        const existingFile = this.plugin.app.vault.getAbstractFileByPath(path);
        if (existingFile instanceof TFile) {
            await this.plugin.app.vault.modify(existingFile, content);
        } else {
            await this.plugin.app.vault.create(path, content);
        }
    }

    async handleGrading(qMeta: QuestionMeta, isCorrect: boolean, answerStr: string) {
        const f = qMeta.familiarity;
        const newFam = isCorrect ? 100 - ((100 - f) / 3) * 2 : f / 3;
        qMeta.familiarity = newFam;

        await this.plugin.app.fileManager.processFrontMatter(qMeta.file, (fm: any) => { fm.familiarity = newFam; });
        await this.recordHistory(qMeta, isCorrect, answerStr);

        this.sessionResults.set(qMeta.file.path, isCorrect ? 'correct' : 'wrong');
        if (isCorrect) {
            this.correctAnswers++;
            this.nextQuestion(false);
        } else {
            this.wrongAnswers++;
            this.showingAnswer = true;
            this.plugin.viewManager.refreshAllViews();
        }
        await this.autosaveSession();
    }

    async recordHistory(qMeta: QuestionMeta, isCorrect: boolean, answerStr: string) {
        const ts = (moment as any)().format("YYYY-MM-DD HH:mm:ss");
        const status = isCorrect ? "✅" : "❌";
        const content = await this.plugin.app.vault.read(qMeta.file);
        let newContent = content;
        const line = `| ${ts} | ${answerStr} | ${status} |`;
        if (content.includes('# Practice History')) {
            newContent += `\n${line}`;
        } else {
            newContent += `\n\n# Practice History\n| Date | Selected | Correct? |\n|---|---|---|\n${line}`;
        }
        await this.plugin.app.vault.modify(qMeta.file, newContent);
    }

    nextQuestion(wrong: boolean) {
        if (wrong) {
            const qMeta = this.currentQueue[this.currentQIndex];
            this.currentQueue.splice(this.currentQIndex, 1);

            const rawOffsets = this.plugin.settings?.failOffsets || "3, 10, -1";
            const offsets = rawOffsets.split(',')
                .map(s => parseInt(s.trim()))
                .filter(n => !isNaN(n));

            for (const offset of offsets) {
                let targetIdx: number;
                if (offset === -1) {
                    targetIdx = this.currentQueue.length;
                } else {
                    targetIdx = this.currentQIndex + offset;
                }

                if (targetIdx < 0) targetIdx = 0;
                if (targetIdx > this.currentQueue.length) targetIdx = this.currentQueue.length;

                this.currentQueue.splice(targetIdx, 0, qMeta);
            }
        } else {
            if (this.currentQIndex >= this.currentQueue.length - 1) {
                this.isFinished = true;
            } else {
                this.currentQIndex++;
            }
        }

        this.showingAnswer = false;
        this.selectedChoices.clear();
        this.saveSession();
        this.plugin.viewManager.refreshAllViews();
    }
}
