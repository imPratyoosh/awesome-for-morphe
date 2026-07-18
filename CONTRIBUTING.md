### [nvbangg/awesome-for-morphe](https://github.com/nvbangg/awesome-for-morphe)

## Submitting a Bundle Request

To add, remove, or customize a bundle source, please submit a [Bundle Request](https://github.com/nvbangg/awesome-for-morphe/issues/new?template=bundle-request.yml).


## Data

The `/data` directory is used as a Morphe patch database, sourced from [ReVanced Patch Bundles](https://github.com/Jman-Github/ReVanced-Patch-Bundles) by Jman:

- [`bundles.json`](data/bundles.json) — central index of all bundles
- [`apps.json`](data/apps.json) — metadata for target apps
- `/bundles/<bundle>-<channel>.json` — patches-bundle.json
- `/patches/<bundle>-<channel>.json` — patches-list.json
- `/site/<bundle>.json` — optimized list of patches for UI rendering
- [`whats-new.json`](data/whats-new.json) — rolling what's new history
- [`history.json`](data/history.json) — baseline tracking for what's new diffs
- [`repos.json`](data/repos.json) — list of all discovered repositories (experimental and incomplete)

## Automation

| Workflow | Schedule | What it does |
|---|---|---|
| [**Sync Bundles**](https://github.com/nvbangg/awesome-for-morphe/blob/main/.github/workflows/ci.yml) | Every 3 hours | Sync `/bundles` and update `/patches`, `bundles.json`, `apps.json` if changed |
| [**Generate Release**](https://github.com/nvbangg/awesome-for-morphe/blob/main/.github/workflows/release.yml) | Daily at 1:00 UTC | Release what's new + Telegram notification |

## Usage / Scripts

All core logic is contained inside the `scripts/` directory.

### `download.py`
Downloads the raw JSON metadata from the remote source.
- `python scripts/download.py --bundles`: Downloads the `*-patches-bundle.json` files and saves them to `/data/bundles/`. (Requires wiping out old bundles).
- `python scripts/download.py`: (Run without flags) Reads the downloaded bundles and fetches the `*-patches-list.json` data, saving them directly to `/data/patches/`.

### `update.py`
Parses the downloaded JSON files and compiles the unified `bundles.json`, `apps.json`, and `/site/<bundle>.json` UI data files.
- `python scripts/update.py`: Compiles JSON files. It will automatically fetch data (stars, avatars, app names, icons) for completely new apps/bundles, or if any of these fields are missing (`null`).
- `python scripts/update.py --stars`: Forces an update of stars for **all** bundles.
- `python scripts/update.py --avatars`: Forces an update of avatars for **all** bundles.
- `python scripts/update.py --icons`: Forces an update of icons for **all** apps.
- `python scripts/update.py --daily`: Runs the daily update. This updates stars for **all** bundles, fetches missing avatars, and fetches missing app icons/names.
- `python scripts/update.py --all`: Forces an update of all data (stars, avatars, icons) for all bundles and apps, including daily updates.


### `whats_new.py`
Generates the what's new list by diffing current bundles against the history baseline.
- `python scripts/whats_new.py`: Generates `whats-new.md` with hierarchical tree notes, adds the new released entry to `whats-new.json` (keeping max 15 items), and updates the `history.json` baseline.

### `discover.py` (experimental and incomplete)
Scans patch repositories from remote sources and my custom sources.
- `python scripts/discover.py`

Supported remote sources:
- [(Official) Morphe Community Patches](https://morphe-patches.software)
- [ReVanced Patch Bundles](https://github.com/Jman-Github/ReVanced-Patch-Bundles)
- [Morphe Archive](https://github.com/rushiforai/morphe-archive)

Outputs the consolidated database to [`/data/repos.json`](data/repos.json).

#### Customization
Define entries in [`/data/repos/custom.json`](data/repos/custom.json) to add, modify, or exclude repositories:
```json
{
  "github:owner/repo": {
    "key": "custom-key",
    "name": "Custom Name"
  },
  "gitlab:owner/repo-to-exclude": {
    "enabled": false
  }
}
```

### `telegram.py`
Sends a notification to a Telegram channel.
- `python scripts/telegram.py`: Sends the content of `whats-new.md` using an automatically generated title (e.g. `🔔 What's New (July 06)`).
- `python scripts/telegram.py "Custom Title"`: Sends the content of `whats-new.md` with the specified title.
- `python scripts/telegram.py "Custom Title" "path/to/file.md"`: Sends the content of a specific file with a specific title.
