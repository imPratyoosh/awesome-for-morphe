# Copyright (c) 2026 nvbangg (github.com/nvbangg)

import json
import re
import shutil
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from utils import fetch

RAW = "https://raw.githubusercontent.com/Jman-Github/ReVanced-Patch-Bundles/bundles/patch-bundles"
BUNDLES_DIR = Path("data/bundles")
PATCHES_DIR = Path("data/patches")
CHANNELS = ("stable", "dev")
CONCURRENCY = 8


def normalize(text):
    return text if text.endswith("\n") else text + "\n"


def is_morphe(bundle_json):
    url = bundle_json.get("download_url", "")
    return isinstance(url, str) and url.lower().endswith(".mpp") and len(url.split("/")) >= 8


def fetch_bundle(args):
    base, channel = args
    url = f"{RAW}/{base}-patch-bundles/{base}-{channel}-patches-bundle.json"
    try:
        text = fetch(url)
        bundle_json = json.loads(text)
        if not is_morphe(bundle_json):
            return None
        return (base, channel, text)
    except Exception as e:
        print(f"Skip {base}-{channel} ({e})")
        return None


def fetch_list(args):
    base, channel = args
    url = f"{RAW}/{base}-patch-bundles/{base}-{channel}-patches-list.json"
    try:
        return (base, channel, fetch(url))
    except Exception as e:
        print(f"Skip list {base}-{channel} ({e})")
        return None


def download_bundles():
    try:
        bundles = fetch(f"{RAW}/bundle-sources.json", as_json=True)
    except Exception as e:
        raise SystemExit(f"Failed to fetch bundle-sources.json: {e}")

    suffix_pattern = re.compile(r"-(stable|latest|dev)$")
    base_names = sorted({suffix_pattern.sub("", k) for k in bundles})
    all_pairs = [(base, channel) for base in base_names for channel in CHANNELS]

    if BUNDLES_DIR.exists():
        shutil.rmtree(BUNDLES_DIR, ignore_errors=True)
    BUNDLES_DIR.mkdir(parents=True, exist_ok=True)

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        morphe_entries = [r for r in pool.map(fetch_bundle, all_pairs) if r is not None]

    saved = 0
    for base, channel, bundle_text in morphe_entries:
        (BUNDLES_DIR / f"{base}-{channel}.json").write_text(normalize(bundle_text), encoding="utf8")
        saved += 1
    print(f"Downloaded {saved} Morphe bundles.")


def download_patches():
    if not BUNDLES_DIR.exists():
        raise SystemExit("BUNDLES_DIR not found. Run with --bundles first.")

    list_pairs = []
    for path in BUNDLES_DIR.glob("*.json"):
        match = re.match(r"(.*)-(stable|dev)\.json$", path.name)
        if match:
            list_pairs.append((match.group(1), match.group(2)))

    if PATCHES_DIR.exists():
        shutil.rmtree(PATCHES_DIR, ignore_errors=True)
    PATCHES_DIR.mkdir(parents=True, exist_ok=True)

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        list_map = {(base, channel): text for base, channel, text in filter(None, pool.map(fetch_list, list_pairs))}

    saved = 0
    for (base, channel), list_text in list_map.items():
        (PATCHES_DIR / f"{base}-{channel}.json").write_text(normalize(list_text), encoding="utf8")
        saved += 1
    print(f"Downloaded {saved} Morphe patches lists.")


def main():
    if "--bundles" in sys.argv:
        download_bundles()
    else:
        download_patches()


if __name__ == "__main__":
    main()
