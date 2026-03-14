# Obsidian Queue Plugin

A powerful spaced repetition and practice plugin for Obsidian, designed with Google Material Design principles and optimized for both Desktop and Mobile use.

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

## Usage

1. **Start Practice**: Click the check-square ribbon icon or use the `Open Practice View` command.
2. **Filters**: Use the Sidebar to choose a category and set the maximum familiarity level.
3. **Practice**:
    - **Keyboard (Desktop)**: Use `A-F` or `1-6` to select, `Enter` to submit/next, `S` to show answer, and `N` to skip/master.
    - **Touch (Mobile)**: Use the ABCD... buttons at the bottom for easy selection and navigation.
4. **Summary**: After finishing the queue, view your session stats and choose to restart or create a new session.

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

## Installation

1. Copy `main.js`, `manifest.json`, and `styles.css` to your vault's `.obsidian/plugins/queue/` directory.
2. Enable the plugin in Obsidian settings.

## Development

```bash
npm install
npm run build
```
