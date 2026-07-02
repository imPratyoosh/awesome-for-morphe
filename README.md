### [nvbangg/awesome-for-morphe](https://github.com/nvbangg/awesome-for-morphe)

This branch hosts the data and source code for the 🔍 [Awesome for Morphe Website](https://nvbangg.github.io/awesome-for-morphe)

## /data

The `/data` directory is used as a Morphe patch database, sourced from [ReVanced Patch Bundles](https://github.com/Jman-Github/ReVanced-Patch-Bundles) by Jman:

- [`bundles.json`](data/bundles.json) — central index of all bundles
- [`apps.json`](data/apps.json) — metadata for target apps
- `/bundles/<bundle>-<channel>.json` — patches-bundle.json
- `/patches/<bundle>-<channel>.json` — patches-list.json

## Automation

| Workflow | Schedule | What it does |
|---|---|---|
| [**Sync Bundles**](https://github.com/nvbangg/awesome-for-morphe/blob/main/.github/workflows/ci.yml) | Every 4 hours | Sync `/bundles` and update `/patches`, `bundles.json`, `apps.json` if changed |
| [**Generate Release**](https://github.com/nvbangg/awesome-for-morphe/blob/main/.github/workflows/release.yml) | Daily at 8:00 UTC | Release changelog + Telegram notification |

## Usage / Scripts

All core logic is contained inside the `src/` directory.

### `src/download.py`
Downloads the raw JSON metadata from the remote source.
- `python src/download.py --bundles`: Downloads the `*-patches-bundle.json` files and saves them to `/data/bundles/`. (Requires wiping out old bundles).
- `python src/download.py`: (Run without flags) Reads the downloaded bundles and fetches the `*-patches-list.json` data, saving them directly to `/data/patches/`.

### `src/update.py`
Parses the downloaded JSON files and compiles the unified `bundles.json` and `apps.json`.
- `--stars`: Fetches GitHub repository stars via GitHub API.
- `--avatars`: Fetches GitHub avatars via GitHub API.
- `--icons`: Fetches target app icons (`iconUrl`) via `google-play-scraper`.
- `--all`: A shorthand to run all updates (`--stars`, `--avatars`, `--icons`).
