import { etagFor, fail, json, openStore, requireUser } from "./outlier-lib.mjs";

export const config = { path: "/outlier/api/data/version" };

export default async function handler(req) {
  if (req.method !== "GET") return fail(405, "Use GET.");
  const gate = await requireUser(req);
  if (gate.error) return gate.error;
  const raw = await openStore("outlier-data").get("bundle", { type: "arrayBuffer" });
  if (!raw) return fail(503, "The research bundle is not loaded yet.");
  const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw);
  const etag = etagFor(bytes);
  if ((req.headers.get("if-none-match") || "") === etag) {
    return new Response(null, { status: 304, headers: { etag, "cache-control": "private, no-cache" } });
  }
  return json({ sha: etag.slice(1, -1), etag }, 200, { etag, "cache-control": "private, no-cache" });
}
