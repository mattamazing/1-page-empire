import { adminCount, fail, hashPassword, json, listUsers, openStore, publicUser, readJson, requireAdmin } from "./outlier-lib.mjs";

export const config = { path: "/outlier/api/admin/users" };

export default async function handler(req) {
  const gate = await requireAdmin(req);
  if (gate.error) return gate.error;
  const store = openStore("outlier-users");
  if (req.method === "GET") {
    const users = await listUsers();
    return json({ users: users.map(publicUser) });
  }
  const body = await readJson(req);
  const email = String((body && body.email) || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return fail(400, "Enter a real email.");
  if (req.method === "POST") {
    if (await store.get(email, { type: "json" })) return fail(409, "That email already has an account.");
    const password = String((body && body.password) || "");
    if (password.length < 8) return fail(400, "Use at least 8 characters.");
    const role = body.role === "admin" ? "admin" : "member";
    const hashed = await hashPassword(password);
    const user = {
      email,
      name: String(body.name || "").slice(0, 80),
      role,
      disabled: false,
      created_at: new Date().toISOString(),
      ...hashed,
    };
    await store.setJSON(email, user);
    return json({ user: publicUser(user) }, 201);
  }
  const existing = await store.get(email, { type: "json" });
  if (!existing) return fail(404, "No account with that email.");
  if (req.method === "DELETE") {
    if (body.confirm !== true) return fail(400, "Confirm the delete.");
    if (existing.role === "admin" && !existing.disabled && (await adminCount(email)) < 1) {
      return fail(400, "Keep at least one admin.");
    }
    await store.delete(email);
    return json({ ok: true });
  }
  if (req.method === "PATCH") {
    const next = { ...existing };
    if (body.name != null) next.name = String(body.name).slice(0, 80);
    if (body.role != null) next.role = body.role === "admin" ? "admin" : "member";
    if (body.disabled != null) next.disabled = !!body.disabled;
    if (body.password) {
      if (String(body.password).length < 8) return fail(400, "Use at least 8 characters.");
      Object.assign(next, await hashPassword(String(body.password)));
    }
    const removesAdmin = existing.role === "admin" && !existing.disabled && (next.role !== "admin" || next.disabled);
    if (removesAdmin && (await adminCount(email)) < 1) return fail(400, "Keep at least one admin.");
    await store.setJSON(email, next);
    return json({ user: publicUser(next) });
  }
  return fail(405, "Use GET, POST, PATCH, or DELETE.");
}
