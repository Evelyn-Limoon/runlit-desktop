# Release preflight gates

RunLit turns recurring release failures into executable gates. A release is not
ready because a checklist was read; it is ready when the owning command or CI
job passes on a clean runner.

## Local repository gate

Run this from a clean checkout before creating a tag:

```text
npm ci
npm run preflight:release
npm test
npm run build
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

`preflight:release` validates the workflow policy itself. Dependency reuse is
limited to npm's cache keyed by `package-lock.json`. Installers, AppImages,
Debian packages, checksums, logs, databases, local RunLit state, and auth tokens
must not be placed in a dependency cache. Packages intended for inspection or
delivery use GitHub Actions build artifacts instead.

## Automated package gates

| Risk | Executable evidence | Pass condition |
| --- | --- | --- |
| Dirty user profile masks a defect | `Windows build` clean-runner smoke | No RunLit process, install directory, data directory, or listener on `127.0.0.1:47831` exists before install |
| Codex Desktop layout changes | daemon unit tests | Both legacy `.../Codex/bin/codex.exe` and versioned `.../Codex/bin/<build>/codex.exe` resolve |
| Codex is not installed | Windows installed-app smoke | RunLit daemon remains healthy and reports the Codex adapter as `unavailable` |
| Exit leaves the daemon behind | package launch smoke | `/shutdown` succeeds and port `47831` becomes unavailable within 10 seconds |
| Installer is incomplete | Windows installed-app smoke | Silent install creates the executable and uninstaller |
| Uninstall leaves the program installed | Windows installed-app smoke | Silent uninstall succeeds, removes the executable, and does not rebind the daemon port |
| Linux package cannot launch | `Linux build` package smoke | Installed `.deb` and AppImage each start their bundled daemon in an isolated headless desktop session |

The Windows smoke is implemented by `scripts/windows-release-smoke.ps1` so the
same behavior is exercised by branch builds and tag releases. It uses only the
ephemeral GitHub runner profile; never run it on a profile containing a RunLit
installation or data you need to keep.

## Still manual before a stable release

- Verify both Windows installer formats on a disposable Windows x64 account.
- Verify the `.deb` and AppImage on supported clean Linux desktops, including a
  desktop that exposes a compatible notification-area host.
- Exercise the visible tray `Exit RunLit` command and relaunch once. CI directly
  validates daemon shutdown and port release; it does not pretend to click the
  native tray menu.
- Review generated release notes, signatures, checksums, and downloadable assets.
- Confirm no credentials, personal paths, real task data, or provider session IDs
  are present in the public diff or Git history.

Record the workflow URL, commit or tag, exact pass/fail state, and any skipped
manual item in the release notes. A previous workflow run is historical evidence,
not proof for a later commit.
