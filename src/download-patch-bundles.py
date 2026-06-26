# Copyright (c) 2026 nvbangg (github.com/nvbangg)

import re
import shutil
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import urlopen
import json

RAW = "https://raw.githubusercontent.com/Jman-Github/ReVanced-Patch-Bundles/bundles/patch-bundles"
OUT_DIR = Path("patch-bundles")
CHANNELS = ("stable", "dev")
CONCURRENCY = 8


def download(url, retries=3):
    for attempt in range(retries):
        try:
            with urlopen(url, timeout=30) as res:
                return res.read().decode("utf8")
        except Exception as exc:
            if attempt < retries - 1:
                pass
            else:
                raise


def normalize(text):
    return text if text.endswith("\n") else text + "\n"


def get_repo(bundle_json):
    download_url = bundle_json.get("download_url", "")
    parts = download_url.split("/")
    return "/".join(parts[0:5]) if len(parts) >= 5 else ""


def is_morphe(bundle_json):
    url = bundle_json.get("download_url", "")
    return (
        isinstance(url, str)
        and url.lower().endswith(".mpp")
        and len(url.split("/")) >= 8
    )


def fetch_bundle(args):
    base, channel = args
    bundle_dir = f"{base}-patch-bundles"
    url = f"{RAW}/{bundle_dir}/{base}-{channel}-patches-bundle.json"
    try:
        text = download(url)
        bundle_json = json.loads(text)
        if not is_morphe(bundle_json):
            return None
        repo = get_repo(bundle_json)
        return (base, channel, text, repo)
    except Exception as exc:
        print(f"Skip {base}-{channel} ({exc})")
        return None


def fetch_list(args):
    base, channel = args
    bundle_dir = f"{base}-patch-bundles"
    url = f"{RAW}/{bundle_dir}/{base}-{channel}-patches-list.json"
    try:
        text = download(url)
        return (base, channel, text)
    except Exception as exc:
        print(f"Skip list {base}-{channel} ({exc})")
        return None


def main():
    try:
        bundles_text = download(f"{RAW}/bundle-sources.json")
        bundles = json.loads(bundles_text)
    except Exception as exc:
        raise SystemExit(f"Failed to fetch bundle-sources.json: {exc}")

    suffix_pattern = re.compile(r"-(stable|latest|dev)$")
    base_names = sorted({suffix_pattern.sub("", k) for k in bundles})
    all_pairs = [(base, channel) for base in base_names for channel in CHANNELS]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for path in OUT_DIR.iterdir():
        if path.name.endswith("-patch-bundles") and path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        elif path.name in (
            "bundles-stable.json",
            "bundles-dev.json",
            "bundle-sources.json",
        ):
            path.unlink(missing_ok=True)

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        bundle_results = list(pool.map(fetch_bundle, all_pairs))

    morphe_entries = [r for r in bundle_results if r is not None]

    list_pairs = [(base, channel) for base, channel, _, _ in morphe_entries]
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        list_results = list(pool.map(fetch_list, list_pairs))

    list_map = {
        (base, channel): text for base, channel, text in filter(None, list_results)
    }

    # Save files to disk
    stable_bundles = {}
    dev_bundles = {}
    saved = 0
    for base, channel, bundle_text, repo in morphe_entries:
        list_text = list_map.get((base, channel))
        if not list_text:
            continue
            
        target_dict = stable_bundles if channel == "stable" else dev_bundles
        target_dict[base] = {"repo": repo}
        
        bundle_dir = f"{base}-patch-bundles"
        out = OUT_DIR / bundle_dir
        out.mkdir(parents=True, exist_ok=True)
        (out / f"{base}-{channel}-patches-bundle.json").write_text(
            normalize(bundle_text), encoding="utf8"
        )
        (out / f"{base}-{channel}-patches-list.json").write_text(
            normalize(list_text), encoding="utf8"
        )
        saved += 1

    if stable_bundles:
        (OUT_DIR / "bundles-stable.json").write_text(
            json.dumps(stable_bundles, indent=2) + "\n", encoding="utf8"
        )
    if dev_bundles:
        (OUT_DIR / "bundles-dev.json").write_text(
            json.dumps(dev_bundles, indent=2) + "\n", encoding="utf8"
        )

    print(f"Downloaded {saved} Morphe bundles.")


if __name__ == "__main__":
    main()
