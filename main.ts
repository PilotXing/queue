import {
    App,
    ItemView,
    Plugin,
    WorkspaceLeaf,
    MarkdownRenderer,
    TFile,
    moment,
    PluginSettingTab,
    TFolder,
    Platform,
    Notice,
    getAllTags,
    setIcon
} from 'obsidian';

import { sanitizeCategoryFilename } from './src/core/filename';
import { isQuestionTag } from './src/core/tag';
import { calculateNewFamiliarity, reinsertFailedQuestion } from './src/core/proficiency';
import { GradingLock } from './src/core/transaction';
import {
    SessionState,
    deserializeSessionState,
    parseMarkdownSession,
    quoteYamlString,
    serializeSessionState
} from './src/core/session';
import { appendHistoryRow } from './src/core/history';
import { Grade, Rating } from 'ts-fsrs';
import {
    QueueFsrsSettings,
    QueueFsrsStateV1,
    ResponseTimer,
    ResponseTimingSample,
    applyReviewGrade,
    calculateMedian,
    calculateRetrievability,
    createDefaultQueueFsrsSettings,
    createFsrsInstance,
    createNewQueueFsrsState,
    deserializeQueueFsrsState,
    inferRatingFromResponse,
    rankQueueItems,
    serializeQueueFsrsState,
    setMasteredState,
    validateFsrsParameters
} from './src/fsrs';
import {
    ShortAnswerCard,
    ShortAnswerHistoryEvent,
    UntrustedGradingOutput,
    createGradingCacheKey,
    evaluateGradingResult,
    executeGradingWithTimeout,
    executeRubricGenerationWithTimeout,
    finalizeGradingReview,
    isRubricValid,
    parseShortAnswerCard,
    updateShortAnswerReviewDocument,
    validateUntrustedRubricOutput,
    validateUntrustedGradingOutput
} from './src/short-answer';
import { LocalProxyGradingProvider } from './src/integration/localProxyGradingProvider';

export const VIEW_TYPE_PRACTICE = 'practice-view';
export const VIEW_TYPE_CONTROL = 'queue-control-view';

const THEMES = [
    { name: 'Solarized Light', text: '#657b83', bg: '#fdf6e3', card: '#eee8d5' },
    { name: 'Solarized Dark', text: '#839496', bg: '#002b36', card: '#073642' },
    { name: 'Dracula', text: '#f8f8f2', bg: '#282a36', card: '#44475a' },
    { name: 'GitHub Light', text: '#24292e', bg: '#ffffff', card: '#f6f8fa' },
    { name: 'One Dark', text: '#abb2bf', bg: '#282c34', card: '#353b45' },
    { name: 'Nord', text: '#d8dee9', bg: '#2e3440', card: '#3b4252' },
    { name: 'Gruvbox', text: '#ebdbb2', bg: '#282828', card: '#3c3836' },
    { name: 'Catppuccin', text: '#cdd6f4', bg: '#1e1e2e', card: '#313244' },
    { name: 'Default', text: 'var(--text-normal)', bg: 'var(--background-primary)', card: 'var(--background-secondary)' }
];

interface QuestionMeta {
    file: TFile;
    id: number;
    familiarity: number;
    answer: string;
    fsrsState: QueueFsrsStateV1;
    timingSamples: number[];
    rankingReason?: string;
    type: 'mcq' | 'short-answer';
}

interface TimingAuditEvent {
    timestamp: string;
    eventType: 'answer' | 'show-answer' | 'skip';
    selected: string;
    isCorrect: boolean;
    rating: number | null;
    wallClockDurationMs: number;
    activeDurationMs: number;
    isValid: boolean;
    isOutlier: boolean;
    ineligibleReason?: string;
}

interface PendingShortAnswerReview {
    filePath: string;
    card: ShortAnswerCard;
    submittedAnswer: string;
    timing: ResponseTimingSample;
    eventType: 'ai-grade' | 'manual-grade' | 'show-answer' | 'override';
    proposedRating: 1 | 2 | 3 | 4;
    score: number;
    feedback?: string;
    confidence?: number;
    provider?: string;
    model?: string;
    requiresConfirmation: boolean;
    confirmationMessage?: string;
    matchedPoints?: string[];
    missingPoints?: string[];
    materialErrors?: string[];
    completed?: boolean;
    finalRating?: 1 | 2 | 3 | 4;
}

interface PracticeSettings {
    failOffsets: string;
    savedQueuePaths: string[];
    savedIndex: number;
    fontSize: number;
    textColor: string;
    bgColor: string;
    cardColor: string;
    savedSessionState?: SessionState;
    fsrs: QueueFsrsSettings;
    learnerTimingSamples: number[];
    shortAnswer: {
        aiEnabled: boolean;
        endpoint: string;
        apiToken: string;
        model: string;
        timeoutMs: number;
        minConfidence: number;
        passThreshold: number;
        autoGenerateRubrics: boolean;
        rubricMinimumLength: number;
        cacheGradingResults: boolean;
        retainSubmittedAnswers: boolean;
        retainAiFeedback: boolean;
        gradingCache: Record<string, { output: UntrustedGradingOutput; cachedAt: string }>;
    };
}

const DEFAULT_SETTINGS: PracticeSettings = {
    failOffsets: "3, 10, -1",
    savedQueuePaths: [],
    savedIndex: 0,
    fontSize: 16,
    textColor: "var(--text-normal)",
    bgColor: "var(--background-primary)",
    cardColor: "var(--background-secondary)",
    fsrs: createDefaultQueueFsrsSettings(),
    learnerTimingSamples: [],
    shortAnswer: {
        aiEnabled: false,
        endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
        apiToken: '',
        model: '',
        timeoutMs: 30000,
        minConfidence: 0.80,
        passThreshold: 0.60,
        autoGenerateRubrics: true,
        rubricMinimumLength: 240,
        cacheGradingResults: true,
        retainSubmittedAnswers: true,
        retainAiFeedback: true,
        gradingCache: {}
    }
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

    // Transaction & Submission Lock Manager
    gradingLock: GradingLock = new GradingLock();
    responseTimer: ResponseTimer;
    timedQuestionPath: string | null = null;
    shortAnswerDrafts: Map<string, string> = new Map();
    pendingShortAnswer: PendingShortAnswerReview | null = null;

    async onload() {
        await this.loadSettings();
        this.responseTimer = new ResponseTimer(undefined, this.settings.fsrs.timing.outlierCutoffMs);

        this.registerDomEvent(document, 'visibilitychange', () => {
            if (document.hidden) this.responseTimer.pause();
            else this.responseTimer.resume();
        });

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

        // Initial queue load once layout & metadata cache are ready
        this.app.workspace.onLayoutReady(async () => {
            this.refreshCategories();
            if (this.settings.savedSessionState || this.settings.savedQueuePaths.length > 0) {
                await this.restoreSession();
            } else {
                this.refreshQueue();
            }
            this.refreshCategories();
            this.refreshAllViews();
        });

        // Listen for metadata cache resolution to populate categories
        this.registerEvent(
            this.app.metadataCache.on('resolved', () => {
                const hadNoCats = this.categories.length <= 1;
                this.refreshCategories();
                if (hadNoCats || this.currentQueue.length === 0) {
                    if (this.settings.savedSessionState || this.settings.savedQueuePaths.length > 0) {
                        this.restoreSession().then(() => this.refreshAllViews());
                    } else {
                        this.refreshQueue();
                    }
                } else {
                    this.refreshAllViews();
                }
            })
        );
    }

    private async onFileOpen(file: TFile | null) {
        if (!file) return;
        const cache = this.app.metadataCache.getFileCache(file);
        if (cache?.frontmatter?.type === 'practice_session') {
            await this.loadSessionFromFile(file);
        }
    }

    async loadSessionFromFile(file: TFile) {
        this.invalidateResponseTimer();
        this.pendingShortAnswer = null;
        this.shortAnswerDrafts.clear();
        const content = await this.app.vault.read(file);
        const cache = this.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter || {};

        const validFiles = new Map<string, TFile>();
        for (const f of this.app.vault.getMarkdownFiles()) {
            validFiles.set(f.path, f);
        }

        const parsed = parseMarkdownSession(content, fm, new Set(validFiles.keys()));

        this.filterCategory = parsed.filterCategory || "All";
        this.currentQIndex = parsed.savedIndex || 0;
        this.isFinished = parsed.isFinished || false;
        this.showingAnswer = parsed.showingAnswer || false;
        this.filterFamiliarity = parsed.filterFamiliarity ?? 100;
        this.correctAnswers = parsed.correctAnswers || 0;
        this.wrongAnswers = parsed.wrongAnswers || 0;
        this.selectedChoices = new Set(parsed.selectedChoices || []);
        this.sessionResults = new Map(parsed.sessionResults || []);

        this.currentQueue = [];
        for (const path of parsed.parsedPaths) {
            const qFile = validFiles.get(path);
            if (qFile) {
                const qCache = this.app.metadataCache.getFileCache(qFile);
                const qFm = qCache?.frontmatter || {};
                this.currentQueue.push(this.createQuestionMeta(qFile, qFm));
            }
        }

        if (this.currentQueue.length > 0) {
            await this.saveSession();
            await this.activateView();
            this.refreshAllViews();
        }
    }

    async loadSettings() {
        const loaded = (await this.loadData()) || {};
        const defaultFsrs = createDefaultQueueFsrsSettings();
        const loadedShort = loaded.shortAnswer && typeof loaded.shortAnswer === 'object'
            ? loaded.shortAnswer
            : {};
        const boundedNumber = (value: unknown, fallback: number, min: number, max: number) =>
            typeof value === 'number' && Number.isFinite(value)
                ? Math.max(min, Math.min(max, value))
                : fallback;
        this.settings = {
            ...DEFAULT_SETTINGS,
            ...loaded,
            fsrs: {
                ...defaultFsrs,
                ...(loaded.fsrs || {}),
                timing: {
                    ...defaultFsrs.timing,
                    ...(loaded.fsrs?.timing || {})
                },
                ranking: {
                    ...defaultFsrs.ranking,
                    ...(loaded.fsrs?.ranking || {})
                }
            },
            learnerTimingSamples: Array.isArray(loaded.learnerTimingSamples)
                ? loaded.learnerTimingSamples.filter((value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0)
                : [],
            shortAnswer: {
                ...DEFAULT_SETTINGS.shortAnswer,
                aiEnabled: loadedShort.aiEnabled === true,
                endpoint: typeof loadedShort.endpoint === 'string'
                    ? loadedShort.endpoint
                    : DEFAULT_SETTINGS.shortAnswer.endpoint,
                apiToken: typeof loadedShort.apiToken === 'string'
                    ? loadedShort.apiToken
                    : DEFAULT_SETTINGS.shortAnswer.apiToken,
                model: typeof loadedShort.model === 'string'
                    ? loadedShort.model
                    : DEFAULT_SETTINGS.shortAnswer.model,
                timeoutMs: Math.round(boundedNumber(loadedShort.timeoutMs, DEFAULT_SETTINGS.shortAnswer.timeoutMs, 1000, 120000)),
                minConfidence: boundedNumber(loadedShort.minConfidence, DEFAULT_SETTINGS.shortAnswer.minConfidence, 0, 1),
                passThreshold: boundedNumber(loadedShort.passThreshold, DEFAULT_SETTINGS.shortAnswer.passThreshold, 0, 1),
                autoGenerateRubrics: loadedShort.autoGenerateRubrics === undefined
                    ? DEFAULT_SETTINGS.shortAnswer.autoGenerateRubrics
                    : loadedShort.autoGenerateRubrics === true,
                rubricMinimumLength: Math.round(boundedNumber(loadedShort.rubricMinimumLength, DEFAULT_SETTINGS.shortAnswer.rubricMinimumLength, 80, 5000)),
                cacheGradingResults: loadedShort.cacheGradingResults === undefined
                    ? DEFAULT_SETTINGS.shortAnswer.cacheGradingResults
                    : loadedShort.cacheGradingResults === true,
                retainSubmittedAnswers: loadedShort.retainSubmittedAnswers === undefined
                    ? DEFAULT_SETTINGS.shortAnswer.retainSubmittedAnswers
                    : loadedShort.retainSubmittedAnswers === true,
                retainAiFeedback: loadedShort.retainAiFeedback === undefined
                    ? DEFAULT_SETTINGS.shortAnswer.retainAiFeedback
                    : loadedShort.retainAiFeedback === true,
                gradingCache: loadedShort.gradingCache
                    && typeof loadedShort.gradingCache === 'object'
                    && !Array.isArray(loadedShort.gradingCache)
                    ? loadedShort.gradingCache
                    : {}
            }
        };
        
        // Migration: If cardColor is default but bgColor matches a theme, fix it
        if (this.settings.cardColor === DEFAULT_SETTINGS.cardColor) {
            const matchedTheme = THEMES.find(t => t.bg === this.settings.bgColor);
            if (matchedTheme) {
                this.settings.cardColor = matchedTheme.card;
            }
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    private readTimingSamples(raw: unknown): number[] {
        const source = Array.isArray(raw)
            ? raw
            : (raw && typeof raw === 'object' && Array.isArray((raw as any).samples)
                ? (raw as any).samples
                : []);
        return source
            .filter((value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0)
            .slice(-this.settings.fsrs.timing.rollingWindowSize);
    }

    ensureResponseTimer(qMeta: QuestionMeta) {
        if (this.showingAnswer || this.isFinished) return;
        if (this.timedQuestionPath === qMeta.file.path) {
            if (!document.hidden) this.responseTimer.resume();
            return;
        }
        if (this.timedQuestionPath) this.responseTimer.invalidate('invalidated');
        this.responseTimer = new ResponseTimer(undefined, this.settings.fsrs.timing.outlierCutoffMs);
        this.timedQuestionPath = qMeta.file.path;
        this.responseTimer.start();
        if (document.hidden) this.responseTimer.pause();
    }

    invalidateResponseTimer() {
        if (this.timedQuestionPath) this.responseTimer.invalidate('invalidated');
        this.timedQuestionPath = null;
    }

    private finishResponseTimer(): ResponseTimingSample {
        const sample = this.responseTimer.submit();
        this.timedQuestionPath = null;
        return sample;
    }

    private createTimingEvent(
        sample: ResponseTimingSample,
        eventType: TimingAuditEvent['eventType'],
        selected: string,
        isCorrect: boolean,
        rating: Grade | null,
        timestamp: Date
    ): TimingAuditEvent {
        return {
            timestamp: timestamp.toISOString(),
            eventType,
            selected,
            isCorrect,
            rating: rating === null ? null : Number(rating),
            ...sample
        };
    }

    private createQuestionMeta(file: TFile, fm: Record<string, any>, now: Date = new Date()): QuestionMeta {
        const type = fm.type === 'short-answer' ? 'short-answer' : 'mcq';
        const rawFsrs = type === 'short-answer' ? fm.fsrs : fm.queue_fsrs;
        let fsrsState = rawFsrs
            ? deserializeQueueFsrsState(rawFsrs, now)
            : createNewQueueFsrsState(now);
        if (!rawFsrs && fm.familiarity === 100) {
            fsrsState = setMasteredState(fsrsState, true);
        }

        const legacyFamiliarity = typeof fm.queue_legacy_familiarity === 'number'
            ? fm.queue_legacy_familiarity
            : (fm.familiarity ?? 50);
        const familiarity = this.settings.fsrs.legacyScheduler
            ? legacyFamiliarity
            : calculateRetrievability(fsrsState, now, createFsrsInstance(this.settings.fsrs)) * 100;

        return {
            file,
            id: fm.id || 0,
            familiarity,
            answer: fm.answer?.toString() || '',
            fsrsState,
            timingSamples: this.readTimingSamples(fm.queue_timing),
            type
        };
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

    refreshCategories(): string[] {
        const cats = new Set<string>();
        const files = this.app.vault.getMarkdownFiles();
        for (const file of files) {
            const cache = this.app.metadataCache.getFileCache(file);
            if (!cache) continue;
            const tags = getAllTags(cache) ?? cache.frontmatter?.tags ?? cache.frontmatter?.tag;
            if (isQuestionTag(tags)) {
                const category = cache.frontmatter?.category || "Uncategorized";
                cats.add(category);
            }
        }
        this.categories = ["All", ...Array.from(cats).sort()];
        return this.categories;
    }

    refreshQueue() {
        this.invalidateResponseTimer();
        this.currentQueue = [];
        const files = this.app.vault.getMarkdownFiles();
        const cats = new Set<string>();
        const now = new Date();
        const fsrsInstance = createFsrsInstance(this.settings.fsrs);

        for (const file of files) {
            const cache = this.app.metadataCache.getFileCache(file);
            if (!cache) continue;
            const tags = getAllTags(cache) ?? cache.frontmatter?.tags ?? cache.frontmatter?.tag;

            if (isQuestionTag(tags)) {
                const fm = cache.frontmatter || {};
                const category = fm.category || "Uncategorized";
                cats.add(category);

                if (this.filterCategory !== "All" && category !== this.filterCategory) continue;

                const qMeta = this.createQuestionMeta(file, fm, now);
                if (qMeta.familiarity > this.filterFamiliarity) continue;

                if (this.settings.fsrs.legacyScheduler) {
                    if (qMeta.familiarity < 100 || this.settings.fsrs.ranking.includeMastered) {
                        this.currentQueue.push(qMeta);
                    }
                } else if (!qMeta.fsrsState.mastered || this.settings.fsrs.ranking.includeMastered) {
                    this.currentQueue.push(qMeta);
                }
            }
        }

        this.categories = ["All", ...Array.from(cats).sort()];
        if (this.settings.fsrs.legacyScheduler) {
            this.currentQueue.sort((a, b) => a.familiarity - b.familiarity);
        } else {
            const byPath = new Map(this.currentQueue.map(question => [question.file.path, question]));
            this.currentQueue = rankQueueItems(
                this.currentQueue.map(question => ({ id: question.file.path, state: question.fsrsState })),
                now,
                fsrsInstance,
                this.settings.fsrs.ranking,
                Math.floor(now.getTime() / 86400000)
            ).map(ranked => {
                const question = byPath.get(ranked.id)!;
                question.familiarity = ranked.retrievability * 100;
                question.rankingReason = ranked.reason;
                return question;
            });
        }
        const sessionLimit = Math.max(0, Math.floor(this.settings.fsrs.ranking.sessionLimit));
        if (sessionLimit > 0) {
            this.currentQueue = this.currentQueue.slice(0, sessionLimit);
        }
        this.currentQIndex = 0;
        this.isFinished = false;
        this.showingAnswer = false;
        this.correctAnswers = 0;
        this.wrongAnswers = 0;
        this.sessionResults.clear();
        this.selectedChoices.clear();
        this.pendingShortAnswer = null;
        this.shortAnswerDrafts.clear();
        this.persistSessionCopies();
        this.refreshAllViews();
    }

    private createSessionState(): SessionState {
        return {
            version: 1,
            savedQueuePaths: this.currentQueue.map(q => q.file.path),
            savedIndex: this.currentQIndex,
            filterCategory: this.filterCategory,
            filterFamiliarity: this.filterFamiliarity,
            isFinished: this.isFinished,
            showingAnswer: this.showingAnswer,
            selectedChoices: Array.from(this.selectedChoices),
            correctAnswers: this.correctAnswers,
            wrongAnswers: this.wrongAnswers,
            sessionResults: Array.from(this.sessionResults.entries())
        };
    }

    async saveSession() {
        const state = this.createSessionState();

        this.settings.savedSessionState = state;
        this.settings.savedQueuePaths = state.savedQueuePaths;
        this.settings.savedIndex = state.savedIndex;
        await this.saveSettings();
    }

    async persistSessionCopies() {
        const failures: unknown[] = [];
        try {
            await this.autosaveSession();
        } catch (error) {
            failures.push(error);
            console.error('Queue: Markdown session autosave failed', error);
        }
        try {
            await this.saveSession();
        } catch (error) {
            failures.push(error);
            console.error('Queue: plugin session save failed', error);
        }
        if (failures.length > 0) {
            new Notice('Queue recorded the action, but one session backup failed. See the developer console for details.');
        }
    }

    async restoreSession() {
        this.invalidateResponseTimer();
        this.pendingShortAnswer = null;
        this.shortAnswerDrafts.clear();
        const validFiles = new Map<string, TFile>();
        for (const f of this.app.vault.getMarkdownFiles()) {
            validFiles.set(f.path, f);
        }

        let state: SessionState;
        if (this.settings.savedSessionState) {
            state = deserializeSessionState(this.settings.savedSessionState, new Set(validFiles.keys()));
        } else {
            state = deserializeSessionState({
                savedQueuePaths: this.settings.savedQueuePaths,
                savedIndex: this.settings.savedIndex
            }, new Set(validFiles.keys()));
        }

        this.currentQueue = [];
        for (const path of state.savedQueuePaths) {
            const file = validFiles.get(path);
            if (file) {
                const cache = this.app.metadataCache.getFileCache(file);
                const fm = cache?.frontmatter || {};
                this.currentQueue.push(this.createQuestionMeta(file, fm));
            }
        }

        this.currentQIndex = state.savedIndex;
        this.filterCategory = state.filterCategory;
        this.filterFamiliarity = state.filterFamiliarity;
        this.isFinished = state.isFinished;
        this.showingAnswer = state.showingAnswer;
        this.selectedChoices = new Set(state.selectedChoices);
        this.correctAnswers = state.correctAnswers;
        this.wrongAnswers = state.wrongAnswers;
        this.sessionResults = new Map(state.sessionResults);

        this.refreshCategories();
        if (this.currentQueue.length === 0 && validFiles.size > 0) {
            this.refreshQueue();
        }
    }

    async autosaveSession() {
        const timestamp = (moment as any)().format("YYYY-MM-DD_HH-mm-ss");
        const folderPath = "Practice_Sessions";
        if (!(this.app.vault.getAbstractFileByPath(folderPath) instanceof TFolder)) {
            await this.app.vault.createFolder(folderPath);
        }

        const fileName = sanitizeCategoryFilename(this.filterCategory);
        const path = `${folderPath}/autosave_${fileName}.md`;
        const state = this.createSessionState();
        
        const links = this.currentQueue.map(q => `[[${q.file.path}|${q.file.basename}]]`).join('\n');
        const content = `---
type: practice_session
version: 1
sessionState: ${quoteYamlString(serializeSessionState(state))}
currentIndex: ${this.currentQIndex}
isFinished: ${this.isFinished}
showingAnswer: ${this.showingAnswer}
category: ${quoteYamlString(this.filterCategory)}
filterFamiliarity: ${this.filterFamiliarity}
correctAnswers: ${this.correctAnswers}
wrongAnswers: ${this.wrongAnswers}
selectedChoices: ${JSON.stringify(Array.from(this.selectedChoices))}
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

    private async executeUserAction(label: string, action: () => Promise<void>) {
        try {
            return await this.gradingLock.executeTransaction(action);
        } catch (error) {
            console.error(`Queue: ${label} failed`, error);
            new Notice(`Queue could not ${label}. Check the question note before trying again.`);
            return { executed: true };
        } finally {
            await this.refreshAllViews();
        }
    }

    private async persistGrade(
        qMeta: QuestionMeta,
        newFamiliarity: number,
        isCorrect: boolean,
        answerStr: string,
        fsrsState: QueueFsrsStateV1,
        timingEvent: TimingAuditEvent
    ) {
        let previousStoredFamiliarity: unknown;
        let previousLegacyFamiliarity: unknown;
        let previousFsrs: unknown;
        let previousTiming: unknown;
        await this.app.fileManager.processFrontMatter(qMeta.file, (fm) => {
            previousStoredFamiliarity = fm.familiarity;
            previousLegacyFamiliarity = fm.queue_legacy_familiarity;
            previousFsrs = fm.queue_fsrs === undefined ? undefined : JSON.parse(JSON.stringify(fm.queue_fsrs));
            previousTiming = fm.queue_timing === undefined ? undefined : JSON.parse(JSON.stringify(fm.queue_timing));
            fm.familiarity = newFamiliarity;
            if (this.settings.fsrs.legacyScheduler) {
                fm.queue_legacy_familiarity = newFamiliarity;
            } else if (fm.queue_legacy_familiarity === undefined) {
                fm.queue_legacy_familiarity = typeof previousStoredFamiliarity === 'number'
                    ? previousStoredFamiliarity
                    : 50;
            }
            fm.queue_fsrs = serializeQueueFsrsState(fsrsState);
            const priorEvents = Array.isArray(fm.queue_timing?.events) ? fm.queue_timing.events : [];
            const priorSamples = Array.isArray(fm.queue_timing?.samples) ? fm.queue_timing.samples : [];
            fm.queue_timing = {
                version: 1,
                samples: timingEvent.isValid
                    ? [...priorSamples, timingEvent.activeDurationMs].slice(-this.settings.fsrs.timing.rollingWindowSize)
                    : priorSamples.slice(-this.settings.fsrs.timing.rollingWindowSize),
                events: [...priorEvents, timingEvent]
            };
        });

        try {
            await this.recordHistory(qMeta, isCorrect, answerStr);
        } catch (error) {
            try {
                await this.app.fileManager.processFrontMatter(qMeta.file, (fm) => {
                    if (previousStoredFamiliarity === undefined) delete fm.familiarity;
                    else fm.familiarity = previousStoredFamiliarity;
                    if (previousLegacyFamiliarity === undefined) delete fm.queue_legacy_familiarity;
                    else fm.queue_legacy_familiarity = previousLegacyFamiliarity;
                    if (previousFsrs === undefined) delete fm.queue_fsrs;
                    else fm.queue_fsrs = previousFsrs;
                    if (previousTiming === undefined) delete fm.queue_timing;
                    else fm.queue_timing = previousTiming;
                });
            } catch (rollbackError) {
                console.error('Queue: failed to roll back familiarity after history write failure', rollbackError);
            }
            throw error;
        }

        qMeta.familiarity = newFamiliarity;
        qMeta.fsrsState = fsrsState;
        if (timingEvent.isValid) {
            qMeta.timingSamples = [...qMeta.timingSamples, timingEvent.activeDurationMs]
                .slice(-this.settings.fsrs.timing.rollingWindowSize);
            this.settings.learnerTimingSamples = [
                ...this.settings.learnerTimingSamples,
                timingEvent.activeDurationMs
            ].slice(-this.settings.fsrs.timing.rollingWindowSize);
        }
    }

    async handleGrading(qMeta: QuestionMeta, isCorrect: boolean, answerStr: string) {
        return await this.executeUserAction('record the answer', async () => {
            const reviewTime = new Date();
            const timingSample = this.finishResponseTimer();
            const inference = inferRatingFromResponse({
                isCorrect,
                measuredActiveDurationMs: timingSample.activeDurationMs,
                questionHistoricalDurationsMs: qMeta.timingSamples,
                learnerHistoricalDurationsMs: this.settings.learnerTimingSamples,
                settings: this.settings.fsrs.timing,
                isEligibleSample: timingSample.isValid
            });
            const rating = (inference.grade ?? Rating.Good) as Grade;

            const fsrsInstance = createFsrsInstance(this.settings.fsrs);
            const review = applyReviewGrade(
                qMeta.fsrsState,
                rating,
                reviewTime,
                fsrsInstance,
                this.settings.fsrs
            );
            const nextFsrsState = review.nextState;
            const newFam = this.settings.fsrs.legacyScheduler
                ? calculateNewFamiliarity(qMeta.familiarity, isCorrect)
                : calculateRetrievability(nextFsrsState, reviewTime, fsrsInstance) * 100;
            const timingEvent = this.createTimingEvent(
                timingSample,
                'answer',
                answerStr,
                isCorrect,
                rating,
                reviewTime
            );
            await this.persistGrade(qMeta, newFam, isCorrect, answerStr, nextFsrsState, timingEvent);

            this.sessionResults.set(qMeta.file.path, isCorrect ? 'correct' : 'wrong');
            if (isCorrect) {
                this.correctAnswers++;
                if (this.currentQIndex >= this.currentQueue.length - 1) {
                    this.isFinished = true;
                } else {
                    this.currentQIndex++;
                }
                this.showingAnswer = false;
                this.selectedChoices.clear();
            } else {
                this.wrongAnswers++;
                this.showingAnswer = true;
            }

            await this.persistSessionCopies();
            this.refreshAllViews();
        });
    }

    async beginShortAnswerReview(qMeta: QuestionMeta, card: ShortAnswerCard, submittedAnswer: string) {
        if (!submittedAnswer.trim()) {
            new Notice('Enter an answer before grading.');
            return;
        }

        return await this.executeUserAction('grade the short answer', async () => {
            const timing = this.finishResponseTimer();
            const referenceAnswer = card.referenceAnswer?.trim();
            const manualPending: PendingShortAnswerReview = {
                filePath: qMeta.file.path,
                card,
                submittedAnswer,
                timing,
                eventType: 'manual-grade',
                proposedRating: 3,
                score: 1,
                requiresConfirmation: true,
                confirmationMessage: referenceAnswer
                    ? 'Compare your answer with the reference, then choose a rating.'
                    : 'No reference answer is available. Choose a self-assessment rating.'
            };

            const ai = this.settings.shortAnswer;
            if (!ai.aiEnabled || !ai.model.trim() || !referenceAnswer) {
                this.pendingShortAnswer = manualPending;
                this.showingAnswer = true;
                this.refreshAllViews();
                return;
            }

            const provider = new LocalProxyGradingProvider(ai.endpoint, ai.model, ai.apiToken);
            let rubric = card.frontmatter.rubric;
            if (rubric && !isRubricValid(rubric, referenceAnswer)) {
                rubric = undefined;
                card.frontmatter.rubric = undefined;
                try {
                    await this.app.fileManager.processFrontMatter(qMeta.file, fm => {
                        delete fm.rubric;
                    });
                } catch (error) {
                    console.warn('Queue: stale rubric could not be removed from frontmatter', error);
                }
            }
            if (
                ai.autoGenerateRubrics
                && referenceAnswer.length >= ai.rubricMinimumLength
                && !rubric
            ) {
                const generated = await executeRubricGenerationWithTimeout(provider, {
                    question: card.question,
                    referenceAnswer
                }, ai.timeoutMs);
                if (generated.output) {
                    const validatedRubric = validateUntrustedRubricOutput(
                        generated.output,
                        referenceAnswer,
                        provider.modelId
                    );
                    if (validatedRubric.rubric) {
                        rubric = validatedRubric.rubric;
                        card.frontmatter.rubric = rubric;
                        try {
                            await this.app.fileManager.processFrontMatter(qMeta.file, fm => {
                                fm.rubric = rubric;
                            });
                        } catch (error) {
                            console.warn('Queue: generated rubric could not be cached in frontmatter', error);
                        }
                    }
                }
            }

            const questionMedian = qMeta.timingSamples.length >= this.settings.fsrs.timing.minSamplesPerQuestion
                ? calculateMedian(qMeta.timingSamples)
                : null;
            const learnerMedian = calculateMedian(this.settings.learnerTimingSamples);
            const cacheKey = createGradingCacheKey(
                card.frontmatter.queue_id,
                referenceAnswer,
                submittedAnswer,
                provider.providerId,
                provider.modelId,
                rubric?.referenceHash
            );
            let gradingOutput = ai.cacheGradingResults
                ? ai.gradingCache[cacheKey]?.output
                : undefined;
            if (gradingOutput && !validateUntrustedGradingOutput(gradingOutput).result) {
                delete ai.gradingCache[cacheKey];
                gradingOutput = undefined;
            }

            if (!gradingOutput) {
                const execution = await executeGradingWithTimeout(provider, {
                    question: card.question,
                    referenceAnswer,
                    rubric,
                    submittedAnswer,
                    timeContext: {
                        activeDurationMs: timing.activeDurationMs,
                        wallDurationMs: timing.wallClockDurationMs,
                        questionMedianMs: questionMedian ?? undefined,
                        learnerBaselineMs: learnerMedian ?? this.settings.fsrs.timing.defaultLearnerMedianMs
                    }
                }, ai.timeoutMs);

                if (!execution.output) {
                    console.error('Queue: AI grading failed', execution.error);
                    const reasonText = execution.error?.message || execution.errorReason || 'provider error';
                    this.pendingShortAnswer = {
                        ...manualPending,
                        confirmationMessage: `AI grading unavailable (${reasonText}). Please grade manually.`
                    };
                    this.showingAnswer = true;
                    this.refreshAllViews();
                    return;
                }
                gradingOutput = execution.output;
            }

            const validation = validateUntrustedGradingOutput(gradingOutput);
            if (validation.result && ai.cacheGradingResults && !ai.gradingCache[cacheKey]) {
                const outputForCache: UntrustedGradingOutput = {
                    ...gradingOutput,
                    feedback: ai.retainAiFeedback ? gradingOutput.feedback : ''
                };
                ai.gradingCache[cacheKey] = {
                    output: outputForCache,
                    cachedAt: new Date().toISOString()
                };
                const keys = Object.keys(ai.gradingCache)
                    .sort((a, b) => ai.gradingCache[a].cachedAt.localeCompare(ai.gradingCache[b].cachedAt));
                for (const staleKey of keys.slice(0, Math.max(0, keys.length - 250))) {
                    delete ai.gradingCache[staleKey];
                }
                try {
                    await this.saveSettings();
                } catch (error) {
                    console.warn('Queue: grading result cache could not be saved', error);
                }
            }
            const evaluation = evaluateGradingResult(validation.result, {
                minConfidenceThreshold: ai.minConfidence,
                passThreshold: ai.passThreshold,
                thresholdMargin: 0.15,
                easyTimeRatio: this.settings.fsrs.timing.easyRatio,
                hardTimeRatio: this.settings.fsrs.timing.hardRatio
            }, {
                activeDurationMs: timing.activeDurationMs,
                wallDurationMs: timing.wallClockDurationMs,
                questionMedianMs: questionMedian ?? undefined,
                learnerBaselineMs: learnerMedian ?? this.settings.fsrs.timing.defaultLearnerMedianMs
            });

            if (!evaluation.gradingResult) {
                this.pendingShortAnswer = {
                    ...manualPending,
                    confirmationMessage: 'AI returned malformed output. Please grade manually.'
                };
                this.showingAnswer = true;
                this.refreshAllViews();
                return;
            }

            const result = evaluation.gradingResult;
            const pending: PendingShortAnswerReview = {
                filePath: qMeta.file.path,
                card,
                submittedAnswer,
                timing,
                eventType: 'ai-grade',
                proposedRating: result.proposedRating,
                score: result.score,
                feedback: result.conciseFeedback,
                confidence: result.confidence,
                provider: provider.providerId,
                model: provider.modelId,
                requiresConfirmation: evaluation.requiresManualConfirmation,
                confirmationMessage: evaluation.requiresManualConfirmation
                    ? `Please confirm: ${evaluation.confirmationReasons.join(', ')}`
                    : undefined,
                matchedPoints: result.matchedPoints,
                missingPoints: result.missingPoints,
                materialErrors: result.materialErrors
            };

            this.pendingShortAnswer = pending;
            this.showingAnswer = true;
            this.refreshAllViews();
        });
    }

    async confirmShortAnswerRating(qMeta: QuestionMeta, finalRating: 1 | 2 | 3 | 4) {
        const pending = this.pendingShortAnswer;
        if (!pending || pending.filePath !== qMeta.file.path) return;
        return await this.executeUserAction('save the short-answer review', async () => {
            await this.completeShortAnswerReview(qMeta, pending, finalRating);
        });
    }

    private async completeShortAnswerReview(
        qMeta: QuestionMeta,
        pending: PendingShortAnswerReview,
        finalRating: 1 | 2 | 3 | 4
    ) {
        const now = new Date();
        const currentState = serializeQueueFsrsState(qMeta.fsrsState);
        const reviewId = globalThis.crypto?.randomUUID?.()
            || `queue-${now.getTime()}-${Math.random().toString(36).slice(2)}`;
        const score = pending.eventType === 'manual-grade'
            ? ({ 1: 0, 2: 0.6, 3: 0.85, 4: 1 } as const)[finalRating]
            : pending.score;
        const eventType = pending.provider && pending.proposedRating !== finalRating
            ? 'override'
            : pending.eventType;
        const finalization = finalizeGradingReview({
            reviewId,
            now,
            wallDurationMs: pending.timing.wallClockDurationMs,
            activeDurationMs: pending.timing.activeDurationMs,
            submittedAnswer: this.settings.shortAnswer.retainSubmittedAnswers
                ? pending.submittedAnswer
                : '',
            eventType,
            score,
            isCorrect: finalRating !== 1,
            aiFeedback: this.settings.shortAnswer.retainAiFeedback
                ? pending.feedback
                : undefined,
            confidence: pending.confidence,
            proposedRating: pending.proposedRating,
            finalRating,
            provider: pending.provider,
            model: pending.model,
            rubricMetadata: pending.card.frontmatter.rubric,
            currentFsrsState: currentState,
            fsrsSettings: this.settings.fsrs
        });
        const historyEvent: ShortAnswerHistoryEvent = {
            ...finalization.historyEvent,
            timingValid: pending.timing.isValid,
            timingOutlier: pending.timing.isOutlier,
            timingIneligibleReason: pending.timing.ineligibleReason,
            matchedPoints: pending.matchedPoints,
            missingPoints: pending.missingPoints,
            materialErrors: pending.materialErrors
        };

        const nextInMemory = deserializeQueueFsrsState(finalization.nextFsrsState, now);
        const newFamiliarity = calculateRetrievability(
            nextInMemory,
            now,
            createFsrsInstance(this.settings.fsrs)
        ) * 100;

        await this.app.vault.process(qMeta.file, content => {
            const updated = updateShortAnswerReviewDocument(
                content,
                finalization.nextFsrsState,
                newFamiliarity,
                historyEvent
            );
            if (!updated.appended) {
                throw new Error(updated.diagnostics.map(item => item.message).join('; ') || 'History event was not appended.');
            }
            return updated.content;
        });

        qMeta.fsrsState = nextInMemory;
        qMeta.familiarity = newFamiliarity;
        if (pending.timing.isValid) {
            qMeta.timingSamples = [...qMeta.timingSamples, pending.timing.activeDurationMs]
                .slice(-this.settings.fsrs.timing.rollingWindowSize);
            this.settings.learnerTimingSamples = [...this.settings.learnerTimingSamples, pending.timing.activeDurationMs]
                .slice(-this.settings.fsrs.timing.rollingWindowSize);
        }
        const isCorrect = finalRating !== 1;
        this.sessionResults.set(qMeta.file.path, isCorrect ? 'correct' : 'wrong');
        if (isCorrect) {
            this.correctAnswers++;
        } else {
            this.wrongAnswers++;
        }

        this.shortAnswerDrafts.delete(qMeta.file.path);
        this.pendingShortAnswer = null;
        this.showingAnswer = false;

        // User requirement: Only reinsert into queue if score is below 80% (0.80) or rating is Again (1)
        const shouldReinsert = finalRating === 1 || score < 0.80;

        if (shouldReinsert) {
            this.currentQueue = reinsertFailedQuestion(
                this.currentQueue,
                this.currentQIndex,
                this.settings.failOffsets
            );
            this.currentQIndex = Math.min(this.currentQIndex, Math.max(0, this.currentQueue.length - 1));
            this.isFinished = this.currentQueue.length === 0;
        } else {
            if (this.currentQIndex >= this.currentQueue.length - 1) {
                this.isFinished = true;
            } else {
                this.currentQIndex++;
            }
        }

        await this.persistSessionCopies();
        this.refreshAllViews();
    }

    private async handleShortAnswerShowAnswer(qMeta: QuestionMeta) {
        const parsed = parseShortAnswerCard(await this.app.vault.read(qMeta.file));
        if (!parsed.card) throw new Error('The short-answer question file is invalid.');
        const timing = this.finishResponseTimer();
        const pending: PendingShortAnswerReview = {
            filePath: qMeta.file.path,
            card: parsed.card,
            submittedAnswer: this.shortAnswerDrafts.get(qMeta.file.path) || '',
            timing,
            eventType: 'show-answer',
            proposedRating: 1,
            score: 0,
            requiresConfirmation: false
        };
        await this.completeShortAnswerReview(qMeta, pending, 1);
    }

    async handleShowAnswer() {
        if (this.currentQueue.length === 0 || this.currentQIndex >= this.currentQueue.length) return;
        const qMeta = this.currentQueue[this.currentQIndex];
        if (!qMeta) return;

        if (qMeta.type === 'short-answer') {
            return await this.executeUserAction('show the short-answer reference', async () => {
                await this.handleShortAnswerShowAnswer(qMeta);
            });
        }

        return await this.executeUserAction('show the answer', async () => {
            const reviewTime = new Date();
            const timingSample = this.finishResponseTimer();
            const rating = Rating.Again as Grade;
            const fsrsInstance = createFsrsInstance(this.settings.fsrs);
            const review = applyReviewGrade(
                qMeta.fsrsState,
                rating,
                reviewTime,
                fsrsInstance,
                this.settings.fsrs
            );
            const nextFsrsState = review.nextState;
            const newFam = this.settings.fsrs.legacyScheduler
                ? calculateNewFamiliarity(qMeta.familiarity, false)
                : calculateRetrievability(nextFsrsState, reviewTime, fsrsInstance) * 100;
            const timingEvent = this.createTimingEvent(
                timingSample,
                'show-answer',
                'S',
                false,
                rating,
                reviewTime
            );
            await this.persistGrade(qMeta, newFam, false, 'S', nextFsrsState, timingEvent);

            this.sessionResults.set(qMeta.file.path, 'wrong');
            this.wrongAnswers++;
            this.showingAnswer = true;

            await this.persistSessionCopies();
            this.refreshAllViews();
        });
    }

    async setMastered(qMeta: QuestionMeta) {
        return await this.executeUserAction('mark the question as mastered', async () => {
            const reviewTime = new Date();
            const timingSample = this.finishResponseTimer();
            const masteredState = setMasteredState(qMeta.fsrsState, true);
            const timingEvent = this.createTimingEvent(timingSample, 'skip', 'N', true, null, reviewTime);
            await this.app.fileManager.processFrontMatter(qMeta.file, (fm) => {
                fm.familiarity = 100;
                fm.queue_legacy_familiarity = 100;
                if (qMeta.type === 'short-answer') {
                    fm.fsrs = serializeQueueFsrsState(masteredState);
                    return;
                }
                fm.queue_fsrs = serializeQueueFsrsState(masteredState);
                const priorEvents = Array.isArray(fm.queue_timing?.events) ? fm.queue_timing.events : [];
                const priorSamples = Array.isArray(fm.queue_timing?.samples) ? fm.queue_timing.samples : [];
                fm.queue_timing = {
                    version: 1,
                    samples: timingEvent.isValid
                        ? [...priorSamples, timingEvent.activeDurationMs].slice(-this.settings.fsrs.timing.rollingWindowSize)
                        : priorSamples.slice(-this.settings.fsrs.timing.rollingWindowSize),
                    events: [...priorEvents, timingEvent]
                };
            });
            qMeta.familiarity = 100;
            qMeta.fsrsState = masteredState;
            if (qMeta.type === 'mcq' && timingEvent.isValid) {
                qMeta.timingSamples = [...qMeta.timingSamples, timingEvent.activeDurationMs]
                    .slice(-this.settings.fsrs.timing.rollingWindowSize);
                this.settings.learnerTimingSamples = [...this.settings.learnerTimingSamples, timingEvent.activeDurationMs]
                    .slice(-this.settings.fsrs.timing.rollingWindowSize);
            }
            if (qMeta.type === 'short-answer') {
                this.shortAnswerDrafts.delete(qMeta.file.path);
                if (this.pendingShortAnswer?.filePath === qMeta.file.path) {
                    this.pendingShortAnswer = null;
                }
            }
            if (this.currentQIndex >= this.currentQueue.length - 1) {
                this.isFinished = true;
            } else {
                this.currentQIndex++;
            }
            this.showingAnswer = false;
            this.selectedChoices.clear();
            await this.persistSessionCopies();
            this.refreshAllViews();
        });
    }

    async advanceAfterFailure() {
        return await this.executeUserAction('advance to the next question', async () => {
            const failedQuestion = this.currentQueue[this.currentQIndex];
            if (failedQuestion?.type === 'short-answer') {
                this.shortAnswerDrafts.delete(failedQuestion.file.path);
                if (this.pendingShortAnswer?.filePath === failedQuestion.file.path) {
                    this.pendingShortAnswer = null;
                }
            }
            this.currentQueue = reinsertFailedQuestion(
                this.currentQueue,
                this.currentQIndex,
                this.settings.failOffsets
            );
            this.showingAnswer = false;
            this.selectedChoices.clear();
            this.currentQIndex = Math.min(this.currentQIndex, Math.max(0, this.currentQueue.length - 1));
            this.isFinished = this.currentQueue.length === 0;
            await this.persistSessionCopies();
            this.refreshAllViews();
        });
    }

    async recordHistory(qMeta: QuestionMeta, isCorrect: boolean, answerStr: string) {
        const ts = (moment as any)().format("YYYY-MM-DD HH:mm:ss");
        const content = await this.app.vault.read(qMeta.file);
        const newContent = appendHistoryRow(content, ts, answerStr, isCorrect);
        await this.app.vault.modify(qMeta.file, newContent);
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
        document.body.addClass('is-practicing');
        document.body.style.setProperty('--theme-bg', this.plugin.settings.bgColor);
        document.body.style.setProperty('--theme-text', this.plugin.settings.textColor);
        document.body.style.setProperty('--theme-card', this.plugin.settings.cardColor);
        
        document.addEventListener('keydown', this.boundKeydownHandler);
        this.containerEl.addEventListener('click', () => {
            if (this.app.workspace.activeLeaf !== this.leaf) {
                this.app.workspace.setActiveLeaf(this.leaf);
            }
        });
        await this.render();
    }

    async onClose() {
        this.plugin.responseTimer.pause();
        document.body.removeClass('is-practicing');
        document.body.style.removeProperty('--theme-bg');
        document.body.style.removeProperty('--theme-text');
        document.body.style.removeProperty('--theme-card');
        
        document.removeEventListener('keydown', this.boundKeydownHandler);
    }

    onKeydown(e: KeyboardEvent) {
        const target = e.target as HTMLElement | null;
        const isExternalInput = (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable || target?.closest('.cm-editor'))
            && !this.containerEl.contains(target);
        if (isExternalInput) return;

        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
            return;
        }

        const isViewActive = this.app.workspace.activeLeaf?.view === this
            || (target && this.containerEl.contains(target))
            || (document.body.classList.contains('is-practicing') && this.containerEl.offsetParent !== null);
        if (!isViewActive) return;

        // Ignore events while grading transaction is active
        if (this.plugin.gradingLock.isGrading) return;

        const key = e.key.toLowerCase();
        
        if (key === 'escape') {
            return;
        }

        const q = this.plugin.currentQueue[this.plugin.currentQIndex];
        if (!q) return;

        if (this.plugin.showingAnswer || this.plugin.pendingShortAnswer) {
            const pendingShortAnswer = q.type === 'short-answer'
                && this.plugin.pendingShortAnswer?.filePath === q.file.path;
            if (pendingShortAnswer) {
                if (key === '1') {
                    void this.plugin.confirmShortAnswerRating(q, 1);
                    e.preventDefault();
                } else if (key === '2') {
                    void this.plugin.confirmShortAnswerRating(q, 2);
                    e.preventDefault();
                } else if (key === '3') {
                    void this.plugin.confirmShortAnswerRating(q, 3);
                    e.preventDefault();
                } else if (key === '4') {
                    void this.plugin.confirmShortAnswerRating(q, 4);
                    e.preventDefault();
                } else if (key === 'enter' || key === ' ' || key === 'arrowright' || key === 'n') {
                    const finalRating = this.plugin.pendingShortAnswer?.proposedRating || 3;
                    void this.plugin.confirmShortAnswerRating(q, finalRating);
                    e.preventDefault();
                }
            } else if (key === 'enter' || key === ' ' || key === 'arrowright' || key === 'n') {
                this.advanceFromRevealedAnswer();
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
                this.plugin.handleShowAnswer();
                e.preventDefault();
            } else if (key === 'n') {
                this.plugin.setMastered(q);
                e.preventDefault();
            } else if (key === 'enter' && this.plugin.selectedChoices.size > 0) {
                this.gradeMultipleChoice();
                e.preventDefault();
            }
        }
    }

    private async advanceFromRevealedAnswer() {
        await this.plugin.advanceAfterFailure();
    }

    private toggleChoice(char: string) {
        if (this.plugin.gradingLock.isGrading) return;
        if (this.plugin.selectedChoices.has(char)) {
            this.plugin.selectedChoices.delete(char);
        } else {
            this.plugin.selectedChoices.add(char);
        }
        this.plugin.persistSessionCopies();
        this.render();
    }

    private gradeMultipleChoice() {
        if (this.plugin.gradingLock.isGrading) return;
        const q = this.plugin.currentQueue[this.plugin.currentQIndex];
        if (!q) return;
        const selected = Array.from(this.plugin.selectedChoices).sort().join('');
        const isCorrect = selected.toUpperCase() === q.answer.toUpperCase();
        this.plugin.handleGrading(q, isCorrect, selected);
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

        const mainLayout = container.createEl('div', { cls: 'practice-tab-layout' });
        
        // Vertical Progress Bar (VPB)
        const vpb = mainLayout.createEl('div', { cls: 'practice-vpb' });
        this.plugin.currentQueue.forEach((q, idx) => {
            const segment = vpb.createEl('div', { cls: 'vpb-segment' });
            if (idx === this.plugin.currentQIndex) segment.addClass('is-active');
            const result = this.plugin.sessionResults.get(q.file.path);
            if (result === 'correct') segment.addClass('is-correct');
            else if (result === 'wrong') segment.addClass('is-wrong');
            
            segment.onclick = () => {
                if (this.plugin.gradingLock.isGrading) return;
                this.plugin.invalidateResponseTimer();
                this.plugin.currentQIndex = idx;
                this.plugin.showingAnswer = false;
                this.plugin.selectedChoices.clear();
                this.plugin.persistSessionCopies();
                this.plugin.refreshAllViews();
            };
        });

        container.style.setProperty('--theme-bg', this.plugin.settings.bgColor);
        container.style.setProperty('--theme-text', this.plugin.settings.textColor);
        container.style.setProperty('--theme-card', this.plugin.settings.cardColor);
        
        container.style.backgroundColor = 'var(--theme-bg)';
        container.style.color = 'var(--theme-text)';

        const questionContent = mainLayout.createEl('div', { cls: 'practice-question-container' });
        
        // Apply visual settings
        questionContent.style.fontSize = `${this.plugin.settings.fontSize}px`;

        await this.renderQuestion(questionContent, qMeta);
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
        if (this.plugin.gradingLock.isGrading) {
            restartBtn.setAttribute('disabled', 'true');
        }
        restartBtn.onclick = async () => {
            if (this.plugin.gradingLock.isGrading) return;
            this.plugin.invalidateResponseTimer();
            this.plugin.currentQIndex = 0;
            this.plugin.isFinished = false;
            this.plugin.correctAnswers = 0;
            this.plugin.wrongAnswers = 0;
            this.plugin.sessionResults.clear();
            this.plugin.showingAnswer = false;
            this.plugin.selectedChoices.clear();
            this.plugin.pendingShortAnswer = null;
            this.plugin.shortAnswerDrafts.clear();
            await this.plugin.persistSessionCopies();
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

    private renderQuestionHeader(container: HTMLElement, qMeta: QuestionMeta) {
        const headerEl = container.createEl('div', { cls: 'practice-header' });
        headerEl.createEl('span', { text: `Q: ${this.plugin.currentQIndex + 1} / ${this.plugin.currentQueue.length}` });
        headerEl.createEl('span', { text: `Fam: ${qMeta.familiarity.toFixed(1)}%` });
        if (!this.plugin.settings.fsrs.legacyScheduler) {
            headerEl.createEl('span', {
                text: `D: ${qMeta.fsrsState.card.difficulty.toFixed(1)} · ${qMeta.rankingReason || 'scheduled'}`
            });
        }
    }

    private renderFeedbackList(parent: HTMLElement, title: string, values?: string[]) {
        if (!values || values.length === 0) return;
        const section = parent.createEl('div', { cls: 'practice-short-answer-feedback-section' });
        section.createEl('strong', { text: title });
        const list = section.createEl('ul');
        for (const value of values) list.createEl('li', { text: value });
    }

    private async renderShortAnswerQuestion(
        container: HTMLElement,
        qMeta: QuestionMeta,
        content: string
    ) {
        this.plugin.activeChoices = [];
        const parsed = parseShortAnswerCard(content);
        if (!parsed.card || !parsed.isValid) {
            this.plugin.invalidateResponseTimer();
            const panel = container.createEl('div', { cls: 'practice-short-answer-error material-card' });
            panel.createEl('h3', { text: 'This short-answer card is invalid' });
            const list = panel.createEl('ul');
            for (const diagnostic of parsed.diagnostics) {
                list.createEl('li', { text: `${diagnostic.code}: ${diagnostic.message}` });
            }
            return;
        }

        const card = parsed.card;
        qMeta.timingSamples = card.historyEvents
            .filter(event => event.timingValid !== false && event.timingOutlier !== true)
            .map(event => event.activeDurationMs)
            .filter(duration => Number.isFinite(duration) && duration > 0)
            .slice(-this.plugin.settings.fsrs.timing.rollingWindowSize);

        const pending = this.plugin.pendingShortAnswer?.filePath === qMeta.file.path
            ? this.plugin.pendingShortAnswer
            : null;
        const isGrading = this.plugin.gradingLock.isGrading;

        this.renderQuestionHeader(container, qMeta);

        const historyBar = container.createEl('div', { cls: 'practice-history-bar' });
        for (const event of card.historyEvents) {
            const block = historyBar.createEl('div', { cls: 'history-block' });
            block.addClass(event.correctness ? 'is-correct' : 'is-wrong');
            block.setAttribute('aria-label', `${event.timestamp}: ${event.correctness ? 'correct' : 'wrong'}`);
        }

        const stemEl = container.createEl('div', { cls: 'practice-stem material-card' });
        stemEl.style.backgroundColor = this.plugin.settings.cardColor;
        await MarkdownRenderer.renderMarkdown(card.question, stemEl, qMeta.file.path, this);

        if (!this.plugin.showingAnswer && !pending) {
            const textarea = container.createEl('textarea', {
                cls: 'practice-short-answer-input',
                attr: {
                    rows: '8',
                    placeholder: 'Type your answer here…',
                    'aria-label': 'Short answer'
                }
            });
            textarea.value = this.plugin.shortAnswerDrafts.get(qMeta.file.path) || '';
            textarea.oninput = () => {
                this.plugin.shortAnswerDrafts.set(qMeta.file.path, textarea.value);
            };
            textarea.onkeydown = (e: KeyboardEvent) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    if (this.plugin.gradingLock.isGrading) return;
                    this.plugin.shortAnswerDrafts.set(qMeta.file.path, textarea.value);
                    void this.plugin.beginShortAnswerReview(qMeta, card, textarea.value);
                }
            };

            const actions = container.createEl('div', { cls: 'practice-actions' });
            const gradeButton = actions.createEl('button', {
                text: 'Grade Answer',
                cls: 'practice-btn-submit'
            });
            if (isGrading) gradeButton.setAttribute('disabled', 'true');
            gradeButton.onclick = () => {
                if (this.plugin.gradingLock.isGrading) return;
                this.plugin.shortAnswerDrafts.set(qMeta.file.path, textarea.value);
                void this.plugin.beginShortAnswerReview(qMeta, card, textarea.value);
            };

            const showButton = actions.createEl('button', {
                text: '(S)how Answer',
                cls: 'practice-btn-show'
            });
            if (isGrading) showButton.setAttribute('disabled', 'true');
            showButton.onclick = () => {
                if (this.plugin.gradingLock.isGrading) return;
                this.plugin.shortAnswerDrafts.set(qMeta.file.path, textarea.value);
                void this.plugin.handleShowAnswer();
            };

            const skipButton = actions.createEl('button', {
                text: 'Skip (N)',
                cls: 'practice-btn-skip'
            });
            if (isGrading) skipButton.setAttribute('disabled', 'true');
            skipButton.onclick = () => {
                if (this.plugin.gradingLock.isGrading) return;
                void this.plugin.setMastered(qMeta);
            };
            return;
        }

        if (pending?.submittedAnswer.trim()) {
            const submitted = container.createEl('div', { cls: 'practice-short-answer-submitted material-card' });
            submitted.createEl('h4', { text: 'Your answer' });
            submitted.createEl('div', { text: pending.submittedAnswer, cls: 'practice-short-answer-preserved-text' });
        }

        const reference = container.createEl('div', { cls: 'practice-short-answer-reference material-card' });
        reference.createEl('h4', { text: 'Reference answer' });
        if (card.referenceAnswer?.trim()) {
            await MarkdownRenderer.renderMarkdown(card.referenceAnswer, reference, qMeta.file.path, this);
        } else {
            reference.createEl('p', { text: 'No reference answer is available. Use manual self-assessment.' });
        }

        if (card.frontmatter.rubric) {
            const rubricPanel = container.createEl('details', { cls: 'practice-short-answer-rubric material-card' });
            rubricPanel.createEl('summary', { text: 'AI-generated grading rubric' });
            this.renderFeedbackList(rubricPanel, 'Required points', card.frontmatter.rubric.requiredPoints);
            this.renderFeedbackList(rubricPanel, 'Optional points', card.frontmatter.rubric.optionalPoints);
            this.renderFeedbackList(rubricPanel, 'Acceptable paraphrases', card.frontmatter.rubric.acceptableParaphrases);
            this.renderFeedbackList(rubricPanel, 'Contradictions', card.frontmatter.rubric.contradictions);
            if (card.frontmatter.rubric.generatorModel) {
                rubricPanel.createEl('small', {
                    text: `Generated by ${card.frontmatter.rubric.generatorModel}; edit or remove the rubric in the note frontmatter to override it.`
                });
            }
        }

        if (pending) {
            const feedback = container.createEl('div', { cls: 'practice-short-answer-feedback material-card' });
            feedback.createEl('h4', { text: pending.provider ? 'AI grading review' : 'Manual self-assessment' });

            const statsRow = feedback.createEl('div', { cls: 'practice-short-answer-score-row' });
            if (pending.score !== undefined) {
                const scorePercent = (pending.score * 100).toFixed(0);
                const scoreBadgeCls = pending.score >= 0.8 ? 'is-pass' : pending.score >= 0.6 ? 'is-near' : 'is-fail';
                statsRow.createEl('span', {
                    text: `得分: ${scorePercent}%`,
                    cls: `practice-score-badge ${scoreBadgeCls}`
                });
            }
            if (pending.confidence !== undefined) {
                statsRow.createEl('span', {
                    text: `可信度: ${(pending.confidence * 100).toFixed(0)}%`,
                    cls: 'practice-confidence-badge'
                });
            }

            if (pending.feedback) feedback.createEl('p', { text: pending.feedback, cls: 'practice-feedback-text' });
            if (pending.confirmationMessage) {
                feedback.createEl('p', { text: pending.confirmationMessage, cls: 'practice-short-answer-confirmation' });
            }
            this.renderFeedbackList(feedback, 'Matched points', pending.matchedPoints);
            this.renderFeedbackList(feedback, 'Missing points', pending.missingPoints);
            this.renderFeedbackList(feedback, 'Material errors', pending.materialErrors);
        }

        if (pending) {
            const ratingRow = container.createEl('div', { cls: 'practice-short-answer-ratings' });
            const ratings: Array<{ label: string; value: 1 | 2 | 3 | 4 }> = [
                { label: 'Again (1)', value: 1 },
                { label: 'Hard (2)', value: 2 },
                { label: 'Good (3)', value: 3 },
                { label: 'Easy (4)', value: 4 }
            ];
            for (const rating of ratings) {
                const button = ratingRow.createEl('button', { text: rating.label });
                if (rating.value === pending.proposedRating) button.addClass('is-proposed');
                if (isGrading) button.setAttribute('disabled', 'true');
                button.onclick = () => {
                    if (this.plugin.gradingLock.isGrading) return;
                    void this.plugin.confirmShortAnswerRating(qMeta, rating.value);
                };
            }

            const actions = container.createEl('div', { cls: 'practice-actions' });
            const nextButton = actions.createEl('button', {
                text: 'Next Question =>',
                cls: 'practice-btn-submit practice-btn-next'
            });
            if (isGrading) nextButton.setAttribute('disabled', 'true');
            nextButton.onclick = () => {
                if (this.plugin.gradingLock.isGrading) return;
                const finalRating = pending.proposedRating || 3;
                void this.plugin.confirmShortAnswerRating(qMeta, finalRating);
            };
            setTimeout(() => {
                try {
                    nextButton.focus();
                } catch {}
            }, 50);
        } else {
            const actions = container.createEl('div', { cls: 'practice-actions' });
            const nextButton = actions.createEl('button', {
                text: 'Next Question =>',
                cls: 'practice-btn-wrong'
            });
            if (isGrading) nextButton.setAttribute('disabled', 'true');
            nextButton.onclick = () => {
                if (this.plugin.gradingLock.isGrading) return;
                void this.advanceFromRevealedAnswer();
            };
            setTimeout(() => {
                try {
                    nextButton.focus();
                } catch {}
            }, 50);
        }
    }

    private async renderQuestion(container: HTMLElement, qMeta: QuestionMeta) {
        this.plugin.ensureResponseTimer(qMeta);
        const content = await this.app.vault.cachedRead(qMeta.file);
        if (qMeta.type === 'short-answer') {
            await this.renderShortAnswerQuestion(container, qMeta, content);
            return;
        }
        const lines = content.split('\n');
        const isSingle = qMeta.answer.length <= 1;

        const firstChoiceIndex = lines.findIndex(l => /^- [A-Z] /.test(l));
        const firstHeaderIndex = lines.findIndex(l => l.startsWith('# '));
        
        let stemText = "";
        if (firstHeaderIndex !== -1 && firstHeaderIndex < firstChoiceIndex) {
            stemText = lines.slice(firstHeaderIndex, firstChoiceIndex).join('\n').trim();
        }

        this.plugin.activeChoices = [];
        const choicesRegex = /^- ([A-Z]) (.*)$/gm;
        let match;
        while ((match = choicesRegex.exec(content)) !== null) {
            this.plugin.activeChoices.push({ char: match[1], text: match[2].trim() });
        }

        this.renderQuestionHeader(container, qMeta);

        // History Bar
        await this.renderHistoryBar(container, qMeta);

        const stemEl = container.createEl('div', { cls: 'practice-stem material-card' });
        stemEl.style.backgroundColor = this.plugin.settings.cardColor;
        await MarkdownRenderer.renderMarkdown(stemText, stemEl, qMeta.file.path, this);

        const choicesEl = container.createEl('div', { cls: 'practice-choices' });
        const isGrading = this.plugin.gradingLock.isGrading;

        for (const choice of this.plugin.activeChoices) {
            const row = choicesEl.createEl('div', { cls: 'practice-choice material-card' });
            row.style.backgroundColor = this.plugin.settings.cardColor;
            if (this.plugin.selectedChoices.has(choice.char)) row.addClass('practice-selected-choice');
            if (isGrading) row.addClass('is-disabled');

            row.onclick = () => {
                if (isGrading) return;
                if (this.plugin.showingAnswer) {
                    if (isSingle && qMeta.answer.toUpperCase().includes(choice.char.toUpperCase())) {
                        this.advanceFromRevealedAnswer();
                    }
                    return;
                }
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
                row.addClass('material-card-elevated');
            }
        }

        const actions = container.createEl('div', { cls: 'practice-actions' });
        
        if (Platform.isMobile && !this.plugin.showingAnswer) {
            const mobileBtnRow = container.createEl('div', { cls: 'practice-mobile-btns' });
            this.plugin.activeChoices.forEach(choice => {
                const btn = mobileBtnRow.createEl('button', { text: choice.char, cls: 'practice-mobile-key' });
                if (this.plugin.selectedChoices.has(choice.char)) btn.addClass('is-selected');
                if (isGrading) btn.setAttribute('disabled', 'true');

                btn.onclick = () => {
                    if (isGrading) return;
                    if (this.plugin.showingAnswer) {
                        if (isSingle && qMeta.answer.toUpperCase().includes(choice.char.toUpperCase())) {
                            this.advanceFromRevealedAnswer();
                        }
                        return;
                    }
                    if (isSingle) {
                        const isCorrect = qMeta.answer.toUpperCase().includes(choice.char.toUpperCase());
                        this.plugin.handleGrading(qMeta, isCorrect, choice.char);
                    } else {
                        this.toggleChoice(choice.char);
                    }
                };
            });
        }

        if (this.plugin.showingAnswer) {
            container.createEl('div', { text: `Answer: ${qMeta.answer}`, cls: 'practice-answer-reveal' });
            
            const nextBtn = actions.createEl('button', { text: 'Next Question =>', cls: 'practice-btn-wrong' });
            if (isGrading) nextBtn.setAttribute('disabled', 'true');
            nextBtn.onclick = () => {
                if (isGrading) return;
                this.advanceFromRevealedAnswer();
            };
        } else {
            if (!isSingle) {
                const submitBtn = actions.createEl('button', { text: 'Submit Answer', cls: 'practice-btn-submit' });
                if (isGrading) submitBtn.setAttribute('disabled', 'true');
                submitBtn.onclick = () => {
                    if (isGrading) return;
                    this.gradeMultipleChoice();
                };
            }
            const showBtn = actions.createEl('button', { text: '(S)how Answer', cls: 'practice-btn-show' });
            if (isGrading) showBtn.setAttribute('disabled', 'true');
            showBtn.onclick = () => {
                if (isGrading) return;
                this.plugin.handleShowAnswer();
            };

            const skipBtn = actions.createEl('button', { text: 'Skip (N)', cls: 'practice-btn-skip' });
            if (isGrading) skipBtn.setAttribute('disabled', 'true');
            skipBtn.onclick = () => {
                if (isGrading) return;
                this.plugin.setMastered(qMeta);
            };
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

        const topSection = container.createEl('div', { cls: 'practice-control-top' });

        const filtersCompact = topSection.createEl('div', { cls: 'practice-filters-compact' });
        this.renderCompactFilters(filtersCompact);

        const themeSection = topSection.createEl('div', { cls: 'practice-theme-grid-section' });
        themeSection.createEl('h4', { text: 'Theme', cls: 'sidebar-section-header' });
        this.renderThemeGrid(themeSection);

        const settingsCompact = topSection.createEl('div', { cls: 'practice-settings-compact' });
        this.renderCompactSettings(settingsCompact);

        const queueScrollable = container.createEl('div', { cls: 'practice-queue-scrollable' });
        this.renderQueueList(queueScrollable);
    }

    private renderCompactFilters(parent: HTMLElement) {
        const row1 = parent.createEl('div', { cls: 'practice-toolbar-row' });
        const labelRow = row1.createEl('div', { cls: 'practice-label-row' });
        labelRow.createEl('span', { text: 'Category:' });
        const refreshBtn = labelRow.createEl('button', { cls: 'clickable-icon practice-refresh-btn', title: 'Refresh categories & queue' });
        setIcon(refreshBtn, 'refresh-cw');
        refreshBtn.onclick = () => {
            this.plugin.refreshCategories();
            this.plugin.refreshQueue();
            this.plugin.refreshAllViews();
            new Notice(`Refreshed: ${this.plugin.categories.length - 1} categories, ${this.plugin.currentQueue.length} cards in queue.`);
        };

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
        row2.createEl('span', { text: 'Max Familiarity:' });
        const sliderContainer = row2.createEl('div', { cls: 'vertical-slider-container' });
        const famSlider = sliderContainer.createEl('input', { type: 'range', cls: 'vertical-slider' });
        famSlider.min = "0"; famSlider.max = "100";
        famSlider.value = this.plugin.filterFamiliarity.toString();
        famSlider.setAttribute('orient', 'vertical');

        const famLabel = sliderContainer.createEl('span', {
            text: `${this.plugin.filterFamiliarity.toFixed(0)}%`,
            cls: 'vertical-slider-label'
        });

        famSlider.oninput = () => famLabel.setText(`${famSlider.value}%`);
        famSlider.onchange = () => {
            this.plugin.filterFamiliarity = parseInt(famSlider.value);
            this.plugin.refreshQueue();
        };
    }

    private renderThemeGrid(parent: HTMLElement) {
        const grid = parent.createEl('div', { cls: 'theme-grid' });
        THEMES.forEach(theme => {
            const block = grid.createEl('div', { cls: 'theme-preview-block' });
            block.style.backgroundColor = theme.bg;
            block.style.color = theme.text;
            block.setAttribute('data-theme-name', theme.name);

            block.createEl('div', { cls: 'theme-preview-name', text: theme.name });
            block.createEl('div', { cls: 'theme-preview-sample', text: 'Sample Text' });

            const matches = this.plugin.settings.textColor === theme.text && this.plugin.settings.bgColor === theme.bg;
            const isDefaultWithVars = theme.name === 'Default' &&
                this.plugin.settings.textColor.includes('var') &&
                this.plugin.settings.bgColor.includes('var');
            if (matches || isDefaultWithVars) {
                block.addClass('is-active');
            }

            block.onclick = async () => {
                this.plugin.settings.textColor = theme.text;
                this.plugin.settings.bgColor = theme.bg;
                this.plugin.settings.cardColor = theme.card;
                await this.plugin.saveSettings();
                this.plugin.refreshAllViews();
            };
        });
    }

    private renderCompactSettings(parent: HTMLElement) {
        const schedulerRow = parent.createEl('div', { cls: 'practice-sidebar-setting-row' });
        schedulerRow.createEl('span', { text: 'Scheduler:' });
        const scheduler = schedulerRow.createEl('select');
        scheduler.createEl('option', { text: 'Legacy familiarity', value: 'legacy' });
        scheduler.createEl('option', { text: 'FSRS adaptive', value: 'fsrs' });
        scheduler.value = this.plugin.settings.fsrs.legacyScheduler ? 'legacy' : 'fsrs';
        scheduler.onchange = async () => {
            this.plugin.settings.fsrs.legacyScheduler = scheduler.value === 'legacy';
            await this.plugin.saveSettings();
            this.plugin.refreshQueue();
        };

        const masteredRow = parent.createEl('div', { cls: 'practice-sidebar-setting-row' });
        const masteredLabel = masteredRow.createEl('label');
        const mastered = masteredLabel.createEl('input', { type: 'checkbox' });
        mastered.checked = this.plugin.settings.fsrs.ranking.includeMastered;
        masteredLabel.appendText(' Include mastered (100%)');
        mastered.onchange = async () => {
            this.plugin.settings.fsrs.ranking.includeMastered = mastered.checked;
            await this.plugin.saveSettings();
            this.plugin.refreshQueue();
        };

        const addNumberSetting = (
            label: string,
            value: number,
            min: number,
            max: number,
            step: number,
            update: (value: number) => void
        ) => {
            const row = parent.createEl('div', { cls: 'practice-sidebar-setting-row' });
            row.createEl('span', { text: label });
            const input = row.createEl('input', { type: 'number', cls: 'setting-input-number' });
            input.value = String(value);
            input.min = String(min);
            input.max = String(max);
            input.step = String(step);
            input.onchange = async () => {
                const next = Number(input.value);
                if (!Number.isFinite(next)) return;
                update(Math.max(min, Math.min(max, next)));
                await this.plugin.saveSettings();
                this.plugin.refreshQueue();
            };
        };

        addNumberSetting('Requested retention:', this.plugin.settings.fsrs.requestedRetention, 0.7, 0.99, 0.01,
            value => { this.plugin.settings.fsrs.requestedRetention = value; });
        addNumberSetting('Min interval (days):', this.plugin.settings.fsrs.minimumInterval, 0, 36500, 1,
            value => { this.plugin.settings.fsrs.minimumInterval = value; });
        addNumberSetting('Max interval (days):', this.plugin.settings.fsrs.maximumInterval, 1, 36500, 1,
            value => { this.plugin.settings.fsrs.maximumInterval = value; });
        addNumberSetting('Overdue weight:', this.plugin.settings.fsrs.ranking.overdueWeight, 0, 100, 0.1,
            value => { this.plugin.settings.fsrs.ranking.overdueWeight = value; });
        addNumberSetting('Recall weight:', this.plugin.settings.fsrs.ranking.retrievabilityWeight, 0, 100, 0.1,
            value => { this.plugin.settings.fsrs.ranking.retrievabilityWeight = value; });
        addNumberSetting('Difficulty weight:', this.plugin.settings.fsrs.ranking.difficultyWeight, 0, 10, 0.1,
            value => { this.plugin.settings.fsrs.ranking.difficultyWeight = value; });
        addNumberSetting('Exploration share:', this.plugin.settings.fsrs.ranking.explorationShare, 0, 1, 0.01,
            value => { this.plugin.settings.fsrs.ranking.explorationShare = value; });
        addNumberSetting('Session question limit:', this.plugin.settings.fsrs.ranking.sessionLimit, 0, 10000, 1,
            value => { this.plugin.settings.fsrs.ranking.sessionLimit = Math.round(value); });
        addNumberSetting('Easy time ratio:', this.plugin.settings.fsrs.timing.easyRatio, 0.1, 1, 0.05,
            value => { this.plugin.settings.fsrs.timing.easyRatio = value; });
        addNumberSetting('Hard time ratio:', this.plugin.settings.fsrs.timing.hardRatio, 1, 5, 0.05,
            value => { this.plugin.settings.fsrs.timing.hardRatio = value; });
        addNumberSetting('Timing samples:', this.plugin.settings.fsrs.timing.minSamplesPerQuestion, 1, 100, 1,
            value => { this.plugin.settings.fsrs.timing.minSamplesPerQuestion = Math.round(value); });
        addNumberSetting('Timing window:', this.plugin.settings.fsrs.timing.rollingWindowSize, 1, 500, 1,
            value => { this.plugin.settings.fsrs.timing.rollingWindowSize = Math.round(value); });
        addNumberSetting('Outlier cutoff (ms):', this.plugin.settings.fsrs.timing.outlierCutoffMs, 1000, 3600000, 1000,
            value => { this.plugin.settings.fsrs.timing.outlierCutoffMs = value; });

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
    }

    private renderQueueList(parent: HTMLElement) {
        parent.createEl('h4', { text: 'Queue', cls: 'sidebar-section-header' });
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
                if (this.plugin.gradingLock.isGrading) return;
                this.plugin.invalidateResponseTimer();
                this.plugin.currentQIndex = idx;
                this.plugin.isFinished = false;
                this.plugin.showingAnswer = false;
                this.plugin.selectedChoices.clear();
                this.plugin.persistSessionCopies();
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
        containerEl.createEl('h2', { text: 'Practice Plugin Settings' });
        containerEl.createEl('p', { text: 'Common scheduling, timing, filter, and visual settings are available in the Queue Control sidebar.' });

        containerEl.createEl('h3', { text: 'Short-answer AI grading' });
        containerEl.createEl('p', {
            cls: 'practice-privacy-disclosure',
            text: 'Privacy: when AI grading is enabled, Queue sends the question, reference answer, your submitted answer, and generated rubric to the configured endpoint. Response timing stays local and is applied only after semantic grading. If supplied, the API token is stored as plaintext in this plugin\'s data.json and sent only as an Authorization bearer header. AI grading is disabled by default, and failures fall back to manual self-assessment.'
        });

        const aiEnabledRow = containerEl.createEl('div', { cls: 'practice-setting-row' });
        const aiEnabledLabel = aiEnabledRow.createEl('label');
        const aiEnabled = aiEnabledLabel.createEl('input', { type: 'checkbox' });
        aiEnabled.checked = this.plugin.settings.shortAnswer.aiEnabled;
        aiEnabledLabel.appendText(' Enable AI-assisted grading');
        aiEnabled.onchange = async () => {
            this.plugin.settings.shortAnswer.aiEnabled = aiEnabled.checked;
            await this.plugin.saveSettings();
        };

        const addCheckboxSetting = (
            label: string,
            checked: boolean,
            update: (value: boolean) => void
        ) => {
            const row = containerEl.createEl('div', { cls: 'practice-setting-row' });
            const checkboxLabel = row.createEl('label');
            const input = checkboxLabel.createEl('input', { type: 'checkbox' });
            input.checked = checked;
            checkboxLabel.appendText(` ${label}`);
            input.onchange = async () => {
                update(input.checked);
                await this.plugin.saveSettings();
            };
        };

        const addTextSetting = (
            label: string,
            value: string,
            placeholder: string,
            update: (value: string) => void,
            inputType: 'text' | 'password' = 'text'
        ) => {
            const row = containerEl.createEl('label', { cls: 'practice-setting-row' });
            row.createEl('span', { text: label });
            const input = row.createEl('input', { type: inputType });
            input.value = value;
            input.placeholder = placeholder;
            input.onchange = async () => {
                update(input.value.trim());
                await this.plugin.saveSettings();
            };
        };

        const addBoundedNumberSetting = (
            label: string,
            value: number,
            min: number,
            max: number,
            step: number,
            update: (value: number) => void
        ) => {
            const row = containerEl.createEl('label', { cls: 'practice-setting-row' });
            row.createEl('span', { text: label });
            const input = row.createEl('input', { type: 'number' });
            input.min = String(min);
            input.max = String(max);
            input.step = String(step);
            input.value = String(value);
            input.onchange = async () => {
                const parsed = Number(input.value);
                const fallback = Number.isFinite(parsed) ? parsed : value;
                const bounded = Math.max(min, Math.min(max, fallback));
                input.value = String(bounded);
                update(bounded);
                await this.plugin.saveSettings();
            };
        };

        addTextSetting(
            'OpenAI-compatible endpoint',
            this.plugin.settings.shortAnswer.endpoint,
            'http://127.0.0.1:11434/v1/chat/completions',
            value => { this.plugin.settings.shortAnswer.endpoint = value; }
        );
        addTextSetting(
            'API token (plaintext in data.json)',
            this.plugin.settings.shortAnswer.apiToken,
            'Optional for local endpoints',
            value => { this.plugin.settings.shortAnswer.apiToken = value; },
            'password'
        );
        addTextSetting(
            'Model name',
            this.plugin.settings.shortAnswer.model,
            'Required only when AI grading is enabled',
            value => { this.plugin.settings.shortAnswer.model = value; }
        );
        addBoundedNumberSetting(
            'Timeout (milliseconds)',
            this.plugin.settings.shortAnswer.timeoutMs,
            1000,
            120000,
            1000,
            value => { this.plugin.settings.shortAnswer.timeoutMs = Math.round(value); }
        );
        addBoundedNumberSetting(
            'Minimum confidence',
            this.plugin.settings.shortAnswer.minConfidence,
            0,
            1,
            0.05,
            value => { this.plugin.settings.shortAnswer.minConfidence = value; }
        );
        addBoundedNumberSetting(
            'Pass threshold',
            this.plugin.settings.shortAnswer.passThreshold,
            0,
            1,
            0.05,
            value => { this.plugin.settings.shortAnswer.passThreshold = value; }
        );
        addCheckboxSetting(
            'Automatically generate rubrics for long reference answers',
            this.plugin.settings.shortAnswer.autoGenerateRubrics,
            value => { this.plugin.settings.shortAnswer.autoGenerateRubrics = value; }
        );
        addBoundedNumberSetting(
            'Rubric minimum reference length',
            this.plugin.settings.shortAnswer.rubricMinimumLength,
            80,
            5000,
            20,
            value => { this.plugin.settings.shortAnswer.rubricMinimumLength = Math.round(value); }
        );
        addCheckboxSetting(
            'Cache validated grading results (maximum 250)',
            this.plugin.settings.shortAnswer.cacheGradingResults,
            value => { this.plugin.settings.shortAnswer.cacheGradingResults = value; }
        );
        addCheckboxSetting(
            'Retain submitted answers in future question history',
            this.plugin.settings.shortAnswer.retainSubmittedAnswers,
            value => { this.plugin.settings.shortAnswer.retainSubmittedAnswers = value; }
        );
        addCheckboxSetting(
            'Retain AI feedback in future question history and cache',
            this.plugin.settings.shortAnswer.retainAiFeedback,
            value => {
                this.plugin.settings.shortAnswer.retainAiFeedback = value;
                if (!value) {
                    for (const entry of Object.values(this.plugin.settings.shortAnswer.gradingCache)) {
                        entry.output.feedback = '';
                    }
                }
            }
        );

        containerEl.createEl('h3', { text: 'Advanced FSRS parameters' });
        containerEl.createEl('p', {
            text: 'Normally leave this unchanged. Import an optimizer-produced 19- or 21-number parameter vector, or reset to Queue defaults.'
        });
        const vector = containerEl.createEl('textarea');
        vector.rows = 6;
        vector.style.width = '100%';
        vector.value = JSON.stringify(this.plugin.settings.fsrs.fsrsParameters?.w || [], null, 2);
        const feedback = containerEl.createEl('div');

        const importButton = containerEl.createEl('button', { text: 'Validate and import' });
        importButton.onclick = async () => {
            try {
                const parsed = JSON.parse(vector.value);
                const validation = validateFsrsParameters(parsed);
                if (!validation.valid || !validation.parameters) {
                    feedback.setText(validation.error || 'Invalid FSRS parameter vector.');
                    return;
                }
                this.plugin.settings.fsrs.fsrsParameters = {
                    ...(this.plugin.settings.fsrs.fsrsParameters || {}),
                    w: validation.parameters
                };
                await this.plugin.saveSettings();
                feedback.setText('FSRS parameters imported. They apply to future reviews.');
            } catch (error) {
                feedback.setText(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
            }
        };

        const resetButton = containerEl.createEl('button', { text: 'Reset scheduling defaults' });
        resetButton.onclick = async () => {
            const keepLegacyMode = this.plugin.settings.fsrs.legacyScheduler;
            this.plugin.settings.fsrs = createDefaultQueueFsrsSettings();
            this.plugin.settings.fsrs.legacyScheduler = keepLegacyMode;
            await this.plugin.saveSettings();
            vector.value = '[]';
            feedback.setText('Scheduling and timing settings reset. Review history was not deleted.');
            this.plugin.refreshQueue();
        };
    }
}
