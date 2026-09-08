import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";

export const allowedRunlitOrigins = new Set([
  "http://localhost:1420",
  "http://127.0.0.1:1420",
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
]);

export function loadOrCreateAuthToken(path: string) {
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf8").trim();
    if (/^[a-f0-9]{64}$/i.test(existing)) return existing;
  }

  const token = randomBytes(32).toString("hex");
  writeFileSync(path, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* Windows ACLs inherit from the per-user data directory. */ }
  return token;
}

function equalToken(candidate: string | undefined, expected: string) {
  if (!candidate) return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function bearerToken(req: Pick<IncomingMessage, "headers">) {
  const header = req.headers.authorization;
  if (typeof header !== "string") return undefined;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

export function queryToken(req: Pick<IncomingMessage, "url">) {
  try {
    return new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("token") ?? undefined;
  } catch {
    return undefined;
  }
}

export function requestIsTrusted(req: Pick<IncomingMessage, "headers">, authToken: string) {
  const origin = req.headers.origin;
  if (typeof origin === "string" && allowedRunlitOrigins.has(origin)) return true;
  return equalToken(bearerToken(req), authToken);
}

export function websocketIsTrusted(req: Pick<IncomingMessage, "headers" | "url">, authToken: string) {
  const origin = req.headers.origin;
  if (typeof origin === "string" && allowedRunlitOrigins.has(origin)) return true;
  return equalToken(queryToken(req), authToken) || equalToken(bearerToken(req), authToken);
}
