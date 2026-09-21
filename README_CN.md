# Obsidian Queue 插件

一个基于 Google Material Design 原理设计的 Obsidian 强大间隔复习与练习插件，针对桌面端和移动端进行了深度优化。

[English Version](README.md)

## 核心功能

- **分屏视图架构**：在中心标签页中专注练习题目，同时在 Obsidian 右侧侧边栏中保留会话控制、过滤器和队列列表。
- **Google Material Design**：采用高级美学设计，配备阴影悬浮卡片、现代排版和清爽的界面，打造极致专注体验。
- **移动端优化**：
    - **抬高式导航**：ABCD... 选择按钮经过抬高处理，避免与移动端导航栏冲突。
    - **单手操作**：大尺寸、高对比度的点击区域，方便随时随地练习。
    - **选中高亮**：选择选项时提供清晰的视觉效果反馈。
- **智能会话管理**：
    - **会话自动加载**：打开会话文件（位于 `Practice_Sessions` 文件夹）会自动启动练习环境。
    - **自动保存**：每回答一个问题后都会自动记录进度，确保练习不丢失。
- **视觉进度与历史记录**：
    - **垂直进度条 (VPB)**：练习标签页侧边 1 字符宽的进度条，一眼识别会话结果。
    - **题目历史栏**：题目顶部显示逐次尝试的彩色历史条，直观了解过去表现。
- **侧边栏内置设置**：直接从侧边栏调整字体大小、文本颜色、背景颜色和重插入间隔。
- **FSRS 自适应调度**：可按难度、记忆稳定性和当前可回忆概率优先安排到期题，同时保留旧熟悉度算法作为回退模式。
- **简答题练习**：每题一个 Markdown 文件，可输入自由文本答案，并选择人工自评或可选的 AI 辅助评分；AI 建议始终可确认和覆盖。
- **可配置的 AI 隐私方式**：AI 默认关闭。Queue 可免密连接本地/代理端点，也可把可选 API Token 以明文保存在插件 `data.json` 中，用于直连 Bearer 认证；答题耗时只在本地计算。

## 使用方法

1. **开始练习**：点击 ribbon 图标（带勾选框的正方形）或使用 `Open Practice View` 命令。
2. **过滤器**：使用侧边栏选择分类并设置最高熟悉度等级。
3. **练习**：
    - **键盘（桌面端）**：使用 `A-F` 或 `1-6` 进行选择，`Enter` 提交/下一题，`S` 显示答案，`N` 跳过/掌握。
    - **触摸（移动端）**：点击底部的 ABCD... 按钮进行选择和导航。
4. **总结**：完成队列后，查看会话统计数据，并选择重新开始或创建新会话。

可在 Queue 控制侧边栏选择“旧熟悉度”或“FSRS 自适应”调度；FSRS 高级参数、简答题 AI 和隐私选项位于插件设置中。

## 数据结构模板

### 1. 题目文件模板
题目是采用简化格式的标准 Markdown 文件。

**模板：**
```markdown
---
category: "分类名称"
answer: "单字母或多选题字符串，如 'BD'"
tags: [q]
id: [唯一 ID]
familiarity: [0-100 熟悉度]
---
# [题目正文...]
- A [选项 A]
- B [选项 B]
- C [选项 C]
- D [选项 D]

# Practice History
| Date | Selected | Correct? |
|---|---|---|
```

**示例：**
```markdown
---
category: "B737 发动机"
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

### 2. 练习会话模板
会话文件会自动在 `Practice_Sessions/` 文件夹中生成以保存进度。

**示例：**
```markdown
---
type: practice_session
currentIndex: 3
isFinished: false
category: Aviation
timestamp: 2026-03-14_13-00-00
---
# 自动保存的会话 - Aviation

#practice_resume

## 队列
[[Questions/Q101|Q101]]
[[Questions/Q102|Q102]]
```

### 3. 简答题文件模板

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
请用自己的话解释这个概念。

# Reference Answer
在这里填写权威参考答案。
```

Queue 会在同一文件末尾追加版本化的 `queue-history` JSONL 记录，因此题目、调度状态和完整历史会一起移动与同步。

## 安装

1. 将 `main.js`、`manifest.json` 和 `styles.css` 复制到您仓库的 `.obsidian/plugins/queue/` 目录中。
2. 在 Obsidian 设置中启用该插件。

## 开发

```bash
npm install
npm run check
```

迁移与修复命令默认只做 dry-run。任何显式 apply/write 操作前，请先查看命令的 `--help` 并在题库外建立新备份。
