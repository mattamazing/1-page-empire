import { fail, openStore, requireUser } from "./outlier-lib.mjs";

export const config = { path: "/outlier/api/img/*" };

function imageType(bytes) {
  if (bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) return "image/webp";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.length > 4 && bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  return "application/octet-stream";
}

export default async function handler(req) {
  if (req.method !== "GET" && req.method !== "HEAD") return fail(405, "Use GET.");
  const gate = await requireUser(req);
  if (gate.error) return gate.error;
  const id = new URL(req.url).pathname.split("/").filter(Boolean).pop() || "";
  if (!/^[a-f0-9]{64}$/.test(id)) return fail(404, "No image.");
  const raw = await openStore("outlier-data").get(`img:${id}`, { type: "arrayBuffer" });
  if (!raw) return fail(404, "No image.");
  const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw);
  const etag = `"${id}"`;
  const headers = {
    "content-type": imageType(bytes),
    "cache-control": "private, max-age=31536000, immutable",
    etag,
  };
  if ((req.headers.get("if-none-match") || "") === etag) return new Response(null, { status: 304, headers });
  if (req.method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(bytes, { headers });
}
