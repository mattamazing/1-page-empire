import { gunzipSync } from "node:zlib";
import { bundleBytes, fail, json, listUsers, openStore, readJson, requireUser, rowsFromStore, saveKey, writeRows } from "./outlier-lib.mjs";

export const config = { path: "/outlier/api/saves" };

function finiteOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function catalogItem(platform, id) {
  try {
    const raw = await openStore("outlier-data").get("bundle", { type: "arrayBuffer" });
    if (!raw) return null;
    const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw);
    const packed = bundleBytes(bytes);
    const text = new TextDecoder().decode(packed.gzip ? gunzipSync(packed.bytes) : packed.bytes);
    const data = JSON.parse(text);
    const ig = data.ig || {};
    const yt = data.yt || {};
    const pools = platform === "ig"
      ? [...(ig.picks || []), ...(ig.history || []).flatMap((group) => group.picks || []), ...(ig.explore || []), ...(ig.inspire || [])]
      : [...(yt.mine || []), ...(yt.peers || []), ...(yt.broad || []), ...(yt.big || [])];
    return pools.find((item) => item && item.id === id) || null;
  } catch {
    return null;
  }
}

function metric(row, snap, key) {
  const value = finiteOrNull(row ? row[key] : snap[key]);
  return value === 0 ? null : value;
}

async function snapshotOf(body, platform, itemId) {
  const snap = body.snapshot || {};
  const row = await catalogItem(platform, itemId);
  const clientPoster = typeof snap.poster === "string" && snap.poster.length < 180000 ? snap.poster : "";
  const rowPoster = row && typeof row.poster === "string" && row.poster.length < 180000 ? row.poster : "";
  return {
    title: String((row && row.title) || snap.title || "").slice(0, 300),
    creator: String((row && (row.creator || row.channel)) || snap.creator || "").slice(0, 120),
    url: String((row && row.url) || snap.url || "").slice(0, 500),
    poster: clientPoster || rowPoster || snap.thumb_ref || "",
    thumb_ref: String(snap.thumb_ref || `${platform}:${itemId}`).slice(0, 80),
    views: metric(row, snap, "views"),
    multiplier: metric(row, snap, "multiplier"),
    hook: String((row && row.hook) || snap.hook || "").slice(0, 2000),
  };
}

async function named(rows) {
  const names = new Map((await listUsers()).map((user) => [String(user.email).toLowerCase(), String(user.name || "").trim()]));
  return rows.map((row) => ({ ...row, name: names.get(String(row.email).toLowerCase()) || "" }));
}

export default async function handler(req) {
  const gate = await requireUser(req);
  if (gate.error) return gate.error;
  const email = gate.session.user.email;
  const store = openStore("outlier-saves");
  if (req.method === "GET") {
    const all = (await rowsFromStore(store)).slice().sort((a, b) => String(b.saved_at).localeCompare(String(a.saved_at)));
    const mine = all.filter((row) => row.email === email);
    return json({ saves: await named(all), mine: mine.map((row) => `${row.platform}:${row.item_id}`) });
  }
  const body = await readJson(req);
  const platform = body && body.platform;
  const itemId = String((body && (body.item_id || body.id)) || "");
  if (platform !== "ig" && platform !== "yt") return fail(400, "Pick Instagram or YouTube.");
  if (!itemId) return fail(400, "Missing item.");
  const key = saveKey(email, platform, itemId);
  if (req.method === "DELETE") {
    const existing = await store.get(key, { type: "json" });
    if (existing && existing.email !== email) return fail(403, "That save belongs to someone else.");
    await store.delete(key);
    const rows = (await rowsFromStore(store)).filter((row) => !(row.email === email && row.platform === platform && row.item_id === itemId));
    await writeRows(store, rows);
    return json({ ok: true });
  }
  if (req.method === "PUT" || req.method === "POST") {
    const existing = await store.get(key, { type: "json" });
    const row = {
      email,
      platform,
      item_id: itemId,
      snapshot: await snapshotOf(body || {}, platform, itemId),
      note: String((body && body.note) || "").slice(0, 2000),
      saved_at: (existing && existing.saved_at) || new Date().toISOString(),
    };
    await store.setJSON(key, row);
    const rows = (await rowsFromStore(store)).filter((item) => !(item.email === email && item.platform === platform && item.item_id === itemId));
    rows.push(row);
    await writeRows(store, rows);
    return json({ save: row });
  }
  return fail(405, "Use GET, PUT, or DELETE.");
}
