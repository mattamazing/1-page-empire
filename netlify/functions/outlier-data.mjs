import { encodeBundle, fail, requireUser } from "./outlier-lib.mjs";
import { openStore } from "./outlier-lib.mjs";

export const config = { path: "/outlier/api/data" };

export default async function handler(req) {
  if (req.method !== "GET") return fail(405, "Use GET.");
  const gate = await requireUser(req);
  if (gate.error) return gate.error;
  const raw = await openStore("outlier-data").get("bundle", { type: "arrayBuffer" });
  if (!raw) return fail(503, "The research bundle is not loaded yet.");
  const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw);
  return encodeBundle(bytes, req);
}
