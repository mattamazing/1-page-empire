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
  editing: "",
  candTier: "all",
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
function poster(src, extra = "", index = 99) {
  const wide = extra.includes("yt");
  const box = wide ? "yt-still" : "still";
  if (!src) return `<span class="${box} still-empty"><span class="still-fallback" aria-hidden="true"></span>${extra}</span>`;
  const eager = index < 4;
  const priority = index === 0 ? " fetchpriority=\"high\"" : "";
  return `<span class="${box}"><img alt="" src="${esc(src)}" loading="${eager ? "eager" : "lazy"}" decoding="async"${priority} referrerpolicy="no-referrer">${extra}</span>`;
}
function glyph(path) {
  return `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function myPack(videoId) {
  return state.swipe.find((row) => row.email === state.me.email && row.video_id === videoId);
}
function toast(message) {
  let el = $("#toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 2000);
}
function actions(item, platform) {
  const mine = mySave(platform, item.id);
  const packed = platform === "yt" ? myPack(item.id) : null;
  const compact = platform === "yt";
  const openIcon = compact ? glyph("M14 5h5v5M19 5l-8 8M16 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5") : "";
  const saveIcon = compact ? glyph("M6 3.5h12a1 1 0 0 1 1 1V21l-7-4-7 4V4.5a1 1 0 0 1 1-1z") : "";
  const packIcon = compact ? glyph("M4 8l8-4 8 4-8 4-8-4zM4 8v8l8 4 8-4V8") : "";
  const pack = platform === "yt" ? `<button class="btn" type="button" data-pack="${esc(item.id)}" aria-pressed="${packed ? "true" : "false"}">${packIcon}<span>${packed ? "Saved" : "Save packaging"}</span></button>` : "";
  return `<div class="actions${compact ? " actions-compact" : ""}">${item.url ? `<a class="btn btn-primary" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${openIcon}<span>Open</span></a>` : ""}<button class="btn" type="button" data-save="${platform}:${esc(item.id)}" aria-pressed="${mine ? "true" : "false"}">${saveIcon}<span>${mine ? "Saved" : "Save idea"}</span></button>${pack}</div>`;
}
function cardMenu(key, canEdit, canDelete) {
  if (!canEdit && !canDelete) return "";
  const edit = canEdit ? `<button type="button" data-edit-note="${esc(key)}">Edit note</button>` : "";
  const remove = canDelete ? `<button type="button" data-remove="${esc(key)}">Delete</button>` : "";
  return `<details class="more"><summary aria-label="More">⋯</summary><div class="more-pop">${edit}${remove}</div></details>`;
}
function noteBlock(key, note) {
  if (state.editing === key) return `<textarea class="note-box" data-note-key="${esc(key)}">${esc(note || "")}</textarea>`;
  return note ? `<p class="note">${esc(note)}</p>` : "";
}
function igMultiple(item) {
  const text = multiple(item.multiplier);
  if (!text) return "";
  if (item.legacy_mean) return text.replace(/x$/, "× mean");
  return text.replace(/x$/, "× median");
}
function baselineHtml(item) {
  if (item.median_views == null || item.sample_n == null) return "";
  if (item.mean_views != null && (item.why || item.rank != null)) {
    return `<p>Median ${esc(compact(item.median_views))} across ${esc(item.sample_n)} Reels <span class="sub">· mean ${esc(compact(item.mean_views))}</span></p>`;
  }
  return `<p>Median ${esc(compact(item.median_views))} · n ${esc(item.sample_n)}</p>`;
}
function tierBadge(tier) {
  const labels = { top10: "Top 10", strong: "Strong", rising: "Rising" };
  if (!labels[tier]) return "";
  return `<span class="tier tier-${tier}">${labels[tier]}</span>`;
}
function igCard(item, index = 99, opts = {}) {
  const days = when(item.published);
  const mult = igMultiple(item);
  const tier = opts.tier ? tierBadge(item.tier) : "";
  const rank = opts.tier ? "" : (item.rank ? `<span class="rank">${esc(item.rank)}</span>` : "");
  return `<article class="tile"><button class="tile-main" type="button" data-open="ig" data-id="${esc(item.id)}">${poster(item.poster, rank, index)}<span><span class="title">${esc(item.title || item.hook || "Untitled")}</span><span class="meta">${tier}<span>@${esc(item.creator || "")}</span>${mult ? `<span class="x">${esc(mult)}</span>` : ""}<span>${esc(days)}</span></span><span class="hook">${esc(item.hook || "")}</span></span></button>${actions(item, "ig")}</article>`;
}
function ytCard(item, index = 99) {
  const mult = multiple(item.multiplier);
  const badge = mult ? `<span class="yt-x">${esc(mult)} median</span>` : "";
  return `<article class="yt-card"><button class="yt-main" type="button" data-open="yt" data-id="${esc(item.id)}">${poster(item.poster, `yt${badge}`, index)}<span class="title">${esc(item.title)}</span><span class="meta">${esc(item.creator || item.channel || "")} · ${esc(compact(item.subs))} subs · ${esc(compact(item.views))} views · ${esc(when(item.published))}</span><span class="hook">${esc(item.hook || "")}</span></button>${actions(item, "yt")}</article>`;
}
function findItem(platform, id) {
  const ig = state.data.ig;
  const pools = platform === "ig"
    ? [...ig.picks, ...(ig.candidates || []), ...ig.history.flatMap((group) => group.picks), ...ig.explore, ...ig.inspire]
    : [...state.data.yt.mine, ...state.data.yt.peers, ...state.data.yt.broad, ...state.data.yt.big];
  return pools.find((item) => item.id === id);
}
function openSheet(html) {
  $("#sheet-body").innerHTML = html;
  const heading = $("#sheet-body h2");
  if (heading) heading.id = "sheet-title";
  $("#sheet").hidden = false;
}
function closeSheet() {
  $("#sheet").hidden = true;
  $("#sheet-body").innerHTML = "";
}
function detail(item, platform) {
  const twist = item.ai_twist ? `<section class="adapt"><span class="label">AI twist</span><p>${esc(item.ai_twist)}</p></section>` : "";
  const mult = platform === "ig" ? igMultiple(item) : multiple(item.multiplier);
  const multHtml = mult ? ` · <b>${esc(mult)}${platform === "yt" ? " median" : ""}</b>` : "";
  return `<article><h2>${esc(item.title || "Untitled")}</h2><p class="meta">${esc(item.creator || item.channel || "")} · ${esc(compact(item.views))} views · ${esc(when(item.published))}${multHtml}</p>${platform === "ig" ? baselineHtml(item) : ""}${actions(item, platform)}<p class="label">Hook</p><p class="big">${esc(item.hook || "No hook recorded.")}</p>${item.why ? `<p>${esc(item.why)}</p>` : ""}${twist}</article>`;
}
function renderPicks() {
  const picks = state.data.ig.picks;
  const fresh = picks.filter((item) => (daysOf(item.published) ?? 999) <= 30);
  const bench = picks.length - fresh.length;
  const segs = [["all", `All ${picks.length}`], ["previous", `Previous ${state.data.ig.history.reduce((n, group) => n + group.picks.length, 0)}`], ["fresh", `Recent ${fresh.length}`], ["bench", `Benchmarks ${bench}`]];
  let body = "";
  if (state.igSeg === "previous") {
    body = state.data.ig.history.map((group) => {
      const legacy = !(group.picks || []).some((item) => item.multiplier_basis === "median");
      const note = legacy ? `<span class="legacy-note">Scored on mean, before Nov 18.</span>` : "";
      return `<section><p class="hint">${esc(group.label)} · Retired ${esc(group.retired_on)}${note}</p><div class="list">${group.picks.map((item, index) => igCard({ ...item, legacy_mean: legacy }, index)).join("")}</div></section>`;
    }).join("");
  } else {
    const list = picks.filter((item) => {
      const days = daysOf(item.published) ?? 999;
      if (state.igSeg === "fresh") return days <= 30;
      if (state.igSeg === "bench") return days > 30;
      return true;
    });
    body = `<div class="list">${list.map((item, index) => igCard(item, index)).join("")}</div>`;
  }
  return `<div class="view-head"><div><h2>Top picks</h2><p class="updated">${esc(updatedLine())}</p></div><div class="seg">${segs.map(([key, label]) => `<button class="chip" type="button" data-seg="${key}" aria-pressed="${state.igSeg === key}">${label}</button>`).join("")}</div></div>${body}${candidatesSection()}`;
}
function candidatesSection() {
  const all = (state.data.ig.candidates || [])
    .filter((item) => item.tier !== "top10" && !item.in_top10)
    .slice()
    .sort((a, b) => (a.shortlist_rank || 999) - (b.shortlist_rank || 999));
  if (!all.length || state.igSeg === "previous") return "";
  const counts = { strong: 0, rising: 0 };
  all.forEach((item) => { if (counts[item.tier] != null) counts[item.tier] += 1; });
  const chips = [["all", `All ${all.length}`]];
  if (counts.strong) chips.push(["strong", `Strong ${counts.strong}`]);
  if (counts.rising) chips.push(["rising", `Rising ${counts.rising}`]);
  if (state.candTier !== "all" && !counts[state.candTier]) state.candTier = "all";
  const shown = state.candTier === "all" ? all : all.filter((item) => item.tier === state.candTier);
  const names = { strong: "Strong", rising: "Rising" };
  const body = shown.length
    ? `<div class="list grid">${shown.map((item, index) => igCard(item, index, { tier: true })).join("")}</div>`
    : `<p class="missing">No ${names[state.candTier] || "matching"} picks this week.</p>`;
  const row = chips.length > 1 ? `<div class="chips" role="group" aria-label="Tier">${chips.map(([key, label]) => `<button class="chip" type="button" data-cand="${key}" aria-pressed="${state.candTier === key}">${label}</button>`).join("")}</div>` : "";
  return `<section class="cands" aria-labelledby="cands-h"><div class="cands-head"><h2 id="cands-h">Candidates <span class="tcount">${all.length}</span></h2><p class="hint">Beyond this week's Top 10 · ranked by multiple of creator median · max 3 per creator</p></div>${row}${body}</section>`;
}
function renderSimple(title, items, platform) {
  const cards = items.map((item, index) => platform === "yt" ? ytCard(item, index) : igCard(item, index)).join("");
  return `<div class="view-head"><div><h2>${esc(title)}</h2><p class="updated">${esc(updatedLine())}</p></div></div><div class="list${platform === "yt" ? " yt-grid" : ""}">${cards || `<p class="hint">Nothing in this list.</p>`}</div>`;
}
function renderYoutube() {
  const lists = state.data.yt;
  const segs = [["mine", `My winners ${lists.mine.length}`], ["peers", `Peers ${lists.peers.length}`], ["broad", `Broad business ${lists.broad.length}`], ["big", `Big channels ${lists.big.length}`]];
  return `<div class="view-head"><div><h2>YouTube</h2><p class="updated">${esc(updatedLine())}</p></div><div class="seg">${segs.map(([key, label]) => `<button class="chip" type="button" data-yt="${key}" aria-pressed="${state.yt === key}">${label}</button>`).join("")}</div></div><div class="list yt-grid">${(lists[state.yt] || []).map((item, index) => ytCard(item, index)).join("")}</div>`;
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
function personRow(row) {
  const who = personLabel(row.email, row.name);
  return `<span class="person"><span class="avatar">${esc(initials(who, row.email))}</span>${esc(who)}</span>`;
}
function renderSaved() {
  const ideas = state.savedTab === "ideas";
  const rows = state.saves.filter((row) => allowRow(row.email, state.owners)).filter((row) => {
    if (state.platformFilter === "yt") return row.platform === "yt";
    if (state.platformFilter === "ig") return row.platform === "ig";
    return true;
  });
  const packs = state.swipe.filter((row) => allowRow(row.email, state.packOwners));
  const ideaCards = rows.map((row, index) => {
    const snap = row.snapshot || {};
    const key = `idea:${row.platform}:${row.item_id}`;
    const own = row.email === state.me.email;
    const foot = `<div class="card-foot">${personRow(row)}${cardMenu(key, own, own)}</div>${noteBlock(key, row.note)}`;
    if (row.platform === "yt") {
      const mult = multiple(snap.multiplier);
      const badge = mult ? `<span class="yt-x">${esc(mult)}</span>` : "";
      return `<article class="yt-card">${poster(snap.poster, `yt${badge}`, index)}<h2 class="title">${esc(snap.title || row.item_id)}</h2><p class="meta">${esc(snap.creator || "YouTube")}</p>${snap.hook ? `<p class="hook">${esc(snap.hook)}</p>` : ""}${foot}</article>`;
    }
    const mult = multiple(snap.multiplier);
    const eager = index < 4;
    const priority = index === 0 ? " fetchpriority=\"high\"" : "";
    return `<article class="poster-tile"><span class="poster-still">${snap.poster ? `<img alt="" src="${esc(snap.poster)}" loading="${eager ? "eager" : "lazy"}" decoding="async"${priority} referrerpolicy="no-referrer">` : ""}</span><h2 class="title">${esc(snap.title || row.item_id)}</h2><p class="meta">@${esc(snap.creator || "instagram")}${mult ? ` · <span class="x">${esc(mult)}</span>` : ""}</p>${foot}</article>`;
  }).join("");
  const packCards = packs.map((row, index) => {
    const key = `pack:${row.id}`;
    const own = row.email === state.me.email;
    return `<article class="yt-card">${poster(row.poster, "yt", index)}<h2 class="title">${esc(row.title || row.url)}</h2><p class="meta">${esc(row.channel || "")}</p><div class="card-foot">${personRow(row)}${cardMenu(key, own, own || state.me.role === "admin")}</div>${noteBlock(key, row.note)}</article>`;
  }).join("");
  const who = (setName) => `<div class="filter-group"><span class="filter-label" aria-hidden="true">Who</span><div class="chips" role="group" aria-label="Who saved">${ownerChips(setName)}</div></div>`;
  const filters = ideas
    ? `<div class="filters">${who("owners")}<div class="filter-group"><span class="filter-label" aria-hidden="true">Type</span><div class="chips" role="group" aria-label="Type"><button class="chip" data-pf="all" aria-pressed="${state.platformFilter === "all"}">All</button><button class="chip" data-pf="yt" aria-pressed="${state.platformFilter === "yt"}">YouTube long-form</button><button class="chip" data-pf="ig" aria-pressed="${state.platformFilter === "ig"}">Instagram Reels</button></div></div></div>`
    : `<button class="btn add-toggle" type="button" data-show-url>+ Add from URL</button><form id="url-form" class="url-row"><input class="input" name="url" placeholder="youtube.com/watch or youtu.be" aria-label="YouTube URL"><button class="btn btn-primary" type="submit">Add</button></form><div class="filters">${who("packOwners")}</div>`;
  const cards = ideas ? ideaCards : packCards;
  return `<div class="view-head"><div><h2>Saved</h2><div class="seg"><button class="chip" type="button" data-saved-tab="ideas" aria-pressed="${ideas}">Video ideas</button><button class="chip" type="button" data-saved-tab="packaging" aria-pressed="${!ideas}">Packaging</button></div></div></div>${filters}<div class="list yt-grid">${cards || `<p class="hint">${ideas ? "Nothing saved yet." : "No packaging ideas yet."}</p>`}</div>`;
}
function renderAdmin() {
  if (state.me.role !== "admin") return `<p>Admins only.</p>`;
  const rows = state.users.map((user) => `<div class="admin-row"><div><b>${esc(user.name || user.email)}</b><div class="hint">${esc(user.email)} · ${esc(user.role)}${user.disabled ? " · off" : ""}</div></div><button class="btn" data-role="${esc(user.email)}" data-next="${user.role === "admin" ? "member" : "admin"}">${user.role === "admin" ? "Make member" : "Make admin"}</button><button class="btn" data-disable="${esc(user.email)}" data-off="${user.disabled ? "0" : "1"}">${user.disabled ? "Enable" : "Disable"}</button><button class="btn" data-reset="${esc(user.email)}">Reset password</button><button class="btn" data-del="${esc(user.email)}">Delete</button></div>`).join("");
  return `<div class="view-head"><h2>People</h2></div><form id="add-user" class="panel-card"><h2>Add user</h2><label>Email<input class="input" name="email" type="email" required></label><label>Name<input class="input" name="name" required></label><label>Role<select class="select" name="role"><option value="member">Member</option><option value="admin">Admin</option></select></label><label>Initial password<input class="input" name="password" type="text" required></label><button class="btn btn-primary" type="submit">Add</button><p id="admin-msg" class="err" hidden></p></form><div>${rows}</div>`;
}
function render() {
  const main = $("#main");
  $("#built-line").textContent = state.data ? updatedLine().split(" | ")[0].replace("Updated ", "Built ") : "Built …";
  $("#about-copy").textContent = "Reels and YouTube lists load after sign-in. Saves live on the account. Watched stays in this browser.";
  const who = $("#who");
  if (who) who.textContent = `${state.me.name || state.me.email} · ${state.me.role}`;
  const adminBtn = $("#admin-btn");
  if (adminBtn) adminBtn.hidden = state.me.role !== "admin";
  $("#plat-ig").setAttribute("aria-pressed", String(state.platform === "ig" && location.hash !== "#saved" && location.hash !== "#admin"));
  $("#plat-yt").setAttribute("aria-pressed", String(state.platform === "yt" && location.hash !== "#saved" && location.hash !== "#admin"));
  $("#saved-btn").setAttribute("aria-pressed", String(location.hash === "#saved"));
  if ($("#admin-btn")) $("#admin-btn").setAttribute("aria-pressed", String(location.hash === "#admin"));
  const savedMode = location.hash === "#saved";
  const adminMode = location.hash === "#admin";
  $("#ig-nav").hidden = state.platform !== "ig" || savedMode || adminMode;
  main.setAttribute("aria-busy", state.data ? "false" : "true");
  if (!state.data) { main.innerHTML = skeleton(); return; }
  if (adminMode) { main.innerHTML = renderAdmin(); return; }
  if (savedMode) { main.innerHTML = renderSaved(); return; }
  if (state.platform === "yt") { main.innerHTML = renderYoutube(); return; }
  if (state.ig === "explore") main.innerHTML = renderSimple(`Explore ${state.data.ig.explore.length}`, state.data.ig.explore.slice(0, 40), "ig");
  else if (state.ig === "inspire") main.innerHTML = renderSimple("Inspiration", state.data.ig.inspire, "ig");
  else if (state.ig === "shortlist") main.innerHTML = renderSimple(`Shortlist ${state.data.ig.shortlist.length}`, state.data.ig.shortlist, "ig");
  else main.innerHTML = renderPicks();
  $$("#ig-nav .tab").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.ig === state.ig)));
}
const CACHE_DB = "outlier.bundle.v1";
function cacheDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("kv");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function cacheGet() {
  try {
    const db = await cacheDb();
    return await new Promise((resolve) => {
      const query = db.transaction("kv").objectStore("kv").get("bundle");
      query.onsuccess = () => resolve(query.result || null);
      query.onerror = () => resolve(null);
    });
  } catch { return null; }
}
async function cacheSet(etag, data) {
  try {
    const db = await cacheDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put({ etag, data }, "bundle");
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* a private browser can still use the network */ }
}
async function cacheClear() {
  await new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(CACHE_DB);
    request.onsuccess = resolve;
    request.onerror = resolve;
    request.onblocked = resolve;
  });
}
function skeletonTitle() {
  if (location.hash === "#saved") return "Saved";
  if (location.hash === "#admin") return "People";
  if (state.platform === "yt") return "YouTube";
  if (state.ig === "explore") return "Explore";
  if (state.ig === "inspire") return "Inspiration";
  if (state.ig === "shortlist") return "Shortlist";
  return "Top picks";
}
function skeleton() {
  const youtube = location.hash === "#saved" || state.platform === "yt";
  const chips = '<span class="sk sk-chip"></span><span class="sk sk-chip"></span><span class="sk sk-chip"></span>';
  const head = `<div class="view-head"><div><h2>${skeletonTitle()}</h2><span class="sk sk-updated"></span></div><div class="seg" aria-hidden="true">${chips}</div></div>`;
  if (location.hash === "#admin") return head;
  if (youtube) {
    const cards = Array.from({ length: 6 }, () => '<article class="yt-card skeleton-card" aria-hidden="true"><span class="yt-still sk"></span><span class="sk-copy"><span class="sk sk-line t1"></span><span class="sk sk-line t2"></span><span class="sk sk-line meta"></span><span class="sk sk-line h1"></span><span class="sk sk-line h2"></span></span><div class="sk-actions"><span class="sk sk-btn"></span><span class="sk sk-btn"></span><span class="sk sk-btn"></span></div></article>').join("");
    return `${head}<div class="list yt-grid">${cards}</div>`;
  }
  const tiles = Array.from({ length: 3 }, () => '<article class="tile skeleton-card" aria-hidden="true"><div class="tile-main"><span class="still sk"></span><span class="sk-copy"><span class="sk sk-line wide"></span><span class="sk sk-line mid"></span><span class="sk sk-line wide"></span><span class="sk sk-line mid"></span></span></div><div class="actions"><span class="sk sk-btn sm"></span><span class="sk sk-btn lg"></span></div></article>').join("");
  return `${head}<div class="list">${tiles}</div>`;
}
async function refreshSaves() {
  const users = new Map((state.users.length ? state.users : [state.me]).map((user) => [user.email, user.name]));
  const [payload, swipe] = await Promise.all([api("/outlier/api/saves"), api("/outlier/api/swipe")]);
  state.saves = payload.saves.map((row) => ({ ...row, name: users.get(row.email) || row.name || "" }));
  state.swipe = swipe.items.map((row) => ({ ...row, name: users.get(row.email) || row.name || "" }));
}
async function revalidate(cached) {
  if (cached && cached.etag) {
    const probe = await fetch("/outlier/api/data/version", { credentials: "same-origin", headers: { "if-none-match": cached.etag } });
    if (probe.status === 304) return;
    if (probe.ok) {
      const version = await probe.json();
      if (version.etag === cached.etag) return;
    }
  }
  const headers = cached && cached.etag ? { "if-none-match": cached.etag } : {};
  const response = await fetch("/outlier/api/data", { credentials: "same-origin", headers });
  if (response.status === 304) return;
  if (!response.ok) {
    if (!state.data) throw new Error("The research bundle is not loaded yet.");
    return;
  }
  state.data = await response.json();
  await cacheSet(response.headers.get("etag"), state.data);
  render();
}
async function bootApp() {
  $("#login").hidden = true;
  $("#app").hidden = false;
  if (!location.hash) location.hash = "#picks";
  const cached = await cacheGet();
  if (cached && cached.data) {
    state.data = cached.data;
    render();
  } else {
    render();
  }
  const jobs = [
    revalidate(cached),
    refreshSaves().then(() => { if (state.data) render(); }).catch(() => {}),
  ];
  if (state.me.role === "admin") {
    jobs.push(api("/outlier/api/admin/users").then((payload) => { state.users = payload.users; }).catch(() => { state.users = []; }));
  }
  await Promise.all(jobs);
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
$("#account-btn").addEventListener("click", () => {
  const admin = state.me.role === "admin" ? `<button class="btn" id="admin-btn" type="button" aria-pressed="${location.hash === "#admin"}">Admin</button>` : "";
  openSheet(`<h2>Account</h2><p class="who" id="who">${esc(state.me.name || state.me.email)} · ${esc(state.me.role)}</p><form id="pw-form"><label>Current<input class="input" name="current" type="password" autocomplete="current-password"></label><label>New<input class="input" name="next" type="password" autocomplete="new-password"></label><button class="btn" type="submit">Change password</button><p id="pw-msg" class="hint"></p></form>${admin}<button class="btn" id="logout-btn" type="button">Log out</button>`);
});
$("#saved-btn").addEventListener("click", () => { location.hash = "#saved"; });
$("#plat-ig").addEventListener("click", () => { state.platform = "ig"; if (location.hash === "#saved" || location.hash === "#admin") location.hash = "#picks"; else render(); });
$("#plat-yt").addEventListener("click", () => { state.platform = "yt"; if (location.hash === "#saved" || location.hash === "#admin") location.hash = "#youtube"; else { location.hash = "#youtube"; render(); } });
window.addEventListener("hashchange", render);
document.addEventListener("click", async (event) => {
  if (event.target.closest("[data-close]")) { closeSheet(); return; }
  const ig = event.target.closest("[data-ig]");
  if (ig) { state.ig = ig.dataset.ig; state.platform = "ig"; location.hash = "#picks"; render(); return; }
  const seg = event.target.closest("[data-seg]");
  if (seg) { state.igSeg = seg.dataset.seg; render(); return; }
  const cand = event.target.closest("[data-cand]");
  if (cand) { state.candTier = cand.dataset.cand; render(); return; }
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
    const multiplier = item.multiplier ?? item.outlierX ?? item.medianX ?? null;
    const views = item.views ?? null;
    if (existing) {
      await api("/outlier/api/saves", { method: "DELETE", body: { platform, item_id: id } });
      toast("Removed from saved");
    } else {
      await api("/outlier/api/saves", { method: "PUT", body: { platform, item_id: id, note: "", snapshot: { title: item.title, creator: item.creator || item.channel, url: item.url, poster: item.poster, thumb_ref: `${platform}:${id}`, views, multiplier, hook: item.hook } } });
      toast("Saved");
    }
    await refreshSaves();
    render();
    if (!$("#sheet").hidden) openSheet(detail(item, platform));
    return;
  }
  const pack = event.target.closest("[data-pack]");
  if (pack) {
    const item = findItem("yt", pack.dataset.pack);
    if (!item) return;
    const existing = myPack(item.id);
    if (existing) {
      await api("/outlier/api/swipe", { method: "DELETE", body: { id: existing.id } });
      toast("Removed from packaging");
    } else {
      await api("/outlier/api/swipe", { method: "POST", body: { steal: "both", note: "", card: { video_id: item.id, title: item.title, channel: item.creator || item.channel, url: item.url, poster: item.poster } } });
      toast("Packaging saved");
    }
    await refreshSaves();
    render();
    if (!$("#sheet").hidden) openSheet(detail(item, "yt"));
    return;
  }
  const editNote = event.target.closest("[data-edit-note]");
  if (editNote) {
    state.editing = editNote.dataset.editNote;
    render();
    const box = $(".note-box");
    if (box) box.focus();
    return;
  }
  const remove = event.target.closest("[data-remove]");
  if (remove) {
    const [kind, a, b] = remove.dataset.remove.split(":");
    if (kind === "pack") await api("/outlier/api/swipe", { method: "DELETE", body: { id: a } });
    else await api("/outlier/api/saves", { method: "DELETE", body: { platform: a, item_id: b } });
    toast("Deleted");
    await refreshSaves();
    render();
    return;
  }
  if (event.target.closest("[data-show-url]")) {
    $("#url-form").classList.toggle("open");
    return;
  }
  if (event.target.closest("#logout-btn")) {
    await cacheClear();
    await api("/outlier/api/logout", { method: "POST", body: {} });
    location.reload();
    return;
  }
  if (event.target.closest("#admin-btn")) {
    location.hash = "#admin";
    closeSheet();
    return;
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
  const delUser = event.target.closest("[data-del]");
  if (delUser && window.confirm(`Delete ${delUser.dataset.del}?`)) {
    try { await api("/outlier/api/admin/users", { method: "DELETE", body: { email: delUser.dataset.del, confirm: true } }); state.users = (await api("/outlier/api/admin/users")).users; render(); }
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
  if (event.target.id === "pw-form") {
    event.preventDefault();
    const form = new FormData(event.target);
    try {
      await api("/outlier/api/account/password", { method: "POST", body: { current: form.get("current"), next: form.get("next") } });
      $("#pw-msg").textContent = "Password changed.";
    } catch (error) { $("#pw-msg").textContent = error.message; }
  }
  if (event.target.id === "url-form") {
    event.preventDefault();
    const form = new FormData(event.target);
    try {
      await api("/outlier/api/swipe", { method: "POST", body: { url: form.get("url"), steal: "both", note: "" } });
      event.target.reset();
      toast("Packaging saved");
      await refreshSaves();
      render();
    } catch (error) { alert(error.message); }
  }
});
document.addEventListener("focusout", async (event) => {
  const box = event.target.closest ? event.target.closest(".note-box") : null;
  if (!box) return;
  const key = box.dataset.noteKey || "";
  const value = box.value;
  state.editing = "";
  try {
    if (key.startsWith("pack:")) {
      await api("/outlier/api/swipe", { method: "PATCH", body: { id: key.slice(5), note: value } });
    } else if (key.startsWith("idea:")) {
      const [, platform, itemId] = key.split(":");
      const row = state.saves.find((item) => item.platform === platform && item.item_id === itemId && item.email === state.me.email);
      if (!row) return;
      await api("/outlier/api/saves", { method: "PUT", body: { platform, item_id: itemId, note: value, snapshot: row.snapshot } });
    }
    toast("Note saved");
    await refreshSaves();
    render();
  } catch (error) { alert(error.message); }
});
start();
