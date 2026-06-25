# Copyright (c) 2026 nvbangg (github.com/nvbangg)

import json
from pathlib import Path

ROOT = Path.cwd()
SRC_DIR = ROOT / "src"
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
    except FileNotFoundError:
        return default


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf8")


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


def build_notes(label, old_bundles, new_bundles, app_names, skip_words):
    new_bundles_notes, new_apps_groups, new_patches_groups = [], [], []
    is_dev = label == "pre-release"

    for key in sorted(new_bundles.keys()):
        patches_dict = new_bundles.get(key, {}).get("patches", {})
        new_pkgs = {pkg for pkg in patches_dict.keys() if " " not in pkg and "." in pkg}

        if key not in old_bundles:
            # 1. New Bundle
            link = f"[{key}]({make_url(key, is_dev=is_dev)})"
            bundle_lines = [f"- {link}"] + [
                f"  - {format_app_name(pkg, app_names, skip_words)}"
                for pkg in sorted(new_pkgs)
            ]
            new_bundles_notes.append("\n".join(bundle_lines))
        else:
            old_patches_dict = old_bundles.get(key, {}).get("patches", {})
            old_pkgs = {
                pkg for pkg in old_patches_dict.keys() if " " not in pkg and "." in pkg
            }

            # 2. New Apps (in an existing bundle)
            if added_pkgs := new_pkgs - old_pkgs:
                app_lines = [f"- {key}"]
                for pkg in sorted(added_pkgs):
                    name = format_app_name(pkg, app_names, skip_words)
                    app_lines.append(f"  - [{name}]({make_url(key, pkg, is_dev)})")
                new_apps_groups.append("\n".join(app_lines))

            # 3. New Patches (in an existing app)
            for pkg in sorted(old_pkgs & new_pkgs):
                old_pkg_patches = old_patches_dict.get(pkg, {})
                new_pkg_patches = patches_dict.get(pkg, {})

                if isinstance(old_pkg_patches, list):
                    old_pkg_patches = {p: "" for p in old_pkg_patches}
                if isinstance(new_pkg_patches, list):
                    new_pkg_patches = {p: "" for p in new_pkg_patches}

                added_patches = set(new_pkg_patches.keys()) - set(
                    old_pkg_patches.keys()
                )
                if added_patches:
                    name = format_app_name(pkg, app_names, skip_words)
                    patch_lines = [f"- [{name}]({make_url(key, pkg, is_dev)}) ({key})"]
                    for p in sorted(added_patches):
                        desc = new_pkg_patches.get(p, "")
                        if desc:
                            patch_lines.append(f"  + `{p}`: {desc}")
                        else:
                            patch_lines.append(f"  + `{p}`")
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
    missing = [
        f
        for f in ("bundles-stable.json", "bundles-dev.json")
        if not (BUNDLES_DIR / f).exists()
    ]
    if missing:
        raise SystemExit(
            f"{', '.join(missing)} not found — run update-bundles.py first"
        )

    old_stable = read_json(STABLE_OUT, {}) or {}
    old_dev = read_json(DEV_OUT, {}) or {}
    app_names = read_json(APP_NAMES_PATH, {}) or {}
    skip_words_list = read_json(SKIP_WORDS_PATH, []) or []
    skip_words = set(skip_words_list)

    new_stable = read_json(BUNDLES_DIR / "bundles-stable.json", {}) or {}
    new_dev = read_json(BUNDLES_DIR / "bundles-dev.json", {}) or {}

    write_json(STABLE_OUT, new_stable)
    write_json(DEV_OUT, new_dev)

    is_first_run = not old_stable
    if is_first_run:
        print("Initialized bundles.")
        return

    # Stable changelog: new_stable vs old_stable
    stable_notes = build_notes("stable", old_stable, new_stable, app_names, skip_words)
    if stable_notes:
        CHANGELOG_PATH.write_text(stable_notes + "\n", encoding="utf8")
        print("Stable changelog created.")

    # Pre-release changelog: new_dev vs (new_stable + old_dev)
    pre_baseline = {}
    for key in set(new_stable) | set(old_dev):
        stable_patches = new_stable.get(key, {}).get("patches", {})
        prev_patches = old_dev.get(key, {}).get("patches", {})

        merged_patches = {}
        for pkg in sorted(set(stable_patches) | set(prev_patches)):
            s_val = stable_patches.get(pkg, {})
            p_val = prev_patches.get(pkg, {})

            if isinstance(s_val, list):
                s_val = {p: "" for p in s_val}
            if isinstance(p_val, list):
                p_val = {p: "" for p in p_val}

            merged = {}
            for k in set(s_val.keys()) | set(p_val.keys()):
                merged[k] = s_val.get(k) or p_val.get(k) or ""
            merged_patches[pkg] = {k: merged[k] for k in sorted(merged.keys())}

        pre_baseline[key] = {"patches": merged_patches}

    pre_notes = build_notes("pre-release", pre_baseline, new_dev, app_names, skip_words)
    if pre_notes:
        CHANGELOG_PRE_PATH.write_text(pre_notes + "\n", encoding="utf8")
        print("Pre-release changelog created.")

    if not stable_notes and not pre_notes:
        print("No changes.")


if __name__ == "__main__":
    main()
