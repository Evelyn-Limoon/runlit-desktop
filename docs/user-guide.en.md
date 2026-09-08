# RunLit User Guide

> Status: public preview guide
> Current product scope: Windows x64 and Linux x64, Codex and WorkBuddy AI, local-first

[简体中文](user-guide.zh-CN.md) | [Adapter development guide](adapter-development.md)

## 1. What RunLit does

RunLit is a resident Windows and Linux desktop observer and result navigator for AI work. It turns AI sessions that produced verified local changes into task lights and shows:

- which AI tool originated the task;
- whether the task is running, completed, interrupted, or unknown;
- one version for each material user interaction;
- the files, folder, or trusted result URL produced by that interaction.

RunLit does not start or control AI tasks. It does not infer completion from a process being open, an ordinary chat, or a period of silence. A session without enough evidence does not enter the task dock.

## 2. Current support

| AI tool | Connection method | What the user must do | Status |
| --- | --- | --- | --- |
| Codex | Codex App Server and local lifecycle records | Usually nothing; RunLit discovers Codex automatically | Built in |
| WorkBuddy AI | Local session, change, and artifact indexes | Usually automatic; select the data directory if discovery fails | Built in |
| Other AI tools that write local files | Generic artifact-folder monitoring | Enter the tool name and select a dedicated output folder in **AI Tool Connections** | Manual artifact-only connection available |
| Other tools that require precise lifecycle status | A dedicated RunLit Adapter | Install or develop the matching Adapter | Not built in |

Seeing a provider logo does not mean that its data integration is complete. Use the status shown in **AI Tool Connections** as the source of truth.

## 3. Before installation

The current public targets are Windows x64 and Linux x64. Installed builds include the RunLit daemon runtime, so end users do not need to install Node.js, npm, or Rust.

Before using RunLit, install and verify at least one supported AI tool:

- for Codex integration, install Codex Desktop or Codex CLI;
- for WorkBuddy integration, run WorkBuddy at least once so that it creates its local data directory.

RunLit detects tasks from local data and does not need internet access to refresh them. Whether an AI provider requires internet access is determined by that provider.

### Development preview warning

The 0.1.0 Windows development packages are not currently code-signed. Windows may show an Unknown Publisher or SmartScreen warning when they are downloaded through a browser. Linux packages publish SHA-256 checksums but do not yet have a repository signature.

## 4. Install from GitHub

After the public launch, download RunLit only from the repository's **Releases** page, not from a third-party download site.

1. Open the latest RunLit Release.
2. Read the release notes, supported scope, and known issues.
3. Download the package for your system:
   - Windows x64: `Setup.exe` for most users, or `.msi` for managed deployment;
   - Debian/Ubuntu x64: `.deb`;
   - other compatible x64 Linux desktops: portable `.AppImage`.
4. Compare the file with the SHA-256 checksum on the Release page.
5. Install RunLit and launch it from the Windows Start menu or Linux application launcher. For AppImage, run `chmod +x Runlit_*.AppImage` once and then launch the file.

After launch, a draggable circular RunLit orb appears on the desktop. Windows also shows the app in the taskbar and notification area. On Linux, notification-area support depends on the desktop environment and installed StatusNotifier host; the orb remains usable without it.

## 5. Connect an AI tool

### Open the connections page

Use either method:

- right-click the RunLit orb and choose **AI Tool Connections…**;
- right-click the RunLit notification-area icon and choose **AI Tool Connections…**.

The page shows the state, discovered path, latest error, and redetect action for each Adapter.

| State | Meaning | Recommended action |
| --- | --- | --- |
| Connected | The Adapter found its tool or data directory and is observing it | No action required |
| Connecting | RunLit is connecting or performing its first scan | Wait a few seconds |
| Not found | The executable or local data was not found | Check the installation and redetect |
| Connection error | A source was found, but startup or reading failed | Follow the displayed error and troubleshooting guidance |
| Disabled | The Adapter was disabled by startup configuration | Restart with that Adapter enabled |

The installed interface currently uses Chinese state labels: `已连接`, `正在连接`, `未发现`, `连接异常`, and `已关闭`.

### Connect Codex

RunLit searches for Codex in this order:

1. the advanced `RUNLIT_CODEX_PATH` override;
2. Codex on the system `PATH`;
3. on Windows, the current user's Codex Desktop installation directory.

Most installed users do not need to enter a path. If Codex is shown as **Not found**:

1. confirm that Codex Desktop or Codex CLI starts on its own;
2. open **AI Tool Connections…**;
3. choose **Redetect** on the Codex card;
4. if detection still fails, follow the Codex troubleshooting section.

### Connect WorkBuddy AI

RunLit first checks for a `.workbuddy-ai` directory in the current user profile. If automatic discovery fails:

1. open **AI Tool Connections…**;
2. find the WorkBuddy AI card;
3. enter the WorkBuddy data directory, for example `C:\Users\your-name\.workbuddy-ai` on Windows or `/home/your-name/.workbuddy-ai` on Linux;
4. choose **Save and connect**;
5. confirm that the state changes to **Connected**.

The selected directory must contain a `projects` subdirectory. The setting is stored in RunLit's per-user data and is never written into the source repository.

## 6. Make a task appear in the dock

A connected Adapter does not display every conversation. A task needs verifiable work context, execution activity, and artifact evidence before it enters the dock.

Recommended test flow:

1. Open a local project or folder in Codex or WorkBuddy.
2. Request a material local change, such as creating, editing, generating, or exporting a file.
3. Let the AI tool finish the file operation.
4. RunLit scans automatically. Updates usually arrive within a few seconds; the acceptance target is no more than 20 seconds.
5. The new task appears in the task-light dock beside the orb.

The following normally do not create a task light:

- a question-and-answer conversation with no local change or trusted artifact;
- merely opening the AI tool;
- mentioning a file or URL in chat when the Adapter cannot verify it as the result;
- an artifact that was deleted, moved outside the workspace, or cannot be accessed.

## 7. Use task lights and versions

### Open, collapse, and move RunLit

- click the orb to expand RunLit;
- click again or use the interface to collapse it;
- drag the orb to move it;
- drag the expanded window to a screen edge to collapse it into the orb.

### Inspect a task

- click a task light to show its status, version history, and artifacts;
- click **Open source** or **Open project** beside the task heading to enter the original session or project folder;
- click the project path in the footer to open the project directory;
- click the eye button to hide or restore task titles and paths while sharing your screen.

### Understand versions

A RunLit version is not created for every filesystem update. One version is created only when one user interaction materially changes local files, a product, a website, or another task result.

The detail view shows the newest three versions first. Select **Show earlier versions** when you need the full history.

Use the pencil button beside a version summary to replace the generated text with a title that is easier to remember. A title cannot be empty and may use up to about 40 Chinese characters or 80 English characters. The custom title is stored in RunLit's local database and is preserved across later automatic synchronization.

Drag the short handle at the bottom center of the detail window downward to reveal the latest three versions together with the status evidence and project information. RunLit remembers the chosen height; the version area remains scrollable when the screen cannot fit the full panel.

- One artifact: the artifact button opens that file directly.
- Multiple local artifacts from one interaction: **Open folder** on the version card opens their common directory.
- Trusted web result: the result URL opens directly.
- Unverified path or URL: RunLit does not present it as a confirmed result.

### Remove a task light

1. Right-click the task light.
2. Choose **Delete task**.

This only hides the task from the dock. It does not delete the AI conversation, RunLit version history, or local result files. A new running event from the same provider session restores the task with its existing history.

## 8. Refresh, automatic synchronization, and exit

RunLit normally detects new tasks and state changes automatically; manual refresh is not required. The built-in Adapters currently scan about every five seconds by default.

The header distinguishes the local daemon connection from AI-tool health. For example, **2/2 tools healthy** means both enabled tools completed a successful scan during the last 20 seconds. A yellow state means that at least one connection failed or its scan is stale.

If a connection has just changed:

- choose **Redetect** in **AI Tool Connections…**;
- right-click the orb or notification-area icon and choose **Refresh** to reload the interface.

To stop RunLit completely, right-click the orb or notification-area icon and choose **Exit RunLit**. Closing or hiding the window may not stop the background service. The Exit command stops both the desktop application and its local daemon.

## 9. Local data and privacy

RunLit is designed to be local-first. An Adapter should retain only the information required to observe work:

- provider and session identity;
- task title;
- workspace directory;
- start, activity, completion, or interruption state;
- artifact paths or trusted URLs;
- timestamps and evidence strength.

RunLit should not store chat bodies or read browser cookies, passwords, or private login tokens.

The installed application stores its database, settings, local API authorization token, and logs under:

```text
Windows: %LOCALAPPDATA%\com.runlit.desktop
Linux:   ${XDG_DATA_HOME:-$HOME/.local/share}/com.runlit.desktop
```

Development mode uses the repository's `.runlit` directory by default. Removing a task light does not delete this data and does not modify the original Codex, WorkBuddy, or project data.

`auth-token` is only for RunLit and local Adapter access to the localhost service. Do not paste it into chats, logs, or GitHub issues, and never commit it to a repository.

To erase RunLit's local records completely:

1. exit RunLit completely;
2. back up the directory above if needed;
3. delete `%LOCALAPPDATA%\com.runlit.desktop`.

The uninstaller may preserve the user database and logs. Check and remove this directory as well when a complete removal is required.

## 10. Troubleshooting

### RunLit stays on “Waiting for connection”

- choose **Exit RunLit** from the notification area, then restart it;
- check whether another application is using local port `47831`;
- inspect the startup and daemon logs under the platform data directory's `logs` folder.

### Codex is “Not found”

- confirm that Codex runs independently;
- restart Codex and RunLit;
- choose **Redetect** in **AI Tool Connections…**;
- when running from source, set `RUNLIT_CODEX_PATH` to the actual Codex executable if necessary.

Do not hard-code another user's name, drive letter, or Codex version hash into RunLit source code.

### WorkBuddy is “Not found”

- run WorkBuddy at least once;
- select the `.workbuddy-ai` root directory and confirm that it contains `projects`;
- save the path in **AI Tool Connections…** and redetect.

### The Adapter is connected, but no task appears

- confirm that the interaction produced a real local change or artifact;
- wait up to 20 seconds;
- confirm that the artifact still exists inside the workspace and is accessible;
- check the Adapter card for a recent error;
- a chat-only session being excluded is expected behavior.

### A task remains “Running”

- wait up to 20 seconds for the Adapter to observe the end event;
- confirm that the Adapter is still **Connected**;
- choose **Redetect**;
- if the provider exited abnormally, RunLit may show Interrupted or Unknown instead of inventing a Completed state.

### An artifact does not open

- check whether the file was moved or deleted;
- check access permissions for the current operating-system user;
- use **Open folder** on the version card to locate the common folder for multiple results.

## 11. Known limitations

- The current public targets are Windows x64 and Linux x64; macOS and ARM64 are not supported yet.
- Linux notification-area support depends on the desktop environment; the floating orb is always the fallback entry.
- Linux `.deb` and AppImage packages publish checksums but are not repository-signed.
- The only built-in Adapters are Codex and WorkBuddy AI.
- RunLit looks back over the most recent 24 hours of provider sessions by default.
- Provider data-format changes may require an Adapter update.
- RunLit does not infer remote result URLs from ordinary chat text.
- There is no cloud synchronization between computers.
- Until an updater is available, install new versions manually from GitHub Releases.
- Unsigned development builds may trigger Windows security warnings.

## 12. Run from source

Developer prerequisites are Node.js 24+, npm, Rust, and the platform-specific Tauri prerequisites.

```powershell
npm ci
npm run start:runlit
```

On Linux, install the Tauri Linux dependencies and run:

```bash
npm ci
npm run start:runlit:linux
```

Create a desktop shortcut that points to the current checkout:

```powershell
npm run shortcut:install
```

This shortcut points to a repository on the current computer and is not the same as an installed release. End users should prefer the installer from GitHub Releases.

## 13. Report functional and security issues

After the public launch, use GitHub Issues for ordinary functional problems and include:

- the RunLit version;
- the operating-system version and, on Linux, the distribution and desktop environment;
- the AI tool and its version;
- the status shown in **AI Tool Connections…**;
- the time of the problem and reproduction steps;
- only log excerpts from which user names, workspace paths, session IDs, tokens, and chat content have been removed.

Do not open a public Issue containing sensitive vulnerability details. Use the channel specified in the repository's `SECURITY.md` or GitHub private vulnerability reporting.

RunLit source code is licensed under the repository's MIT License. Codex, WorkBuddy, and other provider names and logos identify task sources only and do not imply sponsorship, endorsement, or an official relationship with RunLit.
