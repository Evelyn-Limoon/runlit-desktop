# RunLit

[简体中文](README.zh-CN.md) | [English](README.md) | [中英双语用户手册](docs/RunLit-user-manual-bilingual.md)

**看见不同 AI 工具正在做什么，并一键打开真实成果。**

RunLit 是一款本地优先的 Windows 与 Linux 桌面 AI 任务观察与成果导航工具。它把有真实证据的 AI 工作整理成轻量任务灯，展示任务状态与实质版本，并把每个版本连接到实际文件、文件夹、项目或可信网页成果。

> 当前版本：**v0.1.0-preview.3 — Windows x64 与 Linux x64 预览版**
>
> RunLit 只观察已经运行的 AI 工具，不负责发起、控制或冒充这些工具。

RunLit 已选择 SignPath Foundation 开源计划作为后续 Windows 签名方案，
但目前尚未通过审核，因此当前预览版仍然是未签名版本。免费代码签名由
SignPath.io 提供，证书由 SignPath Foundation 提供。详情见
[代码签名政策](docs/code-signing-policy.md)。

## 它能做什么

- **集中查看多个 AI 工具。** 已内置 Codex 和 WorkBuddy AI；其他会生成本地文件的工具可以通过成果目录接入。
- **显示有证据的任务状态。** 只有 Adapter 能够证明时，才显示进行中、已完成、已中断或状态未知。
- **记录有意义的版本。** 一次用户交互确实修改了成果时才产生一个版本，不会把每次临时文件写入都算成版本。
- **用自己的语言命名版本。** 可以修改任一有意义版本的标题，后续自动同步不会覆盖人工标题。
- **直接打开真实成果。** 单个成果直接打开文件；多个成果打开共同文件夹；可信网页成果直接打开链接。
- **低干扰常驻桌面。** 浮球可拖动、点击展开任务窗口；桌面环境提供通知区域时也可从通知区域操作。
- **可恢复地隐藏任务。** 从灯条删除只会隐藏任务，不会删除成果或历史；同一会话出现新活动时可以自动恢复。
- **数据保留在本机。** RunLit 的观察数据库与设置保存在当前电脑，不保存聊天正文。

## 当前支持的接入方式

| AI 工具 | 接入方式 | RunLit 可观察的内容 |
| --- | --- | --- |
| Codex | 自动发现 Codex Desktop 或 CLI | 有证据的任务生命周期、工作目录、实质版本和本地成果物 |
| WorkBuddy AI | 自动发现本地数据，也可手动选择目录 | 本地会话、修改和成果物证据 |
| 其他会生成文件的 AI 工具 | 添加工具并选择专用成果目录 | 新建或修改的成果物，按同一次写入活动合并为版本 |
| 需要精确实时状态的其他工具 | 专用 RunLit Adapter | 取决于 Adapter；当前尚未内置 |

是否真正连接成功，应以 **AI 工具接入** 页面的状态为准。出现 Logo 并不等于已经完成数据接入。

## 下载与安装

请只从官方 [RunLit Releases 页面](https://github.com/Evelyn-Limoon/runlit-desktop/releases/tag/v0.1.0-preview.3)下载。

- **Windows x64：** [Setup 安装程序](https://github.com/Evelyn-Limoon/runlit-desktop/releases/download/v0.1.0-preview.3/Runlit_0.1.0_x64-setup.exe)、[MSI 安装包](https://github.com/Evelyn-Limoon/runlit-desktop/releases/download/v0.1.0-preview.3/Runlit_0.1.0_x64_en-US.msi)和 [Windows 校验值](https://github.com/Evelyn-Limoon/runlit-desktop/releases/download/v0.1.0-preview.3/SHA256SUMS.txt)。
- **Linux x64：** Debian/Ubuntu `.deb` 与便携 `.AppImage`，并提供 [Linux 校验值](https://github.com/Evelyn-Limoon/runlit-desktop/releases/download/v0.1.0-preview.3/SHA256SUMS-linux.txt)。文件名以 Release 页面实际显示为准。

当前 Windows 预览版尚未代码签名，因此 Windows 可能提示“未知发布者”或显示 Microsoft Defender SmartScreen 警告。安装前请校验文件：

```powershell
Get-FileHash -Algorithm SHA256 .\Runlit_0.1.0_x64-setup.exe
```

将结果与 `SHA256SUMS.txt` 对比。安装版已自带后台运行环境，普通用户不需要另行安装 Node.js、npm 或 Rust。

## 第一次使用

1. 安装后，从 Windows 开始菜单或 Linux 应用菜单启动 RunLit；AppImage 用户可赋予执行权限后直接运行。
2. 右键单击 RunLit 浮球或通知区域图标，打开 **AI 工具接入**。
3. 确认 Codex 或 WorkBuddy 显示 **已连接**。接入其他工具时，选择 **添加 AI 工具**，填写名称并选择专用成果目录。
4. 在 AI 工具中执行会新建或实质修改本地成果的任务。
5. 等待自动检测。当前内置 Adapter 约每 5 秒扫描一次，验收目标是不超过 20 秒。
6. 新任务灯出现后，单击它查看状态和版本。
7. 单击成果物名称直接打开该成果；使用版本卡片上的 **打开文件夹** 打开成果所在目录或共同目录。

只聊天、只打开 AI 工具，或者仅在聊天中提到但无法验证的文件和 URL，通常不会生成任务灯。

## 日常操作

- **左键单击浮球：** 展开或收起 RunLit。
- **拖动浮球：** 调整桌面位置。
- **把展开窗口拖到屏幕边缘：** 自动收成浮球。
- **右键浮球或通知区域图标：** 打开 AI 工具接入、刷新或完全退出 RunLit。
- **右键任务灯：** 从灯条隐藏任务；RunLit 历史与原始成果不会被删除。
- **版本标题旁的铅笔：** 人工重命名版本，最多约 40 个中文字符或 80 个英文字符。
- **窗口底部中央短横线：** 向下拖动，展开查看最新 3 个版本与任务信息。
- **眼睛按钮：** 共享屏幕时隐藏任务名称和路径。

## 本地数据与隐私

RunLit 只监听 `127.0.0.1`，安装版数据默认保存在平台用户数据目录：

```text
Windows: %LOCALAPPDATA%\com.runlit.desktop
Linux:   ${XDG_DATA_HOME:-$HOME/.local/share}/com.runlit.desktop
```

内置 Adapter 只保留观察所需的会话标识、状态、工作目录、时间、证据和成果引用，不保存聊天正文。外部 Adapter 必须使用 RunLit 为本次安装生成的令牌访问本地服务。

## 当前预览版限制

- 仅支持 Windows x64 与 Linux x64；暂不支持 macOS 和 ARM64。
- Windows 安装包尚未签名；Linux 包提供 SHA-256 校验值，但尚无软件仓库签名。
- Linux 通知区域是否显示取决于桌面环境；没有兼容托盘宿主时仍可使用浮球完成主要操作。
- 目前只有 Codex 与 WorkBuddy AI 是内置 Adapter。
- 通用成果目录接入只能证明成果物，不能证明该工具的具体提示词和精确实时生命周期。
- AI 工具的数据格式变化后，Adapter 可能需要更新。
- 暂无跨电脑云同步和自动更新。

## 指南与反馈

- [中英双语用户手册](docs/RunLit-user-manual-bilingual.md)
- [详细中文手册](docs/user-guide.zh-CN.md)
- [Detailed English guide](docs/user-guide.en.md)
- [反馈普通功能问题](https://github.com/Evelyn-Limoon/runlit-desktop/issues)
- [安全政策](SECURITY.md)
- [隐私政策](PRIVACY.md)
- [代码签名政策](docs/code-signing-policy.md)

公开提交日志前，请删除用户名、本地路径、会话 ID、令牌和聊天内容。

## 开发者入口

源码开发需要 Node.js 24+、npm、Rust，以及对应平台的 [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)。

```powershell
npm ci
npm run start:runlit
```

Linux 安装完 Tauri 系统依赖后，使用 `npm run start:runlit:linux`。

- [Adapter 开发指南](docs/adapter-development.md)
- [贡献指南](CONTRIBUTING.md)
- [发布流程](docs/release-process.md)

RunLit 使用 [MIT License](LICENSE)。AI 工具名称与标志仅用于标识任务来源，不代表相关品牌赞助、认可 RunLit，或与 RunLit 存在官方合作关系。
