# Code signing policy

## Current status

RunLit has selected the SignPath Foundation open-source program for future
Windows Authenticode signatures. The application is being prepared for review;
acceptance and a signing certificate have not yet been granted. The existing
`v0.1.0-preview.1` packages remain explicitly unsigned.

Free code signing provided by SignPath.io, certificate by SignPath Foundation.

## Scope

Once the application is approved and the repository signing integration is
enabled, the release policy applies to RunLit's Windows x64 MSI and NSIS
installers. Third-party binaries retain their original signatures and are not
re-signed as RunLit components.

Preview tags such as `v0.1.0-preview.2` may be published unsigned when the
release page clearly identifies them as unsigned previews. A stable tag such as
`v0.1.0` must not be published by the release workflow unless SignPath returns
valid signed artifacts.

## Maintainer roles

- Committer and maintainer: [Evelyn-Limoon](https://github.com/Evelyn-Limoon)
- Reviewer for external contributions: [Evelyn-Limoon](https://github.com/Evelyn-Limoon)
- Release signing approver: [Evelyn-Limoon](https://github.com/Evelyn-Limoon)

Changes submitted by contributors who do not have direct commit access require
review before merge. Before signing is enabled, the maintainer must confirm that
multi-factor authentication is active for both source-repository and SignPath
access, as required by the SignPath Foundation program. No signing credential or
API token is stored in this repository.

## Trusted release flow

1. A maintainer updates version metadata, the changelog, and public limitations.
2. The release is built from the exact tagged commit by GitHub Actions.
3. Tests, application builds, daemon smoke tests, and Windows bundle generation
   must succeed on the clean GitHub-hosted runner.
4. For a stable release, the unsigned installer artifact is submitted from that
   workflow to SignPath using its official GitHub Action and origin verification.
5. The designated approver reviews and approves the signing request in SignPath.
6. The workflow downloads the returned artifacts and verifies their Windows
   Authenticode status and SignPath Foundation signer identity.
7. SHA-256 checksums are generated only after signing. The signed installers and
   their checksums are then attached to the matching GitHub Release.

The workflow pins the SignPath action to a reviewed commit rather than a mutable
branch. The SignPath API token is stored as a GitHub Actions secret. Organization,
project, policy, and artifact-configuration identifiers are stored as GitHub
Actions variables after SignPath approval.

## User verification

After downloading a signed installer, users can inspect the signature with:

```powershell
Get-AuthenticodeSignature .\Runlit_0.1.0_x64-setup.exe |
  Select-Object Status, StatusMessage, @{Name='Signer';Expression={$_.SignerCertificate.Subject}}
```

A production release is accepted only when `Status` is `Valid`, the signer is
the SignPath Foundation certificate assigned to the project, the timestamp is
valid, and the file hash matches the release's `SHA256SUMS.txt`.

## Privacy

See the repository's [`PRIVACY.md`](../PRIVACY.md). RunLit does not upload user
runtime data to the signing service. Only public-source build artifacts from the
release workflow are submitted for code signing.
