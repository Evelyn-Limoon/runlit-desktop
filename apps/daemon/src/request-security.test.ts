import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { bearerToken, loadOrCreateAuthToken, queryToken, requestIsTrusted, websocketIsTrusted } from "./request-security.js";

test("creates and reuses an installation-scoped auth token", () => {
  const root = join(tmpdir(), `runlit-auth-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  const path = join(root, "auth-token");
  try {
    const first = loadOrCreateAuthToken(path);
    const second = loadOrCreateAuthToken(path);
    assert.match(first, /^[a-f0-9]{64}$/);
    assert.equal(second, first);
    assert.equal(readFileSync(path, "utf8").trim(), first);
    assert.equal(existsSync(path), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("trusts the RunLit UI origin and requires a bearer token for originless clients", () => {
  const token = "a".repeat(64);
  assert.equal(requestIsTrusted({ headers: { origin: "https://tauri.localhost" } }, token), true);
  assert.equal(requestIsTrusted({ headers: {} }, token), false);
  assert.equal(requestIsTrusted({ headers: { origin: "https://example.com" } }, token), false);
  assert.equal(requestIsTrusted({ headers: { authorization: `Bearer ${token}` } }, token), true);
  assert.equal(requestIsTrusted({ headers: { authorization: "Bearer wrong" } }, token), false);
  assert.equal(bearerToken({ headers: { authorization: `bearer ${token}` } }), token);
});

test("protects WebSocket snapshots with an allowed origin or token", () => {
  const token = "b".repeat(64);
  assert.equal(websocketIsTrusted({ headers: { origin: "http://tauri.localhost" }, url: "/events" }, token), true);
  assert.equal(websocketIsTrusted({ headers: { origin: "https://example.com" }, url: "/events" }, token), false);
  assert.equal(websocketIsTrusted({ headers: {}, url: `/events?token=${token}` }, token), true);
  assert.equal(websocketIsTrusted({ headers: {}, url: "/events?token=wrong" }, token), false);
  assert.equal(queryToken({ url: `/events?token=${token}` }), token);
});
