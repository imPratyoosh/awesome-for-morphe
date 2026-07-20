# Copyright (c) 2026 nvbangg (github.com/nvbangg)

import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from utils import load_json, save_json
from providers import official, jman, morphe_archive

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"
REPOS_DIR = DATA_DIR / "repos"
OUTPUT_PATH = DATA_DIR / "repos.json"

PROVIDERS = [
    "custom",
    "official",
    "jman",
    "morphe-archive",
]
PROVIDER_MODULES = [official, jman, morphe_archive]
PROVIDER_PRIORITY = {f"{name}.json": idx for idx, name in enumerate(PROVIDERS)}

_MORPHE_PATCHES_RE = re.compile(r"^(?:my-)?morphe-patches$", re.IGNORECASE)
_STRIP_RE = re.compile(r"(?:-morphe|-patches)+$", re.IGNORECASE)


def _derive_display_name(repo, discovered_name, filename_key):
    if discovered_name:
        return discovered_name

    repo_name = repo.split("/")[1] if "/" in repo else repo

    if _MORPHE_PATCHES_RE.match(repo_name):
        return filename_key.replace("-", " ").title()

    name = _STRIP_RE.sub("", repo_name).strip("-_")
    if name:
        return name.replace("-", " ").replace("_", " ").title()

    return filename_key.replace("-", " ").title()


def _derive_filename_key(source, repo, custom_key, existing_keys):
    if custom_key:
        return custom_key.lower()

    parts = repo.split("/")
    owner = parts[0].lower()

    if owner not in existing_keys:
        return owner

    if len(parts) > 1:
        normalized = parts[1].replace("_", "-").lower()
        if not _MORPHE_PATCHES_RE.match(normalized):
            clean = _STRIP_RE.sub("", normalized).strip("-")
            if clean and (candidate := f"{owner}-{clean}") not in existing_keys:
                return candidate

    candidate = f"{owner}-{source}"
    if candidate not in existing_keys:
        return candidate

    raw_repo = parts[1].lower() if len(parts) > 1 else ""
    return f"{owner}-{raw_repo}-{source}" if raw_repo else f"{owner}-{source}"


def _run_providers():
    with ThreadPoolExecutor(max_workers=len(PROVIDER_MODULES)) as executor:
        futures = {executor.submit(m.discover): m.__name__ for m in PROVIDER_MODULES}
        for future in as_completed(futures):
            try:
                future.result()
            except Exception as e:
                print(f"Warning: {futures[future]} failed: {e}")


def _load_provider_files():
    results = []
    for provider in PROVIDERS:
        file_name = f"{provider}.json"
        path = REPOS_DIR / file_name
        if path.exists():
            data = load_json(path)
            if data:
                print(f"Loaded {len(data)} sources from {file_name}")
                results.append((file_name, data))
    return results


def _merge(provider_files):
    groups = {}
    for filename, provider_dict in provider_files:
        priority = PROVIDER_PRIORITY.get(filename, 99)
        for raw_key, data in provider_dict.items():
            lk = raw_key.lower()
            groups.setdefault(lk, []).append((priority, raw_key, data))

    merged = {}
    for entries in groups.values():
        entries.sort(key=lambda e: (e[0], e[1]))
        final_key = entries[0][1]
        merged_data = {}
        for _, _, data in entries:
            for k, v in data.items():
                if k not in merged_data:
                    merged_data[k] = v
        merged[final_key] = merged_data

    return merged


def _build_output(merged):
    repos_output = {}
    existing_keys = set()

    for canonical_key, entry in sorted(merged.items()):
        if entry.get("enabled") is False:
            continue

        source, repo = canonical_key.split(":", 1)
        filename_key = _derive_filename_key(source, repo, entry.get("key"), existing_keys)
        existing_keys.add(filename_key)

        name = _derive_display_name(repo, entry.get("name"), filename_key)
        repos_output[filename_key] = {"source": source, "repo": repo, "name": name}

    return repos_output


def main():
    _run_providers()
    print()

    provider_files = _load_provider_files()
    if not provider_files:
        print("No provider files found.")
        return 1

    merged = _merge(provider_files)
    print(f"\nMerged {len(merged)} unique sources")

    repos = dict(sorted(_build_output(merged).items(), key=lambda item: item[0].lower()))
    print(f"Generated {len(repos)} repos")

    save_json(OUTPUT_PATH, repos)
    print(f"\nSaved to {OUTPUT_PATH.relative_to(ROOT_DIR)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
