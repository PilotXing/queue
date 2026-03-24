var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  VIEW_TYPE_CONTROL: () => VIEW_TYPE_CONTROL,
  VIEW_TYPE_PRACTICE: () => VIEW_TYPE_PRACTICE,
  default: () => PracticePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var VIEW_TYPE_PRACTICE = "practice-view";
var VIEW_TYPE_CONTROL = "queue-control-view";
var THEMES = [
  { name: "Solarized Light", text: "#657b83", bg: "#fdf6e3", card: "#eee8d5" },
  { name: "Solarized Dark", text: "#839496", bg: "#002b36", card: "#073642" },
  { name: "Dracula", text: "#f8f8f2", bg: "#282a36", card: "#44475a" },
  { name: "GitHub Light", text: "#24292e", bg: "#ffffff", card: "#f6f8fa" },
  { name: "One Dark", text: "#abb2bf", bg: "#282c34", card: "#353b45" },
  { name: "Nord", text: "#d8dee9", bg: "#2e3440", card: "#3b4252" },
  { name: "Gruvbox", text: "#ebdbb2", bg: "#282828", card: "#3c3836" },
  { name: "Catppuccin", text: "#cdd6f4", bg: "#1e1e2e", card: "#313244" },
  { name: "Default", text: "var(--text-normal)", bg: "var(--background-primary)", card: "var(--background-secondary)" }
];
var DEFAULT_SETTINGS = {
  failOffsets: "3, 10, -1",
  savedQueuePaths: [],
  savedIndex: 0,
  fontSize: 16,
  textColor: "var(--text-normal)",
  bgColor: "var(--background-primary)",
  cardColor: "var(--background-secondary)"
};
var PracticePlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    // Shared State
    this.currentQueue = [];
    this.currentQIndex = 0;
    this.isFinished = false;
    this.showingAnswer = false;
    this.correctAnswers = 0;
    this.wrongAnswers = 0;
    this.filterCategory = "All";
    this.filterFamiliarity = 100;
    this.categories = ["All"];
    this.sessionResults = /* @__PURE__ */ new Map();
    this.selectedChoices = /* @__PURE__ */ new Set();
    this.activeChoices = [];
  }
  async onload() {
    await this.loadSettings();
    this.registerView(
      VIEW_TYPE_PRACTICE,
      (leaf) => new PracticeView(leaf, this)
    );
    this.registerView(
      VIEW_TYPE_CONTROL,
      (leaf) => new QueueControlView(leaf, this)
    );
    this.addRibbonIcon("check-square", "Open Practice Mode", () => {
      this.activateView();
    });
    this.addCommand({
      id: "open-practice-view",
      name: "Open Practice View",
      callback: () => this.activateView()
    });
    this.addCommand({
      id: "open-practice-control",
      name: "Open Practice Control Sidebar",
      callback: () => this.activateControlView()
    });
    this.addSettingTab(new PracticeSettingTab(this.app, this));
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => this.onFileOpen(file))
    );
    if (this.settings.savedQueuePaths.length > 0) {
      await this.restoreSession();
    } else {
      this.refreshQueue();
    }
  }
  async onFileOpen(file) {
    if (!file) return;
    const cache = this.app.metadataCache.getFileCache(file);
    if (cache?.frontmatter?.type === "practice_session") {
      await this.loadSessionFromFile(file);
    }
  }
  async loadSessionFromFile(file) {
    const content = await this.app.vault.read(file);
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter || {};
    this.filterCategory = fm.category || "All";
    this.currentQIndex = fm.currentIndex || 0;
    this.isFinished = fm.isFinished || false;
    this.currentQueue = [];
    const linkRegex = /\[\[(.*?)(?:\|.*?)?\]\]/g;
    let match;
    while ((match = linkRegex.exec(content)) !== null) {
      const path = match[1];
      const qFile = this.app.vault.getAbstractFileByPath(path);
      if (qFile instanceof import_obsidian.TFile) {
        const qCache = this.app.metadataCache.getFileCache(qFile);
        const qFm = qCache?.frontmatter || {};
        this.currentQueue.push({
          file: qFile,
          id: qFm.id || 0,
          familiarity: qFm.familiarity ?? 50,
          answer: qFm.answer?.toString() || ""
        });
      }
    }
    if (this.currentQueue.length > 0) {
      await this.saveSession();
      await this.activateView();
      this.refreshAllViews();
    }
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (this.settings.cardColor === DEFAULT_SETTINGS.cardColor) {
      const matchedTheme = THEMES.find((t) => t.bg === this.settings.bgColor);
      if (matchedTheme) {
        this.settings.cardColor = matchedTheme.card;
      }
    }
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  async activateView() {
    const { workspace } = this.app;
    let leaf = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_PRACTICE);
    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_PRACTICE, active: true });
    }
    workspace.revealLeaf(leaf);
    this.activateControlView();
  }
  async activateControlView() {
    const { workspace } = this.app;
    let leaf = null;
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
    this.app.workspace.getLeavesOfType(VIEW_TYPE_PRACTICE).forEach((l) => l.view.render());
    this.app.workspace.getLeavesOfType(VIEW_TYPE_CONTROL).forEach((l) => l.view.render());
  }
  refreshQueue() {
    this.currentQueue = [];
    const files = this.app.vault.getMarkdownFiles();
    const cats = /* @__PURE__ */ new Set();
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const tags = cache?.frontmatter?.tags || [];
      const tagArray = Array.isArray(tags) ? tags : [tags];
      if (tagArray.some((t) => String(t).includes("q"))) {
        const fm = cache.frontmatter;
        const category = fm.category || "Uncategorized";
        cats.add(category);
        if (this.filterCategory !== "All" && category !== this.filterCategory) continue;
        let fam = fm.familiarity;
        if (fam === void 0 || fam === null) fam = 50;
        if (fam > this.filterFamiliarity) continue;
        if (fam < 100) {
          this.currentQueue.push({
            file,
            id: fm.id,
            familiarity: fam,
            answer: fm.answer?.toString() || ""
          });
        }
      }
    }
    this.categories = ["All", ...Array.from(cats).sort()];
    this.currentQueue.sort((a, b) => a.familiarity - b.familiarity);
    this.currentQIndex = 0;
    this.isFinished = false;
    this.showingAnswer = false;
    this.selectedChoices.clear();
    this.saveSession();
    this.refreshAllViews();
  }
  async saveSession() {
    this.settings.savedQueuePaths = this.currentQueue.map((q) => q.file.path);
    this.settings.savedIndex = this.currentQIndex;
    await this.saveSettings();
  }
  async restoreSession() {
    const paths = this.settings.savedQueuePaths;
    const index = this.settings.savedIndex;
    this.currentQueue = [];
    for (const path of paths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof import_obsidian.TFile) {
        const cache = this.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter || {};
        this.currentQueue.push({
          file,
          id: fm.id || 0,
          familiarity: fm.familiarity ?? 50,
          answer: fm.answer?.toString() || ""
        });
      }
    }
    this.currentQIndex = index;
    if (this.currentQIndex >= this.currentQueue.length) {
      this.currentQIndex = 0;
    }
    const files = this.app.vault.getMarkdownFiles();
    const cats = /* @__PURE__ */ new Set();
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const tags = cache?.frontmatter?.tags || [];
      if (Array.isArray(tags) ? tags.includes("q") : tags === "q") {
        cats.add(cache?.frontmatter?.category || "Uncategorized");
      }
    }
    this.categories = ["All", ...Array.from(cats).sort()];
  }
  async autosaveSession() {
    const timestamp = (0, import_obsidian.moment)().format("YYYY-MM-DD_HH-mm-ss");
    const folderPath = "Practice_Sessions";
    if (!(this.app.vault.getAbstractFileByPath(folderPath) instanceof import_obsidian.TFolder)) {
      await this.app.vault.createFolder(folderPath);
    }
    const fileName = this.filterCategory.replace(/[^a-z0-9]/gi, "_").toLowerCase();
    const path = `${folderPath}/autosave_${fileName}.md`;
    const links = this.currentQueue.map((q) => `[[${q.file.path}|${q.file.basename}]]`).join("\n");
    const content = `---
type: practice_session
currentIndex: ${this.currentQIndex}
isFinished: ${this.isFinished}
category: ${this.filterCategory}
timestamp: ${timestamp}
---
# Autosaved Session - ${this.filterCategory}

#practice_resume

## Queue
${links}`;
    const existingFile = this.app.vault.getAbstractFileByPath(path);
    if (existingFile instanceof import_obsidian.TFile) {
      await this.app.vault.modify(existingFile, content);
    } else {
      await this.app.vault.create(path, content);
    }
  }
  async handleGrading(qMeta, isCorrect, answerStr) {
    const f = qMeta.familiarity;
    const newFam = isCorrect ? 100 - (100 - f) / 3 * 2 : f / 3;
    qMeta.familiarity = newFam;
    await this.app.fileManager.processFrontMatter(qMeta.file, (fm) => {
      fm.familiarity = newFam;
    });
    await this.recordHistory(qMeta, isCorrect, answerStr);
    this.sessionResults.set(qMeta.file.path, isCorrect ? "correct" : "wrong");
    if (isCorrect) {
      this.correctAnswers++;
      this.nextQuestion(false);
    } else {
      this.wrongAnswers++;
      this.showingAnswer = true;
      this.refreshAllViews();
    }
    await this.autosaveSession();
  }
  async recordHistory(qMeta, isCorrect, answerStr) {
    const ts = (0, import_obsidian.moment)().format("YYYY-MM-DD HH:mm:ss");
    const status = isCorrect ? "\u2705" : "\u274C";
    const content = await this.app.vault.read(qMeta.file);
    let newContent = content;
    const line = `| ${ts} | ${answerStr} | ${status} |`;
    if (content.includes("# Practice History")) {
      newContent += `
${line}`;
    } else {
      newContent += `

# Practice History
| Date | Selected | Correct? |
|---|---|---|
${line}`;
    }
    await this.app.vault.modify(qMeta.file, newContent);
  }
  nextQuestion(wrong) {
    if (wrong) {
      const qMeta = this.currentQueue[this.currentQIndex];
      this.currentQueue.splice(this.currentQIndex, 1);
      const rawOffsets = this.settings?.failOffsets || "3, 10, -1";
      const offsets = rawOffsets.split(",").map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
      for (const offset of offsets) {
        let targetIdx;
        if (offset === -1) {
          targetIdx = this.currentQueue.length;
        } else {
          targetIdx = this.currentQIndex + offset;
        }
        if (targetIdx < 0) targetIdx = 0;
        if (targetIdx > this.currentQueue.length) targetIdx = this.currentQueue.length;
        this.currentQueue.splice(targetIdx, 0, qMeta);
      }
    } else {
      if (this.currentQIndex >= this.currentQueue.length - 1) {
        this.isFinished = true;
      } else {
        this.currentQIndex++;
      }
    }
    this.showingAnswer = false;
    this.selectedChoices.clear();
    this.saveSession();
    this.refreshAllViews();
  }
};
var PracticeView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.boundKeydownHandler = this.onKeydown.bind(this);
  }
  getViewType() {
    return VIEW_TYPE_PRACTICE;
  }
  getDisplayText() {
    return "Practice Question";
  }
  getIcon() {
    return "check-square";
  }
  async onOpen() {
    document.body.addClass("is-practicing");
    document.body.style.setProperty("--theme-bg", this.plugin.settings.bgColor);
    document.body.style.setProperty("--theme-text", this.plugin.settings.textColor);
    document.body.style.setProperty("--theme-card", this.plugin.settings.cardColor);
    document.addEventListener("keydown", this.boundKeydownHandler);
    await this.render();
  }
  async onClose() {
    document.body.removeClass("is-practicing");
    document.body.style.removeProperty("--theme-bg");
    document.body.style.removeProperty("--theme-text");
    document.body.style.removeProperty("--theme-card");
    document.removeEventListener("keydown", this.boundKeydownHandler);
  }
  onKeydown(e) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (this.app.workspace.activeLeaf?.view !== this) return;
    const key = e.key.toLowerCase();
    if (key === "escape") {
      return;
    }
    const q = this.plugin.currentQueue[this.plugin.currentQIndex];
    if (!q) return;
    if (this.plugin.showingAnswer) {
      if (key === "enter" || key === " ") {
        this.plugin.nextQuestion(true);
        e.preventDefault();
      }
    } else {
      const letters = ["a", "b", "c", "d", "e", "f"];
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
      if (key === "s") {
        this.plugin.showingAnswer = true;
        this.render();
        e.preventDefault();
      } else if (key === "n") {
        this.setMastered(q);
        e.preventDefault();
      } else if (key === "enter" && this.plugin.selectedChoices.size > 0) {
        this.gradeMultipleChoice();
        e.preventDefault();
      }
    }
  }
  toggleChoice(char) {
    if (this.plugin.selectedChoices.has(char)) {
      this.plugin.selectedChoices.delete(char);
    } else {
      this.plugin.selectedChoices.add(char);
    }
    this.render();
  }
  gradeMultipleChoice() {
    const q = this.plugin.currentQueue[this.plugin.currentQIndex];
    const selected = Array.from(this.plugin.selectedChoices).sort().join("");
    const isCorrect = selected.toUpperCase() === q.answer.toUpperCase();
    this.plugin.handleGrading(q, isCorrect, selected);
  }
  async setMastered(qMeta) {
    qMeta.familiarity = 100;
    await this.app.fileManager.processFrontMatter(qMeta.file, (fm) => {
      fm.familiarity = 100;
    });
    this.plugin.nextQuestion(false);
    await this.plugin.autosaveSession();
  }
  async render() {
    const container = this.contentEl;
    container.empty();
    container.addClass("practice-view-root");
    if (this.plugin.isFinished) {
      this.renderSummary(container);
      return;
    }
    if (this.plugin.currentQueue.length === 0) {
      container.createEl("h3", { text: "Empty Queue! Start by selecting a category in the sidebar." });
      return;
    }
    const qMeta = this.plugin.currentQueue[this.plugin.currentQIndex];
    if (!qMeta) return;
    const mainLayout = container.createEl("div", { cls: "practice-tab-layout" });
    const vpb = mainLayout.createEl("div", { cls: "practice-vpb" });
    this.plugin.currentQueue.forEach((q, idx) => {
      const segment = vpb.createEl("div", { cls: "vpb-segment" });
      if (idx === this.plugin.currentQIndex) segment.addClass("is-active");
      const result = this.plugin.sessionResults.get(q.file.path);
      if (result === "correct") segment.addClass("is-correct");
      else if (result === "wrong") segment.addClass("is-wrong");
      segment.onclick = () => {
        this.plugin.currentQIndex = idx;
        this.plugin.showingAnswer = false;
        this.plugin.selectedChoices.clear();
        this.plugin.saveSession();
        this.plugin.refreshAllViews();
      };
    });
    container.style.setProperty("--theme-bg", this.plugin.settings.bgColor);
    container.style.setProperty("--theme-text", this.plugin.settings.textColor);
    container.style.setProperty("--theme-card", this.plugin.settings.cardColor);
    container.style.backgroundColor = "var(--theme-bg)";
    container.style.color = "var(--theme-text)";
    const questionContent = mainLayout.createEl("div", { cls: "practice-question-container" });
    questionContent.style.fontSize = `${this.plugin.settings.fontSize}px`;
    await this.renderQuestion(questionContent, qMeta);
  }
  renderSummary(container) {
    const summary = container.createEl("div", { cls: "practice-summary-view" });
    summary.createEl("h1", { text: "Practice Finished!" });
    const stats = summary.createEl("div", { cls: "practice-summary-stats" });
    const correct = stats.createEl("div", { cls: "stat-item stat-correct" });
    correct.createEl("span", { text: this.plugin.correctAnswers.toString(), cls: "stat-value" });
    correct.createEl("span", { text: "Correct", cls: "stat-label" });
    const wrong = stats.createEl("div", { cls: "stat-item stat-wrong" });
    wrong.createEl("span", { text: this.plugin.wrongAnswers.toString(), cls: "stat-value" });
    wrong.createEl("span", { text: "Wrong / Skipped", cls: "stat-label" });
    const actions = summary.createEl("div", { cls: "practice-summary-actions" });
    const restartBtn = actions.createEl("button", { text: "Restart Queue", cls: "practice-btn-restart" });
    restartBtn.onclick = async () => {
      this.plugin.currentQIndex = 0;
      this.plugin.isFinished = false;
      this.plugin.correctAnswers = 0;
      this.plugin.wrongAnswers = 0;
      this.plugin.sessionResults.clear();
      this.plugin.refreshAllViews();
    };
  }
  async renderHistoryBar(container, qMeta) {
    const content = await this.app.vault.read(qMeta.file);
    const historyMatch = content.match(/\| Date \| Selected \| Correct\? \|\n\|---\|---\|---\|\n([\s\S]*?)(?:\n\n|\n$|$)/);
    const historyBar = container.createEl("div", { cls: "practice-history-bar" });
    if (historyMatch) {
      const rows = historyMatch[1].trim().split("\n");
      rows.forEach((row) => {
        const block = historyBar.createEl("div", { cls: "history-block" });
        if (row.includes("\u2705")) block.addClass("is-correct");
        else if (row.includes("\u274C")) block.addClass("is-wrong");
      });
    }
  }
  async renderQuestion(container, qMeta) {
    const content = await this.app.vault.cachedRead(qMeta.file);
    const lines = content.split("\n");
    const isSingle = qMeta.answer.length <= 1;
    const firstChoiceIndex = lines.findIndex((l) => /^- [A-Z] /.test(l));
    const firstHeaderIndex = lines.findIndex((l) => l.startsWith("# "));
    let stemText = "";
    if (firstHeaderIndex !== -1 && firstHeaderIndex < firstChoiceIndex) {
      stemText = lines.slice(firstHeaderIndex, firstChoiceIndex).join("\n").trim();
    }
    this.plugin.activeChoices = [];
    const choicesRegex = /^- ([A-Z]) (.*)$/gm;
    let match;
    while ((match = choicesRegex.exec(content)) !== null) {
      this.plugin.activeChoices.push({ char: match[1], text: match[2].trim() });
    }
    const headerEl = container.createEl("div", { cls: "practice-header" });
    headerEl.createEl("span", { text: `Q: ${this.plugin.currentQIndex + 1} / ${this.plugin.currentQueue.length}` });
    headerEl.createEl("span", { text: `Fam: ${qMeta.familiarity.toFixed(1)}%` });
    await this.renderHistoryBar(container, qMeta);
    const stemEl = container.createEl("div", { cls: "practice-stem material-card" });
    stemEl.style.backgroundColor = this.plugin.settings.cardColor;
    await import_obsidian.MarkdownRenderer.renderMarkdown(stemText, stemEl, qMeta.file.path, this);
    const choicesEl = container.createEl("div", { cls: "practice-choices" });
    for (const choice of this.plugin.activeChoices) {
      const row = choicesEl.createEl("div", { cls: "practice-choice material-card" });
      row.style.backgroundColor = this.plugin.settings.cardColor;
      if (this.plugin.selectedChoices.has(choice.char)) row.addClass("practice-selected-choice");
      row.onclick = () => {
        if (this.plugin.showingAnswer) {
          if (isSingle && qMeta.answer.toUpperCase().includes(choice.char.toUpperCase())) {
            this.plugin.nextQuestion(true);
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
      const marker = row.createEl("span", { text: `${choice.char}. `, cls: "practice-choice-marker" });
      if (this.plugin.selectedChoices.has(choice.char)) marker.setText("\u2713 ");
      await import_obsidian.MarkdownRenderer.renderMarkdown(choice.text, row, qMeta.file.path, this);
      if (this.plugin.showingAnswer && qMeta.answer.toUpperCase().includes(choice.char.toUpperCase())) {
        row.addClass("practice-correct-choice");
        row.addClass("material-card-elevated");
      }
    }
    const actions = container.createEl("div", { cls: "practice-actions" });
    if (import_obsidian.Platform.isMobile && !this.plugin.showingAnswer) {
      const mobileBtnRow = container.createEl("div", { cls: "practice-mobile-btns" });
      this.plugin.activeChoices.forEach((choice) => {
        const btn = mobileBtnRow.createEl("button", { text: choice.char, cls: "practice-mobile-key" });
        if (this.plugin.selectedChoices.has(choice.char)) btn.addClass("is-selected");
        btn.onclick = () => {
          if (this.plugin.showingAnswer) {
            if (isSingle && qMeta.answer.toUpperCase().includes(choice.char.toUpperCase())) {
              this.plugin.nextQuestion(true);
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
      container.createEl("div", { text: `Answer: ${qMeta.answer}`, cls: "practice-answer-reveal" });
      if (!isSingle) {
        const nextBtn = actions.createEl("button", { text: "Next Question =>", cls: "practice-btn-wrong" });
        nextBtn.onclick = () => this.plugin.nextQuestion(true);
        const submitBtn = actions.createEl("button", { text: "Submit (Corrected)", cls: "practice-btn-submit" });
        submitBtn.onclick = () => {
          const selected = Array.from(this.plugin.selectedChoices).sort().join("");
          if (selected.toUpperCase() === qMeta.answer.toUpperCase()) {
            this.plugin.nextQuestion(true);
          }
        };
      }
    } else {
      if (!isSingle) {
        const submitBtn = actions.createEl("button", { text: "Submit Answer", cls: "practice-btn-submit" });
        submitBtn.onclick = () => this.gradeMultipleChoice();
      }
      const showBtn = actions.createEl("button", { text: "(S)how Answer", cls: "practice-btn-show" });
      showBtn.onclick = () => {
        this.plugin.showingAnswer = true;
        this.plugin.refreshAllViews();
      };
      const skipBtn = actions.createEl("button", { text: "Skip (N)", cls: "practice-btn-skip" });
      skipBtn.onclick = () => this.setMastered(qMeta);
    }
  }
};
var QueueControlView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE_CONTROL;
  }
  getDisplayText() {
    return "Queue Control";
  }
  getIcon() {
    return "list";
  }
  async onOpen() {
    await this.render();
  }
  async render() {
    const container = this.contentEl;
    container.empty();
    container.addClass("practice-control-root");
    const topSection = container.createEl("div", { cls: "practice-control-top" });
    const filtersCompact = topSection.createEl("div", { cls: "practice-filters-compact" });
    this.renderCompactFilters(filtersCompact);
    const themeSection = topSection.createEl("div", { cls: "practice-theme-grid-section" });
    themeSection.createEl("h4", { text: "Theme", cls: "sidebar-section-header" });
    this.renderThemeGrid(themeSection);
    const settingsCompact = topSection.createEl("div", { cls: "practice-settings-compact" });
    this.renderCompactSettings(settingsCompact);
    const queueScrollable = container.createEl("div", { cls: "practice-queue-scrollable" });
    this.renderQueueList(queueScrollable);
  }
  renderCompactFilters(parent) {
    const row1 = parent.createEl("div", { cls: "practice-toolbar-row" });
    row1.createEl("span", { text: "Category:" });
    const catSelect = row1.createEl("select");
    this.plugin.categories.forEach((cat) => {
      const opt = catSelect.createEl("option", { text: cat, value: cat });
      if (cat === this.plugin.filterCategory) opt.selected = true;
    });
    catSelect.onchange = () => {
      this.plugin.filterCategory = catSelect.value;
      this.plugin.refreshQueue();
    };
    const row2 = parent.createEl("div", { cls: "practice-toolbar-row" });
    row2.createEl("span", { text: "Max Familiarity:" });
    const sliderContainer = row2.createEl("div", { cls: "vertical-slider-container" });
    const famSlider = sliderContainer.createEl("input", { type: "range", cls: "vertical-slider" });
    famSlider.min = "0";
    famSlider.max = "100";
    famSlider.value = this.plugin.filterFamiliarity.toString();
    famSlider.setAttribute("orient", "vertical");
    const famLabel = sliderContainer.createEl("span", {
      text: `${this.plugin.filterFamiliarity.toFixed(0)}%`,
      cls: "vertical-slider-label"
    });
    famSlider.oninput = () => famLabel.setText(`${famSlider.value}%`);
    famSlider.onchange = () => {
      this.plugin.filterFamiliarity = parseInt(famSlider.value);
      this.plugin.refreshQueue();
    };
  }
  renderThemeGrid(parent) {
    const grid = parent.createEl("div", { cls: "theme-grid" });
    THEMES.forEach((theme) => {
      const block = grid.createEl("div", { cls: "theme-preview-block" });
      block.style.backgroundColor = theme.bg;
      block.style.color = theme.text;
      block.setAttribute("data-theme-name", theme.name);
      const nameEl = block.createEl("div", { cls: "theme-preview-name", text: theme.name });
      const sampleEl = block.createEl("div", { cls: "theme-preview-sample", text: "Sample Text" });
      const matches = this.plugin.settings.textColor === theme.text && this.plugin.settings.bgColor === theme.bg;
      const isDefaultWithVars = theme.name === "Default" && this.plugin.settings.textColor.includes("var") && this.plugin.settings.bgColor.includes("var");
      if (matches || isDefaultWithVars) {
        block.addClass("is-active");
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
  renderCompactSettings(parent) {
    const rowOffsets = parent.createEl("div", { cls: "practice-sidebar-setting-row" });
    rowOffsets.createEl("span", { text: "Insert Position:", title: "Offsets for re-inserting failed questions" });
    const offsetInput = rowOffsets.createEl("input", { type: "text", cls: "setting-input-text" });
    offsetInput.value = this.plugin.settings.failOffsets;
    offsetInput.onchange = async () => {
      this.plugin.settings.failOffsets = offsetInput.value;
      await this.plugin.saveSettings();
    };
    rowOffsets.createEl("div", { text: "e.g. 3, 10, -1 (Use -1 for end)", cls: "setting-instruction" });
    const rowSize = parent.createEl("div", { cls: "practice-sidebar-setting-row" });
    rowSize.createEl("span", { text: "Font Size:" });
    const sizeContainer = rowSize.createEl("div", { cls: "font-size-selector" });
    const sizes = [12, 14, 16, 18, 20, 24];
    sizes.forEach((sz) => {
      const sample = sizeContainer.createEl("span", { text: "A", cls: "font-sample" });
      sample.style.fontSize = `${sz}px`;
      if (this.plugin.settings.fontSize === sz) sample.addClass("is-active");
      sample.onclick = async () => {
        this.plugin.settings.fontSize = sz;
        await this.plugin.saveSettings();
        this.plugin.refreshAllViews();
      };
    });
  }
  renderQueueList(parent) {
    parent.createEl("h4", { text: "Queue", cls: "sidebar-section-header" });
    const list = parent.createEl("div", { cls: "practice-queue-list" });
    this.plugin.currentQueue.forEach((q, idx) => {
      const item = list.createEl("div", { cls: "practice-queue-item" });
      if (idx === this.plugin.currentQIndex) item.addClass("is-active");
      const result = this.plugin.sessionResults.get(q.file.path);
      if (result === "correct") item.addClass("is-correct");
      else if (result === "wrong") item.addClass("is-wrong");
      item.createEl("span", { text: `${idx + 1}.`, cls: "practice-queue-item-idx" });
      item.createEl("span", { text: q.file.basename, cls: "practice-queue-item-title" });
      const hue = Math.round(q.familiarity * 1.2);
      const famMarker = item.createEl("div", { cls: "practice-queue-item-fam-dot" });
      famMarker.style.backgroundColor = `hsl(${hue}, 80%, 45%)`;
      item.onclick = () => {
        this.plugin.currentQIndex = idx;
        this.plugin.isFinished = false;
        this.plugin.showingAnswer = false;
        this.plugin.selectedChoices.clear();
        this.plugin.saveSession();
        this.plugin.refreshAllViews();
      };
      if (idx === this.plugin.currentQIndex) {
        setTimeout(() => item.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
      }
    });
  }
};
var PracticeSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Practice Plugin Settings" });
    containerEl.createEl("p", { text: "All practice settings (filters, re-insertion offsets, and visual preferences) are now located in the Practice Control sidebar for easier access during practice sessions." });
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  VIEW_TYPE_CONTROL,
  VIEW_TYPE_PRACTICE
});
