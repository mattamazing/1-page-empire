#!/usr/bin/env node
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "outlier-src");
const out = resolve(root, "outlier");
const css = readFileSync(resolve(src, "app.css"));
const js = readFileSync(resolve(src, "app.js"));
const cssName = `app.${createHash("sha256").update(css).digest("hex").slice(0, 10)}.css`;
const jsName = `app.${createHash("sha256").update(js).digest("hex").slice(0, 10)}.js`;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, cssName), css);
writeFileSync(resolve(out, jsName), js);
const html = readFileSync(resolve(src, "index.html"), "utf8").replace("__CSS__", cssName).replace("__JS__", jsName);
writeFileSync(resolve(out, "index.html"), html);
writeFileSync(resolve(out, "manifest.webmanifest"), readFileSync(resolve(src, "manifest.webmanifest")));
cpSync(resolve(root, "assets/fonts"), resolve(out, "fonts"), { recursive: true });
console.log(`outlier/${cssName} outlier/${jsName}`);
