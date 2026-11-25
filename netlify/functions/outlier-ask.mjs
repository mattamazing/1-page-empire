import { gunzipSync } from "node:zlib";
import { bundleBytes, bundleSha, fail, json, openStore, readJson, requireUser } from "./outlier-lib.mjs";

export const config = { path: "/outlier/api/ask" };

const TOKEN_BUDGET = 60000;
const DAILY_LIMIT = 60;
const MAX_MESSAGES = 40;
const MODEL_DEFAULT = "claude-sonnet-4-6";

let bundleCache = { sha: "", data: null };

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

export function buildAskContext(bundle, swipeRows) {
  const data = bundle || {};
  const yt = data.yt || {};
  const ig = data.ig || {};
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
  const chunks = ["Each row is id, creator, views, multiple, date, title, url. Cite ids from this list."];
  let used = estimateTokens(chunks[0]);
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
  const context = buildAskContext(bundle, swipe);
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
