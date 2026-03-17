import { WorkspaceLeaf } from 'obsidian';
import PracticePlugin from '../../main';
import { VIEW_TYPE_PRACTICE, VIEW_TYPE_CONTROL } from '../types';
import { PracticeView } from '../views/PracticeView';
import { QueueControlView } from '../views/QueueControlView';

export class ViewManager {
    plugin: PracticePlugin;

    constructor(plugin: PracticePlugin) {
        this.plugin = plugin;
    }

    async activateView() {
        const { workspace } = this.plugin.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_PRACTICE)[0];

        if (!leaf) {
            leaf = workspace.getLeaf('tab');
            await leaf.setViewState({ type: VIEW_TYPE_PRACTICE, active: true });
        }
        workspace.revealLeaf(leaf);
        
        this.activateControlView();
    }

    async activateControlView() {
        const { workspace } = this.plugin.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_CONTROL)[0];

        if (!leaf) {
            leaf = workspace.getRightLeaf(false) as WorkspaceLeaf;
            if (leaf) {
                await leaf.setViewState({ type: VIEW_TYPE_CONTROL, active: true });
            }
        }
        if (leaf) workspace.revealLeaf(leaf);
    }

    refreshAllViews() {
        this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_PRACTICE).forEach(l => (l.view as PracticeView).render());
        this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_CONTROL).forEach(l => (l.view as QueueControlView).render());
    }
}
