import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";
import { getStore as netlifyGetStore } from "@netlify/blobs";

const scrypt = promisify(scryptCb);

export const COOKIE = "outlier_session";
export const YEAR = 60 * 60 * 24 * 365;
export const SCRYPT = { n: 16384, r: 8, p: 1 };
const SLIDE_MS = 12 * 60 * 60 * 1000;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const FAIL_LIMIT = 10;

export function openStore(name) {
  if (typeof globalThis.__OUTLIER_BLOBS === "function") return globalThis.__OUTLIER_BLOBS(name);
  return netlifyGetStore(name, { consistency: "strong" });
}

export async function hashPassword(password, params = SCRYPT) {
  const salt = randomBytes(16);
  const n = params.n || SCRYPT.n;
  const r = params.r || SCRYPT.r;
  const p = params.p || SCRYPT.p;
  const hash = await scrypt(password, salt, 32, { N: n, r, p });
  return { hash: Buffer.from(hash).toString("hex"), salt: salt.toString("hex"), n, r, p };
}

export async function verifyPassword(password, user) {
  if (!user || !user.hash || !user.salt || user.disabled) return false;
  const hash = await scrypt(password, Buffer.from(user.salt, "hex"), 32, {
    N: user.n || SCRYPT.n,
    r: user.r || SCRYPT.r,
    p: user.p || SCRYPT.p,
  });
  const expected = Buffer.from(user.hash, "hex");
  const actual = Buffer.from(hash);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function publicUser(user) {
  if (!user) return null;
  return {
    email: user.email,
    name: user.name || "",
    role: user.role,
    disabled: !!user.disabled,
    created_at: user.created_at || null,
  };
}

export function tokenHash(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

export function newToken() {
  return randomBytes(32).toString("base64url");
}

export function clientIp(req, context) {
  const direct = req.headers.get("x-nf-client-connection-ip");
  if (direct) return direct.trim();
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return (context && context.ip) || "local";
}

export function readCookie(req, name) {
  const header = req.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

export function sessionCookie(token, secure = true) {
  const bits = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/outlier",
    `Max-Age=${YEAR}`,
  ];
  if (secure) bits.push("Secure");
  return bits.join("; ");
}

export function clearCookie(secure = true) {
  const bits = [`${COOKIE}=`, "HttpOnly", "SameSite=Lax", "Path=/outlier", "Max-Age=0"];
  if (secure) bits.push("Secure");
  return bits.join("; ");
}

export function wantsSecure(req) {
  const forwarded = (req.headers.get("x-forwarded-proto") || "").split(",")[0].trim();
  if (forwarded === "https") return true;
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function json(data, status = 200, extra = {}) {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store", ...extra };
  return new Response(JSON.stringify(data), { status, headers });
}

export function fail(status, error) {
  return json({ error }, status);
}

export async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function tooManyFailures(email, ip) {
  const store = openStore("outlier-sessions");
  const key = `fail:${email}|${ip}`;
  const now = Date.now();
  const row = (await store.get(key, { type: "json" })) || { at: [] };
  const recent = (row.at || []).filter((stamp) => now - stamp < FAIL_WINDOW_MS);
  return { limited: recent.length >= FAIL_LIMIT, key, recent, store };
}

export async function noteFailure(state) {
  state.recent.push(Date.now());
  await state.store.setJSON(state.key, { at: state.recent });
}

export async function clearFailures(state) {
  await state.store.delete(state.key);
}

export async function loadSession(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const sessions = openStore("outlier-sessions");
  const key = tokenHash(token);
  const row = await sessions.get(key, { type: "json" });
  if (!row) return null;
  if (row.expires_at && Date.parse(row.expires_at) < Date.now()) {
    await sessions.delete(key);
    return null;
  }
  const users = openStore("outlier-users");
  const user = await users.get(String(row.email || "").toLowerCase(), { type: "json" });
  if (!user || user.disabled) return null;
  let renewed = false;
  const seen = Date.parse(row.last_seen || 0);
  if (!seen || Date.now() - seen > SLIDE_MS) {
    const now = new Date();
    row.last_seen = now.toISOString();
    row.expires_at = new Date(now.getTime() + YEAR * 1000).toISOString();
    await sessions.setJSON(key, row);
    renewed = true;
  }
  return { token, key, row, user, renewed };
}

export async function requireUser(req) {
  const session = await loadSession(req);
  if (!session) return { error: fail(401, "Sign in again.") };
  return { session };
}

export async function requireAdmin(req) {
  const gate = await requireUser(req);
  if (gate.error) return gate;
  if (gate.session.user.role !== "admin") return { error: fail(403, "Admins only.") };
  return gate;
}

export async function listUsers() {
  const store = openStore("outlier-users");
  const listed = await store.list();
  const users = [];
  for (const blob of listed.blobs || []) {
    const user = await store.get(blob.key, { type: "json" });
    if (user) users.push(user);
  }
  users.sort((a, b) => String(a.email).localeCompare(String(b.email)));
  return users;
}

export async function adminCount(exceptEmail = "") {
  const users = await listUsers();
  return users.filter((user) => user.role === "admin" && !user.disabled && user.email !== exceptEmail).length;
}

export function bundleBytes(raw) {
  const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw instanceof Uint8Array ? raw : new Uint8Array(raw || []);
  const gzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  return { bytes, gzip };
}

export function etagFor(bytes) {
  return `"${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}"`;
}

export function encodeBundle(bytes, req) {
  const tag = etagFor(bytes);
  if ((req.headers.get("if-none-match") || "") === tag) {
    return new Response(null, { status: 304, headers: { etag: tag, "cache-control": "private, no-store" } });
  }
  const packed = bundleBytes(bytes);
  const accept = req.headers.get("accept-encoding") || "";
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store",
    etag: tag,
    vary: "accept-encoding",
  };
  if (packed.gzip && accept.includes("gzip")) {
    headers["content-encoding"] = "gzip";
    return new Response(packed.bytes, { headers });
  }
  if (packed.gzip) return new Response(gunzipSync(packed.bytes), { headers });
  if (accept.includes("gzip")) {
    headers["content-encoding"] = "gzip";
    return new Response(gzipSync(packed.bytes), { headers });
  }
  return new Response(packed.bytes, { headers });
}

export function youtubeId(url) {
  const text = String(url || "").trim();
  try {
    const parsed = new URL(text);
    if (parsed.hostname === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0] || "";
      if (/^[A-Za-z0-9_-]{11}$/.test(id)) return id;
    }
    const fromQuery = parsed.searchParams.get("v") || "";
    if (/^[A-Za-z0-9_-]{11}$/.test(fromQuery)) return fromQuery;
  } catch {
    /* fall through */
  }
  return "";
}

export function saveKey(email, platform, id) {
  return `${String(email).toLowerCase()}|${platform}|${id}`;
}
