import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { SettingsStore } from "./settings.js";

test("persists and removes a custom adapter configuration", () => {
  const root = join(tmpdir(), `runlit-settings-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  const path = join(root, "settings.json");
  try {
    new SettingsStore(path).saveAdapter("custom-kimi", { kind: "folder_watch", provider: "kimi", watchPath: "C:\\outputs" });
    const restored = new SettingsStore(path);
    assert.equal(restored.adapter("custom-kimi").provider, "kimi");
    assert.equal(restored.adapters().length, 1);
    restored.removeAdapter("custom-kimi");
    assert.equal(new SettingsStore(path).adapters().length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
