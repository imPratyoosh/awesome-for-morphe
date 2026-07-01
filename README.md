### [nvbangg/awesome-for-morphe](https://github.com/nvbangg/awesome-for-morphe)

This branch hosts the data and source code for the 🔍 [Awesome for Morphe Website](https://nvbangg.github.io/awesome-for-morphe)

## /data

The `/patch-bundles` directory can be used as a Morphe patch database, sourced from [ReVanced Patch Bundles](https://github.com/Jman-Github/ReVanced-Patch-Bundles) by Jman:

- [`bundles-stable.json`](data/bundles-stable.json) / [`bundles-latest.json`](data/bundles-latest.json) / [`bundles-dev.json`](data/bundles-dev.json) — index of all bundles
- `/patch-bundles/<bundle>-patch-bundles/*-patches-bundle.json` — bundle metadata
- `/patch-bundles/<bundle>-patch-bundles/*-patches-list.json` — patches list
- [`app-metadata.json`](data/app-metadata.json) — app names and icons

## Automation

| Workflow | Schedule | What it does |
|---|---|---|
| [**Sync Patch Bundles**](https://github.com/nvbangg/awesome-for-morphe/blob/main/.github/workflows/ci.yml) | Every 4 hours | Sync `/patch-bundles` and update `bundles-<channel>.json` & `app-metadata.json` if changed |
| [**Generate Release**](https://github.com/nvbangg/awesome-for-morphe/blob/main/.github/workflows/release.yml) | Daily at 8:00 UTC | Release changelog + Telegram notification |