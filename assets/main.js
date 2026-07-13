import {
  createApp,
  ref,
  computed,
  onMounted,
  watch,
  reactive,
  nextTick,
} from "https://unpkg.com/vue@3/dist/vue.esm-browser.js";
import {
  filterRows,
  getFilterOptions,
  loadChannelData,
  normalizeChannel,
  summarizeRows,
  appName,
  fetchJson,
} from "./data.js";

const DEFAULT_CHANNEL = "latest";

function tokenize(inputString) {
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

function parseShowTrie(inputString) {
  const tokens = tokenize(inputString);
  let pos = 0;
  const results = [];

  function parseNode(prefixItem) {
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
      const newPrefix = prefixItem ? `${prefixItem}:${tokenValue}` : tokenValue;
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
    if (pos < tokens.length && tokens[pos].type === ",") pos++;
  }
  return results;
}

const stringifyTrie = (bundlesDict) => {
  const bundleStrs = [];
  for (const [bundle, apps] of Object.entries(bundlesDict)) {
    if (!apps || Object.keys(apps).length === 0) {
      bundleStrs.push(bundle);
    } else {
      const appStrs = [];
      for (const [app, patches] of Object.entries(apps)) {
        if (!patches || patches.length === 0) {
          appStrs.push(app);
        } else if (patches.length === 1) {
          appStrs.push(`${app}:${formatPatchName(patches[0])}`);
        } else {
          const patchStrs = patches.map(formatPatchName);
          appStrs.push(`${app}:(${patchStrs.join(",")})`);
        }
      }
      bundleStrs.push(appStrs.length === 1 ? `${bundle}:${appStrs[0]}` : `${bundle}:(${appStrs.join(",")})`);
    }
  }
  return bundleStrs.join(",");
};

const formatPatchName = (patchName) => {
  if (typeof patchName !== "string") return patchName;
  return /[:,()]/.test(patchName) ? `"${patchName}"` : patchName;
};

function useListUI(namespace = "") {
  const expandedOptions = reactive(new Set());
  const expandedAppLists = reactive(new Set());
  const overflowingAppLists = reactive(new Set());
  const bundleViews = reactive({});
  const expandedVersions = reactive(new Set());
  const appListRefs = new Map();
  const activeSwipeGroup = ref("");
  const swipeDirection = ref("");
  const touchStartX = ref(0);
  const touchStartY = ref(0);

  const toggleOptions = (id) => (expandedOptions.has(id) ? expandedOptions.delete(id) : expandedOptions.add(id));
  const toggleVersions = (id) => (expandedVersions.has(id) ? expandedVersions.delete(id) : expandedVersions.add(id));

  const checkOverflow = (element, key) => {
    if (!element) return;
    const wasExpanded = expandedAppLists.has(key);
    if (wasExpanded) element.classList.add("max-h-[120px]", "overflow-y-auto", "overflow-x-hidden");
    const isOverflowing = element.scrollHeight > Math.ceil(element.clientHeight) + 2;
    if (wasExpanded) element.classList.remove("max-h-[120px]", "overflow-y-auto", "overflow-x-hidden");

    if (isOverflowing) {
      overflowingAppLists.add(key);
    } else {
      overflowingAppLists.delete(key);
      if (wasExpanded) expandedAppLists.delete(key);
    }
  };

  const setupOverflowObserver = (element, key) => {
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

  const toggleAppList = (id) => {
    expandedAppLists.has(id) ? expandedAppLists.delete(id) : expandedAppLists.add(id);
    setTimeout(() => {
      const element = appListRefs.get(id);
      if (element) checkOverflow(element, id);
    }, 50);
  };

  const collapseBundle = (groupItem) => {
    bundleViews[groupItem.key] = false;
    expandedAppLists.delete(groupItem.key);
    if (groupItem.appsList) {
      groupItem.appsList.forEach((appItem) => expandedOptions.delete(`${namespace}app_${groupItem.key}_${appItem.id}`));
    }
    if (groupItem.patches) {
      groupItem.patches.forEach((patch) => {
        expandedOptions.delete(patch.id);
        if (patch.apps) patch.apps.forEach((appElem) => expandedVersions.delete(appElem.id));
      });
    }
  };

  const toggleBundleView = (groupItem) => {
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

  const selectApp = (groupKey, clickedApp, appsList) => {
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
            container.scrollTo({
              top: buttonElement.offsetTop - container.clientHeight / 2 + buttonElement.clientHeight / 2,
              behavior: "smooth",
            });
          }
        });
      } else {
        expandedAppLists.delete(groupKey);
      }
    } else {
      isCurrentlyExpanded ? expandedOptions.delete(clickedKey) : expandedOptions.add(clickedKey);
    }
  };

  const handleTouchStart = (event) => {
    if (event.touches?.length > 0) {
      touchStartX.value = event.touches[0].clientX;
      touchStartY.value = event.touches[0].clientY;
    }
  };

  const handleTouchEnd = (event, groupKey, currentApp, appsList) => {
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
    const sortBundlesHelper = (bundleA, bundleB, keyA, keyB, order) => {
      if (order === "apps" && bundleA?.appCount !== bundleB?.appCount)
        return (bundleB?.appCount || 0) - (bundleA?.appCount || 0);
      if (order === "patches" && bundleA?.patchCount !== bundleB?.patchCount)
        return (bundleB?.patchCount || 0) - (bundleA?.patchCount || 0);
      if (order === "latest") {
        const dateA = bundleA?.createdAt ? new Date(bundleA.createdAt).getTime() : 0;
        const dateB = bundleB?.createdAt ? new Date(bundleB.createdAt).getTime() : 0;
        if (dateA !== dateB) return dateB - dateA;
      }
      if (order === "stars" && bundleA?.stars !== bundleB?.stars) return (bundleB?.stars || 0) - (bundleA?.stars || 0);
      return keyA.localeCompare(keyB);
    };

    const query = ref("");
    const bundle = ref("");
    const app = ref("");
    const appSearch = ref("");
    const bundleSearch = ref("");
    const showOptions = ref([]);
    const channel = ref(DEFAULT_CHANNEL);
    const sortOrder = ref("stars");
    const isTwoColumns = ref(new URLSearchParams(location.search).get("view") !== "list");

    const popupBundleKey = ref(null);
    const popupSearchQuery = ref("");
    const popupAppSearch = ref("");

    const activeData = ref(null);
    const isLoading = ref(true);
    const patchesLoaded = ref(false);
    const errorMsg = ref("");

    const initialParams = new URLSearchParams(location.search);
    const priorityKeys = new Set();
    if (initialParams.get("show")) {
      initialParams
        .get("show")
        .split(",")
        .forEach((part) => {
          const key = part.split(":")[0];
          if (key) priorityKeys.add(key);
        });
    }

    const isWhatsNewView = ref(false);
    const whatsNewHighlights = ref([]);
    const rawShowParam = ref("");

    const backgroundReady = ref(!initialParams.get("show"));
    watch(activeData, (newData) => {
      if (newData && !backgroundReady.value) {
        nextTick(() => {
          setTimeout(() => {
            backgroundReady.value = true;
          }, 150);
        });
      }
    });

    const buildUrlString = (targetHash) => {
      const urlParts = [];
      if (query.value) urlParts.push(`q=${encodeURIComponent(query.value)}`);
      if (bundle.value) urlParts.push(`bundle=${encodeURIComponent(bundle.value)}`);
      if (app.value) urlParts.push(`app=${encodeURIComponent(app.value)}`);

      if (showOptions.value.length > 0) {
        const showStr = isWhatsNewView.value && rawShowParam.value ? rawShowParam.value : showOptions.value.join(",");
        const encodedShow = encodeURIComponent(showStr)
          .replace(/%3A/g, ":")
          .replace(/%2C/g, ",")
          .replace(/%28/g, "(")
          .replace(/%29/g, ")");
        urlParts.push(`show=${encodedShow}`);
      }
      if (popupSearchQuery.value) urlParts.push(`pq=${encodeURIComponent(popupSearchQuery.value)}`);
      if (channel.value !== DEFAULT_CHANNEL) urlParts.push(`channel=${channel.value}`);
      if (sortOrder.value !== "stars") urlParts.push(`sort=${sortOrder.value}`);
      if (!isTwoColumns.value) urlParts.push("view=list");

      const queryString = urlParts.join("&");
      return `${location.pathname}${queryString ? "?" + queryString : ""}${targetHash || ""}`;
    };

    let isSyncing = false;
    function syncFromUrl(searchStr) {
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

      if (isWhatsNewView.value && params.has("channel")) {
        params.delete("channel");
        try {
          history.replaceState(null, "", `${location.pathname}?${params.toString()}#whats-new`);
        } catch (e) {}
      }

      query.value = params.get("q") || "";
      channel.value = normalizeChannel(params.get("channel") || DEFAULT_CHANNEL);
      sortOrder.value = params.get("sort") || "stars";
      isTwoColumns.value = params.get("view") !== "list";
      popupSearchQuery.value = params.get("pq") || "";
      bundle.value = params.get("bundle") || "";
      app.value = params.get("app") || "";

      const rawParam = params.get("show");
      let showArr = [];
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
            history.replaceState(
              null,
              "",
              `${location.pathname}?${params.toString().replace(/=&/g, "&").replace(/=$/, "")}#whats-new`,
            );
          } catch (e) {
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
          } catch (e) {}
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
        } catch (e) {}
    });

    watch([query, bundle, app, channel, sortOrder, isTwoColumns, showOptions], (newVals, oldVals) => {
      if (!isSyncing && oldVals?.some((v) => v !== undefined)) isWhatsNewView.value = false;
      if (isSyncing) return;

      const targetHash = isWhatsNewView.value ? "#whats-new" : location.hash === "#whats-new" ? "" : location.hash;
      const newUrl = buildUrlString(targetHash);

      if (location.pathname + location.search + location.hash !== newUrl) {
        if (!oldVals) {
          try {
            history.replaceState(null, "", newUrl);
          } catch (e) {}
        } else {
          const otherChanged =
            oldVals[1] !== newVals[1] ||
            oldVals[2] !== newVals[2] ||
            oldVals[3] !== newVals[3] ||
            JSON.stringify(oldVals[6]) !== JSON.stringify(newVals[6]);
          try {
            otherChanged ? history.pushState(null, "", newUrl) : history.replaceState(null, "", newUrl);
          } catch (e) {}
        }
      }
    });

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
            isLoading.value = false;
            const otherChannel = channel.value === "stable" ? "latest" : "stable";
            setTimeout(() => loadChannelData(otherChannel, [], null).catch(() => {}), 100);
          } else if (activeData.value) {
            activeData.value.rows = [...activeData.value.rows];
            if (isUpdate === true && showOptions.value.length > 0 && !query.value) isLoading.value = false;
          }
        });
        if (!query.value && showOptions.value.length === 0) isLoading.value = false;
      } catch (error) {
        errorMsg.value = error.message || error;
        isLoading.value = false;
      }
    };

    watch(channel, loadData);

    const whatsNewHistory = ref([]);
    const whatsNewAppsData = ref({});
    const isWhatsNewLoading = ref(false);

    const loadWhatsNewData = async () => {
      isWhatsNewLoading.value = true;
      try {
        const [history, apps] = await Promise.all([
          fetchJson(new URL("../data/whats-new.json", import.meta.url)),
          fetchJson(new URL("../data/apps.json", import.meta.url)),
        ]);
        whatsNewHistory.value = history || [];
        whatsNewAppsData.value = apps || {};
      } catch (err) {
        console.error("Failed to load what's new data", err);
      } finally {
        isWhatsNewLoading.value = false;
      }
    };

    const navigateToWhatsNewShow = (trieStr) => {
      const encodedShow = encodeURIComponent(trieStr)
        .replace(/%3A/g, ":")
        .replace(/%2C/g, ",")
        .replace(/%28/g, "(")
        .replace(/%29/g, ")");
      const params = new URLSearchParams(location.search);
      const urlParts = [];
      if (params.get("sort") && params.get("sort") !== "stars") urlParts.push(`sort=${params.get("sort")}`);
      if (params.get("view") === "list") urlParts.push("view=list");
      urlParts.push(`show=${encodedShow}`);

      const newUrl = `${location.pathname}?${urlParts.join("&")}#whats-new`;
      try {
        history.pushState(null, "", newUrl);
      } catch (e) {}
      syncFromUrl(`?${urlParts.join("&")}`);
    };

    const openBundlePopup = (bundleKey, bundleData) => {
      if (!bundleData || bundleData.isNew) return navigateToWhatsNewShow(bundleKey);
      const bundleChanges = {};
      for (const [packageName, data] of Object.entries(bundleData.apps || {})) {
        bundleChanges[packageName] = data.isNew ? [] : [...(data.patches || [])].sort();
      }
      navigateToWhatsNewShow(stringifyTrie({ [bundleKey]: bundleChanges }));
    };

    const openAppPopup = (bundleKey, packageName, appData) => {
      navigateToWhatsNewShow(
        !appData || appData.isNew
          ? `${bundleKey}:${packageName}`
          : stringifyTrie({ [bundleKey]: { [packageName]: [...(appData.patches || [])].sort() } }),
      );
    };

    const openPatchPopup = (bundleKey, packageName, patchName) =>
      navigateToWhatsNewShow(stringifyTrie({ [bundleKey]: { [packageName]: [patchName] } }));

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
      const rowsForSource = filterRows(activeData.value, {
        query: query.value,
        showOptions: app.value ? [`:${app.value}`] : [],
      });
      const bundleOptions = getFilterOptions(rowsForSource, activeData.value.namesMap)
        .bundleOptions.map((opt) => {
          const bObj = activeData.value.bundleMap[opt.value];
          return { ...opt, repo: bObj?.repo.toLowerCase() || "", icon: bObj?.avatarUrl || "" };
        })
        .sort((a, b) =>
          sortBundlesHelper(
            activeData.value.bundleMap[a.value],
            activeData.value.bundleMap[b.value],
            a.value,
            b.value,
            sortOrder.value,
          ),
        );

      const rowsForApp = filterRows(activeData.value, {
        query: query.value,
        showOptions: bundle.value ? [bundle.value] : [],
      });
      return { bundleOptions, appOptions: getFilterOptions(rowsForApp, activeData.value.namesMap).appOptions };
    });

    const filterDropdownOptions = (options, searchValue, extraFields) => {
      const queryWords = searchValue.toLowerCase().split(/\s+/).filter(Boolean);
      if (queryWords.length === 0) return options;
      return options.filter((opt) => {
        const searchable = [opt.label, opt.value, ...extraFields.map((f) => opt[f] || "")].join(" ").toLowerCase();
        return queryWords.every((word) => searchable.includes(word));
      });
    };

    const buildGroupFromRows = (bundleItem, rows, hasFilters) => {
      const patchIdMap = new Map();
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
      const patches = Array.from(patchIdMap.values()).sort((a, b) => a.patchName.localeCompare(b.patchName));
      const appsMap = new Map();

      if (!patchesLoaded.value && bundleItem.targetApps && !hasFilters) {
        for (const packageName of bundleItem.targetApps) {
          appsMap.set(packageName, {
            id: `${bundleItem.key}:${packageName}`,
            appName: appName(packageName, activeData.value.namesMap, activeData.value.skipSet),
            appIcon: activeData.value.namesMap[packageName]?.iconUrl || "",
            packageName,
            versions: [],
          });
        }
      }
      for (const patch of patches) for (const appItem of patch.apps) appsMap.set(appItem.packageName, appItem);

      const appsList = Array.from(appsMap.values()).sort((a, b) => {
        if ((a.packageName === "universal") !== (b.packageName === "universal"))
          return (a.packageName === "universal" ? 1 : 0) - (b.packageName === "universal" ? 1 : 0);
        return a.appName.localeCompare(b.appName);
      });

      return { key: bundleItem.key, bundle: bundleItem, rows, patches, appsList };
    };

    const bundlesGroups = computed(() => {
      if (!activeData.value || !backgroundReady.value) return [];
      const queryWords = (query.value || "").toLowerCase().split(/\s+/).filter(Boolean);
      const targetPrefix = `${bundle.value || ""}${app.value ? ":" + app.value : ""}`;
      const hasFilters = queryWords.length > 0 || !!targetPrefix;

      return activeData.value.bundles
        .map((bItem) =>
          buildGroupFromRows(
            bItem,
            filteredRows.value.filter((r) => r.bundleKey === bItem.key),
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
        .sort((a, b) => sortBundlesHelper(a.bundle, b.bundle, a.key, b.key, sortOrder.value));
    });

    const mainUI = useListUI("");
    const popupUI = useListUI("popup_");

    const expandAll = () =>
      bundlesGroups.value.forEach(
        (group) => group.appsList?.length && mainUI.expandedOptions.add(`app_${group.key}_${group.appsList[0].id}`),
      );
    const collapseAll = () => bundlesGroups.value.forEach((group) => mainUI.collapseBundle(group));
    const toggleBundle = (groupItem) => {
      if (groupItem.appsList?.length > 0) {
        if (
          groupItem.appsList.some((appItem) => mainUI.expandedOptions.has(`app_${groupItem.key}_${appItem.id}`)) ||
          mainUI.bundleViews[groupItem.key]
        ) {
          mainUI.collapseBundle(groupItem);
        } else {
          mainUI.expandedOptions.add(`app_${groupItem.key}_${groupItem.appsList[0].id}`);
        }
      }
    };

    watch(bundlesGroups, (newGroups) => {
      if (newGroups?.length === 1 && !popupBundleKey.value && newGroups[0].appsList?.length > 0) {
        const group = newGroups[0];
        if (!group.appsList.some((appItem) => mainUI.expandedOptions.has(`app_${group.key}_${appItem.id}`)))
          mainUI.expandedOptions.add(`app_${group.key}_${group.appsList[0].id}`);
      }
    });

    const openPopupFast = (groupKey) => {
      const params = new URLSearchParams();
      if (channel.value !== DEFAULT_CHANNEL) params.set("channel", channel.value);
      params.set("show", groupKey);
      const newUrl = `?${params.toString()}${location.hash === "#whats-new" ? "#whats-new" : ""}`;
      try {
        history.pushState(null, "", newUrl);
      } catch (e) {}
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
      } catch (e) {
        if (isWhatsNewView.value) location.hash = "whats-new";
      }
      syncFromUrl(urlParams.toString() ? "?" + urlParams.toString() : "");
    };

    const autoExpandPopupApp = () => {
      if (popupBundleKey.value) {
        const group = popupGroup.value;
        if (group && group.key === popupBundleKey.value && group.appsList?.length > 0) {
          const targetApp = app.value
            ? group.appsList.find((a) => a.packageName === app.value) || group.appsList[0]
            : group.appsList[0];
          if (!group.appsList.some((a) => popupUI.expandedOptions.has(`popup_app_${group.key}_${a.id}`))) {
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
      const bundleItem = activeData.value.bundles.find((b) => b.key === popupBundleKey.value);
      if (!bundleItem) return null;
      const rows = filterRows(activeData.value, {
        query: popupSearchQuery.value,
        showOptions: showOptions.value,
      }).filter((r) => r.bundleKey === popupBundleKey.value);
      return buildGroupFromRows(
        bundleItem,
        rows,
        (popupSearchQuery.value || "").trim().length > 0 || showOptions.value.length > 0,
      );
    });

    watch(popupGroup, (newGroup) => {
      if (!newGroup) return;
      if (!popupUI.bundleViews[newGroup.key] && newGroup.appsList?.length > 0) {
        const hasExpanded = newGroup.appsList.some((a) => popupUI.expandedOptions.has(`popup_app_${newGroup.key}_${a.id}`));
        if (!hasExpanded) {
          const targetApp = app.value
            ? newGroup.appsList.find((a) => a.packageName === app.value) || newGroup.appsList[0]
            : newGroup.appsList[0];
          popupUI.expandedOptions.add(`popup_app_${newGroup.key}_${targetApp.id}`);
        }
      }
      if (
        (showOptions.value.length === 1 && showOptions.value[0].includes(":")) ||
        (popupSearchQuery.value || "").trim().length > 0 ||
        newGroup.appsList.length <= 1
      ) {
        if (!popupUI.expandedAppLists.has(newGroup.key)) popupUI.expandedAppLists.add(newGroup.key);
        if (
          newGroup.appsList.length > 0 &&
          !popupUI.expandedOptions.has(`popup_app_${newGroup.key}_${newGroup.appsList[0].id}`)
        )
          popupUI.expandedOptions.add(`popup_app_${newGroup.key}_${newGroup.appsList[0].id}`);
      }
    });

    const popupAllApps = computed(() => {
      const bundleItem = activeData.value?.bundles.find((b) => b.key === popupBundleKey.value);
      return (bundleItem?.targetApps || [])
        .map((pkg) => ({
          value: pkg,
          label: appName(pkg, activeData.value.namesMap, activeData.value.skipSet),
          icon: activeData.value.namesMap[pkg]?.iconUrl || "",
        }))
        .sort(
          (a, b) =>
            (a.value === "universal" ? 1 : 0) - (b.value === "universal" ? 1 : 0) || a.label.localeCompare(b.label),
        );
    });

    const selectPopupAppFromDropdown = (appValue) => {
      isSyncing = true;
      popupUI.expandedOptions.clear();
      const newShow = appValue ? `${popupBundleKey.value}:${appValue}` : popupBundleKey.value;
      showOptions.value = [newShow];
      if (isWhatsNewView.value) rawShowParam.value = newShow;
      try {
        history.pushState(null, "", buildUrlString(location.hash));
      } catch (e) {}
      nextTick(() => {
        isSyncing = false;
        if (!appValue) {
          autoExpandPopupApp();
        }
      });
    };

    const filterByApp = (packageName) => {
      if (popupBundleKey.value) {
        document.body.style.overflow = "";
        popupBundleKey.value = null;
      }
      resetFilters();
      app.value = packageName;
    };
    const resetFilters = () => {
      query.value =
        bundle.value =
        app.value =
        appSearch.value =
        bundleSearch.value =
        popupSearchQuery.value =
        popupAppSearch.value =
          "";
      showOptions.value = [];
      isWhatsNewView.value = false;
      mainUI.clearState();
    };

    const copiedStates = reactive({});
    const copyText = (text, key) =>
      navigator.clipboard
        .writeText(text)
        .then(() => {
          copiedStates[key] = true;
          setTimeout(() => (copiedStates[key] = false), 1500);
        })
        .catch(() => {});

    return {
      query,
      bundle,
      app,
      showOptions,
      appSearch,
      bundleSearch,
      channel,
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
      filteredAppOptions: computed(() => filterDropdownOptions(filterOptions.value.appOptions, appSearch.value, [])),
      filteredBundleOptions: computed(() =>
        filterDropdownOptions(filterOptions.value.bundleOptions, bundleSearch.value, ["repo"]),
      ),
      filteredPopupAllApps: computed(() =>
        filterDropdownOptions(popupAllApps.value, popupAppSearch.value, ["label", "value"]),
      ),

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
          } catch (e) {}
        }
      },
      openPopupFast,
      closePopup,
      selectPopupAppFromDropdown,
      selectBundleFromDropdown: (key) => (bundle.value = key || ""),
      openBundlePopup,
      openAppPopup,
      openPatchPopup,
      copyText,
      copiedStates,

      formatDate: (value) =>
        value
          ? isNaN(new Date(value).getTime())
            ? ""
            : new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
          : "",
      playUrl: (pkg) => `https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}`,
      getWhatsNewAppIcon: (pkg) => whatsNewAppsData.value[pkg]?.iconUrl || "",
      formatWhatsNewAppName: (pkg) => appName(pkg, whatsNewAppsData.value, activeData.value?.skipSet),
      getAppName: (pkg) => (pkg ? appName(pkg, activeData.value?.namesMap, activeData.value?.skipSet) : "All Apps"),
      getAppIcon: (pkg) => activeData.value?.namesMap[pkg]?.iconUrl || "",
      getBundleIcon: (key) => activeData.value?.bundleMap[key]?.avatarUrl || "",
      toggleColumns: () => (isTwoColumns.value = !isTwoColumns.value),
      isNewBundle: (group) =>
        !isWhatsNewView.value &&
        group?.bundle?.firstSeen &&
        (Date.now() - new Date(group.bundle.firstSeen).getTime()) / 86400000 <= 7,
      hasHighlight: (prefix) => isWhatsNewView.value && whatsNewHighlights.value.includes(prefix),
      isAppHighlighted: (groupKey, appItem) =>
        isWhatsNewView.value &&
        (whatsNewHighlights.value.includes(`${groupKey}:${appItem.packageName}`) ||
          whatsNewHighlights.value.includes(`${groupKey}:${appItem.appName}`)),
      isShowingFullBundle: (groupKey) =>
        showOptions.value.length === 0 || (showOptions.value.length === 1 && showOptions.value[0] === groupKey),
    };
  },
});

app.config.errorHandler = (err, vm, info) => {
  const banner = document.getElementById("debug-error-banner");
  const msg = document.getElementById("debug-error-msg");
  if (banner && msg) {
    banner.style.display = "block";
    msg.textContent = `Vue Error: ${err.stack || err.message} (info: ${info})`;
  }
  console.error(err);
};
app.mount("#app");
