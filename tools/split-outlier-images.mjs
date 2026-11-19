#!/usr/bin/env node
/** Replace inlined data-URL posters with /outlier/api/img/<sha256> and write the bytes beside the bundle. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { dirname, resolve } from "node:path";

const DATA_URL = /^data:image\/[\w.+-]+;base64,([a-z0-9+/=\s]+)$/i;

export function splitBundle(rawJson) {
  const images = new Map();
  const walk = (value) => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== "object") {
      if (typeof value !== "string") return value;
      const match = DATA_URL.exec(value.trim());
      if (!match) return value;
      const bytes = Buffer.from(match[1].replace(/\s/g, ""), "base64");
      const sha = createHash("sha256").update(bytes).digest("hex");
      images.set(sha, bytes);
      return `/outlier/api/img/${sha}`;
    }
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = walk(item);
    return out;
  };
  return { bundle: walk(rawJson), images };
}

function readJson(path) {
  const bytes = readFileSync(path);
  const text = path.endsWith(".gz") || (bytes[0] === 0x1f && bytes[1] === 0x8b) ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8");
  return JSON.parse(text);
}

export function writeSplit(bundlePath, imagesDir, rawJson) {
  const { bundle, images } = splitBundle(rawJson);
  const json = Buffer.from(JSON.stringify(bundle));
  const gz = gzipSync(json, { level: 9 });
  mkdirSync(dirname(bundlePath), { recursive: true });
  mkdirSync(imagesDir, { recursive: true });
  const out = bundlePath.endsWith(".gz") ? bundlePath : `${bundlePath}.gz`;
  writeFileSync(out, gz);
  for (const [sha, bytes] of images) writeFileSync(resolve(imagesDir, sha), bytes);
  return { jsonBytes: json.length, gzipBytes: gz.length, images: images.size, out, imagesDir };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const from = args[args.indexOf("--from-bundle") + 1];
  const out = args[args.indexOf("--out") + 1];
  const images = args[args.indexOf("--images") + 1];
  if (!from || !out || !images) {
    console.error("Usage: node tools/split-outlier-images.mjs --from-bundle <bundle.json.gz> --out <slim.json.gz> --images <dir>");
    process.exit(1);
  }
  const result = writeSplit(out, images, readJson(from));
  console.log(`slim ${result.out} json=${result.jsonBytes} gzip=${result.gzipBytes} images=${result.images} dir=${result.imagesDir}`);
}
