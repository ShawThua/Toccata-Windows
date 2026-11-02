# Windows 移植来源与第三方说明

本目录为 [KMnO4-zx/Toccata](https://github.com/KMnO4-zx/Toccata) 的非官方 Windows 移植。初始对照基线为 0.1.0 的 `4e3f89e4ceee03033e49722d162158f51bbea743`；Windows 预览版 `0.1.3-win.1` 另参考上游 `35b266d`（v0.1.3 / build 21）及 v0.1.1–v0.1.3 发布说明迁移新增功能，包括通用配置、喝水提醒、托盘活动与按键占比，并适配 Windows 更新流程。原作者的项目故事、名称、图标及其他上游资源不应被表述为移植者的原创作品。

- **Toccata**：Apache-2.0；完整文本见本目录 `LICENSE` 和仓库根 `LICENSE`。任务/统计规则、编辑器基础、应用标识资源与提示音来自上游项目；Windows 宿主、Raw Input 适配、布局配置、指标替换及相关 UI 是本移植的修改内容。原 macOS 源码与原有署名保留。
- **Microsoft Fluent UI System Icons**：MIT；完整版权及许可文本保存在 `renderer/FLUENT-ICONS-LICENSE.txt`。界面操作图标由该图标集提供；Windows 侧栏的分层内联 SVG 是本移植新增的绘制。
- **Electron 与 Chromium**：运行目录自带 `LICENSE.electron.txt` 和 `LICENSES.chromium.html`，交付完整运行目录时保留这些文件。
- 开发依赖的精确版本和来源保存在 `package-lock.json`。本说明不取代随项目或依赖附带的完整许可证文本。

当前 Windows 预览构建没有代码签名，不是原作者官方 Windows 发行，也不表示原作者对本移植提供维护或背书。
