# Copyright (c) 2026 nvbangg (github.com/nvbangg)

import argparse
import concurrent.futures
import json
import os
import urllib.request
import time
from pathlib import Path
from datetime import datetime

try:
    from google_play_scraper import app as gplay_app
except ImportError:
    gplay_app = None

ROOT = Path.cwd()
DATA_DIR = ROOT / "data"
BUNDLES_DIR = DATA_DIR / "bundles"
PATCHES_DIR = DATA_DIR / "patches"
BUNDLES_JSON_PATH = DATA_DIR / "bundles.json"
APPS_JSON_PATH = DATA_DIR / "apps.json"
CONCURRENCY = 8
GITHUB_CONCURRENCY = 3


def read_json(path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf8"
    )


def get_repo_info(bundle_json):
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


def fetch_avatar_url(repo_url):
    if not repo_url:
        return ""

    if "gitlab.com/" in repo_url:
        parts = repo_url.split("gitlab.com/")
        if len(parts) > 1:
            username = parts[1].split("/")[0]
            if username:
                try:
                    request = urllib.request.Request(
                        f"https://gitlab.com/api/v4/users?username={username}",
                        headers={"User-Agent": "Mozilla/5.0"},
                    )
                    with urllib.request.urlopen(request, timeout=10) as response:
                        data = json.loads(response.read().decode("utf-8"))
                        if data and len(data) > 0:
                            avatar = data[0].get("avatar_url", "")
                            if avatar:
                                return avatar.replace("s=80", "s=128")
                except Exception as exception:
                    print(f"Failed to fetch gitlab avatar for {username}: {exception}")
                    return None

    if "github.com/" in repo_url:
        parts = repo_url.split("github.com/")
        if len(parts) > 1:
            username = parts[1].split("/")[0]
            if username:
                return f"https://github.com/{username}.png?size=128"

    return None


def fetch_repo_stars(repo_url):
    if not repo_url:
        return 0

    if "github.com" in repo_url:
        parts = repo_url.split("github.com/")
        if len(parts) > 1:
            repo_path = parts[1].split("/")
            if len(repo_path) >= 2:
                owner, name = repo_path[0], repo_path[1]
                api_url = f"https://api.github.com/repos/{owner}/{name}"

                def fetch(use_token=True):
                    request = urllib.request.Request(
                        api_url, headers={"User-Agent": "Awesome-For-Morphe"}
                    )
                    if use_token and os.environ.get("GITHUB_TOKEN"):
                        request.add_header(
                            "Authorization", f"Bearer {os.environ['GITHUB_TOKEN']}"
                        )
                    with urllib.request.urlopen(request, timeout=10) as response:
                        return json.loads(response.read().decode()).get(
                            "stargazers_count", 0
                        )

                try:
                    time.sleep(0.5)
                    return fetch(use_token=True)
                except urllib.error.HTTPError as error:
                    if error.code in (401, 403, 429):
                        try:
                            time.sleep(1)
                            return fetch(use_token=False)
                        except Exception as inner_exception:
                            print(
                                f"Error fetching stars (no token) for {repo_url}: {inner_exception}"
                            )
                            return None
                    else:
                        print(f"Error fetching stars for {repo_url}: {error}")
                        return None
                except Exception as exception:
                    print(f"Error fetching stars for {repo_url}: {exception}")
                    return None

    elif "gitlab.com" in repo_url:
        parts = repo_url.split("gitlab.com/")
        if len(parts) > 1:
            repo_path = parts[1].strip("/")
            encoded_path = urllib.parse.quote(repo_path, safe="")
            api_url = f"https://gitlab.com/api/v4/projects/{encoded_path}"
            try:
                time.sleep(0.5)
                request = urllib.request.Request(
                    api_url, headers={"User-Agent": "Awesome-For-Morphe"}
                )
                with urllib.request.urlopen(request, timeout=10) as response:
                    return json.loads(response.read().decode()).get("star_count", 0)
            except Exception as exception:
                print(f"Error fetching GitLab stars for {repo_url}: {exception}")
                return None

    return None


def fetch_app_icon(package_name):
    if not gplay_app:
        print(
            "Warning: google-play-scraper is not installed. Run: pip install google-play-scraper"
        )
        return None
    try:
        result = gplay_app(package_name)
        if result and "icon" in result:
            return result["icon"]
    except Exception as exception:
        print(f"Failed to fetch app icon for {package_name}: {exception}")
    return None


def collect_apps(list_json):
    apps = set()
    discovered_names = {}
    patch_count = len(list_json.get("patches", []))

    for patch in list_json.get("patches", []):
        compatible = patch.get("compatiblePackages")
        has_app = False

        if isinstance(compatible, dict):
            for package_name in compatible.keys():
                apps.add(package_name)
                has_app = True
        elif isinstance(compatible, list):
            for entry in compatible:
                if isinstance(entry, dict) and (
                    package_name := entry.get("packageName")
                ):
                    apps.add(package_name)
                    has_app = True
                    if name := entry.get("name"):
                        discovered_names[package_name] = name

        if not has_app:
            apps.add("universal")

    return apps, discovered_names, patch_count


def main():
    parser = argparse.ArgumentParser(description="Update bundles and metadata")
    parser.add_argument(
        "--stars", action="store_true", help="Update stars for all bundles"
    )
    parser.add_argument(
        "--avatars", action="store_true", help="Update avatars for all bundles"
    )
    parser.add_argument(
        "--icons", action="store_true", help="Update icons for all apps"
    )
    parser.add_argument(
        "--all", action="store_true", help="Update everything (stars, avatars, icons)"
    )
    args = parser.parse_args()

    if args.all:
        args.stars = args.avatars = args.icons = True

    if not BUNDLES_DIR.exists():
        print("No bundles directory found. Run download.py first.")
        return

    app_metadata = read_json(APPS_JSON_PATH, {}) or {}
    existing_sources = read_json(BUNDLES_JSON_PATH, {}) or {}

    bundle_sources = {}
    avatar_cache = {}
    stars_cache = {}

    for base_key, bundle_info in existing_sources.items():
        if bundle_info.get("avatarUrl"):
            avatar_cache[base_key] = bundle_info["avatarUrl"]
        if "stars" in bundle_info:
            stars_cache[base_key] = bundle_info["stars"]

    avatar_tasks = {}
    stars_tasks = {}
    icon_tasks = set()

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

        stable_json = (
            read_json(stable_bundle_path)
            if stable_bundle_path.exists() and stable_list_path.exists()
            else None
        )
        dev_json = (
            read_json(dev_bundle_path)
            if dev_bundle_path.exists() and dev_list_path.exists()
            else None
        )

        if not stable_json and not dev_json:
            continue

        source, repo, repo_url = (
            get_repo_info(stable_json) if stable_json else get_repo_info(dev_json)
        )
        deep_link = (
            f"https://morphe.software/add-source?{source}={repo}" if repo else ""
        )

        avatar_url = avatar_cache.get(base, "")
        if args.avatars or not avatar_url:
            if repo_url:
                avatar_tasks[base] = repo_url

        stars = stars_cache.get(base)
        if args.stars or stars is None:
            if repo_url:
                stars_tasks[base] = repo_url
            else:
                stars = 0

        source_entry = {
            "source": source,
            "repo": repo,
            "repoUrl": repo_url,
            "deepLink": deep_link,
            "avatarUrl": avatar_url,
            "stars": stars if stars is not None else 0,
        }

        if base in existing_sources and existing_sources[base].get("firstSeen"):
            source_entry["firstSeen"] = existing_sources[base]["firstSeen"]

        stable_date = stable_json.get("created_at", "") if stable_json else ""
        dev_date = dev_json.get("created_at", "") if dev_json else ""

        if "firstSeen" not in source_entry:
            source_entry["firstSeen"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S")

        latest = (
            "dev" if (dev_date and stable_date and dev_date > stable_date) else "stable"
        )
        if not stable_json:
            latest = "dev"
        if not dev_json:
            latest = "stable"

        latest_target_apps = []
        for channel, bundle_json, list_path in [
            ("stable", stable_json, stable_list_path),
            ("dev", dev_json, dev_list_path),
        ]:
            if bundle_json:
                version = bundle_json.get("version", "")
                created_at = bundle_json.get("created_at", "")
                out_file = f"patches/{base}-{channel}.json"

                list_json = read_json(list_path)
                scanned_lists += 1

                packages, discovered, patch_count = collect_apps(list_json)
                all_packages.update(packages)

                target_apps = sorted(list(packages))
                app_count = len(
                    [
                        package_name
                        for package_name in target_apps
                        if package_name != "universal"
                    ]
                )

                release_url = ""
                if repo_url and version:
                    import urllib.parse

                    safe_version = urllib.parse.quote(version, safe="")
                    if source == "gitlab":
                        release_url = f"{repo_url}/-/releases/{safe_version}"
                    else:
                        release_url = f"{repo_url}/releases/tag/{safe_version}"

                source_entry[channel] = {
                    "file": out_file,
                    "version": version,
                    "releaseUrl": release_url,
                    "createdAt": created_at,
                    "targetApps": target_apps,
                    "appCount": app_count,
                    "patchCount": patch_count,
                }

                if channel == latest:
                    latest_target_apps = target_apps

                for package_name in packages:
                    if (
                        package_name == "universal"
                        or " " in package_name
                        or "." not in package_name
                    ):
                        continue

                    if package_name not in seen_packages:
                        seen_packages.add(package_name)
                        meta = app_metadata.get(package_name)
                        is_new_app = not meta
                        name = discovered.get(package_name, None)

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

                        if args.icons or is_new_app:
                            icon_tasks.add(package_name)

        source_entry["latest"] = latest
        bundle_sources[base] = source_entry
    print(f"Scanned {scanned_lists} list files.")

    if avatar_tasks:
        print(f"Fetching avatars for {len(avatar_tasks)} bundles...")
        with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
            future_to_base = {
                executor.submit(fetch_avatar_url, url): base
                for base, url in avatar_tasks.items()
            }
            for future in concurrent.futures.as_completed(future_to_base):
                base = future_to_base[future]
                try:
                    new_avatar = future.result()
                    if new_avatar:
                        bundle_sources[base]["avatarUrl"] = new_avatar
                    else:
                        print(f"[ERROR] Missing avatar for bundle: {base}")
                except Exception as exception:
                    print(f"Failed to fetch avatar for {base}: {exception}")

    if stars_tasks:
        print(f"Fetching stars for {len(stars_tasks)} bundles...")
        with concurrent.futures.ThreadPoolExecutor(
            max_workers=GITHUB_CONCURRENCY
        ) as executor:
            future_to_base = {
                executor.submit(fetch_repo_stars, url): base
                for base, url in stars_tasks.items()
            }
            for future in concurrent.futures.as_completed(future_to_base):
                base = future_to_base[future]
                try:
                    new_stars = future.result()
                    if new_stars is not None:
                        bundle_sources[base]["stars"] = new_stars
                    else:
                        print(f"[ERROR] Missing stars for bundle: {base}")
                except Exception as exception:
                    print(f"Failed to fetch stars for {base}: {exception}")

    if icon_tasks:
        print(f"Fetching icons for {len(icon_tasks)} apps...")
        with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
            future_to_package = {
                executor.submit(fetch_app_icon, package_name): package_name
                for package_name in icon_tasks
            }
            for future in concurrent.futures.as_completed(future_to_package):
                package_name = future_to_package[future]
                try:
                    new_icon = future.result()
                    if new_icon:
                        app_metadata[package_name]["iconUrl"] = new_icon
                    else:
                        print(f"[ERROR] Missing iconUrl for package: {package_name}")
                except Exception as exception:
                    print(f"Failed to fetch icon for {package_name}: {exception}")

    write_json(BUNDLES_JSON_PATH, bundle_sources)
    print(f"Generated bundles.json with {len(bundle_sources)} bundles.")

    write_json(APPS_JSON_PATH, app_metadata)
    if icon_tasks:
        print(f"Updated apps.json with new metadata.")

    missing = sorted(
        package_name
        for package_name in all_packages
        if (
            package_name not in app_metadata
            or app_metadata[package_name].get("name") is None
        )
        and package_name != "universal"
        and " " not in package_name
        and "." in package_name
    )
    if missing:
        print(f"\n[WARNING] Missing app name for {len(missing)} packages.")
        if "GITHUB_ACTIONS" in os.environ:
            print(
                f"::warning::Missing app name for {len(missing)} packages: {', '.join(missing)}"
            )

    missing_icons = sorted(
        package_name
        for package_name in all_packages
        if (
            package_name in app_metadata
            and app_metadata[package_name].get("iconUrl") is None
        )
        and package_name != "universal"
        and " " not in package_name
        and "." in package_name
    )
    if missing_icons:
        print(f"\n[INFO] Missing iconUrl for {len(missing_icons)} packages.")

    if not missing and not missing_icons:
        print("\nEverything is up to date!")


if __name__ == "__main__":
    main()
