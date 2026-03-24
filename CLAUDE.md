# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

- `npm run build` – Bundle TypeScript to `main.js` using esbuild (externalizes `obsidian` and `electron`)
- `npm run dev` – Build with watch mode for development
- `./deploy.sh` – Build (or use existing `main.js`) and copy `main.js`, `manifest.json`, `styles.css` to the Obsidian plugin directory specified in `claude.md`

**Important:** The esbuild binary (`@esbuild/android-arm64`) is incompatible with Termux/Android's bionic libc. The build will fail with misleading errors like "Must use 'outdir' when there are multiple input files". Install the Termux package `esbuild` (`pkg install esbuild`) and set `ESBUILD_BINARY_PATH` to the system binary (see `deploy.sh` for an example). Alternatively, use a different environment (Linux/Windows/macOS) for rebuilding, or rely on the pre‑built `main.js` that exists in the repo.

## Architecture Overview

This is a single‑file Obsidian plugin (`main.ts`) implementing a spaced‑repetition MCQ (multiple‑choice question) practice system.

### Core Classes

1. **`PracticePlugin`** (extends `Plugin`)
   - Manages plugin lifecycle, settings, and shared state
   - Maintains `currentQueue: QuestionMeta[]`, `currentQIndex`, session results, filters
   - Handles spaced‑repetition re‑insertion based on `failOffsets` (e.g., `"3, 10, -1"`)
   - Provides methods for loading/saving sessions, grading, and queue refresh

2. **`PracticeView`** (extends `ItemView`)
   - Renders the main practice tab with question stem, choices, vertical progress bar (VPB), and history bar
   - Handles keyboard input (`A‑F`, `1‑6`, `Enter`, `S` to show answer, `N` to mark mastered)
   - For multiple‑answer questions, supports toggle selection before grading

3. **`QueueControlView`** (extends `ItemView`)
   - Rendered in the Obsidian right sidebar
   - Contains category/familiarity filters, visual settings (font size, color themes), and the queue list
   - All practice settings are exposed here (the separate `PracticeSettingTab` only shows a note)

4. **`PracticeSettingTab`** (extends `PluginSettingTab`)
   - Minimal; directs users to the sidebar controls

### Data Model

- **Question files**: Standard markdown with frontmatter:
  ```yaml
  ---
  category: "Category Name"
  answer: "B"  # or "BD" for multiple‑answer
  tags: [q]
  id: 101
  familiarity: 0  # 0‑100
  ---
  # Stem text...
  - A Choice A
  - B Choice B
  ```
  A `# Practice History` table is appended after each practice.

- **Session files**: Auto‑saved in `Practice_Sessions/` folder with frontmatter:
  ```yaml
  ---
  type: practice_session
  currentIndex: 3
  isFinished: false
  category: Aviation
  timestamp: 2026‑03‑14_13‑00‑00
  ---
  ```
  The body contains wikilinks `[[Questions/Q101|Q101]]` to reconstruct the queue.

### Key State & Algorithms

- **Filtering**: Questions are filtered by `category` and `familiarity ≤ filterFamiliarity`
- **Spaced repetition**: Wrong answers are re‑inserted at positions defined by `failOffsets` (comma‑separated list). Example `"3, 10, -1"` inserts failed questions 3, 10, and ∞ (end) positions ahead.
- **Grading**: For single‑answer questions, immediate grading; for multiple‑answer, selection toggling then `Enter` to submit.
- **Session persistence**: Automatically saved after each action; manual session‑file opening triggers auto‑load.

### UI/UX Patterns

- **Material Design**: Cards with shadow elevation, clean typography, color presets
- **Mobile optimized**: Raised navigation buttons avoid OS docks, large tap targets
- **Split‑view**: Practice tab (center) + control sidebar (right) – typical Obsidian plugin layout
- **Visual feedback**: Vertical progress bar (VPB) shows per‑question result; history bar shows past attempts

## Deployment

The `deploy.sh` script reads the Obsidian plugin path from `claude.md` (line: `obsidian plugin dir="…"`), builds if possible, and copies the three required files. The plugin directory is expected to be `~/storage/documents/Obsidian/.obsidian/plugins/queue/` (Termux‑compatible path).