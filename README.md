# Obsidian Queue Plugin

A powerful spaced repetition and practice plugin for Obsidian, designed with Google Material Design principles and optimized for both Desktop and Mobile use.

[中文版 (Chinese Version)](README_CN.md)

## Key Features

- **Split-View Architecture**: Focus on your questions in a dedicated center tab while keeping session controls, filters, and the queue list in the official Obsidian right sidebar.
- **Google Material Design**: Premium aesthetic with shadow-elevated cards, modern typography, and a clean interface for maximum focus.
- **Mobile Optimized**:
    - **Raised Navigation**: ABCD... selection buttons are raised to avoid conflict with mobile navigation docks.
    - **One-Handed Operation**: Large, high-contrast tap targets for easy practice on the go.
    - **Highlighted Selection**: Clear visual feedback when choices are selected.
- **Smart Session Management**:
    - **Session Auto-load**: Opening a session file (from the `Practice_Sessions` folder) automatically launches the practice environment.
    - **Autosave**: Progress is saved after every answer to ensure you never lose your place.
- **Visual Progress & History**:
    - **Vertical Progress Bar (VPB)**: A 1-character width sidebar in the practice tab shows your session results at a glance.
    - **Question History Bar**: A trial-by-trial colored history bar at the top of each question shows your past performance.
- **In-Sidebar Settings**: Adjust font size, text colors, background colors, and re-insertion offsets directly from the control sidebar.
- **Adaptive FSRS Scheduler**: Optionally prioritize due and low-recall questions using Difficulty, Stability, and Retrievability while preserving the legacy familiarity scheduler as a rollback mode.
- **Short-Answer Practice**: Store one question per Markdown file, type a free-form answer, then self-assess or use an optional OpenAI-compatible AI endpoint with explicit confirmation and override controls.
- **Configurable AI Privacy**: AI grading is disabled by default. Queue can call a local/proxy endpoint without credentials or store an optional API token as plaintext in plugin `data.json` for direct bearer-authenticated requests. Response timing stays local.

## Usage

1. **Start Practice**: Click the check-square ribbon icon or use the `Open Practice View` command.
2. **Filters**: Use the Sidebar to choose a category and set the maximum familiarity level.
3. **Practice**:
    - **Keyboard (Desktop)**: Use `A-F` or `1-6` to select, `Enter` to submit/next, `S` to show answer, and `N` to skip/master.
    - **Touch (Mobile)**: Use the ABCD... buttons at the bottom for easy selection and navigation.
4. **Summary**: After finishing the queue, view your session stats and choose to restart or create a new session.

Select `Legacy familiarity` or `FSRS adaptive` in the Queue Control sidebar. FSRS settings, short-answer AI settings, and privacy controls are available in the plugin settings.

## Data Structure Templates

### 1. Question File Template
Questions are standard Markdown files with simplified formatting.

**Template:**
```markdown
---
category: "Category Name"
answer: "Single letter or MCQ string like 'BD'"
tags: [q]
id: [Unique ID]
familiarity: [0-100]
---
# [Stem text...]
- A [Choice A]
- B [Choice B]
- C [Choice C]
- D [Choice D]

# Practice History
| Date | Selected | Correct? |
|---|---|---|
```

**Example:**
```markdown
---
category: "B737 Engine"
answer: "B"
tags: [q]
id: 101
familiarity: 0
---
# 不要依赖目视机体结冰为标志来接通发动机防冰，应使用 (  ) 来作为标准。
- A 温度
- B 露点温度
- C 可见水汽

# Practice History
| Date | Selected | Correct? |
|---|---|---|
```

### 2. Practice Session Template
Session files are automatically generated in the `Practice_Sessions/` folder to save your progress.

**Example:**
```markdown
---
type: practice_session
currentIndex: 3
isFinished: false
category: Aviation
timestamp: 2026-03-14_13-00-00
---
# Autosaved Session - Aviation

#practice_resume

## Queue
[[Questions/Q101|Q101]]
[[Questions/Q102|Q102]]
```

### 3. Short-Answer File Template

```markdown
---
queue_schema: 1
queue_id: aviation_example_001
type: short-answer
category: Aviation
tags: ["q", "aviation"]
fsrs: {"schemaVersion":1,"modelVersion":"v5.4.2 using FSRS-6.0","mastered":false,"due":"2026-09-21T00:00:00.000Z","stability":0,"difficulty":0,"elapsed_days":0,"scheduled_days":0,"reps":0,"lapses":0,"state":0,"learning_steps":0,"last_review":null}
---
# Question
Explain the concept in your own words.

# Reference Answer
The authoritative reference answer goes here.
```

Queue appends versioned JSONL review events to a fenced `queue-history` block in the same file, so the scheduling state and history move with the question.

## Installation

1. Copy `main.js`, `manifest.json`, and `styles.css` to your vault's `.obsidian/plugins/queue/` directory.
2. Enable the plugin in Obsidian settings.

## Development

```bash
npm install
npm run check
```

Migration and repair commands are dry-run by default. Read their `--help` output and create an external backup before any explicit apply/write mode.
