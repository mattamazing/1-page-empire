#!/usr/bin/env node
import { hashPassword } from "../netlify/functions/outlier-lib.mjs";

const password = process.env.OUTLIER_SEED_PASSWORD;
const [email, name, role = "admin"] = process.argv.slice(2);
if (!password) {
  console.error("Set OUTLIER_SEED_PASSWORD. The password is not read from argv.");
  process.exit(1);
}
if (!email || !name || !["admin", "member"].includes(role)) {
  console.error("Usage: OUTLIER_SEED_PASSWORD=... node tools/hash-password.mjs <email> <name> [admin|member]");
  process.exit(1);
}
const hashed = await hashPassword(password);
const record = {
  email: email.trim().toLowerCase(),
  name,
  role,
  disabled: false,
  created_at: new Date().toISOString(),
  ...hashed,
};
process.stdout.write(`${JSON.stringify(record)}\n`);
