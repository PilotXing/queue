import {
    App,
    ItemView,
    Plugin,
    WorkspaceLeaf,
    MarkdownRenderer,
    TFile,
    moment,
    Setting,
    PluginSettingTab,
    TFolder
} from 'obsidian';

export const VIEW_TYPE_PRACTICE = 'practice-view';

interface QuestionMeta {
    file: TFile;
    id: number;
    familiarity: number;
    answer: string;
}

interface PracticeSettings {
    failOffsets: string;
    savedQueuePaths: string[];
    savedIndex: number;
}

const DEFAULT_SETTINGS: PracticeSettings = {
    failOffsets: "3, 10, -1",
    savedQueuePaths: [],
    savedIndex: 0
};

export default class PracticePlugin extends Plugin {
    settings: PracticeSettings;

    async onload() {
        await this.loadSettings();

        this.registerView(
            VIEW_TYPE_PRACTICE,
            (leaf) => new PracticeView(leaf, this)
        );

        this.addRibbonIcon('check-square', 'Open Practice mode', () => {
            this.activateView();
        });

        this.addCommand({
            id: 'open-practice-view',
            name: 'Open Practice View',
            callback: () => {
                this.activateView();
            },
        });

        this.addSettingTab(new PracticeSettingTab(this.app, this));
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_PRACTICE);

        if (leaves.length > 0) {
            leaf = leaves[0];
        } else {
            leaf = workspace.getRightLeaf(false);
            if (leaf) {
                await leaf.setViewState({ type: VIEW_TYPE_PRACTICE, active: true });
            }
        }

        if (leaf) {
            workspace.revealLeaf(leaf);
        }
    }
}

class PracticeSettingTab extends PluginSettingTab {
    plugin: PracticePlugin;

    constructor(app: App, plugin: PracticePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Queue Settings' });

        new Setting(containerEl)
            .setName('Fail Re-insertion Offsets')
            .setDesc('Comma-separated list of offsets for re-inserting failed questions. -1 means end of list. Example: 3, 10, -1')
            .addText(text => text
                .setPlaceholder('3, 10, -1')
                .setValue(this.plugin.settings.failOffsets)
                .onChange(async (value) => {
                    this.plugin.settings.failOffsets = value;
                }));

        new Setting(containerEl)
            .setName('Apply Settings')
            .setDesc('Save and apply the new re-insertion offsets.')
            .addButton(btn => btn
                .setButtonText('Apply')
                .setCta()
                .onClick(async () => {
                    await this.plugin.saveSettings();
                }));
    }
}

class PracticeView extends ItemView {
    plugin: PracticePlugin;
    currentQueue: QuestionMeta[] = [];
    currentQIndex: number = 0;
    showingAnswer: boolean = false;
    correctAnswers: number = 0;
    wrongAnswers: number = 0;
    boundKeydownHandler: (e: KeyboardEvent) => void;

    // Filter state
    filterCategory: string = "All";
    filterFamiliarity: number = 100;
    categories: string[] = ["All"];

    // Session State
    sessionResults: Map<string, 'correct' | 'wrong'> = new Map();
    selectedChoices: Set<string> = new Set();
    activeChoices: { char: string, text: string }[] = [];

    constructor(leaf: WorkspaceLeaf, plugin: PracticePlugin) {
        super(leaf);
        this.plugin = plugin;
        this.boundKeydownHandler = this.onKeydown.bind(this);
    }

    getViewType() {
        return VIEW_TYPE_PRACTICE;
    }

    getDisplayText() {
        return 'Queueueueue';
    }

    getIcon() {
        return 'check-square';
    }

    async onOpen() {
        document.addEventListener('keydown', this.boundKeydownHandler);

        // Try to restore session
        if (this.plugin.settings.savedQueuePaths.length > 0) {
            await this.restoreSession();
        } else {
            this.refreshQueue();
        }

        await this.render();
    }

    async onClose() {
        document.removeEventListener('keydown', this.boundKeydownHandler);
    }

    onKeydown(e: KeyboardEvent) {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

        const activeLeaf = this.app.workspace.activeLeaf;
        if (activeLeaf && activeLeaf.view !== this) return;

        const q = this.currentQueue[this.currentQIndex];
        if (!q) return;

        const key = e.key.toLowerCase();

        if (this.showingAnswer) {
            if (key === 'enter' || key === ' ') {
                this.nextQuestion(true);
                e.preventDefault();
            }
        } else {
            const letters = ['a', 'b', 'c', 'd', 'e', 'f'];
            const idx = letters.indexOf(key);
            if (idx !== -1 && idx < this.activeChoices.length) {
                this.toggleChoice(key.toUpperCase());
                e.preventDefault();
                return;
            }

            const num = parseInt(key, 10);
            if (!isNaN(num) && num >= 1 && num <= this.activeChoices.length) {
                const choiceChar = letters[num - 1].toUpperCase();
                this.toggleChoice(choiceChar);
                e.preventDefault();
                return;
            }

            if (key === 's') {
                this.showingAnswer = true;
                this.render();
                e.preventDefault();
            } else if (key === 'n') {
                this.setMastered(q);
                e.preventDefault();
            } else if (key === 'enter' && this.selectedChoices.size > 0) {
                this.gradeMultipleChoice();
                e.preventDefault();
            }
        }
    }

    private toggleChoice(char: string) {
        if (this.selectedChoices.has(char)) {
            this.selectedChoices.delete(char);
        } else {
            this.selectedChoices.add(char);
        }
        this.render();
    }

    private async saveSession() {
        this.plugin.settings.savedQueuePaths = this.currentQueue.map(q => q.file.path);
        this.plugin.settings.savedIndex = this.currentQIndex;
        await this.plugin.saveSettings();
    }

    private async restoreSession() {
        const paths = this.plugin.settings.savedQueuePaths;
        const index = this.plugin.settings.savedIndex;

        this.currentQueue = [];
        for (const path of paths) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile) {
                const cache = this.app.metadataCache.getFileCache(file);
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

        // Also refresh categories for the toolbar
        const files = this.app.vault.getMarkdownFiles();
        const cats = new Set<string>();
        for (const file of files) {
            const cache = this.app.metadataCache.getFileCache(file);
            const tags = cache?.frontmatter?.tags || [];
            if (Array.isArray(tags) ? tags.includes('q') : tags === 'q') {
                cats.add(cache?.frontmatter?.category || "Uncategorized");
            }
        }
        this.categories = ["All", ...Array.from(cats).sort()];
    }

    refreshQueue() {
        this.currentQueue = [];
        const files = this.app.vault.getMarkdownFiles();
        const cats = new Set<string>();

        for (const file of files) {
            const cache = this.app.metadataCache.getFileCache(file);
            const tags = cache?.frontmatter?.tags || [];
            const tagArray = Array.isArray(tags) ? tags : [tags];

            if (tagArray.some(t => String(t).includes('q'))) {
                const fm = cache!.frontmatter!;
                const category = fm.category || "Uncategorized";
                cats.add(category);

                if (this.filterCategory !== "All" && category !== this.filterCategory) continue;

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
        this.showingAnswer = false;
        this.selectedChoices.clear();
        this.saveSession();
    }

    async render() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('practice-view-root');

        const toolbarEl = container.createEl('div', { cls: 'practice-toolbar' });
        this.renderToolbar(toolbarEl);

        const mainLayout = container.createEl('div', { cls: 'practice-layout' });
        const contentArea = mainLayout.createEl('div', { cls: 'practice-content-area' });
        const sidebarArea = mainLayout.createEl('div', { cls: 'practice-sidebar' });

        if (this.currentQueue.length === 0) {
            contentArea.createEl('h3', { text: 'No questions matching filters! 🧐' });
            return;
        }

        const qMeta = this.currentQueue[this.currentQIndex];
        if (!qMeta) return;

        this.renderSidebar(sidebarArea);
        await this.renderQuestion(contentArea, qMeta);
    }

    private renderToolbar(parent: HTMLElement) {
        const row = parent.createEl('div', { cls: 'practice-toolbar-row' });

        row.createEl('span', { text: 'Category:' });
        const catSelect = row.createEl('select');
        this.categories.forEach(cat => {
            const opt = catSelect.createEl('option', { text: cat, value: cat });
            if (cat === this.filterCategory) opt.selected = true;
        });
        catSelect.onchange = async () => {
            this.filterCategory = catSelect.value;
            this.refreshQueue();
            await this.render();
        };

        row.createEl('span', { text: 'Max Fam:' });
        const famSlider = row.createEl('input', { type: 'range' });
        famSlider.min = "0";
        famSlider.max = "100";
        famSlider.value = this.filterFamiliarity.toString();
        const famLabel = row.createEl('span', { text: `${this.filterFamiliarity.toFixed(0)}%` });

        famSlider.oninput = () => {
            famLabel.setText(`${famSlider.value}%`);
        };
        famSlider.onchange = async () => {
            this.filterFamiliarity = parseInt(famSlider.value);
            this.refreshQueue();
            await this.render();
        };

        const saveSessionBtn = row.createEl('button', { text: 'Save Session', cls: 'practice-btn-save' });
        saveSessionBtn.onclick = () => this.saveSessionToFile();

        const loadSessionBtn = row.createEl('button', { text: 'Load Session', cls: 'practice-btn-load' });
        loadSessionBtn.onclick = () => this.loadSessionFromFile();
    }

    private async saveSessionToFile() {
        const timestamp = (moment as any)().format("YYYY-MM-DD_HH-mm-ss");
        const folderPath = "Practice_Sessions";
        if (!(this.app.vault.getAbstractFileByPath(folderPath) instanceof TFolder)) {
            await this.app.vault.createFolder(folderPath);
        }

        const path = `${folderPath}/session_${timestamp}.md`;
        const links = this.currentQueue.map(q => `[[${q.file.path}|${q.file.basename}]]`).join('\n');
        const content = `---
type: practice_session
currentIndex: ${this.currentQIndex}
---
# Practice Session - ${timestamp}

#practice_resume

## Queue
${links}`;

        await this.app.vault.create(path, content);
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            this.app.workspace.getLeaf().openFile(file);
        }
    }

    private async loadSessionFromFile() {
        // Simple file picker simulation or look for active file if it's a session file
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return;

        const content = await this.app.vault.read(activeFile);
        if (!content.includes('type: practice_session')) {
            // Not a session file
            return;
        }

        const cache = this.app.metadataCache.getFileCache(activeFile);
        const fm = cache?.frontmatter || {};
        const savedIndex = fm.currentIndex || 0;

        const linksMatch = content.match(/\[\[(.*?)(\|(.*?))?\]\]/g);
        if (!linksMatch) return;

        this.currentQueue = [];
        for (const link of linksMatch) {
            const path = link.replace('[[', '').replace(']]', '').split('|')[0];
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile) {
                const qCache = this.app.metadataCache.getFileCache(file);
                const qFm = qCache?.frontmatter || {};
                this.currentQueue.push({
                    file,
                    id: qFm.id || 0,
                    familiarity: qFm.familiarity ?? 50,
                    answer: qFm.answer?.toString() || ''
                });
            }
        }

        this.currentQIndex = savedIndex;
        this.saveSession();
        this.render();
    }

    private renderSidebar(parent: HTMLElement) {
        parent.createEl('h4', { text: 'Queue' });
        const list = parent.createEl('div', { cls: 'practice-queue-list' });

        this.currentQueue.forEach((q, idx) => {
            const item = list.createEl('div', { cls: 'practice-queue-item' });
            if (idx === this.currentQIndex) item.addClass('is-active');

            const result = this.sessionResults.get(q.file.path);
            if (result === 'correct') item.addClass('is-correct');
            else if (result === 'wrong') item.addClass('is-wrong');

            const words = q.file.basename.split(/[\s_-]+/).filter(w => w.length > 0);
            const iconText = words.slice(0, 2).join(' ');

            const hue = Math.round(q.familiarity * 1.2);
            const color = `hsl(${hue}, 80%, 45%)`;

            item.createEl('span', { text: `${idx + 1}.`, cls: 'practice-queue-item-idx' });
            item.createEl('span', { text: iconText, cls: 'practice-queue-item-title' });

            const famMarker = item.createEl('div', { cls: 'practice-queue-item-fam-dot' });
            famMarker.style.backgroundColor = color;

            item.onclick = async () => {
                this.currentQIndex = idx;
                this.showingAnswer = false;
                this.selectedChoices.clear();
                this.saveSession();
                await this.render();
            };

            if (idx === this.currentQIndex) {
                setTimeout(() => item.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
            }
        });
    }

    private async renderQuestion(container: HTMLElement, qMeta: QuestionMeta) {
        const content = await this.app.vault.cachedRead(qMeta.file);
        const lines = content.split('\n');

        const typeMatch = content.match(/^# (.*)$/m);
        const typeStr = typeMatch ? typeMatch[1].trim() : "Question";
        const isSingle = (typeStr === '单选题' && qMeta.answer.length <= 1);

        const firstChoiceIndex = lines.findIndex(l => /^- \*\*[A-Z]\.\*\*/.test(l));
        let stemText = lines.slice(lines.findIndex(l => l.startsWith('# ')) + 1, firstChoiceIndex).join('\n').trim();

        this.activeChoices = [];
        const choicesRegex = /^- \*\*([A-Z])\.\*\* (.*)$/gm;
        let match;
        while ((match = choicesRegex.exec(content)) !== null) {
            this.activeChoices.push({ char: match[1], text: match[2].trim() });
        }

        const headerEl = container.createEl('div', { cls: 'practice-header' });
        headerEl.createEl('span', { text: `Q: ${this.currentQIndex + 1} / ${this.currentQueue.length} | C: ${this.correctAnswers} / W: ${this.wrongAnswers}` });
        headerEl.createEl('span', { text: `Familiarity: ${qMeta.familiarity.toFixed(1)}%` });

        const stemEl = container.createEl('div', { cls: 'practice-stem' });
        await MarkdownRenderer.renderMarkdown(`**[${isSingle ? 'S' : 'M'}]**\n\n${stemText}`, stemEl, qMeta.file.path, this);

        const choicesEl = container.createEl('div', { cls: 'practice-choices' });
        for (const choice of this.activeChoices) {
            const row = choicesEl.createEl('div', { cls: 'practice-choice' });
            if (this.selectedChoices.has(choice.char)) row.addClass('practice-selected-choice');

            row.onclick = () => {
                if (this.showingAnswer) return;
                if (isSingle) {
                    const isCorrect = qMeta.answer.toUpperCase().includes(choice.char.toUpperCase());
                    this.handleGrading(qMeta, isCorrect, choice.char);
                } else {
                    this.toggleChoice(choice.char);
                }
            };

            const marker = row.createEl('span', { text: `${choice.char}. `, cls: 'practice-choice-marker' });
            if (this.selectedChoices.has(choice.char)) marker.setText('✓ ');

            await MarkdownRenderer.renderMarkdown(choice.text, row, qMeta.file.path, this);

            if (this.showingAnswer && qMeta.answer.toUpperCase().includes(choice.char.toUpperCase())) {
                row.addClass('practice-correct-choice');
            }
        }

        const actions = container.createEl('div', { cls: 'practice-actions' });
        if (this.showingAnswer) {
            container.createEl('div', { text: `Answer: ${qMeta.answer}`, cls: 'practice-answer-reveal' });
            const nextBtn = actions.createEl('button', { text: 'Next Question =>', cls: 'practice-btn-wrong' });
            nextBtn.onclick = () => this.nextQuestion(true);
        } else {
            if (!isSingle) {
                const submitBtn = actions.createEl('button', { text: 'Submit Answer', cls: 'practice-btn-submit' });
                submitBtn.onclick = () => this.gradeMultipleChoice();
            }
            const showBtn = actions.createEl('button', { text: '(S)how Answer', cls: 'practice-btn-show' });
            showBtn.onclick = () => { this.showingAnswer = true; this.render(); };

            const skipBtn = actions.createEl('button', { text: 'Skip (N)', cls: 'practice-btn-skip' });
            skipBtn.onclick = () => this.setMastered(qMeta);
        }

        this.updateExportFile(qMeta);
    }

    private async updateExportFile(q: QuestionMeta) {
        const path = "current_q.md";
        const link = `[[${q.file.basename}]]`;
        const content = await this.app.vault.cachedRead(q.file);
        const exportContent = `# Current Question\n\nLink: ${link}\n\n#practice_resume\n\n---\n\n${content}\n\n---\n\n**To continue practice, click "Open Practice mode" in the ribbon or use the command palette.**`;
        const existingFile = this.app.vault.getAbstractFileByPath(path);
        if (existingFile instanceof TFile) {
            await this.app.vault.modify(existingFile, exportContent);
        } else {
            await this.app.vault.create(path, exportContent);
        }
    }

    private gradeMultipleChoice() {
        const q = this.currentQueue[this.currentQIndex];
        const selected = Array.from(this.selectedChoices).sort().join('');
        const isCorrect = selected.toUpperCase() === q.answer.toUpperCase();
        this.handleGrading(q, isCorrect, selected);
    }

    async handleGrading(qMeta: QuestionMeta, isCorrect: boolean, answerStr: string) {
        const f = qMeta.familiarity;
        const newFam = isCorrect ? 100 - ((100 - f) / 3) * 2 : f / 3;
        qMeta.familiarity = newFam;

        await this.app.fileManager.processFrontMatter(qMeta.file, (fm) => { fm.familiarity = newFam; });
        await this.recordHistory(qMeta, isCorrect, answerStr);

        this.sessionResults.set(qMeta.file.path, isCorrect ? 'correct' : 'wrong');
        if (isCorrect) {
            this.correctAnswers++;
            this.nextQuestion(false);
        } else {
            this.wrongAnswers++;
            this.showingAnswer = true;
            this.render();
        }
    }

    async recordHistory(qMeta: QuestionMeta, isCorrect: boolean, answerStr: string) {
        const ts = (moment as any)().format("YYYY-MM-DD HH:mm:ss");
        const status = isCorrect ? "✅" : "❌";
        const content = await this.app.vault.read(qMeta.file);
        let newContent = content;
        const line = `| ${ts} | ${answerStr} | ${status} |`;
        if (content.includes('## Practice History')) {
            newContent += `\n${line}`;
        } else {
            newContent += `\n\n## Practice History\n| Date | Selected | Correct? |\n|---|---|---|\n${line}`;
        }
        await this.app.vault.modify(qMeta.file, newContent);
    }

    async setMastered(qMeta: QuestionMeta) {
        qMeta.familiarity = 100;
        await this.app.fileManager.processFrontMatter(qMeta.file, (fm) => { fm.familiarity = 100; });
        this.nextQuestion(false);
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
            this.currentQIndex = (this.currentQIndex + 1) % this.currentQueue.length;
        }

        this.showingAnswer = false;
        this.selectedChoices.clear();
        this.saveSession();
        this.render();
    }
}
