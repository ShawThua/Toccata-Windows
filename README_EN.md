<p align="center">
  <img src="shared/branding/toccata-app-icon.png" alt="Toccata" width="96">
</p>

<h1 align="center">Toccata</h1>

<p align="center">
  <a href="README.md">简体中文</a> · <strong>English</strong>
</p>

<p align="center">
  <strong>Capture ideas. See your effort.</strong><br>
  <em>Curious about your net active thinking time?</em>
</p>

<p align="center">
  <a href="https://github.com/WenNinghan/Toccata-Windows/releases/tag/v0.1.3-win.2">Download Windows Preview</a> ·
  <a href="https://github.com/KMnO4-zx/Toccata/releases">Upstream macOS Releases</a> ·
  <a href="develop.md">Developer Guide (Chinese)</a> ·
  <a href="LICENSE">Apache-2.0</a>
</p>

## Unofficial Windows Preview

The November 2, 2026 preview, `0.1.3-win.2`, builds on the upstream v0.1.3 / build 21 migration with consistent task ordering, a Save button and Ctrl+S, navigation back to the parent task, completion sound handling and subtask drag feedback. It retains the fixes for continuous typing, planned dates and editing across windows. Task priorities use gray, blue, orange and red, with text labels. See the [task interaction updates](docs/windows-task-updates.md) and [upstream migration notes](docs/windows-upstream-v013.md).

This fork provides an **unofficial Windows preview port** of [KMnO4-zx/Toccata](https://github.com/KMnO4-zx/Toccata) under [`apps/toccata-windows`](apps/toccata-windows). Originally based on 0.1.0, it now includes the common features added through v0.1.3, native Windows window controls, tasks and tray workflows, keyboard activity statistics, and configurable 68/84/87/104-key layouts. The Windows port replaces the original Fn voice estimate with a keystroke rate based on active minutes.

**[Download the Windows 11 x64 preview](https://github.com/WenNinghan/Toccata-Windows/releases/tag/v0.1.3-win.2)** · [Settings](docs/images/windows-v013-settings.png) · [Tray activity](docs/images/windows-v013-tray.png) · [Task calendar](docs/images/windows-v013-calendar.png)

Read the [Windows preview notes and known issues](docs/windows-preview.md) and [build instructions](apps/toccata-windows/README.md) before use. This is not a complete stable release or a claim of 100% parity. The upstream release link does not distribute this Windows build. This version supports user-triggered Windows updates; upgrading from the October 29 preview requires a manual download.

The original author's macOS introduction, first-person story and acknowledgements are preserved below. The project retains the [Apache-2.0 license](LICENSE); see [Windows third-party notices](apps/toccata-windows/THIRD-PARTY-NOTICES.md).

## Why I Built This

I never used to bother with to-do apps. Keeping everything in my head worked just fine. Then work and study started piling up, and I finally needed somewhere to write things down.

My needs were simple: quickly see what I'd finished and what was still left to do, then pull up the week's tasks to write my weekly report. So I tried TickTick. I hated using it, and they still wanted my money!

**No way. So I built my own.**

I also really wanted to build something that tracks **“net active thinking time.”** Of all those hours at my computer every day, how much of that time is my mind actually active? Since I was already building my own app, I figured I'd add that too.

The name comes from [toccata](https://www.dictionary.com/browse/toccata), a piece of music for the keyboard. Its root is the Italian *toccare*, meaning “to touch.” I like that connection: fingers touch keys, and thoughts slowly become something you can see.

## To-Do Management

- **Capture on the fly**: open the menu bar window to add or edit tasks, with completed and pending items in view.
- **Organize at your pace**: break tasks into subtasks in the main window, write details in Markdown, set dates, and browse the task calendar.
- **Review your week**: gather completed and unfinished tasks, copy them with one click, and use them as the starting point for your weekly report.

![To-do management: main workspace on the left, menu bar window on the right](images/todo-management.png)

## Keyboard Activity: Net Active Thinking Time

There's something else I want to know: of all the time I spend at my computer, how much of it am I actually active? Taking a screenshot every few seconds and asking AI to analyze what I'm doing leaves me uneasy about privacy. So I turned to keyboard input.

My thinking is simple: **to the computer, I'm providing input; to myself, I'm producing output. When we're producing output, our minds are definitely active.** At that moment, the connection between me and the computer is right there, at the fingertips of both hands.

> And there's the connection: Toccata comes from the Italian *toccare*, “to touch.”

I want to use the keyboard to record the time I spend putting something out into the world. I call it **“net active thinking time.”** Honestly, I find that idea pretty sexy 🤔

- **Keyboard heatmap**: see which keys you use most, with live feedback as you press them.
- **Activity timeline**: see when you were typing throughout the day, and look back at your app usage and Fn hold time.
- **Local records**: key codes, timestamps, hold durations, and associated apps are recorded on your Mac. Capture takes no screenshots and records no audio.

![Keyboard activity: per-key heatmap and activity timelines for the last seven days](images/keyboard-activity.png)

> “Net active thinking time” is the idea behind this project. The actual duration is estimated from keyboard activity; it cannot directly measure thought or capture all the effort spent reading and thinking. Fn hold time serves as an estimate of spoken output and may also include shortcut use. See the [counting rules (Chinese)](develop.md#按键次数与活跃时间计算). The screenshots above use demo data.

## Get Started

For **Apple Silicon Macs · macOS 13+**. Download the DMG from [Releases](https://github.com/KMnO4-zx/Toccata/releases), then drag `Toccata.app` into Applications.

Keyboard tracking requires permission under **System Settings → Privacy & Security → Input Monitoring**. Task management works independently.

Want to make it your own? Build instructions and development notes are in [develop.md (Chinese)](develop.md).

## Thanks 🙏

- <img src="images/logos/kimi.png" width="20" height="20" alt="Kimi Logo"> &nbsp; Thanks to the **[Kimi Global Ambassador Program](https://www.kimi.com/zh-cn/lp/kimi-ambassador)**. Kimi K3.1 Pro is a great model for visual design!
- <img src="images/logos/openai-rounded.svg" width="20" height="20" alt="OpenAI Logo"> &nbsp; Thanks to the **[OpenAI Codex for Open Source program](https://developers.openai.com/community/codex-for-oss)** for giving me 12 months of ChatGPT Pro. GPT 6 Astra is a great coding model!
- <img src="images/logos/volcengine.png" width="20" height="20" alt="Volcengine Logo"> &nbsp; Thanks to the **[Volcengine Hero Program](https://developer.volcengine.com/)**. Doubao's multimodal capabilities are excellent!
- <img src="images/logos/datawhale.png" width="20" height="20" alt="Datawhale Logo"> &nbsp; Thanks to **[Datawhale](https://datawhale.cn/)**. A place to meet wonderful people on the same journey.
