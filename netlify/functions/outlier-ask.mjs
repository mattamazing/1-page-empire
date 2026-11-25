import { gunzipSync } from "node:zlib";
import { bundleBytes, bundleSha, fail, json, openStore, readJson, requireUser } from "./outlier-lib.mjs";

export const config = { path: "/outlier/api/ask" };

const TOKEN_BUDGET = 60000;
const DAILY_LIMIT = 60;
const MAX_MESSAGES = 40;
const MODEL_DEFAULT = "claude-sonnet-4-6";

const MATT_RSS = "https://www.youtube.com/feeds/videos.xml?channel_id=UCFzPO1nnclHxjVfGyqtB0vA";
const RSS_TTL_MS = 30 * 60 * 1000;
const STOPWORDS = new Set("a an the of to for in on our me some and with this that it is are be we you your us give based then from by at as or into about them their my i do just not yet how what which who when where why will can get its was were than too very our latest video videos title titles idea ideas please analyze then us".split(" "));

let bundleCache = { sha: "", data: null };
let rssCache = { at: 0, videos: [] };

export function estimateTokens(text) {
  return Math.ceil(String(text || "").length / 4);
}

function clip(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function multipleLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "";
  return `${Math.round(n * 100) / 100}× median`;
}

function dayKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function lineFor(parts) {
  return parts.filter((part) => part != null && part !== "").join("\t");
}

function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'");
}

function xmlValue(entry, pattern) {
  const found = entry.match(pattern);
  return found ? decodeXml(found[1]).trim() : "";
}

export function parseYoutubeRss(xml) {
  const videos = [];
  for (const entry of String(xml || "").split(/<entry\b/i).slice(1)) {
    const title = xmlValue(entry, /<title[^>]*>([\s\S]*?)<\/title>/i).replace(/\s+/g, " ").trim();
    const published = xmlValue(entry, /<published>([^<]*)<\/published>/i);
    const fromId = xmlValue(entry, /<yt:videoId>([^<]+)<\/yt:videoId>/i);
    const link = xmlValue(entry, /<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)
      || xmlValue(entry, /<link[^>]*href=["']([^"']+)["'][^>]*rel=["']alternate["']/i);
    const description = xmlValue(entry, /<media:description[^>]*>([\s\S]*?)<\/media:description>/i).replace(/\s+/g, " ").trim().slice(0, 600);
    const id = fromId || (link.match(/(?:v=|youtu\.be\/|\/shorts\/)([A-Za-z0-9_-]{11})/) || [])[1] || "";
    if (!title && !id) continue;
    videos.push({
      id,
      title,
      published,
      url: link || (id ? `https://www.youtube.com/watch?v=${id}` : ""),
      description,
    });
  }
  videos.sort((a, b) => String(b.published).localeCompare(String(a.published)));
  return videos;
}

export function findYoutubeIds(message) {
  const text = String(message || "");
  const ids = [];
  const patterns = [
    /https?:\/\/(?:www\.)?youtube\.com\/watch\?[^\s]*?\bv=([A-Za-z0-9_-]{11})/gi,
    /https?:\/\/(?:www\.)?youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/gi,
    /https?:\/\/(?:www\.)?youtu\.be\/([A-Za-z0-9_-]{11})/gi,
  ];
  for (const pattern of patterns) {
    let found;
    while ((found = pattern.exec(text))) ids.push(found[1]);
  }
  return [...new Set(ids)];
}

export function contentTokens(text) {
  return (String(text || "").toLowerCase().match(/[a-z0-9$%]+/g) || []).filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

export function patternTags(text) {
  const raw = String(text || "");
  const tags = new Set();
  if (/\d+\s*(?:minutes?|mins?)\b/i.test(raw)) tags.add("minutes");
  if (/learn\s+\d+\s*%/i.test(raw)) tags.add("learn-percent");
  if (/\bmaster\b/i.test(raw)) tags.add("master");
  if (/\bvs\.?\b/i.test(raw)) tags.add("vs");
  if (/\bsteal\b/i.test(raw)) tags.add("steal");
  if (raw.includes("$")) tags.add("dollar");
  if (/how to/i.test(raw)) tags.add("howto");
  if (/\b(claude|grok|chatgpt|gemini|ai)\b/i.test(raw)) tags.add("tool");
  return tags;
}

function isMatt(item, group) {
  if (group === "mine") return true;
  return /matt clark|^matt$/i.test(String(item.channel || item.creator || ""));
}

function catalogItems(bundle) {
  const data = bundle || {};
  const yt = data.yt || {};
  const ig = data.ig || {};
  const items = [];
  const addYt = (list, group) => {
    for (const item of list || []) {
      items.push({
        id: item.id || "",
        title: item.title || "",
        channel: item.channel || item.creator || "",
        matt: isMatt(item, group),
        multiplier: item.multiplier,
        views: item.views,
        published: item.published || "",
        url: item.url || "",
        hook: item.hook || "",
      });
    }
  };
  addYt(yt.mine, "mine");
  addYt(yt.peers, "peers");
  addYt(yt.broad, "broad");
  addYt(yt.big, "big");
  const addIg = (list) => {
    for (const item of list || []) {
      items.push({
        id: item.id || "",
        title: item.hook || item.title || "",
        channel: item.creator || "",
        matt: isMatt(item, "ig"),
        multiplier: item.multiplier,
        views: item.views,
        published: item.published || "",
        url: item.url || "",
        hook: item.hook || item.title || "",
      });
    }
  };
  addIg(ig.picks);
  addIg(ig.candidates);
  addIg(ig.shortlist);
  if (ig.explore) addIg(ig.explore);
  return items;
}

export function rankRelevant(items, question, targetTitle) {
  const queryText = `${question || ""} ${targetTitle || ""}`;
  const queryTokens = new Set(contentTokens(queryText));
  const queryTags = patternTags(queryText);
  const ranked = [];
  for (const item of items) {
    if (item.matt) continue;
    const hay = `${item.title} ${item.hook || ""} ${item.channel || ""}`;
    const overlap = contentTokens(hay).filter((token) => queryTokens.has(token)).length;
    let bonus = 0;
    for (const tag of patternTags(`${item.title} ${item.hook || ""}`)) {
      if (queryTags.has(tag)) bonus += 1;
    }
    const relevance = overlap + bonus;
    if (relevance <= 0) continue;
    const multiplier = Number(item.multiplier);
    const weight = Math.log(Number.isFinite(multiplier) && multiplier > 1 ? multiplier : Math.E);
    ranked.push({ item, score: relevance * weight });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, 25).map((row) => row.item);
}

export function resolveTargetUpload(question, uploads) {
  const list = uploads || [];
  if (!list.length) return null;
  const scored = list.map((video) => ({
    video,
    score: contentTokens(`${video.title} ${video.description || ""}`).filter((token) => new Set(contentTokens(question)).has(token)).length,
  }));
  scored.sort((a, b) => b.score - a.score);
  if (scored[0].score > 0) return scored[0].video;
  if (/\b(latest|newest|this video|our video|the video)\b/i.test(String(question || ""))) return list[0];
  return null;
}

export async function loadRecentUploads(fetchImpl = globalThis.fetch) {
  if (rssCache.videos.length && Date.now() - rssCache.at < RSS_TTL_MS) return rssCache.videos;
  try {
    const response = await fetchImpl(MATT_RSS);
    if (!response.ok) throw new Error("rss");
    const videos = parseYoutubeRss(await response.text());
    rssCache = { at: Date.now(), videos };
    return videos;
  } catch {
    return rssCache.videos || [];
  }
}

async function loadReferenced(message, fetchImpl = globalThis.fetch) {
  const videos = [];
  for (const id of findYoutubeIds(message)) {
    const url = `https://www.youtube.com/watch?v=${id}`;
    try {
      const response = await fetchImpl(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
      if (!response.ok) continue;
      const payload = await response.json();
      videos.push({ id, url, title: String(payload.title || ""), author: String(payload.author_name || "") });
    } catch {
      /* a missing oembed does not block the answer */
    }
  }
  return videos;
}

export function buildAskContext(bundle, swipeRows, extras = {}) {
  const data = bundle || {};
  const yt = data.yt || {};
  const ig = data.ig || {};
  const question = extras.question || "";
  const recent = extras.recent || [];
  const referenced = extras.referenced || [];
  const targetTitle = [extras.targetTitle || "", ...referenced.map((video) => video.title), resolveTargetUpload(question, recent)?.title || ""].filter(Boolean).join(" ");
  const relevant = rankRelevant(catalogItems(data), `${question} ${targetTitle}`, targetTitle);
  const groups = [
    ["YouTube mine", (yt.mine || []).map((item) => lineFor([item.id, item.channel || item.creator, item.views, multipleLabel(item.multiplier), item.published, clip(item.title, 180), item.url]))],
    ["Reels picks", (ig.picks || []).map((item) => lineFor([item.id, item.creator ? `@${item.creator}` : "", multipleLabel(item.multiplier), clip(item.hook || item.title, 180), item.url]))],
    ["Reels candidates", (ig.candidates || []).map((item) => lineFor([item.id, item.creator ? `@${item.creator}` : "", multipleLabel(item.multiplier), clip(item.hook || item.title, 160), item.url]))],
    ["Reels shortlist", (ig.shortlist || []).map((item) => lineFor([item.id, item.creator ? `@${item.creator}` : "", clip(item.hook || item.title, 140), item.url]))],
    ["Packaging swipe", (swipeRows || []).map((item) => lineFor([item.video_id || item.id, item.channel, clip(item.title, 160), item.url]))],
    ["YouTube peers", (yt.peers || []).map((item) => lineFor([item.id, item.channel || item.creator, item.views, multipleLabel(item.multiplier), item.published, clip(item.title, 140), item.url]))],
    ["YouTube broad", (yt.broad || []).map((item) => lineFor([item.id, item.channel || item.creator, item.views, multipleLabel(item.multiplier), item.published, clip(item.title, 140), item.url]))],
    ["YouTube big", (yt.big || []).map((item) => lineFor([item.id, item.channel || item.creator, item.views, multipleLabel(item.multiplier), item.published, clip(item.title, 140), item.url]))],
  ];
  const chunks = ["Each row is id, creator, views, multiple, date, title, url. Cite ids from this list. Matt's own videos are style reference only."];
  if (referenced.length) {
    chunks.push(["VIDEO THE USER REFERENCED", ...referenced.map((video) => lineFor([video.id, video.author, video.title, video.url]))].join("\n"));
  }
  if (recent.length) {
    chunks.push(["MATT'S RECENT UPLOADS (newest first)", ...recent.map((video) => lineFor([video.id, video.published, video.title, video.url, video.description]))].join("\n"));
  }
  if (relevant.length) {
    chunks.push(["MOST RELEVANT OUTLIERS FOR THIS QUESTION", ...relevant.map((item) => lineFor([item.id, item.channel, item.views, multipleLabel(item.multiplier), item.published, clip(item.title, 180), item.url]))].join("\n"));
  }
  let used = chunks.reduce((sum, chunk) => sum + estimateTokens(chunk), 0);
  for (const [title, lines] of groups) {
    const kept = [];
    let block = `${title}`;
    for (const line of lines) {
      const next = estimateTokens(`${block}\n${line}`);
      if (used + next > TOKEN_BUDGET) break;
      kept.push(line);
      block = `${title}\n${kept.join("\n")}`;
    }
    if (!kept.length) continue;
    const section = `${title}\n${kept.join("\n")}`;
    used += estimateTokens(section);
    chunks.push(section);
    if (used >= TOKEN_BUDGET) break;
  }
  return chunks.join("\n\n");
}

async function loadBundle() {
  const raw = await openStore("outlier-data").get("bundle", { type: "arrayBuffer" });
  if (!raw) return null;
  const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw);
  const sha = bundleSha(bytes);
  if (bundleCache.sha === sha && bundleCache.data) return bundleCache.data;
  const packed = bundleBytes(bytes);
  const text = new TextDecoder().decode(packed.gzip ? gunzipSync(packed.bytes) : packed.bytes);
  const data = JSON.parse(text);
  bundleCache = { sha, data };
  return data;
}

async function readSwipe() {
  const store = openStore("outlier-swipe");
  const indexed = await store.get("index", { type: "json" });
  if (indexed && Array.isArray(indexed.rows)) return indexed.rows.filter((row) => row && row.email);
  const listed = await store.list();
  const keys = (listed.blobs || []).map((blob) => blob.key).filter((key) => key !== "index");
  const rows = await Promise.all(keys.map((key) => store.get(key, { type: "json" })));
  return rows.filter((row) => row && row.email);
}

function threadKey(email) {
  return `thread:${String(email).toLowerCase()}`;
}

function rateKey(email) {
  return `rate:${String(email).toLowerCase()}`;
}

function systemPrompt(context) {
  return [
    "You are a content strategist for Matt Clark, an ecommerce and AI business educator.",
    "Other creators' outliers are the PRIMARY evidence.",
    "When the user says \"our latest video\" or names a video, resolve it to one of MATT'S RECENT UPLOADS by recency or title match, or to VIDEO THE USER REFERENCED when they paste a link. Quote back which video you used.",
    "When suggesting titles or hooks for a specific video, first state in one line which video it is for and its core promise.",
    "Then model each suggestion on 1–3 relevant outliers from OTHER creators that share the topic or format.",
    "At least 2 of every 3 sources cited must be non-Matt videos. Use Matt's own outliers only as a voice and style reference, and never cite only Matt's videos.",
    "Keep titles faithful to the video's actual content. Do not invent \"$1M/mo\" claims the video does not make.",
    "Do not invent dollar figures. Reuse a figure only if the target video uses it.",
    "Answer from the outlier data below. Cite the source outliers by id for each suggestion.",
    "Exclude freebie and cheap-access bait angles. Be concise.",
    "When you suggest a title, hook, or packaging idea, put that suggestion in its own fenced JSON block and do not put other text inside the fence:",
    "```suggestion",
    "{\"title\":\"...\",\"reason\":\"...\",\"sources\":[\"id\"]}",
    "```",
    "Use at most 3 source ids, and only ids that appear in the data. Prose can sit around the fences.",
    "",
    context,
  ].join("\n");
}

function sseEncode(encoder, payload) {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

async function readAnthropic(response, onText, signal) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    if (signal.aborted) {
      await reader.cancel();
      return;
    }
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      for (const line of part.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let event;
        try { event = JSON.parse(payload); } catch { continue; }
        if (event.type === "content_block_delta" && event.delta && event.delta.type === "text_delta" && event.delta.text) onText(event.delta.text);
        if (event.type === "error") throw new Error("model");
      }
    }
  }
}

export function resetAskCache() {
  bundleCache = { sha: "", data: null };
  rssCache = { at: 0, videos: [] };
}

export function askContextBudget() {
  return TOKEN_BUDGET;
}

export default async function handler(req) {
  const gate = await requireUser(req);
  if (gate.error) return gate.error;
  const email = String(gate.session.user.email || "").toLowerCase();
  const chats = openStore("outlier-chats");
  if (req.method === "GET") {
    const thread = (await chats.get(threadKey(email), { type: "json" })) || { messages: [] };
    return json({ messages: Array.isArray(thread.messages) ? thread.messages.slice(-MAX_MESSAGES) : [] });
  }
  if (req.method === "DELETE") {
    await chats.setJSON(threadKey(email), { messages: [] });
    return json({ messages: [] });
  }
  if (req.method !== "POST") return fail(405, "Use POST.");
  const body = await readJson(req);
  const message = String((body && body.message) || "").trim();
  if (!message) return fail(400, "Ask a question first.");
  const today = dayKey();
  const rate = (await chats.get(rateKey(email), { type: "json" })) || { day: today, count: 0 };
  const count = rate.day === today ? Number(rate.count) || 0 : 0;
  if (count >= DAILY_LIMIT) return fail(429, "You've used today's 60 questions. Ask again tomorrow.");

  const thread = (await chats.get(threadKey(email), { type: "json" })) || { messages: [] };
  const messages = (Array.isArray(thread.messages) ? thread.messages : []).concat({ role: "user", content: message.slice(0, 4000) }).slice(-MAX_MESSAGES);
  const apiKey = process.env.ANTHROPIC_API_KEY || "";
  if (!apiKey) return fail(503, "Couldn't get an answer.");
  const bundle = await loadBundle();
  if (!bundle) return fail(503, "The research bundle is not loaded yet.");
  await chats.setJSON(rateKey(email), { day: today, count: count + 1 });
  await chats.setJSON(threadKey(email), { messages });
  const swipe = await readSwipe();
  const recent = await loadRecentUploads();
  const referenced = await loadReferenced(message);
  const context = buildAskContext(bundle, swipe, { question: message, recent, referenced });
  const model = process.env.ASK_MODEL || MODEL_DEFAULT;
  const encoder = new TextEncoder();
  const upstream = new AbortController();
  let assistant = "";
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload) => controller.enqueue(sseEncode(encoder, payload));
      try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          signal: upstream.signal,
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: 2000,
            stream: true,
            system: systemPrompt(context),
            messages: messages.map((item) => ({ role: item.role === "assistant" ? "assistant" : "user", content: item.content })),
          }),
        });
        if (!response.ok || !response.body) throw new Error("model");
        await readAnthropic(response, (text) => {
          assistant += text;
          send({ t: "d", text });
        }, upstream.signal);
        const saved = messages.concat({ role: "assistant", content: assistant }).slice(-MAX_MESSAGES);
        await chats.setJSON(threadKey(email), { messages: saved });
        send({ t: "done" });
      } catch (error) {
        if (upstream.signal.aborted) {
          const saved = messages.concat({ role: "assistant", content: assistant }).filter((item) => item.content).slice(-MAX_MESSAGES);
          await chats.setJSON(threadKey(email), { messages: saved });
        } else {
          send({ t: "err", message: "Couldn't get an answer." });
        }
      } finally {
        controller.close();
      }
    },
    cancel() {
      upstream.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}
