import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from providers.utils import fetch, save_json


README_URL = "https://raw.githubusercontent.com/rushiforai/morphe-archive/main/README.md"
OUTPUT_PATH = Path(__file__).resolve().parents[2] / "data" / "repos" / "morphe-archive.json"

_REPO_RE = re.compile(r"morphe\.software/add-source\?(github|gitlab)=([^)\s]+)")


def discover():
    print("  [morphe_archive] Fetching README.md...")
    try:
        content = fetch(README_URL)
    except Exception as e:
        print(f"  [morphe_archive] Failed: {e}")
        return {}

    discovered = {}
    for m in _REPO_RE.finditer(content):
        platform, repo_path = m.group(1), m.group(2).strip()
        parts = repo_path.split("/", 1)
        if len(parts) == 2:
            owner, repo = parts[0].strip(), parts[1].strip()
            discovered[f"{platform}:{owner}/{repo}"] = {}

    print(f"  [morphe_archive] Discovered {len(discovered)} repos")
    if not discovered:
        print("  [morphe_archive] Warning: empty result, keeping existing file")
        return {}
    save_json(OUTPUT_PATH, dict(sorted(discovered.items(), key=lambda item: item[0].lower())))
    return discovered


if __name__ == "__main__":
    result = discover()
    print(f"Saved {len(result)} repos to {OUTPUT_PATH.relative_to(OUTPUT_PATH.parents[2])}")
