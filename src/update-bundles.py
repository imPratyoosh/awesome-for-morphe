# Copyright (c) 2026 nvbangg (github.com/nvbangg)

import json
import os
from pathlib import Path

ROOT = Path.cwd()
DATA_DIR = ROOT / "data"
BUNDLES_DIR = DATA_DIR / "patch-bundles"
APP_NAMES_PATH = DATA_DIR / "app-names.json"


def read_json(path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf8")


def get_repo(bundle_json):
    parts = bundle_json.get("download_url", "").split("/")
    return "/".join(parts[:5]) if len(parts) >= 5 else ""


def collect_discovered_names(list_json):
    all_pkgs, discovered_names = set(), {}
    for patch in list_json.get("patches") or []:
        compatible = patch.get("compatiblePackages")
        pkgs = set()

        if isinstance(compatible, dict):
            # Old format: dict of package names
            pkgs.update(compatible.keys())
        elif isinstance(compatible, list):
            # New format: list of objects
            for e in compatible:
                if isinstance(e, dict) and (pkg := e.get("packageName")):
                    pkgs.add(pkg)
                    if name := e.get("name"):
                        discovered_names.setdefault(pkg, name)

        all_pkgs.update(pkgs or {"universal"})

    return all_pkgs, discovered_names


def main():
    if not BUNDLES_DIR.exists():
        print("No patch bundles directory found.")
        return

    app_names = read_json(APP_NAMES_PATH, {}) or {}
    stable_bundles = {}
    dev_bundles = {}

    seen_pkgs = set()
    all_pkgs = set()
    added_names = 0
    scanned_lists = 0

    # Scan directories
    for bundle_dir in sorted(BUNDLES_DIR.iterdir()):
        if not bundle_dir.is_dir() or not bundle_dir.name.endswith("-patch-bundles"):
            continue
        base = bundle_dir.name.replace("-patch-bundles", "")

        for channel in ("stable", "dev"):
            bundle_path = bundle_dir / f"{base}-{channel}-patches-bundle.json"
            list_path = bundle_dir / f"{base}-{channel}-patches-list.json"

            if not bundle_path.exists() or not list_path.exists():
                continue

            bundle_json = read_json(bundle_path)
            list_json = read_json(list_path)
            if not bundle_json or not list_json:
                continue

            # 1. Add to bundles lists
            repo = get_repo(bundle_json)
            target_bundles = stable_bundles if channel == "stable" else dev_bundles
            target_bundles[base] = {"repo": repo}

            # 2. Collect app names
            scanned_lists += 1
            pkgs, discovered = collect_discovered_names(list_json)
            all_pkgs.update(pkgs)

            for pkg, name in discovered.items():
                if pkg not in seen_pkgs:
                    seen_pkgs.add(pkg)
                    if app_names.get(pkg) != name:
                        app_names[pkg] = name
                        added_names += 1

    # Write bundles
    write_json(DATA_DIR / "bundles-stable.json", stable_bundles)
    write_json(DATA_DIR / "bundles-dev.json", dev_bundles)
    print(f"Generated bundles-stable.json with {len(stable_bundles)} bundles.")
    print(f"Generated bundles-dev.json with {len(dev_bundles)} bundles.")

    # Write app names
    if added_names:
        write_json(APP_NAMES_PATH, app_names)
        print(f"Auto-added/updated {added_names} app name(s) to app-names.json.")

    print(f"Scanned {scanned_lists} list files.")

    missing = sorted(
        pkg
        for pkg in all_pkgs
        if pkg not in app_names and " " not in pkg and "." in pkg
    )
    if missing:
        print("\n[WARNING] Missing app names for packages:")
        print(json.dumps(missing, indent=2))
        if "GITHUB_ACTIONS" in os.environ:
            print(f"::warning::Missing app names for packages: {', '.join(missing)}")
    else:
        print("\nNo missing app names. Everything is up to date!")


if __name__ == "__main__":
    main()
