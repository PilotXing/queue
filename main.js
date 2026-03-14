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
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// main.ts
var main_exports = {};
__export(main_exports, {
  VIEW_TYPE_PRACTICE: () => VIEW_TYPE_PRACTICE,
  default: () => PracticePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var VIEW_TYPE_PRACTICE = "practice-view";
var DEFAULT_SETTINGS = {
  failOffsets: "3, 10, -1",
  savedQueuePaths: [],
  savedIndex: 0
};
var PracticePlugin = class extends import_obsidian.Plugin {
  onload() {
    return __async(this, null, function* () {
      yield this.loadSettings();
      this.registerView(
        VIEW_TYPE_PRACTICE,
        (leaf) => new PracticeView(leaf, this)
      );
      this.addRibbonIcon("check-square", "Open Practice mode", () => {
        this.activateView();
      });
      this.addCommand({
        id: "open-practice-view",
        name: "Open Practice View",
        callback: () => {
          this.activateView();
        }
      });
      this.addSettingTab(new PracticeSettingTab(this.app, this));
    });
  }
  loadSettings() {
    return __async(this, null, function* () {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, yield this.loadData());
    });
  }
  saveSettings() {
    return __async(this, null, function* () {
      yield this.saveData(this.settings);
    });
  }
  activateView() {
    return __async(this, null, function* () {
      const { workspace } = this.app;
      let leaf = null;
      const leaves = workspace.getLeavesOfType(VIEW_TYPE_PRACTICE);
      if (leaves.length > 0) {
        leaf = leaves[0];
      } else {
        leaf = workspace.getRightLeaf(false);
        if (leaf) {
          yield leaf.setViewState({ type: VIEW_TYPE_PRACTICE, active: true });
        }
      }
      if (leaf) {
        workspace.revealLeaf(leaf);
      }
    });
  }
  // async activateView() {
  //     const { workspace } = this.app;
  //     let leaf: WorkspaceLeaf | null = null;
  //     const leaves = workspace.getLeavesOfType(VIEW_TYPE_PRACTICE);
  //     if (leaves.length > 0) {
  //         leaf = leaves[0];
  //     } else {
  //         leaf = workspace.getRightLeaf(false);
  //         if (leaf) {
  //             await leaf.setViewState({ type: VIEW_TYPE_PRACTICE, active: true });
  //         }
  //     }
  //     if (leaf) {
  //         workspace.revealLeaf(leaf);
  //     }
  // }
};
var PracticeSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Queue Settings" });
    new import_obsidian.Setting(containerEl).setName("Fail Re-insertion Offsets").setDesc("Comma-separated list of offsets for re-inserting failed questions. -1 means end of list. Example: 3, 10, -1").addText((text) => text.setPlaceholder("3, 10, -1").setValue(this.plugin.settings.failOffsets).onChange((value) => __async(this, null, function* () {
      this.plugin.settings.failOffsets = value;
    })));
    new import_obsidian.Setting(containerEl).setName("Apply Settings").setDesc("Save and apply the new re-insertion offsets.").addButton((btn) => btn.setButtonText("Apply").setCta().onClick(() => __async(this, null, function* () {
      yield this.plugin.saveSettings();
    })));
  }
};
var PracticeView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.currentQueue = [];
    this.currentQIndex = 0;
    this.isFinished = false;
    this.showingAnswer = false;
    this.correctAnswers = 0;
    this.wrongAnswers = 0;
    // Filter state
    this.filterCategory = "All";
    this.filterFamiliarity = 100;
    this.categories = ["All"];
    // Session State
    this.sessionResults = /* @__PURE__ */ new Map();
    this.selectedChoices = /* @__PURE__ */ new Set();
    this.activeChoices = [];
    this.plugin = plugin;
    this.boundKeydownHandler = this.onKeydown.bind(this);
  }
  getViewType() {
    return VIEW_TYPE_PRACTICE;
  }
  getDisplayText() {
    return "Queueueueue";
  }
  getIcon() {
    return "check-square";
  }
  onOpen() {
    return __async(this, null, function* () {
      document.addEventListener("keydown", this.boundKeydownHandler);
      if (this.plugin.settings.savedQueuePaths.length > 0) {
        yield this.restoreSession();
      } else {
        this.refreshQueue();
      }
      this.isFinished = false;
      yield this.render();
    });
  }
  onClose() {
    return __async(this, null, function* () {
      document.removeEventListener("keydown", this.boundKeydownHandler);
    });
  }
  onKeydown(e) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      return;
    const activeLeaf = this.app.workspace.activeLeaf;
    if (activeLeaf && activeLeaf.view !== this)
      return;
    const q = this.currentQueue[this.currentQIndex];
    if (!q)
      return;
    const key = e.key.toLowerCase();
    if (this.showingAnswer) {
      if (key === "enter" || key === " ") {
        this.nextQuestion(true);
        e.preventDefault();
      }
    } else {
      const letters = ["a", "b", "c", "d", "e", "f"];
      const idx = letters.indexOf(key);
      if (idx !== -1 && idx < this.activeChoices.length) {
        this.toggleChoice(key.toUpperCase());
        e.preventDefault();
        return;
      }
      const num = parseInt(key, 10);
      if (!isNaN(num) && num >= 1 && num <= this.activeChoices.length) {
        const choiceChar = letters[num - 1].toUpperCase();
        this.toggleChoice(choiceChar);
        e.preventDefault();
        return;
      }
      if (key === "s") {
        this.showingAnswer = true;
        this.render();
        e.preventDefault();
      } else if (key === "n") {
        this.setMastered(q);
        e.preventDefault();
      } else if (key === "enter" && this.selectedChoices.size > 0) {
        this.gradeMultipleChoice();
        e.preventDefault();
      }
    }
  }
  toggleChoice(char) {
    if (this.selectedChoices.has(char)) {
      this.selectedChoices.delete(char);
    } else {
      this.selectedChoices.add(char);
    }
    this.render();
  }
  saveSession() {
    return __async(this, null, function* () {
      this.plugin.settings.savedQueuePaths = this.currentQueue.map((q) => q.file.path);
      this.plugin.settings.savedIndex = this.currentQIndex;
      yield this.plugin.saveSettings();
    });
  }
  restoreSession() {
    return __async(this, null, function* () {
      var _a, _b, _c, _d;
      const paths = this.plugin.settings.savedQueuePaths;
      const index = this.plugin.settings.savedIndex;
      this.currentQueue = [];
      for (const path of paths) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof import_obsidian.TFile) {
          const cache = this.app.metadataCache.getFileCache(file);
          const fm = (cache == null ? void 0 : cache.frontmatter) || {};
          this.currentQueue.push({
            file,
            id: fm.id || 0,
            familiarity: (_a = fm.familiarity) != null ? _a : 50,
            answer: ((_b = fm.answer) == null ? void 0 : _b.toString()) || ""
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
        const tags = ((_c = cache == null ? void 0 : cache.frontmatter) == null ? void 0 : _c.tags) || [];
        if (Array.isArray(tags) ? tags.includes("q") : tags === "q") {
          cats.add(((_d = cache == null ? void 0 : cache.frontmatter) == null ? void 0 : _d.category) || "Uncategorized");
        }
      }
      this.categories = ["All", ...Array.from(cats).sort()];
    });
  }
  refreshQueue() {
    var _a, _b;
    this.currentQueue = [];
    const files = this.app.vault.getMarkdownFiles();
    const cats = /* @__PURE__ */ new Set();
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const tags = ((_a = cache == null ? void 0 : cache.frontmatter) == null ? void 0 : _a.tags) || [];
      const tagArray = Array.isArray(tags) ? tags : [tags];
      if (tagArray.some((t) => String(t).includes("q"))) {
        const fm = cache.frontmatter;
        const category = fm.category || "Uncategorized";
        cats.add(category);
        if (this.filterCategory !== "All" && category !== this.filterCategory)
          continue;
        let fam = fm.familiarity;
        if (fam === void 0 || fam === null)
          fam = 50;
        if (fam > this.filterFamiliarity)
          continue;
        if (fam < 100) {
          this.currentQueue.push({
            file,
            id: fm.id,
            familiarity: fam,
            answer: ((_b = fm.answer) == null ? void 0 : _b.toString()) || ""
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
  }
  render() {
    return __async(this, null, function* () {
      const container = this.contentEl;
      container.empty();
      container.addClass("practice-view-root");
      if (this.isFinished) {
        this.renderSummary(container);
        return;
      }
      const toolbarEl = container.createEl("div", { cls: "practice-sidebar-toolbar" });
      this.renderToolbar(toolbarEl);
      const contentArea = container.createEl("div", { cls: "practice-sidebar-content" });
      const qMeta = this.currentQueue[this.currentQIndex];
      if (qMeta) {
        yield this.renderQuestion(contentArea, qMeta);
      } else {
        contentArea.createEl("h3", { text: "No questions matching filters! \u{1F9D0}" });
      }
      const queueArea = container.createEl("div", { cls: "practice-sidebar-queue" });
      this.renderSidebar(queueArea);
    });
  }
  renderSummary(container) {
    const summary = container.createEl("div", { cls: "practice-summary-view" });
    summary.createEl("h1", { text: "Practice Finished!" });
    summary.createEl("p", { text: "Great job! Here is how you did in this session:" });
    const stats = summary.createEl("div", { cls: "practice-summary-stats" });
    const correct = stats.createEl("div", { cls: "stat-item" });
    correct.createEl("span", { text: this.correctAnswers.toString(), cls: "stat-value stat-correct" });
    correct.createEl("span", { text: "Correct", cls: "stat-label" });
    const wrong = stats.createEl("div", { cls: "stat-item" });
    wrong.createEl("span", { text: this.wrongAnswers.toString(), cls: "stat-value stat-wrong" });
    wrong.createEl("span", { text: "Wrong / Skipped", cls: "stat-label" });
    const actions = summary.createEl("div", { cls: "practice-summary-actions" });
    const restartBtn = actions.createEl("button", { text: "Restart Queue", cls: "practice-btn-restart" });
    restartBtn.onclick = () => __async(this, null, function* () {
      this.currentQIndex = 0;
      this.isFinished = false;
      this.correctAnswers = 0;
      this.wrongAnswers = 0;
      this.sessionResults.clear();
      yield this.render();
    });
    const refreshBtn = actions.createEl("button", { text: "Refresh & New Queue", cls: "practice-btn-refresh" });
    refreshBtn.onclick = () => __async(this, null, function* () {
      this.refreshQueue();
      this.isFinished = false;
      this.correctAnswers = 0;
      this.wrongAnswers = 0;
      this.sessionResults.clear();
      yield this.render();
    });
  }
  renderToolbar(parent) {
    const row1 = parent.createEl("div", { cls: "practice-toolbar-row" });
    row1.createEl("span", { text: "Category:" });
    const catSelect = row1.createEl("select");
    this.categories.forEach((cat) => {
      const opt = catSelect.createEl("option", { text: cat, value: cat });
      if (cat === this.filterCategory)
        opt.selected = true;
    });
    catSelect.onchange = () => __async(this, null, function* () {
      this.filterCategory = catSelect.value;
      this.refreshQueue();
      yield this.render();
    });
    const row2 = parent.createEl("div", { cls: "practice-toolbar-row" });
    row2.createEl("span", { text: "Max Fam:" });
    const famSlider = row2.createEl("input", { type: "range" });
    famSlider.min = "0";
    famSlider.max = "100";
    famSlider.value = this.filterFamiliarity.toString();
    const famLabel = row2.createEl("span", { text: `${this.filterFamiliarity.toFixed(0)}%` });
    famSlider.oninput = () => {
      famLabel.setText(`${famSlider.value}%`);
    };
    famSlider.onchange = () => __async(this, null, function* () {
      this.filterFamiliarity = parseInt(famSlider.value);
      this.refreshQueue();
      yield this.render();
    });
    const row3 = parent.createEl("div", { cls: "practice-toolbar-row" });
    const saveSessionBtn = row3.createEl("button", { text: "Save Session", cls: "practice-btn-save" });
    saveSessionBtn.onclick = () => this.saveSessionToFile();
    const loadSessionBtn = row3.createEl("button", { text: "Load Session", cls: "practice-btn-load" });
    loadSessionBtn.onclick = () => this.loadSessionFromFile();
  }
  saveSessionToFile() {
    return __async(this, null, function* () {
      const timestamp = (0, import_obsidian.moment)().format("YYYY-MM-DD_HH-mm-ss");
      const folderPath = "Practice_Sessions";
      if (!(this.app.vault.getAbstractFileByPath(folderPath) instanceof import_obsidian.TFolder)) {
        yield this.app.vault.createFolder(folderPath);
      }
      const path = `${folderPath}/session_${timestamp}.md`;
      const links = this.currentQueue.map((q) => `[[${q.file.path}|${q.file.basename}]]`).join("\n");
      const content = `---
type: practice_session
currentIndex: ${this.currentQIndex}
---
# Practice Session - ${timestamp}

#practice_resume

## Queue
${links}`;
      yield this.app.vault.create(path, content);
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof import_obsidian.TFile) {
        this.app.workspace.getLeaf().openFile(file);
      }
    });
  }
  loadSessionFromFile() {
    return __async(this, null, function* () {
      var _a, _b;
      const activeFile = this.app.workspace.getActiveFile();
      if (!activeFile)
        return;
      const content = yield this.app.vault.read(activeFile);
      if (!content.includes("type: practice_session")) {
        return;
      }
      const cache = this.app.metadataCache.getFileCache(activeFile);
      const fm = (cache == null ? void 0 : cache.frontmatter) || {};
      const savedIndex = fm.currentIndex || 0;
      const linksMatch = content.match(/\[\[(.*?)(\|(.*?))?\]\]/g);
      if (!linksMatch)
        return;
      this.currentQueue = [];
      for (const link of linksMatch) {
        const path = link.replace("[[", "").replace("]]", "").split("|")[0];
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof import_obsidian.TFile) {
          const qCache = this.app.metadataCache.getFileCache(file);
          const qFm = (qCache == null ? void 0 : qCache.frontmatter) || {};
          this.currentQueue.push({
            file,
            id: qFm.id || 0,
            familiarity: (_a = qFm.familiarity) != null ? _a : 50,
            answer: ((_b = qFm.answer) == null ? void 0 : _b.toString()) || ""
          });
        }
      }
      this.currentQIndex = savedIndex;
      this.isFinished = false;
      this.saveSession();
      this.render();
    });
  }
  renderSidebar(parent) {
    parent.createEl("h4", { text: "Queue" });
    const list = parent.createEl("div", { cls: "practice-queue-list" });
    this.currentQueue.forEach((q, idx) => {
      const item = list.createEl("div", { cls: "practice-queue-item" });
      if (idx === this.currentQIndex)
        item.addClass("is-active");
      const result = this.sessionResults.get(q.file.path);
      if (result === "correct")
        item.addClass("is-correct");
      else if (result === "wrong")
        item.addClass("is-wrong");
      const words = q.file.basename.split(/[\s_-]+/).filter((w) => w.length > 0);
      const iconText = words.slice(0, 2).join(" ");
      const hue = Math.round(q.familiarity * 1.2);
      const color = `hsl(${hue}, 80%, 45%)`;
      item.createEl("span", { text: `${idx + 1}.`, cls: "practice-queue-item-idx" });
      item.createEl("span", { text: iconText, cls: "practice-queue-item-title" });
      const famMarker = item.createEl("div", { cls: "practice-queue-item-fam-dot" });
      famMarker.style.backgroundColor = color;
      item.onclick = () => __async(this, null, function* () {
        this.currentQIndex = idx;
        this.isFinished = false;
        this.showingAnswer = false;
        this.selectedChoices.clear();
        this.saveSession();
        yield this.render();
      });
      if (idx === this.currentQIndex) {
        setTimeout(() => item.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
      }
    });
  }
  renderQuestion(container, qMeta) {
    return __async(this, null, function* () {
      const content = yield this.app.vault.cachedRead(qMeta.file);
      const lines = content.split("\n");
      const typeMatch = content.match(/^# (.*)$/m);
      const typeStr = typeMatch ? typeMatch[1].trim() : "Question";
      const isSingle = typeStr === "\u5355\u9009\u9898" && qMeta.answer.length <= 1;
      const firstChoiceIndex = lines.findIndex((l) => /^- \*\*[A-Z]\.\*\*/.test(l));
      let stemText = lines.slice(lines.findIndex((l) => l.startsWith("# ")) + 1, firstChoiceIndex).join("\n").trim();
      this.activeChoices = [];
      const choicesRegex = /^- \*\*([A-Z])\.\*\* (.*)$/gm;
      let match;
      while ((match = choicesRegex.exec(content)) !== null) {
        this.activeChoices.push({ char: match[1], text: match[2].trim() });
      }
      const headerEl = container.createEl("div", { cls: "practice-header" });
      headerEl.createEl("span", { text: `Q: ${this.currentQIndex + 1} / ${this.currentQueue.length} | C: ${this.correctAnswers} / W: ${this.wrongAnswers}` });
      headerEl.createEl("span", { text: `Familiarity: ${qMeta.familiarity.toFixed(1)}%` });
      const stemEl = container.createEl("div", { cls: "practice-stem" });
      yield import_obsidian.MarkdownRenderer.renderMarkdown(`**[${isSingle ? "S" : "M"}]**

${stemText}`, stemEl, qMeta.file.path, this);
      const choicesEl = container.createEl("div", { cls: "practice-choices" });
      for (const choice of this.activeChoices) {
        const row = choicesEl.createEl("div", { cls: "practice-choice" });
        if (this.selectedChoices.has(choice.char))
          row.addClass("practice-selected-choice");
        row.onclick = () => {
          if (this.showingAnswer)
            return;
          if (isSingle) {
            const isCorrect = qMeta.answer.toUpperCase().includes(choice.char.toUpperCase());
            this.handleGrading(qMeta, isCorrect, choice.char);
          } else {
            this.toggleChoice(choice.char);
          }
        };
        const marker = row.createEl("span", { text: `${choice.char}. `, cls: "practice-choice-marker" });
        if (this.selectedChoices.has(choice.char))
          marker.setText("\u2713 ");
        yield import_obsidian.MarkdownRenderer.renderMarkdown(choice.text, row, qMeta.file.path, this);
        if (this.showingAnswer && qMeta.answer.toUpperCase().includes(choice.char.toUpperCase())) {
          row.addClass("practice-correct-choice");
        }
      }
      const actions = container.createEl("div", { cls: "practice-actions" });
      if (this.showingAnswer) {
        container.createEl("div", { text: `Answer: ${qMeta.answer}`, cls: "practice-answer-reveal" });
        const nextBtn = actions.createEl("button", { text: "Next Question =>", cls: "practice-btn-wrong" });
        nextBtn.onclick = () => this.nextQuestion(true);
      } else {
        if (!isSingle) {
          const submitBtn = actions.createEl("button", { text: "Submit Answer", cls: "practice-btn-submit" });
          submitBtn.onclick = () => this.gradeMultipleChoice();
        }
        const showBtn = actions.createEl("button", { text: "(S)how Answer", cls: "practice-btn-show" });
        showBtn.onclick = () => {
          this.showingAnswer = true;
          this.render();
        };
        const skipBtn = actions.createEl("button", { text: "Skip (N)", cls: "practice-btn-skip" });
        skipBtn.onclick = () => this.setMastered(qMeta);
      }
      this.updateExportFile(qMeta);
    });
  }
  updateExportFile(q) {
    return __async(this, null, function* () {
      const path = "current_q.md";
      const link = `[[${q.file.basename}]]`;
      const content = yield this.app.vault.cachedRead(q.file);
      const exportContent = `# Current Question

Link: ${link}

#practice_resume

---

${content}

---

**To continue practice, click "Open Practice mode" in the ribbon or use the command palette.**`;
      const existingFile = this.app.vault.getAbstractFileByPath(path);
      if (existingFile instanceof import_obsidian.TFile) {
        yield this.app.vault.modify(existingFile, exportContent);
      } else {
        yield this.app.vault.create(path, exportContent);
      }
    });
  }
  autosaveSession() {
    return __async(this, null, function* () {
      const timestamp = (0, import_obsidian.moment)().format("YYYY-MM-DD_HH-mm-ss");
      const folderPath = "Practice_Sessions";
      if (!(this.app.vault.getAbstractFileByPath(folderPath) instanceof import_obsidian.TFolder)) {
        yield this.app.vault.createFolder(folderPath);
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
        yield this.app.vault.modify(existingFile, content);
      } else {
        yield this.app.vault.create(path, content);
      }
    });
  }
  gradeMultipleChoice() {
    const q = this.currentQueue[this.currentQIndex];
    const selected = Array.from(this.selectedChoices).sort().join("");
    const isCorrect = selected.toUpperCase() === q.answer.toUpperCase();
    this.handleGrading(q, isCorrect, selected);
  }
  handleGrading(qMeta, isCorrect, answerStr) {
    return __async(this, null, function* () {
      const f = qMeta.familiarity;
      const newFam = isCorrect ? 100 - (100 - f) / 3 * 2 : f / 3;
      qMeta.familiarity = newFam;
      yield this.app.fileManager.processFrontMatter(qMeta.file, (fm) => {
        fm.familiarity = newFam;
      });
      yield this.recordHistory(qMeta, isCorrect, answerStr);
      this.sessionResults.set(qMeta.file.path, isCorrect ? "correct" : "wrong");
      if (isCorrect) {
        this.correctAnswers++;
        this.nextQuestion(false);
      } else {
        this.wrongAnswers++;
        this.showingAnswer = true;
        this.render();
      }
      yield this.autosaveSession();
    });
  }
  recordHistory(qMeta, isCorrect, answerStr) {
    return __async(this, null, function* () {
      const ts = (0, import_obsidian.moment)().format("YYYY-MM-DD HH:mm:ss");
      const status = isCorrect ? "\u2705" : "\u274C";
      const content = yield this.app.vault.read(qMeta.file);
      let newContent = content;
      const line = `| ${ts} | ${answerStr} | ${status} |`;
      if (content.includes("## Practice History")) {
        newContent += `
${line}`;
      } else {
        newContent += `

## Practice History
| Date | Selected | Correct? |
|---|---|---|
${line}`;
      }
      yield this.app.vault.modify(qMeta.file, newContent);
    });
  }
  setMastered(qMeta) {
    return __async(this, null, function* () {
      qMeta.familiarity = 100;
      yield this.app.fileManager.processFrontMatter(qMeta.file, (fm) => {
        fm.familiarity = 100;
      });
      this.nextQuestion(false);
      yield this.autosaveSession();
    });
  }
  nextQuestion(wrong) {
    var _a;
    if (wrong) {
      const qMeta = this.currentQueue[this.currentQIndex];
      this.currentQueue.splice(this.currentQIndex, 1);
      const rawOffsets = ((_a = this.plugin.settings) == null ? void 0 : _a.failOffsets) || "3, 10, -1";
      const offsets = rawOffsets.split(",").map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
      for (const offset of offsets) {
        let targetIdx;
        if (offset === -1) {
          targetIdx = this.currentQueue.length;
        } else {
          targetIdx = this.currentQIndex + offset;
        }
        if (targetIdx < 0)
          targetIdx = 0;
        if (targetIdx > this.currentQueue.length)
          targetIdx = this.currentQueue.length;
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
    this.render();
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  VIEW_TYPE_PRACTICE
});
