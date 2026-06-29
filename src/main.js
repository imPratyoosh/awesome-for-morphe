// Copyright (c) 2026 nvbangg (github.com/nvbangg)

import {
  createApp,
  ref,
  computed,
  onMounted,
  watch,
  reactive,
  nextTick,
} from "https://unpkg.com/vue@3/dist/vue.esm-browser.js";
import { filterRows, getFilterOptions, loadChannelData, normalizeChannel, summarizeRows } from "./data.js";

const DEFAULT_CHANNEL = "stable";
const PRIORITY_ORDER = [
  "morphe",
  "hoo-dles",
  "rushiranpise",
  "rookieenough",
  "hoomans-morphe",
  "paresh-maheshwari",
  "patcheddit",
];

function tokenize(str) {
  const tokens = [];
  let current = "";
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '"') {
      let quoted = "";
      i++;
      while (i < str.length && str[i] !== '"') {
        quoted += str[i];
        i++;
      }
      tokens.push({ type: 'STRING', value: quoted });
    } else if (['(', ')', ':', ','].includes(char)) {
      if (current.trim()) {
        tokens.push({ type: 'LITERAL', value: current.trim() });
        current = "";
      }
      tokens.push({ type: char });
    } else {
      current += char;
    }
  }
  if (current.trim()) {
    tokens.push({ type: 'LITERAL', value: current.trim() });
  }
  return tokens;
}

function parseShowTrie(str) {
  const tokens = tokenize(str);
  let pos = 0;
  const results = [];

  function parseNode(prefix) {
    if (pos >= tokens.length) return;
    
    if (tokens[pos].type === '(') {
      pos++;
      while (pos < tokens.length && tokens[pos].type !== ')') {
        parseNode(prefix);
        if (pos < tokens.length && tokens[pos].type === ',') {
          pos++;
        }
      }
      if (pos < tokens.length && tokens[pos].type === ')') {
        pos++;
      }
    } else {
      const val = tokens[pos].value;
      pos++;
      const newPrefix = prefix ? prefix + ":" + val : val;
      
      if (pos < tokens.length && tokens[pos].type === ':') {
        pos++;
        parseNode(newPrefix);
      } else {
        results.push(newPrefix);
      }
    }
  }

  while (pos < tokens.length) {
    parseNode("");
    if (pos < tokens.length && tokens[pos].type === ',') {
      pos++;
    }
  }

  return results;
}

function formatPatchStr(p) {
  if (p.includes(':') || p.includes(',') || p.includes('(') || p.includes(')')) {
    return `"${p}"`;
  }
  return p;
}

function buildShowTrie(flatList) {
  const root = {};
  for (const item of flatList) {
    const parts = item.split(":");
    let bundle = parts[0];
    let app = parts.length > 1 ? parts[1] : null;
    let patch = parts.length > 2 ? parts.slice(2).join(":") : null;

    if (!root[bundle]) root[bundle] = { _apps: {} };
    if (app !== null) {
      if (!root[bundle]._apps[app]) root[bundle]._apps[app] = { _patches: [] };
      if (patch !== null) {
        root[bundle]._apps[app]._patches.push(patch);
      }
    }
  }

  const bundleStrs = [];
  for (const [bundle, bNode] of Object.entries(root)) {
    const apps = Object.entries(bNode._apps);
    if (apps.length === 0) {
      bundleStrs.push(bundle);
    } else {
      const appStrs = [];
      for (const [app, aNode] of apps) {
        const patches = aNode._patches;
        if (patches.length === 0) {
          appStrs.push(app);
        } else if (patches.length === 1) {
          appStrs.push(`${app}:${formatPatchStr(patches[0])}`);
        } else {
          const pStrs = patches.map(formatPatchStr);
          appStrs.push(`${app}:(${pStrs.join(',')})`);
        }
      }
      if (appStrs.length === 1) {
        bundleStrs.push(`${bundle}:${appStrs[0]}`);
      } else {
        bundleStrs.push(`${bundle}:(${appStrs.join(',')})`);
      }
    }
  }
  return bundleStrs.join(',');
}

createApp({
  setup() {
    const query = ref("");
    const patchQuery = ref("");
    const bundle = ref("");
    const app = ref("");
    const showOptions = ref([]);
    const channel = ref(DEFAULT_CHANNEL);

    const activeData = ref(null);
    const isLoading = ref(true);
    const errorMsg = ref("");

    const params = new URLSearchParams(location.search);
    query.value = params.get("q") || "";
    patchQuery.value = params.get("qp") || "";
    channel.value = normalizeChannel(params.get("channel") || DEFAULT_CHANNEL);

    function parseShowParam() {
      const search = location.search.substring(1);
      if (!search) return [];
      
      const pairs = search.split("&");
      let rawParam = "";
      for (const pair of pairs) {
        const [key, value] = pair.split("=");
        if (key === "show" && value) {
          rawParam = value;
        }
      }
      if (!rawParam) return [];
      return parseShowTrie(decodeURIComponent(rawParam));
    }

    let bParam = params.get("bundle");
    let aParam = params.get("app");
    let showArr = [];
    if (bParam || aParam) {
      showArr = [`${bParam || ""}${aParam ? ":" + aParam : ""}`];
    } else {
      showArr = parseShowParam();
    }
    showOptions.value = showArr;

    let initBundle = "", initApp = "";
    if (showArr.length === 1) {
      const parts = showArr[0].split(":");
      if (parts.length === 1) {
        initBundle = parts[0];
      } else if (parts.length === 2) {
        initBundle = parts[0];
        initApp = parts[1];
      }
    }
    bundle.value = initBundle;
    app.value = initApp;

    watch([bundle, app], () => {
      if (bundle.value || app.value) {
        showOptions.value = [`${bundle.value || ""}${app.value ? ":" + app.value : ""}`];
      } else {
        showOptions.value = [];
      }
    });

    // Sync state to URL on change
    watch([query, patchQuery, showOptions, channel], () => {
      const urlParts = [];
      if (query.value) urlParts.push(`q=${encodeURIComponent(query.value)}`);
      if (patchQuery.value) urlParts.push(`qp=${encodeURIComponent(patchQuery.value)}`);
      
      if (showOptions.value.length > 0) {
        const showStr = buildShowTrie(showOptions.value);
        const encodedShow = encodeURIComponent(showStr)
          .replace(/%3A/g, ':')
          .replace(/%2C/g, ',')
          .replace(/%28/g, '(')
          .replace(/%29/g, ')');
        urlParts.push(`show=${encodedShow}`);
      }
      if (channel.value !== DEFAULT_CHANNEL) urlParts.push(`channel=${channel.value}`);

      const q = urlParts.join("&");
      history.replaceState(null, "", `${location.pathname}${q ? `?${q}` : ""}`);
    }, { immediate: true });

    const loadData = async () => {
      isLoading.value = true;
      errorMsg.value = "";
      try {
        activeData.value = await loadChannelData(channel.value);
      } catch (err) {
        errorMsg.value = err.message || err;
      } finally {
        isLoading.value = false;
      }
    };

    onMounted(loadData);
    watch(channel, loadData);

    const filteredRows = computed(() => {
      if (!activeData.value) return [];
      return filterRows(activeData.value, {
        query: query.value,
        patchQuery: patchQuery.value,
        showOptions: showOptions.value,
      });
    });

    const filterOptions = computed(() => {
      if (!activeData.value) return { bundleOptions: [], appOptions: [] };

      const rowsForSource = filterRows(activeData.value, {
        query: query.value,
        patchQuery: patchQuery.value,
        showOptions: app.value ? [`:${app.value}`] : [],
      });
      let bundleOptions = getFilterOptions(rowsForSource).bundleOptions;

      bundleOptions = [...bundleOptions].sort((a, b) => {
        const indexA = PRIORITY_ORDER.indexOf(a.value);
        const indexB = PRIORITY_ORDER.indexOf(b.value);
        if (indexA !== -1 && indexB !== -1) {
          return indexA - indexB;
        }
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        return a.value.localeCompare(b.value);
      });

      const rowsForApp = filterRows(activeData.value, {
        query: query.value,
        patchQuery: patchQuery.value,
        showOptions: bundle.value ? [bundle.value] : [],
      });
      const appOptions = getFilterOptions(rowsForApp).appOptions;

      return { bundleOptions, appOptions };
    });

    const stats = computed(() => summarizeRows(filteredRows.value));

    // Grouping for View
    const bundlesGroups = computed(() => {
      const map = new Map();
      for (const row of filteredRows.value) {
        if (!map.has(row.bundleKey)) map.set(row.bundleKey, []);
        map.get(row.bundleKey).push(row);
      }
      return Array.from(map.entries())
        .sort(([a], [b]) => {
          const indexA = PRIORITY_ORDER.indexOf(a);
          const indexB = PRIORITY_ORDER.indexOf(b);
          if (indexA !== -1 && indexB !== -1) {
            return indexA - indexB;
          }
          if (indexA !== -1) return -1;
          if (indexB !== -1) return 1;
          return a.localeCompare(b);
        })
        .map(([key, rows]) => {
          const patchMap = new Map();
          for (const row of rows) {
            if (!patchMap.has(row.patchId)) {
              patchMap.set(row.patchId, {
                id: row.patchId,
                patchName: row.patchName,
                description: row.description,
                enabled: row.enabled,
                options: row.options || [],
                apps: [],
              });
            }
            if (row.packageName || row.appName) {
              patchMap.get(row.patchId).apps.push({
                id: row.id,
                appName: row.appName,
                packageName: row.packageName,
                versions: row.versions,
              });
            }
          }
          const patches = Array.from(patchMap.values()).sort((a, b) => a.patchName.localeCompare(b.patchName));
          const appsMap = new Map();
          for (const p of patches) {
            for (const app of p.apps) {
              const appKey = app.packageName || app.appName || "any";
              if (!appsMap.has(appKey)) {
                appsMap.set(appKey, app);
              }
            }
          }
          const appsList = Array.from(appsMap.values()).sort((a, b) => {
            const isAnyA = !a.appName || a.appName === "Unspecified" ? 1 : 0;
            const isAnyB = !b.appName || b.appName === "Unspecified" ? 1 : 0;
            if (isAnyA !== isAnyB) return isAnyA - isAnyB;
            return (a.appName || "").localeCompare(b.appName || "");
          });
          return {
            key,
            bundle: activeData.value.bundleMap[key],
            rows,
            patches,
            appsList,
          };
        });
    });

    watch(bundlesGroups, (newGroups) => {
      if (newGroups && newGroups.length === 1) {
        const singleGroup = newGroups[0];
        if (singleGroup.appsList && singleGroup.appsList.length > 0) {
          const firstApp = singleGroup.appsList[0];
          const appKey = "app_" + singleGroup.key + "_" + firstApp.id;
          const isAnyExpanded = singleGroup.appsList.some((a) =>
            expandedOptions.has("app_" + singleGroup.key + "_" + a.id),
          );
          if (!isAnyExpanded) {
            expandedOptions.add(appKey);
          }
        }
      }
    });

    const expandedVersions = reactive(new Set());
    const toggleVersions = (id) => {
      expandedVersions.has(id) ? expandedVersions.delete(id) : expandedVersions.add(id);
    };

    const expandedOptions = reactive(new Set());
    const toggleOptions = (id) => {
      expandedOptions.has(id) ? expandedOptions.delete(id) : expandedOptions.add(id);
    };

    const activeSwipeGroup = ref("");
    const swipeDirection = ref("");

    const selectApp = (groupKey, clickedApp, appsList) => {
      activeSwipeGroup.value = "";
      swipeDirection.value = "";
      const clickedKey = "app_" + groupKey + "_" + clickedApp.id;
      const isCurrentlyExpanded = expandedOptions.has(clickedKey);
      appsList.forEach((a) => {
        const key = "app_" + groupKey + "_" + a.id;
        if (expandedOptions.has(key)) {
          expandedOptions.delete(key);
        }
      });
      if (!isCurrentlyExpanded) {
        expandedOptions.add(clickedKey);
        nextTick(() => {
          const btn = document.getElementById("tab_" + groupKey + "_" + clickedApp.id);
          if (btn) {
            btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
          }
        });
      }
    };

    const toggleBundle = (group) => {
      if (group.appsList && group.appsList.length > 0) {
        const expandedApp = group.appsList.find((a) => expandedOptions.has("app_" + group.key + "_" + a.id));
        if (expandedApp) {
          group.appsList.forEach((a) => {
            expandedOptions.delete("app_" + group.key + "_" + a.id);
          });
        } else {
          expandedOptions.add("app_" + group.key + "_" + group.appsList[0].id);
        }
      }
    };

    const touchStartX = ref(0);
    const touchStartY = ref(0);

    const handleTouchStart = (e) => {
      if (e.touches && e.touches.length > 0) {
        touchStartX.value = e.touches[0].clientX;
        touchStartY.value = e.touches[0].clientY;
      }
    };

    const handleTouchEnd = (e, groupKey, currentApp, appsList) => {
      if (!e.changedTouches || e.changedTouches.length === 0) return;
      const deltaX = e.changedTouches[0].clientX - touchStartX.value;
      const deltaY = e.changedTouches[0].clientY - touchStartY.value;
      if (Math.abs(deltaX) > 60 && Math.abs(deltaY) < 40) {
        const currentIndex = appsList.findIndex((a) => a.id === currentApp.id);
        if (currentIndex !== -1) {
          if (deltaX < 0) {
            if (currentIndex < appsList.length - 1) {
              activeSwipeGroup.value = groupKey;
              swipeDirection.value = "left";
              selectApp(groupKey, appsList[currentIndex + 1], appsList);
            }
          } else {
            if (currentIndex > 0) {
              activeSwipeGroup.value = groupKey;
              swipeDirection.value = "right";
              selectApp(groupKey, appsList[currentIndex - 1], appsList);
            }
          }
        }
      }
    };

    const filterByApp = (pkg) => {
      app.value = pkg;
    };

    const formatDate = (val) => {
      const d = val ? new Date(val) : null;
      return d && !isNaN(d.getTime())
        ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        : "";
    };
    const countBy = (items, keyFn) => new Set(items.map(keyFn).filter(Boolean)).size;
    const playUrl = (pkg) => `https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}`;
    const getRepoInfo = (repoUrl) => {
      if (!repoUrl) return { path: "" };
      const path = repoUrl.split("/").slice(3, 5).join("/");
      return { path };
    };
    const getPlatform = (repoUrl) => {
      if (!repoUrl) return "";
      if (repoUrl.includes("github.com")) return "github";
      if (repoUrl.includes("gitlab.com")) return "gitlab";
      return "";
    };
    const getPlatformMeta = (repoUrl) => {
      const platform = getPlatform(repoUrl);
      const metas = {
        gitlab: {
          icon: "fa-brands fa-gitlab",
          color: "text-[#FC6D26] hover:text-[#e24329]",
          label: "GitLab",
        },
        github: {
          icon: "fa-brands fa-github",
          color: "text-white hover:text-blue",
          label: "GitHub",
        },
      };
      return (
        metas[platform] || {
          icon: "fa-solid fa-globe",
          color: "text-gray-400 hover:text-white",
          label: "Repository",
        }
      );
    };
    const releaseUrl = (s) => {
      if (!s.repo || !s.tag) return "";
      const platform = getPlatform(s.repo);
      if (platform === "gitlab") {
        return `${s.repo}/-/releases/${encodeURIComponent(s.tag)}`;
      } else if (platform === "github") {
        return `${s.repo}/releases/tag/${encodeURIComponent(s.tag)}`;
      }
      return `${s.repo}/releases`;
    };
    const morpheUrl = (repoUrl) => {
      const platform = getPlatform(repoUrl);
      if (!platform) return null;
      const info = getRepoInfo(repoUrl);
      return `https://morphe.software/add-source?${platform}=${encodeURI(info.path)}`;
    };

    const resetFilters = () => {
      query.value = "";
      patchQuery.value = "";
      bundle.value = "";
      app.value = "";
      expandedOptions.clear();
      expandedVersions.clear();
    };

    return {
      query,
      patchQuery,
      bundle,
      app,
      channel,
      isLoading,
      errorMsg,
      stats,
      filterOptions,
      bundlesGroups,
      expandedVersions,
      toggleVersions,
      expandedOptions,
      toggleOptions,
      selectApp,
      toggleBundle,
      activeSwipeGroup,
      swipeDirection,
      handleTouchStart,
      handleTouchEnd,
      filterByApp,
      formatDate,
      countBy,
      playUrl,
      releaseUrl,
      morpheUrl,
      getPlatformMeta,
      resetFilters,
    };
  },
}).mount("#app");
