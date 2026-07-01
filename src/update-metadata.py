# Copyright (c) 2026 nvbangg (github.com/nvbangg)

import argparse
import json
import urllib.request
import time
from pathlib import Path

try:
    from google_play_scraper import app as gplay_app
except ImportError:
    gplay_app = None

ROOT = Path.cwd()
DATA_DIR = ROOT / "data"
APP_METADATA_PATH = DATA_DIR / "app-metadata.json"
BUNDLES_PATHS = [
    DATA_DIR / "bundles-latest.json",
    DATA_DIR / "bundles-stable.json",
    DATA_DIR / "bundles-dev.json"
]

def read_json(path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default

def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf8")

def get_gitlab_avatar(username):
    try:
        req = urllib.request.Request(
            f'https://gitlab.com/api/v4/users?username={username}',
            headers={'User-Agent': 'Mozilla/5.0'}
        )
        response = urllib.request.urlopen(req, timeout=10)
        data = json.loads(response.read().decode('utf-8'))
        if data and len(data) > 0:
            avatar = data[0].get('avatar_url', '')
            if avatar:
                return avatar.replace("s=80", "s=128")
    except Exception as e:
        print(f"Failed to fetch gitlab avatar for {username}: {e}")
    return ""

def get_app_icon(pkg):
    if not gplay_app:
        print("Warning: google-play-scraper is not installed. Run: pip install google-play-scraper")
        return ""
    try:
        result = gplay_app(pkg)
        if result and "icon" in result:
            return result["icon"]
    except Exception as e:
        print(f"Failed to fetch app icon for {pkg}: {e}")
    return ""

def update_bundle_avatar(bundle_key, repo_url, avatar_url, force):
    """Returns new avatar_url if fetched, else old avatar_url"""
    if not force and avatar_url:
        return avatar_url

    if not repo_url:
        return ""

    if "gitlab.com/" in repo_url:
        parts = repo_url.split("gitlab.com/")
        if len(parts) > 1:
            username = parts[1].split("/")[0]
            if username:
                print(f"Fetching avatar for GitLab user: {username}")
                return get_gitlab_avatar(username)
    
    if "github.com/" in repo_url:
        parts = repo_url.split("github.com/")
        if len(parts) > 1:
            username = parts[1].split("/")[0]
            if username:
                return f"https://github.com/{username}.png?size=128"
    
    return avatar_url

def main():
    parser = argparse.ArgumentParser(description="Fetch and update metadata (icons and avatars)")
    parser.add_argument("--new-only", action="store_true", help="Only fetch metadata for items that don't have it yet")
    parser.add_argument("--pkg", type=str, help="Update icon for a specific package name")
    parser.add_argument("--bundle", type=str, help="Update avatar for a specific bundle name")
    args = parser.parse_args()

    force_all = not args.new_only and not args.pkg and not args.bundle
    update_all_new = args.new_only

    # 1. Update App Icons
    app_metadata = read_json(APP_METADATA_PATH, {})
    app_updated = False

    for pkg, meta in app_metadata.items():
        if not isinstance(meta, dict):
            # In case someone manually put a string
            app_metadata[pkg] = {"name": meta, "icon": ""}
            meta = app_metadata[pkg]

        needs_update = False
        if force_all:
            needs_update = True
        elif update_all_new and not meta.get("icon"):
            needs_update = True
        elif args.pkg and args.pkg == pkg:
            needs_update = True

        if pkg == "universal" or " " in pkg or "." not in pkg:
            needs_update = False

        if needs_update:
            print(f"Fetching icon for app: {pkg}")
            icon = get_app_icon(pkg)
            if icon:
                app_metadata[pkg]["icon"] = icon
                app_updated = True
            time.sleep(0.3)

    if app_updated:
        write_json(APP_METADATA_PATH, app_metadata)
        print("Updated app-metadata.json")

    # 2. Update Bundle Avatars
    for bundle_path in BUNDLES_PATHS:
        bundles = read_json(bundle_path)
        if not bundles:
            continue
        
        bundle_updated = False
        for bundle_key, info in bundles.items():
            needs_update = False
            if force_all:
                needs_update = True
            elif update_all_new and not info.get("avatarUrl"):
                needs_update = True
            elif args.bundle and args.bundle == bundle_key:
                needs_update = True

            if needs_update:
                repo_url = info.get("repo", "")
                old_avatar = info.get("avatarUrl", "")
                new_avatar = update_bundle_avatar(bundle_key, repo_url, old_avatar, force=needs_update)
                if new_avatar and new_avatar != old_avatar:
                    bundles[bundle_key]["avatarUrl"] = new_avatar
                    bundle_updated = True
        
        if bundle_updated:
            write_json(bundle_path, bundles)
            print(f"Updated {bundle_path.name}")

if __name__ == "__main__":
    main()
