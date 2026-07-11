# Copyright (c) 2026 nvbangg (github.com/nvbangg)

import datetime
import json
import re
import urllib.parse
from pathlib import Path

ROOT = Path.cwd()
DATA_DIR = ROOT / "data"
PATCHES_DIR = DATA_DIR / "patches"
HISTORY_PATH = DATA_DIR / "history.json"
APPS_JSON_PATH = DATA_DIR / "apps.json"
SKIP_WORDS_PATH = ROOT / "src" / "skip-words.json"
WHATS_NEW_PATH = ROOT / "whats-new.md"
WHATS_NEW_JSON_PATH = DATA_DIR / "whats-new.json"


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
        package_names = set()

        if isinstance(compatible, dict):
            # Old format: dict of package names
            package_names.update(compatible.keys())
        elif isinstance(compatible, list):
            # New format: list of objects
            for item in compatible:
                if isinstance(item, dict) and (package_name := item.get("packageName")):
                    package_names.add(package_name)

        for package_name in package_names or {"universal"}:
            patches_dict.setdefault(package_name, set()).add(patch_name)

    return {
        package_name: sorted(list(patches_dict[package_name]))
        for package_name in sorted(patches_dict)
    }


def build_current_bundles():
    stable_dict, dev_dict = {}, {}
    for patch_file in sorted(PATCHES_DIR.glob("*.json"), key=lambda p: p.name.lower()):
        match = re.match(r"(.*)-(stable|dev)\.json$", patch_file.name)
        if not match:
            continue
        base, channel = match.groups()
        list_json = read_json(patch_file)
        if not list_json:
            continue
        target = stable_dict if channel == "stable" else dev_dict
        target[base] = collect_apps(list_json)

    return stable_dict, dev_dict


# Inspired by code from Paresh Maheshwari
def derive_name(package_name, skip_words):
    parts = [
        part
        for part in package_name.split(".")
        if part not in skip_words and len(part) > 1
    ]
    name = parts[-1] if parts else package_name.split(".")[-1]
    return name.replace("-", " ").replace("_", " ").title()


def format_app_name(package_name, app_metadata, skip_words):
    meta = app_metadata.get(package_name)
    if isinstance(meta, dict) and meta.get("name"):
        return meta["name"]
    if isinstance(meta, str):
        return meta
    return derive_name(package_name, skip_words)


def format_patch(patch_name):
    if any(char in patch_name for char in [":", ",", "(", ")"]):
        return f'"{patch_name}"'
    return patch_name


def stringify_trie(bundles_dict):
    bundle_strs = []
    for bundle, apps in bundles_dict.items():
        if not apps:
            bundle_strs.append(bundle)
        else:
            app_strs = []
            for app, patches in apps.items():
                if not patches:
                    app_strs.append(app)
                elif len(patches) == 1:
                    app_strs.append(f"{app}:{format_patch(patches[0])}")
                else:
                    patch_strs = [format_patch(patch_name) for patch_name in patches]
                    app_strs.append(f"{app}:({','.join(patch_strs)})")

            if len(app_strs) == 1:
                bundle_strs.append(f"{bundle}:{app_strs[0]}")
            else:
                bundle_strs.append(f"{bundle}:({','.join(app_strs)})")
    return ",".join(bundle_strs)


def make_url(bundle, app=None, patches=None):
    url = f"https://nvbangg.github.io/awesome-for-morphe/"
    query = []

    if patches:
        trie_dict = {bundle: {app: list(patches)}}
        trie_str = stringify_trie(trie_dict)
        q = urllib.parse.quote(trie_str, safe=':,"()')
        query.append(f"show={q}")
    elif app:
        query.append(f"show={bundle}:{app}")
    else:
        query.append(f"show={bundle}")

    if query:
        url += "?" + "&".join(query)
    url += "#whats-new"
    return url


def is_valid_pkg(package_name):
    return (
        "." in package_name and " " not in package_name
    ) or package_name == "universal"


def build_json_diff(old_bundles, new_bundles):
    json_diff = {}
    for key in sorted(new_bundles):
        patches_dict = new_bundles[key]
        new_package_names = {
            package_name for package_name in patches_dict if is_valid_pkg(package_name)
        }

        if key not in old_bundles:
            json_diff[key] = {
                "isNew": True,
                "apps": {
                    package_name: {
                        "isNew": True,
                        "patches": sorted(list(patches_dict.get(package_name, []))),
                    }
                    for package_name in sorted(new_package_names)
                },
            }
        else:
            old_patches_dict = old_bundles[key]
            old_package_names = {
                package_name
                for package_name in old_patches_dict
                if is_valid_pkg(package_name)
            }

            added_package_names = new_package_names - old_package_names

            has_changes = False
            apps_dict = {}
            for package_name in sorted(old_package_names & new_package_names):
                added_patches = set(patches_dict.get(package_name, [])) - set(
                    old_patches_dict.get(package_name, [])
                )
                if added_patches:
                    has_changes = True
                    apps_dict[package_name] = {
                        "isNew": False,
                        "patches": sorted(list(added_patches)),
                    }

            if added_package_names:
                has_changes = True
                for package_name in sorted(added_package_names):
                    apps_dict[package_name] = {
                        "isNew": True,
                        "patches": sorted(list(patches_dict.get(package_name, []))),
                    }

            if has_changes:
                json_diff[key] = {"isNew": False, "apps": apps_dict}
    return json_diff


def generate_markdown(json_diff, app_metadata, skip_words):
    all_changes = {}
    markdown_lines = []

    for bundle_key, bundle_data in json_diff.items():
        is_new_bundle = bundle_data.get("isNew", False)
        apps_data = bundle_data.get("apps", {})

        if is_new_bundle:
            all_changes[bundle_key] = {}
        else:
            added_package_names = [
                package_name
                for package_name, data in apps_data.items()
                if data.get("isNew", False)
            ]
            patched_package_names = [
                package_name
                for package_name, data in apps_data.items()
                if not data.get("isNew", False)
            ]

            if added_package_names:
                if bundle_key not in all_changes:
                    all_changes[bundle_key] = {}
                for package_name in added_package_names:
                    all_changes[bundle_key][package_name] = []

            if patched_package_names:
                if bundle_key not in all_changes:
                    all_changes[bundle_key] = {}
                for package_name in patched_package_names:
                    if package_name not in all_changes[bundle_key]:
                        all_changes[bundle_key][package_name] = []
                    all_changes[bundle_key][package_name].extend(
                        apps_data[package_name].get("patches", [])
                    )

        if is_new_bundle:
            url = make_url(bundle_key)
            link = f"[{bundle_key}]({url})"
            bundle_md = [f"+ 📦 {link} (✨New)"]

            for package_name in sorted(apps_data.keys()):
                app_name = format_app_name(package_name, app_metadata, skip_words)
                bundle_md.append(f"    - 📱 {app_name}")

            markdown_lines.append("\n".join(bundle_md))
        else:
            bundle_changes = {}
            for package_name, data in apps_data.items():
                if data.get("isNew", False):
                    bundle_changes[package_name] = []
                else:
                    bundle_changes[package_name] = sorted(data.get("patches", []))

            trie_dict = {bundle_key: bundle_changes}
            trie_str = stringify_trie(trie_dict)
            q = urllib.parse.quote(trie_str, safe=':,"')
            url = f"https://nvbangg.github.io/awesome-for-morphe/?show={q}#whats-new"

            link = f"[{bundle_key}]({url})"
            bundle_md = [f"- 📦 {link}"]

            for package_name in sorted(apps_data.keys()):
                app_data = apps_data[package_name]
                app_name = format_app_name(package_name, app_metadata, skip_words)

                if app_data.get("isNew", False):
                    bundle_md.append(f"    + 📱 {app_name} (✨New)")
                else:
                    bundle_md.append(f"    - 📱 {app_name}")
                    for p in sorted(app_data.get("patches", [])):
                        bundle_md.append(f"        + 🧩 `{p}` (✨New)")

            markdown_lines.append("\n".join(bundle_md))

    sections = []
    if all_changes:
        full_url = "https://nvbangg.github.io/awesome-for-morphe/#whats-new"
        sections.append(f"✨ [_View full changelog_]({full_url})")

    if markdown_lines:
        sections.append("\n".join(markdown_lines))

    if not sections:
        return ""

    sections.insert(
        0, "📢 _Telegram: [@awesome_for_morphe](https://t.me/awesome_for_morphe)_"
    )
    return "\n\n".join(sections)


def main():
    if not any(PATCHES_DIR.glob("*.json")):
        raise SystemExit("No patches found — run download.py first")

    old_history = read_json(HISTORY_PATH, {}) or {}
    app_metadata = read_json(APPS_JSON_PATH, {})
    skip_words = read_json(SKIP_WORDS_PATH, []) or []
    whats_new_data = read_json(WHATS_NEW_JSON_PATH, []) or []

    # Shift time back by 12 hours to handle GitHub Actions delays
    now = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=12)
    today_str = now.strftime(f"%B {now.day}, %Y")

    _, new_dev = build_current_bundles()
    json_diff = build_json_diff(old_history, new_dev)

    if not json_diff:
        print("No changes found.")
        return

    # Create markdown
    markdown_str = generate_markdown(json_diff, app_metadata, skip_words)
    if markdown_str:
        WHATS_NEW_PATH.write_text(markdown_str + "\n", encoding="utf8")
        print("What's New MD created.")
    else:
        print("No changes to write to MD.")

    # Insert today's JSON entry
    whats_new_data.insert(
        0, {"date": today_str, "bundles": json_diff}
    )

    whats_new_data = whats_new_data[:15]
    write_json(WHATS_NEW_JSON_PATH, whats_new_data)
    print("Updated whats-new.json.")

    write_json(HISTORY_PATH, new_dev)
    print("History updated for a new baseline.")


if __name__ == "__main__":
    main()
