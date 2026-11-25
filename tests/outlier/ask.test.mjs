import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { useMockBlobs, request, cookieFrom } from "./mock-blobs.mjs";
import { hashPassword, openStore } from "../../netlify/functions/outlier-lib.mjs";
import auth from "../../netlify/functions/outlier-auth.mjs";
import ask, { buildAskContext, estimateTokens, resetAskCache, askContextBudget, parseYoutubeRss, findYoutubeIds, loadRecentUploads } from "../../netlify/functions/outlier-ask.mjs";

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
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.includes("feeds/videos.xml")) return new Response("<feed></feed>", { status: 200 });
    if (href.includes("oembed")) return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
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

const sampleRss = `<?xml version="1.0"?>
<feed>
  <entry>
    <yt:videoId>oldervideo1</yt:videoId>
    <title>Older upload</title>
    <published>2026-11-01T00:00:00+00:00</published>
    <link rel="alternate" href="https://www.youtube.com/watch?v=oldervideo1"/>
    <media:description>Short.</media:description>
  </entry>
  <entry>
    <yt:videoId>grok1111111</yt:videoId>
    <title>You're not late (yet): Learn 97% of Grok Bot in 11 minutes</title>
    <published>2026-11-24T12:00:00+00:00</published>
    <link rel="alternate" href="https://www.youtube.com/watch?v=grok1111111"/>
    <media:description><![CDATA[${"Learn Grok. ".repeat(80)}]]></media:description>
  </entry>
</feed>`;

test("rss parsing keeps the newest upload and the first 600 description characters", () => {
  const videos = parseYoutubeRss(sampleRss);
  assert.equal(videos[0].id, "grok1111111");
  assert.match(videos[0].title, /Learn 97% of Grok Bot/);
  assert.equal(videos[0].url, "https://www.youtube.com/watch?v=grok1111111");
  assert.equal(videos[0].description.length, 600);
  assert.equal(videos[1].id, "oldervideo1");
});

test("retrieval surfaces a learn-in-minutes peer for a learn-Grok question", () => {
  const text = buildAskContext({
    yt: {
      mine: [{ id: "matt1", channel: "Matt Clark", title: "How I hit $1M/mo with one offer", multiplier: 40, url: "https://www.youtube.com/watch?v=matt1video1" }],
      peers: [
        { id: "peerclaude1", channel: "Other Creator", title: "Learn 90% of Claude Video Editing in under 20 Minutes", multiplier: 6, url: "https://www.youtube.com/watch?v=peerclaude1" },
        { id: "peer2", channel: "Other Creator", title: "Anthropic Just Shipped Claude 2.0 (Master it in 17 minutes)", multiplier: 5, url: "https://www.youtube.com/watch?v=peer2video1" },
        { id: "peer3", channel: "Other Creator", title: "My morning routine for ecommerce", multiplier: 30, url: "https://www.youtube.com/watch?v=peer3video1" },
      ],
      broad: [],
      big: [],
    },
    ig: { picks: [], candidates: [], shortlist: [] },
  }, [], { question: "Give me title ideas for learning Grok in 11 minutes" });
  const relevant = text.split("MOST RELEVANT OUTLIERS FOR THIS QUESTION")[1].split("YouTube mine")[0];
  assert.match(relevant, /Learn 90% of Claude Video Editing in under 20 Minutes/);
  assert.ok(relevant.indexOf("Learn 90%") < relevant.indexOf("morning routine") || !relevant.includes("morning routine"));
  assert.equal(relevant.includes("How I hit $1M/mo"), false);
});

test("youtube url detection accepts watch, youtu.be, and shorts links", () => {
  assert.deepEqual(findYoutubeIds("watch https://www.youtube.com/watch?v=abcdefghijk&t=3s"), ["abcdefghijk"]);
  assert.deepEqual(findYoutubeIds("https://youtu.be/bbbbbbbbbbb"), ["bbbbbbbbbbb"]);
  assert.deepEqual(findYoutubeIds("https://www.youtube.com/shorts/ccccccccccc"), ["ccccccccccc"]);
  assert.deepEqual(findYoutubeIds("no link here"), []);
});

test("rss fail-soft returns an empty list and then keeps the last good feed", async () => {
  resetAskCache();
  globalThis.fetch = async () => { throw new Error("down"); };
  assert.deepEqual(await loadRecentUploads(), []);
  globalThis.fetch = async () => new Response(sampleRss, { status: 200 });
  const loaded = await loadRecentUploads();
  assert.equal(loaded[0].id, "grok1111111");
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("down"); };
  const again = await loadRecentUploads();
  assert.equal(calls, 0);
  assert.equal(again[0].id, "grok1111111");
  globalThis.fetch = originalFetch;
});
