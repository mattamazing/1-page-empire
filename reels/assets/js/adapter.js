/* Pure view-model and filter logic. No network. No scoring. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ReelDesk = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const WEEKLY_REFRESH_TEXT =
    "Scan and top-10 prep: Mondays about 9:00 AM America/Chicago (±15 min), from Nov 9, 2026. Publishing the page is manual and needs you present.";
  const BASELINE_STRIP_TEXT =
    "Each creator's own 90 days before that creator's scan";

  const PRESETS = [
    { id: "under50", label: "Under 50K", min: 10000, max: 49999 },
    { id: "50-100", label: "50K–100K", min: 50000, max: 99999 },
    { id: "100-500", label: "100K–500K", min: 100000, max: 499999 },
    { id: "500-1m", label: "500K–1M", min: 500000, max: 999999 },
    { id: "1m", label: "1M+", min: 1000000, max: null }
  ];
  const DEFAULT_RANGE = { minRaw: "10,000", maxRaw: "" };
  const EXP_DEFAULT = {
    minX: 3, creator: "", topic: "", strong: true, q: "", date: "any",
    sort: "x", dir: "desc", limit: 50
  };

  const STATUS = {
    review: {
      relevant: { label: "Reviewed: relevant", cls: "p-neutral" },
      candidate: { label: "Candidate: relevant, small or inactive", cls: "p-neutral" },
      unverified: { label: "Discovered, not verified", cls: "p-outline" }
    },
    analysis: {
      full: { label: "Fully analyzed", cls: "p-solid", desc: "Complete 90-day history scanned." },
      provisional: { label: "Provisional: capped history", cls: "p-warn", desc: "Scan hit a limit before covering 90 days." },
      low_n: { label: "Low sample (under 10)", cls: "p-warn", desc: "Too few Reels for a stable baseline. Separate from the 12 Reels / 90 days activity rule." },
      insufficient: { label: "No Reels in 90 days", cls: "p-danger", desc: "The scan reached the window and found no eligible Reels." },
      pending: { label: "Activity unknown", cls: "p-outline", desc: "Posting frequency not checked yet." },
      not_scanned: { label: "Not scanned yet", cls: "p-outline", desc: "No Reel scan has run." },
      no_reels: { label: "No Reels returned", cls: "p-danger", desc: "The scan returned no Reels." },
      excluded_language: { label: "Excluded: language rule", cls: "p-outline", desc: "Hidden from the directory. The baseline row is kept." },
      excluded_self: { label: "Excluded: own account", cls: "p-outline", desc: "Dropped by the self-exclude rule." }
    },
    eligibility: {
      active: { label: "Meets activity rule", cls: "p-fresh" },
      pending: { label: "Activity unknown", cls: "p-outline" },
      not_eligible: { label: "Below activity rule", cls: "p-danger" }
    }
  };

  const REVIEW_MAP = {
    reviewed: "relevant",
    candidate: "candidate",
    candidate_unverified: "unverified"
  };
  const ANALYSIS_MAP = {
    analyzed_full_90d: "full",
    analyzed_capped_history: "provisional",
    analyzed_low_n: "low_n",
    no_eligible_reels_90d: "insufficient",
    pending: "pending",
    not_queued: "not_scanned",
    no_reels_returned: "no_reels",
    excluded_language: "excluded_language",
    excluded_self: "excluded_self"
  };

  function parseFollowers(raw) {
    const s = String(raw ?? "").trim().toLowerCase().replace(/[,\s_]/g, "");
    if (!s) return null;
    const m = s.match(/^(\d+(?:\.\d+)?)([km])?$/);
    if (!m) return NaN;
    let v = parseFloat(m[1]);
    if (m[2] === "k") v *= 1e3;
    if (m[2] === "m") v *= 1e6;
    return Math.round(v);
  }

  function parseRange(minRaw, maxRaw) {
    const min = parseFollowers(minRaw);
    const max = parseFollowers(maxRaw);
    if (Number.isNaN(min)) {
      return { error: "Minimum followers isn't a number. Try 50000, 50,000, 50k or 1m.", field: "min" };
    }
    if (Number.isNaN(max)) {
      return { error: "Maximum followers isn't a number. Try 50000, 50,000, 50k or 1m.", field: "max" };
    }
    if (min != null && max != null && min > max) {
      return {
        error: "Minimum (" + fmtInt(min) + ") is above maximum (" + fmtInt(max) + "). Results are paused until the range is fixed.",
        field: "both"
      };
    }
    return { min: min, max: max };
  }

  function presetMatch(parsed) {
    if (!parsed || parsed.error) return null;
    for (const preset of PRESETS) {
      if (parsed.min === preset.min && parsed.max === preset.max) return preset.id;
    }
    return null;
  }

  function describeRange(parsed) {
    if (parsed.error) return parsed.error;
    if (parsed.min == null && parsed.max == null) return "Any follower count.";
    if (parsed.max == null) return fmtInt(parsed.min) + " or more followers.";
    if (parsed.min == null) return "Up to " + fmtInt(parsed.max) + " followers.";
    return fmtInt(parsed.min) + " to " + fmtInt(parsed.max) + " followers, both included.";
  }

  function fmtInt(n) {
    if (n == null || Number.isNaN(n)) return "—";
    return Math.round(n).toLocaleString("en-US");
  }

  function exactElapsedDays(publishLocal, endLocal) {
    const pub = Date.parse(publishLocal);
    const end = Date.parse(endLocal);
    if (Number.isNaN(pub) || Number.isNaN(end)) return null;
    return (end - pub) / 86400000;
  }

  function formatDays(elapsed, youngFlag) {
    if (elapsed == null || Number.isNaN(elapsed)) return "age not recorded";
    const rounded1 = Number(elapsed.toFixed(1));
    const crosses = (elapsed < 3) !== (rounded1 < 3)
      || (elapsed <= 30) !== (rounded1 <= 30)
      || (elapsed <= 90) !== (rounded1 <= 90)
      || (youngFlag === true && rounded1 >= 3);
    const text = crosses ? elapsed.toFixed(2) : elapsed.toFixed(1);
    return text + "d";
  }

  function recencyFromElapsed(elapsed, youngFlag) {
    if (elapsed == null || Number.isNaN(elapsed)) {
      return { key: "unknown", label: "Age not recorded", short: "Age not recorded" };
    }
    const days = formatDays(elapsed, youngFlag);
    if (elapsed <= 30) return { key: "fresh", label: "Recent, " + days + " old", short: "Recent " + days };
    if (elapsed <= 90) return { key: "bench", label: "Benchmark, " + days + " old", short: "Benchmark " + days };
    return { key: "old", label: "Older than 90 days, " + days + " old", short: days };
  }

  function isStrongRow(row) {
    return row.creatorStatus === "analyzed_full_90d" && !row.youngProvisional;
  }

  function conceptFromWhy(why) {
    const text = String(why || "").trim();
    if (!text) return "Not recorded";
    const sentence = text.split(/(?<=[.!?])\s/)[0].trim();
    if (sentence.length <= 60) return sentence;
    const cut = sentence.slice(0, 60);
    const space = cut.lastIndexOf(" ");
    const base = (space > 40 ? cut.slice(0, space) : cut).replace(/[,\s]+$/, "");
    return base + "…";
  }

  function mapBaseline(status) {
    if (status == null || status === "") return null;
    if (status === "analyzed_full_90d") return "complete";
    if (status === "analyzed_capped_history") return "provisional";
    return null;
  }

  function baselineLabel(status) {
    if (status == null || status === "") return "Not in this data";
    const key = ANALYSIS_MAP[status];
    if (key && STATUS.analysis[key]) return STATUS.analysis[key].label;
    return String(status);
  }

  function extractOuter(raw, splitSemi) {
    let body = "";
    const parens = [];
    let semiTail = null;
    let quote = null;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (quote) {
        body += c;
        const closes = (quote === '"' && c === '"') || (quote === "“" && c === "”") || (quote === "”" && c === "“");
        if (closes) quote = null;
        continue;
      }
      if (c === '"' || c === "“") {
        quote = c;
        body += c;
        continue;
      }
      if (c === "(") {
        let end = -1;
        for (let j = i + 1; j < raw.length; j++) {
          if (raw[j] === ")") { end = j; break; }
        }
        if (end === -1) {
          body += c;
          continue;
        }
        parens.push(raw.slice(i + 1, end).trim());
        i = end;
        continue;
      }
      if (c === ";" && splitSemi !== false) {
        semiTail = raw.slice(i + 1).trim();
        break;
      }
      body += c;
    }
    return { body: body.replace(/\s+/g, " ").trim(), parens: parens, semiTail: semiTail };
  }

  function classifyParen(text) {
    if (/foley|sound only/i.test(text)) return "foley";
    if (/dynamic text/i.test(text)) return "onscreen-note";
    if (/^~\s*\d|^about\s+\d|^\d+(\.\d+)?\s*s$/i.test(text)) return "ts";
    return "visual";
  }

  function tailIsVisual(tail) {
    if (!tail) return false;
    if (/^(ending|labels)\b/i.test(tail)) return false;
    if (/["“]/.test(tail)) return false;
    return true;
  }

  function parseSpoken(asr, checked) {
    let raw = String(asr).trim();
    let ts;
    const tm = raw.match(/^\[([^\]]+)\]\s*/);
    if (tm) {
      ts = tm[1];
      raw = raw.slice(tm[0].length).trim();
    }
    const notes = [];
    const lead = raw.match(/^([^"“]+?):\s*(?=["“])/);
    if (lead) {
      notes.push(lead[1].trim());
      raw = raw.slice(lead[0].length).trim();
    }
    const outer = extractOuter(raw);
    let text = outer.body;
    let verbatim = false;
    const quoted = text.match(/^["“]([\s\S]*?)["”]$/);
    if (quoted) {
      text = quoted[1];
      verbatim = true;
    }
    const visuals = [];
    for (const paren of outer.parens) {
      const kind = classifyParen(paren);
      if (kind === "visual") visuals.push(paren);
      else if (kind === "foley" || kind === "onscreen-note") notes.push(paren);
      else if (kind === "ts" && !ts) ts = paren;
    }
    const hook = { src: checked ? "asr_video" : "asr", text: text, verbatim: verbatim };
    if (ts) hook.ts = ts;
    if (notes.length) hook.note = notes.join(". ");
    return { hook: hook, visuals: visuals };
  }

  function classifyCollected(parens) {
    const visuals = [];
    const notes = [];
    const foley = [];
    let ts;
    for (const paren of parens) {
      const kind = classifyParen(paren);
      if (kind === "visual") visuals.push(paren);
      else if (kind === "onscreen-note") notes.push(paren);
      else if (kind === "ts") ts = paren;
      else if (kind === "foley") foley.push(paren);
    }
    return { visuals: visuals, notes: notes, foley: foley, ts: ts };
  }

  function parseOnScreen(onSrc) {
    let raw = String(onSrc).trim().replace(/^no spoken[^.]*\.\s*/i, "");
    const label = raw.match(/^on-screen text:\s*/i);
    if (label) raw = raw.slice(label[0].length);
    const split = extractOuter(raw, true);
    let visuals = [];
    let collected;
    let main;
    if (tailIsVisual(split.semiTail)) {
      visuals.push(split.semiTail);
      collected = classifyCollected(split.parens);
      main = split.body;
    } else {
      const whole = extractOuter(raw, false);
      collected = classifyCollected(whole.parens);
      main = whole.body;
    }
    visuals = visuals.concat(collected.visuals);
    const quoted = main.match(/^["“]([\s\S]*?)["”]$/);
    const hook = { src: "video" };
    if (quoted && !/labels:|ending:/i.test(main)) {
      hook.text = quoted[1];
      hook.verbatim = true;
    } else {
      hook.text = main;
      hook.verbatim = false;
    }
    if (collected.ts) hook.ts = collected.ts;
    if (collected.notes.length) hook.note = collected.notes.join(". ");
    if (!hook.text) return { hook: { src: "missing" }, visuals: visuals, foley: collected.foley };
    return { hook: hook, visuals: visuals, foley: collected.foley };
  }

  function parseHooks(item) {
    const asr = item.spokenHookASR;
    const onSrc = item.onScreenHook;
    const closing = item.closing ? String(item.closing).trim() : "";
    const checked = item.asrCorrected === true;
    let spoken;
    let spokenVisuals = [];
    if (asr && String(asr).trim()) {
      const parsed = parseSpoken(asr, checked);
      spoken = parsed.hook;
      spokenVisuals = parsed.visuals;
    } else if (onSrc && /no spoken/i.test(onSrc)) {
      spoken = { src: "none" };
    } else {
      spoken = { src: "missing" };
    }
    let onscreen = { src: "missing" };
    let onVisuals = [];
    let foley = [];
    if (onSrc && String(onSrc).trim()) {
      const parsed = parseOnScreen(onSrc);
      onscreen = parsed.hook;
      onVisuals = parsed.visuals;
      foley = parsed.foley || [];
    }
    if (spoken.src === "none") {
      const notes = [];
      if (foley.length) notes.push(foley.join(". "));
      if (closing) notes.push(closing);
      if (notes.length) spoken.note = notes.join(" ");
    } else if (closing && spoken.src === "missing") {
      spoken.note = closing;
    }
    const visuals = spokenVisuals.concat(onVisuals).filter(Boolean);
    const visual = visuals.length
      ? { src: "video", text: visuals.join(" "), verbatim: false }
      : { src: "missing" };
    return { spoken: spoken, onscreen: onscreen, visual: visual };
  }

  function cautionsFrom(item) {
    const text = item.caution == null ? "" : String(item.caution).trim();
    if (!text) return [];
    const commercial = item.paidPartnership === true || item.commercialNote === true;
    return [{ kind: commercial ? "paid" : "warn", text: text }];
  }

  function fitFromQuality(score) {
    if (score == null || score === "") return { word: "Not rated", segments: 0 };
    if (score >= 5) return { word: "Strong fit", segments: 3 };
    if (score >= 4) return { word: "Good fit", segments: 2 };
    if (score >= 1) return { word: "Possible fit", segments: 1 };
    return { word: "Not rated", segments: 0 };
  }

  function topicLabel(topic) {
    return String(topic).replace(/_/g, " ");
  }

  function flagsFor(row) {
    const flags = [];
    if (row.creatorStatus === "analyzed_capped_history") flags.push("capped");
    if (row.creatorStatus === "analyzed_low_n" || (row.n != null && row.n < 10)) flags.push("lown");
    if (row.youngProvisional || (row.elapsed != null && row.elapsed < 3)) flags.push("young");
    if (row.isPinned) flags.push("pinned");
    if (row.isCollab) flags.push("collab");
    if (row.paidPartnership) flags.push("paid");
    if (row.langReason && String(row.langReason).startsWith("caption minimal")) flags.push("lang");
    return flags;
  }

  function rowsByCode(rows) {
    const map = Object.create(null);
    for (const row of rows || []) {
      if (row.shortCode) map[row.shortCode] = row;
    }
    return map;
  }

  function numberOrNull(value) {
    return value == null || value === "" ? null : value;
  }

  function toReel(row) {
    const elapsed = exactElapsedDays(row.publishLocal, row.snapshotLocal);
    const reel = {
      x: numberOrNull(row.outlierX),
      handle: row.creator,
      code: row.shortCode || null,
      url: row.url || null,
      followers: numberOrNull(row.followers),
      views: numberOrNull(row.views),
      mean: numberOrNull(row.meanViews),
      n: numberOrNull(row.n),
      published: row.publishLocal || null,
      publishedMs: Date.parse(row.publishLocal),
      elapsed: elapsed,
      ageDaysStored: row.ageDays,
      caption: row.captionFirstLine || null,
      topics: row.topics || [],
      creatorStatus: row.creatorStatus,
      youngProvisional: !!row.youngProvisional,
      isPinned: !!row.isPinned,
      isCollab: !!row.isCollab,
      paidPartnership: !!row.paidPartnership,
      langReason: row.langReason || "",
      owner: row.owner || null,
      followerBand: row.followerBand || null,
      baseline: mapBaseline(row.creatorStatus)
    };
    if (Number.isNaN(reel.publishedMs)) reel.publishedMs = null;
    reel.flags = flagsFor(reel);
    return reel;
  }

  function toRec(item, scored, buildIso) {
    const x = scored ? numberOrNull(scored.outlierX) : numberOrNull(item.outlierX);
    const mean = scored ? numberOrNull(scored.meanViews) : numberOrNull(item.mean90d);
    const views = scored ? numberOrNull(scored.views) : numberOrNull(item.views);
    const n = scored ? numberOrNull(scored.n) : numberOrNull(item.n90d);
    const followers = scored ? numberOrNull(scored.followers) : numberOrNull(item.followers);
    return {
      rank: item.rank,
      handle: item.creator,
      name: item.fullName || "",
      code: item.shortCode || null,
      url: item.reelUrl || (scored && scored.url) || null,
      profileUrl: item.profileUrl || null,
      concept: conceptFromWhy(item.why),
      x: x,
      views: views,
      mean: mean,
      n: n,
      followers: followers,
      views_asof: item.viewsAsOf || null,
      followers_asof: item.followersAsOf || null,
      published: item.publishedLocal || item.published || null,
      elapsed: exactElapsedDays(item.publishedLocal || item.published, buildIso),
      baseline: mapBaseline(item.baseline),
      baselineRaw: item.baseline || null,
      baselineLabel: baselineLabel(item.baseline),
      paid: item.paidPartnership === true,
      commercial: item.commercialNote === true,
      hooks: parseHooks(item),
      why: item.why || null,
      adapt: item.angle || null,
      cautions: cautionsFrom(item)
    };
  }

  function toCreator(row) {
    return {
      handle: row.username,
      name: row.fullName || "",
      followers: numberOrNull(row.followers),
      followers_asof: row.followersRetrievedLocal || null,
      band: row.followerBand || null,
      topics: row.topics || [],
      bio: row.bio || "",
      why: row.whyRelevant || "",
      found: (row.discoveryQueries || []).filter(Boolean).join("; "),
      review: REVIEW_MAP[row.status] || "unverified",
      reviewRaw: row.status,
      analysis: ANALYSIS_MAP[row.analysisStatus] || "not_scanned",
      analysisRaw: row.analysisStatus,
      verified: !!row.verified,
      activeLast90d: row.activeLast90d
    };
  }

  function shortlistEligibility(candidate) {
    const verdict = (candidate.activity || {}).verdict;
    if (candidate.eligible) return "active";
    if (verdict === "pending_unverified" || verdict == null) return "pending";
    return "not_eligible";
  }

  function toShortlistPerson(candidate) {
    const activity = candidate.activity || {};
    return {
      handle: candidate.username,
      name: candidate.name || "",
      profileUrl: candidate.profileUrl || null,
      followers: numberOrNull(candidate.followers),
      followers_asof: candidate.followersAsOf || null,
      cohort: candidate.cohort,
      tier: candidate.tier || "",
      fit: fitFromQuality(candidate.qualityScore),
      aiRank: candidate.aiRank == null ? null : candidate.aiRank,
      aiFocus: candidate.aiFocus || "",
      eligibility: shortlistEligibility(candidate),
      activity: activity,
      why: candidate.whyFit || "",
      relationship: candidate.ryanRelationship || "",
      examples: candidate.examples || [],
      sources: candidate.sources || [],
      warnings: candidate.warnings || [],
      status: candidate.status || ""
    };
  }

  function toViewModel(embedded) {
    const data = embedded || {};
    const buildIso = (data.build && data.build.iso) || null;
    const scoredRows = data.rows || [];
    const byCode = rowsByCode(scoredRows);
    const recs = (data.recs || [])
      .map(function (item) { return toRec(item, byCode[item.shortCode], buildIso); })
      .sort(function (a, b) { return a.rank - b.rank; });
    const reels = scoredRows.map(toReel);
    const creators = (data.dir || []).map(toCreator);
    const people = (data.shortlist && data.shortlist.candidates ? data.shortlist.candidates : []).map(toShortlistPerson);
    people.sort(function (a, b) {
      const aAi = a.cohort === "AI Marketing" ? 0 : 1;
      const bAi = b.cohort === "AI Marketing" ? 0 : 1;
      if (aAi !== bAi) return aAi - bAi;
      const ar = a.aiRank == null ? 999 : a.aiRank;
      const br = b.aiRank == null ? 999 : b.aiRank;
      if (ar !== br) return ar - br;
      const aCore = a.tier === "core" ? 0 : 1;
      const bCore = b.tier === "core" ? 0 : 1;
      if (aCore !== bCore) return aCore - bCore;
      return (b.fit.segments || 0) - (a.fit.segments || 0);
    });
    return {
      build: data.build || { iso: null, zone: "America/Chicago" },
      recs: recs,
      recsOmittedReason: data.recsOmittedReason || null,
      reels: reels,
      creators: creators,
      shortlist: {
        meta: (data.shortlist && data.shortlist.meta) || {},
        audit: (data.shortlist && data.shortlist.aiCohortAudit) || {},
        people: people
      },
      baselines: data.bl || [],
      activityByCreator: data.activityByCreator || {},
      activityFilePresent: !!data.activityFile,
      coverage: data.coverage || {},
      policy: data.policy || null,
      weeklyRefresh: WEEKLY_REFRESH_TEXT,
      baselineStrip: BASELINE_STRIP_TEXT
    };
  }

  function inFollowerRange(followers, parsed) {
    if (parsed.min == null && parsed.max == null) return true;
    if (followers == null) return false;
    return (parsed.min == null || followers >= parsed.min) && (parsed.max == null || followers <= parsed.max);
  }

  function sortRows(rows, key, dir) {
    const sign = dir === "asc" ? 1 : -1;
    const value = function (row) {
      if (key === "x") return row.x;
      if (key === "views") return row.views;
      if (key === "followers") return row.followers;
      if (key === "mean") return row.mean;
      if (key === "n") return row.n;
      if (key === "published") return row.publishedMs;
      return null;
    };
    return rows.slice().sort(function (a, b) {
      const av = value(a);
      const bv = value(b);
      const aMissing = av == null || Number.isNaN(av);
      const bMissing = bv == null || Number.isNaN(bv);
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1;
      if (bMissing) return -1;
      if (av === bv) return 0;
      return av > bv ? sign : -sign;
    });
  }

  function filterReels(reels, state, parsedRange) {
    if (parsedRange.error) return { error: parsedRange.error, rows: [], hiddenUnknown: 0 };
    const q = String(state.q || "").trim().toLowerCase();
    let hiddenUnknown = 0;
    const rows = [];
    for (const row of reels) {
      const bounded = parsedRange.min != null || parsedRange.max != null;
      if (row.followers == null) {
        if (bounded) {
          hiddenUnknown += 1;
          continue;
        }
      } else if (!inFollowerRange(row.followers, parsedRange)) {
        continue;
      }
      if (row.x == null || row.x < state.minX) continue;
      if (state.creator && row.handle !== state.creator) continue;
      if (state.topic && !(row.topics || []).includes(state.topic)) continue;
      if (state.strong && !isStrongRow(row)) continue;
      if (q && !String(row.caption || "").toLowerCase().includes(q)) continue;
      if (state.date === "30" && !(row.elapsed != null && row.elapsed <= 30)) continue;
      if (state.date === "90" && !(row.elapsed != null && row.elapsed > 30 && row.elapsed <= 90)) continue;
      rows.push(row);
    }
    return { rows: sortRows(rows, state.sort || "x", state.dir || "desc"), hiddenUnknown: hiddenUnknown };
  }

  function filterCreators(creators, state, parsedRange) {
    if (parsedRange.error) return { error: parsedRange.error, rows: [], hiddenUnknown: 0 };
    const q = String(state.q || "").trim().toLowerCase();
    let hiddenUnknown = 0;
    const rows = [];
    for (const row of creators) {
      const bounded = parsedRange.min != null || parsedRange.max != null;
      if (row.followers == null) {
        if (bounded) {
          hiddenUnknown += 1;
          continue;
        }
      } else if (!inFollowerRange(row.followers, parsedRange)) {
        continue;
      }
      if (state.review && row.review !== state.review) continue;
      if (state.analysis && row.analysis !== state.analysis) continue;
      if (state.topic && !(row.topics || []).includes(state.topic)) continue;
      if (q) {
        const hay = (row.handle + " " + row.name + " " + row.bio + " " + row.why).toLowerCase();
        if (!hay.includes(q)) continue;
      }
      rows.push(row);
    }
    return { rows: rows, hiddenUnknown: hiddenUnknown };
  }

  function hookGrounded(hook, sources) {
    if (!hook) return true;
    const parts = [hook.text, hook.note, hook.ts].filter(Boolean);
    return parts.every(function (part) {
      if (sources.some(function (source) { return source && String(source).includes(part); })) return true;
      return String(part).split(". ").every(function (piece) {
        return sources.some(function (source) { return source && String(source).includes(piece); });
      });
    });
  }

  return {
    WEEKLY_REFRESH_TEXT: WEEKLY_REFRESH_TEXT,
    BASELINE_STRIP_TEXT: BASELINE_STRIP_TEXT,
    PRESETS: PRESETS,
    DEFAULT_RANGE: DEFAULT_RANGE,
    EXP_DEFAULT: EXP_DEFAULT,
    STATUS: STATUS,
    REVIEW_MAP: REVIEW_MAP,
    ANALYSIS_MAP: ANALYSIS_MAP,
    parseFollowers: parseFollowers,
    parseRange: parseRange,
    presetMatch: presetMatch,
    describeRange: describeRange,
    fmtInt: fmtInt,
    exactElapsedDays: exactElapsedDays,
    formatDays: formatDays,
    recencyFromElapsed: recencyFromElapsed,
    isStrongRow: isStrongRow,
    conceptFromWhy: conceptFromWhy,
    parseHooks: parseHooks,
    fitFromQuality: fitFromQuality,
    topicLabel: topicLabel,
    flagsFor: flagsFor,
    toViewModel: toViewModel,
    filterReels: filterReels,
    filterCreators: filterCreators,
    sortRows: sortRows,
    inFollowerRange: inFollowerRange,
    hookGrounded: hookGrounded,
    mapBaseline: mapBaseline,
    baselineLabel: baselineLabel
  };
});
