import { App, PluginSettingTab, Setting } from 'obsidian';
import PracticePlugin from '../main';

export class PracticeSettingTab extends PluginSettingTab {
    plugin: PracticePlugin;

    constructor(app: App, plugin: PracticePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        
        containerEl.createEl('h2', { text: 'Practice Plugin Settings' });
        containerEl.createEl('p', { text: 'Other practice settings (filters, re-insertion offsets, and visual preferences) are located in the Practice Control sidebar during practice sessions.' });

        new Setting(containerEl)
            .setName('Unlock Button Layout')
            .setDesc('Enable this to drag and move buttons (A/B/C/D and actions) in the Practice View. Turn off to resume normal practice mode.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.unlockButtonLayout)
                .onChange(async (value) => {
                    this.plugin.settings.unlockButtonLayout = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshAllViews();
                }));
    }
}
