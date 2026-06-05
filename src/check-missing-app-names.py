# Copyright (c) 2026 nvbangg (github.com/nvbangg)

import json
import os

bundles_dev = os.path.join("src", "bundles-dev.json")
bundles_stable = os.path.join("src", "bundles-stable.json")
names_path = os.path.join("src", "app-names.json")

all_apps = set()

with open(bundles_dev, "r", encoding="utf-8") as f:
    dev = json.load(f)
    for bundle in dev.values():
        for app in bundle.get("apps", []):
            all_apps.add(app)

with open(bundles_stable, "r", encoding="utf-8") as f:
    stable = json.load(f)
    for bundle in stable.values():
        for app in bundle.get("apps", []):
            all_apps.add(app)

with open(names_path, "r", encoding="utf-8") as f:
    app_names = json.load(f)

missing_apps = sorted([app for app in all_apps if app not in app_names])

print(json.dumps(missing_apps, indent=2))
