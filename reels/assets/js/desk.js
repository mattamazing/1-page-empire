/* Reel modeling desk UI. Filtering stays in the browser. */
(function () {
  "use strict";
  const R = window.ReelDesk;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const CHICAGO = "America/Chicago";
  const REC_SLOTS = 10;
  const FLAG = {
    capped: { label: "Capped history", cls: "p-warn" },
    lown: { label: "Low sample", cls: "p-warn" },
    young: { label: "Under 3 days", cls: "p-warn" },
    pinned: { label: "Pinned", cls: "p-neutral" },
    collab: { label: "Collab", cls: "p-neutral" },
    paid: { label: "Paid partnership", cls: "p-paid" },
    lang: { label: "Limited language evidence", cls: "p-neutral" }
  };
  const SRC = {
    video: { label: "Checked against video", cls: "p-fresh" },
    asr_video: { label: "Machine transcript, checked against video", cls: "p-fresh" },
    asr: { label: "Machine transcript, not checked", cls: "p-warn" },
    caption: { label: "From caption only", cls: "p-warn" },
    none: { label: "Checked: none in the opening", cls: "p-neutral" },
    missing: { label: "Not recorded", cls: "p-outline" }
  };

  function fmtStamp(iso, withTime) {
    if (!iso) return "—";
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(iso));
    const d = new Date(dateOnly ? iso + "T12:00:00-06:00" : iso);
    if (Number.isNaN(d.getTime())) return "—";
    const opts = { timeZone: CHICAGO, month: "short", day: "numeric", year: "numeric" };
    if (!dateOnly && withTime !== false) {
      opts.hour = "numeric";
      opts.minute = "2-digit";
      opts.timeZoneName = "short";
    }
    return new Intl.DateTimeFormat("en-US", opts).format(d);
  }
  function ymd(iso) {
    if (!iso) return null;
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso + "T12:00:00-06:00" : iso);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat("en-CA", { timeZone: CHICAGO, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  }
  function fmtX(x, digits) {
    if (x == null || Number.isNaN(Number(x))) return "—";
    return Number(x).toFixed(digits == null ? 2 : digits) + "×";
  }
  function pill(cls, text) {
    return '<span class="pill ' + cls + '">' + esc(text) + "</span>";
  }
  function statusPill(group, key) {
    const s = R.STATUS[group][key];
    if (!s) return pill("p-outline", "Not recorded");
    const title = s.desc ? ' title="' + esc(s.desc) + '"' : "";
    return '<span class="pill ' + s.cls + '"' + title + ">" + esc(s.label) + "</span>";
  }
  function safeUrl(url) {
    return /^https?:\/\//i.test(String(url || "")) ? String(url) : "";
  }
  function extLink(url, text) {
    const href = safeUrl(url);
    if (!href) return esc(text);
    return '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(text) + '<span class="sr-only"> (opens in new tab)</span></a>';
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
      try {
        localStorage.setItem(KEY, JSON.stringify(data));
      } catch (err) {
        persistent = false;
      }
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
      t.innerHTML = esc(msg) + '<button class="tclose" type="button">Close</button><input readonly aria-label="Link to copy" value="' + esc(opts.fallback) + '">';
      t.classList.add("show");
      const inp = $("input", t);
      inp.focus();
      inp.select();
      $(".tclose", t).onclick = () => t.classList.remove("show");
      toastTimer = setTimeout(() => t.classList.remove("show"), 12000);
    } else {
      t.textContent = msg;
      t.classList.add("show");
      toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
    }
  }
  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) { /* fall through */ }
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
    } catch (err) { /* fall through */ }
    return false;
  }

  let VM = null;
  const range = { minRaw: R.DEFAULT_RANGE.minRaw, maxRaw: R.DEFAULT_RANGE.maxRaw };
  const exp = Object.assign({}, R.EXP_DEFAULT);
  const cre = { review: "", analysis: "", topic: "", q: "" };
  const recState = { age: "all", hideWatched: false, sel: null };
  const mqMobile = window.matchMedia("(max-width: 899px)");

  function parsedRange() {
    return R.parseRange(range.minRaw, range.maxRaw);
  }

  function renderFreshness() {
    const dates = VM.recs.map((r) => ymd(r.views_asof)).filter(Boolean).sort();
    let views = "—";
    if (dates.length) {
      const a = dates[0];
      const b = dates[dates.length - 1];
      views = (a === b ? fmtStamp(a, false) : fmtStamp(a, false) + " – " + fmtStamp(b, false)) + ", per Reel";
    }
    const snaps = VM.baselines.map((b) => ymd(b.snapshotLocal)).filter(Boolean).sort();
    let baseline = VM.baselineStrip;
    if (snaps.length) {
      const span = snaps[0] === snaps[snaps.length - 1]
        ? fmtStamp(snaps[0], false)
        : fmtStamp(snaps[0], false) + " – " + fmtStamp(snaps[snaps.length - 1], false);
      baseline += ". Scan dates " + span + ", each creator on their own date.";
    }
    $("#freshness").innerHTML =
      "<div><dt>Page built</dt><dd>" + esc(fmtStamp(VM.build.iso, true)) + "</dd></div>" +
      "<div><dt>Views measured</dt><dd>" + esc(views) + "</dd></div>" +
      "<div><dt>Outlier baseline</dt><dd>" + esc(baseline) + "</dd></div>" +
      "<div><dt>Weekly refresh</dt><dd>" + esc(VM.weeklyRefresh) + "</dd></div>";
  }

  const TABS = ["model", "explore", "creators", "shortlist", "coverage", "method"];
  function showTab(id, focusTab) {
    if (!TABS.includes(id)) id = "model";
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
  }

  function hookRow(kind, sub, hook) {
    hook = hook || { src: "missing" };
    const meta = SRC[hook.src] || SRC.missing;
    let body;
    if (hook.src === "missing") body = '<p class="missing">Not recorded for this pick.</p>';
    else if (hook.src === "none") body = "<p>" + (kind === "Spoken" ? "No spoken opening." : "None.") + "</p>";
    else if (hook.text) body = '<p class="quote' + (hook.verbatim ? " verbatim" : "") + '">' + esc(hook.text) + "</p>";
    else body = '<p class="missing">Not recorded for this pick.</p>';
    return '<dt><span class="label">' + kind + '</span><span class="kind-sub">' + sub + "</span></dt><dd><div class=\"src\">" +
      pill(meta.cls, meta.label) + (hook.ts ? '<span class="ts">' + esc(hook.ts) + "</span>" : "") +
      "</div>" + body + (hook.note ? '<p class="hook-note">' + esc(hook.note) + "</p>" : "") + "</dd>";
  }

  function recDetail(rec) {
    const rc = R.recencyFromElapsed(rec.elapsed, false);
    const url = safeUrl(rec.url);
    const saved = Store.has("saved", rec.code);
    const watched = Store.has("watched", rec.code);
    const ageTxt = rec.elapsed == null ? "Age not recorded" : R.formatDays(rec.elapsed, false) + " before this page was built";
    const actions = url
      ? '<a class="btn btn-primary" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Open Reel<span class="sr-only"> (opens in new tab)</span></a><button class="btn" type="button" data-copy="' + esc(url) + '">Copy link</button>'
      : '<span class="btn" aria-disabled="true">Reel link missing</span>';
    const cautions = rec.cautions.length
      ? '<section class="d-sec"><h3>Before you model it</h3><div class="cautions">' + rec.cautions.map((c) =>
        '<div class="caution ' + (c.kind === "paid" ? "c-paid" : "c-warn") + '">' +
        pill(c.kind === "paid" ? "p-paid" : "p-warn", c.kind === "paid" ? "Commercial" : "Caution") +
        "<p>" + esc(c.text) + "</p></div>").join("") + "</div></section>"
      : "";
    return '<article class="detail" aria-labelledby="d-title-' + rec.rank + '">' +
      '<div class="d-top"><span class="d-pick">Editorial pick ' + rec.rank + " of " + REC_SLOTS + "</span>" +
      pill(rc.key === "fresh" ? "p-fresh" : rc.key === "bench" ? "p-bench" : "p-outline", rc.label) +
      (rec.paid ? pill("p-paid", "Paid partnership") : "") +
      (rec.commercial ? pill("p-paid", "Commercial note") : "") +
      "</div>" +
      '<h2 class="d-title" id="d-title-' + rec.rank + '">' + esc(rec.concept) + "</h2>" +
      '<p class="d-by">' + extLink(rec.profileUrl, "@" + rec.handle) +
      "<span>Published " + esc(fmtStamp(rec.published, true)) + "</span>" +
      '<span class="xfig"><b>' + fmtX(rec.x, 2) + '</b><span>its creator\'s own average</span></span></p>' +
      '<div class="d-actions">' + actions +
      '<button class="btn" type="button" data-mark="saved" data-id="' + esc(rec.code) + '" aria-pressed="' + saved + '">' + (saved ? "Saved" : "Save") + "</button>" +
      '<button class="btn" type="button" data-mark="watched" data-id="' + esc(rec.code) + '" aria-pressed="' + watched + '">' + (watched ? "Watched" : "Mark watched") + "</button></div>" +
      '<section class="d-sec adapt" aria-label="Your adaptation"><span class="label">Your adaptation, a draft idea, not a quote</span><p class="big">' +
      esc(rec.adapt || "Not recorded for this pick.") + "</p></section>" +
      '<section class="d-sec"><h3>Why it\'s worth modeling</h3><p>' + esc(rec.why || "Not recorded.") + "</p></section>" +
      '<section class="d-sec"><h3>How it opens</h3><dl class="hooks">' +
      hookRow("Spoken", "What they say", rec.hooks.spoken) +
      hookRow("On-screen", "Text in the first frames", rec.hooks.onscreen) +
      hookRow("Visual", "The opening action", rec.hooks.visual) +
      "</dl></section>" + cautions +
      '<details class="evidence"><summary><span class="s-title">Performance evidence</span><span class="xfig"><b>' + fmtX(rec.x, 2) +
      '</b><span>own 90-day average</span></span><span class="hint">' + esc(R.fmtInt(rec.views)) + " views on " + esc(fmtStamp(rec.views_asof, true)) +
      '</span></summary><dl class="ev-grid">' +
      '<div><dt class="label">Outlier multiple</dt><dd>' + fmtX(rec.x, 2) + "<small>Views ÷ creator's own mean</small></dd></div>" +
      '<div><dt class="label">Views</dt><dd>' + esc(R.fmtInt(rec.views)) + "<small>Measured " + esc(fmtStamp(rec.views_asof, true)) + "</small></dd></div>" +
      '<div><dt class="label">Creator 90-day mean</dt><dd>' + esc(R.fmtInt(rec.mean)) + "<small>Includes this Reel. All Reels in the window, including other languages.</small></dd></div>" +
      '<div><dt class="label">Baseline sample</dt><dd>' + esc(R.fmtInt(rec.n)) + " Reels<small>" + esc(rec.baselineLabel) + "</small></dd></div>" +
      '<div><dt class="label">Followers</dt><dd>' + esc(R.fmtInt(rec.followers)) + "<small>Measured " + esc(fmtStamp(rec.followers_asof, true)) + "</small></dd></div>" +
      '<div><dt class="label">Published</dt><dd>' + esc(fmtStamp(rec.published, true)) + "<small>" + esc(ageTxt) + "</small></dd></div>" +
      '</dl><p class="ev-foot">The multiple explains how unusual this Reel was for its own creator. It did not decide the rank. Public counts cannot show saves, retention, conversions, or whether views were boosted. A paid or collab flag is not proof either way.</p></details></article>';
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

  function renderAgeSeg() {
    const fresh = VM.recs.filter((rec) => R.recencyFromElapsed(rec.elapsed, false).key === "fresh").length;
    const bench = VM.recs.filter((rec) => R.recencyFromElapsed(rec.elapsed, false).key === "bench").length;
    const opts = [
      ["all", "All " + VM.recs.length],
      ["fresh", "Recent " + fresh],
      ["bench", "Benchmarks " + bench]
    ];
    $("#rec-age").innerHTML = opts.map(([key, label]) =>
      '<button type="button" data-age="' + key + '" aria-pressed="' + (recState.age === key) + '">' + label + "</button>").join("");
  }

  function renderModel() {
    renderAgeSeg();
    $("#tc-model").textContent = String(VM.recs.length);
    $("#storage-note").textContent = Store.persistent
      ? "Saved and watched marks live in this browser only."
      : "Marks won't be kept: this browser blocks local storage.";
    const list = visibleRecs();
    const rail = $("#rail");
    const col = $("#detail-col");
    if (!list.length) {
      const msg = recState.age === "fresh"
        ? ["No recent picks in this build.", "Benchmarks are more than 30 and up to 90 days old. They can still show a format worth copying."]
        : recState.hideWatched
          ? ["You've watched every pick shown.", "Show watched picks again, or open Explore outliers for more ideas."]
          : ["No picks match.", "Show all picks to continue."];
      const html = '<div class="empty"><h3>' + msg[0] + "</h3><p>" + msg[1] + '</p><button class="btn" type="button" id="rec-reset">Show all picks</button></div>';
      rail.innerHTML = mqMobile.matches ? "<li>" + html + "</li>" : "";
      col.innerHTML = mqMobile.matches ? "" : html;
      const reset = $("#rec-reset");
      if (reset) reset.onclick = () => {
        recState.age = "all";
        recState.hideWatched = false;
        $("#rec-hide-watched").checked = false;
        renderModel();
      };
      return;
    }
    if (!list.some((rec) => rec.rank === recState.sel)) {
      recState.sel = mqMobile.matches && recState.sel == null ? null : list[0].rank;
    }
    const showSlots = recState.age === "all" && !recState.hideWatched;
    let html = list.map((rec) => {
      const rc = R.recencyFromElapsed(rec.elapsed, false);
      const on = rec.rank === recState.sel;
      const watched = Store.has("watched", rec.code);
      const saved = Store.has("saved", rec.code);
      return '<li class="' + (watched ? "r-watched" : "") + '" data-rank="' + rec.rank + '"><button type="button" class="rail-item" data-rank="' + rec.rank + '" aria-current="' + on + '"' +
        (mqMobile.matches ? ' aria-expanded="' + on + '"' : "") + '><span class="rank" aria-hidden="true">' + rec.rank + '</span><span><span class="sr-only">Pick ' + rec.rank +
        ': </span><span class="r-title">' + esc(rec.concept) + '</span><span class="r-handle">@' + esc(rec.handle) + '</span><span class="r-tags">' +
        pill(rc.key === "fresh" ? "p-fresh" : rc.key === "bench" ? "p-bench" : "p-outline", rc.short) +
        '<span class="xfig"><b>' + fmtX(rec.x, 2) + '</b><span>own avg</span></span>' +
        (rec.paid ? pill("p-paid", "Paid") : "") +
        (rec.commercial ? pill("p-paid", "Commercial") : "") +
        (saved ? '<span class="r-mark">Saved</span>' : "") +
        (watched ? '<span class="r-mark">Watched</span>' : "") +
        "</span></span></button></li>";
    }).join("");
    if (showSlots) {
      for (let i = VM.recs.length + 1; i <= REC_SLOTS; i++) {
        html += '<li><div class="slot"><span class="rank" aria-hidden="true">' + i + '</span><div><span class="sr-only">Pick ' + i +
          ': </span><p>Not written yet.</p></div></div></li>';
      }
    }
    rail.innerHTML = html;
    const sel = VM.recs.find((rec) => rec.rank === recState.sel);
    if (mqMobile.matches) {
      col.innerHTML = "";
      if (sel) {
        const li = rail.querySelector('li[data-rank="' + sel.rank + '"]');
        if (li) li.insertAdjacentHTML("beforeend", recDetail(sel));
      }
    } else {
      col.innerHTML = sel ? recDetail(sel) : "";
    }
  }

  function rangeHTML(prefix) {
    return '<div class="range"><span class="label" id="' + prefix + '-rlbl">Followers <span class="shared-tag">· shared by Explore and Creators</span></span>' +
      '<div class="range-inputs" role="group" aria-labelledby="' + prefix + '-rlbl">' +
      '<label class="sr-only" for="' + prefix + '-min">Minimum followers</label>' +
      '<input class="input" id="' + prefix + '-min" inputmode="text" autocomplete="off" placeholder="No minimum" aria-describedby="' + prefix + '-rmsg">' +
      '<span aria-hidden="true">to</span>' +
      '<label class="sr-only" for="' + prefix + '-max">Maximum followers</label>' +
      '<input class="input" id="' + prefix + '-max" inputmode="text" autocomplete="off" placeholder="No maximum" aria-describedby="' + prefix + '-rmsg">' +
      '<div class="seg" role="group" aria-label="Follower presets" id="' + prefix + '-presets">' +
      R.PRESETS.map((preset, i) => '<button type="button" data-preset="' + i + '">' + preset.label + "</button>").join("") +
      "</div></div><p id=\"" + prefix + '-rmsg" class="hint" aria-live="polite"></p></div>';
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
    $$("#" + prefix + "-presets button").forEach((button, i) => {
      button.setAttribute("aria-pressed", String(match === R.PRESETS[i].id));
    });
  }
  function syncBothRanges() {
    syncRange("exp");
    syncRange("cre");
  }
  function onRangeEdited() {
    exp.limit = 50;
    syncBothRanges();
    if (!$("#p-explore").hidden) renderExplorer();
    if (!$("#p-creators").hidden) renderCreators();
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
  function pickBadge(code) {
    const rec = code && VM.recs.find((item) => item.code === code);
    return rec ? " " + pill("p-fresh no-dot", "Pick " + rec.rank) : "";
  }
  function flagHTML(row) {
    return row.flags.map((key) => {
      if (key === "collab" && row.owner && row.owner !== row.handle) {
        return '<span class="pill p-neutral">Collab<span class="sr-only">, owner @' + esc(row.owner) + "</span></span>";
      }
      const meta = FLAG[key];
      return meta ? pill(meta.cls, meta.label) : "";
    }).join("");
  }
  function actionsHTML(row) {
    const url = safeUrl(row.url);
    if (!url) return '<div class="row-actions"><span class="btn btn-sm" aria-disabled="true">Reel link missing</span></div>';
    return '<div class="row-actions"><a class="btn btn-sm btn-primary" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Open Reel<span class="sr-only"> by @' +
      esc(row.handle) + ', opens in new tab</span></a><button class="btn btn-sm" type="button" data-copy="' + esc(url) + '">Copy link<span class="sr-only"> for @' +
      esc(row.handle) + " Reel</span></button></div>";
  }
  function profileLink(handle) {
    return extLink("https://www.instagram.com/" + encodeURIComponent(handle) + "/", "@" + handle);
  }

  function renderExplorer() {
    syncBothRanges();
    $("#f-active").textContent = activeFilterCount();
    $$("#exp-minx button").forEach((button) => button.setAttribute("aria-pressed", String(+button.dataset.x === exp.minX)));
    $$("#exp-date button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.d === exp.date)));
    const sortSel = $("#m-sort");
    if (sortSel) sortSel.value = exp.sort + ":" + exp.dir;
    const result = R.filterReels(VM.reels, exp, parsedRange());
    const out = $("#exp-results");
    const count = $("#exp-count");
    if (result.error) {
      count.textContent = "Results paused";
      out.innerHTML = '<div class="empty"><h3>Fix the follower range to see results</h3><p>' + esc(result.error) +
        '</p><button class="btn" type="button" id="exp-fixrange">Reset follower range</button></div>';
      $("#exp-fixrange").onclick = () => {
        range.minRaw = R.DEFAULT_RANGE.minRaw;
        range.maxRaw = R.DEFAULT_RANGE.maxRaw;
        renderExplorer();
        renderCreators();
      };
      return;
    }
    const rows = result.rows;
    const shown = rows.slice(0, exp.limit);
    const noun = rows.length === 1 ? "Reel matches" : "Reels match";
    let countText = rows.length ? rows.length + " " + noun + (shown.length < rows.length ? ", showing " + shown.length : "") : "No Reels match";
    if (result.hiddenUnknown) {
      countText += ". " + result.hiddenUnknown + " hidden because their follower count has not been measured; clear both follower bounds to see them.";
    }
    count.textContent = countText;
    if (!rows.length) {
      const tips = [];
      if (exp.minX > 1) tips.push("lower the outlier minimum (now " + exp.minX + "×)");
      if (exp.strong) tips.push("turn off Strong only");
      if (exp.q) tips.push('clear the search "' + exp.q + '"');
      if (exp.date !== "any") tips.push("set Published to Any");
      if (exp.creator) tips.push("set Creator to All");
      if (exp.topic) tips.push("set Topic to All");
      out.innerHTML = '<div class="empty"><h3>No Reels match these filters</h3><p>' +
        (tips.length ? "Try to " + esc(tips.join(", or ")) + "." : "Widen the follower range.") +
        '</p><button class="btn" type="button" id="exp-empty-reset">Reset filters</button></div>';
      $("#exp-empty-reset").onclick = resetExplorer;
      return;
    }
    const th = (key, label, right) => {
      const on = exp.sort === key;
      const dir = on ? (exp.dir === "asc" ? "ascending" : "descending") : "";
      return '<th class="' + (right ? "r" : "") + '"' + (dir ? ' aria-sort="' + dir + '"' : "") + '><button type="button" data-sort="' + key + '">' +
        label + '<span aria-hidden="true">' + (on ? (exp.dir === "asc" ? "▲" : "▼") : "") + "</span></button></th>";
    };
    const table = '<div class="table-wrap"><table><caption class="sr-only">Outlier Reels. Caption text has not been checked against the video. Sortable columns have buttons in their headers.</caption><thead><tr>' +
      th("x", "Outlier", true) + "<th>Creator</th>" + th("followers", "Followers", true) + th("views", "Views", true) + th("mean", "90-day mean", true) +
      th("n", "n", true) + th("published", "Published", false) + "<th>Caption, first line</th><th>Flags</th><th><span class=\"sr-only\">Actions</span></th></tr></thead><tbody>" +
      shown.map((row) => "<tr><td class=\"r x-cell\">" + fmtX(row.x, 2) + "</td><td>" + profileLink(row.handle) + pickBadge(row.code) +
        "</td><td class=\"r num\">" + esc(R.fmtInt(row.followers)) + '<span class="sub">' + esc(row.followerBand || "—") + "</span></td><td class=\"r num\">" +
        esc(R.fmtInt(row.views)) + "</td><td class=\"r num\">" + esc(R.fmtInt(row.mean)) + "</td><td class=\"r num\">" + esc(R.fmtInt(row.n)) +
        '</td><td class="num">' + esc(fmtStamp(row.published, true)) + '<span class="sub">' + esc(row.elapsed == null ? "Age not recorded" : R.formatDays(row.elapsed, row.youngProvisional) + " at measurement") +
        "</span></td><td class=\"cap\">" + (row.caption ? esc(row.caption) : '<span class="missing">No caption text recorded.</span>') +
        '</td><td><div class="flags">' + flagHTML(row) + "</div></td><td>" + actionsHTML(row) + "</td></tr>").join("") +
      "</tbody></table></div>";
    const cards = '<ul class="cards">' + shown.map((row) => {
      const rc = R.recencyFromElapsed(row.elapsed, row.youngProvisional);
      return '<li class="rcard"><div class="rcard-top"><span><span class="rcard-x">' + fmtX(row.x, 2) + '</span> <span class="hint">own avg</span></span>' +
        pill(rc.key === "fresh" ? "p-fresh" : rc.key === "bench" ? "p-bench" : "p-outline", rc.short) + "</div><p>" + profileLink(row.handle) + pickBadge(row.code) +
        "</p><p class=\"rcard-cap\">" + (row.caption ? esc(row.caption) : '<span class="missing">No caption text recorded.</span>') + "</p><dl>" +
        '<div><dt class="label">Views</dt><dd>' + esc(R.fmtInt(row.views)) + '</dd></div><div><dt class="label">Followers</dt><dd>' + esc(R.fmtInt(row.followers)) +
        '</dd></div><div><dt class="label">90d mean</dt><dd>' + esc(R.fmtInt(row.mean)) + '</dd></div><div><dt class="label">n</dt><dd>' + esc(R.fmtInt(row.n)) +
        "</dd></div></dl>" + (row.flags.length ? '<div class="flags">' + flagHTML(row) + "</div>" : "") + actionsHTML(row) + "</li>";
    }).join("") + "</ul>";
    const more = shown.length < rows.length
      ? '<div class="more"><button class="btn" type="button" id="exp-more">Show ' + Math.min(50, rows.length - shown.length) + ' more</button><span class="hint">' +
        (rows.length - shown.length) + " not shown yet</span></div>"
      : "";
    out.innerHTML = table + cards + more;
    const moreBtn = $("#exp-more");
    if (moreBtn) moreBtn.onclick = () => { exp.limit += 50; renderExplorer(); };
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
    if (!$("#p-creators").hidden) renderCreators();
    toast("Filters reset, including the shared follower range");
  }

  function renderCreators() {
    syncBothRanges();
    const result = R.filterCreators(VM.creators, cre, parsedRange());
    const out = $("#cre-results");
    const count = $("#cre-count");
    if (result.error) {
      count.textContent = "Results paused";
      out.innerHTML = '<div class="empty"><h3>Fix the follower range to see creators</h3><p>' + esc(result.error) + "</p></div>";
      return;
    }
    let text = result.rows.length + (result.rows.length === 1 ? " creator matches" : " creators match");
    if (result.hiddenUnknown) {
      text += ". " + result.hiddenUnknown + " hidden because their follower count has not been measured; clear both follower bounds to see them.";
    }
    count.textContent = text;
    if (!result.rows.length) {
      out.innerHTML = '<div class="empty"><h3>No creators match</h3><p>Clear a status filter or widen the follower range.</p></div>';
      return;
    }
    out.innerHTML = '<ul class="list">' + result.rows.map((row) => {
      const followers = row.followers == null
        ? "Followers not measured"
        : R.fmtInt(row.followers) + " followers on " + fmtStamp(row.followers_asof, true);
      const activity = row.activeLast90d === false
        ? "No post in 90 days on the profile snapshot."
        : row.activeLast90d == null
          ? "Grid activity not recorded."
          : "A post was seen in the 90 days before the profile snapshot.";
      return '<li class="item"><div class="stack"><h3>' + profileLink(row.handle) + "</h3>" +
        (row.name ? '<span class="meta">' + esc(row.name) + "</span>" : '<span class="missing">Name not recorded.</span>') +
        (row.verified ? pill("p-neutral", "Verified account") : "") +
        '<span class="meta num">' + esc(followers) + "</span>" +
        '<span class="meta">' + esc(row.band || "Band not recorded") + "</span>" +
        '<span class="meta">' + esc((row.topics || []).map(R.topicLabel).join(", ") || "No topics recorded") + "</span></div>" +
        '<div class="stack"><p>' + (row.bio ? esc(row.bio) : '<span class="missing">No bio captured.</span>') + "</p>" +
        '<p class="kv">' + (row.why ? "<b>Why relevant:</b> " + esc(row.why) : '<span class="missing">Relevance not reviewed yet.</span>') + "</p>" +
        '<p class="kv">Found via ' + esc(row.found || "Discovery source not recorded.") + "</p>" +
        '<p class="kv">' + esc(activity) + "</p></div>" +
        '<div class="stack"><span class="label">Review</span>' + statusPill("review", row.review) +
        '<span class="label">Analysis</span>' + statusPill("analysis", row.analysis) + "</div></li>";
    }).join("") + "</ul>";
  }

  function fitHTML(fit) {
    return '<span class="fit">' + esc(fit.word) + '</span><span class="fit-scale" aria-hidden="true">' +
      [1, 2, 3].map((i) => '<i class="' + (i <= fit.segments ? "on" : "") + '"></i>').join("") + "</span>";
  }
  function personHTML(person) {
    const activity = person.activity || {};
    let activityText = "Posting frequency not checked";
    if (activity.verdict === "pending_unverified") {
      activityText = "Posting frequency not checked" + (activity.reels90dLowerBound != null ? " (" + activity.reels90dLowerBound + " Reels seen)" : "") + ".";
    } else if (activity.reels90d != null) {
      activityText = activity.reels90d + " Reels in 90 days" + (activity.perMonthAvg != null ? " (" + activity.perMonthAvg + "/mo)" : "") +
        (activity.asOf ? ", counted " + fmtStamp(activity.asOf, false) : "") + ".";
    }
    const examples = (person.examples || []).map((example) =>
      "<p class=\"kv\"><b>Example:</b> " + extLink(example.url, "source") + " — " + esc(example.desc || "No description recorded.") + "</p>").join("") ||
      '<p class="missing">No example recorded.</p>';
    const sources = (person.sources || []).map((source) => extLink(source, "source")).join(", ");
    return '<li class="item"><div class="stack"><h3>' + extLink(person.profileUrl, "@" + person.handle) + "</h3>" +
      (person.name ? '<span class="meta">' + esc(person.name) + "</span>" : "") +
      '<span class="meta num">' + (person.followers == null ? "Followers not measured" : esc(R.fmtInt(person.followers) + " followers" + (person.followers_asof ? " on " + fmtStamp(person.followers_asof, false) : ""))) + "</span>" +
      "<span>" + fitHTML(person.fit) + "</span></div><div class=\"stack\"><p>" + esc(person.why || "Why it fits was not recorded.") + "</p>" +
      (person.aiFocus ? "<p class=\"kv\"><b>AI focus:</b> " + esc(person.aiFocus) + "</p>" : "") +
      (person.relationship ? "<p class=\"kv\"><b>Relationship note:</b> " + esc(person.relationship) + "</p>" : "") +
      examples + '<p class="kv"><b>Sources:</b> ' + (sources || "None recorded.") + "</p>" +
      person.warnings.map((warning) => '<div class="caution c-warn">' + pill("p-warn", "Caution") + "<p>" + esc(warning) + "</p></div>").join("") +
      '</div><div class="stack">' + statusPill("eligibility", person.eligibility) + '<span class="kv">' + esc(activityText) + "</span>" +
      (activity.source ? '<span class="kv">' + esc(activity.source) + "</span>" : "") +
      '<span class="kv">' + esc(person.status || "Paid scan: not approved") + "</span></div></li>";
  }

  function renderShortlist() {
    const meta = VM.shortlist.meta || {};
    const people = VM.shortlist.people;
    const cohorts = [
      { id: "Ryan-adjacent ecom/DTC", name: "Ecommerce and DTC creators", note: "No follower limit for this cohort. " + (meta.frequencyRule || "") },
      { id: "AI Marketing", name: "AI-marketing creators", note: "Researched within 20K–500K followers. That range applies to this cohort only, not the rest of the desk. Listed in the recorded editorial order. Fit is not rated for this cohort." }
    ];
    const intro = (meta.method ? "<p>" + esc(meta.method) + "</p>" : "") +
      "<p>Fit words follow the recorded quality score: the highest score is Strong fit, the next is Good fit, and lower scores are Possible fit. Cards do not show a score number. Nobody is approved for a paid scan from this list.</p>";
    $("#shortlist").innerHTML = intro + cohorts.map((cohort) => {
      const group = people.filter((person) => person.cohort === cohort.id);
      const active = group.filter((person) => person.eligibility === "active");
      const rest = group.filter((person) => person.eligibility !== "active");
      return '<section class="cohort"><h3>' + esc(cohort.name) + "</h3><p>" + esc(cohort.note) + "</p>" +
        (active.length ? '<ul class="list">' + active.map(personHTML).join("") + "</ul>" : '<p class="missing">No active candidates in this cohort.</p>') +
        (rest.length ? '<details class="group"><summary>Pending or below the activity rule (' + rest.length + ')</summary><ul class="list">' + rest.map(personHTML).join("") + "</ul></details>" : "") +
        "</section>";
    }).join("");
  }

  function renderCoverage() {
    const facts = VM.coverage || {};
    const review = facts.review || {};
    const analysis = facts.registryAnalysis || {};
    const reviewRows = [
      ["Reviewed creators", review.reviewed || 0],
      ["Candidates (relevant, small or inactive)", review.candidate || 0],
      ["Discovered, not yet verified", review.candidate_unverified || 0],
      ["Rejected, hidden from the directory", review.rejected || 0],
      ["Excluded, language rule", review.excluded_language || 0],
      ["Excluded, own account", review.excluded_self || 0]
    ];
    const reviewSum = reviewRows.reduce((sum, row) => sum + row[1], 0);
    const analysisOrder = [
      ["not_queued", "Not scanned yet"],
      ["pending", "Activity unknown"],
      ["analyzed_full_90d", "Fully analyzed"],
      ["analyzed_capped_history", "Provisional: capped history"],
      ["analyzed_low_n", "Low sample (under 10 Reels)"],
      ["no_eligible_reels_90d", "No Reels in 90 days"],
      ["no_reels_returned", "No Reels returned"],
      ["excluded_language", "Registry label: excluded, language rule"],
      ["excluded_self", "Registry label: own account"]
    ];
    const analysisRows = analysisOrder.map(([key, label]) => [label, analysis[key] || 0]);
    const known = new Set(analysisOrder.map((row) => row[0]));
    Object.keys(analysis).forEach((key) => {
      if (!known.has(key)) analysisRows.push([key, analysis[key]]);
    });
    const analysisSum = analysisRows.reduce((sum, row) => sum + row[1], 0);
    const baselineCounts = {};
    VM.baselines.forEach((row) => { baselineCounts[row.status] = (baselineCounts[row.status] || 0) + 1; });
    const baselineOrder = [
      ["analyzed_full_90d", "Full 90-day history"],
      ["analyzed_capped_history", "Capped history (provisional)"],
      ["analyzed_low_n", "Low sample (under 10 Reels)"],
      ["no_eligible_reels_90d", "No Reels in 90 days"],
      ["no_reels_returned", "No Reels returned"]
    ];
    const baselineRows = baselineOrder.map(([key, label]) => [label, baselineCounts[key] || 0]);
    const knownBase = new Set(baselineOrder.map((row) => row[0]));
    Object.keys(baselineCounts).forEach((key) => {
      if (!knownBase.has(key)) baselineRows.push([key, baselineCounts[key]]);
    });
    const baselineSum = VM.baselines.length;
    const cross = facts.baselineCross || [];
    const crossOf = (status) => cross.filter((row) => row.reviewStatus === status).reduce((sum, row) => sum + row.count, 0);
    const overlap = "Baseline rows: " + baselineSum + ". They add up across the scan statuses above. They do not match the registry analysis counts, and they are not supposed to. " +
      crossOf("excluded_language") + " baseline rows belong to language-excluded creators, whose registry analysis label was changed to excluded_language. " +
      crossOf("rejected") + " baseline rows belong to rejected creators. " +
      crossOf("reviewed") + " belong to reviewed creators. Eligibility was not changed to force these groups to match.";
    const activityNote = VM.activityFilePresent
      ? "A creator activity file was found. Status labels are still the raw baseline status, not an activity sentence glued on."
      : "registry/creator_activity.json was not in this build. Activity in the table comes from the scored Reels. Creators with a baseline and no scored Reels say so.";
    const dl = (rows) => rows.map(([label, value]) => "<div><dt>" + esc(label) + "</dt><dd>" + esc(R.fmtInt(value)) + "</dd></div>").join("");
    const sumNote = (sum, total, label) => sum === total ? "" : '<p class="check-note">' + esc(label) + " add up to " + sum + ", not " + total + ".</p>";
    $("#coverage").innerHTML = '<div class="counts"><section><h3>Creator registry</h3><dl>' + dl(reviewRows) +
      '<div><dt>Registry total</dt><dd>' + esc(R.fmtInt(facts.registryTotal)) + "</dd></div></dl>" +
      sumNote(reviewSum, facts.registryTotal || reviewSum, "Review statuses") +
      "<p class=\"overlap-note\">The directory shows reviewed, candidate, and unverified rows only (" + esc(R.fmtInt(facts.directoryCount)) + ").</p></section>" +
      "<section><h3>Registry analysis labels</h3><dl>" + dl(analysisRows) + "</dl>" +
      sumNote(analysisSum, facts.registryTotal || analysisSum, "Analysis labels") +
      "<p class=\"overlap-note\">Low sample (under 10) is not the 12 Reels / 90 days activity rule. A capped history can still meet the activity rule.</p></section>" +
      "<section><h3>Reel scans</h3><dl><div><dt>Creators with a baseline</dt><dd>" + baselineSum + "</dd></div>" +
      baselineRows.map(([label, value]) => '<div class="indent"><dt>' + esc(label) + "</dt><dd>" + value + "</dd></div>").join("") +
      "<div><dt>Reels scored</dt><dd>" + esc(R.fmtInt(facts.scoredReels)) + "</dd></div>" +
      "<div><dt>Eligible Reels in the explorer</dt><dd>" + esc(R.fmtInt(facts.eligibleReels)) + "</dd></div></dl>" +
      '<p class="overlap-note">' + esc(overlap) + " " + esc(activityNote) + "</p></section></div>" +
      '<div class="table-wrap"><table><caption class="sr-only">Baseline per creator. The mean is the scoring average. The median is information only.</caption><thead><tr>' +
      "<th>Creator</th><th class=\"r\">Sample (n)</th><th class=\"r\">Mean views</th><th class=\"r\">Median (info only)</th><th class=\"r\">Missing view counts</th>" +
      "<th>Oldest Reel sampled</th><th>Window cutoff</th><th>Scan as of</th><th>Status</th><th>Activity</th></tr></thead><tbody>" +
      VM.baselines.slice().sort((a, b) => String(a.creator).localeCompare(String(b.creator))).map((row) => {
        const act = VM.activityByCreator[row.creator];
        let activity = "Not in the scored file";
        if (act && act.mixed) activity = "Scored Reels disagree; not averaged";
        else if (act && act.activity) {
          activity = act.activity + (act.reels90d != null ? ": " + act.reels90d + " Reels / 90 days" : "") +
            (act.perMonthAvg != null ? " (" + act.perMonthAvg + "/mo)" : "") +
            (act.asOf ? ", as of " + fmtStamp(act.asOf, true) : "");
        }
        const key = R.ANALYSIS_MAP[row.status];
        return "<tr><td>" + profileLink(row.creator) + "</td><td class=\"r num\">" + esc(R.fmtInt(row.n)) + "</td><td class=\"r num\">" +
          esc(R.fmtInt(row.meanViews)) + "</td><td class=\"r num\">" + esc(R.fmtInt(row.medianViews_info_only)) + "</td><td class=\"r num\">" +
          (row.missingViewCount == null ? "—" : esc(String(row.missingViewCount))) + "</td><td>" + esc(fmtStamp(row.oldestInSampleLocal, true)) +
          "</td><td>" + esc(fmtStamp(row.cutoffLocal, true)) + "</td><td>" + esc(fmtStamp(row.snapshotLocal, true)) + "</td><td>" +
          (key ? statusPill("analysis", key) : pill("p-outline", row.status || "Not recorded")) + "</td><td>" + esc(activity) + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      '<p class="hint">A dash means the value is not in the data. Missing view counts are left out of the mean. They are not counted as zero. The median never replaces the mean.</p>';
  }

  function renderMethod() {
    const selfName = VM.policy && VM.policy.selfExclude ? VM.policy.selfExclude.join(", @") : "the excluded account in scan policy";
    const blocks = [
      ["How the outlier multiple works", "<p>A Reel's views divided by that creator's own arithmetic-mean Reel views. The mean uses the full rolling 90 days before that creator's scan, including this Reel and Reels in other languages. Creators are not compared with each other.</p><p>The median is in Data coverage for information only. It never replaces the mean. Missing play counts are left out of the mean, never treated as 0.</p>"],
      ["How picks differ from the explorer", "<ul><li><b>Editorial picks</b> were ranked by hand. Spoken, on-screen, and visual lines are separate, and each one says how it was checked. A caption is never shown as speech.</li><li><b>Explorer rows</b> are eligible Reels that pass the filters. Their text is the caption's first line and has not been checked against the video.</li><li>If a spoken or on-screen line was not recorded, the desk says so. It does not fill the gap.</li></ul>"],
      ["Who gets included", "<ul><li>The activity rule is at least 12 Reels in 90 days, about four a month on average. That is separate from a low sample, which means a baseline under 10 Reels.</li><li>Unknown posting frequency stays pending. It is not treated as active or inactive.</li><li>A capped history can meet the activity rule and still not be a complete baseline. Strong only hides those rows. It does not change their score.</li><li>English captions are what the explorer shows. The mean still includes every Reel in the window.</li><li>@" + esc(selfName) + " is excluded, including co-authored Reels when the metadata names that account. Missing metadata is not guessed.</li></ul>"],
      ["What Strong only hides", "<p>Rows whose creator status is not a complete 90-day baseline, and Reels the scorer flagged as under 3 days old. The flag uses exact elapsed time. A rounded age of 3.0 days does not put a younger Reel back into Strong only. Strong only does not recompute X.</p>"],
      ["Which date means what", "<ul><li><b>Published:</b> when the Reel went live, shown in America/Chicago with CST or CDT as that instant requires.</li><li><b>Recent and benchmark, picks:</b> exact days from publish time to the page-build time. Recent is 30 days or less. Benchmark is more than 30 and up to 90.</li><li><b>Recent and benchmark, explorer:</b> the same cutoffs, using each Reel's own measurement snapshot. This filter only changes what is displayed.</li><li><b>Views measured and followers measured:</b> the dates on that Reel or profile. They are not live.</li><li><b>Baseline window:</b> the 90 days before that creator's scan. Cutoff and scan time are per creator.</li><li><b>Page built:</b> when this file was generated.</li></ul>"],
      ["What public data can't tell you", "<p>Saves, retention, conversions, and whether views were organic or boosted are not in this data. Paid-partnership and collab flags are labels, not proof.</p>"],
      ["Weekly refresh", "<p>" + esc(VM.weeklyRefresh) + " The scan can prepare the next top 10. Putting the page live still waits until you are there. Marks are not part of that refresh.</p>"],
      ["Saved and watched marks", "<p>Stored in this browser only, under reelDesk.marks.v1. They do not sync to another device. If storage is blocked, they last for this page session and the page says so.</p>"]
    ];
    $("#method").innerHTML = blocks.map(([title, body]) => "<details><summary>" + title + '</summary><div class="body">' + body + "</div></details>").join("");
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
    $("#exp-minx").innerHTML = [[1, "1× (at or above average)"], [3, "3×"], [5, "5×"], [10, "10×"]]
      .map(([value, label]) => '<button type="button" data-x="' + value + '">' + label + "</button>").join("");
    $("#exp-date").innerHTML = [["any", "Any"], ["30", "Last 30 days"], ["90", "31–90 days"]]
      .map(([value, label]) => '<button type="button" data-d="' + value + '">' + label + "</button>").join("");
    const creators = [...new Set(VM.reels.map((row) => row.handle))].sort();
    $("#exp-creator").innerHTML = '<option value="">All creators</option>' + creators.map((name) => '<option value="' + esc(name) + '">@' + esc(name) + "</option>").join("");
    const topics = [...new Set(VM.reels.flatMap((row) => row.topics || []))].sort();
    $("#exp-topic").innerHTML = '<option value="">All topics</option>' + topics.map((topic) => '<option value="' + esc(topic) + '">' + esc(R.topicLabel(topic)) + "</option>").join("");
    const sorts = [["x", "Outlier"], ["views", "Views"], ["followers", "Followers"], ["mean", "90-day mean"], ["n", "Sample size"], ["published", "Published"]];
    $("#m-sort").innerHTML = sorts.flatMap(([key, label]) => [
      '<option value="' + key + ':desc">' + label + ", " + (key === "published" ? "newest" : "highest") + " first</option>",
      '<option value="' + key + ':asc">' + label + ", " + (key === "published" ? "oldest" : "lowest") + " first</option>"
    ]).join("");
    $("#exp-strong").checked = exp.strong;
    $("#exp-minx").addEventListener("click", (event) => {
      const button = event.target.closest("[data-x]");
      if (!button) return;
      exp.minX = +button.dataset.x;
      exp.limit = 50;
      renderExplorer();
    });
    $("#exp-date").addEventListener("click", (event) => {
      const button = event.target.closest("[data-d]");
      if (!button) return;
      exp.date = button.dataset.d;
      exp.limit = 50;
      renderExplorer();
    });
    $("#exp-creator").addEventListener("change", (event) => { exp.creator = event.target.value; exp.limit = 50; renderExplorer(); });
    $("#exp-topic").addEventListener("change", (event) => { exp.topic = event.target.value; exp.limit = 50; renderExplorer(); });
    $("#exp-q").addEventListener("input", (event) => { exp.q = event.target.value; exp.limit = 50; renderExplorer(); });
    $("#exp-strong").addEventListener("change", (event) => { exp.strong = event.target.checked; exp.limit = 50; renderExplorer(); });
    $("#exp-reset").addEventListener("click", resetExplorer);
    $("#m-sort").addEventListener("change", (event) => {
      const parts = event.target.value.split(":");
      exp.sort = parts[0];
      exp.dir = parts[1];
      renderExplorer();
    });
    $("#exp-results").addEventListener("click", (event) => {
      const button = event.target.closest("[data-sort]");
      if (!button) return;
      const key = button.dataset.sort;
      if (exp.sort === key) exp.dir = exp.dir === "desc" ? "asc" : "desc";
      else { exp.sort = key; exp.dir = "desc"; }
      renderExplorer();
      const next = $('[data-sort="' + key + '"]');
      if (next) next.focus();
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
    $("#cre-review").innerHTML = '<option value="">Any review status</option>' +
      Object.entries(R.STATUS.review).map(([key, value]) => '<option value="' + key + '">' + esc(value.label) + "</option>").join("");
    $("#cre-analysis").innerHTML = '<option value="">Any analysis status</option>' +
      ["full", "provisional", "low_n", "insufficient", "no_reels", "pending", "not_scanned"].map((key) =>
        '<option value="' + key + '">' + esc(R.STATUS.analysis[key].label) + "</option>").join("");
    const topics = [...new Set(VM.creators.flatMap((row) => row.topics || []))].sort();
    $("#cre-topic").innerHTML = '<option value="">All topics</option>' + topics.map((topic) => '<option value="' + esc(topic) + '">' + esc(R.topicLabel(topic)) + "</option>").join("");
    ["review", "analysis", "topic"].forEach((key) => {
      $("#cre-" + key).addEventListener("change", (event) => { cre[key] = event.target.value; renderCreators(); });
    });
    $("#cre-q").addEventListener("input", (event) => { cre.q = event.target.value; renderCreators(); });
  }

  function boot() {
    const holder = $("#desk-data");
    let embedded = {};
    try {
      embedded = JSON.parse(holder ? holder.textContent : "{}");
    } catch (err) {
      $("#main").innerHTML = '<div class="empty"><h3>This page could not read its embedded data.</h3><p>Regenerate it with the desk builder. Nothing was fetched.</p></div>';
      return;
    }
    VM = R.toViewModel(embedded);
    $("#tc-explore").textContent = String(VM.reels.length);
    renderFreshness();
    renderModel();
    initExplorer();
    initCreators();
    renderExplorer();
    renderCreators();
    renderShortlist();
    renderCoverage();
    renderMethod();
    showTab((location.hash || "#model").slice(1));
  }

  document.addEventListener("click", async (event) => {
    const copy = event.target.closest("[data-copy]");
    if (copy) {
      const url = copy.dataset.copy;
      if (await copyText(url)) toast("Link copied");
      else toast("Couldn't copy automatically. The link is selected below; press Ctrl+C or ⌘C.", { fallback: url });
      return;
    }
    const mark = event.target.closest("[data-mark]");
    if (mark) {
      const on = Store.toggle(mark.dataset.mark, mark.dataset.id);
      toast(mark.dataset.mark === "saved" ? (on ? "Saved in this browser" : "Removed from saved") : (on ? "Marked as watched" : "Marked as not watched"));
      const rank = recState.sel;
      renderModel();
      const again = document.querySelector('[data-mark="' + mark.dataset.mark + '"][data-id="' + CSS.escape(mark.dataset.id || "") + '"]');
      if (again) again.focus();
      else {
        const pick = document.querySelector('.rail-item[data-rank="' + rank + '"]');
        if (pick) pick.focus();
      }
    }
  });
  $("#tablist").addEventListener("click", (event) => {
    const tab = event.target.closest(".tab");
    if (tab) showTab(tab.dataset.tab);
  });
  $("#tablist").addEventListener("keydown", (event) => {
    const tabs = $$(".tab");
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    let next = null;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next != null) {
      event.preventDefault();
      showTab(tabs[next].dataset.tab, true);
    }
  });
  window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));
  $("#rec-age").addEventListener("click", (event) => {
    const button = event.target.closest("[data-age]");
    if (!button) return;
    recState.age = button.dataset.age;
    renderModel();
  });
  $("#rec-hide-watched").addEventListener("change", (event) => {
    recState.hideWatched = event.target.checked;
    renderModel();
  });
  $("#rail").addEventListener("click", (event) => {
    const button = event.target.closest(".rail-item");
    if (!button) return;
    const rank = Number(button.dataset.rank);
    recState.sel = (mqMobile.matches && recState.sel === rank) ? null : rank;
    renderModel();
    const next = document.querySelector('.rail-item[data-rank="' + rank + '"]');
    if (next) next.focus();
  });
  $("#rail").addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = $$(".rail-item");
    const index = items.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === "ArrowDown" ? Math.min(index + 1, items.length - 1)
      : event.key === "ArrowUp" ? Math.max(index - 1, 0)
        : event.key === "Home" ? 0 : items.length - 1;
    items[next].focus();
  });
  mqMobile.addEventListener("change", renderModel);
  boot();
})();
