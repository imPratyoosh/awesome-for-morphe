// Copyright (c) 2026 nvbangg (github.com/nvbangg)

const CHANNELS = new Set(["stable", "latest", "dev"]);
const DEFAULT_CHANNEL = "latest";
const jsonCache = new Map();
const dataCache = new Map();
const simplify = (text) =>
  (text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

async function json(url) {
  const key = url.toString();
  if (!jsonCache.has(key)) {
    jsonCache.set(
      key,
      fetch(url, { cache: "no-cache" }).then((response) => {
        if (!response.ok) throw new Error(`Failed to load ${url.pathname}: ${response.status}`);
        return response.json();
      }),
    );
  }
  return jsonCache.get(key);
}

export function normalizeChannel(channel) {
  return CHANNELS.has(channel) ? channel : DEFAULT_CHANNEL;
}

function appName(packageName, metadata, skipSet) {
  if (!packageName) return "Unspecified";
  const meta = metadata[packageName];
  if (meta && meta.name) return meta.name;
  if (typeof meta === "string") return meta;

  const skip = skipSet || new Set();
  const parts = packageName.split(".").filter((part) => part.length > 1 && !skip.has(part));
  const last = parts.at(-1) || packageName.split(".").at(-1) || packageName;
  return last.replace(/[-_]/g, " ").replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function extractVersions(value) {
  if (!Array.isArray(value)) return [];
  const versionList = value.flatMap((item) => {
    if (typeof item === "string") return [{ version: item, isExperimental: false }];
    if (item?.version) return [{ version: String(item.version), isExperimental: !!item.isExperimental }];
    return [];
  });

  if (!versionList.length) return [];
  versionList.sort((versionA, versionB) => versionB.version.localeCompare(versionA.version, undefined, { numeric: true, sensitivity: "base" }));

  if (versionList.length === 1) return versionList;

  const mainVersion = versionList.find((versionObj) => !versionObj.isExperimental) || versionList[0];
  return [...versionList.filter((versionObj) => versionObj !== mainVersion), mainVersion];
}

function packages(patch) {
  const compatiblePackages = patch.compatiblePackages;
  if (!compatiblePackages || (typeof compatiblePackages === "object" && Object.keys(compatiblePackages).length === 0)) {
    return [{ packageName: "", versions: [] }];
  }

  if (!Array.isArray(compatiblePackages)) {
    return Object.entries(compatiblePackages).map(([packageName, packageVersions]) => ({ packageName, versions: extractVersions(packageVersions) }));
  }

  const packageRows = compatiblePackages.flatMap((packageItem) => {
    if (typeof packageItem === "string") return [{ packageName: packageItem, versions: [] }];
    if (packageItem?.packageName)
      return [{ packageName: packageItem.packageName, versions: extractVersions(packageItem.versions || packageItem.targets || []) }];
    return [];
  });

  return packageRows.length ? packageRows : [{ packageName: "", versions: [] }];
}

async function loadSource(key, channel, names, sources, skipSet) {
  const listPromise = json(
    new URL(`../data/patch-bundles/${key}-patch-bundles/${key}-${channel}-patches-list.json`, import.meta.url),
  );
  const bundleMetaPromise = json(
    new URL(`../data/patch-bundles/${key}-patch-bundles/${key}-${channel}-patches-bundle.json`, import.meta.url),
  ).catch(() => ({}));

  const [list, meta] = await Promise.all([listPromise, bundleMetaPromise]);
  const sourceInfo = sources[key] || {};

  const bundle = {
    key,
    repo: sourceInfo.repo || "",
    avatarUrl: sourceInfo.avatarUrl || "",
    version: list.version || meta.version || "",
    tag: meta.version || "",
    createdAt: meta.created_at || "",
  };

  const rows = (list.patches || []).flatMap((patch, patchIndex) => {
    const patchId = `${key}:${patchIndex}`;
    return packages(patch).map((target, targetIndex) => {
      const packageName = target.packageName || "";
      const name = appName(packageName, names, skipSet);

      return {
        id: `${patchId}:${targetIndex}`,
        patchId,
        bundleKey: key,
        repo: bundle.repo,
        bundleVersion: bundle.version,
        bundleCreatedAt: bundle.createdAt,
        patchName: patch.name || "Unnamed patch",
        description: patch.description || "",
        packageName,
        appName: name,
        appIcon: (names[packageName] && names[packageName].icon) ? names[packageName].icon : "",
        versions: target.versions,
        enabled: patch.use ?? patch.default ?? true,
        options: Array.isArray(patch.options) ? patch.options : [],
        searchAppsText: [key, bundle.repo, packageName, name].filter(Boolean).join(" ").toLowerCase(),
        searchPatchesText: [
          patch.name,
          patch.description,
          ...(Array.isArray(patch.options) ? patch.options : []).flatMap((opt) => [
            opt.title,
            opt.key,
            opt.description,
          ]),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      };
    });
  });

  return { bundle, rows };
}

export async function loadChannelData(channelInput) {
  const channel = normalizeChannel(channelInput);
  if (dataCache.has(channel)) return dataCache.get(channel);

  const promise = Promise.all([
    json(new URL("../data/app-metadata.json", import.meta.url)).catch(() => ({})),
    json(new URL(`../data/bundles-${channel}.json`, import.meta.url)).catch(() => ({})),
    json(new URL("./skip-words.json", import.meta.url)).catch(() => []),
  ]).then(async ([names, sources, skipWordsArray]) => {
    const skipSet = new Set(skipWordsArray);
    const bundleKeys = Object.keys(sources);

    const loaded = await Promise.all(
      bundleKeys
        .sort((a, b) => a.localeCompare(b))
        .map((key) =>
          loadSource(key, channel, names, sources, skipSet).catch((err) => {
            console.error(`Failed to load source ${key} for channel ${channel}:`, err);
            return null;
          }),
        ),
    );
    const validLoaded = loaded.filter(Boolean);
    const bundleList = validLoaded.map((item) => item.bundle);

    return {
      channel,
      bundles: bundleList,
      rows: validLoaded.flatMap((item) => item.rows),
      bundleMap: Object.fromEntries(bundleList.map((bundle) => [bundle.key, bundle])),
    };
  });

  dataCache.set(channel, promise);
  return promise;
}

export function filterRows(data, filters) {
  const searchQueryWords = (filters.query || "").split(/\s+/).map(simplify).filter(Boolean);

  let parsedShowOptions = null;
  if (filters.showOptions && filters.showOptions.length > 0) {
    parsedShowOptions = filters.showOptions.map(showOptionStr => {
      const parts = showOptionStr.split(":");
      return {
        level: parts.length === 1 ? "bundle" : parts.length === 2 ? "app" : "patch",
        bundle: parts[0],
        app: parts.length >= 2 ? parts[1] : "",
        patch: parts.length > 2 ? parts.slice(2).join(":") : ""
      };
    });
  }

  return data.rows.filter((row) => {
    if (parsedShowOptions) {
      const matched = parsedShowOptions.some(showFilter => {
        const matchBundle = !showFilter.bundle || row.bundleKey === showFilter.bundle;
        
        let matchApp = true;
        if (showFilter.app) {
          if (showFilter.app === "universal") {
            matchApp = !row.packageName;
          } else {
            matchApp = row.packageName === showFilter.app;
          }
        }
        
        const matchPatch = !showFilter.patch || row.patchName === showFilter.patch;

        if (showFilter.level === "bundle") return matchBundle;
        if (showFilter.level === "app") return matchBundle && matchApp;
        return matchBundle && matchApp && matchPatch;
      });
      if (!matched) return false;
    }

    if (searchQueryWords.length > 0) {
      const searchTarget = simplify(row.searchPatchesText);
      if (!searchQueryWords.every((searchWord) => searchTarget.includes(searchWord))) return false;
    }
    return true;
  });
}

export function getFilterOptions(rows) {
  const appMap = new Map();
  const bundleSet = new Set();
  let hasUniversal = false;

  for (const row of rows) {
    bundleSet.add(row.bundleKey);
    if (row.packageName) {
      if (!appMap.has(row.packageName)) {
        appMap.set(row.packageName, { label: row.appName, icon: row.appIcon });
      }
    } else {
      hasUniversal = true;
    }
  }

  const appOptions = [...appMap]
    .map(([value, { label, icon }]) => ({ value, label, icon }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));

  if (hasUniversal) {
    appOptions.unshift({ value: "universal", label: "Any app" });
  }

  return {
    bundleOptions: Array.from(bundleSet)
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value })),
    appOptions,
  };
}

export function summarizeRows(rows) {
  const bundles = new Set();
  const patches = new Set();
  const apps = new Set();
  for (const row of rows) {
    bundles.add(row.bundleKey);
    patches.add(row.patchId);
    if (row.packageName) apps.add(row.packageName);
  }
  return { bundles: bundles.size, patches: patches.size, apps: apps.size };
}
