### [nvbangg/awesome-for-morphe](https://github.com/nvbangg/awesome-for-morphe)

This branch hosts the data and source code for the 🔍 [Awesome for Morphe Website](https://nvbangg.github.io/awesome-for-morphe)

## Data

The `/data` directory is used as a Morphe patch database, sourced from [ReVanced Patch Bundles](https://github.com/Jman-Github/ReVanced-Patch-Bundles) by Jman:

- [`bundles.json`](data/bundles.json) — central index of all bundles
- [`apps.json`](data/apps.json) — metadata for target apps
- `/bundles/<bundle>-<channel>.json` — patches-bundle.json
- `/patches/<bundle>-<channel>.json` — patches-list.json
- [`changelog.json`](data/changelog.json) — rolling changelog history
- [`history.json`](data/history.json) — baseline tracking for changelog diffs

## Automation

| Workflow | Schedule | What it does |
|---|---|---|
| [**Sync Bundles**](https://github.com/nvbangg/awesome-for-morphe/blob/main/.github/workflows/ci.yml) | Every 3 hours | Sync `/bundles` and update `/patches`, `bundles.json`, `apps.json` if changed |
| [**Generate Release**](https://github.com/nvbangg/awesome-for-morphe/blob/main/.github/workflows/release.yml) | Daily at 1:00 UTC | Release changelog + Telegram notification |

## Usage / Scripts

All core logic is contained inside the `src/` directory.

### `download.py`
Downloads the raw JSON metadata from the remote source.
- `python src/download.py --bundles`: Downloads the `*-patches-bundle.json` files and saves them to `/data/bundles/`. (Requires wiping out old bundles).
- `python src/download.py`: (Run without flags) Reads the downloaded bundles and fetches the `*-patches-list.json` data, saving them directly to `/data/patches/`.

### `update.py`
Parses the downloaded JSON files and compiles the unified `bundles.json` and `apps.json`.
- `python src/update.py`: Compiles `bundles.json` and `apps.json`. Automatically fetches missing data (stars, avatars, icons) for new entries.
- `python src/update.py --stars`: Additionally forces an update of stars for **all** bundles.
- `python src/update.py --avatars`: Additionally forces an update of avatars for **all** bundles.
- `python src/update.py --icons`: Additionally forces an update of icons for **all** apps.
- `python src/update.py --all`: Additionally forces an update of all API data for all entries.

### `changelog.py`
Generates the patch changelog by diffing current bundles against the history baseline.
- `python src/changelog.py`: Generates `changelog.json` containing unreleased changes. Truncates older items to keep a maximum of 15 items.
- `python src/changelog.py --release`: Additionally marks changes as released, generates `changelog.md` with hierarchical tree notes, and updates the `history.json` baseline.

### `telegram.py`
Sends a notification to a Telegram channel.
- `python src/telegram.py`: Sends the content of `changelog.md` using an automatically generated title (e.g. `🔔 What's New (July 06)`).
- `python src/telegram.py "Custom Title"`: Sends the content of `changelog.md` with the specified title.
- `python src/telegram.py "Custom Title" "path/to/file.md"`: Sends the content of a specific file with a specific title.
