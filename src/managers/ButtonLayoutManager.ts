import PracticePlugin from '../main';

export class ButtonLayoutManager {
    plugin: PracticePlugin;

    constructor(plugin: PracticePlugin) {
        this.plugin = plugin;
    }

    get isUnlocked(): boolean {
        return this.plugin.settings.unlockButtonLayout;
    }

    getPosition(buttonId: string): { x: number, y: number } | null {
        return this.plugin.settings.buttonLayouts[buttonId] || null;
    }

    async savePosition(buttonId: string, x: number, y: number) {
        this.plugin.settings.buttonLayouts[buttonId] = { x, y };
        await this.plugin.saveSettings();
    }
}
