// Copyright (c) 2026 nvbangg (github.com/nvbangg)

const jsonCache = new Map();
const dataCache = new Map();

const simplifyString = (inputString) =>
  (inputString || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

export async function fetchJson(url) {
  const key = url.toString();
  if (!jsonCache.has(key)) {
    const fetchPromise = fetch(url, { cache: "no-cache" }).then((response) => {
      if (!response.ok) throw new Error(`Failed to load ${new URL(url).pathname}: ${response.status}`);
      return response.json();
    });
    jsonCache.set(key, fetchPromise);
  }
  return jsonCache.get(key);
}

export function buildBundleUrls(source, repo) {
  if (!repo) return { repoUrl: "", deepLink: "", changelogUrl: "" };

  const repoUrl = `https://${source}.com/${repo}`;
  return {
    repoUrl,
    deepLink: `https://morphe.software/add-source?${source}=${repo}`,
    changelogUrl: source === "gitlab" ? `${repoUrl}/-/releases` : `${repoUrl}/releases`,
  };
}

export function appName(packageName, metadata, skipSet) {
  const key = packageName || "universal";
  const meta = metadata[key];

  if (meta?.name) return meta.name;
  if (typeof meta === "string") return meta;
  if (!packageName) return key;

  const skip = skipSet || new Set();
  const parts = packageName.split(".").filter((part) => part.length > 1 && !skip.has(part));
  const last = parts.at(-1) || packageName.split(".").at(-1) || packageName;

  return last.replace(/[-_]/g, " ").replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

function extractVersions(value) {
  if (!Array.isArray(value)) return [];

  return value
    .flatMap((item) => {
      if (typeof item === "string") return [{ version: item, isExperimental: false }];
      if (item?.version) return [{ version: String(item.version), isExperimental: !!item.isExperimental }];
      return [];
    })
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true, sensitivity: "base" }));
}

function packages(patch) {
  const compatiblePackages = patch.compatiblePackages;
  const universalResult = [{ packageName: "universal", versions: [], isPreRelease: false }];

  if (!Array.isArray(compatiblePackages)) return universalResult;

  const packageRows = compatiblePackages.flatMap((item) =>
    item?.packageName ? [{ packageName: item.packageName, isPreRelease: !!item.isPreRelease, versions: extractVersions(item.targets || []) }] : [],
  );

  return packageRows.length ? packageRows : universalResult;
}

async function loadSource(bundleKey, bundleObj, namesMap, skipSet) {
  if (!bundleObj.patches) return [];
  const listUrl = new URL(`../${bundleObj.patches}`, import.meta.url);
  const list = await fetchJson(listUrl).catch(() => null);

  const repo = bundleObj.repo || "";
  const bundleVersion = bundleObj.version || "";
  const bundleCreatedAt = bundleObj.createdAt || "";

  return (list || []).flatMap((patch, patchIndex) => {
    const patchId = `${bundleKey}:${patchIndex}`;

    return packages(patch).map((target, targetIndex) => {
      const packageName = target.packageName || "";
      const name = appName(packageName, namesMap, skipSet);
      const options = Array.isArray(patch.options) ? patch.options : [];

      const searchPatchesTextParts = [patch.name, patch.description];
      options.forEach((option) => searchPatchesTextParts.push(option.title, option.key, option.description));
      const searchPatchesText = searchPatchesTextParts.filter(Boolean).join(" ").toLowerCase();

      return {
        id: `${patchId}:${targetIndex}`,
        patchId,
        bundleKey,
        repo,
        bundleVersion,
        bundleCreatedAt,
        patchName: patch.name || "Unnamed patch",
        description: patch.description || "",
        packageName,
        appName: name,
        appIcon: namesMap[packageName]?.iconUrl || "",
        isBundlePreRelease: !!bundleObj.isPreRelease,
        isAppPreRelease: !!target.isPreRelease,
        isPatchPreRelease: !!patch.isPreRelease,
        versions: target.versions,
        enabled: patch.use ?? patch.default ?? true,
        options,
        searchPatchesText,
      };
    });
  });
}

export async function loadInitialData(priorityKeys = [], onPatchLoaded) {
  if (dataCache.has("latest")) {
    const cachedData = await dataCache.get("latest");
    if (onPatchLoaded) onPatchLoaded(null);
    return cachedData;
  }

  let resolveCache;
  const cachePromise = new Promise((resolve) => {
    resolveCache = resolve;
  });
  dataCache.set("latest", cachePromise);

  const [namesMap, sources, skipWordsArray] = await Promise.all([
    fetchJson(new URL("../apps.json", import.meta.url)).catch(() => ({})),
    fetchJson(new URL(`../bundles.json`, import.meta.url)).catch(() => ({})),
    fetchJson(new URL("./skip-words.json", import.meta.url)).catch(() => []),
  ]);

  const skipSet = new Set(skipWordsArray);
  const bundleKeys = Object.keys(sources).sort((firstItem, secondItem) => firstItem.localeCompare(secondItem));

  const bundleList = [];
  const priorityTasks = [];
  const backgroundTasks = [];

  for (const key of bundleKeys) {
    const bundleObj = sources[key];
    if (!bundleObj.patches) continue;

    bundleObj.key = key;
    const urls = buildBundleUrls(bundleObj.source, bundleObj.repo);
    bundleObj.repoUrl = urls.repoUrl;
    bundleObj.deepLink = urls.deepLink;
    bundleObj.changelogUrl = urls.changelogUrl;

    bundleList.push(bundleObj);

    const task = async () => {
      try {
        const rows = await loadSource(key, bundleObj, namesMap, skipSet);
        return rows || [];
      } catch (error) {
        console.error(`Failed to load source ${key}:`, error);
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
    bundles: bundleList,
    rows: [],
    bundleMap: Object.fromEntries(bundleList.map((bundle) => [bundle.key, bundle])),
    namesMap,
    skipSet,
  };

  (async () => {
    const executeTasks = async (tasks, isPriority) => {
      if (!tasks.length) return;
      try {
        const results = await Promise.all(tasks.map((task) => task()));
        const rows = results.flat();
        activeData.rows.push(...rows);
        if (onPatchLoaded && rows.length > 0) onPatchLoaded(true);
      } catch (error) {
        console.error(`${isPriority ? "Priority" : "Background"} load failed`, error);
      }
    };

    await executeTasks(priorityTasks, true);
    await executeTasks(backgroundTasks, false);

    if (onPatchLoaded) onPatchLoaded(null);
    resolveCache(activeData);
  })();

  return activeData;
}

export function filterRows(data, filters) {
  const searchQueryWords = (filters.query || "").split(/\s+/).map(simplifyString).filter(Boolean);

  let parsedShowOptions = null;
  if (filters.showOptions?.length > 0) {
    parsedShowOptions = filters.showOptions.map((showOption) => {
      const parts = showOption.split(":");
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
        if (showFilter.bundle && row.bundleKey !== showFilter.bundle) return false;

        if (showFilter.app) {
          const appMatch = showFilter.app === "universal" ? !row.packageName || row.packageName === "universal" : row.packageName === showFilter.app;
          if (!appMatch) return false;
        }

        if (showFilter.patch && row.patchName !== showFilter.patch) return false;

        return true;
      });
      if (!matched) return false;
    }

    if (searchQueryWords.length > 0) {
      const searchTarget = simplifyString(row.searchPatchesText);
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

  const appOptions = Array.from(appMap.entries())
    .map(([value, { label, icon }]) => ({ value, label, icon }))
    .sort((appA, appB) => appA.label.localeCompare(appB.label) || appA.value.localeCompare(appB.value));

  if (hasUniversal) {
    appOptions.unshift({
      value: "universal",
      label: namesMap["universal"]?.name || "universal",
    });
  }

  return {
    bundleOptions: Array.from(bundleSet)
      .sort((firstItem, secondItem) => firstItem.localeCompare(secondItem))
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

export function getFilterOptionsFromBundles(bundles, namesMap = {}, skipSet = new Set()) {
  const appMap = new Map();
  const bundleSet = new Set();
  let hasUniversal = false;

  for (const bundle of bundles) {
    bundleSet.add(bundle.key);
    if (bundle.targetApps) {
      for (const packageName of bundle.targetApps) {
        if (packageName !== "universal") {
          if (!appMap.has(packageName)) {
            appMap.set(packageName, {
              label: appName(packageName, namesMap, skipSet),
              icon: namesMap[packageName]?.iconUrl || "",
            });
          }
        } else {
          hasUniversal = true;
        }
      }
    }
  }

  const appOptions = Array.from(appMap.entries())
    .map(([value, { label, icon }]) => ({ value, label, icon }))
    .sort((appA, appB) => appA.label.localeCompare(appB.label) || appA.value.localeCompare(appB.value));

  if (hasUniversal) {
    appOptions.unshift({
      value: "universal",
      label: namesMap["universal"]?.name || "universal",
    });
  }

  return {
    bundleOptions: Array.from(bundleSet)
      .sort((firstItem, secondItem) => firstItem.localeCompare(secondItem))
      .map((value) => ({ value, label: value })),
    appOptions,
  };
}
