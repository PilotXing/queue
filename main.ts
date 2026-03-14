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
export const VIEW_TYPE_CONTROL = 'queue-control-view';

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

    // Shared State
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

    async onload() {
        await this.loadSettings();

        this.registerView(
            VIEW_TYPE_PRACTICE,
            (leaf) => new PracticeView(leaf, this)
        );

        this.registerView(
            VIEW_TYPE_CONTROL,
            (leaf) => new QueueControlView(leaf, this)
        );

        this.addRibbonIcon('check-square', 'Open Practice Mode', () => {
            this.activateView();
        });

        this.addCommand({
            id: 'open-practice-view',
            name: 'Open Practice View',
            callback: () => this.activateView(),
        });

        this.addCommand({
            id: 'open-practice-control',
            name: 'Open Practice Control Sidebar',
            callback: () => this.activateControlView(),
        });

        this.addSettingTab(new PracticeSettingTab(this.app, this));

        // Detect manual session file openings
        this.registerEvent(
            this.app.workspace.on('file-open', (file) => this.onFileOpen(file))
        );

        // Initial queue load
        if (this.settings.savedQueuePaths.length > 0) {
            await this.restoreSession();
        } else {
            this.refreshQueue();
        }
    }

    private async onFileOpen(file: TFile | null) {
        if (!file) return;
        const cache = this.app.metadataCache.getFileCache(file);
        if (cache?.frontmatter?.type === 'practice_session') {
            await this.loadSessionFromFile(file);
        }
    }

    async loadSessionFromFile(file: TFile) {
        const content = await this.app.vault.read(file);
        const cache = this.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter || {};

        this.filterCategory = fm.category || "All";
        this.currentQIndex = fm.currentIndex || 0;
        this.isFinished = fm.isFinished || false;

        // Parse links from content
        this.currentQueue = [];
        const linkRegex = /\[\[(.*?)(?:\|.*?)?\]\]/g;
        let match;
        while ((match = linkRegex.exec(content)) !== null) {
            const path = match[1];
            const qFile = this.app.vault.getAbstractFileByPath(path);
            if (qFile instanceof TFile) {
                const qCache = this.app.metadataCache.getFileCache(qFile);
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
            await this.activateView();
            this.refreshAllViews();
        }
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
            leaf = workspace.getLeaf('tab');
            await leaf.setViewState({ type: VIEW_TYPE_PRACTICE, active: true });
        }
        workspace.revealLeaf(leaf);
        
        // Also open controls if not open
        this.activateControlView();
    }

    async activateControlView() {
        const { workspace } = this.app;
        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_CONTROL);

        if (leaves.length > 0) {
            leaf = leaves[0];
        } else {
            leaf = workspace.getRightLeaf(false);
            if (leaf) {
                await leaf.setViewState({ type: VIEW_TYPE_CONTROL, active: true });
            }
        }
        if (leaf) workspace.revealLeaf(leaf);
    }

    async refreshAllViews() {
        this.app.workspace.getLeavesOfType(VIEW_TYPE_PRACTICE).forEach(l => (l.view as PracticeView).render());
        this.app.workspace.getLeavesOfType(VIEW_TYPE_CONTROL).forEach(l => (l.view as QueueControlView).render());
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
        this.isFinished = false;
        this.showingAnswer = false;
        this.selectedChoices.clear();
        this.saveSession();
        this.refreshAllViews();
    }

    async saveSession() {
        this.settings.savedQueuePaths = this.currentQueue.map(q => q.file.path);
        this.settings.savedIndex = this.currentQIndex;
        await this.saveSettings();
    }

    async restoreSession() {
        const paths = this.settings.savedQueuePaths;
        const index = this.settings.savedIndex;

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

    async autosaveSession() {
        const timestamp = (moment as any)().format("YYYY-MM-DD_HH-mm-ss");
        const folderPath = "Practice_Sessions";
        if (!(this.app.vault.getAbstractFileByPath(folderPath) instanceof TFolder)) {
            await this.app.vault.createFolder(folderPath);
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

        const existingFile = this.app.vault.getAbstractFileByPath(path);
        if (existingFile instanceof TFile) {
            await this.app.vault.modify(existingFile, content);
        } else {
            await this.app.vault.create(path, content);
        }
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
            this.refreshAllViews();
        }
        await this.autosaveSession();
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

    nextQuestion(wrong: boolean) {
        if (wrong) {
            const qMeta = this.currentQueue[this.currentQIndex];
            this.currentQueue.splice(this.currentQIndex, 1);

            const rawOffsets = this.settings?.failOffsets || "3, 10, -1";
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
        this.refreshAllViews();
    }
}

class PracticeView extends ItemView {
    plugin: PracticePlugin;
    boundKeydownHandler: (e: KeyboardEvent) => void;

    constructor(leaf: WorkspaceLeaf, plugin: PracticePlugin) {
        super(leaf);
        this.plugin = plugin;
        this.boundKeydownHandler = this.onKeydown.bind(this);
    }

    getViewType() { return VIEW_TYPE_PRACTICE; }
    getDisplayText() { return 'Practice Question'; }
    getIcon() { return 'check-square'; }

    async onOpen() {
        document.addEventListener('keydown', this.boundKeydownHandler);
        await this.render();
    }

    async onClose() {
        document.removeEventListener('keydown', this.boundKeydownHandler);
    }

    onKeydown(e: KeyboardEvent) {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        if (this.app.workspace.activeLeaf?.view !== this) return;

        const key = e.key.toLowerCase();
        
        if (key === 'escape') {
            this.leaf.detach();
            e.preventDefault();
            return;
        }

        const q = this.plugin.currentQueue[this.plugin.currentQIndex];
        if (!q) return;

        if (this.plugin.showingAnswer) {
            if (key === 'enter' || key === ' ') {
                this.plugin.nextQuestion(true);
                e.preventDefault();
            }
        } else {
            const letters = ['a', 'b', 'c', 'd', 'e', 'f'];
            const idx = letters.indexOf(key);
            if (idx !== -1 && idx < this.plugin.activeChoices.length) {
                this.toggleChoice(key.toUpperCase());
                e.preventDefault();
                return;
            }

            const num = parseInt(key, 10);
            if (!isNaN(num) && num >= 1 && num <= this.plugin.activeChoices.length) {
                const choiceChar = letters[num - 1].toUpperCase();
                this.toggleChoice(choiceChar);
                e.preventDefault();
                return;
            }

            if (key === 's') {
                this.plugin.showingAnswer = true;
                this.render();
                e.preventDefault();
            } else if (key === 'n') {
                this.setMastered(q);
                e.preventDefault();
            } else if (key === 'enter' && this.plugin.selectedChoices.size > 0) {
                this.gradeMultipleChoice();
                e.preventDefault();
            }
        }
    }

    private toggleChoice(char: string) {
        if (this.plugin.selectedChoices.has(char)) {
            this.plugin.selectedChoices.delete(char);
        } else {
            this.plugin.selectedChoices.add(char);
        }
        this.render();
    }

    private gradeMultipleChoice() {
        const q = this.plugin.currentQueue[this.plugin.currentQIndex];
        const selected = Array.from(this.plugin.selectedChoices).sort().join('');
        const isCorrect = selected.toUpperCase() === q.answer.toUpperCase();
        this.plugin.handleGrading(q, isCorrect, selected);
    }

    private async setMastered(qMeta: QuestionMeta) {
        qMeta.familiarity = 100;
        await this.app.fileManager.processFrontMatter(qMeta.file, (fm) => { fm.familiarity = 100; });
        this.plugin.nextQuestion(false);
        await this.plugin.autosaveSession();
    }

    async render() {
        const container = this.contentEl;
        container.empty();
        container.addClass('practice-view-root');

        if (this.plugin.isFinished) {
            this.renderSummary(container);
            return;
        }

        if (this.plugin.currentQueue.length === 0) {
            container.createEl('h3', { text: 'Empty Queue! Start by selecting a category in the sidebar.' });
            return;
        }

        const qMeta = this.plugin.currentQueue[this.plugin.currentQIndex];
        if (!qMeta) return;

        await this.renderQuestion(container, qMeta);
    }

    private renderSummary(container: HTMLElement) {
        const summary = container.createEl('div', { cls: 'practice-summary-view' });
        summary.createEl('h1', { text: 'Practice Finished!' });
        
        const stats = summary.createEl('div', { cls: 'practice-summary-stats' });
        const correct = stats.createEl('div', { cls: 'stat-item stat-correct' });
        correct.createEl('span', { text: this.plugin.correctAnswers.toString(), cls: 'stat-value' });
        correct.createEl('span', { text: 'Correct', cls: 'stat-label' });

        const wrong = stats.createEl('div', { cls: 'stat-item stat-wrong' });
        wrong.createEl('span', { text: this.plugin.wrongAnswers.toString(), cls: 'stat-value' });
        wrong.createEl('span', { text: 'Wrong / Skipped', cls: 'stat-label' });

        const actions = summary.createEl('div', { cls: 'practice-summary-actions' });
        const restartBtn = actions.createEl('button', { text: 'Restart Queue', cls: 'practice-btn-restart' });
        restartBtn.onclick = async () => {
            this.plugin.currentQIndex = 0;
            this.plugin.isFinished = false;
            this.plugin.correctAnswers = 0;
            this.plugin.wrongAnswers = 0;
            this.plugin.sessionResults.clear();
            this.plugin.refreshAllViews();
        };
    }

    private async renderQuestion(container: HTMLElement, qMeta: QuestionMeta) {
        const content = await this.app.vault.cachedRead(qMeta.file);
        const lines = content.split('\n');
        const typeMatch = content.match(/^# (.*)$/m);
        const typeStr = typeMatch ? typeMatch[1].trim() : "Question";
        const isSingle = (typeStr === '单选题' && qMeta.answer.length <= 1);

        const firstChoiceIndex = lines.findIndex(l => /^- \*\*[A-Z]\.\*\*/.test(l));
        let stemText = lines.slice(lines.findIndex(l => l.startsWith('# ')) + 1, firstChoiceIndex).join('\n').trim();

        this.plugin.activeChoices = [];
        const choicesRegex = /^- \*\*([A-Z])\.\*\* (.*)$/gm;
        let match;
        while ((match = choicesRegex.exec(content)) !== null) {
            this.plugin.activeChoices.push({ char: match[1], text: match[2].trim() });
        }

        const headerEl = container.createEl('div', { cls: 'practice-header' });
        headerEl.createEl('span', { text: `Q: ${this.plugin.currentQIndex + 1} / ${this.plugin.currentQueue.length}` });
        headerEl.createEl('span', { text: `Fam: ${qMeta.familiarity.toFixed(1)}%` });

        const escBtn = headerEl.createEl('button', { text: 'ESC', cls: 'practice-header-esc' });
        escBtn.onclick = () => this.leaf.detach();

        const stemEl = container.createEl('div', { cls: 'practice-stem' });
        await MarkdownRenderer.renderMarkdown(`**[${isSingle ? 'S' : 'M'}]**\n\n${stemText}`, stemEl, qMeta.file.path, this);

        const choicesEl = container.createEl('div', { cls: 'practice-choices' });
        for (const choice of this.plugin.activeChoices) {
            const row = choicesEl.createEl('div', { cls: 'practice-choice' });
            if (this.plugin.selectedChoices.has(choice.char)) row.addClass('practice-selected-choice');

            row.onclick = () => {
                if (this.plugin.showingAnswer) return;
                if (isSingle) {
                    const isCorrect = qMeta.answer.toUpperCase().includes(choice.char.toUpperCase());
                    this.plugin.handleGrading(qMeta, isCorrect, choice.char);
                } else {
                    this.toggleChoice(choice.char);
                }
            };

            const marker = row.createEl('span', { text: `${choice.char}. `, cls: 'practice-choice-marker' });
            if (this.plugin.selectedChoices.has(choice.char)) marker.setText('✓ ');

            await MarkdownRenderer.renderMarkdown(choice.text, row, qMeta.file.path, this);
            if (this.plugin.showingAnswer && qMeta.answer.toUpperCase().includes(choice.char.toUpperCase())) {
                row.addClass('practice-correct-choice');
            }
        }

        const actions = container.createEl('div', { cls: 'practice-actions' });
        if (this.plugin.showingAnswer) {
            container.createEl('div', { text: `Answer: ${qMeta.answer}`, cls: 'practice-answer-reveal' });
            const nextBtn = actions.createEl('button', { text: 'Next Question =>', cls: 'practice-btn-wrong' });
            nextBtn.onclick = () => this.plugin.nextQuestion(true);
        } else {
            if (!isSingle) {
                const submitBtn = actions.createEl('button', { text: 'Submit Answer', cls: 'practice-btn-submit' });
                submitBtn.onclick = () => this.gradeMultipleChoice();
            }
            const showBtn = actions.createEl('button', { text: '(S)how Answer', cls: 'practice-btn-show' });
            showBtn.onclick = () => { this.plugin.showingAnswer = true; this.plugin.refreshAllViews(); };

            const skipBtn = actions.createEl('button', { text: 'Skip (N)', cls: 'practice-btn-skip' });
            skipBtn.onclick = () => this.setMastered(qMeta);
        }
    }
}

class QueueControlView extends ItemView {
    plugin: PracticePlugin;

    constructor(leaf: WorkspaceLeaf, plugin: PracticePlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return VIEW_TYPE_CONTROL; }
    getDisplayText() { return 'Queue Control'; }
    getIcon() { return 'list'; }

    async onOpen() { await this.render(); }

    async render() {
        const container = this.contentEl;
        container.empty();
        container.addClass('practice-control-root');

        const toolbarEl = container.createEl('div', { cls: 'practice-sidebar-toolbar' });
        this.renderToolbar(toolbarEl);

        const listEl = container.createEl('div', { cls: 'practice-sidebar-queue' });
        this.renderQueueList(listEl);
    }

    private renderToolbar(parent: HTMLElement) {
        const row1 = parent.createEl('div', { cls: 'practice-toolbar-row' });
        row1.createEl('span', { text: 'Category:' });
        const catSelect = row1.createEl('select');
        this.plugin.categories.forEach(cat => {
            const opt = catSelect.createEl('option', { text: cat, value: cat });
            if (cat === this.plugin.filterCategory) opt.selected = true;
        });
        catSelect.onchange = () => {
            this.plugin.filterCategory = catSelect.value;
            this.plugin.refreshQueue();
        };

        const row2 = parent.createEl('div', { cls: 'practice-toolbar-row' });
        row2.createEl('span', { text: 'Max Fam:' });
        const famSlider = row2.createEl('input', { type: 'range' });
        famSlider.min = "0"; famSlider.max = "100";
        famSlider.value = this.plugin.filterFamiliarity.toString();
        const famLabel = row2.createEl('span', { text: `${this.plugin.filterFamiliarity.toFixed(0)}%` });
        famSlider.oninput = () => famLabel.setText(`${famSlider.value}%`);
        famSlider.onchange = () => {
            this.plugin.filterFamiliarity = parseInt(famSlider.value);
            this.plugin.refreshQueue();
        };
    }

    private renderQueueList(parent: HTMLElement) {
        parent.createEl('h4', { text: 'Queue' });
        const list = parent.createEl('div', { cls: 'practice-queue-list' });

        this.plugin.currentQueue.forEach((q, idx) => {
            const item = list.createEl('div', { cls: 'practice-queue-item' });
            if (idx === this.plugin.currentQIndex) item.addClass('is-active');

            const result = this.plugin.sessionResults.get(q.file.path);
            if (result === 'correct') item.addClass('is-correct');
            else if (result === 'wrong') item.addClass('is-wrong');

            item.createEl('span', { text: `${idx + 1}.`, cls: 'practice-queue-item-idx' });
            item.createEl('span', { text: q.file.basename, cls: 'practice-queue-item-title' });

            const hue = Math.round(q.familiarity * 1.2);
            const famMarker = item.createEl('div', { cls: 'practice-queue-item-fam-dot' });
            famMarker.style.backgroundColor = `hsl(${hue}, 80%, 45%)`;

            item.onclick = () => {
                this.plugin.currentQIndex = idx;
                this.plugin.isFinished = false;
                this.plugin.showingAnswer = false;
                this.plugin.selectedChoices.clear();
                this.plugin.saveSession();
                this.plugin.refreshAllViews();
            };

            if (idx === this.plugin.currentQIndex) {
                setTimeout(() => item.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
            }
        });
    }
}

class PracticeSettingTab extends PluginSettingTab {
    plugin: PracticePlugin;
    constructor(app: App, plugin: PracticePlugin) { super(app, plugin); this.plugin = plugin; }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Queue Settings' });

        new Setting(containerEl)
            .setName('Fail Re-insertion Offsets')
            .addText(text => text
                .setValue(this.plugin.settings.failOffsets)
                .onChange(async (value) => {
                    this.plugin.settings.failOffsets = value;
                    await this.plugin.saveSettings();
                }));
    }
}
