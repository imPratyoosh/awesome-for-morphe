# Copyright (c) 2026 nvbangg (github.com/nvbangg)

import argparse
import concurrent.futures
import json
import os
import urllib.request
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from utils import load_json, save_json

try:
    from google_play_scraper import app as gplay_app
except ImportError:
    gplay_app = None

ROOT = Path.cwd()
DATA_DIR = ROOT / "data"
BUNDLES_DIR = DATA_DIR / "bundles"
PATCHES_DIR = DATA_DIR / "patches"
SITE_DIR = ROOT / "docs" / "patches"
BUNDLES_JSON_PATH = ROOT / "docs" / "bundles.json"
APPS_JSON_PATH = ROOT / "docs" / "apps.json"
OFFICIAL_BUNDLES_PATH = DATA_DIR / "snapshots" / "official-bundles.json"
CONCURRENCY = 8
GITHUB_CONCURRENCY = 3

compatibilities_list = []
compatibilities_map = {}


def get_repo_info(bundle_json: Dict[str, Any]) -> Tuple[str, str, str]:
    url = bundle_json.get("download_url", "")
    source = "github"
    if "gitlab.com" in url:
        source = "gitlab"

    parts = url.split(f"{source}.com/")
    if len(parts) > 1:
        repo_path = parts[1].split("/")
        if len(repo_path) >= 2:
            return (
                source,
                f"{repo_path[0]}/{repo_path[1]}",
                f"https://{source}.com/{repo_path[0]}/{repo_path[1]}",
            )
    return source, "", ""


def fetch_avatar_url(repo_url: str) -> Optional[str]:
    if not repo_url:
        return ""

    if "gitlab.com/" in repo_url:
        parts = repo_url.split("gitlab.com/")
        if len(parts) > 1:
            username = parts[1].split("/")[0]
            if username:
                try:
                    data = fetch(f"https://gitlab.com/api/v4/users?username={username}", timeout=10, as_json=True)
                    if data and len(data) > 0:
                        avatar = data[0].get("avatar_url", "")
                        if avatar:
                            if "secure.gravatar.com" in avatar:
                                if "s=80" in avatar:
                                    avatar = avatar.replace("s=80", "s=128")
                                elif "s=" not in avatar:
                                    avatar += ("&" if "?" in avatar else "?") + "s=128"
                            elif "gitlab.com/uploads/" in avatar:
                                if "width=" not in avatar:
                                    avatar += ("&" if "?" in avatar else "?") + "width=128"
                            return avatar
                except Exception as e:
                    print(f"Failed to fetch gitlab avatar for {username}: {e}")
                    return None

    if "github.com/" in repo_url:
        parts = repo_url.split("github.com/")
        if len(parts) > 1:
            username = parts[1].split("/")[0]
            if username:
                return f"https://avatars.githubusercontent.com/{username}?s=128"

    return None


def fetch_repo_stars(repo_url: str) -> Optional[int]:
    if not repo_url:
        return 0

    if "github.com" in repo_url:
        parts = repo_url.split("github.com/")
        if len(parts) > 1:
            repo_path = parts[1].split("/")
            if len(repo_path) >= 2:
                owner, name = repo_path[0], repo_path[1]
                api_url = f"https://api.github.com/repos/{owner}/{name}"

                def fetch_stars(use_token: bool = True) -> Optional[int]:
                    headers = {"User-Agent": "Awesome-For-Morphe"}
                    if use_token and os.environ.get("GITHUB_TOKEN"):
                        headers["Authorization"] = f"Bearer {os.environ['GITHUB_TOKEN']}"
                    return fetch(api_url, headers=headers, timeout=10, as_json=True).get("stargazers_count", 0)

                try:
                    time.sleep(0.5)
                    return fetch_stars(use_token=True)
                except urllib.error.HTTPError as error:
                    if error.code in (401, 403, 429):
                        try:
                            time.sleep(1)
                            return fetch_stars(use_token=False)
                        except Exception as inner_exception:
                            print(f"Error fetching stars (no token) for {repo_url}: {inner_exception}")
                            return None
                    else:
                        print(f"Error fetching stars for {repo_url}: {error}")
                        return None
                except Exception as e:
                    print(f"Error fetching stars for {repo_url}: {e}")
                    return None

    elif "gitlab.com" in repo_url:
        parts = repo_url.split("gitlab.com/")
        if len(parts) > 1:
            repo_path = parts[1].strip("/")
            encoded_path = urllib.parse.quote(repo_path, safe="")
            api_url = f"https://gitlab.com/api/v4/projects/{encoded_path}"
            try:
                time.sleep(0.5)
                return fetch(api_url, timeout=10, as_json=True).get("star_count", 0)
            except Exception as e:
                print(f"Error fetching GitLab stars for {repo_url}: {e}")
                return None

    return None


def fetch_app_details(package_name: str) -> Tuple[Optional[str], Optional[str]]:
    if not gplay_app:
        print("Warning: google-play-scraper is not installed. Run: pip install google-play-scraper")
        return None, None
    try:
        result = gplay_app(package_name)
        icon_url = None
        app_name = None
        if result:
            if "icon" in result:
                icon_url = result["icon"]
                if icon_url:
                    if "=" in icon_url:
                        icon_url = icon_url.split("=")[0]
                    icon_url += "=s64"
            if "title" in result:
                app_name = result["title"]
        return icon_url, app_name
    except Exception as e:
        print(f"Failed to fetch app details for {package_name}: {e}")
    return None, None


def get_compat_key(compat_data: list) -> int:

    compat_json = json.dumps(compat_data, sort_keys=True)
    if compat_json in compatibilities_map:
        return compatibilities_map[compat_json]
    else:
        idx = len(compatibilities_list)
        compatibilities_list.append(compat_data)
        compatibilities_map[compat_json] = idx
        return idx


def strip_patch(patch: Dict[str, Any], discovered_names: Dict[str, str]) -> Optional[Dict[str, Any]]:
    out: Dict[str, Any] = {}
    if "name" in patch:
        out["name"] = patch["name"]
    if patch.get("description"):
        out["description"] = patch["description"]

    if patch.get("default", True) is False:
        out["default"] = False

    if "options" in patch:
        options_list = []
        for option_item in patch["options"]:
            option_obj = {}
            if "key" in option_item:
                option_obj["key"] = option_item["key"]
            if option_item.get("title"):
                option_obj["title"] = option_item["title"]
            if option_item.get("description"):
                option_obj["description"] = option_item["description"]
            if option_obj:
                options_list.append(option_obj)
        if options_list:
            out["options"] = options_list

    compatible_packages = patch.get("compatiblePackages")
    out_compat = []
    has_real_app = False

    if isinstance(compatible_packages, dict):
        for package_name, versions in compatible_packages.items():
            if package_name == "universal":
                continue
            has_real_app = True
            targets = []
            if versions:
                for version_item in versions:
                    if isinstance(version_item, str):
                        targets.append({"version": version_item})
                    elif isinstance(version_item, dict) and "version" in version_item:
                        targets.append({"version": version_item["version"]})
            out_compat.append({"packageName": package_name, "targets": targets})
    elif isinstance(compatible_packages, list):
        for entry in compatible_packages:
            if not isinstance(entry, dict):
                continue
            package_name = entry.get("packageName")
            if package_name == "universal" or not package_name:
                continue
            if name := entry.get("name"):
                discovered_names[package_name] = name
            has_real_app = True
            targets = []
            for target_item in entry.get("targets", []):
                target_out = {}
                if "version" in target_item:
                    target_out["version"] = target_item["version"]
                if target_item.get("isExperimental"):
                    target_out["isExperimental"] = True
                if target_out:
                    targets.append(target_out)
            package_out = {"packageName": package_name}
            if targets:
                package_out["targets"] = targets
            out_compat.append(package_out)

    if has_real_app and out_compat:
        out["compatiblePackages"] = out_compat

    return out


def build_site_json(stable_list, dev_list, latest, discovered_names):
    is_bundle_prerelease = False
    out_patches = []
    target_apps = set()

    stable_patches_raw = stable_list.get("patches", []) if stable_list else []
    dev_patches_raw = dev_list.get("patches", []) if dev_list else []

    def process_patches(patches, is_prerelease=False):
        for patch in patches:
            stripped = strip_patch(patch, discovered_names)
            if not stripped:
                continue
            if is_prerelease:
                stripped["isPreRelease"] = True

            comp = stripped.pop("compatiblePackages", None)
            if comp:
                stripped["compatiblePackagesKey"] = get_compat_key(comp)
                target_apps.update(pkg["packageName"] for pkg in comp)
            else:
                target_apps.add("universal")

            out_patches.append(stripped)

    if latest == "stable" or not dev_list:
        process_patches(stable_patches_raw)
    elif not stable_list:
        is_bundle_prerelease = True
        process_patches(dev_patches_raw)
    else:
        stable_apps = set()
        stable_app_patches = {}

        for patch in stable_patches_raw:
            patch_name = patch.get("name")
            compatible_packages = patch.get("compatiblePackages")
            package_names = []
            if isinstance(compatible_packages, dict):
                package_names = [k for k in compatible_packages.keys() if k != "universal"]
            elif isinstance(compatible_packages, list):
                package_names = [
                    package_element.get("packageName")
                    for package_element in compatible_packages
                    if isinstance(package_element, dict) and package_element.get("packageName") and package_element.get("packageName") != "universal"
                ]

            if not package_names:
                package_names = ["universal"]

            for package_name in package_names:
                stable_apps.add(package_name)
                if package_name not in stable_app_patches:
                    stable_app_patches[package_name] = set()
                if patch_name:
                    stable_app_patches[package_name].add(patch_name)

        for patch in dev_patches_raw:
            stripped = strip_patch(patch, discovered_names)
            if not stripped:
                continue
            patch_name = stripped.get("name")

            compatible_packages = stripped.get("compatiblePackages")
            if compatible_packages:
                patch_is_new_for_some_old_app = False
                for package_obj in compatible_packages:
                    pkg_name = package_obj["packageName"]
                    target_apps.add(pkg_name)

                    if pkg_name not in stable_apps:
                        package_obj["isPreRelease"] = True
                    else:
                        if patch_name and patch_name not in stable_app_patches.get(pkg_name, set()):
                            patch_is_new_for_some_old_app = True

                if patch_is_new_for_some_old_app:
                    stripped["isPreRelease"] = True

                comp = stripped.pop("compatiblePackages")
                stripped["compatiblePackagesKey"] = get_compat_key(comp)
            else:
                target_apps.add("universal")
                if "universal" not in stable_apps:
                    stripped["isPreRelease"] = True
                else:
                    if patch_name and patch_name not in stable_app_patches.get("universal", set()):
                        stripped["isPreRelease"] = True

            out_patches.append(stripped)

    app_count = len([app for app in target_apps if app != "universal"])

    return (
        out_patches,
        is_bundle_prerelease,
        sorted(list(target_apps)),
        app_count,
    )


def main():
    parser = argparse.ArgumentParser(description="Update bundles and metadata")
    parser.add_argument("--stars", action="store_true", help="Update stars for all bundles")
    parser.add_argument("--avatars", action="store_true", help="Update avatars for all bundles")
    parser.add_argument("--icons", action="store_true", help="Update icons for all apps")
    parser.add_argument(
        "--daily",
        action="store_true",
        help="Daily update (stars, missing avatars, missing app icons/names)",
    )
    parser.add_argument("--all", action="store_true", help="Update everything (stars, avatars, icons)")
    args = parser.parse_args()

    if args.all:
        args.stars = args.avatars = args.icons = args.daily = True

    SITE_DIR.mkdir(parents=True, exist_ok=True)
    if not BUNDLES_DIR.exists():
        print("No bundles directory found. Run download.py first.")
        return

    app_metadata = load_json(APPS_JSON_PATH, {}) or {}
    existing_sources = load_json(BUNDLES_JSON_PATH, {}) or {}

    official_data = load_json(OFFICIAL_BUNDLES_PATH, {}) or {}
    official_store = official_data.get("store", {})
    official_avatars = {}
    for bundle in official_data.get("bundles", []):
        if bundle.get("repo") and bundle.get("avatarUrl"):
            official_avatars[bundle["repo"]] = bundle["avatarUrl"]

    bundle_sources = {}
    avatar_cache = {}
    stars_cache = {}

    existing_bundles = {}
    for bundle in existing_sources.get("bundles", []):
        if "key" in bundle:
            existing_bundles[bundle["key"]] = bundle

    for base_key, bundle_info in existing_bundles.items():
        if bundle_info.get("avatarUrl"):
            avatar_cache[base_key] = bundle_info["avatarUrl"]
        if "stars" in bundle_info:
            stars_cache[base_key] = bundle_info["stars"]

    avatar_tasks = {}
    stars_tasks = {}
    app_tasks = set()
    apps_with_patch_names = set()

    seen_packages = set()
    all_packages = set()
    scanned_lists = 0

    bases = set()
    if PATCHES_DIR.exists():
        for patch_path in PATCHES_DIR.glob("*.json"):
            name = patch_path.name.replace("-stable.json", "").replace("-dev.json", "")
            bases.add(name)

    for base in sorted(bases):
        stable_bundle_path = BUNDLES_DIR / f"{base}-stable.json"
        dev_bundle_path = BUNDLES_DIR / f"{base}-dev.json"
        stable_list_path = PATCHES_DIR / f"{base}-stable.json"
        dev_list_path = PATCHES_DIR / f"{base}-dev.json"

        stable_json = load_json(stable_bundle_path) if stable_bundle_path.exists() and stable_list_path.exists() else None
        dev_json = load_json(dev_bundle_path) if dev_bundle_path.exists() and dev_list_path.exists() else None

        if not stable_json and not dev_json:
            continue

        source, repo, repo_url = get_repo_info(stable_json) if stable_json else get_repo_info(dev_json)

        avatar_url = avatar_cache.get(base, None)
        if repo_url:
            if not avatar_url:
                avatar_url = None
        else:
            avatar_url = ""

        if args.avatars or avatar_url is None:
            if repo_url:
                if repo in official_avatars:
                    avatar_url = official_avatars[repo]
                    if avatar_url:
                        if "googleusercontent.com" in avatar_url:
                            if "=" in avatar_url:
                                avatar_url = avatar_url.split("=")[0]
                            avatar_url += "=s128"
                        elif "githubusercontent.com" in avatar_url:
                            avatar_url = avatar_url.split("?")[0] + "?s=128"
                        elif "gitlab.com/uploads/" in avatar_url:
                            avatar_url = avatar_url.split("?")[0] + "?width=128"
                else:
                    avatar_tasks[base] = repo_url

        stars = stars_cache.get(base, None)
        if not repo_url:
            stars = 0

        if args.stars or args.daily or stars is None:
            if repo_url:
                stars_tasks[base] = repo_url

        source_entry = {
            "source": source,
            "repo": repo,
            "avatarUrl": avatar_url,
            "stars": stars,
        }

        if base in existing_bundles and existing_bundles[base].get("firstSeen"):
            source_entry["firstSeen"] = existing_bundles[base]["firstSeen"]

        stable_date = stable_json.get("created_at", "") if stable_json else ""
        dev_date = dev_json.get("created_at", "") if dev_json else ""

        if "firstSeen" not in source_entry:
            source_entry["firstSeen"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S")

        latest = "dev" if (dev_date and stable_date and dev_date > stable_date) else "stable"
        if not stable_json:
            latest = "dev"
        if not dev_json:
            latest = "stable"

        stable_list_json = load_json(stable_list_path) if stable_list_path.exists() else None
        dev_list_json = load_json(dev_list_path) if dev_list_path.exists() else None

        discovered = {}
        out_patches, is_bundle_prerelease, target_apps, app_count = build_site_json(stable_list_json, dev_list_json, latest, discovered)

        for channel_json in [stable_list_json, dev_list_json]:
            if channel_json:
                scanned_lists += 1

        all_packages.update(target_apps)

        for package_name in target_apps:
            if package_name not in seen_packages:
                seen_packages.add(package_name)
                if package_name == "universal" or " " in package_name or "." not in package_name:
                    continue

                meta = app_metadata.get(package_name)
                is_new_app = not meta
                name = discovered.get(package_name, None)
                if name:
                    apps_with_patch_names.add(package_name)

                if not meta:
                    app_metadata[package_name] = {"name": name, "iconUrl": None}
                elif isinstance(meta, str):
                    new_name = name or meta
                    app_metadata[package_name] = {
                        "name": new_name if new_name else None,
                        "iconUrl": None,
                    }
                elif isinstance(meta, dict):
                    if name and meta.get("name") != name:
                        app_metadata[package_name]["name"] = name

                should_fetch = False
                if args.icons:
                    should_fetch = True
                elif is_new_app:
                    should_fetch = True
                elif args.daily and (app_metadata[package_name].get("name") is None or app_metadata[package_name].get("iconUrl") is None):
                    should_fetch = True

                if should_fetch:
                    official_app = official_store.get(package_name)
                    if official_app:
                        if official_app.get("iconUrl") and (args.icons or app_metadata[package_name].get("iconUrl") is None):
                            icon_url = official_app["iconUrl"]
                            if "googleusercontent.com" in icon_url:
                                if "=" in icon_url:
                                    icon_url = icon_url.split("=")[0]
                                icon_url += "=s64"
                            app_metadata[package_name]["iconUrl"] = icon_url
                        if official_app.get("name") and app_metadata[package_name].get("name") is None:
                            app_metadata[package_name]["name"] = official_app["name"]
                    if app_metadata[package_name].get("iconUrl") is None or app_metadata[package_name].get("name") is None:
                        app_tasks.add(package_name)
        latest_bundle_json = dev_json if latest == "dev" else stable_json

        # Update source_entry with the new schema
        source_entry["patches"] = out_patches
        source_entry["createdAt"] = latest_bundle_json.get("created_at", "")
        source_entry["targetApps"] = target_apps
        source_entry["appCount"] = app_count

        if is_bundle_prerelease:
            source_entry["isPreRelease"] = True

        bundle_sources[base] = source_entry
    print(f"Scanned {scanned_lists} list files.")

    if avatar_tasks:
        print(f"Fetching avatars for {len(avatar_tasks)} bundles...")
        with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
            future_to_base = {executor.submit(fetch_avatar_url, url): base for base, url in avatar_tasks.items()}
            for future in concurrent.futures.as_completed(future_to_base):
                base = future_to_base[future]
                try:
                    new_avatar = future.result()
                    if new_avatar:
                        bundle_sources[base]["avatarUrl"] = new_avatar
                    else:
                        print(f"[ERROR] Missing avatar for bundle: {base}")
                except Exception as e:
                    print(f"Failed to fetch avatar for {base}: {e}")

    if stars_tasks:
        print(f"Fetching stars for {len(stars_tasks)} bundles...")
        with concurrent.futures.ThreadPoolExecutor(max_workers=GITHUB_CONCURRENCY) as executor:
            future_to_base = {executor.submit(fetch_repo_stars, url): base for base, url in stars_tasks.items()}
            for future in concurrent.futures.as_completed(future_to_base):
                base = future_to_base[future]
                try:
                    new_stars = future.result()
                    if new_stars is not None:
                        bundle_sources[base]["stars"] = new_stars
                    else:
                        print(f"[ERROR] Missing stars for bundle: {base}")
                except Exception as e:
                    print(f"Failed to fetch stars for {base}: {e}")

    if app_tasks:
        print(f"Fetching app details for {len(app_tasks)} apps...")
        with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
            future_to_package = {executor.submit(fetch_app_details, package_name): package_name for package_name in app_tasks}
            for future in concurrent.futures.as_completed(future_to_package):
                package_name = future_to_package[future]
                try:
                    new_icon, app_name = future.result()
                    if new_icon:
                        if args.icons or app_metadata[package_name].get("iconUrl") is None:
                            app_metadata[package_name]["iconUrl"] = new_icon
                    if app_name:
                        if package_name not in apps_with_patch_names:
                            if app_metadata[package_name].get("name") is None:
                                app_metadata[package_name]["name"] = app_name
                    if not new_icon and not app_name:
                        print(f"[ERROR] Missing app details for package: {package_name}")
                except Exception as e:
                    print(f"Failed to fetch app details for {package_name}: {e}")

    sorted_bundles = []
    
    for base, data in sorted(bundle_sources.items(), key=lambda item: (item[1].get("firstSeen", ""), item[0].lower())):
        ordered_data = {"key": base}
        ordered_data.update(data)
        sorted_bundles.append(ordered_data)

    output_data = {"bundles": sorted_bundles, "compatibilities": compatibilities_list}
    save_json(BUNDLES_JSON_PATH, output_data)
    print(f"Generated bundles.json with {len(sorted_bundles)} bundles.")

    save_json(APPS_JSON_PATH, app_metadata)
    print(f"Generated apps.json with {len(app_metadata)} apps.")

    missing_names = sorted(
        package_name
        for package_name in all_packages
        if (package_name not in app_metadata or app_metadata[package_name].get("name") is None) and package_name != "universal" and " " not in package_name and "." in package_name
    )

    missing_icons = sorted(
        package_name
        for package_name in all_packages
        if (package_name not in app_metadata or app_metadata[package_name].get("iconUrl") is None) and package_name != "universal" and " " not in package_name and "." in package_name
    )

    missing_avatars = sorted(base for base, info in bundle_sources.items() if info.get("repo") and (info.get("avatarUrl") is None or info.get("avatarUrl") == ""))

    missing_stars = sorted(base for base, info in bundle_sources.items() if info.get("repo") and info.get("stars") is None)

    def print_warnings(items, desc):
        if not items:
            return
        print(f"\n[WARNING] Missing {desc} for {len(items)} items:")
        for item in items:
            print(f"  - {item}")
        if "GITHUB_ACTIONS" in os.environ:
            print(f"::warning::Missing {desc} for {len(items)} items: {', '.join(items)}")

    print_warnings(missing_names, "app name")
    print_warnings(missing_icons, "app iconUrl")
    print_warnings(missing_avatars, "bundle avatarUrl")
    print_warnings(missing_stars, "bundle stars")

    if not (missing_names or missing_icons or missing_avatars or missing_stars):
        print("\nEverything is up to date!")


if __name__ == "__main__":
    main()
