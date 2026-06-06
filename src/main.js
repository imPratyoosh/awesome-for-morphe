// Copyright (c) 2026 nvbangg (github.com/nvbangg)

import { createApp, ref, computed, onMounted, watch, reactive } from "https://unpkg.com/vue@3/dist/vue.esm-browser.js";
import { filterRows, getFilterOptions, loadChannelData, normalizeChannel, summarizeRows } from "./data.js";

const DEFAULT_CHANNEL = "stable";
const PRIORITY_ORDER = ['morphe', 'piko', 'rookieenough', 'hoo-dles', 'paresh-maheshwari', 'brosssh', 'patcheddit'];

createApp({
  setup() {
    const query = ref("");
    const patchQuery = ref("");
    const bundle = ref("");
    const app = ref("");
    const channel = ref(DEFAULT_CHANNEL);

    const activeData = ref(null);
    const isLoading = ref(true);
    const errorMsg = ref("");

    const params = new URLSearchParams(location.search);
    query.value = params.get("q") || "";
    patchQuery.value = params.get("qp") || "";
    bundle.value = params.get("bundle") || "";
    app.value = params.get("app") || "";
    channel.value = normalizeChannel(params.get("channel") || DEFAULT_CHANNEL);

    // Sync state to URL on change
    watch([query, patchQuery, bundle, app, channel], () => {
      const params = new URLSearchParams();
      if (query.value) params.set("q", query.value);
      if (patchQuery.value) params.set("qp", patchQuery.value);
      if (bundle.value) params.set("bundle", bundle.value);
      if (app.value) params.set("app", app.value);
      if (channel.value !== DEFAULT_CHANNEL) params.set("channel", channel.value);

      const q = params.toString();
      history.replaceState(null, "", `${location.pathname}${q ? `?${q}` : ""}`);
    });

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
      return filterRows(activeData.value, { query: query.value, patchQuery: patchQuery.value, bundle: bundle.value, app: app.value });
    });

    const filterOptions = computed(() => {
      if (!activeData.value) return { bundleOptions: [], appOptions: [] };

      const rowsForSource = filterRows(activeData.value, { query: query.value, patchQuery: patchQuery.value, bundle: "", app: app.value });
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

      const rowsForApp = filterRows(activeData.value, { query: query.value, patchQuery: patchQuery.value, bundle: bundle.value, app: "" });
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
              const appKey = app.packageName || app.appName || 'any';
              if (!appsMap.has(appKey)) {
                appsMap.set(appKey, app);
              }
            }
          }
          const appsList = Array.from(appsMap.values()).sort((a, b) => {
            const isAnyA = (!a.appName || a.appName === 'Unspecified') ? 1 : 0;
            const isAnyB = (!b.appName || b.appName === 'Unspecified') ? 1 : 0;
            if (isAnyA !== isAnyB) return isAnyA - isAnyB;
            return (a.appName || '').localeCompare(b.appName || '');
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
          const appKey = 'app_' + singleGroup.key + '_' + firstApp.id;
          const isAnyExpanded = singleGroup.appsList.some(a => expandedOptions.has('app_' + singleGroup.key + '_' + a.id));
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
      const clickedKey = 'app_' + groupKey + '_' + clickedApp.id;
      const isCurrentlyExpanded = expandedOptions.has(clickedKey);
      appsList.forEach(a => {
        const key = 'app_' + groupKey + '_' + a.id;
        if (expandedOptions.has(key)) {
          expandedOptions.delete(key);
        }
      });
      if (!isCurrentlyExpanded) {
        expandedOptions.add(clickedKey);
      }
    };

    const toggleBundle = (group) => {
      if (group.appsList && group.appsList.length > 0) {
        const expandedApp = group.appsList.find(a => expandedOptions.has('app_' + group.key + '_' + a.id));
        if (expandedApp) {
          group.appsList.forEach(a => {
            expandedOptions.delete('app_' + group.key + '_' + a.id);
          });
        } else {
          expandedOptions.add('app_' + group.key + '_' + group.appsList[0].id);
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
        const currentIndex = appsList.findIndex(a => a.id === currentApp.id);
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
      if (!repoUrl) return { isGitLab: false, path: "" };
      const isGitLab = repoUrl.includes("gitlab.com");
      const path = repoUrl.split("/").slice(3, 5).join("/");
      return { isGitLab, path };
    };
    const releaseUrl = (s) => {
      if (!s.repo || !s.tag) return "";
      const info = getRepoInfo(s.repo);
      if (info.isGitLab) {
        return `${s.repo}/-/releases/${encodeURIComponent(s.tag)}`;
      }
      return `${s.repo}/releases/tag/${encodeURIComponent(s.tag)}`;
    };
    const morpheUrl = (repoUrl) => {
      const info = getRepoInfo(repoUrl);
      const param = info.isGitLab ? "gitlab" : "github";
      return `https://morphe.software/add-source?${param}=${encodeURI(info.path)}`;
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
      resetFilters,
    };
  },
}).mount("#app");
