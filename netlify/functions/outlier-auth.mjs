import {
  clearCookie,
  clearFailures,
  clientIp,
  fail,
  hashPassword,
  json,
  newToken,
  noteFailure,
  openStore,
  publicUser,
  readJson,
  requireUser,
  sessionCookie,
  tokenHash,
  tooManyFailures,
  verifyPassword,
  wantsSecure,
  YEAR,
} from "./outlier-lib.mjs";

export const config = {
  path: ["/outlier/api/login", "/outlier/api/logout", "/outlier/api/me", "/outlier/api/account/password"],
};

async function login(req, context) {
  const body = await readJson(req);
  const email = String((body && body.email) || "").trim().toLowerCase();
  const password = String((body && body.password) || "");
  if (!email || !password) return fail(400, "Enter your email and password.");
  const ip = clientIp(req, context);
  const failures = await tooManyFailures(email, ip);
  if (failures.limited) return fail(429, "Too many tries. Wait a few minutes and try again.");
  const users = openStore("outlier-users");
  const user = await users.get(email, { type: "json" });
  const ok = await verifyPassword(password, user);
  if (!ok) {
    await noteFailure(failures);
    if (user && user.disabled) return fail(403, "This account is turned off. Ask an admin.");
    return fail(401, "That email and password did not match.");
  }
  await clearFailures(failures);
  const token = newToken();
  const now = new Date();
  await openStore("outlier-sessions").setJSON(tokenHash(token), {
    email,
    created_at: now.toISOString(),
    last_seen: now.toISOString(),
    expires_at: new Date(now.getTime() + YEAR * 1000).toISOString(),
  });
  return json(publicUser(user), 200, { "set-cookie": sessionCookie(token, wantsSecure(req)) });
}

async function logout(req) {
  const gate = await requireUser(req);
  if (!gate.error && gate.session) await openStore("outlier-sessions").delete(gate.session.key);
  return json({ ok: true }, 200, { "set-cookie": clearCookie(wantsSecure(req)) });
}

async function me(req) {
  const gate = await requireUser(req);
  if (gate.error) return gate.error;
  const headers = {};
  if (gate.session.renewed) headers["set-cookie"] = sessionCookie(gate.session.token, wantsSecure(req));
  return json(publicUser(gate.session.user), 200, headers);
}

async function changePassword(req) {
  const gate = await requireUser(req);
  if (gate.error) return gate.error;
  const body = await readJson(req);
  const current = String((body && body.current) || "");
  const next = String((body && body.next) || "");
  if (next.length < 8) return fail(400, "Use at least 8 characters.");
  const user = gate.session.user;
  if (!(await verifyPassword(current, user))) return fail(401, "The current password is wrong.");
  const hashed = await hashPassword(next);
  const users = openStore("outlier-users");
  await users.setJSON(user.email, { ...user, ...hashed });
  return json({ ok: true });
}

export default async function handler(req, context) {
  const path = new URL(req.url).pathname;
  if (path === "/outlier/api/login" && req.method === "POST") return login(req, context || {});
  if (path === "/outlier/api/logout" && req.method === "POST") return logout(req);
  if (path === "/outlier/api/me" && req.method === "GET") return me(req);
  if (path === "/outlier/api/account/password" && req.method === "POST") return changePassword(req);
  return fail(404, "Not found.");
}
