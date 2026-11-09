/* Reel desk. Filters stay in the browser. Cards first; method stays behind a tap. */
(function () {
  "use strict";
  const R = window.ReelDesk;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const CHICAGO = "America/Chicago";
  const TABS = ["model", "explore", "cross", "shortlist", "saved", "creators", "coverage", "method"];

  function fmtStamp(iso, withTime) {
    if (!iso) return "—";
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(iso));
    const d = new Date(dateOnly ? iso + "T12:00:00-06:00" : iso);
    if (Number.isNaN(d.getTime())) return "—";
    const opts = { timeZone: CHICAGO, month: "short", day: "numeric" };
    if (withTime !== false && !dateOnly) {
      opts.year = "numeric";
      opts.hour = "numeric";
      opts.minute = "2-digit";
      opts.timeZoneName = "short";
    }
    return new Intl.DateTimeFormat("en-US", opts).format(d);
  }
  function fmtX(x) {
    if (x == null || Number.isNaN(Number(x))) return "—";
    return Number(x).toFixed(2) + "×";
  }
  function pill(cls, text) {
    return '<span class="pill ' + cls + '">' + esc(text) + "</span>";
  }
  function safeUrl(url) {
    return /^https?:\/\//i.test(String(url || "")) ? String(url) : "";
  }
  function extLink(url, text) {
    const href = safeUrl(url);
    if (!href) return esc(text);
    return '<a class="btn btn-primary" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(text) + '<span class="sr-only"> (opens in new tab)</span></a>';
  }
  function posterHTML(url, rank) {
    const src = /^data:image\//i.test(String(url || "")) || safeUrl(url) ? String(url) : "";
    const img = src ? '<img alt="" src="' + esc(src) + '" loading="lazy" decoding="async" referrerpolicy="no-referrer">' : "";
    return '<span class="still">' + img + '<span class="still-fallback" aria-hidden="true"></span>' +
      (rank != null ? '<span class="rank">' + esc(String(rank)) + "</span>" : "") + "</span>";
  }
  function saveIcon(on) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18"><path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4-7 4V4.5a1 1 0 0 1 1-1z" fill="' + (on ? "currentColor" : "none") + '" stroke="currentColor" stroke-width="1.8"/></svg>';
  }
  function faceActions(url, id) {
    const watch = safeUrl(url) ? extLink(url, "Watch") : '<span class="btn" aria-disabled="true">No link</span>';
    const saved = Store.has("saved", id);
    return '<div class="tile-actions">' + watch +
      '<button class="icon-btn" type="button" data-mark="saved" data-id="' + esc(id) + '" aria-pressed="' + saved + '" aria-label="' + (saved ? "Saved" : "Save") + '">' +
      saveIcon(saved) + "</button></div>";
  }
  function detailActions(url, id) {
    const watch = safeUrl(url) ? extLink(url, "Watch") : '<span class="btn" aria-disabled="true">No link</span>';
    const saved = Store.has("saved", id);
    const watched = Store.has("watched", id);
    return '<div class="v-actions">' + watch +
      (safeUrl(url) ? '<button class="btn" type="button" data-copy="' + esc(url) + '">Copy</button>' : "") +
      '<button class="btn" type="button" data-mark="saved" data-id="' + esc(id) + '" aria-pressed="' + saved + '">' + (saved ? "Saved" : "Save") + "</button>" +
      '<button class="btn" type="button" data-mark="watched" data-id="' + esc(id) + '" aria-pressed="' + watched + '">' + (watched ? "Watched" : "Mark watched") + "</button></div>";
  }
  function humanFileStatus(status) {
    const text = String(status || "");
    if (!text || /pending/i.test(text)) return "Not collected";
    if (/collect|candidate/i.test(text)) return "Collected";
    return "Recorded";
  }

  const Store = (() => {
    const KEY = "reelDesk.marks.v1";
    let data = { saved: {}, watched: {} };
    let persistent = false;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        data = { saved: parsed.saved || {}, watched: parsed.watched || {} };
      }
      localStorage.setItem(KEY, JSON.stringify(data));
      persistent = true;
    } catch (err) {
      persistent = false;
    }
    function write() {
      if (!persistent) return;
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (err) { persistent = false; }
    }
    return {
      get persistent() { return persistent; },
      has(kind, id) { return !!(id && data[kind] && data[kind][id]); },
      toggle(kind, id) {
        if (!id) return false;
        if (data[kind][id]) delete data[kind][id];
        else data[kind][id] = new Date().toISOString();
        write();
        return !!data[kind][id];
      }
    };
  })();

  let toastTimer;
  function toast(msg, opts) {
    opts = opts || {};
    const t = $("#toast");
    if (!t) return;
    clearTimeout(toastTimer);
    if (opts.fallback) {
      t.innerHTML = esc(msg) + '<button class="btn" type="button" data-toast-close>Close</button><input readonly aria-label="Link to copy" value="' + esc(opts.fallback) + '">';
      t.classList.add("show");
      const inp = $("input", t);
      inp.focus();
      inp.select();
      $("[data-toast-close]", t).onclick = () => t.classList.remove("show");
      toastTimer = setTimeout(() => t.classList.remove("show"), 12000);
    } else {
      t.textContent = msg;
      t.classList.add("show");
      toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
    }
  }
  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) { /* fallback */ }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      if (ok) return true;
    } catch (err) { /* give up */ }
    return false;
  }

  let VM = null;
  let lastFocus = null;
  const range = { minRaw: R.DEFAULT_RANGE.minRaw, maxRaw: R.DEFAULT_RANGE.maxRaw };
  const exp = Object.assign({}, R.EXP_DEFAULT);
  const cre = { review: "", analysis: "", topic: "", q: "" };
  const recState = { age: "all", hideWatched: false, sel: null, histCode: null };
  const crossState = { source: "", staging: false, paid: "any", q: "" };

  function parsedRange() { return R.parseRange(range.minRaw, range.maxRaw); }
  function storageLine() {
    return Store.persistent ? "Saved and watched stay in this browser only." : "Marks won't be kept: this browser blocks local storage.";
  }

  function renderFreshness() {
    $("#built-line").textContent = "Built " + fmtStamp(VM.build.iso, true);
    const snaps = VM.baselines.map((b) => b.snapshotLocal).filter(Boolean).sort();
    $("#freshness").innerHTML =
      "<div><dt>Page built</dt><dd>" + esc(fmtStamp(VM.build.iso, true)) + "</dd></div>" +
      "<div><dt>Outlier baseline</dt><dd>" + esc(VM.baselineStrip) + "</dd></div>" +
      "<div><dt>Scan dates</dt><dd>" + esc(snaps.length ? fmtStamp(snaps[0], false) + " – " + fmtStamp(snaps[snaps.length - 1], false) : "—") + "</dd></div>" +
      "<div><dt>Weekly refresh</dt><dd>" + esc(VM.weeklyRefresh) + "</dd></div>";
  }

  function showTab(id, focusTab) {
    if (!TABS.includes(id)) id = "model";
    if ($("#sheet") && !$("#sheet").hidden) closeSheet();
    $$(".tab").forEach((tab) => {
      const on = tab.dataset.tab === id;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
      if (on && focusTab) tab.focus();
    });
    $$('[role="tabpanel"]').forEach((panel) => { panel.hidden = panel.id !== "p-" + id; });
    if (location.hash.slice(1) !== id) history.replaceState(null, "", "#" + id);
    if (id === "explore") renderExplorer();
    if (id === "creators") renderCreators();
    if (id === "saved") renderSaved();
    if (id === "cross") renderCross();
  }

  function openSheet(html, title) {
    lastFocus = document.activeElement;
    $("#sheet-body").innerHTML = html;
    const heading = $("#sheet-body h2");
    if (heading) heading.id = "sheet-title";
    $("#sheet").hidden = false;
    $("#sheet-panel").focus();
    document.body.style.overflow = "hidden";
  }
  function closeSheet() {
    $("#sheet").hidden = true;
    $("#sheet-body").innerHTML = "";
    document.body.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function pickCard(rec, scope) {
    const preview = R.pickPreview(rec);
    const rc = R.recencyFromElapsed(rec.elapsed, false);
    const saved = Store.has("saved", rec.code);
    const watched = Store.has("watched", rec.code);
    const historyCard = scope === "history";
    const current = historyCard ? rec.code === recState.histCode : rec.rank === recState.sel;
    return '<li class="tile"><button type="button" class="tile-main vcard rail-item" data-rank="' + rec.rank + '" data-id="' + esc(rec.code || "") + '" data-open="' + (historyCard ? "history" : "pick") + '" aria-current="' + current + '">' +
      posterHTML(rec.poster, rec.rank) +
      '<span class="tile-copy"><span class="v-title">' + esc(preview) + '</span><span class="v-meta">@' + esc(rec.handle) +
      " · " + esc(fmtStamp(rec.published, false)) + ' · <span class="xfig"><b>' + fmtX(rec.x) + '</b></span> ' +
      pill(rc.key === "fresh" ? "p-fresh" : "p-bench", rc.short) +
      (rec.paid ? pill("p-paid", "Paid") : "") +
      (saved ? pill("p-fresh", "Saved") : "") + (watched ? pill("p-neutral", "Watched") : "") +
      "</span></span></button>" + faceActions(rec.url, rec.code) + "</li>";
  }
  function pickDetail(rec) {
    const spoken = rec.hooks.spoken || { src: "missing" };
    const onScreen = rec.hooks.onscreen || { src: "missing" };
    const visual = rec.hooks.visual || { src: "missing" };
    const line = (label, hook) => {
      const missing = !hook.text || hook.src === "missing";
      const none = hook.src === "none";
      const body = missing ? "Not recorded." : none ? (label === "Spoken" ? "No spoken opening." : "None.") : hook.text;
      return "<dt><span class=\"label\">" + label + "</span></dt><dd><p" + (missing ? ' class="missing"' : "") + ">" + esc(body) + "</p>" +
        (hook.note ? '<p class="hint">' + esc(hook.note) + "</p>" : "") + "</dd>";
    };
    return '<article class="detail"><p class="label">Pick ' + rec.rank + "</p><h2>" + esc(R.pickPreview(rec)) + "</h2>" +
      "<p class=\"v-meta\">@" + esc(rec.handle) + " · " + esc(fmtStamp(rec.published, true)) +
      ' <span class="xfig"><b>' + fmtX(rec.x) + "</b><span>own avg</span></span></p>" +
      detailActions(rec.url, rec.code) +
      '<section class="adapt"><span class="label">Your adaptation, a draft idea, not a quote</span><p class="big">' + esc(rec.adapt || "Not recorded for this pick.") + "</p></section>" +
      "<h3>Why it's worth modeling</h3><p>" + esc(rec.why || "Not recorded.") + "</p>" +
      "<h3>How it opens</h3><dl class=\"hooks\">" + line("Spoken", spoken) + line("On-screen", onScreen) + line("Visual", visual) + "</dl>" +
      rec.cautions.map((c) => '<div class="caution ' + (c.kind === "paid" ? "c-paid" : "c-warn") + '">' + pill(c.kind === "paid" ? "p-paid" : "p-warn", c.kind === "paid" ? "Commercial" : "Caution") + "<p>" + esc(c.text) + "</p></div>").join("") +
      "<details><summary class=\"label\">Performance evidence</summary><p>" + esc(R.fmtInt(rec.views)) + " views, measured " + esc(fmtStamp(rec.views_asof, true)) +
      ". Mean " + esc(R.fmtInt(rec.mean)) + " across " + esc(R.fmtInt(rec.n)) + " Reels (" + esc(rec.baselineLabel) + "). Followers " + esc(R.fmtInt(rec.followers)) +
      ", measured " + esc(fmtStamp(rec.followers_asof, true)) + ". The multiple did not set the rank.</p></details></article>";
  }

  function historyPicks() {
    return (VM.history || []).flatMap((set) => set.picks);
  }
  function retiredLabel(iso) {
    if (!iso) return "";
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(iso));
    const d = new Date(dateOnly ? iso + "T12:00:00-06:00" : iso);
    if (Number.isNaN(d.getTime())) return "";
    return "Retired " + new Intl.DateTimeFormat("en-US", { timeZone: CHICAGO, month: "short", day: "numeric", year: "numeric" }).format(d);
  }
  function visibleRecs() {
    return VM.recs.filter((rec) => {
      const key = R.recencyFromElapsed(rec.elapsed, false).key;
      if (recState.age === "fresh" && key !== "fresh") return false;
      if (recState.age === "bench" && key !== "bench") return false;
      if (recState.hideWatched && Store.has("watched", rec.code)) return false;
      return true;
    });
  }
  function renderModel() {
    const fresh = VM.recs.filter((rec) => R.recencyFromElapsed(rec.elapsed, false).key === "fresh").length;
    const bench = VM.recs.filter((rec) => R.recencyFromElapsed(rec.elapsed, false).key === "bench").length;
    const previousCount = historyPicks().length;
    if (recState.age === "previous" && !previousCount) recState.age = "all";
    const segments = [["all", "All " + VM.recs.length]];
    if (previousCount) segments.push(["previous", "Previous " + previousCount]);
    segments.push(["fresh", "Recent " + fresh], ["bench", "Benchmarks " + bench]);
    $("#rec-age").innerHTML = segments
      .map(([key, label]) => '<button type="button" data-age="' + key + '" aria-pressed="' + (recState.age === key) + '">' + label + "</button>").join("");
    $("#tc-model").textContent = String(VM.recs.length);
    $("#storage-note").textContent = storageLine();
    if (recState.age === "previous") {
      const groups = (VM.history || []).map((set) => {
        const picks = set.picks.filter((rec) => !(recState.hideWatched && Store.has("watched", rec.code)));
        if (!picks.length) return "";
        const when = retiredLabel(set.retiredAt || set.retiredOn);
        return '<li class="history-set"><p class="set-label">' + esc(set.label) + (when ? " · " + esc(when) : "") + '</p><ol class="vlist">' +
          picks.map((rec) => pickCard(rec, "history")).join("") + "</ol></li>";
      }).join("");
      $("#rail").className = "vlist history";
      $("#rail").innerHTML = groups || '<li><p class="missing">No picks in this filter. <button class="btn" type="button" id="rec-reset">Show all picks</button></p></li>';
      const reset = $("#rec-reset");
      if (reset) reset.onclick = () => { recState.age = "all"; recState.hideWatched = false; $("#rec-hide-watched").checked = false; renderModel(); };
      return;
    }
    const list = visibleRecs();
    if (!list.length) {
      $("#rail").className = "vlist";
      $("#rail").innerHTML = '<li><p class="missing">No picks in this filter. <button class="btn" type="button" id="rec-reset">Show all picks</button></p></li>';
      const reset = $("#rec-reset");
      if (reset) reset.onclick = () => { recState.age = "all"; recState.hideWatched = false; $("#rec-hide-watched").checked = false; renderModel(); };
      return;
    }
    if (!list.some((rec) => rec.rank === recState.sel)) recState.sel = list[0].rank;
    $("#rail").className = "vlist";
    $("#rail").innerHTML = list.map((rec) => pickCard(rec)).join("");
  }

  function exploreCard(row) {
    const id = row.code || row.url;
    return '<div class="tile"><button type="button" class="tile-main vcard" data-open="explore" data-id="' + esc(id) + '">' +
      posterHTML(row.poster) +
      '<span class="tile-copy"><span class="v-title">' + (row.caption ? esc(row.caption) : '<span class="missing">No caption recorded.</span>') + "</span>" +
      '<span class="v-meta">@' + esc(row.handle) + " · " + esc(fmtStamp(row.published, false)) + ' · <span class="xfig"><b>' + fmtX(row.x) + "</b></span>" +
      (row.flags.includes("paid") ? pill("p-paid", "Paid") : "") +
      (Store.has("saved", id) ? pill("p-fresh", "Saved") : "") + "</span></span></button>" + faceActions(row.url, id) + "</div>";
  }
  function exploreDetail(row) {
    const id = row.code || row.url;
    return '<article class="detail"><p class="label">Caption, not a spoken hook</p><h2>' + esc(row.caption || "No caption text recorded.") + "</h2>" +
      "<p class=\"v-meta\">@" + esc(row.handle) + " · " + esc(fmtStamp(row.published, true)) + ' <span class="xfig"><b>' + fmtX(row.x) + "</b><span>own avg</span></span></p>" +
      detailActions(row.url, id) +
      "<p>" + esc(R.fmtInt(row.views)) + " views. Mean " + esc(R.fmtInt(row.mean)) + " · n " + esc(R.fmtInt(row.n)) + ". Followers " + esc(R.fmtInt(row.followers)) + ".</p>" +
      "<p class=\"hint\">This text is the caption. It has not been checked against the video.</p></article>";
  }

  function activeFilterCount() {
    const parsed = parsedRange();
    if (parsed.error) return "(fix range)";
    let n = 0;
    if (range.minRaw !== R.DEFAULT_RANGE.minRaw || range.maxRaw !== R.DEFAULT_RANGE.maxRaw) n += 1;
    if (exp.minX !== R.EXP_DEFAULT.minX) n += 1;
    if (exp.creator) n += 1;
    if (exp.topic) n += 1;
    if (exp.q) n += 1;
    if (exp.date !== "any") n += 1;
    if (!exp.strong) n += 1;
    return n ? "(" + n + " changed)" : "";
  }
  function syncRange(prefix) {
    const minI = $("#" + prefix + "-min");
    const maxI = $("#" + prefix + "-max");
    if (!minI || !maxI) return;
    if (document.activeElement !== minI) minI.value = range.minRaw;
    if (document.activeElement !== maxI) maxI.value = range.maxRaw;
    const parsed = parsedRange();
    const msg = $("#" + prefix + "-rmsg");
    minI.setAttribute("aria-invalid", String(!!parsed.error && (parsed.field === "min" || parsed.field === "both")));
    maxI.setAttribute("aria-invalid", String(!!parsed.error && (parsed.field === "max" || parsed.field === "both")));
    msg.className = parsed.error ? "err" : "hint";
    msg.textContent = R.describeRange(parsed);
    const match = R.presetMatch(parsed);
    $$("#" + prefix + "-presets button").forEach((button, i) => button.setAttribute("aria-pressed", String(match === R.PRESETS[i].id)));
  }
  function onRangeEdited() {
    exp.limit = 50;
    syncRange("exp");
    syncRange("cre");
    if (!$("#p-explore").hidden) renderExplorer();
    if (!$("#p-creators").hidden) renderCreators();
  }
  function rangeHTML(prefix) {
    return '<div class="range"><span class="label" id="' + prefix + '-rlbl">Followers, shared by Explore and Creators</span><div class="range-inputs" role="group" aria-labelledby="' + prefix + '-rlbl">' +
      '<label class="sr-only" for="' + prefix + '-min">Minimum followers</label><input class="input" id="' + prefix + '-min" inputmode="text" autocomplete="off" placeholder="No minimum" aria-describedby="' + prefix + '-rmsg">' +
      "<span>to</span>" +
      '<label class="sr-only" for="' + prefix + '-max">Maximum followers</label><input class="input" id="' + prefix + '-max" inputmode="text" autocomplete="off" placeholder="No maximum" aria-describedby="' + prefix + '-rmsg">' +
      '<div class="seg" id="' + prefix + '-presets">' + R.PRESETS.map((preset, i) => '<button type="button" data-preset="' + i + '">' + preset.label + "</button>").join("") +
      '</div></div><p id="' + prefix + '-rmsg" class="hint" aria-live="polite"></p></div>';
  }
  function renderExplorer() {
    syncRange("exp");
    $("#f-active").textContent = activeFilterCount();
    $$("#exp-minx button").forEach((button) => button.setAttribute("aria-pressed", String(+button.dataset.x === exp.minX)));
    $$("#exp-date button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.d === exp.date)));
    $$("#exp-sorts button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.sort === exp.sort)));
    const sortSel = $("#m-sort");
    if (sortSel) sortSel.value = exp.sort + ":" + exp.dir;
    const result = R.filterReels(VM.reels, exp, parsedRange());
    const out = $("#exp-results");
    const count = $("#exp-count");
    if (result.error) {
      count.textContent = "Results paused";
      out.innerHTML = '<div class="empty"><h3>Fix the follower range</h3><p>' + esc(result.error) + '</p><button class="btn" type="button" id="exp-fixrange">Reset follower range</button></div>';
      $("#exp-fixrange").onclick = () => { range.minRaw = R.DEFAULT_RANGE.minRaw; range.maxRaw = R.DEFAULT_RANGE.maxRaw; renderExplorer(); };
      return;
    }
    const rows = result.rows;
    const shown = rows.slice(0, exp.limit);
    count.textContent = (rows.length ? rows.length + (rows.length === 1 ? " Reel matches" : " Reels match") : "No Reels match") +
      (shown.length < rows.length ? ", showing " + shown.length : "") +
      (result.hiddenUnknown ? ". " + result.hiddenUnknown + " hidden because follower count was not measured." : "");
    if (!rows.length) {
      out.innerHTML = '<p class="missing">No Reels match. Reset filters or widen the range.</p><button class="btn" type="button" id="exp-empty-reset">Reset filters</button>';
      $("#exp-empty-reset").onclick = resetExplorer;
      return;
    }
    out.innerHTML = '<div class="vlist">' + shown.map(exploreCard).join("") + "</div>" +
      (shown.length < rows.length ? '<div class="more"><button class="btn" type="button" id="exp-more">Show ' + Math.min(50, rows.length - shown.length) + " more</button></div>" : "");
    const more = $("#exp-more");
    if (more) more.onclick = () => { exp.limit += 50; renderExplorer(); };
  }
  function resetExplorer() {
    Object.assign(exp, R.EXP_DEFAULT);
    range.minRaw = R.DEFAULT_RANGE.minRaw;
    range.maxRaw = R.DEFAULT_RANGE.maxRaw;
    $("#exp-creator").value = "";
    $("#exp-topic").value = "";
    $("#exp-q").value = "";
    $("#exp-strong").checked = true;
    renderExplorer();
    toast("Filters reset, including the shared follower range");
  }

  function crossPreview(card) {
    return R.inspirationPreview(card);
  }
  function crossCard(card) {
    const preview = crossPreview(card);
    const audioNote = card.hooks.spoken.status === "caption_track_derived" ? pill("p-warn", card.hooks.spoken.statusLabel) : "";
    const role = /breakout/i.test(card.cardRole) ? pill("p-bench", "Long-form benchmark") : "";
    return '<div class="tile"><button type="button" class="tile-main vcard" data-open="cross" data-id="' + esc(card.id) + '">' +
      posterHTML(card.poster) +
      '<span class="tile-copy"><span class="v-title">' + esc(preview.text) + '</span><span class="v-meta">' + esc(card.creator || "Creator not recorded") +
      " · " + esc(card.sourceKey === "tiktok_search" ? "Search" : "Explore") + " " + audioNote + role +
      pill("p-outline", card.paid.label) + "</span></span></button>" + faceActions(card.postUrl, card.id || card.dedupeKey) + "</div>";
  }
  function crossDetail(card) {
    const field = (label, hook) => "<dt><span class=\"label\">" + label + "</span><span class=\"kind-sub\">" + esc(hook.statusLabel) + "</span></dt><dd><p>" +
      esc(hook.value || "Not recorded.") + "</p>" + (hook.verbatim ? "<p>" + esc(hook.verbatim) + "</p>" : "") +
      (hook.timestamp ? '<p class="hint">' + esc(hook.timestamp) + "</p>" : "") +
      (hook.source ? '<p class="hint">' + esc(hook.source) + "</p>" : "") + "</dd>";
    const browser = card.metrics.browser;
    const yt = card.metrics.ytDlp;
    const row = (label, value) => "<div><dt>" + label + "</dt><dd>" + esc(value == null || value === "" ? "Unknown" : (typeof value === "number" ? R.fmtInt(value) : "Unknown")) + "</dd></div>";
    return '<article class="detail" data-cross-id="' + esc(card.id) + '"><p class="label">' + esc(card.sourceLabel) + "</p><h2>" + esc(crossPreview(card).text) + "</h2>" +
      "<p class=\"v-meta\">" + esc(card.creator || "") + " · " + esc(card.paid.label) + "</p>" +
      (card.paid.note ? "<p class=\"hint\">" + esc(card.paid.note) + "</p>" : "") +
      (card.selection.note ? "<p class=\"hint\">" + esc(card.selection.note) + "</p>" : "") +
      detailActions(card.postUrl, card.id || card.dedupeKey) +
      "<p><b>Date and metrics:</b> " + (card.verification.dateVerified ? "Date verified" : "Date not verified") + " · " +
      (card.verification.metricsVerified ? "Metrics verified" : "Metrics not verified") + ". Each opening line has its own check.</p>" +
      (card.cardRole ? "<p><b>Role:</b> " + esc(card.cardRole) + "</p>" : "") +
      "<h3>General format</h3><p>" + esc(card.format.value || "Not recorded.") + "</p>" +
      (card.reviewScope ? "<p class=\"hint\">" + esc(card.reviewScope) + "</p>" : "") +
      "<h3>How it opens</h3><dl class=\"hooks\">" + field("Visual", card.hooks.visual) + field("Audio", card.hooks.spoken) + field("On-screen text", card.hooks.onScreen) + "</dl>" +
      '<section class="adapt"><span class="label">Proposed adaptation for Matt, a draft, not a quote from the video</span><p class="big">' +
      esc(card.adaptation.value || "No adaptation written yet.") + "</p></section>" +
      '<div class="metric-split"><section><h3 class="label">Browser-reported counts</h3><p class="hint">Not a verified ranking. ' + esc(browser.source || "") + "</p><dl>" +
      row("Views", browser.views) + row("Likes", browser.likes) + row("Comments", browser.comments) + "</dl></section>" +
      '<section><h3 class="label">Public downloader metadata</h3><p class="hint">yt-dlp. Separate from the browser counts. Not a verified ranking.</p><dl>' +
      (yt ? row("Views", yt.views) + row("Likes", yt.likes) + row("Comments", yt.comments) : "<p class=\"missing\">No yt-dlp counts recorded.</p>") +
      "</dl></section></div>" +
      card.contentFlags.map((flag) => '<div class="caution c-warn">' + pill("p-warn", "Caution") + "<p>" + esc(flag) + "</p></div>").join("") +
      "</article>";
  }
  function renderCross() {
    const niche = VM.crossNiche;
    const coverage = R.crossNicheCoverage(niche);
    const filtered = R.filterCrossCards(niche, crossState);
    const exploreN = coverage.by.tiktok_explore.approved;
    const searchN = coverage.by.tiktok_search.approved;
    const four = ["cc_trends", "tiktok_explore", "ig_reels", "cc_top_ads"].reduce((sum, key) => sum + coverage.by[key].approved, 0);
    const summary = niche.loaded
      ? exploreN + " from Explore, " + searchN + " from search. " + four + " of 20 across the four sources."
      : "No inspiration file yet.";
    const detailRows = R.CROSS_SOURCES.map((spec) => {
      const src = niche.sources[spec.key];
      const count = coverage.by[spec.key];
      const amount = spec.quota ? count.approved + " of " + count.target : String(count.approved);
      return "<div><dt>" + esc(src.label) + "</dt><dd>" + esc(amount) + "</dd></div><div><dt>Collection</dt><dd>" + esc(humanFileStatus(src.fileStatus)) + "</dd></div>";
    }).join("");
    const held = (niche.excluded || []).reduce((acc, item) => {
      const reason = String(item.reason || "");
      if (/synthetic|manipulat/i.test(reason)) acc.synthetic += item.ids ? item.ids.length : 1;
      else acc.recheck += item.ids ? item.ids.length : 1;
      return acc;
    }, { synthetic: 0, recheck: 0 });
    $("#tc-cross").textContent = String(filtered.primary.length);
    $("#cross-root").innerHTML = '<p class="line">' + esc(summary) + (coverage.quotaMet ? "" : " The set of 20 is not complete.") + " TikTok search is not Explore.</p>" +
      (filtered.primary.length ? "" : '<p class="missing">No approved cross-niche cards yet.</p>') +
      "<details><summary>Source counts</summary><div class=\"counts\"><dl>" + detailRows + "</dl>" +
      (held.synthetic || held.recheck ? "<p class=\"hint\">" + (held.synthetic ? held.synthetic + " clip excluded as synthetic. " : "") + (held.recheck ? held.recheck + " clips held for a recheck." : "") + "</p>" : "") +
      "</details><div class=\"vlist cards-2\">" + filtered.primary.map(crossCard).join("") + "</div>";
  }

  function shortCard(person) {
    return '<button type="button" class="vcard" data-open="short" data-id="' + esc(person.handle) + '"><span class="poster"><span>' + esc(person.fit.word.replace(" fit", "")) + '</span></span><span><span class="v-title">@' +
      esc(person.handle) + '</span><span class="v-meta"><span class="fit">' + esc(person.fit.word) + "</span><span>" + esc(person.cohort === "AI Marketing" ? "AI" : "Ecom") + "</span></span></span></button>";
  }
  function renderShortlist() {
    const people = VM.shortlist.people || [];
    $("#shortlist").innerHTML = '<div class="vlist cards-2">' + people.map((person) => '<div class="item">' + shortCard(person) + "</div>").join("") + "</div>";
  }
  function shortDetail(person) {
    return '<article class="detail"><h2>@' + esc(person.handle) + "</h2><p class=\"fit\">" + esc(person.fit.word) + "</p><p>" + esc(person.why || "Not recorded.") + "</p>" +
      (person.examples || []).map((example) => "<p>" + extLink(example.url, "Example") + " " + esc(example.desc || "") + "</p>").join("") +
      "<p class=\"hint\">" + esc(person.status || "Not an approval to scan.") + "</p></article>";
  }

  function renderSaved() {
    const note = $("#storage-note-saved");
    if (note) note.textContent = storageLine();
    const currentCodes = new Set(VM.recs.map((rec) => rec.code));
    const picks = VM.recs.filter((rec) => Store.has("saved", rec.code)).map((rec) => pickCard(rec))
      .concat(historyPicks().filter((rec) => Store.has("saved", rec.code) && !currentCodes.has(rec.code)).map((rec) => pickCard(rec, "history")));
    const inspire = (VM.crossNiche.candidates || []).filter((card) => Store.has("saved", card.id || card.dedupeKey)).map(crossCard);
    const explore = VM.reels.filter((row) => Store.has("saved", row.code || row.url)).slice(0, 50).map(exploreCard);
    const html = picks.concat(inspire).concat(explore);
    $("#saved-root").innerHTML = html.length ? '<div class="vlist">' + html.join("") + "</div>" : '<p class="missing">Nothing saved in this browser yet.</p>';
  }

  function renderCreators() {
    syncRange("cre");
    const result = R.filterCreators(VM.creators, cre, parsedRange());
    const count = $("#cre-count");
    const out = $("#cre-results");
    if (result.error) {
      count.textContent = "Results paused";
      out.innerHTML = "<p>" + esc(result.error) + "</p>";
      return;
    }
    count.textContent = result.rows.length + (result.rows.length === 1 ? " creator matches" : " creators match") +
      (result.hiddenUnknown ? ". " + result.hiddenUnknown + " hidden because follower count was not measured." : "");
    out.innerHTML = '<div class="vlist">' + result.rows.slice(0, 80).map((row) =>
      '<button type="button" class="vcard" data-open="creator" data-id="' + esc(row.handle) + '"><span class="poster"><span>IG</span></span><span><span class="v-title">@' +
      esc(row.handle) + '</span><span class="v-meta"><span>' + esc(row.followers == null ? "Followers unknown" : R.fmtInt(row.followers)) + "</span></span></span></button>").join("") + "</div>";
  }
  function creatorDetail(row) {
    return '<article class="detail"><h2>@' + esc(row.handle) + "</h2><p>" + (row.bio ? esc(row.bio) : '<span class="missing">No bio captured.</span>') + "</p><p>" +
      (row.why ? esc(row.why) : '<span class="missing">Relevance not reviewed yet.</span>') + "</p><p class=\"hint\">" + esc(R.STATUS.review[row.review] ? R.STATUS.review[row.review].label : row.review) +
      " · " + esc(R.STATUS.analysis[row.analysis] ? R.STATUS.analysis[row.analysis].label : row.analysis) + "</p></article>";
  }

  function renderCoverage() {
    const facts = VM.coverage || {};
    const review = facts.review || {};
    $("#coverage").innerHTML = '<p class="line">' + esc(R.fmtInt(facts.eligibleReels)) + " eligible Reels in Explore. " + esc(R.fmtInt(facts.directoryCount)) + " creators in the directory.</p>" +
      "<details><summary>Registry and scan counts</summary><dl class=\"counts\">" +
      "<div><dt>Reviewed</dt><dd>" + esc(R.fmtInt(review.reviewed || 0)) + "</dd></div>" +
      "<div><dt>Candidates</dt><dd>" + esc(R.fmtInt(review.candidate || 0)) + "</dd></div>" +
      "<div><dt>Not verified</dt><dd>" + esc(R.fmtInt(review.candidate_unverified || 0)) + "</dd></div>" +
      "<div><dt>Baselines</dt><dd>" + esc(String(VM.baselines.length)) + "</dd></div>" +
      "<div><dt>Reels scored</dt><dd>" + esc(R.fmtInt(facts.scoredReels)) + "</dd></div></dl>" +
      "<p class=\"hint\">Missing view counts stay out of the mean. They are not zeros. The groups are different lists and are not forced to match.</p></details>";
  }

  function renderMethod() {
    const blocks = [
      ["The multiple", "<p>Views divided by that creator's own 90-day mean, including this Reel. Creators are not ranked against each other. Cross-niche cards have no multiple.</p>"],
      ["What a hook is", "<p>On picks, spoken, on-screen, and visual lines stay separate. A caption is never shown as speech. On inspiration cards, a caption track is labeled Caption track; audio unverified.</p>"],
      ["Strong only", "<p>Hides anything other than a complete 90-day baseline, and Reels flagged under 3 days. The 12 Reels in 90 days rule is separate.</p>"],
      ["Marks", "<p>" + esc(storageLine()) + "</p>"]
    ];
    $("#method").innerHTML = blocks.map(([title, body]) => "<details><summary>" + title + '</summary><div class="body">' + body + "</div></details>").join("");
  }

  function findExplore(id) { return VM.reels.find((row) => (row.code || row.url) === id); }
  function findCross(id) { return (VM.crossNiche.candidates || []).find((card) => card.id === id); }
  function findShort(id) { return (VM.shortlist.people || []).find((person) => person.handle === id); }
  function findCreator(id) { return VM.creators.find((row) => row.handle === id); }

  function openFrom(kind, id, rank) {
    if (kind === "pick") {
      const rec = VM.recs.find((item) => item.rank === rank);
      if (!rec) return;
      recState.sel = rank;
      renderModel();
      openSheet(pickDetail(rec));
    } else if (kind === "history") {
      const rec = historyPicks().find((item) => item.code === id);
      if (!rec) return;
      recState.histCode = rec.code;
      renderModel();
      openSheet(pickDetail(rec));
    } else if (kind === "explore") {
      const row = findExplore(id);
      if (row) openSheet(exploreDetail(row));
    } else if (kind === "cross") {
      const card = findCross(id);
      if (card) openSheet(crossDetail(card));
    } else if (kind === "short") {
      const person = findShort(id);
      if (person) openSheet(shortDetail(person));
    } else if (kind === "creator") {
      const row = findCreator(id);
      if (row) openSheet(creatorDetail(row));
    }
  }

  function initExplorer() {
    $("#exp-range").innerHTML = rangeHTML("exp");
    $("#exp-min").addEventListener("input", (event) => { range.minRaw = event.target.value; onRangeEdited(); });
    $("#exp-max").addEventListener("input", (event) => { range.maxRaw = event.target.value; onRangeEdited(); });
    $("#exp-presets").addEventListener("click", (event) => {
      const button = event.target.closest("[data-preset]");
      if (!button) return;
      const preset = R.PRESETS[+button.dataset.preset];
      range.minRaw = preset.min == null ? "" : R.fmtInt(preset.min);
      range.maxRaw = preset.max == null ? "" : R.fmtInt(preset.max);
      onRangeEdited();
    });
    $("#exp-minx").innerHTML = [[1, "1×"], [3, "3×"], [5, "5×"], [10, "10×"]].map(([value, label]) => '<button type="button" data-x="' + value + '">' + label + "</button>").join("");
    $("#exp-date").innerHTML = [["any", "Any"], ["30", "Last 30 days"], ["90", "31–90 days"]].map(([value, label]) => '<button type="button" data-d="' + value + '">' + label + "</button>").join("");
    const creators = [...new Set(VM.reels.map((row) => row.handle))].sort();
    $("#exp-creator").innerHTML = '<option value="">All creators</option>' + creators.map((name) => '<option value="' + esc(name) + '">@' + esc(name) + "</option>").join("");
    const topics = [...new Set(VM.reels.flatMap((row) => row.topics || []))].sort();
    $("#exp-topic").innerHTML = '<option value="">All topics</option>' + topics.map((topic) => '<option value="' + esc(topic) + '">' + esc(R.topicLabel(topic)) + "</option>").join("");
    const sorts = [["x", "Outlier"], ["views", "Views"], ["followers", "Followers"], ["mean", "Mean"], ["n", "Sample"], ["published", "Published"]];
    $("#m-sort").innerHTML = sorts.flatMap(([key, label]) => [
      '<option value="' + key + ':desc">' + label + ", high</option>",
      '<option value="' + key + ':asc">' + label + ", low</option>"
    ]).join("");
    $("#exp-sorts").innerHTML = sorts.map(([key, label]) => '<button class="btn" type="button" data-sort="' + key + '">' + label + "</button>").join("");
    $("#exp-strong").checked = exp.strong;
    $("#exp-minx").addEventListener("click", (event) => { const button = event.target.closest("[data-x]"); if (!button) return; exp.minX = +button.dataset.x; exp.limit = 50; renderExplorer(); });
    $("#exp-date").addEventListener("click", (event) => { const button = event.target.closest("[data-d]"); if (!button) return; exp.date = button.dataset.d; exp.limit = 50; renderExplorer(); });
    $("#exp-creator").addEventListener("change", (event) => { exp.creator = event.target.value; exp.limit = 50; renderExplorer(); });
    $("#exp-topic").addEventListener("change", (event) => { exp.topic = event.target.value; exp.limit = 50; renderExplorer(); });
    $("#exp-q").addEventListener("input", (event) => { exp.q = event.target.value; exp.limit = 50; renderExplorer(); });
    $("#exp-strong").addEventListener("change", (event) => { exp.strong = event.target.checked; exp.limit = 50; renderExplorer(); });
    $("#exp-reset").addEventListener("click", resetExplorer);
    $("#m-sort").addEventListener("change", (event) => { const parts = event.target.value.split(":"); exp.sort = parts[0]; exp.dir = parts[1]; renderExplorer(); });
    $("#exp-sorts").addEventListener("click", (event) => {
      const button = event.target.closest("[data-sort]");
      if (!button) return;
      const key = button.dataset.sort;
      if (exp.sort === key) exp.dir = exp.dir === "desc" ? "asc" : "desc";
      else { exp.sort = key; exp.dir = "desc"; }
      renderExplorer();
    });
    $("#f-toggle").addEventListener("click", () => {
      const filters = $("#exp-filters");
      const open = !filters.classList.contains("open");
      filters.classList.toggle("open", open);
      $("#f-toggle").setAttribute("aria-expanded", String(open));
    });
  }
  function initCreators() {
    $("#cre-range").innerHTML = rangeHTML("cre");
    $("#cre-min").addEventListener("input", (event) => { range.minRaw = event.target.value; onRangeEdited(); });
    $("#cre-max").addEventListener("input", (event) => { range.maxRaw = event.target.value; onRangeEdited(); });
    $("#cre-presets").addEventListener("click", (event) => {
      const button = event.target.closest("[data-preset]");
      if (!button) return;
      const preset = R.PRESETS[+button.dataset.preset];
      range.minRaw = preset.min == null ? "" : R.fmtInt(preset.min);
      range.maxRaw = preset.max == null ? "" : R.fmtInt(preset.max);
      onRangeEdited();
    });
    $("#cre-review").innerHTML = '<option value="">Any review</option>' + Object.entries(R.STATUS.review).map(([key, value]) => '<option value="' + key + '">' + esc(value.label) + "</option>").join("");
    $("#cre-analysis").innerHTML = '<option value="">Any analysis</option>' + ["full", "provisional", "low_n", "insufficient", "no_reels", "pending", "not_scanned"].map((key) => '<option value="' + key + '">' + esc(R.STATUS.analysis[key].label) + "</option>").join("");
    const topics = [...new Set(VM.creators.flatMap((row) => row.topics || []))].sort();
    $("#cre-topic").innerHTML = '<option value="">All topics</option>' + topics.map((topic) => '<option value="' + esc(topic) + '">' + esc(R.topicLabel(topic)) + "</option>").join("");
    ["review", "analysis", "topic"].forEach((key) => $("#cre-" + key).addEventListener("change", (event) => { cre[key] = event.target.value; renderCreators(); }));
    $("#cre-q").addEventListener("input", (event) => { cre.q = event.target.value; renderCreators(); });
  }

  document.addEventListener("click", async (event) => {
    if (event.target.closest("[data-sheet-close]")) { closeSheet(); return; }
    const copy = event.target.closest("[data-copy]");
    if (copy) {
      event.stopPropagation();
      const url = copy.dataset.copy;
      if (await copyText(url)) toast("Link copied");
      else toast("Couldn't copy automatically. The link is selected below; press Ctrl+C or ⌘C.", { fallback: url });
      return;
    }
    const mark = event.target.closest("[data-mark]");
    if (mark) {
      event.stopPropagation();
      const on = Store.toggle(mark.dataset.mark, mark.dataset.id);
      toast(mark.dataset.mark === "saved" ? (on ? "Saved in this browser" : "Removed from saved") : (on ? "Marked as watched" : "Marked as not watched"));
      renderModel();
      if (!$("#p-saved").hidden) renderSaved();
      if (!$("#p-explore").hidden) renderExplorer();
      if (!$("#p-cross").hidden) renderCross();
      return;
    }
    const card = event.target.closest("[data-open]");
    if (!card) return;
    openFrom(card.dataset.open, card.dataset.id, Number(card.dataset.rank));
  });
  $("#tablist").addEventListener("click", (event) => { const tab = event.target.closest(".tab"); if (tab) showTab(tab.dataset.tab); });
  $("#tablist").addEventListener("keydown", (event) => {
    const tabs = $$(".tab");
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    let next = null;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next != null) { event.preventDefault(); showTab(tabs[next].dataset.tab, true); }
  });
  window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !$("#sheet").hidden) closeSheet(); });
  $("#rec-age").addEventListener("click", (event) => { const button = event.target.closest("[data-age]"); if (!button) return; recState.age = button.dataset.age; renderModel(); });
  $("#rec-hide-watched").addEventListener("change", (event) => { recState.hideWatched = event.target.checked; renderModel(); });
  $("#rail").addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = $$(".rail-item");
    const index = items.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === "ArrowDown" ? Math.min(index + 1, items.length - 1) : event.key === "ArrowUp" ? Math.max(index - 1, 0) : event.key === "Home" ? 0 : items.length - 1;
    items[next].focus();
  });

  function boot() {
    let embedded = {};
    try { embedded = JSON.parse($("#desk-data").textContent || "{}"); }
    catch (err) {
      $("#main").innerHTML = "<p>This page could not read its data.</p>";
      return;
    }
    VM = R.toViewModel(embedded);
    $("#tc-explore").textContent = "";
    renderFreshness();
    renderModel();
    initExplorer();
    initCreators();
    renderExplorer();
    renderCross();
    renderShortlist();
    renderSaved();
    renderCreators();
    renderCoverage();
    renderMethod();
    showTab((location.hash || "#model").slice(1));
  }
  boot();
})();
