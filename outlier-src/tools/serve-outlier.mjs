#!/usr/bin/env node
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { createMockBlobs } from "../tests/outlier/mock-blobs.mjs";
import { hashPassword } from "../netlify/functions/outlier-lib.mjs";
import auth from "../netlify/functions/outlier-auth.mjs";
import data from "../netlify/functions/outlier-data.mjs";
import saves from "../netlify/functions/outlier-saves.mjs";
import swipe from "../netlify/functions/outlier-swipe.mjs";
import admin from "../netlify/functions/outlier-admin.mjs";

const root = new URL("../outlier/", import.meta.url);
const open = createMockBlobs();
globalThis.__OUTLIER_BLOBS = open;

const routes = [
  ["/outlier/api/login", auth],
  ["/outlier/api/logout", auth],
  ["/outlier/api/me", auth],
  ["/outlier/api/account/password", auth],
  ["/outlier/api/data", data],
  ["/outlier/api/saves", saves],
  ["/outlier/api/swipe", swipe],
  ["/outlier/api/admin/users", admin],
];

async function seed() {
  const password = process.env.OUTLIER_SEED_PASSWORD;
  if (!password) return;
  const hashed = await hashPassword(password, { n: 1024, r: 8, p: 1 });
  await open("outlier-users").setJSON("ada@example.com", {
    email: "ada@example.com", name: "Ada Admin", role: "admin", disabled: false, created_at: new Date().toISOString(), ...hashed,
  });
  if (process.env.OUTLIER_SEED_MEMBER_PASSWORD) {
    const member = await hashPassword(process.env.OUTLIER_SEED_MEMBER_PASSWORD, { n: 1024, r: 8, p: 1 });
    await open("outlier-users").setJSON("lee@example.com", {
      email: "lee@example.com", name: "Lee Member", role: "member", disabled: false, created_at: new Date().toISOString(), ...member,
    });
  }
  const bundle = process.env.OUTLIER_BUNDLE;
  if (bundle && existsSync(bundle)) {
    await open("outlier-data").set("bundle", readFileSync(bundle));
  }
}

const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const route = routes.find(([path]) => url.pathname === path);
  if (route) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const headers = new Headers();
    for (const key of ["cookie", "content-type", "accept-encoding", "if-none-match", "x-forwarded-for"]) {
      if (req.headers[key]) headers.set(key, req.headers[key]);
    }
    const request = new Request(url, { method: req.method, headers, body: body.length ? body : undefined });
    const response = await route[1](request, { ip: "127.0.0.1" });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  let path = decodeURIComponent(url.pathname);
  if (path === "/outlier" || path === "/outlier/") path = "/outlier/index.html";
  if (!path.startsWith("/outlier/")) { res.writeHead(404); res.end("Not found"); return; }
  const file = normalize(join(root.pathname, path.slice("/outlier/".length)));
  if (!file.startsWith(root.pathname) || !existsSync(file)) { res.writeHead(404); res.end("Not found"); return; }
  res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(file));
});

await seed();
const port = Number(process.env.PORT || 43118);
server.listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}/outlier/`));
