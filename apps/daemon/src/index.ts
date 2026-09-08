import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRunlitEvent } from "@runlit/protocol";
import { WebSocketServer, WebSocket } from "ws";
import { RunlitDatabase, type RunlitMode } from "./database.js";
import { CodexAppServerAdapter } from "./codex-app-server.js";
import { AdapterManager, type AdapterStatus } from "./adapter.js";
import { WorkBuddyLocalStoreAdapter } from "./workbuddy-local-store.js";
import { SettingsStore } from "./settings.js";
import { GenericFolderAdapter, validateGenericFolderConfig } from "./generic-folder-adapter.js";
import { allowedRunlitOrigins, loadOrCreateAuthToken, requestIsTrusted, websocketIsTrusted } from "./request-security.js";

const HOST = "127.0.0.1";
const PORT = Number(process.env.RUNLIT_PORT ?? 47831);
const moduleDirectory = typeof __dirname === "string" ? __dirname : dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(moduleDirectory, "../../..");
const dataDir = resolve(process.env.RUNLIT_DATA_DIR ?? join(repositoryRoot, ".runlit"));
const mode: RunlitMode = process.env.RUNLIT_MODE === "demo" ? "demo" : "normal";
mkdirSync(dataDir, { recursive: true });
const authToken = process.env.RUNLIT_AUTH_TOKEN?.trim() || loadOrCreateAuthToken(join(dataDir, "auth-token"));
const planCandidate = resolve(repositoryRoot, "runlit_build_plan.md");
const databaseFile = mode === "demo" ? "runlit-demo-v2.db" : "runlit-v2.db";
const database = new RunlitDatabase(join(dataDir, databaseFile), {
  mode,
  planPath: mode === "demo" && existsSync(planCandidate) ? planCandidate : undefined,
});
const settingsStore = new SettingsStore(join(dataDir, "settings.json"));
const codexAdapterEnabled = mode === "normal" && process.env.RUNLIT_CODEX_ADAPTER !== "0";
const workBuddyAdapterEnabled = mode === "normal" && process.env.RUNLIT_WORKBUDDY_ADAPTER !== "0";
const adapterManager = new AdapterManager();
const disabledAdapters: Record<string, AdapterStatus> = {
  codex: { id: "codex", provider: "codex", displayName: "Codex", enabled: false, state: "disabled", connectionMode: "app_server" },
  workbuddy: { id: "workbuddy", provider: "workbuddy", displayName: "WorkBuddy AI", enabled: false, state: "disabled", connectionMode: "local_store" },
};

function adapterStatuses() {
  return { ...disabledAdapters, ...adapterManager.statuses() };
}

function pathKey(value?: unknown) {
  return typeof value === "string" ? resolve(value).toLowerCase() : "";
}

function ensureUniqueWatchPath(watchPath: string, exceptId?: string) {
  const duplicate = Object.values(adapterStatuses()).find((status) => status.id !== exceptId
    && status.connectionMode === "generic" && pathKey(status.dataPath) === pathKey(watchPath));
  if (duplicate) throw new Error(`该成果目录已由“${duplicate.displayName}”监控`);
}

function uniqueCustomAdapterId(baseId: string) {
  if (!adapterManager.has(baseId)) return baseId;
  let suffix = 2;
  while (adapterManager.has(`${baseId}-${suffix}`)) suffix += 1;
  return `${baseId}-${suffix}`;
}

function cors(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;
  if (origin && allowedRunlitOrigins.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Headers", "authorization,content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
}

function sendJson(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

async function readBody(req: IncomingMessage) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error("Request body exceeds 1 MB");
  }
  return JSON.parse(body || "null") as unknown;
}

const server = createServer(async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") {
    if (!requestIsTrusted(req, authToken)) return sendJson(res, 403, { error: "Origin or token not allowed" });
    return void res.writeHead(204).end();
  }
  if (req.method === "GET" && req.url === "/health") return sendJson(res, 200, { ok: true, service: "runlit-daemon", mode });
  if (!requestIsTrusted(req, authToken)) return sendJson(res, 401, { error: "RunLit authorization required" });
  if (req.method === "GET" && req.url === "/diagnostics") return sendJson(res, 200, {
    mode,
    taskCount: database.taskCount(),
    hiddenTaskCount: database.hiddenTaskCount(),
    observationCount: database.observationCount(),
    candidateCounts: database.candidateCounts(),
    evidenceCounts: database.evidenceCounts(),
    checkpointCount: database.checkpointCount(),
    adapters: adapterStatuses(),
    codexAdapter: adapterStatuses().codex,
  });
  if (req.method === "GET" && req.url === "/adapters") return sendJson(res, 200, adapterStatuses());
  if (req.method === "POST" && req.url === "/adapters") {
    try {
      const draft = validateGenericFolderConfig(await readBody(req));
      ensureUniqueWatchPath(draft.watchPath);
      const config = { ...draft, id: uniqueCustomAdapterId(draft.id) };
      const adapter = new GenericFolderAdapter(config, database, broadcast);
      adapterManager.register(adapter);
      settingsStore.saveAdapter(config.id, config);
      await adapter.start();
      broadcast();
      return sendJson(res, 201, { created: true, status: { ...adapter.status } });
    } catch (error) {
      return sendJson(res, 400, { created: false, error: error instanceof Error ? error.message : "新增 AI 工具失败" });
    }
  }
  const customAdapterUpdateMatch = req.url?.match(/^\/adapters\/(custom-[a-z0-9_-]+)$/);
  if (req.method === "PUT" && customAdapterUpdateMatch) {
    try {
      const id = customAdapterUpdateMatch[1]!;
      if (!adapterManager.has(id)) return sendJson(res, 404, { updated: false, error: "未找到该 AI 工具接入" });
      const config = validateGenericFolderConfig(await readBody(req), { id });
      ensureUniqueWatchPath(config.watchPath, id);
      await adapterManager.unregister(id);
      database.clearAdapterCheckpoint(id);
      const adapter = new GenericFolderAdapter(config, database, broadcast);
      adapterManager.register(adapter);
      settingsStore.saveAdapter(id, config);
      await adapter.start();
      broadcast();
      return sendJson(res, 200, { updated: true, status: { ...adapter.status } });
    } catch (error) {
      return sendJson(res, 400, { updated: false, error: error instanceof Error ? error.message : "更新 AI 工具失败" });
    }
  }
  const adapterRefreshMatch = req.url?.match(/^\/adapters\/([a-z0-9_-]+)\/refresh$/);
  if (req.method === "POST" && adapterRefreshMatch) {
    try {
      await adapterManager.refresh(adapterRefreshMatch[1]);
      broadcast();
      return sendJson(res, 200, { refreshed: true, adapters: adapterStatuses() });
    } catch (error) {
      return sendJson(res, 404, { refreshed: false, error: error instanceof Error ? error.message : "Adapter refresh failed" });
    }
  }
  const adapterConfigureMatch = req.url?.match(/^\/adapters\/([a-z0-9_-]+)\/configure$/);
  if (req.method === "POST" && adapterConfigureMatch) {
    try {
      const config = await readBody(req);
      if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Invalid adapter configuration");
      const id = adapterConfigureMatch[1]!;
      const status = await adapterManager.configure(id, config as Record<string, unknown>);
      settingsStore.saveAdapter(id, config as Record<string, unknown>);
      broadcast();
      return sendJson(res, 200, { configured: true, status });
    } catch (error) {
      return sendJson(res, 400, { configured: false, error: error instanceof Error ? error.message : "Adapter configuration failed" });
    }
  }
  const adapterDeleteMatch = req.url?.match(/^\/adapters\/(custom-[a-z0-9_-]+)$/);
  if (req.method === "DELETE" && adapterDeleteMatch) {
    try {
      const id = adapterDeleteMatch[1]!;
      await adapterManager.unregister(id);
      settingsStore.removeAdapter(id);
      database.clearAdapterCheckpoint(id);
      broadcast();
      return sendJson(res, 200, { removed: true, adapters: adapterStatuses() });
    } catch (error) {
      return sendJson(res, 404, { removed: false, error: error instanceof Error ? error.message : "移除 AI 工具失败" });
    }
  }
  if (req.method === "GET" && req.url === "/candidates") return sendJson(res, 200, { candidates: database.candidates() });
  if (req.method === "GET" && req.url === "/artifact-evidence") return sendJson(res, 200, { evidence: database.artifactEvidence() });
  if (req.method === "GET" && req.url === "/adapter-checkpoints") return sendJson(res, 200, { checkpoints: database.adapterCheckpoints() });
  if (req.method === "GET" && req.url === "/snapshot") return sendJson(res, 200, database.snapshot());
  const taskDeleteMatch = req.url?.match(/^\/tasks\/([^/?]+)$/);
  if (req.method === "DELETE" && taskDeleteMatch) {
    try {
      const taskId = decodeURIComponent(taskDeleteMatch[1]!);
      if (!database.hideTask(taskId)) return sendJson(res, 404, { hidden: false, error: "Task not found or already hidden" });
      const snapshot = database.snapshot();
      broadcast();
      return sendJson(res, 200, { hidden: true, snapshot });
    } catch {
      return sendJson(res, 400, { hidden: false, error: "Invalid task id" });
    }
  }
  if (req.method === "POST" && req.url === "/shutdown") {
    sendJson(res, 202, { accepted: true });
    setImmediate(shutdown);
    return;
  }
  if (req.method === "POST" && req.url === "/events") {
    try {
      const event = parseRunlitEvent(await readBody(req));
      const result = database.apply(event);
      if (!result.duplicate) broadcast();
      return sendJson(res, 202, result);
    } catch (error) {
      return sendJson(res, 400, { accepted: false, error: error instanceof Error ? error.message : "Invalid event" });
    }
  }
  return sendJson(res, 404, { error: "Not found" });
});

const sockets = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const path = new URL(req.url ?? "/", `http://${HOST}:${PORT}`).pathname;
  if (path !== "/events" || !websocketIsTrusted(req, authToken)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(req, socket, head, (client) => sockets.emit("connection", client, req));
});

function broadcast() {
  const message = JSON.stringify({ type: "snapshot", payload: database.snapshot() });
  for (const client of sockets.clients) if (client.readyState === WebSocket.OPEN) client.send(message);
}

sockets.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "snapshot", payload: database.snapshot() }));
});

server.listen(PORT, HOST, () => {
  console.log(`Runlit daemon listening on http://${HOST}:${PORT}`);
  console.log(`Mode: ${mode}; data: ${join(dataDir, databaseFile)}`);
  if (codexAdapterEnabled) {
    adapterManager.register(new CodexAppServerAdapter(database, broadcast));
  }
  if (workBuddyAdapterEnabled) {
    const configured = settingsStore.adapter("workbuddy");
    adapterManager.register(new WorkBuddyLocalStoreAdapter(
      database,
      broadcast,
      undefined,
      undefined,
      typeof configured.dataPath === "string" ? configured.dataPath : undefined,
    ));
  }
  for (const { config } of settingsStore.adapters()) {
    if (config.kind !== "folder_watch") continue;
    try {
      const custom = validateGenericFolderConfig(config, { requireExistingPath: false });
      if (!adapterManager.has(custom.id)) adapterManager.register(new GenericFolderAdapter(custom, database, broadcast));
    } catch (error) {
      console.error(`Ignoring invalid custom adapter: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  void adapterManager.startAll();
});

function shutdown() {
  adapterManager.stopAll();
  sockets.close();
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
