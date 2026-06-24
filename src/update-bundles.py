# Copyright (c) 2026 nvbangg (github.com/nvbangg)

import json
from pathlib import Path

ROOT = Path.cwd()
DATA_DIR = ROOT / "data"
BUNDLES_DIR = ROOT / "patch-bundles"


def read_json(path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def collect_apps(list_json):
    patches_dict = {}
    discovered_names = {}
    for patch in list_json.get("patches") or []:
        patch_name = patch.get("name")
        patch_desc = patch.get("description", "")
        if not patch_name:
            continue

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

        for pkg in pkgs:
            patches_dict.setdefault(pkg, {})[patch_name] = patch_desc

    sorted_patches = {}
    for pkg in sorted(patches_dict.keys()):
        pkg_patches = patches_dict[pkg]
        sorted_patches[pkg] = {k: pkg_patches[k] for k in sorted(pkg_patches.keys())}

    return sorted_patches, discovered_names


def get_repo(bundle_json):
    download_url = bundle_json.get("download_url", "")
    parts = download_url.split("/")
    return "/".join(parts[0:5]) if len(parts) >= 5 else ""


def main():
    if not BUNDLES_DIR.exists():
        print("patch-bundles/ directory not found.")
        return

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    names_path = DATA_DIR / "app-names.json"
    app_names = read_json(names_path, {}) or {}

    stable_dict = {}
    dev_dict = {}
    seen_pkgs = set()
    all_pkgs = set()
    added = 0
    processed = 0

    # Scan for directories like <base>-patch-bundles
    for bundle_dir in sorted(BUNDLES_DIR.iterdir()):
        if not bundle_dir.is_dir() or not bundle_dir.name.endswith("-patch-bundles"):
            continue

        base = bundle_dir.name.replace("-patch-bundles", "")

        for channel in ("stable", "dev"):
            bundle_path = bundle_dir / f"{base}-{channel}-patches-bundle.json"
            list_path = bundle_dir / f"{base}-{channel}-patches-list.json"

            bundle_json = read_json(bundle_path)
            list_json = read_json(list_path)

            if not bundle_json or not list_json:
                continue

            repo = get_repo(bundle_json)
            patches, discovered = collect_apps(list_json)

            target_dict = stable_dict if channel == "stable" else dev_dict
            target_dict[base] = {"repo": repo, "patches": patches}
            processed += 1

            for pkg, name in discovered.items():
                if pkg not in seen_pkgs:
                    seen_pkgs.add(pkg)
                    if app_names.get(pkg) != name:
                        app_names[pkg] = name
                        added += 1

            all_pkgs.update(patches.keys())

    if stable_dict:
        (BUNDLES_DIR / "bundles-stable.json").write_text(
            json.dumps(stable_dict, indent=2) + "\n", encoding="utf8"
        )
    if dev_dict:
        (BUNDLES_DIR / "bundles-dev.json").write_text(
            json.dumps(dev_dict, indent=2) + "\n", encoding="utf8"
        )

    if added:
        names_path.write_text(
            json.dumps(app_names, indent=2, ensure_ascii=False) + "\n", encoding="utf8"
        )
        print(f"Auto-added/updated {added} app name(s) to app-names.json.")

    print(f"Updated metadata for {processed} bundle files.")

    # Check missing app names
    missing = sorted(
        pkg
        for pkg in all_pkgs
        if pkg not in app_names and " " not in pkg and "." in pkg
    )
    if missing:
        print("\n[WARNING] Missing app names for packages:")
        print(json.dumps(missing, indent=2))
    else:
        print("\nNo missing app names. Everything is up to date!")


if __name__ == "__main__":
    main()
