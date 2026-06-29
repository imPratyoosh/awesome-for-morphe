# Copyright (c) 2026 nvbangg (github.com/nvbangg)

import json
import re
import shutil
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import urlopen

RAW = "https://raw.githubusercontent.com/Jman-Github/ReVanced-Patch-Bundles/bundles/patch-bundles"
OUT_DIR = Path("data/patch-bundles")
CHANNELS = ("stable", "dev")
CONCURRENCY = 8


def download(url, retries=3):
    for attempt in range(retries):
        try:
            with urlopen(url, timeout=30) as res:
                return res.read().decode("utf8")
        except Exception:
            if attempt == retries - 1:
                raise


def normalize(text):
    return text if text.endswith("\n") else text + "\n"





def is_morphe(bundle_json):
    url = bundle_json.get("download_url", "")
    return (
        isinstance(url, str)
        and url.lower().endswith(".mpp")
        and len(url.split("/")) >= 8
    )


def fetch_bundle(args):
    base, channel = args
    url = f"{RAW}/{base}-patch-bundles/{base}-{channel}-patches-bundle.json"
    try:
        text = download(url)
        bundle_json = json.loads(text)
        if not is_morphe(bundle_json):
            return None
        return (base, channel, text)
    except Exception as exc:
        print(f"Skip {base}-{channel} ({exc})")
        return None


def fetch_list(args):
    base, channel = args
    url = f"{RAW}/{base}-patch-bundles/{base}-{channel}-patches-list.json"
    try:
        return (base, channel, download(url))
    except Exception as exc:
        print(f"Skip list {base}-{channel} ({exc})")
        return None


def main():
    try:
        bundles = json.loads(download(f"{RAW}/bundle-sources.json"))
    except Exception as exc:
        raise SystemExit(f"Failed to fetch bundle-sources.json: {exc}")

    suffix_pattern = re.compile(r"-(stable|latest|dev)$")
    base_names = sorted({suffix_pattern.sub("", k) for k in bundles})
    all_pairs = [(base, ch) for base in base_names for ch in CHANNELS]

    # Clear existing output
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for path in OUT_DIR.iterdir():
        if path.is_dir() and path.name.endswith("-patch-bundles"):
            shutil.rmtree(path, ignore_errors=True)

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        morphe_entries = [r for r in pool.map(fetch_bundle, all_pairs) if r is not None]

    list_pairs = [(base, ch) for base, ch, _ in morphe_entries]
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        list_map = {
            (base, ch): text
            for base, ch, text in filter(None, pool.map(fetch_list, list_pairs))
        }

    # Save files to disk
    saved = 0
    for base, channel, bundle_text in morphe_entries:
        list_text = list_map.get((base, channel))
        if not list_text:
            continue

        out = OUT_DIR / f"{base}-patch-bundles"
        out.mkdir(parents=True, exist_ok=True)
        (out / f"{base}-{channel}-patches-bundle.json").write_text(
            normalize(bundle_text), encoding="utf8"
        )
        (out / f"{base}-{channel}-patches-list.json").write_text(
            normalize(list_text), encoding="utf8"
        )
        saved += 1

    print(f"Downloaded {saved} Morphe bundles.")


if __name__ == "__main__":
    main()
