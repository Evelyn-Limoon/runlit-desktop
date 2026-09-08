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
6. Confirm the requirements in [`code-signing-policy.md`](code-signing-policy.md).
   A stable release requires SignPath Foundation signing. An unsigned build must
   use a hyphenated preview tag and state that it is unsigned.

## Publish

Create and push an annotated tag in the form `vX.Y.Z` for a signed production
release or `vX.Y.Z-preview.N` for an unsigned preview. The `Windows release`
workflow checks out the exact tag and builds the MSI and NSIS installers.

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

1. Download both assets from the Release page and verify their SHA-256 values.
2. For a stable release, run `Get-AuthenticodeSignature` on both assets and
   confirm `Valid` status and the approved SignPath Foundation signer.
3. Install each package on a clean Windows x64 test account.
4. Launch RunLit; verify the tray/orb appears and the local daemon responds.
5. Verify an installed application exits cleanly and can restart.
6. Ensure the release notes state supported adapters, platform scope, signing
   status, and known limitations.

Do not publish the internal real-data integration plan or local test databases.
Before the first public push, scan the entire public history for usernames,
absolute developer paths, provider session IDs, credentials, and real task data.
