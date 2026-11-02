# Windows 功能对齐审计与导航图标优化

审计日期：2026-10-28。对照的是本机上游源码快照 `4e3f89e4ceee03033e49722d162158f51bbea743`（Toccata 0.1.0），不是未经拉取核实的 GitHub 最新版本。

**2026-11-02 状态补充**：当前 Windows 预览源码版本为 `0.1.3-win.2`。此前已参考上游 `35b266d`（v0.1.3 / build 21）迁移通用配置、喝水提醒、托盘活动、按键占比及 Windows 更新流程，修复持续输入、计划日期和跨窗口编辑问题，并增加优先级颜色与文字标识；本轮进一步补齐 T2–T7 的任务排序、手动保存、返回父任务和音效/拖拽反馈。下文保留原审计及测试的历史证据，并在对应条目更新实现状态；任务操作见 [任务更新说明](windows-task-updates.md)，新增通用功能见 [迁移说明](windows-upstream-v013.md)，日常使用限制见 [预览说明](windows-preview.md)。

**结论：目前不能称为 100% 功能对齐，也不能称为已经完整稳定验收。** 任务管理、日历、回顾、普通键盘采集、热图、应用排行和分享已有实现；仍有可以直接从源码确认的功能遗漏、统计差异和平台限制。自动测试通过也不能代替所有真实 Windows 场景的验收。

本次完成源码对照、现有测试复核和六个侧栏图标优化。以下遗漏作为后续修复清单记录，本次图标改动没有改变任务业务、统计口径或数据格式。审计未读取日常任务及按键数据库。

## 证据边界

- 阅读上游 README、发布说明、采集与统计协议，以及相关 Swift/Rust 实现；对照 Windows JavaScript/C 实现和已有测试。
- 任务与系统/统计由两个只读审阅子代理分别检查。主代理直接复核了保存/返回父任务、排序规则、实时排行、日缓存查询与 Fn 等关键差异。表中的实现结论来自源码对照，不表示每个交互都已在实体 Mac 和 Windows 上逐项操作。
- 本轮未在 macOS 运行原程序或 Swift 测试；无法据此证明跨平台像素或行为完全相同。
- 用户此前已反馈普通键、组合键、长按，以及 A、Insert、Home、Page Up、Delete、End、Page Down 正常。此前睡眠测试出现过设备移除和 60 秒超时；醒后重新启动采集可以记录 A。这不足以证明完整睡眠/锁屏生命周期已通过。
- 合成事件、隔离数据库、强制 150% 缩放的 Electron 测试，与真实多设备、动态跨屏缩放、长期使用应分开记录。

下文 `Mac/` 表示 `apps/toccata-studio/Sources/`；`Win/` 表示 `apps/toccata-windows/`；其他路径相对于仓库根目录。行号对应本次审计源码。

## 已有主体能力

| 模块 | 当前实现与边界 | 主要证据 |
|---|---|---|
| 任务、收集箱 | 创建、编辑、计划日期、完成、删除、搜索；本周/最近七天筛选；真实创建时间保留。添加入口已修复，完成排序在 `0.1.3-win.2` 补齐，见 T1/T2。 | `Mac/TaskStore.swift:92`；`Mac/WorkspaceTaskListSnapshot.swift:26`；`Win/data/tasks.js`；`Win/renderer/task-order.js` |
| 子任务 | 完成级联、恢复祖先、禁止继续嵌套、删除级联、拖拽顺序持久化。统一默认顺序、返回父任务和拖拽反馈在 `0.1.3-win.2` 补齐。 | `Mac/SubtaskOrder.swift:9`；`Win/data/tasks.js`；`Win/renderer/task-order.js`；`Win/renderer/task-feedback.js` |
| 任务日历 | 周一开头、相邻月日期、创建/计划/完成标记、分类、未安排任务、在选定日期创建任务。 | `Mac/TaskCalendarModel.swift:38`；`Win/renderer/app.js:68` |
| 任务回顾 | 时间范围、父子上下文、未完成任务、完成记录、复制 Markdown。导出措辞有轻微差别。 | `Mac/TaskReviewSnapshot.swift:34`；`Win/data/tasks.js:185`；`Win/renderer/app.js:205`、`:261` |
| 编辑器、优先级 | Markdown 核心渲染/回写/粘贴/输入法组合处理，自动保存和保存失败保留草稿；四档优先级配色；`0.1.3-win.2` 增加保存按钮和 Ctrl+S。 | `Mac/MarkdownTextEditor.swift:667`；`Win/renderer/markdown-editor.html`；`Win/renderer/app.js`；`Win/tests/editor-render.test.js` |
| 托盘与浮动编辑 | 托盘任务/日历、任务选择、右键操作、上下移动、Tab 详情、Enter 子任务、Esc 关闭。 | `Mac/MenuTaskListKeyboard.swift:75`；`Win/renderer/app.js:212`、`:227`、`:290` |
| 普通键盘采集 | 设备、扫描码、扩展标记区分；重复 DOWN 过滤，单调时钟计算按住时长；左右修饰键、导航区、小键盘映射。 | `shared/protocol.md:100`；`Win/native/raw_input_helper.c:41`、`:184`；`Win/data/keyboard.js:11`；`Win/tests/keyboard.test.js:30` |
| 活跃时长 | 默认 5 秒短窗口与真实长按取并集；跨日、范围裁剪；孤立 UP 不制造时长。Fn 单独统计尚缺。 | `shared/protocol.md:106`；`Win/data/stats.js:110`、`:139`；`Win/tests/stats.test.js:17` |
| 热图、实时按压 | 实时按住、释放、多设备状态聚合、减少动态效果；保留目前分层立体键帽与按压表现。 | `Mac/LiveKeyboardFeedback.swift:10`；`Win/renderer/app.js:95`、`:297`；`Win/tests/keyboard-live.test.js:71` |
| Windows 配列 | 新增 68/84/87/104 代表性预设、自定义位置/尺寸/名称及持久化；不是自动硬件识别，未知扫描码不能自行绑定。 | `Win/data/keyboard-layouts.js:9`；`Win/renderer/layout-editor.js`；`Win/README.md:30` |
| 活跃日历、时间线 | 本地自然日、15 分钟桶、26 周日历；已有夏令时标签测试。 | `shared/protocol.md:111`；`Win/data/stats.js:150`；`Win/renderer/app.js:143`、`:191`；`Win/tests/timeline-dst.test.js:15` |
| 应用排行、分享 | 应用独立汇总、同名 EXE 区分、图标；固定时刻的已提交数据分享、预览、复制和保存 PNG。排行页面的实时口径仍有差异。 | `Mac/StatsRepository.swift:118`；`Mac/ActivityShareSnapshot.swift:27`；`Win/data/app-identities.js:110`；`Win/main.js:122`、`:159` |
| Windows 生命周期 | 原生窗口按钮、关闭收托盘、登录启动、单实例、退出前保存；设备移除/睡眠清理 held、helper 退出后重启。部分系统场景未实机验收。 | `Win/main.js:74`、`:87`、`:95`、`:108`、`:133`、`:167`；`Win/native/raw_input_helper.c:200`、`:206` |
| 本地数据、更新检查 | SQLite WAL、失败保留待写批次、重试；不持久保存进程完整路径；使用 Windows Fork 渠道、拒绝 Mac-only 包，支持手动触发的下载校验/安装回滚。 | `Win/data/keyboard.js`；`Win/data/updates.js`；`Win/data/update-manager.js`；`Win/README.md` |

## 已确认的差距

| 编号 | 差距 | 对使用的影响 | 对照证据 |
|---|---|---|---|
| T1 | 已修复（2026-10-29） | 主任务、收集箱、子任务、日历、托盘和浮窗的加号/提交箭头已接通，共用 Enter 提交逻辑；加入防重复提交。 | `Win/renderer/app.js` 的 `submitTaskInput` / `createTask`；`Win/tests/task-ui.test.js` 实际点击和持久化测试通过。 |
| T2 | 已补齐（`0.1.3-win.2`） | 普通任务/收集箱/主日历/托盘日历：未完成根按创建时间倒序、完成根按完成时间倒序，同值按 ID。托盘任务页继续尊重用户选择，名称采用自然排序；回顾保留已有树语义。 | `Mac/WorkspaceTaskListSnapshot.swift:44`；`Win/renderer/task-order.js` 的 `compareRoots`；`Win/tests/task-order.test.js` |
| T3 | 已补齐（`0.1.3-win.2`） | 全部子树、主详情、浮动编辑器统一按未完成优先、手工顺序、创建时间倒序、ID 排序；新建未手排子任务排在已有手工序号前。 | `Mac/SubtaskOrder.swift:9`；`Win/renderer/task-order.js` 的 `compareChildren`；`Win/renderer/app.js` |
| T4 | 已补齐（`0.1.3-win.2`） | 主详情/浮窗增加保存按钮和 Ctrl+S，Markdown iframe 内快捷键也可用；等待输入法确认及日期/优先级更新，只保存脏字段，失败保留草稿。 | `Mac/TaskDetailView.swift:141`；`Win/renderer/app.js` 的 `manualSave`；`Win/renderer/markdown-editor.html` 的 `toccata-save-request` |
| T5 | 已补齐（`0.1.3-win.2`） | 子任务详情/浮窗顶部增加父任务入口；先保存再导航，失败留在当前任务；父任务不存在时提示，浮窗同步宿主任务 ID。 | `Mac/TaskDetailView.swift:122`；`Win/renderer/app.js` 的 `parentTaskLink` / `returnToParent` |
| T6 | 已补齐（`0.1.3-win.2`） | 完成音效复用一个播放器、音量 0.6、播放中不叠加；播放异常不阻断任务完成。不同系统音频输出的真实听感仍需使用反馈。 | `Mac/TaskCompletionSound.swift:6`；`Win/renderer/task-feedback.js` 的 `playCompletion` |
| T7 | 已补齐（`0.1.3-win.2`） | 增加拖拽把手、合法插入细线及落位反馈；限同父任务、同完成状态组内重排，非法落点不写库；尊重减少动画设置。 | `docs/releases/v0.0.8.md:6`；`Win/renderer/task-feedback.js`；`Win/renderer/task-feedback.css` |
| K1 | Fn 语音时长已由 Windows 指标替代 | 经确认改为平均击键频率（次/活跃分钟），已用于统计卡、逐日摘要和分享图；底层 fn_ms 仍为空。若硬件不向 Windows 发出 Fn，不能靠画一个按键或模拟数据实现检测。 | `Win/renderer/app.js`；`Win/renderer/share-card.js` 的 `keystrokeRate` / `formatKeystrokeRate` |
| K2 | Pause 明确未映射，部分特殊键待验证 | Pause 在布局中显示不可检测；未映射键可计入总量，但不能准确落到对应热图位置。Print Screen/媒体键还需真实硬件事件核对。 | `Win/data/keyboard.js:30`、`:42`；`Win/README.md:35` |
| S1 | 排行页面加入实时未松开的长按 | 原版应用排行只读取已提交事件；Windows 把 live hold 加入 appGroups，因此持续长按时页面排行与原版/分享快照可能不同。松开落盘后通常收敛。 | `shared/protocol.md:115`；`Mac/StatsRepository.swift:118`；`Win/renderer/app.js:40` → `Win/main.js:121` → `Win/data/stats.js:133` |
| S2 | 排行上限与同分排序不同 | 原版默认前 20、相同时长按 app 排；Windows 未限 20，先按按键数再按 ID 处理相同时长。 | `Mac/StatsRepository.swift:96`、`:160`；`Win/data/stats.js:147` |
| P1 | 原版按天统计缓存尚未移植 | Windows 每轮查询原始行并在 JS 重算。历史增长后的响应时间、内存占用和主进程卡顿尚无规模测试结论；这里是性能风险，不是已测得的卡顿。 | `shared/protocol.md:121`；`Mac/ActivityRepository.swift:25`；`Win/data/keyboard.js:148`；`Win/data/stats.js:110` |
| R1 | Windows 更新流程已实现，正式签名仍待补 | `0.1.3-win.1` 使用本 Fork 渠道，支持兼容 ZIP、SHA256 校验、进度、取消和用户触发的安装/失败回滚；发布仍为未签名便携预览。测试使用隔离程序，实际跨版本更新与系统环境仍需使用反馈。 | `Win/data/updates.js`；`Win/data/update-manager.js`；`Win/data/install-update.ps1`；`Win/tests/update-installer.test.js` |

## 尚未完成的验收

- 真实多键盘设备、特殊键，以及设备拔插时仍按住键的组合场景。
- 完整睡眠/唤醒、锁屏/解锁、会话切换、UAC 安全桌面。native 当前没有 WTS 会话切换处理；这不是“必现故障”的证明。
- 多天持续运行、大量历史事件、统计刷新时延、CPU/内存和数据写入恢复的规模验收。
- 多显示器之间动态改变 DPI；本轮 150% 窄窗截图不能代表全部组合。
- 原版 Markdown 输入/粘贴/输入法细节测试的完整迁移。已有自动保存和失败保留测试，但并未覆盖原版所有编辑器测试案例。
- Mac 历史库迁移。当前 Windows 数据目录与 Mac 隔离，没有自动导入；它属于跨平台数据连续性的待办，不能假设复制数据库即可使用。
- 正式签名、安装包、卸载/升级保留数据、独立 Windows 更新发布的验收。

## 本轮 UI 改动

六个左侧导航改为本地内联 SVG：任务蓝色清单、收集箱暖金托盘、日历紫色日历页、回顾绿色时钟、键盘蓝青键区、趋势蓝色柱图。使用轻微渐变、填色和轮廓层次，保持中文名称和导航目标。

选中项保留蓝色位置标记，并增加浅底色及细边框；收集箱数量使用小型数字徽标。普通窗口行高 43px；高度不超过 650px 时压缩到 38px 并减少分组间距，以保证 150% 窄窗六项导航全部可见。减少动态效果模式禁用导航过渡。

图像生成适合探索视觉方向；最终按钮图标采用可维护的 SVG，适配 Windows 缩放，避免把整套导航做成固定分辨率位图。本轮未改变现有立体键帽的结构与动画。

实现文件：`Win/renderer/index.html:16`、`Win/renderer/styles.css:296`。

## 本轮验证记录

- 六页面 Electron 截图检查与 150% 深色检查首轮：2 passed，0 failed。逐图检查发现低高度窗口最后一个导航项被挤出可视区域，随后修复。
- 修复后的 dpi-smoke：1 passed，0 failed。另用临时只读坐标检查确认：890×574 CSS 像素、DPR 1.5，导航可视区 y=87.67–400.83，最后一项 y=340–378；clientHeight=scrollHeight=313，不需要侧栏滚动。
- 本轮 npm test 首次：92 项，90 passed、1 failed、1 skipped。失败为 `tests/task-ui.test.js:216` 的退出等待超时；此前业务断言通过。等待的是子进程 close（包含输出管道关闭）。
- 单独重跑 task-ui：1 passed，0 failed，主体 1.823 秒。不能仅凭单次重跑把原因断定为机器负载；原并发运行问题尚无确定根因。
- 完整串行回归：使用相同文件集合、`--test-concurrency=1`，92 项，91 passed、0 failed、1 skipped（28.154 秒）。退出测试本轮通过；保留首次并行运行异常的记录，不宣称其根因已解决。
- 图标包最初通过 `tests/packaged-smoke.cjs`（1 passed），等待用户退出。后续用户确认将 Fn 卡片改为平均击键频率，两项已一并打包并切换到 `dist/win-unpacked`；最终 staging 和正式目录各通过一次 packaged-smoke。现有数据目录保留。详细验收见 `.ai-governance/windows-activity-rate-design.md`。
- 真实采集握手测试仍为 skipped；本轮测试没有启动额外真实键盘采集实例。

截图与导航坐标报告保留于本地 QA 目录，不包含在公开源码或体验包中。测试使用隔离合成数据。

## 后续修复顺序

后续状态更新：用户已明确选择用平均击键频率替代 Fn 语音估算，卡片、逐日摘要与分享图已实现并交付。这是经确认的 Windows 指标调整，不代表 Windows 已能采集硬件未上报的 Fn；本报告中的其他功能差距仍按各自条目处理。

1. 任务交互 T1–T7 已有对应修复；`0.1.3-win.2` 的排序、保存/父任务导航、音效和拖拽需按本轮专项与完整回归分别验收，记录见 [任务更新说明](windows-task-updates.md)。
2. 统计与性能：S1/S2 先明确对齐原版已提交口径；P1 单独设计缓存与历史失效策略，并用规模数据验收，不能作为图标小修顺带修改。
3. 平台采集：K2 实机采样后补映射；K1 明确硬件能力边界，如需替代 Fn 估算方法，应单独确认业务含义。
4. 长期生命周期、真实音频/输入法、签名及跨版本升级实机验收继续保留；音效/拖拽的实现缺口已在 T6/T7 更新。保持“预览/逐项验收”定位。

## 变更范围与治理记录

- 依据：用户要求核查原版功能，并优化任务/收集箱/日历等左侧图标；延续已授权的 Windows UI 优化。
- G1：本次实现仅两个前端文件，加本审计文档共三个文件；H1 未命中（不足 5 文件）；H2 无数据库变更；H3 无接口变更；H4 无权限变更；H5 无交易；H6 无跨业务重构；H7 无新依赖；H8 无跨技术层改动；H9 无构建配置变更；H10 无未定业务口径。判定为小改动，直接进入实施，G2 不适用。
- 复用现有导航、主题、路由、缩放与减少动态效果支持。图标在本地实现，不依赖网络图像或服务。
- G3：验收结果如上。回退只涉及 index.html/styles.css；用户的数据目录不属于切换目标。原版缺口的修复需另按其范围判定，不因本次图标任务自动改变统计或数据契约。
