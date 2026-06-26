# Copyright (c) 2026 nvbangg (github.com/nvbangg)

import json
import os
from pathlib import Path

ROOT = Path.cwd()
DATA_DIR = ROOT / "data"
BUNDLES_DIR = ROOT / "patch-bundles"


def read_json(path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


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
    if not BUNDLES_DIR.exists() or not any(BUNDLES_DIR.glob("*-patch-bundles")):
        print("No patch bundles found.")
        return

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    names_path = DATA_DIR / "app-names.json"
    app_names = read_json(names_path, {}) or {}

    seen_pkgs, all_pkgs = set(), set()
    added = processed = 0

    for bundle_dir in sorted(BUNDLES_DIR.iterdir()):
        if not bundle_dir.is_dir() or not bundle_dir.name.endswith("-patch-bundles"):
            continue
        base = bundle_dir.name.replace("-patch-bundles", "")

        for channel in ("stable", "dev"):
            list_json = read_json(bundle_dir / f"{base}-{channel}-patches-list.json")
            if not list_json:
                continue
            processed += 1

            pkgs, discovered = collect_discovered_names(list_json)
            all_pkgs.update(pkgs)

            for pkg, name in discovered.items():
                if pkg not in seen_pkgs:
                    seen_pkgs.add(pkg)
                    if app_names.get(pkg) != name:
                        app_names[pkg] = name
                        added += 1

    if added:
        names_path.write_text(
            json.dumps(app_names, indent=2, ensure_ascii=False) + "\n", encoding="utf8"
        )
        print(f"Auto-added/updated {added} app name(s) to app-names.json.")

    print(f"Scanned {processed} list files.")

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
