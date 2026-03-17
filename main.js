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
  default: () => PracticePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian5 = require("obsidian");

// src/managers/SessionManager.ts
var import_obsidian = require("obsidian");
var SessionManager = class {
  constructor(plugin) {
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
    this.plugin = plugin;
  }
  loadSessionFromFile(file) {
    return __async(this, null, function* () {
      var _a, _b;
      const content = yield this.plugin.app.vault.read(file);
      const cache = this.plugin.app.metadataCache.getFileCache(file);
      const fm = (cache == null ? void 0 : cache.frontmatter) || {};
      this.filterCategory = fm.category || "All";
      this.currentQIndex = fm.currentIndex || 0;
      this.isFinished = fm.isFinished || false;
      this.currentQueue = [];
      const linkRegex = /\[\[(.*?)(?:\|.*?)?\]\]/g;
      let match;
      while ((match = linkRegex.exec(content)) !== null) {
        const path = match[1];
        const qFile = this.plugin.app.vault.getAbstractFileByPath(path);
        if (qFile instanceof import_obsidian.TFile) {
          const qCache = this.plugin.app.metadataCache.getFileCache(qFile);
          const qFm = (qCache == null ? void 0 : qCache.frontmatter) || {};
          this.currentQueue.push({
            file: qFile,
            id: qFm.id || 0,
            familiarity: (_a = qFm.familiarity) != null ? _a : 50,
            answer: ((_b = qFm.answer) == null ? void 0 : _b.toString()) || ""
          });
        }
      }
      if (this.currentQueue.length > 0) {
        yield this.saveSession();
        yield this.plugin.viewManager.activateView();
        this.plugin.viewManager.refreshAllViews();
      }
    });
  }
  refreshQueue() {
    var _a, _b;
    this.currentQueue = [];
    const files = this.plugin.app.vault.getMarkdownFiles();
    const cats = /* @__PURE__ */ new Set();
    for (const file of files) {
      const cache = this.plugin.app.metadataCache.getFileCache(file);
      const tags = ((_a = cache == null ? void 0 : cache.frontmatter) == null ? void 0 : _a.tags) || [];
      const tagArray = Array.isArray(tags) ? tags : [tags];
      if (tagArray.some((t) => String(t).includes("q"))) {
        const fm = cache.frontmatter;
        const category = (fm.category || "Uncategorized").toString().trim();
        cats.add(category);
        const currentFilterCat = this.filterCategory.trim();
        if (currentFilterCat !== "All" && category !== currentFilterCat)
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
    this.plugin.viewManager.refreshAllViews();
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
      const paths = this.plugin.settings.savedQueuePaths || [];
      const index = this.plugin.settings.savedIndex || 0;
      this.currentQueue = [];
      for (const path of paths) {
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        if (file instanceof import_obsidian.TFile) {
          const cache = this.plugin.app.metadataCache.getFileCache(file);
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
      const files = this.plugin.app.vault.getMarkdownFiles();
      const cats = /* @__PURE__ */ new Set();
      for (const file of files) {
        const cache = this.plugin.app.metadataCache.getFileCache(file);
        const tags = ((_c = cache == null ? void 0 : cache.frontmatter) == null ? void 0 : _c.tags) || [];
        if (Array.isArray(tags) ? tags.includes("q") : tags === "q") {
          cats.add(((_d = cache == null ? void 0 : cache.frontmatter) == null ? void 0 : _d.category) || "Uncategorized");
        }
      }
      this.categories = ["All", ...Array.from(cats).sort()];
    });
  }
  autosaveSession() {
    return __async(this, null, function* () {
      const timestamp = (0, import_obsidian.moment)().format("YYYY-MM-DD_HH-mm-ss");
      const folderPath = "Practice_Sessions";
      if (!(this.plugin.app.vault.getAbstractFileByPath(folderPath) instanceof import_obsidian.TFolder)) {
        yield this.plugin.app.vault.createFolder(folderPath);
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
      const existingFile = this.plugin.app.vault.getAbstractFileByPath(path);
      if (existingFile instanceof import_obsidian.TFile) {
        yield this.plugin.app.vault.modify(existingFile, content);
      } else {
        yield this.plugin.app.vault.create(path, content);
      }
    });
  }
  handleGrading(qMeta, isCorrect, answerStr) {
    return __async(this, null, function* () {
      const f = qMeta.familiarity;
      const newFam = isCorrect ? 100 - (100 - f) / 3 * 2 : f / 3;
      qMeta.familiarity = newFam;
      yield this.plugin.app.fileManager.processFrontMatter(qMeta.file, (fm) => {
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
        this.plugin.viewManager.refreshAllViews();
      }
      yield this.autosaveSession();
    });
  }
  recordHistory(qMeta, isCorrect, answerStr) {
    return __async(this, null, function* () {
      const ts = (0, import_obsidian.moment)().format("YYYY-MM-DD HH:mm:ss");
      const status = isCorrect ? "\u2705" : "\u274C";
      const content = yield this.plugin.app.vault.read(qMeta.file);
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
      yield this.plugin.app.vault.modify(qMeta.file, newContent);
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
    this.plugin.viewManager.refreshAllViews();
  }
};

// src/types.ts
var VIEW_TYPE_PRACTICE = "practice-view";
var VIEW_TYPE_CONTROL = "queue-control-view";
var DEFAULT_SETTINGS = {
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

// src/managers/ViewManager.ts
var ViewManager = class {
  constructor(plugin) {
    this.plugin = plugin;
  }
  activateView() {
    return __async(this, null, function* () {
      const { workspace } = this.plugin.app;
      let leaf = workspace.getLeavesOfType(VIEW_TYPE_PRACTICE)[0];
      if (!leaf) {
        leaf = workspace.getLeaf("tab");
        yield leaf.setViewState({ type: VIEW_TYPE_PRACTICE, active: true });
      }
      workspace.revealLeaf(leaf);
      this.activateControlView();
    });
  }
  activateControlView() {
    return __async(this, null, function* () {
      const { workspace } = this.plugin.app;
      let leaf = workspace.getLeavesOfType(VIEW_TYPE_CONTROL)[0];
      if (!leaf) {
        leaf = workspace.getRightLeaf(false);
        if (leaf) {
          yield leaf.setViewState({ type: VIEW_TYPE_CONTROL, active: true });
        }
      }
      if (leaf)
        workspace.revealLeaf(leaf);
    });
  }
  refreshAllViews() {
    this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_PRACTICE).forEach((l) => l.view.render());
    this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_CONTROL).forEach((l) => l.view.render());
  }
};

// src/managers/ButtonLayoutManager.ts
var ButtonLayoutManager = class {
  constructor(plugin) {
    this.plugin = plugin;
  }
  get isUnlocked() {
    return this.plugin.settings.unlockButtonLayout;
  }
  getPosition(buttonId) {
    return this.plugin.settings.buttonLayouts[buttonId] || null;
  }
  savePosition(buttonId, x, y) {
    return __async(this, null, function* () {
      this.plugin.settings.buttonLayouts[buttonId] = { x, y };
      yield this.plugin.saveSettings();
    });
  }
};

// src/views/PracticeView.ts
var import_obsidian2 = require("obsidian");

// src/components/DraggableButton.ts
var DraggableButton = class {
  constructor(parent, manager, id, text, cls, onClick) {
    this.isDragging = false;
    this.isLongPress = false;
    this.pressTimer = null;
    this.startX = 0;
    this.startY = 0;
    this.currentX = 0;
    this.currentY = 0;
    this.initialPointerX = 0;
    this.initialPointerY = 0;
    this.onPointerDown = (e) => {
      if (e.button !== 0)
        return;
      this.isLongPress = false;
      this.initialPointerX = e.clientX;
      this.initialPointerY = e.clientY;
      this.pressTimer = setTimeout(() => {
        this.isLongPress = true;
        this.startDragging(e);
      }, 500);
      window.addEventListener("pointermove", this.onPointerMoveWindow);
      window.addEventListener("pointerup", this.onPointerUpWindow);
      window.addEventListener("pointercancel", this.onPointerUpWindow);
    };
    this.onPointerMoveWindow = (e) => {
      if (!this.isLongPress && this.pressTimer) {
        const dx = Math.abs(e.clientX - this.initialPointerX);
        const dy = Math.abs(e.clientY - this.initialPointerY);
        if (dx > 8 || dy > 8) {
          clearTimeout(this.pressTimer);
          this.pressTimer = null;
        }
      } else if (this.isDragging) {
        this.currentX = e.clientX - this.startX;
        this.currentY = e.clientY - this.startY;
        this.updateTransform();
      }
    };
    this.onPointerUpWindow = (e) => __async(this, null, function* () {
      if (this.pressTimer) {
        clearTimeout(this.pressTimer);
        this.pressTimer = null;
      }
      window.removeEventListener("pointermove", this.onPointerMoveWindow);
      window.removeEventListener("pointerup", this.onPointerUpWindow);
      window.removeEventListener("pointercancel", this.onPointerUpWindow);
      if (this.isDragging) {
        this.isDragging = false;
        this.containerEl.style.cursor = "pointer";
        this.containerEl.removeClass("is-dragging");
        yield this.manager.savePosition(this.buttonId, this.currentX, this.currentY);
        const preventClick = (evt) => {
          evt.stopPropagation();
          evt.preventDefault();
          this.containerEl.removeEventListener("click", preventClick, true);
        };
        this.containerEl.addEventListener("click", preventClick, true);
        setTimeout(() => this.containerEl.removeEventListener("click", preventClick, true), 100);
      }
    });
    this.manager = manager;
    this.buttonId = id;
    this.containerEl = parent.createEl("button", { text, cls: `draggable-btn ${cls}` });
    this.containerEl.style.position = "absolute";
    this.containerEl.style.zIndex = "50";
    this.containerEl.style.cursor = "pointer";
    const pos = this.manager.getPosition(id);
    if (pos) {
      this.currentX = pos.x;
      this.currentY = pos.y;
      this.updateTransform();
    }
    this.containerEl.onclick = (e) => {
      onClick();
    };
    this.containerEl.addEventListener("pointerdown", this.onPointerDown);
  }
  setText(text) {
    this.containerEl.setText(text);
  }
  hide() {
    this.containerEl.style.display = "none";
  }
  show() {
    this.containerEl.style.display = "";
  }
  startDragging(e) {
    this.isDragging = true;
    this.containerEl.style.cursor = "grabbing";
    this.containerEl.addClass("is-dragging");
    let transformMatches = this.containerEl.style.transform.match(/translate\(([-0-9.]+)px,\s*([-0-9.]+)px\)/);
    if (transformMatches) {
      this.currentX = parseFloat(transformMatches[1]);
      this.currentY = parseFloat(transformMatches[2]);
    }
    this.startX = this.initialPointerX - this.currentX;
    this.startY = this.initialPointerY - this.currentY;
  }
  updateTransform() {
    this.containerEl.style.transform = `translate(${this.currentX}px, ${this.currentY}px)`;
  }
};

// src/views/PracticeView.ts
var PracticeView = class extends import_obsidian2.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.touchStartY = 0;
    this.touchStartTime = 0;
    // Draggable Instances
    this.choiceButtons = [];
    this.actionButtons = [];
    this.plugin = plugin;
    this.boundKeydownHandler = this.onKeydown.bind(this);
    this.boundTouchStartHandler = this.onTouchStart.bind(this);
    this.boundTouchEndHandler = this.onTouchEnd.bind(this);
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
  onOpen() {
    return __async(this, null, function* () {
      document.addEventListener("keydown", this.boundKeydownHandler);
      this.contentEl.addEventListener("touchstart", this.boundTouchStartHandler, { passive: true });
      this.contentEl.addEventListener("touchend", this.boundTouchEndHandler, { passive: true });
      yield this.render();
    });
  }
  onClose() {
    return __async(this, null, function* () {
      document.removeEventListener("keydown", this.boundKeydownHandler);
      this.contentEl.removeEventListener("touchstart", this.boundTouchStartHandler);
      this.contentEl.removeEventListener("touchend", this.boundTouchEndHandler);
    });
  }
  onKeydown(e) {
    var _a;
    if (this.plugin.buttonManager.isUnlocked)
      return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      return;
    if (((_a = this.app.workspace.activeLeaf) == null ? void 0 : _a.view) !== this)
      return;
    const key = e.key.toLowerCase();
    if (key === "escape") {
      return;
    }
    const q = this.plugin.session.currentQueue[this.plugin.session.currentQIndex];
    if (!q)
      return;
    if (this.plugin.session.showingAnswer) {
      if (key === "enter" || key === " ") {
        this.plugin.session.nextQuestion(true);
        e.preventDefault();
      }
    } else {
      const letters = ["a", "b", "c", "d", "e", "f"];
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
      if (key === "s") {
        this.plugin.session.showingAnswer = true;
        this.render();
        e.preventDefault();
      } else if (key === "n") {
        this.setMastered(q);
        e.preventDefault();
      } else if (key === "enter" && this.plugin.session.selectedChoices.size > 0) {
        this.gradeMultipleChoice();
        e.preventDefault();
      }
    }
  }
  onTouchStart(e) {
    if (e.changedTouches.length > 0) {
      this.touchStartY = e.changedTouches[0].screenY;
      this.touchStartTime = Date.now();
    }
  }
  onTouchEnd(e) {
    if (e.changedTouches.length > 0) {
      const touchEndY = e.changedTouches[0].screenY;
      const timeDiff = Date.now() - this.touchStartTime;
      const distance = this.touchStartY - touchEndY;
      if (distance > 50 && timeDiff < 400) {
        this.handleSwipeUp();
      }
    }
  }
  handleSwipeUp() {
    if (this.plugin.buttonManager.isUnlocked)
      return;
    if (this.plugin.session.isFinished)
      return;
    const qMeta = this.plugin.session.currentQueue[this.plugin.session.currentQIndex];
    if (!qMeta)
      return;
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
  toggleChoice(char) {
    if (this.plugin.buttonManager.isUnlocked)
      return;
    if (this.plugin.session.selectedChoices.has(char)) {
      this.plugin.session.selectedChoices.delete(char);
    } else {
      this.plugin.session.selectedChoices.add(char);
    }
    this.render();
  }
  gradeMultipleChoice() {
    if (this.plugin.buttonManager.isUnlocked)
      return;
    const q = this.plugin.session.currentQueue[this.plugin.session.currentQIndex];
    const selected = Array.from(this.plugin.session.selectedChoices).sort().join("");
    const isCorrect = selected.toUpperCase() === q.answer.toUpperCase();
    this.plugin.session.handleGrading(q, isCorrect, selected);
  }
  setMastered(qMeta) {
    return __async(this, null, function* () {
      if (this.plugin.buttonManager.isUnlocked)
        return;
      qMeta.familiarity = 100;
      yield this.app.fileManager.processFrontMatter(qMeta.file, (fm) => {
        fm.familiarity = 100;
      });
      this.plugin.session.nextQuestion(false);
      yield this.plugin.session.autosaveSession();
    });
  }
  render() {
    return __async(this, null, function* () {
      const container = this.contentEl;
      container.empty();
      container.addClass("practice-view-root");
      container.removeClass("theme-solarized-dark", "theme-solarized-light", "theme-dark-blue", "theme-sepia", "theme-clean", "theme-default");
      container.addClass(`theme-${this.plugin.settings.theme}`);
      if (this.plugin.buttonManager.isUnlocked) {
        const banner = container.createEl("div", { cls: "practice-edit-banner" });
        banner.setText("Layout Edit Mode Active: Drag buttons to reposition them. Toggle off in Settings to resume practice.");
      }
      if (this.plugin.session.isFinished) {
        this.renderSummary(container);
        return;
      }
      if (this.plugin.session.currentQueue.length === 0) {
        container.createEl("h3", { text: "Empty Queue! Start by selecting a category in the sidebar." });
        return;
      }
      const qMeta = this.plugin.session.currentQueue[this.plugin.session.currentQIndex];
      if (!qMeta)
        return;
      const mainLayout = container.createEl("div", { cls: "practice-tab-layout" });
      const vpb = mainLayout.createEl("div", { cls: "practice-vpb" });
      this.plugin.session.currentQueue.forEach((q, idx) => {
        const segment = vpb.createEl("div", { cls: "vpb-segment" });
        if (idx === this.plugin.session.currentQIndex)
          segment.addClass("is-active");
        const result = this.plugin.session.sessionResults.get(q.file.path);
        if (result === "correct")
          segment.addClass("is-correct");
        else if (result === "wrong")
          segment.addClass("is-wrong");
        segment.onclick = () => {
          if (this.plugin.buttonManager.isUnlocked)
            return;
          this.plugin.session.currentQIndex = idx;
          this.plugin.session.showingAnswer = false;
          this.plugin.session.selectedChoices.clear();
          this.plugin.saveSession();
          this.plugin.refreshAllViews();
        };
      });
      const questionContent = mainLayout.createEl("div", { cls: "practice-question-container" });
      questionContent.style.fontSize = `${this.plugin.settings.fontSize}px`;
      questionContent.style.color = this.plugin.settings.textColor;
      questionContent.style.backgroundColor = this.plugin.settings.bgColor;
      this.renderCurve(questionContent);
      yield this.renderQuestion(questionContent, qMeta);
    });
  }
  renderSummary(container) {
    const summary = container.createEl("div", { cls: "practice-summary-view" });
    summary.createEl("h1", { text: "Practice Finished!" });
    const stats = summary.createEl("div", { cls: "practice-summary-stats" });
    const correct = stats.createEl("div", { cls: "stat-item stat-correct" });
    correct.createEl("span", { text: this.plugin.session.correctAnswers.toString(), cls: "stat-value" });
    correct.createEl("span", { text: "Correct", cls: "stat-label" });
    const wrong = stats.createEl("div", { cls: "stat-item stat-wrong" });
    wrong.createEl("span", { text: this.plugin.session.wrongAnswers.toString(), cls: "stat-value" });
    wrong.createEl("span", { text: "Wrong / Skipped", cls: "stat-label" });
    const actions = summary.createEl("div", { cls: "practice-summary-actions" });
    const restartBtn = actions.createEl("button", { text: "Restart Queue", cls: "practice-btn-restart practice-flat-btn" });
    restartBtn.onclick = () => __async(this, null, function* () {
      this.plugin.session.currentQIndex = 0;
      this.plugin.session.isFinished = false;
      this.plugin.session.correctAnswers = 0;
      this.plugin.session.wrongAnswers = 0;
      this.plugin.session.sessionResults.clear();
      this.plugin.refreshAllViews();
    });
  }
  renderHistoryBar(container, qMeta) {
    return __async(this, null, function* () {
      const content = yield this.app.vault.read(qMeta.file);
      const historyMatch = content.match(/\| Date \| Selected \| Correct\? \|\n\|---\|---\|---\|\n([\s\S]*?)(?:\n\n|\n$|$)/);
      const historyBar = container.createEl("div", { cls: "practice-history-bar" });
      if (historyMatch) {
        const rows = historyMatch[1].trim().split("\n");
        rows.forEach((row) => {
          const block = historyBar.createEl("div", { cls: "history-block" });
          if (row.includes("\u2705"))
            block.addClass("is-correct");
          else if (row.includes("\u274C"))
            block.addClass("is-wrong");
        });
      }
    });
  }
  renderQuestion(container, qMeta) {
    return __async(this, null, function* () {
      const content = yield this.app.vault.cachedRead(qMeta.file);
      const lines = content.split("\n");
      const isSingle = qMeta.answer.length <= 1;
      const firstChoiceIndex = lines.findIndex((l) => /^- [A-Z] /.test(l));
      const firstHeaderIndex = lines.findIndex((l) => l.startsWith("# "));
      let stemText = "";
      if (firstHeaderIndex !== -1 && firstHeaderIndex < firstChoiceIndex) {
        stemText = lines.slice(firstHeaderIndex, firstChoiceIndex).join("\n").trim();
      }
      this.plugin.session.activeChoices = [];
      const choicesRegex = /^- ([A-Z]) (.*)$/gm;
      let match;
      while ((match = choicesRegex.exec(content)) !== null) {
        this.plugin.session.activeChoices.push({ char: match[1], text: match[2].trim() });
      }
      const headerEl = container.createEl("div", { cls: "practice-header" });
      headerEl.createEl("span", { text: `Q: ${this.plugin.session.currentQIndex + 1} / ${this.plugin.session.currentQueue.length}` });
      headerEl.createEl("span", { text: `Fam: ${qMeta.familiarity.toFixed(1)}%` });
      yield this.renderHistoryBar(container, qMeta);
      const stemEl = container.createEl("div", { cls: "practice-stem material-card flat-card" });
      yield import_obsidian2.MarkdownRenderer.renderMarkdown(stemText, stemEl, qMeta.file.path, this);
      const choicesEl = container.createEl("div", { cls: "practice-choices" });
      for (const choice of this.plugin.session.activeChoices) {
        const row = choicesEl.createEl("div", { cls: "practice-choice material-card flat-card" });
        if (this.plugin.session.selectedChoices.has(choice.char))
          row.addClass("practice-selected-choice");
        row.onclick = () => {
          if (this.plugin.buttonManager.isUnlocked)
            return;
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
        const marker = row.createEl("span", { text: `${choice.char}. `, cls: "practice-choice-marker" });
        if (this.plugin.session.selectedChoices.has(choice.char))
          marker.setText("\u2713 ");
        yield import_obsidian2.MarkdownRenderer.renderMarkdown(choice.text, row, qMeta.file.path, this);
        if (this.plugin.session.showingAnswer && qMeta.answer.toUpperCase().includes(choice.char.toUpperCase())) {
          row.addClass("practice-correct-choice");
        }
      }
      if (this.plugin.session.showingAnswer) {
        container.createEl("div", { text: `Answer: ${qMeta.answer}`, cls: "practice-answer-reveal" });
      }
      this.renderFloatingButtons(container, qMeta, isSingle);
    });
  }
  renderFloatingButtons(container, qMeta, isSingle) {
    const floatingCanvas = container.createEl("div", { cls: "practice-floating-canvas" });
    floatingCanvas.style.position = "absolute";
    floatingCanvas.style.top = "0";
    floatingCanvas.style.left = "0";
    floatingCanvas.style.width = "100%";
    floatingCanvas.style.height = "100%";
    floatingCanvas.style.pointerEvents = "none";
    const mountDraggable = (id, text, cls, onClick) => {
      const btn = new DraggableButton(floatingCanvas, this.plugin.buttonManager, id, text, `practice-flat-btn ${cls}`, onClick);
      btn.containerEl.style.pointerEvents = "auto";
      btn.containerEl.addClass("is-initializing");
      return btn;
    };
    this.choiceButtons = [];
    if (import_obsidian2.Platform.isMobile) {
      this.plugin.session.activeChoices.forEach((choice) => {
        const baseId = `btn_choice_${choice.char}`;
        const clsList = this.plugin.session.selectedChoices.has(choice.char) ? "is-selected practice-btn-choice" : "practice-btn-choice";
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
    this.actionButtons = [];
    if (this.plugin.session.showingAnswer) {
      if (!isSingle) {
        this.actionButtons.push(mountDraggable("btn_next", "Next = >", "practice-btn-wrong", () => {
          this.plugin.session.nextQuestion(true);
        }));
        this.actionButtons.push(mountDraggable("btn_submit_corrected", "Submit (Corrected)", "practice-btn-submit", () => {
          const selected = Array.from(this.plugin.session.selectedChoices).sort().join("");
          if (selected.toUpperCase() === qMeta.answer.toUpperCase()) {
            this.plugin.session.nextQuestion(true);
          }
        }));
      }
    } else {
      if (!isSingle && !import_obsidian2.Platform.isMobile) {
        this.actionButtons.push(mountDraggable("btn_submit", "Submit Answer", "practice-btn-submit", () => {
          this.gradeMultipleChoice();
        }));
      }
    }
    const applyDefaultLayout = () => {
      const containerWidth = container.offsetWidth || 800;
      const containerHeight = container.offsetHeight || 600;
      const allBtns = this.choiceButtons.concat(this.actionButtons);
      allBtns.forEach((btn) => {
        btn.containerEl.addClass("no-transition");
      });
      const choiceY = containerHeight - 110;
      let currentX = containerWidth - 30;
      this.choiceButtons.forEach((btn) => {
        if (!this.plugin.buttonManager.getPosition(btn["buttonId"])) {
          const btnWidth = btn.containerEl.offsetWidth || 40;
          btn.containerEl.style.transform = `translate(${currentX - btnWidth}px, ${choiceY}px)`;
          currentX -= btnWidth + 12;
        }
      });
      const actionY = containerHeight - 60;
      currentX = containerWidth - 30;
      this.actionButtons.slice().reverse().forEach((btn) => {
        if (!this.plugin.buttonManager.getPosition(btn["buttonId"])) {
          const btnWidth = btn.containerEl.offsetWidth || 110;
          btn.containerEl.style.transform = `translate(${currentX - btnWidth}px, ${actionY}px)`;
          currentX -= btnWidth + 12;
        }
      });
      setTimeout(() => {
        allBtns.forEach((btn) => {
          btn.containerEl.removeClass("is-initializing");
          btn.containerEl.removeClass("no-transition");
        });
      }, 50);
    };
    setTimeout(applyDefaultLayout, 250);
  }
  renderCurve(container) {
    const history = this.plugin.sessionManager.currentQueue.map((q) => q.familiarity);
    if (history.length === 0)
      return;
    const curveContainer = container.createEl("div", { cls: "familiarity-curve-root" });
    const canvas = curveContainer.createEl("canvas");
    canvas.width = curveContainer.offsetWidth || 800;
    canvas.height = 60;
    const ctx = canvas.getContext("2d");
    if (!ctx)
      return;
    const rootStyle = getComputedStyle(curveContainer);
    const primaryColor = rootStyle.getPropertyValue("--flat-primary").trim() || "#268bd2";
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, primaryColor + "44");
    gradient.addColorStop(1, primaryColor + "00");
    const step = canvas.width / (history.length - 1 || 1);
    ctx.beginPath();
    ctx.moveTo(0, canvas.height);
    history.forEach((fam, i) => {
      const x = i * step;
      const y = canvas.height - fam / 100 * canvas.height;
      ctx.lineTo(x, y);
    });
    ctx.lineTo(canvas.width, canvas.height);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.beginPath();
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 4;
    ctx.shadowColor = primaryColor;
    history.forEach((fam, i) => {
      const x = i * step;
      const y = canvas.height - fam / 100 * canvas.height;
      if (i === 0)
        ctx.moveTo(x, y);
      else
        ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
};

// src/views/QueueControlView.ts
var import_obsidian3 = require("obsidian");
var QueueControlView = class extends import_obsidian3.ItemView {
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
  onOpen() {
    return __async(this, null, function* () {
      yield this.render();
    });
  }
  render() {
    return __async(this, null, function* () {
      const container = this.contentEl;
      container.empty();
      container.addClass("practice-control-root");
      container.removeClass("theme-solarized-dark", "theme-solarized-light", "theme-dark-blue", "theme-sepia", "theme-clean", "theme-default");
      container.addClass(`theme-${this.plugin.settings.theme}`);
      const toolbarEl = container.createEl("div", { cls: "practice-sidebar-toolbar" });
      this.renderToolbar(toolbarEl);
      const settingsEl = container.createEl("div", { cls: "practice-sidebar-settings" });
      this.renderSettings(settingsEl);
      const listEl = container.createEl("div", { cls: "practice-sidebar-queue" });
      this.renderQueueList(listEl);
    });
  }
  renderToolbar(parent) {
    parent.createEl("h4", { text: "Filters", cls: "sidebar-section-header" });
    const filterGroup = parent.createEl("div", { cls: "practice-sidebar-toolbar" });
    const catCol = filterGroup.createEl("div", { cls: "practice-toolbar-col" });
    catCol.createEl("span", { text: "Category:", cls: "sidebar-label-small" });
    const catSelect = catCol.createEl("select", { cls: "setting-input-text" });
    this.plugin.session.categories.forEach((cat) => {
      const opt = catSelect.createEl("option", { text: cat, value: cat });
      if (cat === this.plugin.session.filterCategory)
        opt.selected = true;
    });
    catSelect.onchange = () => {
      this.plugin.sessionManager.filterCategory = catSelect.value;
      this.plugin.sessionManager.refreshQueue();
    };
    const famCol = filterGroup.createEl("div", { cls: "vertical-slider-column" });
    const sliderContainer = famCol.createEl("div", { cls: "vertical-slider-container" });
    const sliderWrapper = sliderContainer.createEl("div", { cls: "vertical-slider-wrapper" });
    const famSlider = sliderWrapper.createEl("input", { type: "range", cls: "vertical-slider" });
    famSlider.min = "0";
    famSlider.max = "100";
    famSlider.value = this.plugin.session.filterFamiliarity.toString();
    famSlider.title = "Max Familiarity Filter";
    const famLabel = sliderContainer.createEl("span", {
      text: `${this.plugin.session.filterFamiliarity.toFixed(0)}%`,
      cls: "vertical-slider-label"
    });
    famSlider.oninput = () => famLabel.setText(`${famSlider.value}%`);
    famSlider.onchange = () => {
      this.plugin.sessionManager.filterFamiliarity = parseInt(famSlider.value);
      this.plugin.sessionManager.refreshQueue();
    };
  }
  renderSettings(parent) {
    parent.createEl("h4", { text: "Practice Settings", cls: "sidebar-section-header" });
    const rowOffsets = parent.createEl("div", { cls: "practice-sidebar-setting-row" });
    rowOffsets.createEl("span", { text: "Insert Position:", title: "Offsets for re-inserting failed questions" });
    const offsetInput = rowOffsets.createEl("input", { type: "text", cls: "setting-input-text" });
    offsetInput.value = this.plugin.settings.failOffsets;
    offsetInput.onchange = () => __async(this, null, function* () {
      this.plugin.settings.failOffsets = offsetInput.value;
      yield this.plugin.saveSettings();
    });
    rowOffsets.createEl("div", { text: "e.g. 3, 10, -1 (Use -1 for end)", cls: "setting-instruction" });
    const rowSize = parent.createEl("div", { cls: "practice-sidebar-setting-row" });
    rowSize.createEl("span", { text: "Font Size:" });
    const sizeContainer = rowSize.createEl("div", { cls: "font-size-selector" });
    const sizes = [12, 14, 16, 18, 20, 24];
    sizes.forEach((sz) => {
      const sample = sizeContainer.createEl("span", { text: "A", cls: "font-sample" });
      sample.style.fontSize = `${sz}px`;
      if (this.plugin.settings.fontSize === sz)
        sample.addClass("is-active");
      sample.onclick = () => __async(this, null, function* () {
        this.plugin.settings.fontSize = sz;
        yield this.plugin.saveSettings();
        this.plugin.viewManager.refreshAllViews();
      });
    });
    const rowColor = parent.createEl("div", { cls: "practice-sidebar-setting-row" });
    rowColor.createEl("span", { text: "Visual Theme:" });
    const presetsContainer = rowColor.createEl("div", { cls: "color-presets" });
    const themes = [
      { id: "default", name: "Default", text: "var(--text-normal)", bg: "var(--background-primary)" },
      { id: "dark-blue", name: "Dark Blue", text: "#e2e8f0", bg: "#1a202c" },
      { id: "sepia", name: "Sepia", text: "#5b4636", bg: "#f4ecd8" },
      { id: "solarized-dark", name: "Solarized Dark", text: "#839496", bg: "#002b36" },
      { id: "solarized-light", name: "Solarized Light", text: "#657b83", bg: "#fdf6e3" },
      { id: "clean", name: "Clean", text: "#1a202c", bg: "#ffffff" }
    ];
    themes.forEach((t) => {
      const dot = presetsContainer.createEl("div", { cls: "color-preset", title: t.name });
      dot.style.backgroundColor = t.bg;
      if (this.plugin.settings.theme === t.id)
        dot.style.borderColor = "var(--flat-primary)";
      dot.onclick = () => __async(this, null, function* () {
        this.plugin.settings.theme = t.id;
        this.plugin.settings.textColor = t.text;
        this.plugin.settings.bgColor = t.bg;
        yield this.plugin.saveSettings();
        this.plugin.viewManager.refreshAllViews();
      });
    });
    const customRow = rowColor.createEl("div", { cls: "practice-toolbar-row" });
    customRow.style.marginTop = "8px";
    const customTextSpan = customRow.createEl("span", { text: "Custom Text:" });
    customTextSpan.style.fontSize = "0.7em";
    const colorInput = customRow.createEl("input", { type: "color" });
    colorInput.value = this.plugin.settings.textColor.startsWith("var") ? "#ffffff" : this.plugin.settings.textColor;
    colorInput.onchange = () => __async(this, null, function* () {
      this.plugin.settings.textColor = colorInput.value;
      yield this.plugin.saveSettings();
      this.plugin.refreshAllViews();
    });
    const resetBtn = parent.createEl("button", { text: "Restore Defaults", cls: "sidebar-reset-btn" });
    resetBtn.onclick = () => __async(this, null, function* () {
      this.plugin.settings.fontSize = 16;
      this.plugin.settings.bgColor = "var(--background-primary)";
      this.plugin.settings.textColor = "var(--text-normal)";
      yield this.plugin.saveSettings();
      this.plugin.refreshAllViews();
    });
  }
  renderQueueList(parent) {
    parent.createEl("h4", { text: "Queue", cls: "sidebar-section-header" });
    const list = parent.createEl("div", { cls: "practice-queue-list" });
    this.plugin.session.currentQueue.forEach((q, idx) => {
      const item = list.createEl("div", { cls: "practice-queue-item" });
      if (idx === this.plugin.session.currentQIndex)
        item.addClass("is-active");
      const result = this.plugin.session.sessionResults.get(q.file.path);
      if (result === "correct")
        item.addClass("is-correct");
      else if (result === "wrong")
        item.addClass("is-wrong");
      item.createEl("span", { text: `${idx + 1}.`, cls: "practice-queue-item-idx" });
      item.createEl("span", { text: q.file.basename, cls: "practice-queue-item-title" });
      const hue = Math.round(q.familiarity * 1.2);
      const famMarker = item.createEl("div", { cls: "practice-queue-item-fam-dot" });
      famMarker.style.backgroundColor = `hsl(${hue}, 80%, 45%)`;
      item.onclick = () => __async(this, null, function* () {
        this.plugin.sessionManager.currentQIndex = idx;
        this.plugin.sessionManager.isFinished = false;
        this.plugin.sessionManager.showingAnswer = false;
        this.plugin.sessionManager.selectedChoices.clear();
        yield this.plugin.sessionManager.saveSession();
        this.plugin.viewManager.refreshAllViews();
      });
      if (idx === this.plugin.session.currentQIndex) {
        setTimeout(() => item.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
      }
    });
  }
};

// src/settings/PracticeSettingTab.ts
var import_obsidian4 = require("obsidian");
var PracticeSettingTab = class extends import_obsidian4.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Practice Plugin Settings" });
    containerEl.createEl("p", { text: "Other practice settings (filters, re-insertion offsets, and visual preferences) are located in the Practice Control sidebar during practice sessions." });
    new import_obsidian4.Setting(containerEl).setName("Unlock Button Layout").setDesc("Enable this to drag and move buttons (A/B/C/D and actions) in the Practice View. Turn off to resume normal practice mode.").addToggle((toggle) => toggle.setValue(this.plugin.settings.unlockButtonLayout).onChange((value) => __async(this, null, function* () {
      this.plugin.settings.unlockButtonLayout = value;
      yield this.plugin.saveSettings();
      this.plugin.refreshAllViews();
    })));
  }
};

// main.ts
var PracticePlugin = class extends import_obsidian5.Plugin {
  get session() {
    return this.sessionManager;
  }
  onload() {
    return __async(this, null, function* () {
      yield this.loadSettings();
      this.sessionManager = new SessionManager(this);
      this.viewManager = new ViewManager(this);
      this.buttonManager = new ButtonLayoutManager(this);
      this.registerView(
        VIEW_TYPE_PRACTICE,
        (leaf) => new PracticeView(leaf, this)
      );
      this.registerView(
        VIEW_TYPE_CONTROL,
        (leaf) => new QueueControlView(leaf, this)
      );
      this.addRibbonIcon("check-square", "Open Practice Mode", () => {
        this.viewManager.activateView();
      });
      this.addCommand({
        id: "open-practice-view",
        name: "Open Practice View",
        callback: () => this.viewManager.activateView()
      });
      this.addCommand({
        id: "open-practice-control",
        name: "Open Practice Control Sidebar",
        callback: () => this.viewManager.activateControlView()
      });
      this.addSettingTab(new PracticeSettingTab(this.app, this));
      this.registerEvent(
        this.app.workspace.on("file-open", (file) => this.onFileOpen(file))
      );
      if (this.settings.savedQueuePaths.length > 0) {
        yield this.sessionManager.restoreSession();
      } else {
        this.sessionManager.refreshQueue();
      }
    });
  }
  onFileOpen(file) {
    return __async(this, null, function* () {
      var _a;
      if (!file)
        return;
      const cache = this.app.metadataCache.getFileCache(file);
      if (((_a = cache == null ? void 0 : cache.frontmatter) == null ? void 0 : _a.type) === "practice_session") {
        yield this.sessionManager.loadSessionFromFile(file);
      }
    });
  }
  loadSettings() {
    return __async(this, null, function* () {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, yield this.loadData());
      if (!this.settings.buttonLayouts) {
        this.settings.buttonLayouts = {};
      }
    });
  }
  saveSettings() {
    return __async(this, null, function* () {
      yield this.saveData(this.settings);
    });
  }
};
