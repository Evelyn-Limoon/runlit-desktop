import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { RunlitDatabase } from "./database.js";
import { GenericFolderAdapter, validateGenericFolderConfig } from "./generic-folder-adapter.js";

test("validates a portable custom folder adapter configuration", () => {
  const root = join(tmpdir(), `runlit-custom-config-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  try {
    assert.deepEqual(validateGenericFolderConfig({ displayName: "Kimi", provider: "kimi", watchPath: root }), {
      kind: "folder_watch", id: "custom-kimi", provider: "kimi", displayName: "Kimi", watchPath: root,
    });
    assert.deepEqual(validateGenericFolderConfig({ displayName: "Another AI", watchPath: root }, { id: "custom-another-ai-2" }), {
      kind: "folder_watch", id: "custom-another-ai-2", provider: "another-ai", displayName: "Another AI", watchPath: root,
    });
    assert.throws(() => validateGenericFolderConfig({ displayName: "Bad", provider: "../bad", watchPath: root }), /Provider ID/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("keeps a moved folder connection loadable so the user can repair it", async () => {
  const missing = join(tmpdir(), `runlit-moved-folder-${Date.now()}`);
  const config = validateGenericFolderConfig({
    kind: "folder_watch", id: "custom-kimi", displayName: "Kimi", provider: "kimi", watchPath: missing,
  }, { requireExistingPath: false });
  const database = new RunlitDatabase(":memory:", { mode: "normal" });
  const adapter = new GenericFolderAdapter(config, database, () => undefined, 60_000, 0);
  try {
    await adapter.start();
    assert.equal(adapter.status.state, "error");
    assert.match(adapter.status.lastError ?? "", /no such file|找不到|不存在/i);
  } finally {
    adapter.stop();
    database.close();
  }
});

test("creates one completed version for one stable local output batch", async () => {
  const root = join(tmpdir(), `runlit-custom-adapter-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "existing.md"), "# existing\n", "utf8");
  const database = new RunlitDatabase(":memory:", { mode: "normal" });
  const config = validateGenericFolderConfig({ displayName: "Kimi", provider: "kimi", watchPath: root });
  const adapter = new GenericFolderAdapter(config, database, () => undefined, 60_000, 0);
  try {
    await adapter.start();
    assert.equal(database.snapshot().tasks.length, 0);
    writeFileSync(join(root, "result.md"), "# result\n", "utf8");
    await adapter.refresh();
    const tasks = database.snapshot().tasks;
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.provider, "kimi");
    assert.equal(tasks[0]?.status, "completed");
    assert.equal(tasks[0]?.versions.length, 1);
    assert.equal(tasks[0]?.versions[0]?.artifacts[0]?.target, join(root, "result.md"));
  } finally {
    adapter.stop();
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
