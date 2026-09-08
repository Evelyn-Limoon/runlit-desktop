# Windows release process

This document describes the release workflow for RunLit maintainers.

## Before creating a tag

1. Set the same version in the root package metadata and Tauri configuration.
2. Update `CHANGELOG.md` with user-visible changes and known limitations.
3. Run `npm ci`, `npm test`, `npm run build`, `cargo test`, `npm audit`, and
   `cargo audit` on a clean checkout.
4. Confirm the native Windows bundle builds, its bundled daemon health check
   passes, and the installer succeeds on a clean Windows runner.
5. Review dependencies, third-party notices, and the public-repository diff for
   credentials or local data.
6. Decide whether the installers are code-signed. If they are not signed, label
   the release as an unsigned development preview in its release notes.

## Publish

Create and push an annotated tag in the form `vX.Y.Z`. The `Windows release`
workflow builds the MSI and NSIS installers, writes `SHA256SUMS.txt`, and creates
a GitHub Release for the tag.

## Verify the release

1. Download both assets from the Release page and verify their SHA-256 values.
2. Install each package on a clean Windows x64 test account.
3. Launch RunLit; verify the tray/orb appears and the local daemon responds.
4. Verify an installed application exits cleanly and can restart.
5. Ensure the release notes state supported adapters, platform scope, signing
   status, and known limitations.

Do not publish the internal real-data integration plan or local test databases.
Before the first public push, scan the entire public history for usernames,
absolute developer paths, provider session IDs, credentials, and real task data.
