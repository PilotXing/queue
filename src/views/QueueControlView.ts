import { ItemView, WorkspaceLeaf, Platform } from 'obsidian';
import PracticePlugin from '../main';
import { VIEW_TYPE_CONTROL } from '../types';

export class QueueControlView extends ItemView {
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

        const settingsEl = container.createEl('div', { cls: 'practice-sidebar-settings' });
        this.renderSettings(settingsEl);

        const listEl = container.createEl('div', { cls: 'practice-sidebar-queue' });
        this.renderQueueList(listEl);
    }

    private renderToolbar(parent: HTMLElement) {
        parent.createEl('h4', { text: 'Filters', cls: 'sidebar-section-header' });
        
        const row1 = parent.createEl('div', { cls: 'practice-toolbar-row' });
        row1.createEl('span', { text: 'Category:' });
        const catSelect = row1.createEl('select');
        this.plugin.session.categories.forEach(cat => {
            const opt = catSelect.createEl('option', { text: cat, value: cat });
            if (cat === this.plugin.session.filterCategory) opt.selected = true;
        });
        catSelect.onchange = () => {
            this.plugin.session.filterCategory = catSelect.value;
            this.plugin.refreshQueue();
        };

        const row2 = parent.createEl('div', { cls: 'practice-toolbar-row' });
        row2.createEl('span', { text: 'Max Familiarity:' });
        
        const sliderContainer = row2.createEl('div', { cls: 'vertical-slider-container' });
        const famSlider = sliderContainer.createEl('input', { type: 'range', cls: 'vertical-slider' });
        famSlider.min = "0"; famSlider.max = "100";
        famSlider.value = this.plugin.session.filterFamiliarity.toString();
        famSlider.setAttribute('orient', 'vertical');

        const famLabel = sliderContainer.createEl('span', { 
            text: `${this.plugin.session.filterFamiliarity.toFixed(0)}%`,
            cls: 'vertical-slider-label' 
        });

        famSlider.oninput = () => famLabel.setText(`${famSlider.value}%`);
        famSlider.onchange = () => {
            this.plugin.session.filterFamiliarity = parseInt(famSlider.value);
            this.plugin.refreshQueue();
        };
    }

    private renderSettings(parent: HTMLElement) {
        parent.createEl('h4', { text: 'Practice Settings', cls: 'sidebar-section-header' });
        
        const rowOffsets = parent.createEl('div', { cls: 'practice-sidebar-setting-row' });
        rowOffsets.createEl('span', { text: 'Insert Position:', title: 'Offsets for re-inserting failed questions' });
        const offsetInput = rowOffsets.createEl('input', { type: 'text', cls: 'setting-input-text' });
        offsetInput.value = this.plugin.settings.failOffsets;
        offsetInput.onchange = async () => {
            this.plugin.settings.failOffsets = offsetInput.value;
            await this.plugin.saveSettings();
        };
        rowOffsets.createEl('div', { text: 'e.g. 3, 10, -1 (Use -1 for end)', cls: 'setting-instruction' });

        const rowSize = parent.createEl('div', { cls: 'practice-sidebar-setting-row' });
        rowSize.createEl('span', { text: 'Font Size:' });
        const sizeContainer = rowSize.createEl('div', { cls: 'font-size-selector' });
        const sizes = [12, 14, 16, 18, 20, 24];
        sizes.forEach(sz => {
            const sample = sizeContainer.createEl('span', { text: 'A', cls: 'font-sample' });
            sample.style.fontSize = `${sz}px`;
            if (this.plugin.settings.fontSize === sz) sample.addClass('is-active');
            sample.onclick = async () => {
                this.plugin.settings.fontSize = sz;
                await this.plugin.saveSettings();
                this.plugin.refreshAllViews();
            };
        });

        const rowColor = parent.createEl('div', { cls: 'practice-sidebar-setting-row' });
        rowColor.createEl('span', { text: 'Visual Theme:' });
        
        const presetsContainer = rowColor.createEl('div', { cls: 'color-presets' });
        const themes = [
            { name: 'Default', text: 'var(--text-normal)', bg: 'var(--background-primary)' },
            { name: 'Dark Blue', text: '#e0e0e0', bg: '#1a202c' },
            { name: 'Sepia', text: '#5b4636', bg: '#f4ecd8' },
            { name: 'Matrix', text: '#00ff00', bg: '#000000' },
            { name: 'Clean', text: '#2d3748', bg: '#ffffff' }
        ];

        themes.forEach(t => {
            const dot = presetsContainer.createEl('div', { cls: 'color-preset', title: t.name });
            dot.style.backgroundColor = t.bg;
            dot.onclick = async () => {
                this.plugin.settings.textColor = t.text;
                this.plugin.settings.bgColor = t.bg;
                await this.plugin.saveSettings();
                this.plugin.refreshAllViews();
            };
        });

        const customRow = rowColor.createEl('div', { cls: 'practice-toolbar-row' });
        customRow.style.marginTop = '8px';
        const customTextSpan = customRow.createEl('span', { text: 'Custom Text:' });
        customTextSpan.style.fontSize = '0.7em';
        const colorInput = customRow.createEl('input', { type: 'color' });
        colorInput.value = this.plugin.settings.textColor.startsWith('var') ? "#ffffff" : this.plugin.settings.textColor;
        colorInput.onchange = async () => {
            this.plugin.settings.textColor = colorInput.value;
            await this.plugin.saveSettings();
            this.plugin.refreshAllViews();
        };

        const resetBtn = parent.createEl('button', { text: 'Restore Defaults', cls: 'sidebar-reset-btn' });
        resetBtn.onclick = async () => {
            this.plugin.settings.fontSize = 16;
            this.plugin.settings.bgColor = "var(--background-primary)";
            this.plugin.settings.textColor = "var(--text-normal)";
            await this.plugin.saveSettings();
            this.plugin.refreshAllViews();
        };
    }

    private renderQueueList(parent: HTMLElement) {
        parent.createEl('h4', { text: 'Queue', cls: 'sidebar-section-header' });
        const list = parent.createEl('div', { cls: 'practice-queue-list' });

        this.plugin.session.currentQueue.forEach((q, idx) => {
            const item = list.createEl('div', { cls: 'practice-queue-item' });
            if (idx === this.plugin.session.currentQIndex) item.addClass('is-active');

            const result = this.plugin.session.sessionResults.get(q.file.path);
            if (result === 'correct') item.addClass('is-correct');
            else if (result === 'wrong') item.addClass('is-wrong');

            item.createEl('span', { text: `${idx + 1}.`, cls: 'practice-queue-item-idx' });
            item.createEl('span', { text: q.file.basename, cls: 'practice-queue-item-title' });

            const hue = Math.round(q.familiarity * 1.2);
            const famMarker = item.createEl('div', { cls: 'practice-queue-item-fam-dot' });
            famMarker.style.backgroundColor = `hsl(${hue}, 80%, 45%)`;

            item.onclick = () => {
                this.plugin.session.currentQIndex = idx;
                this.plugin.session.isFinished = false;
                this.plugin.session.showingAnswer = false;
                this.plugin.session.selectedChoices.clear();
                this.plugin.saveSession();
                this.plugin.refreshAllViews();
            };

            if (idx === this.plugin.session.currentQIndex) {
                setTimeout(() => item.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
            }
        });
    }
}
