# Cross-platform release process

This document describes the release workflow for RunLit maintainers.

## Before creating a tag

1. Set the same version in the root package metadata and Tauri configuration.
2. Update `CHANGELOG.md` with user-visible changes and known limitations.
3. Run `npm ci`, `npm run preflight:release`, `npm test`, `npm run build`,
   `cargo test`, `npm audit`, and `cargo audit` on a clean checkout. Follow the
   executable gates in [`release-preflight.md`](release-preflight.md).
4. Confirm the native Windows bundles build and the clean-runner preflight passes,
   including missing-Codex fallback, daemon port release, install, and uninstall.
5. Confirm the Linux `.deb` and `.AppImage` bundles build on Ubuntu 22.04, the
   packaged files are valid, and the AppImage starts its bundled daemon in a
   clean headless desktop session.
6. Review dependencies, third-party notices, and the public-repository diff for
   credentials or local data.
7. Confirm the requirements in [`code-signing-policy.md`](code-signing-policy.md).
   A stable release requires SignPath Foundation signing. An unsigned build must
   use a hyphenated preview tag and state that it is unsigned.

## Publish

Create and push an annotated tag in the form `vX.Y.Z` for a signed production
release or `vX.Y.Z-preview.N` for an unsigned preview. The `Windows release`
workflow checks out the exact tag and builds the MSI and NSIS installers. The
`Linux release` workflow builds the Debian package and AppImage, launches the
AppImage for a daemon health check, and adds the Linux assets to the same GitHub
Release.

For a stable tag, the workflow submits the GitHub Actions artifact to SignPath,
waits for approval and signing, verifies the returned Authenticode signatures,
then writes `SHA256SUMS.txt`. A stable release fails closed if the SignPath
configuration or valid signatures are missing. Preview tags skip SignPath and
remain explicitly unsigned. Tags containing a hyphen are marked as pre-releases.

After SignPath approval, configure these repository values:

| Kind | Name | Value |
| --- | --- | --- |
| Actions secret | `SIGNPATH_API_TOKEN` | CI-user token created in SignPath |
| Actions variable | `SIGNPATH_ORGANIZATION_ID` | SignPath organization UUID |
| Actions variable | `SIGNPATH_PROJECT_SLUG` | RunLit project slug |
| Actions variable | `SIGNPATH_SIGNING_POLICY_SLUG` | Approved release policy slug |
| Actions variable | `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | Approved Windows artifact configuration slug |

The signed-artifact action is pinned in the workflow. Update that commit only
after reviewing an official SignPath release.

## Verify the release

1. Download all Windows and Linux packages from the Release page and verify
   `SHA256SUMS.txt` and `SHA256SUMS-linux.txt` independently.
2. For a stable release, run `Get-AuthenticodeSignature` on both Windows assets and
   confirm `Valid` status and the approved SignPath Foundation signer.
3. Install the Setup and MSI packages on a clean Windows x64 test account.
4. Install the `.deb` on a supported Debian/Ubuntu x64 environment and launch the
   AppImage on a clean Ubuntu x64 desktop.
5. Launch RunLit; verify the orb appears and the local daemon responds. Verify the
   notification-area menu where the desktop environment provides a compatible
   StatusNotifier host.
6. Verify an installed application exits cleanly and can restart.
7. Ensure the release notes state supported adapters, platform scope, signing
   status, and known limitations.

Do not publish the internal real-data integration plan or local test databases.
Before the first public push, scan the entire public history for usernames,
absolute developer paths, provider session IDs, credentials, and real task data.
