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
  if (current.trim()) {
    tokens.push({ type: "LITERAL", value: current.trim() });
  }
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
        if (pos < tokens.length && tokens[pos].type === ",") {
          pos++;
        }
      }
      if (pos < tokens.length && tokens[pos].type === ")") {
        pos++;
      }
    } else {
      const tokenValue = tokens[pos].value;
      pos++;
      const newPrefix = prefixItem !== null && prefixItem !== undefined ? prefixItem + ":" + tokenValue : tokenValue;

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
    const sortBundlesHelper = (bundleA, bundleB, keyA, keyB, order) => {
      if (order === "apps") {
        const countA = bundleA?.appCount || 0;
        const countB = bundleB?.appCount || 0;
        if (countA !== countB) return countB - countA;
      } else if (order === "patches") {
        const countA = bundleA?.patchCount || 0;
        const countB = bundleB?.patchCount || 0;
        if (countA !== countB) return countB - countA;
      } else if (order === "latest") {
        const dateA = bundleA?.createdAt ? new Date(bundleA.createdAt).getTime() : 0;
        const dateB = bundleB?.createdAt ? new Date(bundleB.createdAt).getTime() : 0;
        if (dateA !== dateB) return dateB - dateA;
      } else if (order === "stars") {
        const starsA = bundleA?.stars || 0;
        const starsB = bundleB?.stars || 0;
        if (starsA !== starsB) return starsB - starsA;
      }
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
        const isNew = location.hash === "#whats-new";
        if (isWhatsNewView.value !== isNew) isWhatsNewView.value = isNew;
      }

      // Strip channel when entering What's New — it always uses the default (latest) channel
      if (isWhatsNewView.value && params.has("channel")) {
        params.delete("channel");
        const queryString = params.toString();
        const newUrl = `${location.pathname}${queryString ? "?" + queryString : ""}#whats-new`;
        try {
          history.replaceState(null, "", newUrl);
        } catch (error) {
          /* Ignore cross-origin iframe DOMExceptions */
        }
      }

      const newQuery = params.get("q") || "";
      if (query.value !== newQuery) query.value = newQuery;

      const newChannel = normalizeChannel(params.get("channel") || DEFAULT_CHANNEL);
      if (channel.value !== newChannel) channel.value = newChannel;

      const newSortOrder = params.get("sort") || "stars";
      if (sortOrder.value !== newSortOrder) sortOrder.value = newSortOrder;

      const isList = params.get("view") === "list";
      const newIsTwoColumns = !isList;
      if (isTwoColumns.value !== newIsTwoColumns) isTwoColumns.value = newIsTwoColumns;

      const newBundle = params.get("bundle") || "";
      if (bundle.value !== newBundle) bundle.value = newBundle;

      const newApp = params.get("app") || "";
      if (app.value !== newApp) app.value = newApp;

      const rawParam = params.get("show");
      let showArr = [];
      let foundValidPopup = false;

      if (rawParam) {
        rawShowParam.value = decodeURIComponent(rawParam);
        showArr = parseShowTrie(rawShowParam.value);

        const bundlesInShow = new Set(showArr.map((item) => item.split(":")[0]).filter(Boolean));

        if (bundlesInShow.size === 1) {
          foundValidPopup = true;
          if (JSON.stringify(showOptions.value) !== JSON.stringify(showArr)) {
            showOptions.value = showArr;
          }
          const targetBundle = Array.from(bundlesInShow)[0];
          if (popupBundleKey.value !== targetBundle) {
            popupBundleKey.value = targetBundle;
            document.body.style.overflow = "hidden";
          }
        } else {
          params.delete("show");
          const queryString = params.toString().replace(/=&/g, "&").replace(/=$/, "");
          const newUrl = `${location.pathname}${queryString ? "?" + queryString : ""}#whats-new`;
          try {
            history.replaceState(null, "", newUrl);
          } catch (error) {
            /* Ignore cross-origin iframe DOMExceptions */
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
        if (showOptions.value.length > 0) showOptions.value = [];
        if (popupBundleKey.value) {
          popupBundleKey.value = null;
          document.body.style.overflow = "";
        }
      }

      whatsNewHighlights.value = isWhatsNewView.value && showOptions.value.length > 0 ? showOptions.value : [];

      nextTick(() => {
        if (hadNewParam) {
          const newUrl = buildUrlString("#whats-new");
          try {
            history.replaceState(null, "", newUrl);
          } catch (error) {
            /* Ignore cross-origin iframe DOMExceptions */
          }
        }
        isSyncing = false;
      });
    }
    syncFromUrl(location.search);

    window.addEventListener("popstate", () => {
      syncFromUrl(location.search);
    });
    window.addEventListener("hashchange", () => {
      syncFromUrl(location.search);
    });

    const hasHighlight = (highlightPrefix) => {
      if (!isWhatsNewView.value) return false;
      return (
        whatsNewHighlights.value.includes(highlightPrefix) ||
        whatsNewHighlights.value.some((prefixItem) => prefixItem.startsWith(highlightPrefix + ":"))
      );
    };

    watch(
      [query, bundle, app, channel, sortOrder, isTwoColumns, showOptions],
      (newVals, oldVals) => {
        if (!isSyncing && oldVals && oldVals.some((value) => value !== undefined)) {
          isWhatsNewView.value = false;
        }

        if (isSyncing) return;

        let targetHash = location.hash;
        if (!isWhatsNewView.value && targetHash === "#whats-new") {
          targetHash = "";
        } else if (isWhatsNewView.value) {
          targetHash = "#whats-new";
        }

        const newUrl = buildUrlString(targetHash);
        const currentUrl = location.pathname + location.search + location.hash;

        if (currentUrl !== newUrl) {
          if (!oldVals) {
            try {
              history.replaceState(null, "", newUrl);
            } catch (error) {
              /* Ignore cross-origin iframe DOMExceptions */
            }
          } else {
            const otherChanged =
              oldVals[0] !== newVals[0] ||
              oldVals[1] !== newVals[1] ||
              oldVals[2] !== newVals[2] ||
              oldVals[3] !== newVals[3] ||
              JSON.stringify(oldVals[6]) !== JSON.stringify(newVals[6]);

            if (otherChanged) {
              try {
                history.pushState(null, "", newUrl);
              } catch (error) {
                /* Ignore cross-origin iframe DOMExceptions */
              }
            } else {
              try {
                history.replaceState(null, "", newUrl);
              } catch (error) {
                /* Ignore cross-origin iframe DOMExceptions */
              }
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
            isLoading.value = false;

            const otherChannel = channel.value === "stable" ? "latest" : "stable";
            setTimeout(() => {
              loadChannelData(otherChannel, [], null).catch(() => {});
            }, 100);
          } else if (activeData.value) {
            activeData.value.rows = [...activeData.value.rows];
            if (isUpdate === true && showOptions.value.length > 0 && !query.value) {
              isLoading.value = false;
            }
          }
        });

        if (!query.value && showOptions.value.length === 0) {
          isLoading.value = false;
        }
      } catch (error) {
        errorMsg.value = error.message || error;
        isLoading.value = false;
      }
    };

    const isShowingFullBundle = (groupKey) => {
      if (showOptions.value.length === 0) return true;
      if (showOptions.value.length === 1 && showOptions.value[0] === groupKey) return true;
      return false;
    };

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

    const getWhatsNewAppIcon = (packageName) => {
      return whatsNewAppsData.value[packageName]?.iconUrl || "";
    };

    const formatWhatsNewAppName = (packageName) => {
      return appName(packageName, whatsNewAppsData.value, activeData.value ? activeData.value.skipSet : null);
    };

    const formatPatchName = (patchName) => {
      if (typeof patchName !== "string") return patchName;
      if (/[:,()]/.test(patchName)) return `"${patchName}"`;
      return patchName;
    };

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
          if (appStrs.length === 1) {
            bundleStrs.push(`${bundle}:${appStrs[0]}`);
          } else {
            bundleStrs.push(`${bundle}:(${appStrs.join(",")})`);
          }
        }
      }
      return bundleStrs.join(",");
    };

    const navigateToWhatsNewShow = (trieStr) => {
      const encodedShow = encodeURIComponent(trieStr)
        .replace(/%3A/g, ":")
        .replace(/%2C/g, ",")
        .replace(/%28/g, "(")
        .replace(/%29/g, ")");

      // What's New always uses the default (latest) channel — strip channel param.
      // Preserve sort and view so settings are retained when returning to search.
      const currentParams = new URLSearchParams(location.search);
      const urlParts = [];
      if (currentParams.get("sort") && currentParams.get("sort") !== "stars")
        urlParts.push(`sort=${currentParams.get("sort")}`);
      if (currentParams.get("view") === "list") urlParts.push("view=list");
      urlParts.push(`show=${encodedShow}`);

      const newUrl = `${location.pathname}?${urlParts.join("&")}#whats-new`;
      try {
        history.pushState(null, "", newUrl);
      } catch (error) {
        /* Ignore cross-origin iframe DOMExceptions */
      }
      syncFromUrl(location.search);
    };

    const openBundlePopup = (bundleKey, bundleData) => {
      if (!bundleData || bundleData.isNew) {
        navigateToWhatsNewShow(bundleKey);
      } else {
        const bundleChanges = {};
        for (const [packageName, data] of Object.entries(bundleData.apps || {})) {
          if (data.isNew) {
            bundleChanges[packageName] = [];
          } else {
            bundleChanges[packageName] = [...(data.patches || [])].sort();
          }
        }
        navigateToWhatsNewShow(stringifyTrie({ [bundleKey]: bundleChanges }));
      }
    };
    const openAppPopup = (bundleKey, packageName, appData) => {
      if (!appData || appData.isNew) {
        navigateToWhatsNewShow(`${bundleKey}:${packageName}`);
      } else {
        navigateToWhatsNewShow(stringifyTrie({ [bundleKey]: { [packageName]: [...(appData.patches || [])].sort() } }));
      }
    };
    const openPatchPopup = (bundleKey, packageName, patchName) => {
      navigateToWhatsNewShow(stringifyTrie({ [bundleKey]: { [packageName]: [patchName] } }));
    };

    watch(isWhatsNewView, (newVal) => {
      if (newVal && whatsNewHistory.value.length === 0) {
        loadWhatsNewData();
      }
    });

    onMounted(async () => {
      syncFromUrl(location.search);
      if (isWhatsNewView.value && whatsNewHistory.value.length === 0) {
        await loadWhatsNewData();
      }
      loadData();
      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && popupBundleKey.value) {
          closePopup();
        }
      });
    });
    watch(channel, loadData);

    const filteredRows = computed(() => {
      if (!activeData.value) return [];
      let currentShowOptions =
        popupBundleKey.value && !(isWhatsNewView.value && showOptions.value.length > 0) ? [] : showOptions.value;
      if (currentShowOptions.length === 0) {
        const targetPrefix = `${bundle.value || ""}${app.value ? ":" + app.value : ""}`;
        if (targetPrefix) currentShowOptions = [targetPrefix];
      }
      return filterRows(activeData.value, {
        query: query.value,
        showOptions: currentShowOptions,
      });
    });

    const filterOptions = computed(() => {
      if (!activeData.value) return { bundleOptions: [], appOptions: [] };

      const rowsForSource = filterRows(activeData.value, {
        query: query.value,
        showOptions: app.value ? [`:${app.value}`] : [],
      });

      let bundleOptions = getFilterOptions(rowsForSource, activeData.value.namesMap).bundleOptions.map(
        (bundleOption) => {
          const bundleObj = activeData.value.bundleMap[bundleOption.value];
          const repo = bundleObj ? bundleObj.repo.toLowerCase() : "";
          const icon = bundleObj ? bundleObj.avatarUrl : "";
          return { ...bundleOption, repo, icon };
        },
      );

      bundleOptions = [...bundleOptions].sort((bundleA, bundleB) =>
        sortBundlesHelper(
          activeData.value.bundleMap[bundleA.value],
          activeData.value.bundleMap[bundleB.value],
          bundleA.value,
          bundleB.value,
          sortOrder.value,
        ),
      );

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
      return options.filter((optionItem) => {
        const searchable = [optionItem.label, optionItem.value, ...extraFields.map((field) => optionItem[field] || "")]
          .join(" ")
          .toLowerCase();
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
        .map((bundleItem) => {
          const rows = filteredRows.value.filter((rowItem) => rowItem.bundleKey === bundleItem.key);

          const patchIdMap = new Map();
          for (const rowItem of rows) {
            if (!patchIdMap.has(rowItem.patchId)) {
              patchIdMap.set(rowItem.patchId, {
                id: rowItem.patchId,
                patchName: rowItem.patchName,
                description: rowItem.description,
                enabled: rowItem.enabled,
                options: rowItem.options || [],
                apps: [],
              });
            }
            if (rowItem.packageName || rowItem.appName) {
              patchIdMap.get(rowItem.patchId).apps.push({
                id: rowItem.id,
                appName: rowItem.appName,
                appIcon: rowItem.appIcon,
                packageName: rowItem.packageName,
                versions: rowItem.versions,
              });
            }
          }
          const patches = Array.from(patchIdMap.values()).sort((patchA, patchB) =>
            patchA.patchName.localeCompare(patchB.patchName),
          );

          const appsMap = new Map();

          const hasFilters = queryWords.length > 0 || showOptions.value.length > 0;
          if (!patchesLoaded.value && bundleItem.targetApps && !hasFilters) {
            for (const packageName of bundleItem.targetApps) {
              const name = appName(packageName, activeData.value.namesMap, activeData.value.skipSet);
              appsMap.set(packageName, {
                id: `${bundleItem.key}:${packageName}`,
                appName: name,
                appIcon: activeData.value.namesMap[packageName]?.iconUrl || "",
                packageName,
                versions: [],
              });
            }
          }

          for (const patchItem of patches) {
            for (const appItem of patchItem.apps) {
              const appKey = appItem.packageName || appItem.appName || "any";
              appsMap.set(appKey, appItem);
            }
          }

          const appsList = Array.from(appsMap.values()).sort((appA, appB) => {
            const isAnyA = !appA.packageName || appA.packageName === "universal" ? 1 : 0;
            const isAnyB = !appB.packageName || appB.packageName === "universal" ? 1 : 0;
            if (isAnyA !== isAnyB) return isAnyA - isAnyB;
            return (appA.appName || "").localeCompare(appB.appName || "");
          });

          return {
            key: bundleItem.key,
            bundle: bundleItem,
            rows,
            patches,
            appsList,
          };
        })
        .filter((groupItem) => {
          if (groupItem.rows.length > 0) return true;
          if (patchesLoaded.value) return false;

          let currentShowOptions = showOptions.value;
          if (currentShowOptions.length === 0) {
            const targetPrefix = `${bundle.value || ""}${app.value ? ":" + app.value : ""}`;
            if (targetPrefix) currentShowOptions = [targetPrefix];
          }

          if (currentShowOptions.length > 0) {
            const matched = currentShowOptions.some((showOpt) => {
              const parts = showOpt.split(":");
              const targetBundle = parts[0];
              const targetApp = parts.length > 1 ? parts[1] : "";
              if (targetBundle && targetBundle !== groupItem.key) return false;
              if (targetApp && targetApp !== "universal" && !groupItem.bundle.targetApps?.includes(targetApp))
                return false;
              return true;
            });
            if (!matched) return false;
          }

          if (queryWords.length > 0) {
            const appNamesStr = (groupItem.bundle.targetApps || [])
              .map((pkg) => appName(pkg, activeData.value.namesMap, activeData.value.skipSet))
              .join(" ");
            const searchable = [
              groupItem.key,
              groupItem.bundle.repo,
              ...(groupItem.bundle.targetApps || []),
              appNamesStr,
            ]
              .join(" ")
              .toLowerCase();
            if (!queryWords.every((word) => searchable.includes(word))) return false;
          }

          return true;
        })
        .sort((groupA, groupB) =>
          sortBundlesHelper(groupA.bundle, groupB.bundle, groupA.key, groupB.key, sortOrder.value),
        );
    });

    const effectiveTwoColumns = computed(() => (bundlesGroups.value.length === 1 ? false : isTwoColumns.value));

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
    const bundleViews = reactive({});
    const appListRefs = new Map();

    const expandAll = () => {
      bundlesGroups.value.forEach((groupItem) => {
        if (groupItem.appsList && groupItem.appsList.length > 0) {
          const firstApp = groupItem.appsList[0];
          expandedOptions.add("app_" + groupItem.key + "_" + firstApp.id);
        }
      });
    };

    const collapseBundle = (groupItem) => {
      bundleViews[groupItem.key] = false;
      expandedAppLists.delete(groupItem.key);
      if (groupItem.appsList) {
        groupItem.appsList.forEach((appItem) => {
          expandedOptions.delete("app_" + groupItem.key + "_" + appItem.id);
        });
      }
      if (groupItem.patches) {
        groupItem.patches.forEach((patch) => {
          expandedOptions.delete(patch.id);
          if (patch.apps) {
            patch.apps.forEach((appElem) => {
              expandedVersions.delete(appElem.id);
            });
          }
        });
      }
    };

    const collapseAll = () => {
      bundlesGroups.value.forEach((groupItem) => {
        collapseBundle(groupItem);
      });
    };

    const checkOverflow = (element, key) => {
      if (!element) return;
      if (expandedAppLists.has(key)) {
        overflowingAppLists.add(key);
        return;
      }
      if (element.scrollHeight > Math.ceil(element.clientHeight) + 2) {
        overflowingAppLists.add(key);
      } else {
        overflowingAppLists.delete(key);
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
        if (oldElement && oldElement.resizeObserver) {
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

    watch(bundlesGroups, (newGroups) => {
      if (newGroups && newGroups.length === 1 && !popupBundleKey.value) {
        const singleGroup = newGroups[0];
        if (singleGroup.appsList && singleGroup.appsList.length > 0) {
          const firstApp = singleGroup.appsList[0];
          const appKey = "app_" + singleGroup.key + "_" + firstApp.id;
          const isAnyExpanded = singleGroup.appsList.some((appItem) =>
            expandedOptions.has("app_" + singleGroup.key + "_" + appItem.id),
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
        appsList.forEach((appItem) => {
          const key = "app_" + groupKey + "_" + appItem.id;
          if (expandedOptions.has(key)) {
            expandedOptions.delete(key);
          }
        });
        if (!isCurrentlyExpanded) {
          expandedOptions.add(clickedKey);
          nextTick(() => {
            const buttonElement = document.getElementById("tab_" + groupKey + "_" + clickedApp.id);
            if (buttonElement) {
              const container = buttonElement.parentElement;
              if (container) {
                container.scrollTo({
                  top: buttonElement.offsetTop - container.clientHeight / 2 + buttonElement.clientHeight / 2,
                  behavior: "smooth",
                });
              }
            }
          });
        } else {
          expandedAppLists.delete(groupKey);
        }
      } else {
        if (isCurrentlyExpanded) {
          expandedOptions.delete(clickedKey);
        } else {
          expandedOptions.add(clickedKey);
        }
      }
    };

    const toggleBundle = (groupItem) => {
      if (groupItem.appsList && groupItem.appsList.length > 0) {
        const isAnyExpanded = groupItem.appsList.some((appItem) =>
          expandedOptions.has("app_" + groupItem.key + "_" + appItem.id),
        );
        if (isAnyExpanded || bundleViews[groupItem.key]) {
          collapseBundle(groupItem);
        } else {
          expandedOptions.add("app_" + groupItem.key + "_" + groupItem.appsList[0].id);
        }
      }
    };

    const getBundlePopupUrl = (groupKey) => {
      const params = new URLSearchParams();
      if (channel.value !== DEFAULT_CHANNEL) params.set("channel", channel.value);
      params.set("show", groupKey);
      return `?${params.toString()}${location.hash === "#whats-new" ? "#whats-new" : ""}`;
    };

    const openPopupFast = (groupKey) => {
      const newUrl = getBundlePopupUrl(groupKey);
      try {
        history.pushState(null, "", newUrl);
      } catch (error) {
        /* Ignore cross-origin iframe DOMExceptions */
      }
      syncFromUrl(location.search);
    };

    const closePopup = () => {
      document.body.style.overflow = "";
      popupBundleKey.value = null;
      if (isWhatsNewView.value) {
        const urlParams = new URLSearchParams(location.search);
        urlParams.delete("show");
        const newUrl = `${location.pathname}${urlParams.toString() ? "?" + urlParams.toString() : ""}#whats-new`;
        try {
          history.replaceState(null, "", newUrl);
        } catch (error) {
          location.hash = "whats-new";
        }
        syncFromUrl(location.search);
      } else {
        const urlParams = new URLSearchParams(location.search);
        urlParams.delete("show");
        const newUrl = `${location.pathname}${urlParams.toString() ? "?" + urlParams.toString() : ""}${location.hash}`;
        try {
          history.pushState(null, "", newUrl);
        } catch (error) {
          /* Ignore cross-origin iframe DOMExceptions */
        }

        syncFromUrl(location.search);
      }
    };

    const selectBundleFromDropdown = (bundleKey) => {
      bundle.value = bundleKey || "";
    };

    const popupExpandedOptions = reactive(new Set());
    const popupExpandedAppLists = reactive(new Set());
    const popupOverflowingAppLists = reactive(new Set());
    const popupAppListRefs = new Map();
    const popupBundleViews = reactive({});
    const popupActiveSwipeGroup = ref("");
    const popupSwipeDirection = ref("");
    const popupExpandedVersions = reactive(new Set());

    const togglePopupOptions = (id) =>
      popupExpandedOptions.has(id) ? popupExpandedOptions.delete(id) : popupExpandedOptions.add(id);
    const togglePopupVersions = (id) =>
      popupExpandedVersions.has(id) ? popupExpandedVersions.delete(id) : popupExpandedVersions.add(id);

    const checkPopupOverflow = (element, key) => {
      if (!element) return;
      if (popupExpandedAppLists.has(key)) {
        popupOverflowingAppLists.add(key);
        return;
      }
      if (element.scrollHeight > Math.ceil(element.clientHeight) + 2) {
        popupOverflowingAppLists.add(key);
      } else {
        popupOverflowingAppLists.delete(key);
      }
    };

    const setupPopupOverflowObserver = (element, key) => {
      if (element) {
        popupAppListRefs.set(key, element);
        if (!element.resizeObserver) {
          const observer = new ResizeObserver(() => checkPopupOverflow(element, key));
          observer.observe(element);
          element.resizeObserver = observer;
        }
        checkPopupOverflow(element, key);
      } else {
        const oldElement = popupAppListRefs.get(key);
        if (oldElement && oldElement.resizeObserver) {
          oldElement.resizeObserver.disconnect();
          oldElement.resizeObserver = null;
        }
        popupAppListRefs.delete(key);
      }
    };

    const togglePopupAppList = (id) => {
      popupExpandedAppLists.has(id) ? popupExpandedAppLists.delete(id) : popupExpandedAppLists.add(id);
      setTimeout(() => {
        const element = popupAppListRefs.get(id);
        if (element) checkPopupOverflow(element, id);
      }, 50);
    };

    const selectPopupApp = (groupKey, clickedApp, appsList) => {
      popupActiveSwipeGroup.value = "";
      popupSwipeDirection.value = "";
      const clickedKey = "popup_app_" + groupKey + "_" + clickedApp.id;
      const isCurrentlyExpanded = popupExpandedOptions.has(clickedKey);

      if (!popupBundleViews[groupKey]) {
        appsList.forEach((appItem) => {
          const key = "popup_app_" + groupKey + "_" + appItem.id;
          if (key !== clickedKey && popupExpandedOptions.has(key)) {
            popupExpandedOptions.delete(key);
          }
        });
        if (!isCurrentlyExpanded) {
          popupExpandedOptions.add(clickedKey);
          nextTick(() => {
            const buttonElement = document.getElementById("tab_popup_" + groupKey + "_" + clickedApp.id);
            if (buttonElement) {
              const container = buttonElement.parentElement;
              if (container) {
                container.scrollTo({
                  top: buttonElement.offsetTop - container.clientHeight / 2 + buttonElement.clientHeight / 2,
                  behavior: "smooth",
                });
              }
            }
          });
        } else {
          popupExpandedAppLists.delete(groupKey);
        }
      } else {
        if (isCurrentlyExpanded) {
          popupExpandedOptions.delete(clickedKey);
        } else {
          popupExpandedOptions.add(clickedKey);
        }
      }
    };

    const popupTouchStartX = ref(0);
    const popupTouchStartY = ref(0);

    const handlePopupTouchStart = (event) => {
      if (event.touches && event.touches.length > 0) {
        popupTouchStartX.value = event.touches[0].clientX;
        popupTouchStartY.value = event.touches[0].clientY;
      }
    };

    const handlePopupTouchEnd = (event, groupKey, currentApp, appsList) => {
      if (!event.changedTouches || event.changedTouches.length === 0) return;
      const deltaX = event.changedTouches[0].clientX - popupTouchStartX.value;
      const deltaY = event.changedTouches[0].clientY - popupTouchStartY.value;
      if (Math.abs(deltaX) > 60 && Math.abs(deltaY) < 40) {
        const currentIndex = appsList.findIndex((appItem) => appItem.id === currentApp.id);
        if (currentIndex !== -1) {
          if (deltaX < 0) {
            if (currentIndex < appsList.length - 1) {
              popupActiveSwipeGroup.value = groupKey;
              popupSwipeDirection.value = "left";
              selectPopupApp(groupKey, appsList[currentIndex + 1], appsList);
            }
          } else {
            if (currentIndex > 0) {
              popupActiveSwipeGroup.value = groupKey;
              popupSwipeDirection.value = "right";
              selectPopupApp(groupKey, appsList[currentIndex - 1], appsList);
            }
          }
        }
      }
    };

    const togglePopupBundleView = (groupItem) => {
      const key = typeof groupItem === "string" ? groupItem : groupItem.key;
      popupBundleViews[key] = !popupBundleViews[key];

      if (!popupBundleViews[key] && groupItem.appsList) {
        groupItem.appsList.forEach((appItem) => {
          popupExpandedOptions.delete("popup_app_" + key + "_" + appItem.id);
        });
        if (groupItem.patches) {
          groupItem.patches.forEach((patch) => {
            popupExpandedOptions.delete(patch.id);
            if (patch.apps) {
              patch.apps.forEach((appElem) => {
                popupExpandedVersions.delete(appElem.id);
              });
            }
          });
        }
      }
    };

    const autoExpandPopupApp = () => {
      if (popupBundleKey.value) {
        const singleGroup = bundlesGroups.value.find((groupItem) => groupItem.key === popupBundleKey.value);
        if (singleGroup && singleGroup.appsList && singleGroup.appsList.length > 0) {
          let targetApp = singleGroup.appsList[0];
          if (app.value) {
            const matchedApp = singleGroup.appsList.find(
              (appItem) => appItem.packageName === app.value || appItem.appName === app.value,
            );
            if (matchedApp) targetApp = matchedApp;
          }
          const appKey = "popup_app_" + singleGroup.key + "_" + targetApp.id;
          const isAnyExpanded = singleGroup.appsList.some((appItem) =>
            popupExpandedOptions.has("popup_app_" + singleGroup.key + "_" + appItem.id),
          );
          if (!isAnyExpanded) {
            popupExpandedOptions.add(appKey);
            nextTick(() => {
              const buttonElement = document.getElementById("tab_popup_" + singleGroup.key + "_" + targetApp.id);
              if (buttonElement) {
                const container = buttonElement.parentElement;
                if (container) {
                  container.scrollTo({
                    top: buttonElement.offsetTop - container.clientHeight / 2 + buttonElement.clientHeight / 2,
                    behavior: "smooth",
                  });
                }
              }
            });
          }
        }
      }
    };

    watch(popupBundleKey, (newKey) => {
      if (newKey) {
        autoExpandPopupApp();
      } else {
        popupExpandedOptions.clear();
        popupExpandedAppLists.clear();
        for (const key in popupBundleViews) delete popupBundleViews[key];
      }
    });

    watch(patchesLoaded, (loaded) => {
      if (loaded && popupBundleKey.value) {
        popupExpandedOptions.clear();
        nextTick(() => {
          autoExpandPopupApp();
        });
      }
    });

    const popupGroup = computed(() => {
      return bundlesGroups.value.find((groupItem) => groupItem.key === popupBundleKey.value) || null;
    });

    const touchStartX = ref(0);
    const touchStartY = ref(0);

    const handleTouchStart = (event) => {
      if (event.touches && event.touches.length > 0) {
        touchStartX.value = event.touches[0].clientX;
        touchStartY.value = event.touches[0].clientY;
      }
    };

    const handleTouchEnd = (event, groupKey, currentApp, appsList) => {
      if (!event.changedTouches || event.changedTouches.length === 0) return;
      const deltaX = event.changedTouches[0].clientX - touchStartX.value;
      const deltaY = event.changedTouches[0].clientY - touchStartY.value;
      if (Math.abs(deltaX) > 60 && Math.abs(deltaY) < 40) {
        const currentIndex = appsList.findIndex((appItem) => appItem.id === currentApp.id);
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
      if (popupBundleKey.value) {
        closePopup();
      }
    };

    const toggleBundleView = (groupItem) => {
      const key = typeof groupItem === "string" ? groupItem : groupItem.key;
      const actualGroup = typeof groupItem === "string" ? bundlesGroups.value.find((g) => g.key === key) : groupItem;
      bundleViews[key] = !bundleViews[key];

      if (!bundleViews[key] && actualGroup) {
        collapseBundle(actualGroup);
      }
    };

    const formatDate = (value) => {
      const dateObj = value ? new Date(value) : null;
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
        .catch((error) => {
          console.error("Failed to copy text: ", error);
        });
    };

    const resetFilters = () => {
      query.value = "";
      bundle.value = "";
      app.value = "";
      appSearch.value = "";
      bundleSearch.value = "";
      showOptions.value = [];
      isWhatsNewView.value = false;
      expandedVersions.clear();
      collapseAll();
    };

    const closeWhatsNew = () => {
      if (isWhatsNewView.value) {
        isWhatsNewView.value = false;
        const newUrl = buildUrlString("");
        if (location.pathname + location.search + location.hash !== newUrl) {
          history.pushState(null, "", newUrl);
        }
      }
    };

    const isNewBundle = (groupItem) => {
      if (isWhatsNewView.value) return false;
      if (!groupItem || !groupItem.bundle || !groupItem.bundle.firstSeen) return false;
      const firstSeenTime = new Date(groupItem.bundle.firstSeen).getTime();
      const diffDays = (Date.now() - firstSeenTime) / (1000 * 3600 * 24);
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
    };

    const isAppHighlighted = (groupKey, appItem) => {
      if (!isWhatsNewView.value) return false;
      return (
        whatsNewHighlights.value.includes(groupKey + ":" + (appItem.packageName || "universal")) ||
        whatsNewHighlights.value.includes(groupKey + ":" + appItem.appName)
      );
    };

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
      effectiveTwoColumns,
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
      closeWhatsNew,
      isWhatsNewView,
      whatsNewHighlights,
      hasHighlight,
      copyText,
      copiedStates,
      isShowingFullBundle,
      whatsNewHistory,
      isWhatsNewLoading,
      getWhatsNewAppIcon,
      formatWhatsNewAppName,
      openBundlePopup,
      openAppPopup,
      openPatchPopup,
      isNewBundle,
      getAppName,
      getAppIcon,
      getBundleIcon,
      bundleViews,
      toggleBundleView,
      popupBundleKey,
      popupGroup,
      closePopup,
      getBundlePopupUrl,
      openPopupFast,
      selectBundleFromDropdown,
      popupExpandedOptions,
      popupExpandedAppLists,
      popupOverflowingAppLists,
      popupBundleViews,
      popupActiveSwipeGroup,
      popupSwipeDirection,
      popupExpandedVersions,
      togglePopupOptions,
      togglePopupVersions,
      setupPopupOverflowObserver,
      togglePopupAppList,
      selectPopupApp,
      handlePopupTouchStart,
      handlePopupTouchEnd,
      togglePopupBundleView,
      isAppHighlighted,
    };
  },
}).mount("#app");
