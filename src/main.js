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
import { filterRows, getFilterOptions, loadChannelData, normalizeChannel, summarizeRows, appName } from "./data.js";

const DEFAULT_CHANNEL = "stable";

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
      tokens.push({ type: "STRING", value: quoted });
    } else if (["(", ")", ":", ","].includes(char)) {
      if (current.trim()) {
        tokens.push({ type: "LITERAL", value: current.trim() });
        current = "";
      } else if (char === ":") {
        tokens.push({ type: "LITERAL", value: "" });
      }
      tokens.push({ type: char });
    } else {
      current += char;
    }
  }
  if (current.trim()) {
    tokens.push({ type: "LITERAL", value: current.trim() });
  }
  return tokens;
}

function parseShowTrie(str) {
  const tokens = tokenize(str);
  let pos = 0;
  const results = [];

  function parseNode(prefix) {
    if (pos >= tokens.length) return;

    if (tokens[pos].type === "(") {
      pos++;
      while (pos < tokens.length && tokens[pos].type !== ")") {
        parseNode(prefix);
        if (pos < tokens.length && tokens[pos].type === ",") {
          pos++;
        }
      }
      if (pos < tokens.length && tokens[pos].type === ")") {
        pos++;
      }
    } else {
      const val = tokens[pos].value;
      pos++;
      const newPrefix = prefix !== null && prefix !== undefined ? prefix + ":" + val : val;

      if (pos < tokens.length && tokens[pos].type === ":") {
        pos++;
        parseNode(newPrefix);
      } else {
        results.push(newPrefix);
      }
    }
  }

  while (pos < tokens.length) {
    parseNode(null);
    if (pos < tokens.length && tokens[pos].type === ",") {
      pos++;
    }
  }

  return results;
}

createApp({
  setup() {
    const query = ref("");
    const bundle = ref("");
    const app = ref("");
    const appSearch = ref("");
    const bundleSearch = ref("");
    const showOptions = ref([]);
    const channel = ref(DEFAULT_CHANNEL);
    const sortOrder = ref("stars");
    const isTwoColumns = ref(new URLSearchParams(location.search).get("view") !== "list");

    const activeData = ref(null);
    const isLoading = ref(true);
    const patchesLoaded = ref(false);
    const errorMsg = ref("");


    const initialParams = new URLSearchParams(location.search);
    const priorityKeys = new Set();
    if (initialParams.get('show')) {
      initialParams.get('show').split(',').forEach((p) => {
        const key = p.split(':')[0];
        if (key) priorityKeys.add(key);
      });
    }

    const isChangelogView = ref(false);
    const changelogHighlights = ref([]);

    function syncFromUrl(searchStr) {
      const params = new URLSearchParams(searchStr);
      
      const newQuery = params.get("q") || "";
      if (query.value !== newQuery) query.value = newQuery;

      const newChannel = normalizeChannel(params.get("channel") || DEFAULT_CHANNEL);
      if (channel.value !== newChannel) channel.value = newChannel;

      const newSortOrder = params.get("sort") || "stars";
      if (sortOrder.value !== newSortOrder) sortOrder.value = newSortOrder;

      const rawParam = params.get("show");
      let showArr = [];
      let bundleParam = params.get("bundle");
      let appParam = params.get("app");
      
      if (bundleParam || appParam) {
        showArr = [`${bundleParam || ""}${appParam ? ":" + appParam : ""}`];
      } else if (rawParam) {
        showArr = parseShowTrie(decodeURIComponent(rawParam));
      }
      
      if (JSON.stringify(showOptions.value) !== JSON.stringify(showArr)) {
        showOptions.value = showArr;
      }
      
      let initBundle = "", initApp = "";
      if (showArr.length > 0) {
        const parsed = showArr.map((item) => {
          const parts = item.split(":");
          return { bundle: parts[0] || "", app: parts[1] || "" };
        });
        const firstBundle = parsed[0].bundle;
        if (parsed.every((p) => p.bundle === firstBundle)) initBundle = firstBundle;
        const firstApp = parsed[0].app;
        if (parsed.every((p) => p.app === firstApp)) initApp = firstApp;
      }
      if (bundle.value !== initBundle) bundle.value = initBundle;
      if (app.value !== initApp) app.value = initApp;

      const isNew = params.has("new");
      if (isChangelogView.value !== isNew) isChangelogView.value = isNew;
      changelogHighlights.value = isNew ? showArr : [];
    }
    syncFromUrl(location.search);

    window.addEventListener("popstate", () => {
      syncFromUrl(location.search);
    });

    const hasHighlight = (prefix) => {
      if (!isChangelogView.value) return false;
      return changelogHighlights.value.includes(prefix);
    };

    watch([bundle, app], () => {
      const targetPrefix = `${bundle.value || ""}${app.value ? ":" + app.value : ""}`;

      const matches =
        showOptions.value.length > 0 &&
        showOptions.value.every((item) => {
          const parts = item.split(":");
          if (app.value) {
            return parts[0] === bundle.value && parts[1] === app.value;
          }
          return parts[0] === bundle.value && parts.length === 1;
        });

      if (matches) {
        return;
      }

      if (bundle.value || app.value) {
        showOptions.value = [targetPrefix];
      } else {
        showOptions.value = [];
      }
    });

    watch(
      [query, showOptions, channel, sortOrder],
      (newVals, oldVals) => {
        if (oldVals && oldVals.some((v) => v !== undefined)) {
          isChangelogView.value = false;
        }

        const urlParts = [];
        if (query.value) urlParts.push(`q=${encodeURIComponent(query.value)}`);

        if (showOptions.value.length > 0) {
          const showStr = showOptions.value.join(",");
          const encodedShow = encodeURIComponent(showStr)
            .replace(/%3A/g, ":")
            .replace(/%2C/g, ",")
            .replace(/%28/g, "(")
            .replace(/%29/g, ")");
          urlParts.push(`show=${encodedShow}`);
        }
        if (channel.value !== DEFAULT_CHANNEL) urlParts.push(`channel=${channel.value}`);
        if (sortOrder.value !== "stars") urlParts.push(`sort=${sortOrder.value}`);
        if (isChangelogView.value) urlParts.push("new");
        if (!isTwoColumns.value) urlParts.push("view=list");

        const queryString = urlParts.join("&");
        const newUrl = `${location.pathname}${queryString ? `?${queryString}` : ""}`;
        const currentUrl = location.pathname + location.search;
        
        if (currentUrl !== newUrl) {
          if (!oldVals) {
            history.replaceState(null, "", newUrl);
          } else {
            const otherChanged = oldVals[1] !== newVals[1] || oldVals[2] !== newVals[2] || oldVals[3] !== newVals[3];
            if (otherChanged) {
              history.pushState(null, "", newUrl);
            } else {
              history.replaceState(null, "", newUrl);
            }
          }
        }
      },
      { immediate: true },
    );

    const loadData = async () => {
      isLoading.value = true;
      patchesLoaded.value = false;
      errorMsg.value = "";
      try {
        const currentChannel = channel.value;
        activeData.value = await loadChannelData(channel.value, Array.from(priorityKeys), (isUpdate) => {
          if (channel.value !== currentChannel) return;
          if (isUpdate === null) {
            patchesLoaded.value = true;

            const otherChannel = channel.value === "stable" ? "latest" : "stable";
            setTimeout(() => {
              loadChannelData(otherChannel, [], null).catch(() => {});
            }, 100);
          } else if (activeData.value) {
            activeData.value.rows = [...activeData.value.rows];
          }
        });
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
        showOptions: showOptions.value,
      });
    });

    const filterOptions = computed(() => {
      if (!activeData.value) return { bundleOptions: [], appOptions: [] };

      const showOptSet = new Set(showOptions.value);

      const rowsForSource = filterRows(activeData.value, {
        query: query.value,
        showOptions: app.value ? [`:${app.value}`] : [],
      });

      let bundleOptions = getFilterOptions(rowsForSource, activeData.value.namesMap).bundleOptions.map(
        (bundleOption) => {
          const isSelected = showOptSet.has("bundle:" + bundleOption.value);
          const bundleObj = activeData.value.bundleMap[bundleOption.value];
          const repo = bundleObj ? bundleObj.repo.toLowerCase() : "";
          const icon = bundleObj ? bundleObj.avatarUrl : "";
          return { ...bundleOption, selected: isSelected, repo, icon };
        },
      );

      bundleOptions = [...bundleOptions].sort((a, b) => {
        const bundleA = activeData.value.bundleMap[a.value];
        const bundleB = activeData.value.bundleMap[b.value];
        if (sortOrder.value === "apps") {
          const countA = bundleA.appCount || 0;
          const countB = bundleB.appCount || 0;
          if (countA !== countB) return countB - countA;
        } else if (sortOrder.value === "patches") {
          const countA = bundleA.patchCount || 0;
          const countB = bundleB.patchCount || 0;
          if (countA !== countB) return countB - countA;
        } else if (sortOrder.value === "latest") {
          const dateA = bundleA?.createdAt ? new Date(bundleA.createdAt).getTime() : 0;
          const dateB = bundleB?.createdAt ? new Date(bundleB.createdAt).getTime() : 0;
          if (dateA !== dateB) return dateB - dateA;
        } else if (sortOrder.value === "stars") {
          const starsA = bundleA?.stars || 0;
          const starsB = bundleB?.stars || 0;
          if (starsA !== starsB) return starsB - starsA;
        }
        return a.value.localeCompare(b.value);
      });

      const rowsForApp = filterRows(activeData.value, {
        query: query.value,
        showOptions: bundle.value ? [bundle.value] : [],
      });
      const appOptions = getFilterOptions(rowsForApp, activeData.value.namesMap).appOptions;

      return { bundleOptions, appOptions };
    });

    function filterDropdownOptions(options, searchValue, extraFields) {
      const queryWords = searchValue.toLowerCase().split(/\s+/).filter(Boolean);
      if (queryWords.length === 0) return options;
      return options.filter((o) => {
        const searchable = [o.label, o.value, ...extraFields.map((f) => o[f] || "")].join(" ").toLowerCase();
        return queryWords.every((word) => searchable.includes(word));
      });
    }

    const filteredAppOptions = computed(() =>
      filterDropdownOptions(filterOptions.value.appOptions, appSearch.value, []),
    );

    const filteredBundleOptions = computed(() =>
      filterDropdownOptions(filterOptions.value.bundleOptions, bundleSearch.value, ["repo"]),
    );

    const stats = computed(() => summarizeRows(filteredRows.value));

    const bundlesGroups = computed(() => {
      if (!activeData.value) return [];

      const queryWords = (query.value || "").toLowerCase().split(/\s+/).filter(Boolean);

      return activeData.value.bundles
        .map((bundle) => {
          const rows = filteredRows.value.filter((r) => r.bundleKey === bundle.key);

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
                appIcon: row.appIcon,
                packageName: row.packageName,
                versions: row.versions,
              });
            }
          }
          const patches = Array.from(patchMap.values()).sort((a, b) => a.patchName.localeCompare(b.patchName));

          const appsMap = new Map();

          if (!patchesLoaded.value && bundle.targetApps) {
            for (const packageName of bundle.targetApps) {
              const name = appName(packageName, activeData.value.namesMap, activeData.value.skipSet);
              appsMap.set(packageName, {
                id: `${bundle.key}:${packageName}`,
                appName: name,
                appIcon: activeData.value.namesMap[packageName]?.iconUrl || "",
                packageName,
                versions: [],
              });
            }
          }

          for (const p of patches) {
            for (const app of p.apps) {
              const appKey = app.packageName || app.appName || "any";
              appsMap.set(appKey, app);
            }
          }

          const appsList = Array.from(appsMap.values()).sort((a, b) => {
            const isAnyA = !a.packageName || a.packageName === "universal" ? 1 : 0;
            const isAnyB = !b.packageName || b.packageName === "universal" ? 1 : 0;
            if (isAnyA !== isAnyB) return isAnyA - isAnyB;
            return (a.appName || "").localeCompare(b.appName || "");
          });

          return {
            key: bundle.key,
            bundle: bundle,
            rows,
            patches,
            appsList,
          };
        })
        .filter((group) => {
          if (group.rows.length > 0) return true;
          if (patchesLoaded.value) return false;

          if (showOptions.value.length > 0) {
            const matched = showOptions.value.some((showOpt) => {
              const parts = showOpt.split(":");
              const b = parts[0];
              const a = parts.length > 1 ? parts[1] : "";
              if (b && b !== group.key) return false;
              if (a && a !== "universal" && !group.bundle.targetApps?.includes(a)) return false;
              return true;
            });
            if (!matched) return false;
          }

          if (queryWords.length > 0) {
            const appNamesStr = (group.bundle.targetApps || [])
              .map((pkg) => appName(pkg, activeData.value.namesMap, activeData.value.skipSet))
              .join(" ");
            const searchable = [group.key, group.bundle.repo, ...(group.bundle.targetApps || []), appNamesStr]
              .join(" ")
              .toLowerCase();
            if (!queryWords.every((word) => searchable.includes(word))) return false;
          }

          return true;
        })
        .sort((a, b) => {
          if (sortOrder.value === "apps") {
            const countA = a.bundle.appCount || 0;
            const countB = b.bundle.appCount || 0;
            if (countA !== countB) return countB - countA;
          } else if (sortOrder.value === "patches") {
            const countA = a.bundle.patchCount || 0;
            const countB = b.bundle.patchCount || 0;
            if (countA !== countB) return countB - countA;
          } else if (sortOrder.value === "latest") {
            const dateA = a.bundle.createdAt ? new Date(a.bundle.createdAt).getTime() : 0;
            const dateB = b.bundle.createdAt ? new Date(b.bundle.createdAt).getTime() : 0;
            if (dateA !== dateB) return dateB - dateA;
          } else if (sortOrder.value === "stars") {
            const starsA = a.bundle.stars || 0;
            const starsB = b.bundle.stars || 0;
            if (starsA !== starsB) return starsB - starsA;
          }
          return a.key.localeCompare(b.key);
        });
    });

    const expandedVersions = reactive(new Set());
    const toggleVersions = (id) => {
      expandedVersions.has(id) ? expandedVersions.delete(id) : expandedVersions.add(id);
    };

    const expandedOptions = reactive(new Set());
    const toggleOptions = (id) => {
      expandedOptions.has(id) ? expandedOptions.delete(id) : expandedOptions.add(id);
    };

    const expandedAppLists = reactive(new Set());
    const overflowingAppLists = reactive(new Set());
    const appListRefs = new Map();

    const expandAll = () => {
      bundlesGroups.value.forEach((group) => {
        if (group.appsList && group.appsList.length > 0) {
          const firstApp = group.appsList[0];
          expandedOptions.add("app_" + group.key + "_" + firstApp.id);
        }
        if (overflowingAppLists.has(group.key)) {
          expandedAppLists.add(group.key);
          setTimeout(() => {
            const el = appListRefs.get(group.key);
            if (el) checkOverflow(el, group.key);
          }, 50);
        }
      });
    };

    const collapseAll = () => {
      expandedOptions.clear();
      expandedAppLists.clear();
      for (const key in bundleViews) {
        delete bundleViews[key];
      }
    };

    const checkOverflow = (el, key) => {
      if (!el) return;
      if (expandedAppLists.has(key)) {
        overflowingAppLists.add(key);
        return;
      }
      if (el.scrollWidth > Math.ceil(el.clientWidth)) {
        overflowingAppLists.add(key);
      } else {
        overflowingAppLists.delete(key);
      }
    };

    const setupOverflowObserver = (el, key) => {
      if (el) {
        appListRefs.set(key, el);
        if (!el._ro) {
          const observer = new ResizeObserver(() => checkOverflow(el, key));
          observer.observe(el);
          el._ro = observer;
        }
        checkOverflow(el, key);
      } else {
        const oldEl = appListRefs.get(key);
        if (oldEl && oldEl._ro) {
          oldEl._ro.disconnect();
          oldEl._ro = null;
        }
        appListRefs.delete(key);
      }
    };

    const toggleAppList = (id) => {
      expandedAppLists.has(id) ? expandedAppLists.delete(id) : expandedAppLists.add(id);
      setTimeout(() => {
        const el = appListRefs.get(id);
        if (el) checkOverflow(el, id);
      }, 50);
    };

    watch(bundlesGroups, (newGroups) => {
      if (newGroups && newGroups.length === 1) {
        isTwoColumns.value = false;
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

    const activeSwipeGroup = ref("");
    const swipeDirection = ref("");

    const selectApp = (groupKey, clickedApp, appsList) => {
      activeSwipeGroup.value = "";
      swipeDirection.value = "";
      const clickedKey = "app_" + groupKey + "_" + clickedApp.id;
      const isCurrentlyExpanded = expandedOptions.has(clickedKey);
      
      if (!bundleViews[groupKey]) {
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
              btn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
            }
          });
        }
      } else {
        if (isCurrentlyExpanded) {
          expandedOptions.delete(clickedKey);
        } else {
          expandedOptions.add(clickedKey);
        }
      }
    };

    const toggleBundle = (group) => {
      if (group.appsList && group.appsList.length > 0) {
        const isAnyExpanded = group.appsList.some((a) => expandedOptions.has("app_" + group.key + "_" + a.id));
        if (isAnyExpanded) {
          group.appsList.forEach((a) => {
            expandedOptions.delete("app_" + group.key + "_" + a.id);
          });
        } else {
          if (bundleViews[group.key]) {
            group.appsList.forEach((a) => {
              expandedOptions.add("app_" + group.key + "_" + a.id);
            });
          } else {
            expandedOptions.add("app_" + group.key + "_" + group.appsList[0].id);
          }
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

    const filterByApp = (packageName) => {
      resetFilters();
      app.value = packageName;
      showOptions.value = [`:${packageName}`];
    };

    const filterByBundle = (bundleKey) => {
      resetFilters();
      bundle.value = bundleKey;
      showOptions.value = [bundleKey];
      window.scrollTo({ top: 0, behavior: "smooth" });
    };

    const bundleViews = reactive({});
    const toggleBundleView = (group) => {
      const key = typeof group === 'string' ? group : group.key;
      bundleViews[key] = !bundleViews[key];
      
      if (!bundleViews[key] && group.appsList) {
        const expandedApps = group.appsList.filter((a) => expandedOptions.has("app_" + key + "_" + a.id));
        if (expandedApps.length > 1) {
          const firstExpanded = expandedApps[0];
          group.appsList.forEach((a) => {
            if (a.id !== firstExpanded.id) {
              expandedOptions.delete("app_" + key + "_" + a.id);
            }
          });
        }
      }
    };

    const formatDate = (val) => {
      const dateObj = val ? new Date(val) : null;
      return dateObj && !isNaN(dateObj.getTime())
        ? dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        : "";
    };
    const playUrl = (packageName) => `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageName)}`;

    const copiedStates = reactive({});
    const copyText = (text, key) => {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          copiedStates[key] = true;
          setTimeout(() => {
            copiedStates[key] = false;
          }, 1500);
        })
        .catch((err) => {
          console.error("Failed to copy text: ", err);
        });
    };

    const resetFilters = () => {
      query.value = "";
      bundle.value = "";
      app.value = "";
      appSearch.value = "";
      bundleSearch.value = "";
      showOptions.value = [];
      isChangelogView.value = false;
      expandedVersions.clear();
      collapseAll();
    };

    const isNewBundle = (group) => {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has("new")) return false;

      if (!group || !group.bundle || !group.bundle.firstSeen) return false;
      const firstSeenTime = new Date(group.bundle.firstSeen).getTime();
      const currentTime = new Date().getTime();
      const diffDays = (currentTime - firstSeenTime) / (1000 * 3600 * 24);
      return diffDays <= 7;
    };

    const getAppName = (packageName) => {
      if (!packageName || packageName === "universal") return "All Apps";
      if (!activeData.value) return packageName;
      return appName(packageName, activeData.value.namesMap, activeData.value.skipSet);
    };

    const getAppIcon = (packageName) => {
      if (!packageName || packageName === "universal") return "";
      if (!activeData.value) return "";
      return activeData.value.namesMap[packageName]?.iconUrl || "";
    };

    const getBundleIcon = (key) => {
      if (!key || !activeData.value) return "";
      return activeData.value.bundleMap[key]?.avatarUrl || "";
    };
    
    const toggleColumns = () => {
      isTwoColumns.value = !isTwoColumns.value;
      const url = new URL(window.location);
      if (!isTwoColumns.value) {
        url.searchParams.set("view", "list");
      } else {
        url.searchParams.delete("view");
      }
      history.pushState(null, "", url);
    };

    window.addEventListener("popstate", () => {
      const urlParams = new URLSearchParams(window.location.search);
      const newIsTwoColumns = urlParams.get("view") !== "list";
      if (isTwoColumns.value !== newIsTwoColumns) {
        isTwoColumns.value = newIsTwoColumns;
      }
    });

    return {
      query,
      bundle,
      app,
      appSearch,
      bundleSearch,
      filteredAppOptions,
      filteredBundleOptions,
      channel,
      isLoading,
      errorMsg,
      stats,
      sortOrder,
      filterOptions,
      bundlesGroups,
      expandedVersions,
      toggleVersions,
      expandedOptions,
      expandedAppLists,
      overflowingAppLists,
      setupOverflowObserver,
      toggleAppList,
      toggleOptions,
      selectApp,
      toggleBundle,
      activeSwipeGroup,
      swipeDirection,
      handleTouchStart,
      handleTouchEnd,
      filterByApp,
      formatDate,
      playUrl,
      isTwoColumns,
      toggleColumns,
      expandAll,
      collapseAll,
      resetFilters,
      isChangelogView,
      changelogHighlights,
      hasHighlight,
      copyText,
      copiedStates,
      isNewBundle,
      getAppName,
      getAppIcon,
      getBundleIcon,
      filterByBundle,
      bundleViews,
      toggleBundleView,
    };
  },
}).mount("#app");
