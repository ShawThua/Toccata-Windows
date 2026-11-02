# Toccata Windows 移植预览版

此目录是 [KMnO4-zx/Toccata](https://github.com/KMnO4-zx/Toccata) 的非官方 Windows 桌面移植。初始对照基线为 0.1.0 的 `4e3f89e4ceee03033e49722d162158f51bbea743`；当前预览版 `0.1.3-win.2` 已参考上游 `35b266d`（v0.1.3 / build 21）补充通用配置、喝水提醒、托盘活动、按键占比与 Windows 更新流程，并补齐任务排序、Ctrl+S 保存、返回父任务及音效/拖拽交互。目标是保留原有任务、统计和托盘交互，并采用 Windows 窗口与视觉风格。键盘热图支持 68、84、87、104 键代表性预设和用户自定义。此版本仍在逐项验收，不能视为完整稳定版。用户使用及已知问题见 [Windows 预览说明](../../docs/windows-preview.md)。

## 本地开发

本机构建与验证环境为 Windows 11 x64、Node.js **24.13.0**、npm **11.12.1**、MinGW-w64 GCC **15.2.0**（目标 `x86_64-w64-mingw32`）。这些是已验证版本，不代表其他系统或工具链已验收。安装 Node/npm 与 MinGW-w64 后，将 GCC 的 bin 目录加入 PATH。可先用 `node --version`、`npm --version`、`gcc -dumpmachine` 检查。

在本目录执行以下命令；便携程序使用者无需安装这些开发工具：

```powershell
npm ci
npm run build:native
npm run pack
```

若希望依赖缓存和临时文件放到非系统盘，可在以上步骤之前设置；以下 `D:` 只是示例，应替换为自己的可写磁盘路径并创建目录：

```powershell
$toccataCacheRoot = 'D:\ToccataBuildCache'
New-Item -ItemType Directory -Force -Path "$toccataCacheRoot\temp", "$toccataCacheRoot\electron", "$toccataCacheRoot\builder", "$toccataCacheRoot\npm" | Out-Null
$env:TEMP = "$toccataCacheRoot\temp"
$env:TMP = $env:TEMP
$env:ELECTRON_CACHE = "$toccataCacheRoot\electron"
$env:ELECTRON_BUILDER_CACHE = "$toccataCacheRoot\builder"
$env:npm_config_cache = "$toccataCacheRoot\npm"
```

开发界面时可以关闭采集后启动：

```powershell
$env:TOCCATA_DISABLE_CAPTURE = '1'
npm start
```

`npm start` 正常启动会启动后台键盘采集程序。采集会记录按键物理代码、时间、按住时长和前台程序名，并持久保存到本地；并不直接保存键入的字符，但按键序列可能透露输入信息。关闭主窗会收起到托盘；通过托盘菜单“退出 Toccata”停止采集并退出。开发 UI 时可临时设置 `$env:TOCCATA_DISABLE_CAPTURE='1'`，此时采集状态会明确显示测试模式；正常使用请移除该变量。

开发版默认数据目录为本工作区旁的 `Toccata-Windows-Data`。打包后的便携版默认数据在程序目录旁的 `Toccata-data` 文件夹（须可写；例如 `dist/win-unpacked/Toccata.exe` 使用 `dist/Toccata-data`）；也可以在启动前用 `TOCCATA_DATA_DIR` 指定绝对路径。该目录的 `config.json` 可设置 `activity_window_secs`（非负整数，默认 5），修改后重启生效。数据与上游 macOS 库隔离；请在复制、升级或移动应用时完整保留该目录，包括应用身份数据库和 `app-identity.key`。键盘事件只持久化应用身份标识及名称，不保存进程完整路径。开发测试使用独立的合成数据，不读取日常数据。

## 构建 Windows 便携目录

在此目录执行 `npm run build:native` 后执行 `npm run pack`。程序位于 `dist/win-unpacked/Toccata.exe`，需要和同目录其他文件一起保留。构建保留上游图标和 Apache-2.0 许可证，Fluent UI 图标保留 Microsoft MIT 声明，详情见 [第三方说明](THIRD-PARTY-NOTICES.md)。尚未配置代码签名证书；构建不上传或发布任何文件。

分享程序时只打包 `win-unpacked` 的完整文件组，另附用户说明与许可证；不要把同级 `Toccata-data`、开发数据、依赖目录、日志或 QA profile 一起打包。当前预览版为 `0.1.3-win.2`，见 [任务交互更新](../../docs/windows-task-updates.md)、[迁移说明](../../docs/windows-upstream-v013.md) 与 [发布页](https://github.com/WenNinghan/Toccata-Windows/releases/tag/v0.1.3-win.2)。更新使用 Windows Fork 的预发布渠道，支持 ZIP、校验、进度、取消和用户触发的安装回滚。旧的 2026-10-29 公开包需要先手动升级。构建命令本身不会发布；发布资产应包含 `Toccata-Windows-v0.1.3-win.2-x64.zip`、`Toccata-Windows-source-v0.1.3-win.2.zip` 和 `SHA256SUMS.txt`。

## 任务交互

主详情与浮动编辑窗都提供保存按钮及 `Ctrl+S`，自动保存继续可用。快捷键覆盖 Markdown 编辑器；输入法组词尚未确认时，保存请求等待组词结束，失败会保留草稿。子任务详情顶部可返回父任务，返回前先保存，失败则停留。子任务支持拖拽把手、合法插入位置提示和落位反馈；只允许同父任务、同完成状态组内重排。完成音效使用单个播放器、音量 0.6，播放中不叠加。排序规则和操作入口见 [任务交互更新](../../docs/windows-task-updates.md)。

## 调整键盘布局

在“键盘活跃”页面的热力图右上角选择预设；点击“自定义”可以拖动键、添加或移除键、调整位置、尺寸与标签，点击“应用布局”保存。切换只改变显示，不删除键盘事件或总计。不同厂商的物理布局不同，预设不代表自动识别；当前暂不支持为尚未映射的扫描码自行绑定新键。Fn 和 Pause 可显示为不可检测键，不会生成虚假统计。

## 测试与限制

### Windows 平均击键频率

第三张统计卡以“平均击键频率”替代原版 Fn 语音时长估算。计算为有效按键次数 × 60000 ÷ 键盘活跃毫秒数；卡片显示“次/分”，下方注明按每活跃分钟计算，每日摘要及分享图使用完整单位“次/活跃分钟”。多日合计以总次数除以总活跃时间，不平均各天频率；既有历史记录无需迁移即可计算。无可计量活跃时间时显示“—”。

有效按键包含修饰键、过滤长按自动重复；活跃时长沿用当前配置的短窗口（默认 5 秒）与实际按住区间的并集。该指标表示键盘操作密度，不是输入字数、打字速度或工作效率，短样本会有波动。页面使用实时统计，分享使用生成时刻的已提交快照。此改动不让硬件未上报的 Fn 变得可检测，也不新增语音或文字内容采集。

### 验证范围

全新源码安装后，在本目录先准备 Electron 二进制再运行完整测试；前文的非系统盘缓存和临时目录设置同样适用：

```powershell
npm ci
npx --no-install install-electron
npm run build:native
npm test
```

Electron 45 在 `npm ci` 阶段安装 JavaScript 包，通过 `require('electron')` 使用时再按需下载二进制。部分测试直接启动 `node_modules/electron/dist/electron.exe`，因此测试前需要显式运行 `install-electron`。`npm start` 和打包继续沿用各自现有的下载流程。

- `npm test` 串行运行任务、键盘映射、统计、分享、设置、喝水提醒、更新检查/安装回滚及 Electron 界面集成测试，包含持续输入、计划日期和优先级颜色回归。`node --test tests/packaged-smoke.cjs` 检查已打包程序的启动、写入、退出和重启持久化。`node --test tests/visual-smoke.cjs` 用独立数据运行六页面截图检查；`node --test tests/capture-smoke.cjs` 会短暂启用真实采集 helper，只检查其启动和退出，键盘数据只在内存中，运行前需告知电脑使用者。
- Windows 键盘事件按设备、扫描码和扩展标记区分。Fn 可能由硬件处理且不传到系统；无法检测时界面显示不可用。Pause 和部分 Print Screen/媒体键的硬件事件还需实机验证。
- 原版与本移植分别依赖不同桌面平台；目前尚不能声称全部界面、系统交互和统计功能已完全等价。尤其多设备、特殊键、长时间运行、多屏、高 DPI、完整 Markdown/托盘和历史导入仍应逐项验收。详细状态见 [Windows 预览说明](../../docs/windows-preview.md) 与本目录测试。
- 源码预览的测试可移植性待补：部分测试文件仍将测试/截图根目录设为 `G:\DevTools\temp`，无该目录或磁盘的机器不能直接运行完整测试。源码能打包不等于完整测试已在另一台电脑跑通。后续应统一可配置的测试根目录；目前没有自动创建或映射 G 盘的步骤。
- 既有并行完整测试出现过退出等待超时，单独及串行运行通过，根因未确定。当前 `npm test` 已统一使用 `--test-concurrency=1`；这不是所有环境都通过的承诺。



