import { readFileSync } from "node:fs";

const workflows = [
  ".github/workflows/windows-build.yml",
  ".github/workflows/windows-release.yml",
  ".github/workflows/linux-build.yml",
  ".github/workflows/linux-release.yml",
  ".github/workflows/security-audit.yml",
];
const packageWorkflows = workflows.slice(0, 4);
const forbiddenCachePaths = /(?:\.runlit|auth-token|runlit-v2\.db|appdata|release-output|release-input|target\/release\/bundle)/i;

for (const path of workflows) {
  const text = readFileSync(path, "utf8");
  if (!/cache:\s*npm/.test(text) || !/cache-dependency-path:\s*package-lock\.json/.test(text)) {
    throw new Error(`${path}: dependency caching must be npm-only and keyed by package-lock.json`);
  }
  if (/uses:\s*actions\/cache@/i.test(text)) {
    const cacheBlocks = text.split(/(?=\n\s*-\s+(?:name:|uses:))/);
    for (const block of cacheBlocks) {
      if (/actions\/cache@/i.test(block) && forbiddenCachePaths.test(block)) {
        throw new Error(`${path}: caches must never contain RunLit data, tokens, databases, or release bundles`);
      }
    }
  }
}

for (const path of packageWorkflows) {
  const text = readFileSync(path, "utf8");
  if (!/actions\/upload-artifact@v4/.test(text)) {
    throw new Error(`${path}: distributable packages must be uploaded as build artifacts`);
  }
  if (!/npm run preflight:release/.test(text)) {
    throw new Error(`${path}: release policy preflight is missing`);
  }
}

for (const path of [".github/workflows/windows-build.yml", ".github/workflows/windows-release.yml"]) {
  const text = readFileSync(path, "utf8");
  if (!/windows-release-smoke\.ps1/.test(text)) {
    throw new Error(`${path}: clean Windows install/uninstall preflight is missing`);
  }
}

console.log("Release workflow policy: dependency caches and build artifacts are correctly separated.");
