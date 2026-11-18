#!/usr/bin/env python3
"""Write the Outlier Research JSON bundle. No static site, no desk HTML."""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "generator"))
from extract import build_payload  # noqa: E402

CHICAGO = ZoneInfo("America/Chicago")


def hook_text(item: dict) -> str:
    asr = str(item.get("spokenHookASR") or "").strip()
    on_screen = str(item.get("onScreenHook") or "").strip()
    if re.match(r"(?i)^(no speech|no clear spoken|spoken english was not)\b", asr):
        return on_screen or asr
    asr = re.sub(r"^\[[^\]]+\]\s*", "", asr).strip()
    quoted = re.search(r'["“](.+?)["”]', asr)
    if quoted:
        return quoted.group(1).strip()
    return asr or on_screen


def card_from_pick(item: dict) -> dict:
    return {
        "id": item.get("shortCode") or item.get("id") or "",
        "rank": item.get("rank"),
        "title": hook_text(item) or item.get("creator") or "Untitled",
        "creator": item.get("creator") or item.get("creator_handle") or "",
        "url": item.get("reelUrl") or item.get("post_url") or item.get("url") or "",
        "poster": item.get("poster") or "",
        "views": item.get("views"),
        "multiplier": item.get("outlierX"),
        "published": item.get("publishedLocal") or item.get("published") or "",
        "hook": hook_text(item),
        "why": item.get("why") or "",
        "adapt": item.get("angle") or "",
        "paid": item.get("paidPartnership") is True,
        "followers": item.get("followers"),
    }


def card_from_row(row: dict) -> dict:
    return {
        "id": row.get("shortCode") or row.get("url") or "",
        "title": row.get("captionFirstLine") or "No caption recorded.",
        "creator": row.get("creator") or "",
        "url": row.get("url") or "",
        "poster": row.get("poster") or "",
        "views": row.get("views"),
        "multiplier": row.get("outlierX"),
        "published": row.get("publishLocal") or "",
        "hook": row.get("captionFirstLine") or "",
        "followers": row.get("followers"),
    }


def inspire_hook(card: dict) -> str:
    hook = card.get("hook") or {}
    if not isinstance(hook, dict):
        return str(hook or "")
    spoken = (hook.get("spoken_audio") or {}).get("value") or ""
    visual = (hook.get("visual") or {}).get("value") or ""
    screen = (hook.get("on_screen_text") or {}).get("value") or ""
    return spoken or screen or visual


def card_from_inspire(card: dict) -> dict:
    return {
        "id": card.get("id") or card.get("dedupe_key") or "",
        "title": inspire_hook(card) or "Inspiration",
        "creator": card.get("creator_handle") or "",
        "url": card.get("post_url") or "",
        "poster": card.get("poster") or "",
        "hook": inspire_hook(card),
        "paid_label": "Paid ad" if card.get("is_paid_ad") is True else "Paid status unknown",
        "source": card.get("source_key") or "",
    }


def card_from_person(person: dict) -> dict:
    return {
        "id": person.get("username") or "",
        "title": person.get("name") or person.get("username") or "",
        "creator": person.get("username") or "",
        "url": person.get("profileUrl") or "",
        "hook": person.get("whyFit") or "",
        "followers": person.get("followers"),
        "tier": person.get("tier") or "",
    }


def yt_card(item: dict, group: str) -> dict:
    return {
        "id": item.get("id") or "",
        "group": group,
        "title": item.get("title") or "",
        "creator": item.get("channel") or "",
        "channel": item.get("channel") or "",
        "url": item.get("url") or "",
        "poster": item.get("poster") or "",
        "views": item.get("views"),
        "multiplier": item.get("medianX"),
        "subs": item.get("subs"),
        "published": item.get("published") or "",
        "hook": item.get("hook") or "",
        "niche": item.get("niche") or "",
        "ai_twist": item.get("aiTwist") or "",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Export the Outlier Research data bundle")
    parser.add_argument("--reels-dir", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--built-at", default=None)
    parser.add_argument("--window-label", default=None)
    args = parser.parse_args()
    built = args.built_at or datetime.now(CHICAGO).isoformat(timespec="seconds")
    payload = build_payload(args.reels_dir, built)
    youtube = payload.get("youtube") or {}
    window_label = args.window_label or youtube.get("window_label") or "Last 90 Days"
    bundle = {
        "built_at": built,
        "yt": {
            "window_label": window_label,
            "mine": [yt_card(item, "mine") for item in youtube.get("mine") or []],
            "peers": [yt_card(item, "peers") for item in youtube.get("peers") or []],
            "broad": [yt_card(item, "broad") for item in youtube.get("broad") or []],
            "big": [yt_card(item, "big") for item in youtube.get("big") or []],
        },
        "ig": {
            "picks": [card_from_pick(item) for item in payload.get("recs") or []],
            "history": [
                {
                    "label": group.get("set_label") or "Previous",
                    "retired_on": group.get("retired_on") or "",
                    "picks": [card_from_pick(item) for item in group.get("picks") or []],
                }
                for group in payload.get("history") or []
            ],
            "explore": [card_from_row(row) for row in payload.get("rows") or []],
            "inspire": [
                card_from_inspire(card) for card in (payload.get("crossNiche") or {}).get("candidates") or []
            ],
            "shortlist": [
                card_from_person(person)
                for person in ((payload.get("shortlist") or {}).get("candidates") or [])
            ],
        },
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(bundle, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    yt = bundle["yt"]
    print(
        f"wrote {args.out} picks={len(bundle['ig']['picks'])} "
        f"explore={len(bundle['ig']['explore'])} inspire={len(bundle['ig']['inspire'])} "
        f"yt={len(yt['mine'])}/{len(yt['peers'])}/{len(yt['broad'])}/{len(yt['big'])}"
    )


if __name__ == "__main__":
    main()
