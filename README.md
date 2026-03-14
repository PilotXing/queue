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

## File Templates

### Question File (.md)
Questions are detected by the `#q` tag. Include options as a markdown list starting with `**A.**`, `**B.**`, etc.

```markdown
---
category: Navigation
id: 101
familiarity: 50
answer: A
tags: ["q"]
---
# 单选题 (or 多选题 for MCQ)
What is the primary color of Material Design?

- **A.** Primary 600
- **B.** Signal Red
- **C.** Neon Green

## Practice History
...
```

### Practice Session File (.md)
Generated in the `Practice_Sessions/` folder. Opening these files resumes the practice.

```markdown
---
type: practice_session
currentIndex: 2
isFinished: false
category: Navigation
timestamp: 2026-03-14_13-00-00
---
# Autosaved Session - Navigation

#practice_resume

## Queue
[[Question 1]]
[[Question 2]]
```

## Usage

1. **Start Practice**: Click the check-square ribbon icon or use the `Open Practice View` command.
2. **Filters**: Use the Sidebar to choose a category and set the maximum familiarity level.
3. **Practice**:
    - **Keyboard (Desktop)**: Use `A-F` or `1-6` to select, `Enter` to submit/next, `S` to show answer, and `N` to skip/master.
    - **Touch (Mobile)**: Use the ABCD... buttons at the bottom for easy selection and navigation.
4. **Summary**: After finishing the queue, view your session stats and choose to restart or create a new session.

## Installation

1. Copy `main.js`, `manifest.json`, and `styles.css` to your vault's `.obsidian/plugins/queue/` directory.
2. Enable the plugin in Obsidian settings.

## Development

```bash
npm install
npm run build
```
