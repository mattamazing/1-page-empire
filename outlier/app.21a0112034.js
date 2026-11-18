const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const WATCHED = "outlier.watched.v1";
const state = {
  me: null,
  data: null,
  saves: [],
  swipe: [],
  users: [],
  platform: "ig",
  ig: "picks",
  igSeg: "all",
  yt: "mine",
  savedTab: "ideas",
  owners: new Set(["mine"]),
  platformFilter: "all",
  packOwners: new Set(["mine"]),
  packTag: "all",
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
function initials(name, email) {
  const parts = String(name || email || "?").trim().split(/\s+/);
  if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
}
function compact(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (n >= 1000000) return `${(n / 1000000).toFixed(n >= 10000000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return String(Math.round(n));
}
function multiple(value) {
  if (value == null || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "";
  return `${Math.round(n * 100) / 100}x`;
}
function personLabel(email, name) {
  const cleaned = String(name || "").trim();
  const local = String(email || "").split("@")[0] || "Someone";
  if (!cleaned || cleaned.toLowerCase() === String(email || "").toLowerCase()) return local;
  return cleaned;
}
function daysOf(iso) {
  if (!iso || !state.data) return null;
  const start = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00-06:00` : iso);
  const end = new Date(state.data.built_at);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.max(0, Math.round((end - start) / 86400000));
}
function when(iso) {
  const days = daysOf(iso);
  if (days == null) return "Date not recorded";
  const start = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00-06:00` : iso);
  const date = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" }).format(start);
  return `${date} · ${days}d`;
}
function updatedLine() {
  const d = new Date(state.data.built_at);
  const date = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }).format(d);
  const base = `Updated ${date}, ${time} CT`;
  if (state.platform === "yt" && location.hash !== "#saved") {
    return `${base} | ${state.data.yt.window_label || "Last 90 Days"}`;
  }
  return base;
}
function watchedSet() {
  try { return new Set(JSON.parse(localStorage.getItem(WATCHED) || "[]")); } catch { return new Set(); }
}
function toggleWatched(key) {
  const set = watchedSet();
  if (set.has(key)) set.delete(key); else set.add(key);
  localStorage.setItem(WATCHED, JSON.stringify([...set]));
}
function savedKey(platform, id) { return `${platform}:${id}`; }
function mySave(platform, id) {
  return state.saves.find((row) => row.email === state.me.email && row.platform === platform && row.item_id === id);
}
async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    body: options.body == null ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!response.ok) throw new Error((data && data.error) || "Something went wrong.");
  return data;
}
function poster(src, extra = "") {
  if (!src) return `<span class="${extra.includes("yt") ? "yt-still" : "still"}">${extra}</span>`;
  const klass = extra.includes("yt-x") ? "yt-still" : "still";
  return `<span class="${klass}"><img alt="" src="${esc(src)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">${extra}</span>`;
}
function actions(item, platform) {
  const mine = mySave(platform, item.id);
  const pack = platform === "yt" ? `<button class="btn" type="button" data-pack="${esc(item.id)}">Save packaging</button>` : "";
  return `<div class="actions">${item.url ? `<a class="btn btn-primary" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Open</a>` : ""}<button class="btn" type="button" data-save="${platform}:${esc(item.id)}" aria-pressed="${mine ? "true" : "false"}">${mine ? "Saved" : "Save idea"}</button>${pack}</div>`;
}
function igCard(item) {
  const days = when(item.published);
  const mult = multiple(item.multiplier);
  return `<article class="tile"><button class="tile-main" type="button" data-open="ig" data-id="${esc(item.id)}">${poster(item.poster, item.rank ? `<span class="rank">${esc(item.rank)}</span>` : "")}<span><span class="title">${esc(item.title || item.hook || "Untitled")}</span><span class="meta"><span>@${esc(item.creator || "")}</span>${mult ? `<span class="x">${esc(mult)}</span>` : ""}<span>${esc(days)}</span></span><span class="hook">${esc(item.hook || "")}</span></span></button>${actions(item, "ig")}</article>`;
}
function ytCard(item) {
  const mult = multiple(item.multiplier);
  return `<article class="yt-card"><button class="yt-main" type="button" data-open="yt" data-id="${esc(item.id)}">${poster(item.poster, mult ? `<span class="yt-x">${esc(mult)} median</span>` : "")}<span class="title">${esc(item.title)}</span><span class="meta">${esc(item.creator || item.channel || "")} · ${esc(compact(item.subs))} subs · ${esc(compact(item.views))} views · ${esc(when(item.published))}</span><span class="hook">${esc(item.hook || "")}</span></button>${actions(item, "yt")}</article>`;
}
function findItem(platform, id) {
  const ig = state.data.ig;
  const pools = platform === "ig"
    ? [...ig.picks, ...ig.history.flatMap((group) => group.picks), ...ig.explore, ...ig.inspire]
    : [...state.data.yt.mine, ...state.data.yt.peers, ...state.data.yt.broad, ...state.data.yt.big];
  return pools.find((item) => item.id === id);
}
function openSheet(html) {
  $("#sheet-body").innerHTML = html;
  $("#sheet").hidden = false;
}
function closeSheet() {
  $("#sheet").hidden = true;
  $("#sheet-body").innerHTML = "";
}
function detail(item, platform) {
  const mine = mySave(platform, item.id);
  const twist = item.ai_twist ? `<section class="adapt"><span class="label">AI twist</span><p>${esc(item.ai_twist)}</p></section>` : "";
  const mult = multiple(item.multiplier);
  const multHtml = mult ? ` · <b>${esc(mult)}${platform === "yt" ? " median" : ""}</b>` : "";
  return `<article><h2>${esc(item.title || "Untitled")}</h2><p class="meta">${esc(item.creator || item.channel || "")} · ${esc(compact(item.views))} views · ${esc(when(item.published))}${multHtml}</p>${actions(item, platform)}<p class="label">Hook</p><p class="big">${esc(item.hook || "No hook recorded.")}</p>${item.why ? `<p>${esc(item.why)}</p>` : ""}${twist}<label>Note<input class="input" id="note" value="${esc(mine ? mine.note : "")}" placeholder="Optional note"></label></article>`;
}
function renderPicks() {
  const picks = state.data.ig.picks;
  const fresh = picks.filter((item) => (daysOf(item.published) ?? 999) <= 30);
  const bench = picks.length - fresh.length;
  const segs = [["all", `All ${picks.length}`], ["previous", `Previous ${state.data.ig.history.reduce((n, group) => n + group.picks.length, 0)}`], ["fresh", `Recent ${fresh.length}`], ["bench", `Benchmarks ${bench}`]];
  let body = "";
  if (state.igSeg === "previous") {
    body = state.data.ig.history.map((group) => `<section><p class="hint">${esc(group.label)} · Retired ${esc(group.retired_on)}</p><div class="list">${group.picks.map(igCard).join("")}</div></section>`).join("");
  } else {
    const list = picks.filter((item) => {
      const days = daysOf(item.published) ?? 999;
      if (state.igSeg === "fresh") return days <= 30;
      if (state.igSeg === "bench") return days > 30;
      return true;
    });
    body = `<div class="list">${list.map(igCard).join("")}</div>`;
  }
  return `<div class="view-head"><div><h2>Top picks</h2><p class="updated">${esc(updatedLine())}</p></div><div class="seg">${segs.map(([key, label]) => `<button class="chip" type="button" data-seg="${key}" aria-pressed="${state.igSeg === key}">${label}</button>`).join("")}</div></div>${body}`;
}
function renderSimple(title, items, platform) {
  const cards = items.map((item) => platform === "yt" ? ytCard(item) : igCard(item)).join("");
  return `<div class="view-head"><div><h2>${esc(title)}</h2><p class="updated">${esc(updatedLine())}</p></div></div><div class="list">${cards || `<p class="hint">Nothing in this list.</p>`}</div>`;
}
function renderYoutube() {
  const lists = state.data.yt;
  const segs = [["mine", `My winners ${lists.mine.length}`], ["peers", `Peers ${lists.peers.length}`], ["broad", `Broad business ${lists.broad.length}`], ["big", `Big channels ${lists.big.length}`]];
  return `<div class="view-head"><div><h2>YouTube</h2><p class="updated">${esc(updatedLine())}</p></div><div class="seg">${segs.map(([key, label]) => `<button class="chip" type="button" data-yt="${key}" aria-pressed="${state.yt === key}">${label}</button>`).join("")}</div></div><div class="list">${(lists[state.yt] || []).map(ytCard).join("")}</div>`;
}
function ownerName(email) {
  const known = state.users.find((user) => user.email === email);
  const row = state.saves.find((item) => item.email === email) || state.swipe.find((item) => item.email === email);
  const mine = state.me && state.me.email === email ? state.me.name : "";
  return personLabel(email, (known && known.name) || mine || (row && row.name) || "");
}
function ownerChips(setName) {
  const emails = [...new Set(state.saves.map((row) => row.email).concat(state.swipe.map((row) => row.email)))];
  const selected = state[setName];
  const chips = [["mine", "Mine"], ["everyone", "Everyone"], ...emails.filter((email) => email !== state.me.email).map((email) => [email, ownerName(email)])];
  return chips.map(([key, label]) => `<button class="chip" type="button" data-owner-set="${setName}" data-owner="${esc(key)}" aria-pressed="${selected.has(key)}">${esc(label)}</button>`).join("");
}
function allowRow(email, selected) {
  if (selected.has("everyone")) return true;
  if (selected.has("mine") && email === state.me.email) return true;
  return selected.has(email);
}
function renderSaved() {
  const ideas = state.savedTab === "ideas";
  const rows = state.saves.filter((row) => allowRow(row.email, state.owners)).filter((row) => {
    if (state.platformFilter === "yt") return row.platform === "yt";
    if (state.platformFilter === "ig") return row.platform === "ig";
    return true;
  });
  const packs = state.swipe.filter((row) => allowRow(row.email, state.packOwners)).filter((row) => state.packTag === "all" || row.steal === state.packTag);
  const ideaCards = rows.map((row) => {
    const snap = row.snapshot || {};
    const who = personLabel(row.email, row.name);
    const mult = multiple(snap.multiplier);
    const views = Number(snap.views);
    const viewsText = Number.isFinite(views) && views > 0 ? `${compact(views)} views` : "";
    return `<article class="tile"><span class="person"><span class="avatar">${esc(initials(who, row.email))}</span>${esc(who)}</span><h2 class="title">${esc(snap.title || row.item_id)}</h2><p class="meta">${esc(row.platform === "yt" ? "YouTube long-form" : "Instagram Reels")}${snap.creator ? ` · ${esc(snap.creator)}` : ""}${viewsText ? ` · ${esc(viewsText)}` : ""}${mult ? ` · <span class="x">${esc(mult)}</span>` : ""}</p>${snap.hook ? `<p class="hook">${esc(snap.hook)}</p>` : ""}${row.note ? `<p class="note">${esc(row.note)}</p>` : ""}</article>`;
  }).join("");
  const packCards = packs.map((row) => {
    const who = personLabel(row.email, row.name);
    return `<article class="yt-card">${poster(row.poster, "")}<h2 class="title">${esc(row.title || row.url)}</h2><p class="meta">${esc(row.channel || "")} · ${esc(row.steal)}</p><span class="person"><span class="avatar">${esc(initials(who, row.email))}</span>${esc(who)}</span>${row.note ? `<p class="note">${esc(row.note)}</p>` : ""}${row.email === state.me.email || state.me.role === "admin" ? `<div class="actions"><button class="btn" type="button" data-pack-del="${esc(row.id)}">Delete</button></div>` : ""}</article>`;
  }).join("");
  const filters = ideas
    ? `<div class="chips" aria-label="Who saved">${ownerChips("owners")}</div><div class="chips"><button class="chip" data-pf="all" aria-pressed="${state.platformFilter === "all"}">All</button><button class="chip" data-pf="yt" aria-pressed="${state.platformFilter === "yt"}">YouTube long-form</button><button class="chip" data-pf="ig" aria-pressed="${state.platformFilter === "ig"}">Instagram Reels</button></div>`
    : `<form id="url-form" class="list"><label>Add from URL<input class="input" name="url" placeholder="youtube.com/watch or youtu.be"></label><div class="chips"><select class="select" name="steal"><option value="both">Title and thumbnail</option><option value="title">Title</option><option value="thumbnail">Thumbnail</option></select></div><label>Note<input class="input" name="note"></label><button class="btn btn-primary" type="submit">Add</button></form><div class="chips">${ownerChips("packOwners")}</div><div class="chips">${["all", "title", "thumbnail", "both"].map((tag) => `<button class="chip" data-tag="${tag}" aria-pressed="${state.packTag === tag}">${tag === "all" ? "All tags" : tag}</button>`).join("")}</div>`;
  return `<div class="view-head"><div><h2>Saved</h2><div class="seg"><button class="chip" type="button" data-saved-tab="ideas" aria-pressed="${ideas}">Video ideas</button><button class="chip" type="button" data-saved-tab="packaging" aria-pressed="${!ideas}">Packaging</button></div></div></div>${filters}<div class="list">${ideas ? ideaCards || `<p class="hint">Nothing saved yet.</p>` : packCards || `<p class="hint">No packaging notes yet.</p>`}</div>`;
}
function renderAdmin() {
  if (state.me.role !== "admin") return `<p>Admins only.</p>`;
  const rows = state.users.map((user) => `<div class="admin-row"><div><b>${esc(user.name || user.email)}</b><div class="hint">${esc(user.email)} · ${esc(user.role)}${user.disabled ? " · off" : ""}</div></div><button class="btn" data-role="${esc(user.email)}" data-next="${user.role === "admin" ? "member" : "admin"}">${user.role === "admin" ? "Make member" : "Make admin"}</button><button class="btn" data-disable="${esc(user.email)}" data-off="${user.disabled ? "0" : "1"}">${user.disabled ? "Enable" : "Disable"}</button><button class="btn" data-reset="${esc(user.email)}">Reset password</button><button class="btn" data-del="${esc(user.email)}">Delete</button></div>`).join("");
  return `<div class="view-head"><h2>People</h2></div><form id="add-user" class="list"><h2>Add user</h2><label>Email<input class="input" name="email" type="email" required></label><label>Name<input class="input" name="name" required></label><label>Role<select class="select" name="role"><option value="member">Member</option><option value="admin">Admin</option></select></label><label>Initial password<input class="input" name="password" type="text" required></label><button class="btn btn-primary" type="submit">Add</button><p id="admin-msg" class="err" hidden></p></form><div>${rows}</div>`;
}
function render() {
  const main = $("#main");
  $("#built-line").textContent = state.data ? updatedLine().split(" | ")[0].replace("Updated ", "Built ") : "";
  $("#about-copy").textContent = "Reels and YouTube lists load after sign-in. Saves live on the account. Watched stays in this browser.";
  $("#who").textContent = `${state.me.name || state.me.email} · ${state.me.role}`;
  $("#admin-btn").hidden = state.me.role !== "admin";
  $("#plat-ig").setAttribute("aria-pressed", String(state.platform === "ig" && location.hash !== "#saved" && location.hash !== "#admin"));
  $("#plat-yt").setAttribute("aria-pressed", String(state.platform === "yt" && location.hash !== "#saved" && location.hash !== "#admin"));
  const savedMode = location.hash === "#saved";
  const adminMode = location.hash === "#admin";
  $("#ig-nav").hidden = state.platform !== "ig" || savedMode || adminMode;
  if (adminMode) { main.innerHTML = renderAdmin(); return; }
  if (savedMode) { main.innerHTML = renderSaved(); return; }
  if (state.platform === "yt") { main.innerHTML = renderYoutube(); return; }
  if (state.ig === "explore") main.innerHTML = renderSimple(`Explore ${state.data.ig.explore.length}`, state.data.ig.explore.slice(0, 40), "ig");
  else if (state.ig === "inspire") main.innerHTML = renderSimple("Inspiration", state.data.ig.inspire, "ig");
  else if (state.ig === "shortlist") main.innerHTML = renderSimple(`Shortlist ${state.data.ig.shortlist.length}`, state.data.ig.shortlist, "ig");
  else main.innerHTML = renderPicks();
  $$("#ig-nav .tab").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.ig === state.ig)));
}
async function refreshSaves() {
  const payload = await api("/outlier/api/saves");
  const users = new Map((state.users.length ? state.users : [state.me]).map((user) => [user.email, user.name]));
  state.saves = payload.saves.map((row) => ({ ...row, name: users.get(row.email) || row.name || "" }));
  const swipe = await api("/outlier/api/swipe");
  state.swipe = swipe.items.map((row) => ({ ...row, name: users.get(row.email) || row.name || "" }));
}
async function bootApp() {
  state.data = await api("/outlier/api/data");
  if (state.me.role === "admin") {
    try { state.users = (await api("/outlier/api/admin/users")).users; } catch { state.users = []; }
  }
  await refreshSaves();
  $("#login").hidden = true;
  $("#app").hidden = false;
  if (!location.hash) location.hash = "#picks";
  render();
}
async function start() {
  try {
    state.me = await api("/outlier/api/me");
    await bootApp();
  } catch {
    $("#login").hidden = false;
    $("#app").hidden = true;
  }
}
$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  $("#login-error").hidden = true;
  try {
    state.me = await api("/outlier/api/login", { method: "POST", body: { email: form.get("email"), password: form.get("password") } });
    await bootApp();
  } catch (error) {
    $("#login-error").hidden = false;
    $("#login-error").textContent = error.message;
  }
});
$("#logout-btn").addEventListener("click", async () => { await api("/outlier/api/logout", { method: "POST", body: {} }); location.reload(); });
$("#account-btn").addEventListener("click", () => { const menu = $("#account-menu"); menu.hidden = !menu.hidden; $("#account-btn").setAttribute("aria-expanded", String(!menu.hidden)); });
$("#saved-btn").addEventListener("click", () => { location.hash = "#saved"; });
$("#admin-btn").addEventListener("click", () => { location.hash = "#admin"; $("#account-menu").hidden = true; });
$("#plat-ig").addEventListener("click", () => { state.platform = "ig"; if (location.hash === "#saved" || location.hash === "#admin") location.hash = "#picks"; else render(); });
$("#plat-yt").addEventListener("click", () => { state.platform = "yt"; if (location.hash === "#saved" || location.hash === "#admin") location.hash = "#youtube"; else { location.hash = "#youtube"; render(); } });
$("#pw-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    await api("/outlier/api/account/password", { method: "POST", body: { current: form.get("current"), next: form.get("next") } });
    $("#pw-msg").textContent = "Password changed.";
  } catch (error) { $("#pw-msg").textContent = error.message; }
});
window.addEventListener("hashchange", render);
document.addEventListener("click", async (event) => {
  if (event.target.closest("[data-close]")) { closeSheet(); return; }
  const ig = event.target.closest("[data-ig]");
  if (ig) { state.ig = ig.dataset.ig; state.platform = "ig"; location.hash = "#picks"; render(); return; }
  const seg = event.target.closest("[data-seg]");
  if (seg) { state.igSeg = seg.dataset.seg; render(); return; }
  const yt = event.target.closest("[data-yt]");
  if (yt) { state.yt = yt.dataset.yt; render(); return; }
  const savedTab = event.target.closest("[data-saved-tab]");
  if (savedTab) { state.savedTab = savedTab.dataset.savedTab; render(); return; }
  const pf = event.target.closest("[data-pf]");
  if (pf) { state.platformFilter = pf.dataset.pf; render(); return; }
  const tag = event.target.closest("[data-tag]");
  if (tag) { state.packTag = tag.dataset.tag; render(); return; }
  const owner = event.target.closest("[data-owner]");
  if (owner) {
    const set = state[owner.dataset.ownerSet];
    const key = owner.dataset.owner;
    if (key === "everyone") { set.clear(); set.add("everyone"); }
    else { set.delete("everyone"); if (set.has(key)) set.delete(key); else set.add(key); if (!set.size) set.add("mine"); }
    render();
    return;
  }
  const open = event.target.closest("[data-open]");
  if (open && !event.target.closest(".actions")) {
    const item = findItem(open.dataset.open, open.dataset.id);
    if (item) openSheet(detail(item, open.dataset.open));
    return;
  }
  const save = event.target.closest("[data-save]");
  if (save) {
    const [platform, id] = save.dataset.save.split(":");
    const item = findItem(platform, id);
    if (!item) return;
    const existing = mySave(platform, id);
    const note = $("#note") ? $("#note").value : (existing ? existing.note : "");
    const multiplier = item.multiplier ?? item.outlierX ?? item.medianX ?? null;
    const views = item.views ?? null;
    if (existing && !$("#note")) await api("/outlier/api/saves", { method: "DELETE", body: { platform, item_id: id } });
    else await api("/outlier/api/saves", { method: "PUT", body: { platform, item_id: id, note, snapshot: { title: item.title, creator: item.creator || item.channel, url: item.url, poster: item.poster, thumb_ref: `${platform}:${id}`, views, multiplier, hook: item.hook } } });
    await refreshSaves();
    render();
    if (!$("#sheet").hidden && item) openSheet(detail(item, platform));
    return;
  }
  const pack = event.target.closest("[data-pack]");
  if (pack) {
    const item = findItem("yt", pack.dataset.pack);
    openSheet(`<form id="pack-form"><h2>Save packaging</h2><p>${esc(item.title)}</p><label>What to steal<select class="select" name="steal"><option value="both">Title and thumbnail</option><option value="title">Title</option><option value="thumbnail">Thumbnail</option></select></label><label>Note<input class="input" name="note" placeholder="What to copy"></label><button class="btn btn-primary" type="submit">Save packaging</button></form>`);
    $("#pack-form").dataset.id = item.id;
    return;
  }
  const del = event.target.closest("[data-pack-del]");
  if (del) {
    await api("/outlier/api/swipe", { method: "DELETE", body: { id: del.dataset.packDel } });
    await refreshSaves();
    render();
  }
  const role = event.target.closest("[data-role]");
  if (role) {
    try { await api("/outlier/api/admin/users", { method: "PATCH", body: { email: role.dataset.role, role: role.dataset.next } }); state.users = (await api("/outlier/api/admin/users")).users; render(); }
    catch (error) { alert(error.message); }
  }
  const disable = event.target.closest("[data-disable]");
  if (disable) {
    try { await api("/outlier/api/admin/users", { method: "PATCH", body: { email: disable.dataset.disable, disabled: disable.dataset.off === "1" } }); state.users = (await api("/outlier/api/admin/users")).users; render(); }
    catch (error) { alert(error.message); }
  }
  const reset = event.target.closest("[data-reset]");
  if (reset) {
    const password = window.prompt("New password (8+ characters)");
    if (!password) return;
    try { await api("/outlier/api/admin/users", { method: "PATCH", body: { email: reset.dataset.reset, password } }); alert("Password reset."); }
    catch (error) { alert(error.message); }
  }
  const remove = event.target.closest("[data-del]");
  if (remove && window.confirm(`Delete ${remove.dataset.del}?`)) {
    try { await api("/outlier/api/admin/users", { method: "DELETE", body: { email: remove.dataset.del, confirm: true } }); state.users = (await api("/outlier/api/admin/users")).users; render(); }
    catch (error) { alert(error.message); }
  }
});
document.addEventListener("submit", async (event) => {
  if (event.target.id === "add-user") {
    event.preventDefault();
    const form = new FormData(event.target);
    try {
      await api("/outlier/api/admin/users", { method: "POST", body: { email: form.get("email"), name: form.get("name"), role: form.get("role"), password: form.get("password") } });
      state.users = (await api("/outlier/api/admin/users")).users;
      render();
    } catch (error) {
      const msg = $("#admin-msg");
      msg.hidden = false;
      msg.textContent = error.message;
    }
  }
  if (event.target.id === "pack-form") {
    event.preventDefault();
    const form = new FormData(event.target);
    const item = findItem("yt", event.target.dataset.id);
    try {
      await api("/outlier/api/swipe", { method: "POST", body: { steal: form.get("steal"), note: form.get("note"), card: { video_id: item.id, title: item.title, channel: item.creator, url: item.url, poster: item.poster } } });
      await refreshSaves();
      closeSheet();
    } catch (error) { alert(error.message); }
  }
  if (event.target.id === "url-form") {
    event.preventDefault();
    const form = new FormData(event.target);
    try {
      await api("/outlier/api/swipe", { method: "POST", body: { url: form.get("url"), steal: form.get("steal"), note: form.get("note") } });
      await refreshSaves();
      render();
    } catch (error) { alert(error.message); }
  }
});
start();
