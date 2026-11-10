<p align="center">
  <img src="shared/branding/toccata-app-icon.png" alt="Toccata" width="96">
</p>

<h1 align="center">Toccata</h1>

<p align="center">
  <strong>简体中文</strong> · <a href="README_EN.md">English</a>
</p>

<p align="center">
  <strong>记下想法，看见投入</strong><br>
  <em>想看下你的思维净活跃时长吗？</em>
</p>

<p align="center">
  <a href="https://github.com/WenNinghan/Toccata-Windows/releases/tag/v0.1.5-win.1">下载 Windows 预览版</a> ·
  <a href="https://github.com/KMnO4-zx/Toccata/releases">上游 macOS 下载</a> ·
  <a href="develop.md">开发指南</a> ·
  <a href="LICENSE">Apache-2.0</a>
</p>

## Windows 移植预览

2026-11-10 预览版 `0.1.5-win.1` 参考上游 v0.1.4–v0.1.5，加入主任务置顶、任务组拖拽、跨窗口共享排序、完成动画和 Windows 更新提示。持续输入、计划日期与跨窗口编辑保护保留，优先级继续用灰、蓝、橙、红和文字区分。见 [任务交互更新](docs/windows-task-updates.md) 与 [上游功能迁移](docs/windows-upstream-v013.md)。

本 Fork 提供 [KMnO4-zx/Toccata](https://github.com/KMnO4-zx/Toccata) 的**非官方 Windows 移植预览版**，最初基于 0.1.0，并移植部分截至 v0.1.5 的功能，代码位于 [`apps/toccata-windows`](apps/toccata-windows)。支持 Windows 原生窗口、任务与托盘、键盘活动统计、68/84/87/104 键布局及自定义；原版 Fn 语音估算在 Windows 版中替换为平均击键频率。

**[下载 Windows 11 x64 预览包](https://github.com/WenNinghan/Toccata-Windows/releases/tag/v0.1.5-win.1)** · [通用配置](docs/images/windows-v013-settings.png) · [托盘活动](docs/images/windows-v013-tray.png) · [任务日历](docs/images/windows-v013-calendar.png)

使用方法、采集与数据说明、已知问题见 [Windows 预览版说明](docs/windows-preview.md)，构建方法见 [Windows 开发说明](apps/toccata-windows/README.md)。当前不是完整稳定版，也不宣称与原版 100% 等价；上游 Releases 链接不代表提供本移植的 Windows 包。

以下保留原作者的 macOS 项目介绍、创作背景与致谢；其中第一人称描述属于上游作者。原项目和本移植保留 [Apache-2.0](LICENSE) 许可。

## 起因

我以前从来不用 ToDo 应用，觉得事情放在脑子里完全 OK。最近工作、学习的事越来越多，终于还是得找个地方记下来。

需求很简单：随手打开就能看到已完成和未完成的任务，到了周末，把这周的事情拿出来写周报。于是试了滴答清单，做的太烂了，居然还想收我的钱！

**No way，那就自己做一个。**

我还很想做一个能记录 **「思维净活跃时长」** 的东西。每天在电脑前待那么久，到底有多少时间是我的思维活跃时间？既然都自己写了，那就把这个也一起做进去。

名字取自键盘乐曲 [Toccata](https://www.dictionary.com/browse/toccata)（托卡塔），源于意大利语 *toccare*，意为“触碰”。我喜欢这个联想：双手触键，想法慢慢变成眼前的东西。

## ToDo 管理

- **随手记**：菜单栏打开小窗，快速添加、编辑任务，完成与待办都能看到。
- **慢慢理**：主界面里拆分子任务，用 Markdown 写详情，按需安排日期、查看任务日历。
- **周末回顾**：汇总本周完成与尚未完成的事，一键复制为周报素材，再写自己的总结。

![ToDo 管理：左侧工作台，右侧菜单栏小窗](images/todo-management.png)

## 键盘活跃：思维净活跃时长

我还想知道一件事：用电脑的这些时间里，到底有多少是我本人在活跃。每隔几秒截一张图，再让 AI 分析我在干什么，这种方式隐私很难保证。所以我想从键盘输入入手。

我的想法很简单：**对电脑来说，我是在输入；对我自己来说，我是在输出。人在输出的时候，思维一定是活跃的。** 此时我和电脑的连接，就是双手十指之间的触碰。

> 回收伏笔：Toccata 源自意大利语 *toccare*，意为“触碰”。

我想用键盘记录自己在对外输出的时间，把它叫作 **「思维净活跃时长」**。这个概念在我看来很性感 🤔

- **按键热力图**：看看哪些键最常用，按下时也有实时反馈。
- **活跃时间线**：按天查看输入发生在哪些时段，也能回顾常用应用和 Fn 按住时长。
- **本机记录**：记录键码、时间、按住时长与应用归属，数据保存在本机，采集过程不截图、不录音。

![键盘活跃：逐键热力图与最近 7 天的活跃时间线](images/keyboard-activity.png)

> 「思维净活跃时长」是项目的创作概念，实际计时根据键盘活动估算，无法直接测量思维，也无法覆盖阅读、思考等全部投入。Fn 时长用于估算语音输出，也可能包含快捷键操作。详见[计算规则](develop.md#按键次数与活跃时间计算)。以上图片使用演示数据。

## 开始使用

适用于 **Apple Silicon Mac · macOS 13+**。从 [Releases](https://github.com/KMnO4-zx/Toccata/releases) 下载 DMG，将 `Toccata.app` 拖入“应用程序”即可安装。

键盘记录需要在“系统设置 → 隐私与安全性 → 输入监控”中授权；任务管理可以独立使用。

想按自己的习惯修改？构建与二次开发说明都在 [develop.md](develop.md)。


## 致谢 🙏

- <img src="images/logos/kimi.png" width="20" height="20" alt="Kimi Logo"> &nbsp; 感谢 **[Kimi 全球大使计划](https://www.kimi.com/zh-cn/lp/kimi-ambassador)**。 Kimi K3.1 Pro 是一个在审美设计领域很棒的模型！
- <img src="images/logos/openai-rounded.svg" width="20" height="20" alt="OpenAI Logo"> &nbsp; 感谢 **[OpenAI Codex For Open Source 计划](https://developers.openai.com/community/codex-for-oss)**，赠予我 12 个月的 ChatGPT Pro 订阅。GPT 6 Astra 是一个很棒的 Coding 模型！
- <img src="images/logos/volcengine.png" width="20" height="20" alt="火山引擎 Logo"> &nbsp; 感谢 **[火山 Hero 计划](https://developer.volcengine.com/)**。 豆包的多模态能力确实非常棒！
- <img src="images/logos/datawhale.png" width="20" height="20" alt="Datawhale Logo"> &nbsp; 感谢 **[Datawhale](https://datawhale.cn/)**。 在 Datawhale 可以遇到优秀的同行人。
