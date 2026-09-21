/**
 * Pure helper module for versioned practice-session state management.
 */

export interface SessionState {
    version: 1;
    savedQueuePaths: string[];
    savedIndex: number;
    filterCategory: string;
    filterFamiliarity: number;
    isFinished: boolean;
    showingAnswer: boolean;
    selectedChoices: string[];
    correctAnswers: number;
    wrongAnswers: number;
    sessionResults: Array<[string, 'correct' | 'wrong']>;
}

export function createDefaultSessionState(): SessionState {
    return {
        version: 1,
        savedQueuePaths: [],
        savedIndex: 0,
        filterCategory: "All",
        filterFamiliarity: 100,
        isFinished: false,
        showingAnswer: false,
        selectedChoices: [],
        correctAnswers: 0,
        wrongAnswers: 0,
        sessionResults: []
    };
}

/**
 * Serializes SessionState into a JSON string.
 */
export function serializeSessionState(state: SessionState): string {
    return JSON.stringify(state);
}

/** Quotes arbitrary text as a YAML single-quoted scalar. */
export function quoteYamlString(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Deserializes raw data (JSON string or object) into a safe SessionState.
 * Clamps index and filters paths if validPaths set is provided.
 * Provides safe defaults for legacy or missing fields.
 */
export function deserializeSessionState(raw: unknown, validPaths?: Set<string>): SessionState {
    const defaults = createDefaultSessionState();
    if (!raw) return defaults;

    let obj: any = raw;
    if (typeof raw === 'string') {
        try {
            obj = JSON.parse(raw);
        } catch {
            return defaults;
        }
    }

    if (typeof obj !== 'object' || obj === null) {
        return defaults;
    }

    const originalPaths: string[] = Array.isArray(obj.savedQueuePaths)
        ? obj.savedQueuePaths.map((p: any) => String(p))
        : [];
    const originalIndex = typeof obj.savedIndex === 'number' && Number.isFinite(obj.savedIndex)
        ? Math.trunc(obj.savedIndex)
        : 0;
    const selectedPath = originalPaths[originalIndex];
    let paths = originalPaths;

    if (validPaths) {
        paths = paths.filter(p => validPaths.has(p));
    }

    let index = originalIndex;
    if (selectedPath && paths.includes(selectedPath)) {
        index = paths.indexOf(selectedPath);
    }
    if (paths.length === 0) {
        index = 0;
    } else if (index < 0 || index >= paths.length) {
        index = Math.max(0, Math.min(index, paths.length - 1));
    }

    const filterCategory = typeof obj.filterCategory === 'string' ? obj.filterCategory : "All";
    const filterFamiliarity = typeof obj.filterFamiliarity === 'number' && !isNaN(obj.filterFamiliarity)
        ? Math.max(0, Math.min(100, obj.filterFamiliarity))
        : 100;

    const isFinished = Boolean(obj.isFinished);
    const showingAnswer = Boolean(obj.showingAnswer);

    const selectedChoices = Array.isArray(obj.selectedChoices)
        ? obj.selectedChoices.map((c: any) => String(c))
        : [];

    const correctAnswers = typeof obj.correctAnswers === 'number' && !isNaN(obj.correctAnswers)
        ? Math.max(0, obj.correctAnswers)
        : 0;

    const wrongAnswers = typeof obj.wrongAnswers === 'number' && !isNaN(obj.wrongAnswers)
        ? Math.max(0, obj.wrongAnswers)
        : 0;

    let sessionResults: Array<[string, 'correct' | 'wrong']> = [];
    if (Array.isArray(obj.sessionResults)) {
        sessionResults = obj.sessionResults
            .filter((item: any) => Array.isArray(item) && item.length === 2 && (item[1] === 'correct' || item[1] === 'wrong'))
            .map((item: any): [string, 'correct' | 'wrong'] => [String(item[0]), item[1]])
            .filter((item: [string, 'correct' | 'wrong']) => !validPaths || validPaths.has(item[0]));
    }

    return {
        version: 1,
        savedQueuePaths: paths,
        savedIndex: index,
        filterCategory,
        filterFamiliarity,
        isFinished,
        showingAnswer,
        selectedChoices,
        correctAnswers,
        wrongAnswers,
        sessionResults
    };
}

/**
 * Parses Markdown session content and frontmatter, extracting links and legacy fields.
 */
export function parseMarkdownSession(
    content: string,
    frontmatter: Record<string, any> = {},
    validPaths?: Set<string>
): Partial<SessionState> & { parsedPaths: string[] } {
    const linkRegex = /\[\[(.*?)(?:\|.*?)?\]\]/g;
    const paths: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(content)) !== null) {
        const path = match[1].trim();
        if (!validPaths || validPaths.has(path)) {
            paths.push(path);
        }
    }

    if (typeof frontmatter.sessionState === 'string') {
        const state = deserializeSessionState(frontmatter.sessionState, validPaths);
        return { ...state, parsedPaths: state.savedQueuePaths };
    }

    const category = frontmatter.category || "All";
    const currentIndex = typeof frontmatter.currentIndex === 'number' ? frontmatter.currentIndex : 0;
    const isFinished = Boolean(frontmatter.isFinished);
    const filterFamiliarity = typeof frontmatter.filterFamiliarity === 'number' ? frontmatter.filterFamiliarity : 100;
    const correctAnswers = typeof frontmatter.correctAnswers === 'number' ? frontmatter.correctAnswers : 0;
    const wrongAnswers = typeof frontmatter.wrongAnswers === 'number' ? frontmatter.wrongAnswers : 0;
    const showingAnswer = Boolean(frontmatter.showingAnswer);
    const selectedChoices = Array.isArray(frontmatter.selectedChoices) ? frontmatter.selectedChoices.map(String) : [];
    const sessionResults = Array.isArray(frontmatter.sessionResults)
        ? frontmatter.sessionResults
            .filter((item: any) => Array.isArray(item) && item.length === 2 && (item[1] === 'correct' || item[1] === 'wrong'))
            .map((item: any) => [String(item[0]), item[1]] as [string, 'correct' | 'wrong'])
        : [];

    let clampedIndex = currentIndex;
    if (paths.length === 0) {
        clampedIndex = 0;
    } else if (clampedIndex < 0 || clampedIndex >= paths.length) {
        clampedIndex = Math.max(0, Math.min(clampedIndex, paths.length - 1));
    }

    return {
        version: 1,
        parsedPaths: paths,
        savedQueuePaths: paths,
        savedIndex: clampedIndex,
        filterCategory: category,
        filterFamiliarity,
        isFinished,
        showingAnswer,
        selectedChoices,
        correctAnswers,
        wrongAnswers,
        sessionResults
    };
}
