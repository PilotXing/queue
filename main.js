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

// src/models/PracticeSession.ts
var import_obsidian = require("obsidian");
var PracticeSession = class {
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
        this.plugin.refreshAllViews();
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
    this.plugin.saveSession();
    this.plugin.refreshAllViews();
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
  unlockButtonLayout: false,
  buttonLayouts: {}
};

// src/components/DraggableButton.ts
var DraggableButton = class {
  constructor(parent, manager, id, text, cls, onClick) {
    this.isDragging = false;
    this.startX = 0;
    this.startY = 0;
    this.currentX = 0;
    this.currentY = 0;
    this.onPointerMove = (e) => {
      if (!this.isDragging)
        return;
      this.currentX = e.clientX - this.startX;
      this.currentY = e.clientY - this.startY;
      this.updateTransform();
    };
    this.onPointerUp = (e) => __async(this, null, function* () {
      this.isDragging = false;
      this.containerEl.style.cursor = "grab";
      this.containerEl.releasePointerCapture(e.pointerId);
      this.containerEl.removeEventListener("pointermove", this.onPointerMove);
      this.containerEl.removeEventListener("pointerup", this.onPointerUp);
      this.containerEl.removeEventListener("pointercancel", this.onPointerUp);
      yield this.manager.savePosition(this.buttonId, this.currentX, this.currentY);
    });
    this.manager = manager;
    this.buttonId = id;
    this.containerEl = parent.createEl("button", { text, cls: `draggable-btn ${cls}` });
    this.containerEl.style.position = "absolute";
    this.containerEl.style.zIndex = "50";
    const pos = this.manager.getPosition(id);
    if (pos) {
      this.currentX = pos.x;
      this.currentY = pos.y;
      this.updateTransform();
    }
    this.updateModeStyles();
    this.containerEl.onclick = (e) => {
      if (this.manager.isUnlocked) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      onClick();
    };
    this.containerEl.addEventListener("pointerdown", this.onPointerDown.bind(this));
  }
  updateModeStyles() {
    if (this.manager.isUnlocked) {
      this.containerEl.addClass("is-unlocked");
      this.containerEl.style.cursor = "grab";
    } else {
      this.containerEl.removeClass("is-unlocked");
      this.containerEl.style.cursor = "pointer";
    }
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
  onPointerDown(e) {
    if (!this.manager.isUnlocked)
      return;
    this.isDragging = true;
    this.containerEl.style.cursor = "grabbing";
    this.containerEl.setPointerCapture(e.pointerId);
    let transformMatches = this.containerEl.style.transform.match(/translate\(([^p]+)px,\s*([^p]+)px\)/);
    if (transformMatches) {
      this.currentX = parseFloat(transformMatches[1]);
      this.currentY = parseFloat(transformMatches[2]);
    }
    this.startX = e.clientX - this.currentX;
    this.startY = e.clientY - this.currentY;
    this.containerEl.addEventListener("pointermove", this.onPointerMove);
    this.containerEl.addEventListener("pointerup", this.onPointerUp);
    this.containerEl.addEventListener("pointercancel", this.onPointerUp);
  }
  updateTransform() {
    this.containerEl.style.transform = `translate(${this.currentX}px, ${this.currentY}px)`;
  }
};

// src/views/PracticeView.ts
var PracticeView = class extends import_obsidian2.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    // Draggable Instances
    this.choiceButtons = [];
    this.actionButtons = [];
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
  onOpen() {
    return __async(this, null, function* () {
      document.addEventListener("keydown", this.boundKeydownHandler);
      yield this.render();
    });
  }
  onClose() {
    return __async(this, null, function* () {
      document.removeEventListener("keydown", this.boundKeydownHandler);
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
      return btn;
    };
    this.choiceButtons = [];
    this.plugin.session.activeChoices.forEach((choice, index) => {
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
      if (!isSingle) {
        this.actionButtons.push(mountDraggable("btn_submit", "Submit Answer", "practice-btn-submit", () => {
          this.gradeMultipleChoice();
        }));
      }
      this.actionButtons.push(mountDraggable("btn_show", "(S)how Answer", "practice-btn-show", () => {
        this.plugin.session.showingAnswer = true;
        this.plugin.refreshAllViews();
      }));
      this.actionButtons.push(mountDraggable("btn_skip", "Skip (N)", "practice-btn-skip", () => {
        this.setMastered(qMeta);
      }));
    }
    let unpositionedOffset = 0;
    const defaultPositions = (btnElements, startX, y) => {
      btnElements.forEach((btn, idx) => {
        if (!this.plugin.buttonManager.getPosition(btn["buttonId"])) {
          btn.containerEl.style.transform = `translate(${startX + unpositionedOffset}px, ${y}px)`;
          unpositionedOffset += btn.containerEl.offsetWidth + 10 || 50;
        }
      });
    };
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
    const row1 = parent.createEl("div", { cls: "practice-toolbar-row" });
    row1.createEl("span", { text: "Category:" });
    const catSelect = row1.createEl("select");
    this.plugin.session.categories.forEach((cat) => {
      const opt = catSelect.createEl("option", { text: cat, value: cat });
      if (cat === this.plugin.session.filterCategory)
        opt.selected = true;
    });
    catSelect.onchange = () => {
      this.plugin.session.filterCategory = catSelect.value;
      this.plugin.refreshQueue();
    };
    const row2 = parent.createEl("div", { cls: "practice-toolbar-row" });
    row2.createEl("span", { text: "Max Familiarity:" });
    const sliderContainer = row2.createEl("div", { cls: "vertical-slider-container" });
    const famSlider = sliderContainer.createEl("input", { type: "range", cls: "vertical-slider" });
    famSlider.min = "0";
    famSlider.max = "100";
    famSlider.value = this.plugin.session.filterFamiliarity.toString();
    famSlider.setAttribute("orient", "vertical");
    const famLabel = sliderContainer.createEl("span", {
      text: `${this.plugin.session.filterFamiliarity.toFixed(0)}%`,
      cls: "vertical-slider-label"
    });
    famSlider.oninput = () => famLabel.setText(`${famSlider.value}%`);
    famSlider.onchange = () => {
      this.plugin.session.filterFamiliarity = parseInt(famSlider.value);
      this.plugin.refreshQueue();
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
        this.plugin.refreshAllViews();
      });
    });
    const rowColor = parent.createEl("div", { cls: "practice-sidebar-setting-row" });
    rowColor.createEl("span", { text: "Visual Theme:" });
    const presetsContainer = rowColor.createEl("div", { cls: "color-presets" });
    const themes = [
      { name: "Default", text: "var(--text-normal)", bg: "var(--background-primary)" },
      { name: "Dark Blue", text: "#e0e0e0", bg: "#1a202c" },
      { name: "Sepia", text: "#5b4636", bg: "#f4ecd8" },
      { name: "Matrix", text: "#00ff00", bg: "#000000" },
      { name: "Clean", text: "#2d3748", bg: "#ffffff" }
    ];
    themes.forEach((t) => {
      const dot = presetsContainer.createEl("div", { cls: "color-preset", title: t.name });
      dot.style.backgroundColor = t.bg;
      dot.onclick = () => __async(this, null, function* () {
        this.plugin.settings.textColor = t.text;
        this.plugin.settings.bgColor = t.bg;
        yield this.plugin.saveSettings();
        this.plugin.refreshAllViews();
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
      item.onclick = () => {
        this.plugin.session.currentQIndex = idx;
        this.plugin.session.isFinished = false;
        this.plugin.session.showingAnswer = false;
        this.plugin.session.selectedChoices.clear();
        this.plugin.saveSession();
        this.plugin.refreshAllViews();
      };
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
  onload() {
    return __async(this, null, function* () {
      yield this.loadSettings();
      this.session = new PracticeSession(this);
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
        yield this.restoreSession();
      } else {
        this.refreshQueue();
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
        yield this.loadSessionFromFile(file);
      }
    });
  }
  loadSessionFromFile(file) {
    return __async(this, null, function* () {
      var _a, _b;
      const content = yield this.app.vault.read(file);
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = (cache == null ? void 0 : cache.frontmatter) || {};
      this.session.filterCategory = fm.category || "All";
      this.session.currentQIndex = fm.currentIndex || 0;
      this.session.isFinished = fm.isFinished || false;
      this.session.currentQueue = [];
      const linkRegex = /\[\[(.*?)(?:\|.*?)?\]\]/g;
      let match;
      while ((match = linkRegex.exec(content)) !== null) {
        const path = match[1];
        const qFile = this.app.vault.getAbstractFileByPath(path);
        if (qFile instanceof import_obsidian5.TFile) {
          const qCache = this.app.metadataCache.getFileCache(qFile);
          const qFm = (qCache == null ? void 0 : qCache.frontmatter) || {};
          this.session.currentQueue.push({
            file: qFile,
            id: qFm.id || 0,
            familiarity: (_a = qFm.familiarity) != null ? _a : 50,
            answer: ((_b = qFm.answer) == null ? void 0 : _b.toString()) || ""
          });
        }
      }
      if (this.session.currentQueue.length > 0) {
        yield this.saveSession();
        yield this.activateView();
        this.refreshAllViews();
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
  activateView() {
    return __async(this, null, function* () {
      const { workspace } = this.app;
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
      const { workspace } = this.app;
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
    return __async(this, null, function* () {
      this.app.workspace.getLeavesOfType(VIEW_TYPE_PRACTICE).forEach((l) => l.view.render());
      this.app.workspace.getLeavesOfType(VIEW_TYPE_CONTROL).forEach((l) => l.view.render());
    });
  }
  refreshQueue() {
    var _a, _b;
    this.session.currentQueue = [];
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
        if (this.session.filterCategory !== "All" && category !== this.session.filterCategory)
          continue;
        let fam = fm.familiarity;
        if (fam === void 0 || fam === null)
          fam = 50;
        if (fam > this.session.filterFamiliarity)
          continue;
        if (fam < 100) {
          this.session.currentQueue.push({
            file,
            id: fm.id,
            familiarity: fam,
            answer: ((_b = fm.answer) == null ? void 0 : _b.toString()) || ""
          });
        }
      }
    }
    this.session.categories = ["All", ...Array.from(cats).sort()];
    this.session.currentQueue.sort((a, b) => a.familiarity - b.familiarity);
    this.session.currentQIndex = 0;
    this.session.isFinished = false;
    this.session.showingAnswer = false;
    this.session.selectedChoices.clear();
    this.saveSession();
    this.refreshAllViews();
  }
  saveSession() {
    return __async(this, null, function* () {
      this.settings.savedQueuePaths = this.session.currentQueue.map((q) => q.file.path);
      this.settings.savedIndex = this.session.currentQIndex;
      yield this.saveSettings();
    });
  }
  restoreSession() {
    return __async(this, null, function* () {
      var _a, _b, _c, _d;
      const paths = this.settings.savedQueuePaths;
      const index = this.settings.savedIndex;
      this.session.currentQueue = [];
      for (const path of paths) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof import_obsidian5.TFile) {
          const cache = this.app.metadataCache.getFileCache(file);
          const fm = (cache == null ? void 0 : cache.frontmatter) || {};
          this.session.currentQueue.push({
            file,
            id: fm.id || 0,
            familiarity: (_a = fm.familiarity) != null ? _a : 50,
            answer: ((_b = fm.answer) == null ? void 0 : _b.toString()) || ""
          });
        }
      }
      this.session.currentQIndex = index;
      if (this.session.currentQIndex >= this.session.currentQueue.length) {
        this.session.currentQIndex = 0;
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
      this.session.categories = ["All", ...Array.from(cats).sort()];
    });
  }
};
