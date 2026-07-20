### [nvbangg/awesome-for-morphe](https://github.com/nvbangg/awesome-for-morphe)

> [!NOTE]
> This document contains contribution guidelines, project structure details, and automation workflows for the [Awesome for Morphe Website](https://nvbangg.github.io/awesome-for-morphe/).

## 📬 Contributing

- To add, remove, or customize a bundle source, please submit a [Bundle Request](https://github.com/nvbangg/awesome-for-morphe/issues/new?template=bundle-request.yml).
- For any other issues, suggestions, or questions, feel free to [open a new issue](https://github.com/nvbangg/awesome-for-morphe/issues/new).

## 📂 Project Structure & Data

```text
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   └── bundle-request.yml           # Issue template to add, remove, or customize a bundle source
│   └── workflows/
│       ├── ci.yml                       # Sync workflow (every 3 hours)
│       └── release.yml                  # Daily release workflow (23:00 UTC)
├── data/
│   ├── bundles/                         # Raw patch bundles from upstream
│   ├── patches/                         # Raw patch lists from upstream
│   ├── repos/
│   │   ├── custom.json                  # Custom entries to add, remove, or customize the name/key of bundles
│   │   ├── jman.json                    # Bundles discovered from Jman
│   │   ├── morphe-archive.json          # Bundles discovered from Morphe Archive
│   │   └── official.json                # Bundles discovered from the Official Website
│   ├── snapshots/
│   │   ├── discover.json                # Snapshots of discovered providers
│   │   └── official-bundles.json        # Snapshots of official bundles
│   ├── history.json                     # Baseline sync state for tracking patch updates
│   └── repos.json                       # Compiled database of all discovered bundles
├── docs/                                 # Website deployment folder (GitHub Pages)
│   ├── assets/                          # Contains compiled assets and other assets needed for the website
│   ├── apps.json                        # Metadata containing target app names/icons
│   ├── bundles.json                     # Central compiled index of all active bundles
│   ├── index.html                       # Frontend main webpage interface (compiled)
│   └── whats-new.json                   # Rolling changelog JSON of last 15 releases
├── scripts/
│   ├── providers/                       # Scraper providers for discovery
│   │   ├── jman.py                      # Jman repository parser
│   │   ├── morphe_archive.py            # Morphe Archive parser
│   │   └── official.py                  # Official Website parser
│   ├── discover.py                      # Scans community patch repositories
│   ├── download.py                      # Downloads raw bundle and patch list database metadata
│   ├── telegram.py                      # Sends Telegram notifications
│   ├── update.py                        # Processes raw databases into optimized web formats
│   ├── utils.py                         # Shared utility functions
│   └── whats_new.py                     # Diffs updates and compiles rolling release logs
├── web/                                 # Website source code and Vite bundler configuration
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

## 🤖 Automation

This project uses GitHub Actions to automate data synchronization and release cycles:

### 1. Sync Workflow (`ci.yml` - Every 3 hours)

Checks for upstream bundle changes and updates the compiled website database:

1. Discover patch repositories: `python scripts/discover.py`
2. Download raw bundle metadata: `python scripts/download.py --bundles`
3. If changes are detected:
   - Download corresponding patch lists: `python scripts/download.py`
   - Compile optimized web assets: `python scripts/update.py`
   - Commit and push changes directly to `main` branch.

### 2. Release Workflow (`release.yml` - Daily at 23:00 UTC)

Runs daily maintenance, builds release notes, and notifies subscribers:

1. Discover patch repositories: `python scripts/discover.py`
2. Check upstream updates: `python scripts/download.py --bundles` (and `python scripts/download.py` if changed).
3. Compile data: `python scripts/update.py --all` (on the 1st of the month) or `python scripts/update.py --daily` (other days).
4. Generate release changelog: `python scripts/whats_new.py`
5. Commit and push updates, then create a new GitHub Release
6. Send notification to Telegram channel: `python scripts/telegram.py`

## 🛠️ Usage / Scripts

All core automation logic is written in Python inside the `scripts/` directory.

### `discover.py`

Scans community patch repositories and compiles them to `data/repos.json`.

- `python scripts/discover.py`

#### Discovered Sources

- [Morphe Community Patches](https://morphe-patches.software)
- [Jman's ReVanced Patch Bundles](https://github.com/Jman-Github/ReVanced-Patch-Bundles)
- [Morphe Archive](https://github.com/rushiforai/morphe-archive)
- My custom sources defined in [`custom.json`](data/repos/custom.json)

#### Customization

Customize target repositories in [`custom.json`](data/repos/custom.json) to add, remove, or customize the name/key of bundles:

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

### `download.py`

Downloads raw patch and bundle metadata from remote sources.

- `python scripts/download.py --bundles`: Downloads raw bundles to `data/bundles/`.
- `python scripts/download.py`: Fetches corresponding patch lists to `data/patches/`.

### `update.py`

Parses raw JSON files and compiles optimized web assets inside `docs/` for UI rendering. Data is extracted directly from `data/bundles/` and `data/patches/`. Missing data is retrieved from `official-bundles.json`, scraped from Google Play, or customized manually.

- `python scripts/update.py`: Compiles database index files.
- Optional flags:
  - `--stars`: Updates GitHub/GitLab stars for all bundles.
  - `--avatars`: Forces updates of avatars for all bundles.
  - `--icons`: Forces updates of app icons/names for all apps.
  - `--daily`: Runs daily maintenance (updates stars for all bundles, fetches missing avatars, and fetches missing app icons/names).
  - `--all`: Forces a full update of all data (stars, avatars, and app icons/names for everything).

### `whats_new.py`

Generates the "What's New" changelog by diffing current patch data against the baseline.

- `python scripts/whats_new.py`

### `telegram.py`

Sends release updates from `whats-new.md` to a Telegram channel.

- `python scripts/telegram.py` (accepts optional `"Title"` and `"file.md"` arguments)
