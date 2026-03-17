import { Plugin, TFile } from 'obsidian';
import { SessionManager } from './src/managers/SessionManager';
import { ViewManager } from './src/managers/ViewManager';
import { ButtonLayoutManager } from './src/managers/ButtonLayoutManager';
import { PracticeView } from './src/views/PracticeView';
import { QueueControlView } from './src/views/QueueControlView';
import { PracticeSettingTab } from './src/settings/PracticeSettingTab';
import { VIEW_TYPE_PRACTICE, VIEW_TYPE_CONTROL, PracticeSettings, DEFAULT_SETTINGS } from './src/types';

export default class PracticePlugin extends Plugin {
    settings: PracticeSettings;
    
    sessionManager: SessionManager;
    viewManager: ViewManager;
    buttonManager: ButtonLayoutManager;

    get session() { return this.sessionManager; }

    async onload() {
        await this.loadSettings();

        // Initialize Managers and Models
        this.sessionManager = new SessionManager(this);
        this.viewManager = new ViewManager(this);
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
            this.viewManager.activateView();
        });

        this.addCommand({
            id: 'open-practice-view',
            name: 'Open Practice View',
            callback: () => this.viewManager.activateView(),
        });

        this.addCommand({
            id: 'open-practice-control',
            name: 'Open Practice Control Sidebar',
            callback: () => this.viewManager.activateControlView(),
        });

        this.addSettingTab(new PracticeSettingTab(this.app, this));

        // Detect manual session file openings
        this.registerEvent(
            this.app.workspace.on('file-open', (file) => this.onFileOpen(file))
        );

        // Initial queue load
        if (this.settings.savedQueuePaths.length > 0) {
            await this.sessionManager.restoreSession();
        } else {
            this.sessionManager.refreshQueue();
        }
    }

    private async onFileOpen(file: TFile | null) {
        if (!file) return;
        const cache = this.app.metadataCache.getFileCache(file);
        if (cache?.frontmatter?.type === 'practice_session') {
            await this.sessionManager.loadSessionFromFile(file);
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
}
