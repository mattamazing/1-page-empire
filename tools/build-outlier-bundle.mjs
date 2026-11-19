#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
function flag(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : "";
}
const reels = flag("--reels-dir");
const out = flag("--out") || "outlier-data-bundle.json.gz";
const label = flag("--window-label");
if (!reels) {
  console.error("Usage: node tools/build-outlier-bundle.mjs --reels-dir <dir> [--out <file.json.gz>] [--window-label <label>]");
  process.exit(1);
}
const jsonPath = out.endsWith(".gz") ? out.slice(0, -3) : `${out}.json`;
const pyArgs = [resolve(root, "tools/export_outlier_bundle.py"), "--reels-dir", reels, "--out", jsonPath];
if (label) pyArgs.push("--window-label", label);
const py = spawnSync("python3", pyArgs, { cwd: root, stdio: "inherit" });
if (py.status !== 0) process.exit(py.status || 1);
const raw = readFileSync(jsonPath);
const gz = out.endsWith(".gz") ? out : `${jsonPath}.gz`;
writeFileSync(gz, gzipSync(raw, { level: 9 }));
const images = flag("--images") || `${gz}.images`;
const { writeSplit } = await import("./split-outlier-images.mjs");
const slim = writeSplit(gz, images, JSON.parse(raw.toString("utf8")));
console.log(`gzip ${gz} fat=${raw.length} slim-json=${slim.jsonBytes} slim-gzip=${slim.gzipBytes} images=${slim.images}`);
console.log("Seed the private Blobs store before deploy:");
console.log(`netlify blobs:set outlier-data bundle ${gz}`);
console.log(`for f in ${images}/*; do netlify blobs:set outlier-data "img:$(basename "$f")" "$f"; done`);
