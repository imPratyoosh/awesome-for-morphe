### [nvbangg/awesome-for-morphe](https://github.com/nvbangg/awesome-for-morphe)

This branch hosts the data and source code for the 🔍 [Awesome for Morphe Website](https://nvbangg.github.io/awesome-for-morphe)

## patch-bundles

The `/patch-bundles` directory can be used as a Morphe patch database, sourced from [ReVanced Patch Bundles](https://github.com/Jman-Github/ReVanced-Patch-Bundles) by Jman:

- [`bundles-stable.json`](patch-bundles/bundles-stable.json) / [`bundles-dev.json`](patch-bundles/bundles-dev.json) — index of all bundles
- `<bundle>-patch-bundles/*-patches-bundle.json` — bundle metadata
- `<bundle>-patch-bundles/*-patches-list.json` — patches list

## Automation

| Workflow | Schedule | What it does |
|---|---|---|
| [**Sync Patch Bundles**](https://github.com/nvbangg/awesome-for-morphe/blob/main/.github/workflows/ci.yml) | Every 4 hours | Sync `/patch-bundles` and update `app-names.json` if changed |
| [**Generate Release**](https://github.com/nvbangg/awesome-for-morphe/blob/main/.github/workflows/release.yml) | Daily at 8:00 UTC | Release changelog + Telegram notification |