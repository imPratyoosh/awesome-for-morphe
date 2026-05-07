# Copyright (c) 2026 nvbangg (github.com/nvbangg)

import json
import os

sources_latest = os.path.join("src", "sources-latest.json")
sources_stable = os.path.join("src", "sources-stable.json")
names_path = os.path.join("src", "app-names.json")

all_apps = set()

with open(sources_latest, "r", encoding="utf-8") as f:
    latest = json.load(f)
    for source in latest.values():
        for app in source.get("apps", []):
            all_apps.add(app)

with open(sources_stable, "r", encoding="utf-8") as f:
    stable = json.load(f)
    for source in stable.values():
        for app in source.get("apps", []):
            all_apps.add(app)

with open(names_path, "r", encoding="utf-8") as f:
    app_names = json.load(f)

missing_apps = sorted([app for app in all_apps if app not in app_names])

print(json.dumps(missing_apps, indent=2))
