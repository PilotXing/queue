import { ItemView, WorkspaceLeaf, MarkdownRenderer, Platform } from 'obsidian';
import PracticePlugin from '../main';
import { VIEW_TYPE_PRACTICE, QuestionMeta } from '../types';
import { DraggableButton } from '../components/DraggableButton';

export class PracticeView extends ItemView {
    plugin: PracticePlugin;
    boundKeydownHandler: (e: KeyboardEvent) => void;
    boundTouchStartHandler: (e: TouchEvent) => void;
    boundTouchEndHandler: (e: TouchEvent) => void;
    
    private touchStartY = 0;
    private touchStartTime = 0;

    // Draggable Instances
    private choiceButtons: DraggableButton[] = [];
    private actionButtons: DraggableButton[] = [];

    constructor(leaf: WorkspaceLeaf, plugin: PracticePlugin) {
        super(leaf);
        this.plugin = plugin;
        this.boundKeydownHandler = this.onKeydown.bind(this);
        this.boundTouchStartHandler = this.onTouchStart.bind(this);
        this.boundTouchEndHandler = this.onTouchEnd.bind(this);
    }

    getViewType() { return VIEW_TYPE_PRACTICE; }
    getDisplayText() { return 'Practice Question'; }
    getIcon() { return 'check-square'; }

    async onOpen() {
        document.addEventListener('keydown', this.boundKeydownHandler);
        this.contentEl.addEventListener('touchstart', this.boundTouchStartHandler, { passive: true });
        this.contentEl.addEventListener('touchend', this.boundTouchEndHandler, { passive: true });
        await this.render();
    }

    async onClose() {
        document.removeEventListener('keydown', this.boundKeydownHandler);
        this.contentEl.removeEventListener('touchstart', this.boundTouchStartHandler);
        this.contentEl.removeEventListener('touchend', this.boundTouchEndHandler);
    }

    onKeydown(e: KeyboardEvent) {
        // Disabled keys while in edit mode
        if (this.plugin.buttonManager.isUnlocked) return;

        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        if (this.app.workspace.activeLeaf?.view !== this) return;

        const key = e.key.toLowerCase();
        
        if (key === 'escape') {
            return;
        }

        const q = this.plugin.session.currentQueue[this.plugin.session.currentQIndex];
        if (!q) return;

        if (this.plugin.session.showingAnswer) {
            if (key === 'enter' || key === ' ') {
                this.plugin.session.nextQuestion(true);
                e.preventDefault();
            }
        } else {
            const letters = ['a', 'b', 'c', 'd', 'e', 'f'];
            const idx = letters.indexOf(key);
            if (idx !== -1 && idx < this.plugin.session.activeChoices.length) {
                this.toggleChoice(key.toUpperCase());
                e.preventDefault();
                return;
            }

            const num = parseInt(key, 10);
            if (!isNaN(num) && num >= 1 && num <= this.plugin.session.activeChoices.length) {
                const choiceChar = letters[num - 1].toUpperCase();
                this.toggleChoice(choiceChar);
                e.preventDefault();
                return;
            }

            if (key === 's') {
                this.plugin.session.showingAnswer = true;
                this.render();
                e.preventDefault();
            } else if (key === 'n') {
                this.setMastered(q);
                e.preventDefault();
            } else if (key === 'enter' && this.plugin.session.selectedChoices.size > 0) {
                this.gradeMultipleChoice();
                e.preventDefault();
            }
        }
    }

    private onTouchStart(e: TouchEvent) {
        if (e.changedTouches.length > 0) {
            this.touchStartY = e.changedTouches[0].screenY;
            this.touchStartTime = Date.now();
        }
    }

    private onTouchEnd(e: TouchEvent) {
        if (e.changedTouches.length > 0) {
            const touchEndY = e.changedTouches[0].screenY;
            const timeDiff = Date.now() - this.touchStartTime;
            const distance = this.touchStartY - touchEndY;
            
            // Fast swipe up (>50px in <400ms)
            if (distance > 50 && timeDiff < 400) { 
                this.handleSwipeUp();
            }
        }
    }

    private handleSwipeUp() {
        if (this.plugin.buttonManager.isUnlocked) return;
        if (this.plugin.session.isFinished) return;
        
        const qMeta = this.plugin.session.currentQueue[this.plugin.session.currentQIndex];
        if (!qMeta) return;

        const isSingle = qMeta.answer.length <= 1;

        if (this.plugin.session.showingAnswer) {
            this.plugin.session.nextQuestion(true);
        } else {
            if (isSingle) {
                this.plugin.session.showingAnswer = true;
                this.plugin.refreshAllViews();
            } else {
                if (this.plugin.session.selectedChoices.size > 0) {
                    this.gradeMultipleChoice();
                }
            }
        }
    }

    private toggleChoice(char: string) {
        if (this.plugin.buttonManager.isUnlocked) return;
        
        if (this.plugin.session.selectedChoices.has(char)) {
            this.plugin.session.selectedChoices.delete(char);
        } else {
            this.plugin.session.selectedChoices.add(char);
        }
        this.render();
    }

    private gradeMultipleChoice() {
        if (this.plugin.buttonManager.isUnlocked) return;

        const q = this.plugin.session.currentQueue[this.plugin.session.currentQIndex];
        const selected = Array.from(this.plugin.session.selectedChoices).sort().join('');
        const isCorrect = selected.toUpperCase() === q.answer.toUpperCase();
        this.plugin.session.handleGrading(q, isCorrect, selected);
    }

    private async setMastered(qMeta: QuestionMeta) {
        if (this.plugin.buttonManager.isUnlocked) return;

        qMeta.familiarity = 100;
        await this.app.fileManager.processFrontMatter(qMeta.file, (fm: any) => { fm.familiarity = 100; });
        this.plugin.session.nextQuestion(false);
        await this.plugin.session.autosaveSession();
    }

    async render() {
        const container = this.contentEl;
        container.empty();
        container.addClass('practice-view-root');
        
        // Apply theme class
        container.removeClass('theme-solarized-dark', 'theme-solarized-light', 'theme-dark-blue', 'theme-sepia', 'theme-clean', 'theme-default');
        container.addClass(`theme-${this.plugin.settings.theme}`);

        if (this.plugin.buttonManager.isUnlocked) {
            const banner = container.createEl('div', { cls: 'practice-edit-banner' });
            banner.setText('Layout Edit Mode Active: Drag buttons to reposition them. Toggle off in Settings to resume practice.');
        }

        if (this.plugin.session.isFinished) {
            this.renderSummary(container);
            return;
        }

        if (this.plugin.session.currentQueue.length === 0) {
            container.createEl('h3', { text: 'Empty Queue! Start by selecting a category in the sidebar.' });
            return;
        }

        const qMeta = this.plugin.session.currentQueue[this.plugin.session.currentQIndex];
        if (!qMeta) return;

        const mainLayout = container.createEl('div', { cls: 'practice-tab-layout' });
        
        // Vertical Progress Bar (VPB)
        const vpb = mainLayout.createEl('div', { cls: 'practice-vpb' });
        this.plugin.session.currentQueue.forEach((q, idx) => {
            const segment = vpb.createEl('div', { cls: 'vpb-segment' });
            if (idx === this.plugin.session.currentQIndex) segment.addClass('is-active');
            const result = this.plugin.session.sessionResults.get(q.file.path);
            if (result === 'correct') segment.addClass('is-correct');
            else if (result === 'wrong') segment.addClass('is-wrong');
            
            segment.onclick = () => {
                if(this.plugin.buttonManager.isUnlocked) return;
                this.plugin.session.currentQIndex = idx;
                this.plugin.session.showingAnswer = false;
                this.plugin.session.selectedChoices.clear();
                this.plugin.saveSession();
                this.plugin.refreshAllViews();
            };
        });

        const questionContent = mainLayout.createEl('div', { cls: 'practice-question-container' });
        
        // Apply visual settings
        questionContent.style.fontSize = `${this.plugin.settings.fontSize}px`;
        questionContent.style.color = this.plugin.settings.textColor;
        questionContent.style.backgroundColor = this.plugin.settings.bgColor;

        this.renderCurve(questionContent);
        await this.renderQuestion(questionContent, qMeta);
    }

    private renderSummary(container: HTMLElement) {
        const summary = container.createEl('div', { cls: 'practice-summary-view' });
        summary.createEl('h1', { text: 'Practice Finished!' });
        
        const stats = summary.createEl('div', { cls: 'practice-summary-stats' });
        const correct = stats.createEl('div', { cls: 'stat-item stat-correct' });
        correct.createEl('span', { text: this.plugin.session.correctAnswers.toString(), cls: 'stat-value' });
        correct.createEl('span', { text: 'Correct', cls: 'stat-label' });

        const wrong = stats.createEl('div', { cls: 'stat-item stat-wrong' });
        wrong.createEl('span', { text: this.plugin.session.wrongAnswers.toString(), cls: 'stat-value' });
        wrong.createEl('span', { text: 'Wrong / Skipped', cls: 'stat-label' });

        const actions = summary.createEl('div', { cls: 'practice-summary-actions' });
        const restartBtn = actions.createEl('button', { text: 'Restart Queue', cls: 'practice-btn-restart practice-flat-btn' });
        restartBtn.onclick = async () => {
            this.plugin.session.currentQIndex = 0;
            this.plugin.session.isFinished = false;
            this.plugin.session.correctAnswers = 0;
            this.plugin.session.wrongAnswers = 0;
            this.plugin.session.sessionResults.clear();
            this.plugin.refreshAllViews();
        };
    }

    private async renderHistoryBar(container: HTMLElement, qMeta: QuestionMeta) {
        const content = await this.app.vault.read(qMeta.file);
        const historyMatch = content.match(/\| Date \| Selected \| Correct\? \|\n\|---\|---\|---\|\n([\s\S]*?)(?:\n\n|\n$|$)/);
        
        const historyBar = container.createEl('div', { cls: 'practice-history-bar' });
        if (historyMatch) {
            const rows = historyMatch[1].trim().split('\n');
            rows.forEach(row => {
                const block = historyBar.createEl('div', { cls: 'history-block' });
                if (row.includes('✅')) block.addClass('is-correct');
                else if (row.includes('❌')) block.addClass('is-wrong');
            });
        }
    }

    private async renderQuestion(container: HTMLElement, qMeta: QuestionMeta) {
        const content = await this.app.vault.cachedRead(qMeta.file);
        const lines = content.split('\n');
        const isSingle = qMeta.answer.length <= 1;

        const firstChoiceIndex = lines.findIndex((l: string) => /^- [A-Z] /.test(l));
        const firstHeaderIndex = lines.findIndex((l: string) => l.startsWith('# '));
        
        let stemText = "";
        if (firstHeaderIndex !== -1 && firstHeaderIndex < firstChoiceIndex) {
            stemText = lines.slice(firstHeaderIndex, firstChoiceIndex).join('\n').trim();
        }

        this.plugin.session.activeChoices = [];
        const choicesRegex = /^- ([A-Z]) (.*)$/gm;
        let match;
        while ((match = choicesRegex.exec(content)) !== null) {
            this.plugin.session.activeChoices.push({ char: match[1], text: match[2].trim() });
        }

        const headerEl = container.createEl('div', { cls: 'practice-header' });
        headerEl.createEl('span', { text: `Q: ${this.plugin.session.currentQIndex + 1} / ${this.plugin.session.currentQueue.length}` });
        headerEl.createEl('span', { text: `Fam: ${qMeta.familiarity.toFixed(1)}%` });

        await this.renderHistoryBar(container, qMeta);

        const stemEl = container.createEl('div', { cls: 'practice-stem material-card flat-card' });
        await MarkdownRenderer.renderMarkdown(stemText, stemEl, qMeta.file.path, this);

        const choicesEl = container.createEl('div', { cls: 'practice-choices' });
        for (const choice of this.plugin.session.activeChoices) {
            const row = choicesEl.createEl('div', { cls: 'practice-choice material-card flat-card' });
            if (this.plugin.session.selectedChoices.has(choice.char)) row.addClass('practice-selected-choice');

            row.onclick = () => {
                if (this.plugin.buttonManager.isUnlocked) return;
                
                if (this.plugin.session.showingAnswer) {
                    if (isSingle && qMeta.answer.toUpperCase().includes(choice.char.toUpperCase())) {
                        this.plugin.session.nextQuestion(true);
                    }
                    return;
                }
                if (isSingle) {
                    const isCorrect = qMeta.answer.toUpperCase().includes(choice.char.toUpperCase());
                    this.plugin.session.handleGrading(qMeta, isCorrect, choice.char);
                } else {
                    this.toggleChoice(choice.char);
                }
            };

            const marker = row.createEl('span', { text: `${choice.char}. `, cls: 'practice-choice-marker' });
            if (this.plugin.session.selectedChoices.has(choice.char)) marker.setText('✓ ');

            await MarkdownRenderer.renderMarkdown(choice.text, row, qMeta.file.path, this);
            if (this.plugin.session.showingAnswer && qMeta.answer.toUpperCase().includes(choice.char.toUpperCase())) {
                row.addClass('practice-correct-choice');
            }
        }

        if (this.plugin.session.showingAnswer) {
            container.createEl('div', { text: `Answer: ${qMeta.answer}`, cls: 'practice-answer-reveal' });
        }

        // Render Free-floating GUI Buttons
        this.renderFloatingButtons(container, qMeta, isSingle);
    }

    private renderFloatingButtons(container: HTMLElement, qMeta: QuestionMeta, isSingle: boolean) {
        // Provide a dedicated plane for draggable buttons
        const floatingCanvas = container.createEl('div', { cls: 'practice-floating-canvas' });
        floatingCanvas.style.position = 'absolute';
        floatingCanvas.style.top = '0';
        floatingCanvas.style.left = '0';
        floatingCanvas.style.width = '100%';
        floatingCanvas.style.height = '100%';
        floatingCanvas.style.pointerEvents = 'none'; // Only buttons will capture events

        // Helper to append a DraggableButton and make it pointer-interactive
        const mountDraggable = (id: string, text: string, cls: string, onClick: () => void) => {
            const btn = new DraggableButton(floatingCanvas, this.plugin.buttonManager, id, text, `practice-flat-btn ${cls}`, onClick);
            btn.containerEl.style.pointerEvents = 'auto'; // allow dragging/clicking
            btn.containerEl.addClass('is-initializing'); // Hide initially
            return btn;
        };

        // Render ABCD buttons (Mobile only)
        this.choiceButtons = [];
        if (Platform.isMobile) {
            this.plugin.session.activeChoices.forEach((choice) => {
                const baseId = `btn_choice_${choice.char}`;
                const clsList = this.plugin.session.selectedChoices.has(choice.char) ? 'is-selected practice-btn-choice' : 'practice-btn-choice';
                
                const btn = mountDraggable(baseId, choice.char, clsList, () => {
                    if (this.plugin.session.showingAnswer) {
                        if (isSingle && qMeta.answer.toUpperCase().includes(choice.char.toUpperCase())) {
                            this.plugin.session.nextQuestion(true);
                        }
                        return;
                    }
                    if (isSingle) {
                        const isCorrect = qMeta.answer.toUpperCase().includes(choice.char.toUpperCase());
                        this.plugin.session.handleGrading(qMeta, isCorrect, choice.char);
                    } else {
                        this.toggleChoice(choice.char);
                    }
                });
                this.choiceButtons.push(btn);
            });
        }

        // Render Action Buttons
        this.actionButtons = [];
        
        if (this.plugin.session.showingAnswer) {
            if (!isSingle) {
                this.actionButtons.push(mountDraggable('btn_next', 'Next = >', 'practice-btn-wrong', () => {
                    this.plugin.session.nextQuestion(true);
                }));

                this.actionButtons.push(mountDraggable('btn_submit_corrected', 'Submit (Corrected)', 'practice-btn-submit', () => {
                    const selected = Array.from(this.plugin.session.selectedChoices).sort().join('');
                    if (selected.toUpperCase() === qMeta.answer.toUpperCase()) {
                        this.plugin.session.nextQuestion(true);
                    }
                }));
            }
        } else {
            if (!isSingle && !Platform.isMobile) {
                // Submit button only on desktop. Swept up on mobile.
                this.actionButtons.push(mountDraggable('btn_submit', 'Submit Answer', 'practice-btn-submit', () => {
                    this.gradeMultipleChoice();
                }));
            }
        }

        // Apply fallback positions to unpositioned buttons sequentially
        const applyDefaultLayout = () => {
            const containerWidth = container.offsetWidth || 800;
            const containerHeight = container.offsetHeight || 600;
            
            const allBtns = this.choiceButtons.concat(this.actionButtons);
            allBtns.forEach(btn => {
                btn.containerEl.addClass('no-transition');
            });

            // Reposition ABCDs (Mobile only) - Place ABOVE action buttons
            const choiceY = containerHeight - 110;
            let currentX = containerWidth - 30; 
            this.choiceButtons.forEach((btn) => {
                if (!this.plugin.buttonManager.getPosition(btn['buttonId'])) {
                    const btnWidth = btn.containerEl.offsetWidth || 40;
                    btn.containerEl.style.transform = `translate(${currentX - btnWidth}px, ${choiceY}px)`;
                    currentX -= btnWidth + 12;
                }
            });

            // Reposition Action buttons - Place at the VERY bottom
            const actionY = containerHeight - 60;
            currentX = containerWidth - 30; 
            this.actionButtons.slice().reverse().forEach((btn) => {
                if (!this.plugin.buttonManager.getPosition(btn['buttonId'])) {
                    const btnWidth = btn.containerEl.offsetWidth || 110;
                    btn.containerEl.style.transform = `translate(${currentX - btnWidth}px, ${actionY}px)`;
                    currentX -= btnWidth + 12;
                }
            });

            // Final reveal
            setTimeout(() => {
                allBtns.forEach(btn => {
                    btn.containerEl.removeClass('is-initializing');
                    btn.containerEl.removeClass('no-transition');
                });
            }, 50);
        };

        setTimeout(applyDefaultLayout, 250);
    }

    private renderCurve(container: HTMLElement) {
        const history = this.plugin.sessionManager.currentQueue.map((q: any) => q.familiarity);
        if (history.length === 0) return;

        const curveContainer = container.createEl('div', { cls: 'familiarity-curve-root' });
        const canvas = curveContainer.createEl('canvas');
        canvas.width = curveContainer.offsetWidth || 800;
        canvas.height = 60;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const rootStyle = getComputedStyle(curveContainer);
        const primaryColor = rootStyle.getPropertyValue('--flat-primary').trim() || '#268bd2';
        
        // Draw Area Gradient
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, primaryColor + '44'); // 25% opacity
        gradient.addColorStop(1, primaryColor + '00'); // Transparent

        const step = canvas.width / (history.length - 1 || 1);
        
        // Fill Area
        ctx.beginPath();
        ctx.moveTo(0, canvas.height);
        history.forEach((fam: number, i: number) => {
            const x = i * step;
            const y = canvas.height - (fam / 100 * canvas.height);
            ctx.lineTo(x, y);
        });
        ctx.lineTo(canvas.width, canvas.height);
        ctx.fillStyle = gradient;
        ctx.fill();

        // Draw Glowing Line
        ctx.beginPath();
        ctx.strokeStyle = primaryColor;
        ctx.lineWidth = 2.5;
        ctx.shadowBlur = 4;
        ctx.shadowColor = primaryColor;
        
        history.forEach((fam: number, i: number) => {
            const x = i * step;
            const y = canvas.height - (fam / 100 * canvas.height);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Markers for current question and milestones
        ctx.shadowBlur = 0;
    }
}
