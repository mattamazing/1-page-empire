import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { useMockBlobs, request, cookieFrom } from "./mock-blobs.mjs";
import { hashPassword, openStore } from "../../netlify/functions/outlier-lib.mjs";
import auth from "../../netlify/functions/outlier-auth.mjs";
import ask, { buildAskContext, estimateTokens, resetAskCache, askContextBudget } from "../../netlify/functions/outlier-ask.mjs";

const cheap = { n: 1024, r: 8, p: 1 };
const originalFetch = globalThis.fetch;

async function signIn() {
  useMockBlobs();
  resetAskCache();
  const hashed = await hashPassword("password1", cheap);
  await openStore("outlier-users").setJSON("ada@example.com", {
    email: "ada@example.com", name: "Ada", role: "member", disabled: false, created_at: new Date().toISOString(), ...hashed,
  });
  const login = await auth(request("https://localhost/outlier/api/login", {
    method: "POST",
    body: { email: "ada@example.com", password: "password1" },
  }));
  return cookieFrom(login);
}

function bundle() {
  return gzipSync(Buffer.from(JSON.stringify({
    yt: { mine: [{ id: "abcdefghijk", channel: "Matt", views: 1000, multiplier: 4.2, published: "2026-11-01", title: "Claude landing page", url: "https://www.youtube.com/watch?v=abcdefghijk" }], peers: [], broad: [], big: [] },
    ig: { picks: [{ id: "AAA111", creator: "hormozi", multiplier: 12.4, hook: "Sell the outcome", url: "https://www.instagram.com/p/AAA111/" }], candidates: [], shortlist: [] },
  })));
}

function sse(text) {
  const payload = JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } });
  return new Response(`event: content_block_delta\ndata: ${payload}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
}

test("ask requires a session and never echoes the API key", async () => {
  await signIn();
  const locked = await ask(request("https://localhost/outlier/api/ask", { method: "POST", body: { message: "Ideas" } }));
  assert.equal(locked.status, 401);
  process.env.ANTHROPIC_API_KEY = "secret-key-value";
  const missing = await ask(request("https://localhost/outlier/api/ask", { method: "GET" }));
  assert.equal(missing.status, 401);
  assert.equal(JSON.stringify(await missing.json()).includes("secret-key-value"), false);
  delete process.env.ANTHROPIC_API_KEY;
});

test("ask streams a suggestion, stores the thread, and stays off the swipe store", async () => {
  const cookie = await signIn();
  await openStore("outlier-data").set("bundle", bundle());
  await openStore("outlier-swipe").setJSON("pack1", { id: "pack1", email: "ada@example.com", video_id: "abcdefghijk", title: "Saved packaging", url: "https://www.youtube.com/watch?v=abcdefghijk" });
  process.env.ANTHROPIC_API_KEY = "secret-key-value";
  let seenKey = "";
  globalThis.fetch = async (_url, init) => {
    seenKey = init.headers["x-api-key"];
    const body = JSON.parse(init.body);
    assert.equal(body.model, "claude-sonnet-4-6");
    assert.equal(body.max_tokens, 2000);
    assert.equal(JSON.stringify(body).includes("secret-key-value"), false);
    assert.match(body.system, /Matt Clark/);
    assert.match(body.system, /abcdefghijk/);
    return sse("```suggestion\n{\"title\":\"Boat open\",\"reason\":\"Peers use it\",\"sources\":[\"abcdefghijk\"]}\n```");
  };
  const response = await ask(request("https://localhost/outlier/api/ask", { method: "POST", cookie, body: { message: "Give me a title" } }));
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /Boat open/);
  assert.equal(text.includes("secret-key-value"), false);
  assert.equal(seenKey, "secret-key-value");
  const stored = await ask(request("https://localhost/outlier/api/ask", { cookie }));
  const messages = (await stored.json()).messages;
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "user");
  assert.match(messages[1].content, /Boat open/);
  const swipe = await openStore("outlier-swipe").get("pack1", { type: "json" });
  assert.equal(swipe.title, "Saved packaging");
  const cleared = await ask(request("https://localhost/outlier/api/ask", { method: "DELETE", cookie }));
  assert.equal((await cleared.json()).messages.length, 0);
  globalThis.fetch = originalFetch;
  delete process.env.ANTHROPIC_API_KEY;
});

test("ask stops at 60 questions a day", async () => {
  const cookie = await signIn();
  await openStore("outlier-data").set("bundle", bundle());
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  await openStore("outlier-chats").setJSON("rate:ada@example.com", { day, count: 60 });
  process.env.ANTHROPIC_API_KEY = "secret-key-value";
  let called = false;
  globalThis.fetch = async () => { called = true; return sse("no"); };
  const response = await ask(request("https://localhost/outlier/api/ask", { method: "POST", cookie, body: { message: "Another" } }));
  assert.equal(response.status, 429);
  const payload = await response.json();
  assert.match(payload.error, /60 questions/);
  assert.equal(called, false);
  globalThis.fetch = originalFetch;
  delete process.env.ANTHROPIC_API_KEY;
});

test("ask context stays inside the token budget", () => {
  const peers = Array.from({ length: 5000 }, (_, index) => ({
    id: `peer${index}`,
    channel: "Channel name that is reasonably long",
    views: 100000 + index,
    multiplier: 3.5,
    published: "2026-10-01",
    title: "A long outlier title about ecommerce systems and offers ".repeat(4),
    url: `https://www.youtube.com/watch?v=peer${index}`,
  }));
  const text = buildAskContext({ yt: { mine: [], peers, broad: peers, big: peers }, ig: { picks: [], candidates: [], shortlist: [] } }, []);
  assert.ok(estimateTokens(text) <= askContextBudget());
  assert.match(text, /YouTube peers/);
});
