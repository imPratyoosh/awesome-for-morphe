// Copyright (c) 2026 nvbangg (github.com/nvbangg)

import { createApp, ref, computed, onMounted, watch, reactive, nextTick } from "vue";
import { filterRows, getFilterOptions, getFilterOptionsFromBundles, loadInitialData, summarizeRows, appName, fetchJson } from "./data.js";
import type { ActiveData, RowItem, Bundle, AppItem, PatchOption } from "./data.js";

function tokenize(inputString: string) {
  const tokens = [];
  let current = "";
  for (let i = 0; i < inputString.length; i++) {
    const char = inputString[i];
    if (char === '"') {
      let quoted = "";
      i++;
      while (i < inputString.length && inputString[i] !== '"') {
        quoted += inputString[i];
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
  if (current.trim()) tokens.push({ type: "LITERAL", value: current.trim() });
  return tokens;
}

// Parses nested filter strings like "bundle:(app:(patch1,patch2))" into an array of paths: ["bundle:app:patch1", "bundle:app:patch2"]
function parseShowTrie(inputString: string) {
  const tokens = tokenize(inputString);
  let pos = 0;
  const results: string[] = [];

  function parseNode(prefixItem: string | null) {
    if (pos >= tokens.length) return;
    if (tokens[pos].type === "(") {
      pos++;
      while (pos < tokens.length && tokens[pos].type !== ")") {
        parseNode(prefixItem);
        if (pos < tokens.length && tokens[pos].type === ",") pos++;
      }
      if (pos < tokens.length && tokens[pos].type === ")") pos++;
    } else {
      const tokenValue = tokens[pos].value;
      pos++;
      const newPrefix = prefixItem ? `${prefixItem}:${tokenValue}` : tokenValue || null;
      if (pos < tokens.length && tokens[pos].type === ":") {
        pos++;
        parseNode(newPrefix);
      } else if (newPrefix) {
        results.push(newPrefix);
      }
    }
  }

  while (pos < tokens.length) {
    parseNode(null);
    if (pos < tokens.length && tokens[pos].type === ",") pos++;
  }
  return results;
}

// Converts a dictionary of paths back into a nested string format for URL storage
const stringifyTrie = (bundlesDict: Record<string, Record<string, string[]>>) => {
  return Object.entries(bundlesDict)
    .map(([bundle, apps]) => {
      if (!apps || Object.keys(apps).length === 0) return bundle;
      const appStrs = Object.entries(apps).map(([app, patches]) => {
        if (!patches || patches.length === 0) return app;
        if (patches.length === 1) return `${app}:${formatPatchName(patches[0])}`;
        return `${app}:(${patches.map(formatPatchName).join(",")})`;
      });
      return appStrs.length === 1 ? `${bundle}:${appStrs[0]}` : `${bundle}:(${appStrs.join(",")})`;
    })
    .join(",");
};

const formatPatchName = (patchName: string) => {
  if (typeof patchName !== "string") return patchName;
  return /[:,()]/.test(patchName) ? `"${patchName}"` : patchName;
};

function useListUI(namespace: string = "") {
  const expandedOptions = reactive(new Set<string>());
  const expandedAppLists = reactive(new Set<string>());
  const overflowingAppLists = reactive(new Set<string>());
  const bundleViews = reactive<Record<string, boolean>>({});
  const expandedVersions = reactive(new Set<string>());
  const appListRefs = new Map<string, any>();
  const activeSwipeGroup = ref<string>("");
  const swipeDirection = ref<string>("");
  const touchStartX = ref<number>(0);
  const touchStartY = ref<number>(0);

  const toggleOptions = (id: string) => (expandedOptions.has(id) ? expandedOptions.delete(id) : expandedOptions.add(id));
  const toggleVersions = (id: string) => (expandedVersions.has(id) ? expandedVersions.delete(id) : expandedVersions.add(id));

  // Checks if the app list wraps to multiple lines in grid view to show the "Expand apps" button
  const checkOverflow = (element: any, key: string) => {
    if (!element) return;
    const wasExpanded = expandedAppLists.has(key);
    if (wasExpanded) {
      element.classList.add("flex-nowrap", "overflow-x-auto");
      element.classList.remove("flex-wrap");
    }
    const isOverflowing = element.scrollWidth > Math.ceil(element.clientWidth) + 2;
    if (wasExpanded) {
      element.classList.remove("flex-nowrap", "overflow-x-auto");
      element.classList.add("flex-wrap");
    }

    if (isOverflowing) {
      overflowingAppLists.add(key);
    } else {
      overflowingAppLists.delete(key);
      if (wasExpanded) expandedAppLists.delete(key);
    }
  };

  const setupOverflowObserver = (element: any, key: string) => {
    if (element) {
      appListRefs.set(key, element);
      if (!element.resizeObserver) {
        const observer = new ResizeObserver(() => checkOverflow(element, key));
        observer.observe(element);
        element.resizeObserver = observer;
      }
      checkOverflow(element, key);
    } else {
      const oldElement = appListRefs.get(key);
      if (oldElement?.resizeObserver) {
        oldElement.resizeObserver.disconnect();
        oldElement.resizeObserver = null;
      }
      appListRefs.delete(key);
    }
  };

  const toggleAppList = (id: string) => {
    expandedAppLists.has(id) ? expandedAppLists.delete(id) : expandedAppLists.add(id);
    setTimeout(() => {
      const element = appListRefs.get(id);
      if (element) checkOverflow(element, id);
    }, 50);
  };

  const collapseBundle = (groupItem: any) => {
    bundleViews[groupItem.key] = false;
    expandedAppLists.delete(groupItem.key);
    if (groupItem.appsList) {
      groupItem.appsList.forEach((appItem: any) => expandedOptions.delete(`${namespace}app_${groupItem.key}_${appItem.id}`));
    }
    if (groupItem.patches) {
      groupItem.patches.forEach((patch: any) => {
        expandedOptions.delete(patch.id);
        if (patch.apps) patch.apps.forEach((appElement: any) => expandedVersions.delete(appElement.id));
      });
    }
  };

  const toggleBundleView = (groupItem: any) => {
    const key = typeof groupItem === "string" ? groupItem : groupItem.key;
    const actualGroup = typeof groupItem === "string" ? null : groupItem;
    bundleViews[key] = !bundleViews[key];

    if (!bundleViews[key] && actualGroup) {
      collapseBundle(actualGroup);
      // Auto-expand first app on switch to grid view
      if (actualGroup.appsList?.length > 0) {
        expandedOptions.add(`${namespace}app_${key}_${actualGroup.appsList[0].id}`);
      }
    }
  };

  const selectApp = (groupKey: string, clickedApp: any, appsList: any[]) => {
    activeSwipeGroup.value = "";
    swipeDirection.value = "";
    const clickedKey = `${namespace}app_${groupKey}_${clickedApp.id}`;
    const isCurrentlyExpanded = expandedOptions.has(clickedKey);

    if (!bundleViews[groupKey]) {
      appsList.forEach((appItem) => {
        const key = `${namespace}app_${groupKey}_${appItem.id}`;
        if (key !== clickedKey && expandedOptions.has(key)) expandedOptions.delete(key);
      });
      if (!isCurrentlyExpanded) {
        expandedOptions.add(clickedKey);
        nextTick(() => {
          const buttonElement = document.getElementById(`tab_${namespace}${groupKey}_${clickedApp.id}`);
          if (buttonElement?.parentElement) {
            const container = buttonElement.parentElement;
            if (expandedAppLists.has(groupKey)) return;
            container.scrollTo({
              left: buttonElement.offsetLeft - container.clientWidth / 2 + buttonElement.offsetWidth / 2,
              behavior: "smooth",
            });
          }
        });
      } else {
        if (namespace !== "popup_") {
          expandedOptions.delete(clickedKey);
        }
      }
    } else {
      isCurrentlyExpanded ? expandedOptions.delete(clickedKey) : expandedOptions.add(clickedKey);
    }
  };

  const handleTouchStart = (event: TouchEvent) => {
    if (event.touches?.length > 0) {
      touchStartX.value = event.touches[0].clientX;
      touchStartY.value = event.touches[0].clientY;
    }
  };

  const handleTouchEnd = (event: TouchEvent, groupKey: string, currentApp: any, appsList: any[]) => {
    if (!event.changedTouches?.length) return;
    const deltaX = event.changedTouches[0].clientX - touchStartX.value;
    const deltaY = event.changedTouches[0].clientY - touchStartY.value;

    if (Math.abs(deltaX) > 60 && Math.abs(deltaY) < 40) {
      const currentIndex = appsList.findIndex((app) => app.id === currentApp.id);
      if (currentIndex !== -1) {
        if (deltaX < 0 && currentIndex < appsList.length - 1) {
          activeSwipeGroup.value = groupKey;
          swipeDirection.value = "left";
          selectApp(groupKey, appsList[currentIndex + 1], appsList);
        } else if (deltaX > 0 && currentIndex > 0) {
          activeSwipeGroup.value = groupKey;
          swipeDirection.value = "right";
          selectApp(groupKey, appsList[currentIndex - 1], appsList);
        }
      }
    }
  };

  const clearState = () => {
    expandedOptions.clear();
    expandedAppLists.clear();
    for (const key in bundleViews) delete bundleViews[key];
    expandedVersions.clear();
  };

  return {
    expandedOptions,
    expandedAppLists,
    overflowingAppLists,
    bundleViews,
    expandedVersions,
    activeSwipeGroup,
    swipeDirection,
    toggleOptions,
    toggleVersions,
    setupOverflowObserver,
    toggleAppList,
    selectApp,
    handleTouchStart,
    handleTouchEnd,
    toggleBundleView,
    clearState,
    collapseBundle,
  };
}

const app = createApp({
  setup() {
    const sortBundlesHelper = (firstBundle: any, secondBundle: any, firstKey: string, secondKey: string, order: string) => {
      if (order === "apps" && firstBundle?.appCount !== secondBundle?.appCount) return (secondBundle?.appCount || 0) - (firstBundle?.appCount || 0);
      if (order === "latest") {
        const dateA = firstBundle?.createdAt ? new Date(firstBundle.createdAt).getTime() : 0;
        const dateB = secondBundle?.createdAt ? new Date(secondBundle.createdAt).getTime() : 0;
        if (dateA !== dateB) return dateB - dateA;
      }
      if (order === "stars" && firstBundle?.stars !== secondBundle?.stars) return (secondBundle?.stars || 0) - (firstBundle?.stars || 0);
      return firstKey.localeCompare(secondKey);
    };

    const query = ref<string>("");
    const bundle = ref<string>("");
    const app = ref<string>("");
    const appSearch = ref<string>("");
    const bundleSearch = ref<string>("");
    const showOptions = ref<string[]>([]);
    const sortOrder = ref<string>("stars");
    const isTwoColumns = ref<boolean>(new URLSearchParams(location.search).get("view") !== "list");

    const popupBundleKey = ref<string | null>(null);
    const popupSearchQuery = ref<string>("");
    const popupAppSearch = ref<string>("");

    const activeData = ref<ActiveData | null>(null);
    const isLoading = ref<boolean>(true);
    const patchesLoaded = ref(false);
    const errorMsg = ref("");

    function debounce(fn: any, delay: number) {
      let timeoutId: any;
      return (...args: any[]) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), delay);
      };
    }

    const localQuery = ref(query.value);
    const localBundleSearch = ref(bundleSearch.value);
    const localAppSearch = ref(appSearch.value);
    const localPopupSearchQuery = ref(popupSearchQuery.value);
    const localPopupAppSearch = ref(popupAppSearch.value);

    watch(query, (val) => {
      if (val !== localQuery.value) localQuery.value = val;
    });
    watch(bundleSearch, (val) => {
      if (val !== localBundleSearch.value) localBundleSearch.value = val;
    });
    watch(appSearch, (val) => {
      if (val !== localAppSearch.value) localAppSearch.value = val;
    });
    watch(popupSearchQuery, (val) => {
      if (val !== localPopupSearchQuery.value) localPopupSearchQuery.value = val;
    });
    watch(popupAppSearch, (val) => {
      if (val !== localPopupAppSearch.value) localPopupAppSearch.value = val;
    });

    const updateQuery = debounce((val: string) => {
      query.value = val;
    }, 200);
    const updateBundleSearch = debounce((val: string) => {
      bundleSearch.value = val;
    }, 150);
    const updateAppSearch = debounce((val: string) => {
      appSearch.value = val;
    }, 150);
    const updatePopupSearchQuery = debounce((val: string) => {
      popupSearchQuery.value = val;
    }, 200);
    const updatePopupAppSearch = debounce((val: string) => {
      popupAppSearch.value = val;
    }, 150);

    watch(localQuery, (val) => updateQuery(val));
    watch(localBundleSearch, (val) => updateBundleSearch(val));
    watch(localAppSearch, (val) => updateAppSearch(val));
    watch(localPopupSearchQuery, (val) => updatePopupSearchQuery(val));
    watch(localPopupAppSearch, (val) => updatePopupAppSearch(val));

    const initialParams = new URLSearchParams(location.search);
    const priorityKeys = new Set<string>();
    if (initialParams.get("show")) {
      initialParams
        .get("show")!
        .split(",")
        .forEach((part) => {
          const key = part.split(":")[0];
          if (key) priorityKeys.add(key);
        });
    }

    const isWhatsNewView = ref<boolean>(false);
    const whatsNewHighlights = ref<string[]>([]);
    const rawShowParam = ref<string>("");

    const backgroundReady = ref<boolean>(!initialParams.get("show"));
    watch(activeData, (newData) => {
      if (newData && !backgroundReady.value) {
        nextTick(() => {
          setTimeout(() => {
            backgroundReady.value = true;
          }, 150);
        });
      }
    });

    const buildUrlString = (targetHash?: string) => {
      const urlParts: string[] = [];
      if (query.value) urlParts.push(`q=${encodeURIComponent(query.value)}`);
      if (bundle.value) urlParts.push(`bundle=${encodeURIComponent(bundle.value)}`);
      if (app.value) urlParts.push(`app=${encodeURIComponent(app.value)}`);

      if (showOptions.value.length > 0) {
        const showStr = isWhatsNewView.value && rawShowParam.value ? rawShowParam.value : showOptions.value.join(",");
        const encodedShow = encodeURIComponent(showStr).replace(/%3A/g, ":").replace(/%2C/g, ",").replace(/%28/g, "(").replace(/%29/g, ")");
        urlParts.push(`show=${encodedShow}`);
      }
      if (popupSearchQuery.value) urlParts.push(`pq=${encodeURIComponent(popupSearchQuery.value)}`);
      if (sortOrder.value !== "stars") urlParts.push(`sort=${sortOrder.value}`);
      if (!isTwoColumns.value) urlParts.push("view=list");

      const queryString = urlParts.join("&");
      return `${location.pathname}${queryString ? "?" + queryString : ""}${targetHash || ""}`;
    };

    let isSyncing = false;
    function syncFromUrl(searchStr: string) {
      isSyncing = true;
      const params = new URLSearchParams(searchStr);

      let hadNewParam = false;
      if (params.has("new")) {
        params.delete("new");
        hadNewParam = true;
        isWhatsNewView.value = true;
      } else {
        isWhatsNewView.value = location.hash === "#whats-new";
      }

      let urlChanged = false;
      if (isWhatsNewView.value && params.has("channel")) {
        params.delete("channel");
        urlChanged = true;
      }

      const validSortOrders = ["stars", "latest", "apps"];
      if (params.has("sort") && !validSortOrders.includes(params.get("sort") || "")) {
        params.delete("sort");
        urlChanged = true;
      }
      if (params.has("view") && params.get("view") !== "list") {
        params.delete("view");
        urlChanged = true;
      }

      if (urlChanged) {
        try {
          const newSearch = params.toString();
          const targetHash = isWhatsNewView.value ? "#whats-new" : location.hash === "#whats-new" ? "" : location.hash;
          history.replaceState(null, "", `${location.pathname}${newSearch ? "?" + newSearch : ""}${targetHash || ""}`);
        } catch (error) {}
      }

      query.value = params.get("q") || "";
      sortOrder.value = params.get("sort") || "stars";
      isTwoColumns.value = params.get("view") !== "list";
      popupSearchQuery.value = params.get("pq") || "";
      bundle.value = params.get("bundle") || "";
      app.value = params.get("app") || "";

      const rawParam = params.get("show");
      let showArr: string[] = [];
      let foundValidPopup = false;

      if (rawParam) {
        rawShowParam.value = decodeURIComponent(rawParam);
        showArr = parseShowTrie(rawShowParam.value);
        const bundlesInShow = new Set(showArr.map((item) => item.split(":")[0]).filter(Boolean));

        if (bundlesInShow.size === 1) {
          foundValidPopup = true;
          showOptions.value = showArr;
          const targetBundle = Array.from(bundlesInShow)[0];
          if (popupBundleKey.value !== targetBundle) {
            popupBundleKey.value = targetBundle;
            document.body.style.overflow = "hidden";
          }
        } else {
          params.delete("show");
          try {
            history.replaceState(null, "", `${location.pathname}?${params.toString().replace(/=&/g, "&").replace(/=$/, "")}#whats-new`);
          } catch (error) {
            location.hash = "whats-new";
          }
          nextTick(() => {
            isSyncing = false;
            syncFromUrl(location.search);
          });
          return;
        }
      }

      if (!foundValidPopup) {
        showOptions.value = [];
        if (popupBundleKey.value) {
          popupBundleKey.value = null;
          document.body.style.overflow = "";
        }
      }

      whatsNewHighlights.value = isWhatsNewView.value && showOptions.value.length > 0 ? showOptions.value : [];

      nextTick(() => {
        if (hadNewParam)
          try {
            history.replaceState(null, "", buildUrlString("#whats-new"));
          } catch (error) {}
        isSyncing = false;
      });
    }

    onMounted(async () => {
      syncFromUrl(location.search);
      if (isWhatsNewView.value && whatsNewHistory.value.length === 0) {
        await loadWhatsNewData();
        setTimeout(loadData, 300);
      } else {
        loadData();
        setTimeout(() => {
          if (whatsNewHistory.value.length === 0) loadWhatsNewData();
        }, 1000);
      }
      window.addEventListener("popstate", () => syncFromUrl(location.search));
      window.addEventListener("hashchange", () => syncFromUrl(location.search));
      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && popupBundleKey.value) closePopup();
      });
    });

    watch(popupSearchQuery, () => {
      if (!isSyncing)
        try {
          history.replaceState(null, "", buildUrlString(location.hash));
        } catch (error) {}
    });

    watch([query, bundle, app, sortOrder, isTwoColumns, showOptions], (newValues, oldValues) => {
      if (!isSyncing && oldValues?.some((value) => value !== undefined)) isWhatsNewView.value = false;
      if (isSyncing) return;

      const targetHash = isWhatsNewView.value ? "#whats-new" : location.hash === "#whats-new" ? "" : location.hash;
      const newUrl = buildUrlString(targetHash);

      if (location.pathname + location.search + location.hash !== newUrl) {
        if (!oldValues) {
          try {
            history.replaceState(null, "", newUrl);
          } catch (error) {}
        } else {
          const otherChanged = oldValues[1] !== newValues[1] || oldValues[2] !== newValues[2] || oldValues[3] !== newValues[3] || JSON.stringify(oldValues[5]) !== JSON.stringify(newValues[5]);
          try {
            otherChanged ? history.pushState(null, "", newUrl) : history.replaceState(null, "", newUrl);
          } catch (error) {}
        }
      }
    });

    const loadData = async () => {
      isLoading.value = true;
      patchesLoaded.value = false;
      errorMsg.value = "";
      try {
        activeData.value = await loadInitialData(Array.from(priorityKeys), (isUpdate) => {
          if (isUpdate === null) {
            patchesLoaded.value = true;
            isLoading.value = false;
          } else if (activeData.value) {
            activeData.value.rows = [...activeData.value.rows];
            if (isUpdate === true && showOptions.value.length > 0 && !query.value) isLoading.value = false;
          }
        });
        if (!query.value && showOptions.value.length === 0) isLoading.value = false;
      } catch (error: any) {
        errorMsg.value = error.message || error;
        isLoading.value = false;
      }
    };

    const whatsNewHistory = ref<any[]>([]);
    const whatsNewAppsData = ref<Record<string, any>>({});
    const isWhatsNewLoading = ref<boolean>(false);

    const loadWhatsNewData = async () => {
      isWhatsNewLoading.value = true;
      try {
        const [history, apps] = await Promise.all([fetchJson("whats-new.json"), fetchJson("apps.json")]);
        whatsNewHistory.value = history || [];
        whatsNewAppsData.value = apps || {};
      } catch (error) {
        console.error("Failed to load what's new data", error);
      } finally {
        isWhatsNewLoading.value = false;
      }
    };

    const navigateToWhatsNewShow = (trieStr: string) => {
      const encodedShow = encodeURIComponent(trieStr).replace(/%3A/g, ":").replace(/%2C/g, ",").replace(/%28/g, "(").replace(/%29/g, ")");
      const params = new URLSearchParams(location.search);
      const urlParts: string[] = [];
      if (params.get("sort") && params.get("sort") !== "stars") urlParts.push(`sort=${params.get("sort")}`);
      if (params.get("view") === "list") urlParts.push("view=list");
      urlParts.push(`show=${encodedShow}`);

      const newUrl = `${location.pathname}?${urlParts.join("&")}#whats-new`;
      try {
        history.pushState(null, "", newUrl);
      } catch (error) {}
      syncFromUrl(`?${urlParts.join("&")}`);
    };

    const openBundlePopup = (bundleKey: string, bundleData: any) => {
      if (!bundleData || bundleData.isNew) return navigateToWhatsNewShow(bundleKey);
      const bundleChanges: Record<string, string[]> = {};
      for (const [packageName, data] of Object.entries<any>(bundleData.apps || {})) {
        bundleChanges[packageName] = data.isNew ? [] : [...(data.patches || [])].sort();
      }
      navigateToWhatsNewShow(stringifyTrie({ [bundleKey]: bundleChanges }));
    };

    const openAppPopup = (bundleKey: string, packageName: string, appData: any) => {
      navigateToWhatsNewShow(!appData || appData.isNew ? `${bundleKey}:${packageName}` : stringifyTrie({ [bundleKey]: { [packageName]: [...(appData.patches || [])].sort() } }));
    };

    const openPatchPopup = (bundleKey: string, packageName: string, patchName: string) => navigateToWhatsNewShow(stringifyTrie({ [bundleKey]: { [packageName]: [patchName] } }));

    watch(isWhatsNewView, (newVal) => {
      if (newVal && whatsNewHistory.value.length === 0) loadWhatsNewData();
    });

    const filteredRows = computed(() => {
      if (!activeData.value || !backgroundReady.value) return [];
      const targetPrefix = `${bundle.value || ""}${app.value ? ":" + app.value : ""}`;
      const currentShowOptions = targetPrefix ? [targetPrefix] : [];
      return filterRows(activeData.value, { query: query.value, showOptions: currentShowOptions });
    });

    const filterOptions = computed(() => {
      if (!activeData.value) return { bundleOptions: [], appOptions: [] };

      const enrichAndSortBundleOptions = (options: any[]) => {
        return options
          .map((option) => {
            const bundleObject = activeData.value?.bundleMap[option.value];
            return { ...option, repo: bundleObject?.repo?.toLowerCase() || "", icon: bundleObject?.avatarUrl || "" };
          })
          .sort((firstItem, secondItem) =>
            sortBundlesHelper(activeData.value?.bundleMap[firstItem.value], activeData.value?.bundleMap[secondItem.value], firstItem.value, secondItem.value, sortOrder.value),
          );
      };

      const noFilters = !query.value && !app.value && !bundle.value;
      if (noFilters && activeData.value.bundles?.length > 0) {
        const options = getFilterOptionsFromBundles(activeData.value.bundles, activeData.value.namesMap, activeData.value.skipSet);
        return {
          bundleOptions: enrichAndSortBundleOptions(options.bundleOptions),
          appOptions: options.appOptions,
        };
      }

      const rowsForSource = filterRows(activeData.value, {
        query: query.value,
        showOptions: app.value ? [`:${app.value}`] : [],
      });
      const bundleOptions = enrichAndSortBundleOptions(getFilterOptions(rowsForSource, activeData.value.namesMap).bundleOptions);

      const rowsForApp = filterRows(activeData.value, {
        query: query.value,
        showOptions: bundle.value ? [bundle.value] : [],
      });
      return { bundleOptions, appOptions: getFilterOptions(rowsForApp, activeData.value.namesMap).appOptions };
    });

    const filterDropdownOptions = (options: any[], searchValue: string, extraFields: string[]) => {
      const queryWords = searchValue.toLowerCase().split(/\s+/).filter(Boolean);
      if (queryWords.length === 0) return options;
      return options.filter((option) => {
        const searchable = [option.label, option.value, ...extraFields.map((field) => option[field] || "")].join(" ").toLowerCase();
        return queryWords.every((word) => searchable.includes(word));
      });
    };

    const buildGroupFromRows = (bundleItem: Bundle, rows: RowItem[], hasFilters: boolean) => {
      const patchIdMap = new Map<string, any>();
      for (const row of rows) {
        if (!patchIdMap.has(row.patchId)) {
          patchIdMap.set(row.patchId, {
            id: row.patchId,
            patchName: row.patchName,
            description: row.description,
            enabled: row.enabled,
            options: row.options || [],
            apps: [],
          });
        }
        if (row.packageName || row.appName) {
          patchIdMap.get(row.patchId).apps.push({
            id: row.id,
            appName: row.appName,
            appIcon: row.appIcon,
            packageName: row.packageName,
            versions: row.versions,
          });
        }
      }
      const patches = Array.from(patchIdMap.values()).sort((firstItem: any, secondItem: any) => firstItem.patchName.localeCompare(secondItem.patchName));
      const appsMap = new Map<string, any>();

      if (!patchesLoaded.value && bundleItem.targetApps && !hasFilters) {
        for (const packageName of bundleItem.targetApps) {
          appsMap.set(packageName, {
            id: `${bundleItem.key}:${packageName}`,
            appName: appName(packageName, activeData.value?.namesMap || {}, activeData.value?.skipSet),
            appIcon: activeData.value?.namesMap[packageName]?.iconUrl || "",
            packageName,
            versions: [],
          });
        }
      }
      for (const patch of patches) for (const appItem of patch.apps) appsMap.set(appItem.packageName, appItem);

      const appsList = Array.from(appsMap.values()).sort((firstItem: any, secondItem: any) => {
        if ((firstItem.packageName === "universal") !== (secondItem.packageName === "universal"))
          return (firstItem.packageName === "universal" ? 1 : 0) - (secondItem.packageName === "universal" ? 1 : 0);
        return firstItem.appName.localeCompare(secondItem.appName);
      });

      return { key: bundleItem.key, bundle: bundleItem, rows, patches, appsList };
    };

    const bundlesGroups = computed(() => {
      if (!activeData.value || !backgroundReady.value) return [];
      const queryWords = (query.value || "").toLowerCase().split(/\s+/).filter(Boolean);
      const targetPrefix = `${bundle.value || ""}${app.value ? ":" + app.value : ""}`;
      const hasFilters = queryWords.length > 0 || !!targetPrefix;

      return activeData.value.bundles
        .map((bundleItem) =>
          buildGroupFromRows(
            bundleItem,
            filteredRows.value.filter((row) => row.bundleKey === bundleItem.key),
            hasFilters,
          ),
        )
        .filter((group) => {
          if (group.rows.length > 0) return true;
          if (patchesLoaded.value) return false;

          const currentShowOptions = targetPrefix ? [targetPrefix] : [];
          if (currentShowOptions.length > 0) {
            const matched = currentShowOptions.some((showOpt) => {
              const parts = showOpt.split(":");
              if (parts[0] && parts[0] !== group.key) return false;
              if (parts[1] && parts[1] !== "universal" && !group.bundle.targetApps?.includes(parts[1])) return false;
              return true;
            });
            if (!matched) return false;
          }

          if (queryWords.length > 0) {
            const appNamesStr = (group.bundle.targetApps || []).map((packageName) => appName(packageName, activeData.value?.namesMap || {}, activeData.value?.skipSet)).join(" ");
            const searchable = [group.key, group.bundle.repo, ...(group.bundle.targetApps || []), appNamesStr].join(" ").toLowerCase();
            if (!queryWords.every((word) => searchable.includes(word))) return false;
          }
          return true;
        })
        .sort((firstItem: any, secondItem: any) => sortBundlesHelper(firstItem.bundle, secondItem.bundle, firstItem.key, secondItem.key, sortOrder.value));
    });

    const mainUI = useListUI("");
    const popupUI = useListUI("popup_");

    const expandAll = () => {
      bundlesGroups.value.forEach((group: any) => {
        if (!group.appsList?.length) return;
        const isBundleOpen = group.appsList.some((app: any) => mainUI.expandedOptions.has(`app_${group.key}_${app.id}`)) || mainUI.expandedAppLists.has(group.key);
        if (!isBundleOpen) {
          mainUI.expandedAppLists.add(group.key);
          mainUI.expandedOptions.add(`app_${group.key}_${group.appsList[0].id}`);
        } else if (mainUI.bundleViews[group.key]) {
          group.appsList.forEach((app: any) => mainUI.expandedOptions.add(`app_${group.key}_${app.id}`));
        }
      });
    };
    const collapseAll = () => bundlesGroups.value.forEach((group: any) => mainUI.collapseBundle(group));
    const toggleBundle = (groupItem: any) => {
      if (groupItem.appsList?.length > 0) {
        if (
          groupItem.appsList.some((appItem: any) => mainUI.expandedOptions.has(`app_${groupItem.key}_${appItem.id}`)) ||
          mainUI.bundleViews[groupItem.key] ||
          mainUI.expandedAppLists.has(groupItem.key)
        ) {
          mainUI.collapseBundle(groupItem);
        } else {
          mainUI.expandedAppLists.add(groupItem.key);
          mainUI.expandedOptions.add(`app_${groupItem.key}_${groupItem.appsList[0].id}`);
        }
      }
    };

    watch(bundlesGroups, (newGroups) => {
      if (newGroups?.length === 1 && !popupBundleKey.value && newGroups[0].appsList?.length > 0) {
        const group = newGroups[0];
        if (!group.appsList.some((appItem) => mainUI.expandedOptions.has(`app_${group.key}_${appItem.id}`))) mainUI.expandedOptions.add(`app_${group.key}_${group.appsList[0].id}`);
      }
    });

    const openPopupFast = (groupKey: string) => {
      const params = new URLSearchParams();
      params.set("show", groupKey);
      const newUrl = `?${params.toString()}${location.hash === "#whats-new" ? "#whats-new" : ""}`;
      try {
        history.pushState(null, "", newUrl);
      } catch (error) {}
      syncFromUrl(newUrl.split("#")[0]);
    };

    const closePopup = () => {
      document.body.style.overflow = "";
      popupBundleKey.value = null;
      popupSearchQuery.value = "";
      popupAppSearch.value = "";
      const urlParams = new URLSearchParams(location.search);
      urlParams.delete("show");
      urlParams.delete("pq");
      const newUrl = `${location.pathname}${urlParams.toString() ? "?" + urlParams.toString() : ""}${isWhatsNewView.value ? "#whats-new" : location.hash}`;
      try {
        history[isWhatsNewView.value ? "replaceState" : "pushState"](null, "", newUrl);
      } catch (error) {
        if (isWhatsNewView.value) location.hash = "whats-new";
      }
      syncFromUrl(urlParams.toString() ? "?" + urlParams.toString() : "");
    };

    const autoExpandPopupApp = () => {
      if (popupBundleKey.value) {
        const group = popupGroup.value;
        if (group && group.key === popupBundleKey.value && group.appsList?.length > 0) {
          const targetApp = app.value ? group.appsList.find((firstItem) => firstItem.packageName === app.value) || group.appsList[0] : group.appsList[0];
          if (!group.appsList.some((appElement) => popupUI.expandedOptions.has(`popup_app_${group.key}_${appElement.id}`))) {
            popupUI.expandedOptions.add(`popup_app_${group.key}_${targetApp.id}`);
            nextTick(() => {
              const el = document.getElementById(`tab_popup_${group.key}_${targetApp.id}`);
              if (el?.parentElement)
                el.parentElement.scrollTo({
                  top: el.offsetTop - el.parentElement.clientHeight / 2 + el.clientHeight / 2,
                  behavior: "smooth",
                });
            });
          }
        }
      }
    };

    watch(popupBundleKey, (newKey) => {
      if (newKey) autoExpandPopupApp();
      else popupUI.clearState();
    });
    watch(patchesLoaded, (loaded) => {
      if (loaded && popupBundleKey.value) {
        popupUI.expandedOptions.clear();
        nextTick(autoExpandPopupApp);
      }
    });

    const popupGroup = computed(() => {
      if (!activeData.value || !popupBundleKey.value) return null;
      const bundleItem = activeData.value.bundles.find((bundleElement: Bundle) => bundleElement.key === popupBundleKey.value);
      if (!bundleItem) return null;
      const rows = filterRows(activeData.value, {
        query: popupSearchQuery.value,
        showOptions: showOptions.value,
      }).filter((row) => row.bundleKey === popupBundleKey.value);
      return buildGroupFromRows(bundleItem, rows, (popupSearchQuery.value || "").trim().length > 0 || showOptions.value.length > 0);
    });

    watch(popupGroup, (newGroup) => {
      if (!newGroup) return;
      if (!popupUI.bundleViews[newGroup.key] && newGroup.appsList?.length > 0) {
        const hasExpanded = newGroup.appsList.some((appElement) => popupUI.expandedOptions.has(`popup_app_${newGroup.key}_${appElement.id}`));
        if (!hasExpanded) {
          const targetApp = app.value ? newGroup.appsList.find((firstItem) => firstItem.packageName === app.value) || newGroup.appsList[0] : newGroup.appsList[0];
          popupUI.expandedOptions.add(`popup_app_${newGroup.key}_${targetApp.id}`);
        }
      }
      if ((showOptions.value.length === 1 && showOptions.value[0].includes(":")) || (popupSearchQuery.value || "").trim().length > 0 || newGroup.appsList.length <= 1) {
        if (!popupUI.expandedAppLists.has(newGroup.key)) popupUI.expandedAppLists.add(newGroup.key);
        if (newGroup.appsList.length > 0 && !popupUI.expandedOptions.has(`popup_app_${newGroup.key}_${newGroup.appsList[0].id}`))
          popupUI.expandedOptions.add(`popup_app_${newGroup.key}_${newGroup.appsList[0].id}`);
      }
    });

    const popupAllApps = computed(() => {
      const bundleItem = activeData.value?.bundles.find((bundleElement: Bundle) => bundleElement.key === popupBundleKey.value);
      return (bundleItem?.targetApps || [])
        .map((packageName: string) => ({
          value: packageName,
          label: appName(packageName, activeData.value?.namesMap || {}, activeData.value?.skipSet),
          icon: activeData.value?.namesMap[packageName]?.iconUrl || "",
        }))
        .sort((firstItem: any, secondItem: any) => (firstItem.value === "universal" ? 1 : 0) - (secondItem.value === "universal" ? 1 : 0) || firstItem.label.localeCompare(secondItem.label));
    });

    const selectPopupAppFromDropdown = (appValue: string) => {
      isSyncing = true;
      popupUI.expandedOptions.clear();
      const newShow = appValue ? `${popupBundleKey.value}:${appValue}` : popupBundleKey.value || "";
      showOptions.value = [newShow];
      isWhatsNewView.value = false;
      try {
        history.pushState(null, "", buildUrlString(""));
      } catch (error) {}
      nextTick(() => {
        isSyncing = false;
        if (!appValue) {
          autoExpandPopupApp();
        }
      });
    };

    const filterByApp = (packageName: string) => {
      if (popupBundleKey.value) {
        document.body.style.overflow = "";
        popupBundleKey.value = null;
      }
      resetFilters();
      app.value = packageName;
    };
    const resetFilters = () => {
      collapseAll();
      query.value = bundle.value = app.value = appSearch.value = bundleSearch.value = popupSearchQuery.value = popupAppSearch.value = "";
      showOptions.value = [];
      isWhatsNewView.value = false;
      mainUI.clearState();
    };

    const copiedStates = reactive<Record<string, boolean>>({});
    const copyText = (text: string, key: string) =>
      navigator.clipboard
        .writeText(text)
        .then(() => {
          copiedStates[key] = true;
          setTimeout(() => (copiedStates[key] = false), 2000);
        })
        .catch(() => {});

    return {
      query,
      bundle,
      app,
      showOptions,
      appSearch,
      bundleSearch,
      localQuery,
      localBundleSearch,
      localAppSearch,
      localPopupSearchQuery,
      localPopupAppSearch,
      sortOrder,
      isTwoColumns,
      isLoading,
      errorMsg,
      stats: computed(() => summarizeRows(filteredRows.value)),
      filterOptions,
      bundlesGroups,
      effectiveTwoColumns: computed(() => (bundlesGroups.value.length === 1 ? false : isTwoColumns.value)),
      isWhatsNewView,
      whatsNewHighlights,
      whatsNewHistory,
      isWhatsNewLoading,
      popupBundleKey,
      popupSearchQuery,
      popupAppSearch,
      popupGroup,
      filteredAppOptions: computed(() => filterDropdownOptions(filterOptions.value.appOptions, localAppSearch.value, [])),
      filteredBundleOptions: computed(() => filterDropdownOptions(filterOptions.value.bundleOptions, localBundleSearch.value, ["repo"])),
      filteredPopupAllApps: computed(() => filterDropdownOptions(popupAllApps.value, localPopupAppSearch.value, ["label", "value"])),

      mainUI,
      popupUI,
      expandAll,
      collapseAll,
      toggleBundle,
      filterByApp,
      resetFilters,
      closeWhatsNew: () => {
        if (isWhatsNewView.value) {
          isWhatsNewView.value = false;
          try {
            history.pushState(null, "", buildUrlString(""));
          } catch (error) {}
        }
      },
      openPopupFast,
      closePopup,
      selectPopupAppFromDropdown,
      selectBundleFromDropdown: (key: string) => (bundle.value = key || ""),
      openBundlePopup,
      openAppPopup,
      openPatchPopup,
      copyText,
      copiedStates,

      formatDate: (value: string | number | Date) =>
        value ? (isNaN(new Date(value).getTime()) ? "" : new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })) : "",
      playUrl: (packageName: string) => `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageName)}`,
      getWhatsNewAppIcon: (packageName: string) => whatsNewAppsData.value[packageName]?.iconUrl || "",
      formatWhatsNewAppName: (packageName: string) => appName(packageName, whatsNewAppsData.value, activeData.value?.skipSet),
      getAppName: (packageName: string) => (packageName ? appName(packageName, activeData.value?.namesMap || {}, activeData.value?.skipSet) : "All Apps"),
      getAppIcon: (packageName: string) => activeData.value?.namesMap[packageName]?.iconUrl || "",
      getBundleIcon: (key: string) => activeData.value?.bundleMap[key]?.avatarUrl || "",
      toggleColumns: () => (isTwoColumns.value = !isTwoColumns.value),
      isNewBundle: (group: any) => !isWhatsNewView.value && group?.bundle?.firstSeen && (Date.now() - new Date(group.bundle.firstSeen).getTime()) / 86400000 <= 7,
      hasHighlight: (prefix: string) => isWhatsNewView.value && whatsNewHighlights.value.includes(prefix),
      isAppHighlighted: (groupKey: string, appItem: any) =>
        isWhatsNewView.value && (whatsNewHighlights.value.includes(`${groupKey}:${appItem.packageName}`) || whatsNewHighlights.value.includes(`${groupKey}:${appItem.appName}`)),
    };
  },
});

app.mount("#app");
