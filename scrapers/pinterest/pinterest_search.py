#!/usr/bin/env python3
"""Pinterest image search via the unofficial BaseSearchResource JSON endpoint.

CLI:
    python pinterest_search.py "wabi sabi interior" --limit 10

As a module:
    from pinterest_search import pinterest_search
    results = pinterest_search("brutalist architecture", limit=10)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

import requests

ENDPOINT = "https://www.pinterest.com/resource/BaseSearchResource/get/"

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/121.0.0.0 Safari/537.36"
)

DEFAULT_APP_VERSION = "2142b55"  # fallback if we can't parse the live one


def _resource_headers(query: str, app_version: str, csrf: str) -> dict[str, str]:
    referer = f"https://www.pinterest.com/search/pins/?q={quote(query)}"
    return {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": referer,
        "X-Requested-With": "XMLHttpRequest",
        "X-APP-VERSION": app_version,
        "X-Pinterest-AppState": "active",
        "X-Pinterest-Source-Url": f"/search/pins/?q={quote(query)}",
        "X-Pinterest-PWS-Handler": "www/search/[scope].js",
        "X-CSRFToken": csrf,
        "Screen-Dpr": "2",
    }


def _params(query: str, bookmark: str | None) -> dict[str, str]:
    options: dict[str, Any] = {
        "query": query,
        "scope": "pins",
        "page_size": 25,
        "auto_correction_disabled": False,
        "filters": "",
        "top_pin_id": "",
        "appliedProductFilters": "---",
        "article": "",
    }
    if bookmark:
        options["bookmarks"] = [bookmark]
    data = {"options": options, "context": {}}
    return {
        "source_url": f"/search/pins/?q={quote(query)}",
        "data": json.dumps(data, separators=(",", ":")),
    }


def _best_image(images: dict[str, Any]) -> dict[str, Any] | None:
    # Pinterest returns several sizes — prefer the highest resolution available.
    for key in ("orig", "736x", "564x", "474x", "236x"):
        if key in images and images[key].get("url"):
            return images[key]
    return None


def _normalize(pin: dict[str, Any]) -> dict[str, Any] | None:
    images = pin.get("images")
    if not isinstance(images, dict):
        return None
    img = _best_image(images)
    if not img:
        return None
    pin_id = pin.get("id")
    return {
        "id": pin_id,
        "title": (pin.get("title") or pin.get("grid_title") or "").strip(),
        "description": (pin.get("description") or "").strip(),
        "alt_text": pin.get("auto_alt_text") or pin.get("alt_text") or "",
        "image_url": img["url"],
        "width": img.get("width"),
        "height": img.get("height"),
        "pin_url": f"https://www.pinterest.com/pin/{pin_id}/" if pin_id else None,
        "dominant_color": pin.get("dominant_color"),
    }


def _bootstrap(session: requests.Session, query: str, timeout: int) -> tuple[str, str]:
    """Warm the session against Pinterest's search page so we get the cookies
    (csrftoken, _pinterest_sess, _auth, _routing_id) and the live appVersion that
    the resource endpoint requires. Returns (app_version, csrf_token)."""
    warmup = session.get(
        f"https://www.pinterest.com/search/pins/?q={quote(query)}",
        timeout=timeout,
    )
    warmup.raise_for_status()
    m = re.search(r'"appVersion"\s*:\s*"([^"]+)"', warmup.text)
    app_version = m.group(1) if m else DEFAULT_APP_VERSION
    csrf = session.cookies.get("csrftoken") or ""
    return app_version, csrf


def pinterest_search(query: str, limit: int = 10, timeout: int = 20) -> list[dict[str, Any]]:
    """Search Pinterest pins for `query` and return up to `limit` normalized image results."""
    if not query.strip():
        raise ValueError("query must be non-empty")

    results: list[dict[str, Any]] = []
    bookmark: str | None = None
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT
    app_version, csrf = _bootstrap(session, query, timeout)
    headers = _resource_headers(query, app_version, csrf)

    # Pinterest paginates; fetch additional pages until we have enough usable images.
    while len(results) < limit:
        resp = session.get(
            ENDPOINT, params=_params(query, bookmark), headers=headers, timeout=timeout
        )
        resp.raise_for_status()
        try:
            payload = resp.json()
        except ValueError as e:
            raise RuntimeError(
                f"Pinterest returned non-JSON (status {resp.status_code}); "
                f"endpoint may have changed or the request was blocked."
            ) from e

        data = payload.get("resource_response", {}).get("data") or {}
        pins = data.get("results") or []
        for pin in pins:
            norm = _normalize(pin)
            if norm:
                results.append(norm)
                if len(results) >= limit:
                    break

        bookmarks = data.get("bookmark") or (
            payload.get("resource", {}).get("options", {}).get("bookmarks")
        )
        next_bookmark = (
            bookmarks[0] if isinstance(bookmarks, list) and bookmarks else bookmarks
        )
        if not next_bookmark or next_bookmark == "-end-" or next_bookmark == bookmark:
            break
        bookmark = next_bookmark

    return results[:limit]


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(s: str) -> str:
    return _SLUG_RE.sub("-", s.lower()).strip("-") or "query"


def download_images(
    results: list[dict[str, Any]], out_dir: Path, timeout: int = 20
) -> list[Path]:
    """Download each result's image_url into out_dir. File name uses pin id + url extension."""
    out_dir.mkdir(parents=True, exist_ok=True)
    saved: list[Path] = []
    for r in results:
        url = r.get("image_url")
        if not url:
            continue
        ext = os.path.splitext(urlparse(url).path)[1] or ".jpg"
        path = out_dir / f"{r.get('id') or _slugify(url)[-12:]}{ext}"
        if path.exists():
            saved.append(path)
            continue
        with requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=timeout, stream=True) as resp:
            resp.raise_for_status()
            with path.open("wb") as f:
                for chunk in resp.iter_content(chunk_size=64 * 1024):
                    if chunk:
                        f.write(chunk)
        saved.append(path)
    return saved


def main() -> int:
    parser = argparse.ArgumentParser(description="Search Pinterest for images.")
    parser.add_argument("query", help="search prompt, e.g. 'monastic typography'")
    parser.add_argument("--limit", "-n", type=int, default=10, help="max images (default 10)")
    parser.add_argument("--pretty", action="store_true", help="pretty-print JSON output")
    parser.add_argument("--urls-only", action="store_true", help="print only image URLs, one per line")
    parser.add_argument(
        "--download",
        "-d",
        action="store_true",
        help="download images into ./images/<slugified-query>/ (gitignored)",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path(__file__).parent / "images",
        help="root directory for downloads (default: ./images next to this script)",
    )
    args = parser.parse_args()

    try:
        results = pinterest_search(args.query, limit=args.limit)
        if args.download:
            sub = args.out_dir / _slugify(args.query)
            saved = download_images(results, sub)
            for r, path in zip(results, saved):
                r["local_path"] = str(path)
            print(f"Downloaded {len(saved)} image(s) to {sub}", file=sys.stderr)
    except requests.HTTPError as e:
        print(f"HTTP error: {e}", file=sys.stderr)
        return 2
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    if args.urls_only:
        for r in results:
            print(r["image_url"])
    else:
        indent = 2 if args.pretty else None
        json.dump(results, sys.stdout, indent=indent, ensure_ascii=False)
        sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
