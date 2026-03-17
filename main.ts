import { Plugin, TFile } from 'obsidian';
import { PracticeSession } from './src/models/PracticeSession';
import { ButtonLayoutManager } from './src/managers/ButtonLayoutManager';
import { PracticeView } from './src/views/PracticeView';
import { QueueControlView } from './src/views/QueueControlView';
import { PracticeSettingTab } from './src/settings/PracticeSettingTab';
import { VIEW_TYPE_PRACTICE, VIEW_TYPE_CONTROL, PracticeSettings, DEFAULT_SETTINGS } from './src/types';

export default class PracticePlugin extends Plugin {
    settings: PracticeSettings;
    
    session: PracticeSession;
    buttonManager: ButtonLayoutManager;

    async onload() {
        await this.loadSettings();

        // Initialize Managers and Models
        this.session = new PracticeSession(this);
        this.buttonManager = new ButtonLayoutManager(this);

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

        this.session.filterCategory = fm.category || "All";
        this.session.currentQIndex = fm.currentIndex || 0;
        this.session.isFinished = fm.isFinished || false;

        // Parse links from content
        this.session.currentQueue = [];
        const linkRegex = /\[\[(.*?)(?:\|.*?)?\]\]/g;
        let match;
        while ((match = linkRegex.exec(content)) !== null) {
            const path = match[1];
            const qFile = this.app.vault.getAbstractFileByPath(path);
            if (qFile instanceof TFile) {
                const qCache = this.app.metadataCache.getFileCache(qFile);
                const qFm = qCache?.frontmatter || {};
                this.session.currentQueue.push({
                    file: qFile,
                    id: qFm.id || 0,
                    familiarity: qFm.familiarity ?? 50,
                    answer: qFm.answer?.toString() || ''
                });
            }
        }

        if (this.session.currentQueue.length > 0) {
            await this.saveSession();
            await this.activateView();
            this.refreshAllViews();
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        // Initialize layout maps if upgrading
        if (!this.settings.buttonLayouts) {
            this.settings.buttonLayouts = {};
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_PRACTICE)[0];

        if (!leaf) {
            leaf = workspace.getLeaf('tab');
            await leaf.setViewState({ type: VIEW_TYPE_PRACTICE, active: true });
        }
        workspace.revealLeaf(leaf);
        
        this.activateControlView();
    }

    async activateControlView() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_CONTROL)[0];

        if (!leaf) {
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
        this.session.currentQueue = [];
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

                if (this.session.filterCategory !== "All" && category !== this.session.filterCategory) continue;

                let fam = fm.familiarity;
                if (fam === undefined || fam === null) fam = 50;
                if (fam > this.session.filterFamiliarity) continue;

                if (fam < 100) {
                    this.session.currentQueue.push({
                        file,
                        id: fm.id,
                        familiarity: fam,
                        answer: fm.answer?.toString() || ''
                    });
                }
            }
        }

        this.session.categories = ["All", ...Array.from(cats).sort()];
        this.session.currentQueue.sort((a, b) => a.familiarity - b.familiarity);
        this.session.currentQIndex = 0;
        this.session.isFinished = false;
        this.session.showingAnswer = false;
        this.session.selectedChoices.clear();
        this.saveSession();
        this.refreshAllViews();
    }

    async saveSession() {
        this.settings.savedQueuePaths = this.session.currentQueue.map(q => q.file.path);
        this.settings.savedIndex = this.session.currentQIndex;
        await this.saveSettings();
    }

    async restoreSession() {
        const paths = this.settings.savedQueuePaths;
        const index = this.settings.savedIndex;

        this.session.currentQueue = [];
        for (const path of paths) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile) {
                const cache = this.app.metadataCache.getFileCache(file);
                const fm = cache?.frontmatter || {};
                this.session.currentQueue.push({
                    file,
                    id: fm.id || 0,
                    familiarity: fm.familiarity ?? 50,
                    answer: fm.answer?.toString() || ''
                });
            }
        }

        this.session.currentQIndex = index;
        if (this.session.currentQIndex >= this.session.currentQueue.length) {
            this.session.currentQIndex = 0;
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
        this.session.categories = ["All", ...Array.from(cats).sort()];
    }
}
