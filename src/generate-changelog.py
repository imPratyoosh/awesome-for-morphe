# Copyright (c) 2026 nvbangg (github.com/nvbangg)

import json
from pathlib import Path

ROOT = Path.cwd()
DATA_DIR = ROOT / "data"
BUNDLES_DIR = ROOT / "patch-bundles"
STABLE_OUT = DATA_DIR / "history-stable.json"
DEV_OUT = DATA_DIR / "history-dev.json"
APP_NAMES_PATH = DATA_DIR / "app-names.json"
SKIP_WORDS_PATH = DATA_DIR / "skip-words.json"
CHANGELOG_PATH = ROOT / "changelog.md"
CHANGELOG_PRE_PATH = ROOT / "changelog-pre-release.md"


def read_json(path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf8")


def collect_apps(list_json):
    patches_dict = {}
    for patch in list_json.get("patches") or []:
        patch_name = patch.get("name")
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

        for pkg in pkgs or {"universal"}:
            patches_dict.setdefault(pkg, {})[patch_name] = patch.get("description", "")

    return {
        pkg: {k: patches_dict[pkg][k] for k in sorted(patches_dict[pkg])}
        for pkg in sorted(patches_dict)
    }


def build_current_bundles():
    stable_dict, dev_dict = {}, {}
    for bundle_dir in sorted(BUNDLES_DIR.iterdir()):
        if not bundle_dir.is_dir() or not bundle_dir.name.endswith("-patch-bundles"):
            continue
        base = bundle_dir.name.replace("-patch-bundles", "")

        for channel in ("stable", "dev"):
            list_json = read_json(bundle_dir / f"{base}-{channel}-patches-list.json")
            if not list_json:
                continue
            target = stable_dict if channel == "stable" else dev_dict
            target[base] = collect_apps(list_json)

    return stable_dict, dev_dict


# Inspired by code from Paresh Maheshwari
def derive_name(pkg, skip_words):
    parts = [p for p in pkg.split(".") if p not in skip_words and len(p) > 1]
    name = parts[-1] if parts else pkg.split(".")[-1]
    return name.replace("-", " ").replace("_", " ").title()


def format_app_name(pkg, app_names, skip_words):
    return app_names.get(pkg) or derive_name(pkg, skip_words)


def make_url(bundle, app=None, is_dev=False):
    url = f"https://nvbangg.github.io/awesome-for-morphe/?bundle={bundle}"
    if app:
        url += f"&app={app}"
    if is_dev:
        url += "&channel=dev"
    return url


def is_valid_pkg(pkg):
    return ("." in pkg and " " not in pkg) or pkg == "universal"


def build_notes(label, old_bundles, new_bundles, app_names, skip_words):
    new_bundles_notes, new_apps_groups, new_patches_groups = [], [], []
    is_dev = label == "pre-release"

    for key in sorted(new_bundles):
        patches_dict = new_bundles[key]
        new_pkgs = {pkg for pkg in patches_dict if is_valid_pkg(pkg)}

        if key not in old_bundles:
            # 1. New bundle
            link = f"[{key}]({make_url(key, is_dev=is_dev)})"
            bundle_lines = [f"- {link}"] + [
                f"  - {format_app_name(pkg, app_names, skip_words)}"
                for pkg in sorted(new_pkgs)
            ]
            new_bundles_notes.append("\n".join(bundle_lines))
        else:
            old_patches_dict = old_bundles[key]
            old_pkgs = {pkg for pkg in old_patches_dict if is_valid_pkg(pkg)}

            # 2. New apps in an existing bundle
            if added_pkgs := new_pkgs - old_pkgs:
                app_lines = [f"- {key}"] + [
                    f"  - [{format_app_name(pkg, app_names, skip_words)}]({make_url(key, pkg, is_dev)})"
                    for pkg in sorted(added_pkgs)
                ]
                new_apps_groups.append("\n".join(app_lines))

            # 3. New patches in an existing app
            for pkg in sorted(old_pkgs & new_pkgs):
                old_pkg_patches = old_patches_dict.get(pkg, {})
                new_pkg_patches = patches_dict.get(pkg, {})

                if isinstance(old_pkg_patches, list):
                    old_pkg_patches = {p: "" for p in old_pkg_patches}
                if isinstance(new_pkg_patches, list):
                    new_pkg_patches = {p: "" for p in new_pkg_patches}

                added_patches = set(new_pkg_patches) - set(old_pkg_patches)
                if not added_patches:
                    continue

                name = format_app_name(pkg, app_names, skip_words)
                patch_lines = [f"- [{name}]({make_url(key, pkg, is_dev)}) ({key})"] + [
                    f"    + `{p}`: {new_pkg_patches[p]}"
                    if new_pkg_patches.get(p)
                    else f"    + `{p}`"
                    for p in sorted(added_patches)
                ]
                new_patches_groups.append("\n".join(patch_lines))

    sections = []
    if new_bundles_notes:
        sections.append("## 🧩 New bundles\n" + "\n".join(new_bundles_notes))
    if new_apps_groups:
        sections.append("## 📱 New apps\n" + "\n".join(new_apps_groups))
    if new_patches_groups:
        sections.append("## 🩹 New patches\n" + "\n".join(new_patches_groups))

    if not sections:
        return ""

    sections.insert(
        0, "📢 _Telegram: [@awesome_for_morphe](https://t.me/awesome_for_morphe)_"
    )
    return "\n\n".join(sections)


def main():
    if not any(BUNDLES_DIR.glob("*-patch-bundles")):
        raise SystemExit("No patch bundles found — run download-patch-bundles.py first")

    old_stable = read_json(STABLE_OUT, {}) or {}
    old_dev = read_json(DEV_OUT, {}) or {}
    app_names = read_json(APP_NAMES_PATH, {}) or {}
    skip_words = set(read_json(SKIP_WORDS_PATH, []) or [])

    new_stable, new_dev = build_current_bundles()
    write_json(STABLE_OUT, new_stable)
    write_json(DEV_OUT, new_dev)

    if not old_stable:
        print("Initialized bundles.")
        return

    # Stable changelog: new vs old
    stable_notes = build_notes("stable", old_stable, new_stable, app_names, skip_words)
    if stable_notes:
        CHANGELOG_PATH.write_text(stable_notes + "\n", encoding="utf8")
        print("Stable changelog created.")

    # Pre-release changelog: new_dev vs (new_stable merged with old_dev)
    pre_baseline = {}
    for key in set(new_stable) | set(old_dev):
        stable_patches = new_stable.get(key, {})
        prev_patches = old_dev.get(key, {})
        merged_patches = {}

        for pkg in sorted(set(stable_patches) | set(prev_patches)):
            s_val = stable_patches.get(pkg, {})
            p_val = prev_patches.get(pkg, {})

            if isinstance(s_val, list):
                s_val = {p: "" for p in s_val}
            if isinstance(p_val, list):
                p_val = {p: "" for p in p_val}

            merged = {
                k: s_val.get(k) or p_val.get(k) or "" for k in set(s_val) | set(p_val)
            }
            merged_patches[pkg] = {k: merged[k] for k in sorted(merged)}

        pre_baseline[key] = merged_patches

    pre_notes = build_notes("pre-release", pre_baseline, new_dev, app_names, skip_words)
    if pre_notes:
        CHANGELOG_PRE_PATH.write_text(pre_notes + "\n", encoding="utf8")
        print("Pre-release changelog created.")

    if not stable_notes and not pre_notes:
        print("No changes.")


if __name__ == "__main__":
    main()
