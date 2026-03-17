import { TFile } from 'obsidian';

export const VIEW_TYPE_PRACTICE = 'practice-view';
export const VIEW_TYPE_CONTROL = 'queue-control-view';

export interface QuestionMeta {
    file: TFile;
    id: number;
    familiarity: number;
    answer: string;
}

export interface ButtonPosition {
    x: number;
    y: number;
}

export interface ButtonLayouts {
    [buttonId: string]: ButtonPosition;
}

export interface PracticeSettings {
    failOffsets: string;
    savedQueuePaths: string[];
    savedIndex: number;
    fontSize: number;
    textColor: string;
    bgColor: string;
    theme: string;
    unlockButtonLayout: boolean;
    buttonLayouts: ButtonLayouts;
}

export const DEFAULT_SETTINGS: PracticeSettings = {
    failOffsets: "3, 10, -1",
    savedQueuePaths: [],
    savedIndex: 0,
    fontSize: 16,
    textColor: "var(--text-normal)",
    bgColor: "var(--background-primary)",
    theme: "default",
    unlockButtonLayout: false,
    buttonLayouts: {}
};
