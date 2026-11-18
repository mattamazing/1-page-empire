import { fail, json, listUsers, openStore, readJson, requireUser, youtubeId } from "./outlier-lib.mjs";

export const config = { path: "/outlier/api/swipe" };

const STEAL = new Set(["title", "thumbnail", "both"]);

async function listAll() {
  const store = openStore("outlier-swipe");
  const listed = await store.list();
  const rows = [];
  for (const blob of listed.blobs || []) {
    const row = await store.get(blob.key, { type: "json" });
    if (row) rows.push(row);
  }
  rows.sort((a, b) => String(b.saved_at).localeCompare(String(a.saved_at)));
  return { store, rows };
}

async function fromUrl(url) {
  const id = youtubeId(url);
  if (!id) return null;
  const watch = `https://www.youtube.com/watch?v=${id}`;
  let title = "";
  let channel = "";
  try {
    const response = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`);
    if (response.ok) {
      const payload = await response.json();
      title = String(payload.title || "");
      channel = String(payload.author_name || "");
    }
  } catch {
    /* title stays blank; the card still keeps the URL */
  }
  return {
    video_id: id,
    url: watch,
    title,
    channel,
    poster: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  };
}

export default async function handler(req) {
  const gate = await requireUser(req);
  if (gate.error) return gate.error;
  const email = gate.session.user.email;
  const admin = gate.session.user.role === "admin";
  if (req.method === "GET") {
    const { rows } = await listAll();
    const names = new Map((await listUsers()).map((user) => [String(user.email).toLowerCase(), String(user.name || "").trim()]));
    return json({ items: rows.map((row) => ({ ...row, name: names.get(String(row.email).toLowerCase()) || "" })) });
  }
  const body = await readJson(req);
  if (req.method === "POST") {
    const steal = String((body && body.steal) || "both");
    if (!STEAL.has(steal)) return fail(400, "Choose title, thumbnail, or both.");
    let card = body && body.card ? body.card : null;
    if (body && body.url && !card) {
      card = await fromUrl(body.url);
      if (!card) return fail(400, "Use a youtube.com/watch or youtu.be link.");
    }
    if (!card || !(card.video_id || card.id)) return fail(400, "Missing video.");
    const videoId = String(card.video_id || card.id);
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const poster = String(card.poster || "");
    const row = {
      id,
      email,
      video_id: videoId,
      url: String(card.url || `https://www.youtube.com/watch?v=${videoId}`),
      title: String(card.title || "").slice(0, 300),
      channel: String(card.channel || card.creator || "").slice(0, 120),
      poster: poster.startsWith("https://i.ytimg.com/") || poster.length < 180000 ? poster : "",
      steal,
      note: String((body && body.note) || "").slice(0, 2000),
      saved_at: new Date().toISOString(),
    };
    await openStore("outlier-swipe").setJSON(id, row);
    return json({ item: row }, 201);
  }
  const id = String((body && body.id) || "");
  if (!id) return fail(400, "Missing item.");
  const store = openStore("outlier-swipe");
  const existing = await store.get(id, { type: "json" });
  if (!existing) return fail(404, "That packaging note is gone.");
  const owns = existing.email === email;
  if (req.method === "DELETE") {
    if (!owns && !admin) return fail(403, "You can only delete your own packaging notes.");
    await store.delete(id);
    return json({ ok: true });
  }
  if (req.method === "PATCH") {
    if (!owns) return fail(403, "You can only edit your own packaging notes.");
    const steal = body.steal ? String(body.steal) : existing.steal;
    if (!STEAL.has(steal)) return fail(400, "Choose title, thumbnail, or both.");
    const row = {
      ...existing,
      steal,
      note: body.note == null ? existing.note : String(body.note).slice(0, 2000),
    };
    await store.setJSON(id, row);
    return json({ item: row });
  }
  return fail(405, "Use GET, POST, PATCH, or DELETE.");
}
