# RunLit 用户指南 / User Manual

[中文](#中文指南) | [English](#english-guide) | [GitHub Releases](https://github.com/Evelyn-Limoon/runlit-desktop/releases)

> 适用版本 / Applies to: `v0.1.0-preview.1`
>
> 平台 / Platform: Windows x64
>
> 状态 / Status: unsigned public preview / 未签名公开预览版

RunLit 已选择 SignPath Foundation 开源计划作为后续 Windows 签名方案，
但当前版本尚未获得签名。Free code signing provided by SignPath.io,
certificate by SignPath Foundation. See the
[code signing policy / 代码签名政策](code-signing-policy.md).

---

## 中文指南

### 1. RunLit 是什么

RunLit 是一款常驻 Windows 桌面的 AI 任务观察与成果导航工具。它不替你启动或控制 AI，而是读取受支持工具在本机留下的任务状态与成果证据，并将它们整理成任务灯、版本脉络和可打开的成果入口。

它适合同时使用多个 AI 工具、经常让 AI 修改本地文件，希望快速确认“哪个任务结束了、这轮改了什么、成果在哪里”的用户。

### 2. 主要功能

- 在浮动任务灯条中集中查看 Codex、WorkBuddy AI 和手动接入工具的任务；
- 自动刷新新任务与状态，当前目标延迟不超过 20 秒；
- 每次产生实质修改的用户交互记录一个版本；
- 直接打开单个成果物，或打开多个成果物所在的共同文件夹；
- 通过浮球和 Windows 通知区域菜单进入接入设置、刷新和退出；
- 可恢复地隐藏任务，不删除原始成果和版本历史；
- 数据本地保存，不保存聊天正文。

### 3. 安装

1. 打开 [RunLit v0.1.0-preview.1 Release](https://github.com/Evelyn-Limoon/runlit-desktop/releases/tag/v0.1.0-preview.1)。
2. 普通用户下载 `Runlit_0.1.0_x64-setup.exe`；需要 MSI 部署时下载 `.msi`。
3. 下载 `SHA256SUMS.txt`，用以下命令校验安装包：

```powershell
Get-FileHash -Algorithm SHA256 .\Runlit_0.1.0_x64-setup.exe
```

4. 对比校验值后运行安装程序。

当前版本未签名，Windows 可能显示未知发布者或 SmartScreen 提示。请只从上述 GitHub Release 下载。

### 4. 第一次连接 AI 工具

1. 启动 RunLit。
2. 右键浮球或 Windows 通知区域中的 RunLit 图标。
3. 选择 **AI 工具接入**。
4. 查看 Codex 或 WorkBuddy AI 的状态：
   - **已连接：** 可以直接使用；
   - **未发现：** 确认对应 AI 工具能独立运行，然后选择重新检测；
   - **连接异常：** 按页面显示的错误检查路径或本地数据目录。
5. 接入其他会生成本地文件的 AI 工具时，选择 **添加 AI 工具**，填写工具名称，并选择一个专用成果目录。

通用目录接入只能识别新建或修改的成果文件，不能判断该 AI 工具内部的精确运行状态。需要精确生命周期时，需要对应的专用 Adapter。

### 5. 让任务显示出来

1. 在已连接的 AI 工具中打开本地项目或文件夹。
2. 发出会创建、编辑、生成或导出本地成果的指令。
3. 等待 AI 完成实质文件操作。
4. RunLit 自动扫描并把符合条件的任务放入灯条。

只聊天、只打开 AI 工具、或者只在聊天里提到一个无法验证的文件或链接，不会生成任务灯。这是为了避免虚假任务和虚假状态。

### 6. 查看任务与成果

- 单击任务灯：查看任务状态、版本和成果物；
- 单击成果物名称：直接打开成果物本身；
- 单击版本卡片的 **打开文件夹**：打开成果所在目录；
- 同一轮产生多个本地成果时：RunLit 显示它们的共同文件夹；
- 可信网页成果：直接打开网页链接；
- 眼睛按钮：共享屏幕时隐藏任务名和路径。

一次版本代表一次对本地文件、产品、网站或任务产生实质修改的用户交互，不代表一次临时保存或每个底层文件事件。

### 7. 浮球、刷新、删除和退出

- 左键单击浮球：展开或收起任务窗口；
- 拖动浮球：移动位置；
- 把展开窗口拖到屏幕边缘：收成浮球；
- 右键浮球或通知区域图标：进入 AI 工具接入、刷新或完全退出；
- 右键任务灯并选择删除：只从灯条隐藏任务；以后同一会话再次运行时，可以带着原有历史恢复。

正常情况下无需手动刷新。若刚修改接入配置，可使用 **重新检测** 或 **刷新**。完全停止后台时必须使用 **退出 RunLit**。

### 8. 数据与隐私

安装版数据位置：

```text
%LOCALAPPDATA%\com.runlit.desktop
```

其中包含数据库、设置、本地 API 授权令牌和日志。RunLit 只监听本机地址 `127.0.0.1`。不要把 `auth-token`、完整日志、用户名、会话 ID 或私人工作路径提交到公开 Issue。

### 9. 当前限制与故障排查

- 当前只支持 Windows x64；
- 安装包未签名，可能出现 Windows 安全提示；
- 只有 Codex 和 WorkBuddy AI 是内置 Adapter；
- 暂无跨设备云同步和自动更新；
- 任务超过 20 秒仍未出现时，先确认这轮确实产生了本地成果，再检查 **AI 工具接入** 状态；
- 成果打不开时，确认文件没有被移动或删除，并尝试打开所在文件夹；
- 任务长期显示进行中时，检查 Adapter 是否仍为已连接；不能证明结束时，RunLit 会显示中断或未知，而不会伪造完成。

更完整的排查信息见 [详细中文手册](user-guide.zh-CN.md)。

---

## English guide

### 1. What RunLit is

RunLit is a resident Windows desktop observer and result navigator for AI work. It does not launch or control your AI tools. It reads supported local task-state and artifact evidence, then organizes that evidence into task lights, material versions, and direct result links.

It is designed for people who use more than one AI tool and want a quick answer to: Which task finished? What changed in this interaction? Where is the result?

### 2. Main features

- View Codex, WorkBuddy AI, and manually connected file-producing tools in one floating task dock.
- Receive automatic task and status refreshes, with a current acceptance target of no more than 20 seconds.
- Record one version for each user interaction that materially changed a result.
- Open one artifact directly or open the common folder for multiple artifacts.
- Access connections, refresh, and exit from both the orb and Windows notification-area menus.
- Hide tasks recoverably without deleting source artifacts or RunLit history.
- Keep observation data local without storing chat bodies.

### 3. Installation

1. Open the [RunLit v0.1.0-preview.1 Release](https://github.com/Evelyn-Limoon/runlit-desktop/releases/tag/v0.1.0-preview.1).
2. Download `Runlit_0.1.0_x64-setup.exe` for normal installation, or the `.msi` for MSI deployment.
3. Download `SHA256SUMS.txt` and verify the installer:

```powershell
Get-FileHash -Algorithm SHA256 .\Runlit_0.1.0_x64-setup.exe
```

4. Compare the checksum, then run the installer.

This preview is unsigned, so Windows may show an Unknown Publisher or SmartScreen warning. Download it only from the GitHub Release above.

### 4. Connect an AI tool

1. Launch RunLit.
2. Right-click the orb or the RunLit notification-area icon.
3. Select **AI Tool Connections**.
4. Inspect the Codex or WorkBuddy AI status:
   - **Connected:** ready to use;
   - **Not found:** confirm the AI tool runs independently, then redetect it;
   - **Connection error:** follow the displayed path or local-data guidance.
5. For another file-producing AI tool, choose **Add AI Tool**, enter its name, and select a dedicated output folder.

Generic folder monitoring can verify created and modified artifacts, but it cannot prove the provider's exact internal lifecycle. Precise status requires a dedicated adapter.

### 5. Make a task appear

1. Open a local project or folder in a connected AI tool.
2. Request work that creates, edits, generates, or exports a local result.
3. Let the tool complete the material file operation.
4. RunLit scans automatically and adds qualified work to the task dock.

A chat-only conversation, merely opening an AI tool, or mentioning an unverified file or URL does not create a task light. This prevents false tasks and invented states.

### 6. Inspect tasks and results

- Click a task light to see its state, versions, and artifacts.
- Click an artifact name to open that artifact directly.
- Click **Open folder** on a version card to open the containing directory.
- If one interaction produced multiple local artifacts, RunLit opens their common folder.
- A trusted web result opens as a direct link.
- Use the eye button to conceal names and paths while sharing your screen.

One version represents one user interaction that materially changed a local file, product, website, or task result. It does not represent every temporary save or low-level filesystem event.

### 7. Orb, refresh, removal, and exit

- Left-click the orb to expand or collapse RunLit.
- Drag the orb to move it.
- Drag the expanded window to a screen edge to collapse it into the orb.
- Right-click the orb or notification-area icon for connections, refresh, and full exit.
- Right-click a task light and remove it to hide the task from the dock. Later activity from the same session can restore it with its history.

Manual refresh is normally unnecessary. After changing a connection, use **Redetect** or **Refresh**. To stop the background process as well as the window, use **Exit RunLit**.

### 8. Data and privacy

Installed-app data is stored under:

```text
%LOCALAPPDATA%\com.runlit.desktop
```

This directory contains the database, settings, local API authorization token, and logs. RunLit listens only on `127.0.0.1`. Never publish `auth-token`, complete logs, user names, session IDs, or private workspace paths in a public issue.

### 9. Current limits and troubleshooting

- Windows x64 only.
- The installer is unsigned and may trigger a Windows warning.
- Codex and WorkBuddy AI are the only built-in adapters.
- No cross-device cloud sync or automatic updater yet.
- If a task has not appeared after 20 seconds, confirm that the interaction produced a real local artifact, then inspect **AI Tool Connections**.
- If an artifact cannot open, confirm that it still exists and try its containing folder.
- If a task remains running, check that the adapter is still connected. When completion cannot be proven, RunLit reports interrupted or unknown instead of inventing success.

See the [detailed English guide](user-guide.en.md) for full troubleshooting.

---

## Support and licensing / 反馈与许可

- [GitHub Issues](https://github.com/Evelyn-Limoon/runlit-desktop/issues)
- [Security policy / 安全政策](../SECURITY.md)
- [Privacy policy / 隐私政策](../PRIVACY.md)
- [Code signing policy / 代码签名政策](code-signing-policy.md)
- [MIT License](../LICENSE)

Provider names and marks identify observed task sources and do not imply sponsorship, endorsement, or an official relationship with RunLit. AI 工具名称与标志仅用于标识任务来源，不代表相关品牌赞助、认可 RunLit，或与 RunLit 存在官方合作关系。
