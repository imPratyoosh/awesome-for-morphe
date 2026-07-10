// Copyright (c) 2026 nvbangg (github.com/nvbangg)

const CHANNELS = new Set(["stable", "latest"]);
const DEFAULT_CHANNEL = "stable";
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

export function normalizeChannel(channelName) {
  return CHANNELS.has(channelName) ? channelName : DEFAULT_CHANNEL;
}

export function appName(packageName, metadata, skipSet) {
  const key = packageName || "universal";
  const meta = metadata[key];
  if (meta && meta.name) return meta.name;
  if (typeof meta === "string") return meta;

  if (!packageName) return key;

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
  versionList.sort((versionA, versionB) =>
    versionB.version.localeCompare(versionA.version, undefined, { numeric: true, sensitivity: "base" }),
  );

  if (versionList.length === 1) return versionList;

  const mainVersion = versionList.find((versionObj) => !versionObj.isExperimental) || versionList[0];
  return [...versionList.filter((versionObj) => versionObj !== mainVersion), mainVersion];
}

function packages(patch) {
  const compatiblePackages = patch.compatiblePackages;
  if (!compatiblePackages || (typeof compatiblePackages === "object" && Object.keys(compatiblePackages).length === 0)) {
    return [{ packageName: "universal", versions: [] }];
  }

  if (!Array.isArray(compatiblePackages)) {
    return Object.entries(compatiblePackages).map(([packageName, packageVersions]) => ({
      packageName,
      versions: extractVersions(packageVersions),
    }));
  }

  const packageRows = compatiblePackages.flatMap((packageItem) => {
    if (typeof packageItem === "string") return [{ packageName: packageItem, versions: [] }];
    if (packageItem?.packageName)
      return [
        {
          packageName: packageItem.packageName,
          versions: extractVersions(packageItem.versions || packageItem.targets || []),
        },
      ];
    return [];
  });

  return packageRows.length ? packageRows : [{ packageName: "universal", versions: [] }];
}

async function loadSource(key, channelObj, names, sourceInfo, skipSet) {
  const list = await json(new URL(`../data/${channelObj.file}`, import.meta.url)).catch(() => ({}));
  const repo = sourceInfo.repo || "";
  const bundleVersion = channelObj.version || "";
  const bundleCreatedAt = channelObj.createdAt || "";

  return (list.patches || []).flatMap((patch, patchIndex) => {
    const patchId = `${key}:${patchIndex}`;
    return packages(patch).map((target, targetIndex) => {
      const packageName = target.packageName || "";
      const name = appName(packageName, names, skipSet);
      return {
        id: `${patchId}:${targetIndex}`,
        patchId,
        bundleKey: key,
        repo,
        bundleVersion,
        bundleCreatedAt,
        patchName: patch.name || "Unnamed patch",
        description: patch.description || "",
        packageName,
        appName: name,
        appIcon: names[packageName] && names[packageName].iconUrl ? names[packageName].iconUrl : "",
        versions: target.versions,
        enabled: patch.use ?? patch.default ?? true,
        options: Array.isArray(patch.options) ? patch.options : [],
        searchPatchesText: [
          patch.name,
          patch.description,
          ...(Array.isArray(patch.options) ? patch.options : []).flatMap((optionItem) => [
            optionItem.title,
            optionItem.key,
            optionItem.description,
          ]),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      };
    });
  });
}

export async function loadChannelData(channelName, priorityKeys = [], onPatchLoaded) {
  const channel = normalizeChannel(channelName);

  if (dataCache.has(channel)) {
    const cachedData = await dataCache.get(channel);
    if (onPatchLoaded) {
      onPatchLoaded(null);
    }
    return cachedData;
  }

  let resolveCache;
  const cachePromise = new Promise((resolve) => {
    resolveCache = resolve;
  });
  dataCache.set(channel, cachePromise);

  const [names, sources, skipWordsArray] = await Promise.all([
    json(new URL("../data/apps.json", import.meta.url)).catch(() => ({})),
    json(new URL(`../data/bundles.json`, import.meta.url)).catch(() => ({})),
    json(new URL("./skip-words.json", import.meta.url)).catch(() => []),
  ]);

  const skipSet = new Set(skipWordsArray);
  const bundleKeys = Object.keys(sources).sort((a, b) => a.localeCompare(b));

  const bundleList = [];
  const priorityTasks = [];
  const backgroundTasks = [];

  for (const key of bundleKeys) {
    const sourceObj = sources[key];
    let channelObj = sourceObj[channel];
    if (typeof channelObj === "string") {
      channelObj = sourceObj[channelObj];
    }
    if (!channelObj) continue;

    const bundle = {
      key,
      source: sourceObj.source || "github",
      repo: sourceObj.repo || "",
      repoUrl: sourceObj.repoUrl || "",
      deepLink: sourceObj.deepLink || "",
      avatarUrl: sourceObj.avatarUrl || "",
      stars: sourceObj.stars || 0,
      firstSeen: sourceObj.firstSeen || "",
      targetApps: channelObj.targetApps || [],
      appCount: channelObj.appCount || 0,
      patchCount: channelObj.patchCount || 0,
      version: channelObj.version || "",
      releaseUrl: channelObj.releaseUrl || "",
      createdAt: channelObj.createdAt || "",
    };
    bundleList.push(bundle);

    const task = async () => {
      try {
        const rows = await loadSource(key, channelObj, names, sourceObj, skipSet);
        return rows || [];
      } catch (err) {
        console.error(`Failed to load source ${key} for channel ${channel}:`, err);
        return [];
      }
    };

    if (priorityKeys.includes(key)) {
      priorityTasks.push(task);
    } else {
      backgroundTasks.push(task);
    }
  }

  const activeData = {
    channel,
    bundles: bundleList,
    rows: [],
    bundleMap: Object.fromEntries(bundleList.map((bundle) => [bundle.key, bundle])),
    namesMap: names,
    skipSet: skipSet,
  };

  (async () => {
    if (priorityTasks.length > 0) {
      try {
        const priorityResults = await Promise.all(priorityTasks.map((task) => task()));
        const priorityRows = priorityResults.flat();
        activeData.rows.push(...priorityRows);
        if (onPatchLoaded && priorityRows.length > 0) {
          onPatchLoaded(true);
        }
      } catch (e) {
        console.error("Priority load failed", e);
      }
    }

    if (backgroundTasks.length > 0) {
      try {
        const backgroundResults = await Promise.all(backgroundTasks.map((task) => task()));
        const backgroundRows = backgroundResults.flat();
        activeData.rows.push(...backgroundRows);
        if (onPatchLoaded && backgroundRows.length > 0) {
          onPatchLoaded(true);
        }
      } catch (e) {
        console.error("Background load failed", e);
      }
    }

    if (onPatchLoaded) {
      onPatchLoaded(null);
    }
    resolveCache(activeData);
  })();

  return activeData;
}

export function filterRows(data, filters) {
  const searchQueryWords = (filters.query || "").split(/\s+/).map(simplify).filter(Boolean);

  let parsedShowOptions = null;
  if (filters.showOptions && filters.showOptions.length > 0) {
    parsedShowOptions = filters.showOptions.map((showOptionStr) => {
      const parts = showOptionStr.split(":");
      return {
        level: parts.length === 1 ? "bundle" : parts.length === 2 ? "app" : "patch",
        bundle: parts[0],
        app: parts.length >= 2 ? parts[1] : "",
        patch: parts.length > 2 ? parts.slice(2).join(":") : "",
      };
    });
  }

  return data.rows.filter((row) => {
    if (parsedShowOptions) {
      const matched = parsedShowOptions.some((showFilter) => {
        const matchBundle = !showFilter.bundle || row.bundleKey === showFilter.bundle;

        let matchApp = true;
        if (showFilter.app) {
          if (showFilter.app === "universal") {
            matchApp = !row.packageName || row.packageName === "universal";
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

export function getFilterOptions(rows, namesMap = {}) {
  const appMap = new Map();
  const bundleSet = new Set();
  let hasUniversal = false;

  for (const row of rows) {
    bundleSet.add(row.bundleKey);
    if (row.packageName && row.packageName !== "universal") {
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
    const universalName =
      namesMap["universal"] && namesMap["universal"].name ? namesMap["universal"].name : "universal";
    appOptions.unshift({ value: "universal", label: universalName });
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
    if (row.packageName && row.packageName !== "universal") apps.add(row.packageName);
  }
  return { bundles: bundles.size, patches: patches.size, apps: apps.size };
}
