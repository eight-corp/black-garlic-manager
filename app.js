(() => {
  "use strict";

  const APP_ID = "black_garlic";
  const MENU_URL = "https://eight-corp.github.io/garlic-liff-scanner/menu.html?openExternalBrowser=1";

  const TABLES = {
    rooms: "black_garlic_rooms",
    types: "black_garlic_types",
    storageTypes: "black_garlic_storage_types",
    lots: "black_garlic_harvest_lots",
    brackets: "black_garlic_age_brackets",
    rules: "black_garlic_maturation_rules",
    entries: "black_garlic_entries",
    storageEntries: "black_garlic_storage_entries",
    settings: "black_garlic_settings",
    workers: "workers"
  };

  const state = {
    client: null,
    workerId: "",
    session: null,
    activeTab: "main",
    activeSummary: "daily",
    activePrediction: "table",
    data: emptyData(),
    drafts: {},
    charts: {
      summary: null,
      prediction: null
    }
  };

  function emptyData() {
    return {
      workers: [],
      rooms: [],
      types: [],
      storageTypes: [],
      lots: [],
      brackets: [],
      rules: [],
      entries: [],
      storageEntries: [],
      settings: {}
    };
  }

  const $ = id => document.getElementById(id);
  const $$ = selector => Array.from(document.querySelectorAll(selector));

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    clearLegacyLogin();
    setDefaultDates();
    bindEvents();
    createIcons();
    connect().catch(err => showFatal(err));
  }

  function bindEvents() {
    $("menuBtn").addEventListener("click", () => window.location.assign(MENU_URL));
    $("reloadBtn").addEventListener("click", () => refreshAll("更新しました").catch(showError));
    $("logoutBtn").addEventListener("click", logout);

    $$(".tab").forEach(btn => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });

    $("mainForm").addEventListener("submit", event => {
      event.preventDefault();
      saveMainEntry().catch(showError);
    });
    $("mainClearBtn").addEventListener("click", clearMainForm);
    $("mainDate").addEventListener("change", () => {
      updateMainDateWeekday();
      loadMainRecordByKey();
    });
    $("mainType").addEventListener("change", () => {
      loadMainRecordByKey();
    });
    $("mainRoom").addEventListener("change", loadMainRecordByKey);
    $("mainHistoryDate").addEventListener("change", renderMainHistory);
    $("mainHistoryType").addEventListener("change", renderMainHistory);
    $("mainPrevDateBtn").addEventListener("click", () => moveDate("mainHistoryDate", -1));
    $("mainNextDateBtn").addEventListener("click", () => moveDate("mainHistoryDate", 1));

    $("storageForm").addEventListener("submit", event => {
      event.preventDefault();
      saveStorageEntry().catch(showError);
    });
    $("storageClearBtn").addEventListener("click", clearStorageForm);
    $("storageDate").addEventListener("change", () => {
      updateDateWeekday("storageDate", "storageDateWeekday");
      loadStorageRecordByKey();
    });
    $("storageType").addEventListener("change", loadStorageRecordByKey);
    $("storageHistoryDate").addEventListener("change", renderStorageHistory);
    $("storageHistoryType").addEventListener("change", renderStorageHistory);
    $("storagePrevDateBtn").addEventListener("click", () => moveDate("storageHistoryDate", -1));
    $("storageNextDateBtn").addEventListener("click", () => moveDate("storageHistoryDate", 1));

    $$("#summaryPanel .sub-tab[data-summary-view]").forEach(btn => {
      btn.addEventListener("click", () => switchSummary(btn.dataset.summaryView));
    });
    $("summaryRefreshBtn").addEventListener("click", renderSummary);
    $("graphRefreshBtn").addEventListener("click", renderSummaryGraph);
    $("summaryPrintBtn").addEventListener("click", () => window.print());
    ["summaryStartDate", "summaryType", "summaryRoom"].forEach(id => {
      $(id).addEventListener("change", renderSummary);
    });
    $("summaryPrevDateBtn").addEventListener("click", () => moveDate("summaryStartDate", -1));
    $("summaryNextDateBtn").addEventListener("click", () => moveDate("summaryStartDate", 1));

    $$("#predictionPanel .sub-tab[data-prediction-view]").forEach(btn => {
      btn.addEventListener("click", () => switchPrediction(btn.dataset.predictionView));
    });
    $("predictionRefreshBtn").addEventListener("click", () => {
      refreshPrediction().catch(showError);
    });

    $("masterPanel").addEventListener("click", handleMasterClick);
    $("masterSaveBtn").addEventListener("click", () => saveMaster().catch(showError));
  }

  async function connect() {
    const config = readConfig();
    if (!config.url || !config.key) {
      throw new Error("接続設定を読み込めませんでした。");
    }

    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("Supabaseライブラリを読み込めませんでした。通信環境を確認してください。");
    }

    if (!window.BusinessAuth) {
      throw new Error("共通認証を読み込めませんでした。通信環境を確認してください。");
    }
    window.BusinessAuth.init(config.url, config.key);
    state.client = window.supabase.createClient(config.url, config.key, {
      global: { fetch: window.BusinessAuth.authorizedFetch }
    });
    await refreshAll();
  }

  function readConfig() {
    const fileConfig = window.APP_CONFIG || {};
    const fileUrl = String(fileConfig.supabaseUrl || "").trim();
    const fileKey = String(fileConfig.supabaseAnonKey || "").trim();
    return {
      url: fileUrl,
      key: fileKey
    };
  }

  function clearLegacyLogin() {
    try {
      localStorage.removeItem("blackGarlicWorkerId");
      localStorage.removeItem("blackGarlicSavedPins");
    } catch (error) {
      // Legacy credentials are never used, even if their storage cleanup is blocked.
    }
  }

  function can(minimum) {
    return window.BusinessAuth.allows(state.session, APP_ID, minimum);
  }

  async function requireSession(minimum = "viewer") {
    const session = await window.BusinessAuth.session();
    if (!session?.workerId || !window.BusinessAuth.allows(session, APP_ID, "viewer")) {
      state.session = null;
      state.workerId = "";
      document.body.classList.add("login-locked");
      window.location.replace(MENU_URL);
      throw new Error("業務管理メニューでログインしてください。");
    }
    state.session = session;
    state.workerId = session.workerId;
    renderAccess();
    if (!can(minimum)) throw new Error("この操作を行う権限がありません。");
  }

  function renderAccess() {
    const roleNames = { admin: "管理者", operator: "作業者", viewer: "閲覧者" };
    $("currentWorker").textContent = state.session.workerName;
    $("currentRole").textContent = roleNames[state.session.permissions[APP_ID]];
    ["mainForm", "storageForm"].forEach(id => $(id).classList.toggle("hidden", !can("operator")));
    $("avgUsage").readOnly = !can("operator");
    $$(".row-delete-btn").forEach(button => button.disabled = !can("operator") || button.dataset.busy === "true");
    $("masterSaveBtn").disabled = !can("admin") || $("masterSaveBtn").dataset.busy === "true";
    document.querySelector('[data-tab="master"]').classList.toggle("hidden", !can("admin"));
    document.querySelector(".tabs").style.setProperty("--tab-count", can("admin") ? 5 : 4);
    if (state.activeTab === "master" && !can("admin")) switchTab("main");
  }

  async function logout() {
    document.body.classList.add("login-locked");
    state.session = null;
    state.workerId = "";
    try {
      await window.BusinessAuth.logout();
    } catch (error) {
      showError(error);
    } finally {
      window.location.replace(MENU_URL);
    }
  }

  async function refreshAll(message) {
    await withBusy($("reloadBtn"), async () => {
      await requireSession();
      await loadAll();
      renderAll();
      document.body.classList.remove("login-locked");
      $("loginPanel").classList.add("hidden");
      if (message) toast(message);
    });
  }

  async function loadAll() {
    const [
      workers,
      rooms,
      types,
      storageTypes,
      lots,
      brackets,
      rules,
      entries,
      storageEntries,
      settingsRows
    ] = await Promise.all([
      selectAll(TABLES.workers, query => query.order("display_order").order("worker_id")),
      selectAll(TABLES.rooms, query => query.order("display_order").order("room_name")),
      selectAll(TABLES.types, query => query.order("display_order").order("type_name")),
      selectAll(TABLES.storageTypes, query => query.order("display_order").order("type_name")),
      selectAll(TABLES.lots, query => query.order("harvest_date", { ascending: false }).order("lot_name")),
      selectAll(TABLES.brackets, query => query.order("display_order").order("min_days")),
      selectAll(TABLES.rules, query => query.order("room_id")),
      selectAll(TABLES.entries, query => query.order("entry_date").order("recorded_at")),
      selectAll(TABLES.storageEntries, query => query.order("storage_date").order("recorded_at")),
      selectAll(TABLES.settings, query => query.order("setting_key"))
    ]);

    state.data = {
      workers,
      rooms,
      types,
      storageTypes,
      lots,
      brackets,
      rules,
      entries,
      storageEntries,
      settings: Object.fromEntries(settingsRows.map(row => [row.setting_key, row.setting_value]))
    };
    resetDrafts();
  }

  async function selectAll(table, configure) {
    let query = state.client.from(table).select("*").range(0, 49999);
    if (configure) query = configure(query);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  function renderAll() {
    fillAllSelects();
    renderMainHistory();
    renderStorageHistory();
    renderSummary();
    renderPrediction();
    renderMaster();
    renderAccess();
    fitResponsiveTables();
    createIcons();
  }

  function fillAllSelects() {
    fillSelect("mainType", activeRows(state.data.types), "id", "type_name");
    fillSelect("mainRoom", activeRows(state.data.rooms), "id", "room_name");
    fillSelect("mainHistoryType", activeRows(state.data.types), "id", "type_name", "全体");
    fillSelect("storageType", activeRows(state.data.storageTypes), "id", "type_name");
    fillSelect("storageHistoryType", activeRows(state.data.storageTypes), "id", "type_name", "全体");
    fillSelect("summaryType", activeRows(state.data.types), "id", "type_name", "全体");
    fillSelect("summaryRoom", activeRows(state.data.rooms), "id", "room_name", "全体");
    fillSelect("predictionType", activeRows(state.data.types), "id", "type_name", "全体");
    fillSelect("predictionRoom", activeRows(state.data.rooms), "id", "room_name", "全体");
    $("avgUsage").value = state.data.settings.prediction && state.data.settings.prediction.avgUsage !== undefined
      ? state.data.settings.prediction.avgUsage
      : 0;
  }

  function fillSelect(id, rows, valueKey, labelKey, allLabel) {
    const el = $(id);
    const current = el.value;
    const options = [];
    if (allLabel) options.push(`<option value="All">${esc(allLabel)}</option>`);
    rows.forEach(row => {
      const label = typeof labelKey === "function" ? labelKey(row) : row[labelKey];
      options.push(`<option value="${esc(row[valueKey])}">${esc(label)}</option>`);
    });
    el.innerHTML = options.join("");
    if (current && Array.from(el.options).some(option => option.value === current)) {
      el.value = current;
    }
  }

  function activeRows(rows) {
    return rows.filter(row => row.active !== false);
  }

  function isActiveMasterRow(rows, id) {
    const row = rows.find(item => item.id === id);
    return !!row && row.active !== false;
  }

  function isVisibleMainEntry(row) {
    return isActiveMasterRow(state.data.types, row.type_id) &&
      isActiveMasterRow(state.data.rooms, row.room_id);
  }

  function isVisibleStorageEntry(row) {
    return isActiveMasterRow(state.data.storageTypes, row.storage_type_id);
  }

  function getDefaultLotId() {
    const lots = activeRows(state.data.lots);
    const lot = lots.find(row => row.lot_name === "未指定") || lots[0] || state.data.lots[0];
    if (!lot || !lot.id) {
      throw new Error("既定の収穫ロットがありません。Supabaseの初期データを確認してください。");
    }
    return lot.id;
  }

  function switchTab(tab) {
    if (tab === "master" && !can("admin")) return;
    state.activeTab = tab;
    $$(".tab").forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tab));
    $$("[data-panel]").forEach(panel => panel.classList.toggle("active-panel", panel.dataset.panel === tab));
    if (tab === "summary") renderSummary();
    if (tab === "prediction") renderPrediction();
    if (tab === "master") renderMaster();
    createIcons();
  }

  function switchSummary(view) {
    state.activeSummary = view;
    $$("#summaryPanel .sub-tab").forEach(btn => btn.classList.toggle("active", btn.dataset.summaryView === view));
    $$(".summary-view").forEach(el => el.classList.toggle("active", el.id === `${view}Summary` || (view === "graph" && el.id === "summaryGraph")));
    renderSummary();
  }

  function updateSummaryControls() {
    $("summaryRoomFilter").classList.toggle("hidden", state.activeSummary === "daily");
    const startDate = $("summaryStartDate");
    startDate.max = todayStr();
    if (!startDate.value || startDate.value > startDate.max) startDate.value = startDate.max;
    updateDateWeekday("summaryStartDate", "summaryStartDateWeekday");
    $("summaryNextDateBtn").disabled = startDate.value >= startDate.max;
  }

  function switchPrediction(view) {
    state.activePrediction = view;
    $$("#predictionPanel .sub-tab").forEach(btn => btn.classList.toggle("active", btn.dataset.predictionView === view));
    $("predictionTableView").classList.toggle("active", view === "table");
    $("predictionChartView").classList.toggle("active", view === "chart");
    renderPrediction();
  }

  async function saveMainEntry() {
    await withBusy($("mainForm").querySelector("button[type='submit']"), async () => {
      await requireSession("operator");
      const payload = {
        recorded_at: new Date().toISOString(),
        entry_date: $("mainDate").value,
        worker_id: state.workerId,
        room_id: $("mainRoom").value,
        type_id: $("mainType").value,
        harvest_lot_id: getDefaultLotId(),
        temperature: nullableNumber($("mainTemperature").value),
        out_qty: clampNumber($("mainOut").value),
        in_qty: clampNumber($("mainIn").value),
        empty_qty: clampNumber($("mainEmpty").value),
        note: $("mainNote").value.trim(),
        inventory_manual: $("mainInventory").value !== "",
        inventory_qty: $("mainInventory").value === "" ? 0 : clampNumber($("mainInventory").value)
      };
      requireFields(payload, ["entry_date", "worker_id", "room_id", "type_id", "harvest_lot_id"]);
      const id = $("mainEntryId").value;
      if (id) {
        await assertOk(state.client.from(TABLES.entries).update(payload).eq("id", id));
      } else {
        await assertOk(state.client.from(TABLES.entries).upsert(payload, {
          onConflict: "entry_date,room_id,type_id,harvest_lot_id"
        }));
      }
      await recalculateInventoryGroup(payload.room_id, payload.type_id, payload.harvest_lot_id);
      await loadAll();
      $("mainHistoryDate").value = payload.entry_date;
      renderAll();
      clearMainForm();
      $("mainStatus").textContent = "保存済み";
      setTimeout(() => $("mainStatus").textContent = "", 1600);
    });
  }

  async function recalculateInventoryGroup(roomId, typeId, lotId) {
    let query = state.client
      .from(TABLES.entries)
      .select("*")
      .eq("room_id", roomId)
      .eq("type_id", typeId)
      .eq("harvest_lot_id", lotId)
      .order("entry_date")
      .order("recorded_at");
    const { data, error } = await query;
    if (error) throw error;
    let inventory = 0;
    for (const row of data || []) {
      if (row.inventory_manual) {
        inventory = clampNumber(row.inventory_qty);
      } else {
        inventory = clampNumber(inventory - clampNumber(row.out_qty) + clampNumber(row.in_qty));
      }
      if (Number(row.inventory_qty || 0) !== inventory) {
        await assertOk(state.client.from(TABLES.entries).update({ inventory_qty: inventory }).eq("id", row.id));
      }
    }
  }

  async function deleteMainEntry(id) {
    await requireSession("operator");
    const targetId = id || $("mainEntryId").value;
    const isEditingTarget = $("mainEntryId").value === targetId;
    if (!targetId) return;
    if (!confirm("この行の黒にんにくデータを削除しますか？")) return;
    const row = state.data.entries.find(item => item.id === targetId);
    await assertOk(state.client.from(TABLES.entries).delete().eq("id", targetId));
    if (row) await recalculateInventoryGroup(row.room_id, row.type_id, row.harvest_lot_id);
    await loadAll();
    if (isEditingTarget) clearMainForm();
    renderAll();
  }

  function clearMainForm() {
    $("mainEntryId").value = "";
    $("mainTemperature").value = "";
    $("mainOut").value = "";
    $("mainIn").value = "";
    $("mainEmpty").value = "";
    $("mainInventory").value = "";
    $("mainNote").value = "";
    setMainEditMode(false);
  }

  function loadMainRecordByKey() {
    const row = state.data.entries.find(item =>
      item.entry_date === $("mainDate").value &&
      item.type_id === $("mainType").value &&
      item.room_id === $("mainRoom").value &&
      item.harvest_lot_id === getDefaultLotId()
    );
    if (row) loadMainRow(row);
    else clearMainForm();
  }

  function loadMainRow(row) {
    if (!can("operator")) return;
    if (!row) return;
    $("mainEntryId").value = row.id;
    $("mainDate").value = row.entry_date;
    updateMainDateWeekday();
    $("mainType").value = row.type_id;
    $("mainRoom").value = row.room_id;
    $("mainTemperature").value = row.temperature ?? "";
    $("mainOut").value = row.out_qty ?? "";
    $("mainIn").value = row.in_qty ?? "";
    $("mainEmpty").value = row.empty_qty ?? "";
    $("mainInventory").value = row.inventory_manual ? row.inventory_qty ?? "" : "";
    $("mainNote").value = row.note || "";
    setMainEditMode(true);
  }

  function setMainEditMode(isEdit) {
    const button = $("mainSubmitBtn");
    if (!button) return;
    const label = button.querySelector("span");
    if (label) label.textContent = isEdit ? "編集" : "登録";
    button.classList.toggle("edit-mode", isEdit);
  }

  function renderMainHistory() {
    const date = $("mainHistoryDate").value;
    const typeId = $("mainHistoryType").value;
    updateDateWeekday("mainHistoryDate", "mainHistoryDateWeekday");
    const rows = state.data.entries
      .filter(row => row.entry_date === date && matchesFilters(row, typeId, "All"))
      .sort((a, b) => compareDisplay(roomName(a.room_id), roomName(b.room_id)) || compareDisplay(typeName(a.type_id), typeName(b.type_id)));

    const totalOut = rows.reduce((sum, row) => sum + clampNumber(row.out_qty), 0);
    const totalIn = rows.reduce((sum, row) => sum + clampNumber(row.in_qty), 0);
    const totalEmpty = rows.reduce((sum, row) => sum + clampNumber(row.empty_qty), 0);
    const totalInventory = rows.reduce((sum, row) => sum + clampNumber(row.inventory_qty), 0);
    const body = rows.map(row => `
      <tr class="${can("operator") ? "clickable" : ""}" data-main-id="${esc(row.id)}">
        <td class="stack-cell">${esc(workerName(row.worker_id))}</td>
        <td class="stack-cell">${esc(roomName(row.room_id))}</td>
        <td class="stack-cell">${esc(typeName(row.type_id))}</td>
        <td class="num-cell">${num(row.temperature)}</td>
        <td class="num-cell out-cell">${num(row.out_qty)}</td>
        <td class="num-cell in-cell">${num(row.in_qty)}</td>
        <td class="num-cell">${num(row.empty_qty)}</td>
        <td class="num-cell">${num(row.inventory_qty)}${row.inventory_manual ? '<span class="manual-mark">＊</span>' : ""}</td>
        <td class="note-cell">${esc(row.note || "")}</td>
        <td class="action-cell"><button type="button" class="danger icon-btn row-delete-btn" data-main-delete="${esc(row.id)}" title="削除" ${can("operator") ? "" : "disabled"}><i data-lucide="trash-2"></i></button></td>
      </tr>
    `).join("");

    $("mainHistory").innerHTML = `
      <table class="main-history-table">
        <colgroup>
          <col class="col-worker">
          <col class="col-room">
          <col class="col-type">
          <col class="col-number">
          <col class="col-number">
          <col class="col-number">
          <col class="col-number">
          <col class="col-inventory">
          <col class="col-note">
          <col class="col-action">
        </colgroup>
        <thead><tr><th class="stack-heading">作業者</th><th class="stack-heading">室</th><th class="stack-heading">種別</th><th>温度</th><th>出庫</th><th>入庫</th><th>空き</th><th>在庫</th><th class="stack-heading">備考</th><th>削除</th></tr></thead>
        <tbody>${body || emptyRow(10)}<tr class="total-row"><td colspan="4">合計</td><td class="out-cell">${num(totalOut)}</td><td class="in-cell">${num(totalIn)}</td><td>${num(totalEmpty)}</td><td>${num(totalInventory)}</td><td></td><td></td></tr></tbody>
      </table>
    `;
    $("mainHistory").querySelectorAll("[data-main-delete]").forEach(button => {
      button.addEventListener("click", event => {
        event.stopPropagation();
        withBusy(button, () => deleteMainEntry(button.dataset.mainDelete)).catch(showError);
      });
    });
    $("mainHistory").querySelectorAll("[data-main-id]").forEach(tr => {
      tr.addEventListener("click", () => loadMainRow(state.data.entries.find(row => row.id === tr.dataset.mainId)));
    });
    fitResponsiveTables($("mainHistory"));
    createIcons();
  }

  async function saveStorageEntry() {
    await withBusy($("storageForm").querySelector("button[type='submit']"), async () => {
      await requireSession("operator");
      const payload = {
        recorded_at: new Date().toISOString(),
        storage_date: $("storageDate").value,
        worker_id: state.workerId,
        storage_type_id: $("storageType").value,
        columns16: Math.max(0, Math.floor(clampNumber($("storageColumns").value))),
        pieces: Math.max(0, Math.floor(clampNumber($("storagePieces").value))),
        note: $("storageNote").value.trim()
      };
      requireFields(payload, ["storage_date", "worker_id", "storage_type_id"]);
      const id = $("storageEntryId").value;
      if (id) {
        await assertOk(state.client.from(TABLES.storageEntries).update(payload).eq("id", id));
      } else {
        await assertOk(state.client.from(TABLES.storageEntries).upsert(payload, {
          onConflict: "storage_date,storage_type_id"
        }));
      }
      await loadAll();
      $("storageHistoryDate").value = payload.storage_date;
      renderAll();
      loadStorageRecordByKey();
      $("storageStatus").textContent = "保存済み";
      setTimeout(() => $("storageStatus").textContent = "", 1600);
    });
  }

  async function deleteStorageEntry(id) {
    await requireSession("operator");
    const targetId = id || $("storageEntryId").value;
    const isEditingTarget = $("storageEntryId").value === targetId;
    if (!targetId) return;
    if (!confirm("この行の保管庫データを削除しますか？")) return;
    await assertOk(state.client.from(TABLES.storageEntries).delete().eq("id", targetId));
    await loadAll();
    if (isEditingTarget) clearStorageForm();
    renderAll();
  }

  function clearStorageForm() {
    $("storageEntryId").value = "";
    $("storageColumns").value = "";
    $("storagePieces").value = "";
    $("storageNote").value = "";
  }

  function loadStorageRecordByKey() {
    const row = state.data.storageEntries.find(item =>
      item.storage_date === $("storageDate").value &&
      item.storage_type_id === $("storageType").value
    );
    if (row) loadStorageRow(row);
    else clearStorageForm();
  }

  function loadStorageRow(row) {
    if (!can("operator")) return;
    $("storageEntryId").value = row.id;
    $("storageDate").value = row.storage_date;
    updateDateWeekday("storageDate", "storageDateWeekday");
    $("storageType").value = row.storage_type_id;
    $("storageColumns").value = row.columns16 ?? "";
    $("storagePieces").value = row.pieces ?? "";
    $("storageNote").value = row.note || "";
  }

  function renderStorageHistory() {
    const date = $("storageHistoryDate").value;
    const typeId = $("storageHistoryType").value;
    updateDateWeekday("storageHistoryDate", "storageHistoryDateWeekday");
    const rows = state.data.storageEntries
      .filter(row => row.storage_date === date && isVisibleStorageEntry(row) && (typeId === "All" || !typeId || row.storage_type_id === typeId))
      .sort((a, b) => compareDisplay(storageTypeName(a.storage_type_id), storageTypeName(b.storage_type_id)));
    const totalColumns16 = sum(rows, "columns16");
    const totalPieces = sum(rows, "pieces");
    const body = rows.map(row => `
      <tr class="${can("operator") ? "clickable" : ""}" data-storage-id="${esc(row.id)}">
        <td class="text-left">${esc(fmtDate(row.storage_date))}</td>
        <td class="text-left">${esc(workerName(row.worker_id))}</td>
        <td class="text-left">${esc(storageTypeName(row.storage_type_id))}</td>
        <td>${num(row.columns16, 0)}</td>
        <td>${num(row.pieces, 0)}</td>
        <td class="text-left">${esc(row.note || "")}</td>
        <td class="action-cell"><button type="button" class="danger icon-btn row-delete-btn" data-storage-delete="${esc(row.id)}" title="削除" ${can("operator") ? "" : "disabled"}><i data-lucide="trash-2"></i></button></td>
      </tr>
    `).join("");
    $("storageHistory").innerHTML = `
      <table>
        <thead><tr><th>日付</th><th>作業者</th><th>種別</th><th>16段</th><th>端数</th><th>備考</th><th>削除</th></tr></thead>
        <tbody>${body || emptyRow(7)}<tr class="total-row"><td colspan="3">合計</td><td>${num(totalColumns16, 0)}</td><td>${num(totalPieces, 0)}</td><td></td><td></td></tr></tbody>
      </table>
    `;
    $("storageHistory").querySelectorAll("[data-storage-delete]").forEach(button => {
      button.addEventListener("click", event => {
        event.stopPropagation();
        withBusy(button, () => deleteStorageEntry(button.dataset.storageDelete)).catch(showError);
      });
    });
    $("storageHistory").querySelectorAll("[data-storage-id]").forEach(tr => {
      tr.addEventListener("click", () => loadStorageRow(state.data.storageEntries.find(row => row.id === tr.dataset.storageId)));
    });
    fitResponsiveTables($("storageHistory"));
    createIcons();
  }

  function renderSummary() {
    updateSummaryControls();
    if (state.activeSummary === "daily") renderDailySummary();
    if (state.activeSummary === "weekly") renderWeeklySummary();
    if (state.activeSummary === "monthly") renderMonthlySummary();
    if (state.activeSummary === "graph") renderSummaryGraph();
    fitResponsiveTables($("summaryPanel"));
  }

  function renderDailySummary() {
    const base = parseYmd($("summaryStartDate").value);
    const typeId = $("summaryType").value;
    const days = Array.from({ length: 7 }, (_, index) => addDays(base, -index));
    const rooms = activeRows(state.data.rooms);
    const typeLabel = typeId === "All" || !typeId ? "全体" : typeName(typeId);
    const sections = days.map(day => {
      const ymd = dateToStr(day);
      const roomRows = rooms.map(room => {
        const dayRows = filterEntries(ymd, ymd, typeId, room.id);
        return {
          roomName: room.room_name,
          workers: unique(dayRows.map(row => workerName(row.worker_id)).filter(Boolean)).join("、"),
          out: sum(dayRows, "out_qty"),
          inQty: sum(dayRows, "in_qty"),
          inventory: inventoryAsOf(ymd, typeId, room.id),
          empty: sum(dayRows, "empty_qty"),
          note: dayRows.map(row => row.note).filter(Boolean).join(" / ")
        };
      });
      const displayRows = roomRows.map(row => [
        row.roomName,
        row.workers,
        num(row.out),
        num(row.inQty),
        num(row.empty),
        num(row.inventory),
        row.note
      ]);
      displayRows.push([
        "合計",
        "",
        num(roomRows.reduce((total, row) => total + row.out, 0)),
        num(roomRows.reduce((total, row) => total + row.inQty, 0)),
        num(roomRows.reduce((total, row) => total + row.empty, 0)),
        num(roomRows.reduce((total, row) => total + row.inventory, 0)),
        ""
      ]);
      return `
        <h2 class="print-title">${esc(fmtDate(ymd))} 日毎集計（${esc(typeLabel)}）</h2>
        ${tableHtml(["室名", "作業者名", "出庫", "入庫", "空き", "在庫", "備考"], displayRows, [0, 1, 6], displayRows.length - 1)}
      `;
    });

    $("dailySummary").innerHTML = sections.join("");
  }

  function renderWeeklySummary() {
    const base = parseYmd($("summaryStartDate").value);
    const monday = startOfWeekMonday(base);
    const days = dateRange(monday, addDays(monday, 6));
    const typeId = $("summaryType").value;
    const roomId = $("summaryRoom").value;
    const types = typeId === "All" ? activeRows(state.data.types) : activeRows(state.data.types).filter(row => row.id === typeId);
    const rooms = roomId === "All" ? activeRows(state.data.rooms) : activeRows(state.data.rooms).filter(row => row.id === roomId);
    const sections = [];

    types.forEach(type => {
      rooms.forEach(room => {
        const allRows = days.flatMap(day => filterEntries(dateToStr(day), dateToStr(day), type.id, room.id));
        if (!allRows.length) return;
        const rows = days.map(day => {
          const ymd = dateToStr(day);
          const dayRows = allRows.filter(row => row.entry_date === ymd);
          return [
            fmtDate(ymd),
            unique(dayRows.map(row => workerName(row.worker_id)).filter(Boolean)).join("、"),
            num(sum(dayRows, "in_qty")),
            num(sum(dayRows, "out_qty")),
            num(sum(dayRows, "inventory_qty")),
            num(lastValue(dayRows, "temperature")),
            dayRows.map(row => fmtTime(row.recorded_at)).filter(Boolean).join("、"),
            dayRows.map(row => row.note).filter(Boolean).join(" / ")
          ];
        });
        sections.push(`
          <h2 class="print-title">${esc(reiwaMonthLabel(monday))} ${esc(type.type_name)} ${esc(room.room_name)}</h2>
          ${tableHtml(["日付(曜日)", "作業者名", "搬入数", "搬出数", "在庫", "温度", "時刻", "備考"], rows, [0, 1, 7])}
        `);
      });
    });

    $("weeklySummary").innerHTML = sections.join("") || `<p class="muted">表示対象のデータがありません。</p>`;
    markSundayDateCells($("weeklySummary"));
  }

  function renderMonthlySummary() {
    const base = parseYmd($("summaryStartDate").value);
    const start = new Date(base.getFullYear(), base.getMonth(), 1);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    const days = dateRange(start, end);
    const typeId = $("summaryType").value;
    const roomId = $("summaryRoom").value;
    const typeLabel = typeId === "All" || !typeId ? "全体" : typeName(typeId);
    const rooms = roomId === "All" || !roomId
      ? activeRows(state.data.rooms)
      : activeRows(state.data.rooms).filter(room => room.id === roomId);
    const storageTypes = activeRows(state.data.storageTypes);

    const monthlyRoomRows = days.map(day => {
      const ymd = dateToStr(day);
      let outTotal = 0;
      let inTotal = 0;
      const cells = rooms.map(room => {
        const dayRows = filterEntries(ymd, ymd, typeId, room.id);
        const out = sum(dayRows, "out_qty");
        const inQty = sum(dayRows, "in_qty");
        outTotal += out;
        inTotal += inQty;
        return twoLineCell(numOrBlank(out), numOrBlank(inQty), "out-cell", "in-cell");
      });
      return `<tr>
        <td class="${day.getDay() === 0 ? "sun-date" : ""}">${esc(fmtDate(ymd))}</td>
        ${cells.join("")}
        ${twoLineCell(numOrBlank(outTotal), numOrBlank(inTotal), "out-cell", "in-cell", "total-col")}
      </tr>`;
    }).join("");

    const storageRows = days.map(day => {
      const ymd = dateToStr(day);
      let columnsTotal = 0;
      let piecesTotal = 0;
      const cells = storageTypes.map(type => {
        const rows = state.data.storageEntries.filter(row => row.storage_date === ymd && isVisibleStorageEntry(row) && row.storage_type_id === type.id);
        const columns = sum(rows, "columns16");
        const pieces = sum(rows, "pieces");
        columnsTotal += columns;
        piecesTotal += pieces;
        return twoLineCell(numOrBlank(columns, 0), numOrBlank(pieces, 0));
      });
      return `<tr>
        <td class="${day.getDay() === 0 ? "sun-date" : ""}">${esc(fmtDate(ymd))}</td>
        ${cells.join("")}
        ${twoLineCell(numOrBlank(columnsTotal, 0), numOrBlank(piecesTotal, 0), "", "", "total-col")}
      </tr>`;
    }).join("");

    $("monthlySummary").innerHTML = `
      <h2 class="print-title">${esc(reiwaMonthLabel(start))} 月毎室（${esc(typeLabel)} / 上段：出庫 下段：入庫）</h2>
      ${matrixTableHtml(["日付", ...rooms.map(room => room.room_name), "合計"], monthlyRoomRows)}
      <h2 class="print-title">保管庫集計（上段：16段 下段：端数）</h2>
      ${matrixTableHtml(["日付", ...storageTypes.map(type => type.type_name), "合計"], storageRows)}
    `;
  }

  function renderSummaryGraph() {
    const start = $("graphStartDate").value;
    const end = $("graphEndDate").value;
    const days = dateRange(parseYmd(start), parseYmd(end));
    const labels = days.map(day => fmtShortDate(dateToStr(day)));
    const inData = [];
    const outData = [];
    const inventoryData = [];
    days.forEach(day => {
      const ymd = dateToStr(day);
      const rows = filterEntries(ymd, ymd, $("summaryType").value, $("summaryRoom").value);
      inData.push(round2(sum(rows, "in_qty")));
      outData.push(round2(sum(rows, "out_qty")));
      inventoryData.push(round2(inventoryAsOf(ymd, $("summaryType").value, $("summaryRoom").value)));
    });

    const canvas = $("summaryChart");
    if (typeof Chart === "undefined") return;
    if (state.charts.summary) state.charts.summary.destroy();
    state.charts.summary = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "入庫", data: inData, borderColor: "#007bff", backgroundColor: "rgba(0,123,255,.12)", tension: .25, yAxisID: "y" },
          { label: "出庫", data: outData, borderColor: "#d9534f", backgroundColor: "rgba(217,83,79,.12)", tension: .25, yAxisID: "y" },
          { label: "在庫", data: inventoryData, borderColor: "#2563eb", backgroundColor: "rgba(37,99,235,.12)", tension: .25, yAxisID: "y1" }
        ]
      },
      options: chartOptions("数量", "在庫")
    });
  }

  async function refreshPrediction() {
    await withBusy($("predictionRefreshBtn"), async () => {
      await requireSession();
      if (can("operator")) await savePredictionSettings();
      renderPrediction();
    });
  }

  async function savePredictionSettings() {
    const value = { avgUsage: clampNumber($("avgUsage").value) };
    await assertOk(state.client.from(TABLES.settings).upsert({
      setting_key: "prediction",
      setting_value: value
    }));
    state.data.settings.prediction = value;
  }

  function renderPrediction() {
    const pred = buildPrediction();
    $("predictionTable").innerHTML = tableHtml(
      ["日付", "予測出庫数", "実出庫数", "保管列換算", "予測保管数"],
      pred.rows.map(row => [
        fmtDate(row.date),
        num(row.pred),
        num(row.actual),
        num(row.predColumns),
        num(row.forecastStorage)
      ]),
      [0]
    );
    renderPredictionChart(pred);
    fitResponsiveTables($("predictionPanel"));
  }

  function buildPrediction() {
    const start = $("predictionStartDate").value;
    const end = $("predictionEndDate").value;
    const typeId = $("predictionType").value;
    const roomId = $("predictionRoom").value;
    const avgUsage = clampNumber($("avgUsage").value);
    const map = new Map(dateRange(parseYmd(start), parseYmd(end)).map(day => {
      const ymd = dateToStr(day);
      return [ymd, { date: ymd, pred: 0, actual: 0, predColumns: 0, forecastStorage: 0 }];
    }));

    state.data.entries.forEach(row => {
      if (!matchesFilters(row, typeId, roomId)) return;
      if (row.entry_date >= start && row.entry_date <= end && map.has(row.entry_date)) {
        map.get(row.entry_date).actual += clampNumber(row.out_qty);
      }
      if (clampNumber(row.in_qty) > 0) {
        const days = maturationDays(row);
        const pDate = dateToStr(addDays(parseYmd(row.entry_date), days));
        if (pDate >= start && pDate <= end && map.has(pDate)) {
          const item = map.get(pDate);
          item.pred += clampNumber(row.in_qty);
          item.predColumns += clampNumber(row.in_qty) / 32;
        }
      }
    });

    let storage = latestStorageTotal(addDays(parseYmd(start), -1), typeId);
    map.forEach(item => {
      const actual = latestStorageTotal(parseYmd(item.date), typeId, item.date);
      if (actual.hasActualOnDate) storage = actual.total;
      storage += item.predColumns;
      if (new Date(`${item.date}T00:00:00`).getDay() !== 0) storage -= avgUsage;
      storage = Math.max(0, storage);
      item.forecastStorage = storage;
    });

    return { rows: Array.from(map.values()).map(row => ({
      date: row.date,
      pred: round2(row.pred),
      actual: round2(row.actual),
      predColumns: round2(row.predColumns),
      forecastStorage: round2(row.forecastStorage)
    })) };
  }

  function renderPredictionChart(pred) {
    const canvas = $("predictionChart");
    if (typeof Chart === "undefined") return;
    if (state.charts.prediction) state.charts.prediction.destroy();
    state.charts.prediction = new Chart(canvas, {
      type: "line",
      data: {
        labels: pred.rows.map(row => fmtShortDate(row.date)),
        datasets: [
          { type: "bar", label: "予測出庫数", data: pred.rows.map(row => row.pred), backgroundColor: "rgba(217,83,79,.28)", borderColor: "#d9534f", yAxisID: "y" },
          { type: "bar", label: "実出庫数", data: pred.rows.map(row => row.actual), backgroundColor: "rgba(217,83,79,.28)", borderColor: "#d9534f", yAxisID: "y" },
          { label: "予測保管数", data: pred.rows.map(row => row.forecastStorage), borderColor: "#dc2626", backgroundColor: "rgba(220,38,38,.12)", tension: .25, yAxisID: "y1" }
        ]
      },
      options: chartOptions("出庫数", "保管列")
    });
  }

  function maturationDays(entry) {
    const lot = state.data.lots.find(item => item.id === entry.harvest_lot_id);
    if (!lot || !lot.harvest_date) return 30;
    const elapsed = diffDays(parseYmd(lot.harvest_date), parseYmd(entry.entry_date));
    const bracket = activeRows(state.data.brackets).find(item =>
      elapsed >= Number(item.min_days || 0) &&
      (item.max_days === null || item.max_days === undefined || elapsed <= Number(item.max_days))
    );
    if (!bracket) return 30;
    const rule = state.data.rules.find(item => item.room_id === entry.room_id && item.age_bracket_id === bracket.id);
    return Math.max(0, Math.floor(Number(rule && rule.maturation_days || 30)));
  }

  function resetDrafts() {
    state.drafts = {
      rooms: state.data.rooms.map(clone),
      types: state.data.types.map(clone),
      storageTypes: state.data.storageTypes.map(clone),
      lots: state.data.lots.map(clone),
      brackets: state.data.brackets.map(clone)
    };
  }

  function renderMaster() {
    const openSections = new Set(
      $$("#masterRooms details.master-section[open]")
        .map(section => section.dataset.masterSection)
        .filter(Boolean)
    );
    renderRoomAndTypeMaster(openSections);
    fitResponsiveTables($("masterPanel"));
    createIcons();
  }

  function renderRoomAndTypeMaster(openSections = new Set()) {
    $("masterRooms").innerHTML = `
      ${simpleMasterHtml("rooms", "room_name", "室名", true, openSections)}
      ${simpleMasterHtml("types", "type_name", "室種別", true, openSections)}
      ${simpleMasterHtml("storageTypes", "type_name", "保管庫種別", true, openSections)}
      ${maturationMasterHtml(openSections)}
    `;
  }

  function simpleMasterHtml(draftKey, nameKey, label, showVisibility, openSections) {
    const rows = state.drafts[draftKey] || [];
    return `
      <details class="master-section" data-master-section="${draftKey}" ${openSections.has(draftKey) ? "open" : ""}>
        <summary>${esc(label)}マスタ</summary>
        <div class="master-body">
          <div class="master-list">
            ${rows.map((row, index) => `
              <div class="master-row ${showVisibility ? "visibility-master-row" : ""}" data-draft="${draftKey}" data-index="${index}">
                <span class="master-index">${index + 1}</span>
                <input data-field="${nameKey}" value="${esc(row[nameKey] || "")}" placeholder="${esc(label)}">
                <button type="button" class="secondary icon-btn" data-master-action="up" title="上へ"><i data-lucide="arrow-up"></i></button>
                <button type="button" class="secondary icon-btn" data-master-action="down" title="下へ"><i data-lucide="arrow-down"></i></button>
                ${showVisibility ? visibilitySwitch(row.active !== false) : ""}
                <button type="button" class="danger icon-btn" data-master-action="remove" title="削除"><i data-lucide="trash-2"></i></button>
              </div>
            `).join("")}
            <button type="button" class="secondary compact-add-btn" data-master-action="add" data-draft="${draftKey}"><i data-lucide="plus"></i><span>${esc(label)}を追加</span></button>
          </div>
        </div>
      </details>
    `;
  }

  function maturationMasterHtml(openSections) {
    const brackets = state.drafts.brackets || [];
    const bracketEditor = `
      <div class="master-subtitle">収穫からの経過日数区分</div>
      <div class="master-list">
        ${brackets.map((row, index) => `
          <div class="master-row bracket-row" data-draft="brackets" data-index="${index}">
            <span class="muted">${index + 1}</span>
            <input data-field="label" value="${esc(row.label || "")}" placeholder="例: 0-30日">
            <input data-field="min_days" type="number" min="0" step="1" value="${esc(row.min_days ?? "")}" placeholder="開始">
            <input data-field="max_days" type="number" min="0" step="1" value="${esc(row.max_days ?? "")}" placeholder="終了">
            <button type="button" class="secondary icon-btn" data-master-action="up" title="上へ"><i data-lucide="arrow-up"></i></button>
            <button type="button" class="secondary icon-btn" data-master-action="down" title="下へ"><i data-lucide="arrow-down"></i></button>
            <button type="button" class="danger icon-btn" data-master-action="remove" title="削除"><i data-lucide="trash-2"></i></button>
          </div>
        `).join("")}
        <button type="button" class="secondary" data-master-action="add" data-draft="brackets"><i data-lucide="plus"></i><span>区分を追加</span></button>
      </div>
    `;

    const activeRooms = activeRows(state.data.rooms);
    const activeBrackets = activeRows(state.data.brackets);
    const matrix = `
      <div class="master-subtitle">室名 × 経過日数区分の熟成日数</div>
      <div class="table-wrap">
        <table class="matrix-table">
          <thead><tr><th>室名</th>${activeBrackets.map(b => `<th>${esc(b.label)}</th>`).join("")}</tr></thead>
          <tbody>
            ${activeRooms.map(room => `
              <tr>
                <td class="text-left">${esc(room.room_name)}</td>
                ${activeBrackets.map(bracket => {
                  const rule = state.data.rules.find(item => item.room_id === room.id && item.age_bracket_id === bracket.id);
                  return `<td><input type="number" min="0" step="1" data-rule-room="${esc(room.id)}" data-rule-bracket="${esc(bracket.id)}" value="${esc(rule ? rule.maturation_days : "")}"></td>`;
                }).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;

    return `
      <details class="master-section maturation-master-section" data-master-section="maturation" ${openSections.has("maturation") ? "open" : ""}>
        <summary>熟成日数表</summary>
        <div class="master-body">
          ${bracketEditor}
          ${matrix}
        </div>
      </details>
    `;
  }

  function handleMasterClick(event) {
    if (!can("admin")) return;
    const button = event.target.closest("[data-master-action]");
    if (!button) return;
    collectMasterInputs();
    const action = button.dataset.masterAction;
    const draftKey = button.dataset.draft || button.closest("[data-draft]").dataset.draft;
    const rowEl = button.closest("[data-index]");
    const index = rowEl ? Number(rowEl.dataset.index) : -1;
    const rows = state.drafts[draftKey];
    if (!rows) return;

    if (action === "add") rows.push(defaultDraftRow(draftKey));
    if (action === "remove" && index >= 0) rows.splice(index, 1);
    if (action === "up" && index > 0) [rows[index - 1], rows[index]] = [rows[index], rows[index - 1]];
    if (action === "down" && index >= 0 && index < rows.length - 1) [rows[index + 1], rows[index]] = [rows[index], rows[index + 1]];
    renderMaster();
  }

  function collectMasterInputs() {
    $$(".master-row[data-draft]").forEach(rowEl => {
      const draftKey = rowEl.dataset.draft;
      const index = Number(rowEl.dataset.index);
      const row = state.drafts[draftKey] && state.drafts[draftKey][index];
      if (!row) return;
      rowEl.querySelectorAll("[data-field]").forEach(input => {
        const field = input.dataset.field;
        if (input.type === "checkbox") row[field] = input.checked;
        else if (input.type === "number") row[field] = input.value === "" ? null : Number(input.value);
        else row[field] = input.value.trim();
      });
    });
  }

  function defaultDraftRow(draftKey) {
    if (draftKey === "lots") return { lot_name: "", harvest_date: todayStr(), active: true };
    if (draftKey === "brackets") return { label: "", min_days: 0, max_days: null, active: true };
    if (draftKey === "rooms") return { room_name: "", active: true };
    if (draftKey === "types" || draftKey === "storageTypes") return { type_name: "", active: true };
    return {};
  }

  function visibilitySwitch(checked) {
    return `
      <label class="visibility-switch" title="表示/非表示">
        <input data-field="active" type="checkbox" ${checked ? "checked" : ""}>
        <span class="switch-track"></span>
        <span class="switch-label-text"></span>
      </label>
    `;
  }

  async function saveMaster() {
    await withBusy($("masterSaveBtn"), async () => {
      await requireSession("admin");
      collectMasterInputs();
      validateMasterDrafts();
      await saveSimpleDraft("rooms", TABLES.rooms, "room_name", isRoomUsed);
      await saveSimpleDraft("types", TABLES.types, "type_name", isTypeUsed);
      await saveSimpleDraft("storageTypes", TABLES.storageTypes, "type_name", isStorageTypeUsed);
      await saveLotsDraft();
      await saveBracketsDraft();
      await saveMaturationRules();
      await loadAll();
      renderAll();
      toast("マスタを保存しました");
    });
  }

  function validateMasterDrafts() {
    validateSimpleMasterDraft("rooms", "room_name", "室名", isRoomUsed);
    validateSimpleMasterDraft("types", "type_name", "室種別", isTypeUsed);
    validateSimpleMasterDraft("storageTypes", "type_name", "保管庫種別", isStorageTypeUsed);
    assertNoDuplicateDraftNames(state.drafts.brackets, "label", "区分名");
  }

  function validateSimpleMasterDraft(draftKey, nameKey, label, usedFn) {
    assertNoDuplicateDraftNames(state.drafts[draftKey], nameKey, label);
    const keptIds = new Set(
      state.drafts[draftKey]
        .filter(row => String(row[nameKey] || "").trim())
        .map(row => row.id)
        .filter(Boolean)
    );
    state.data[draftKey].forEach(row => {
      if (!keptIds.has(row.id) && usedFn(row.id)) {
        throw new Error(`使用中の${label}は削除できません: ${row[nameKey]}`);
      }
    });
  }

  async function saveSimpleDraft(draftKey, table, nameKey, usedFn) {
    const originalIds = new Set(state.data[draftKey].map(row => row.id));
    const originalById = new Map(state.data[draftKey].map(row => [row.id, row]));
    const masterLabel = draftKey === "rooms" ? "室名" : draftKey === "types" ? "室種別" : "保管庫種別";
    assertNoDuplicateDraftNames(state.drafts[draftKey], nameKey, masterLabel);
    const rows = uniqueDraftRows(state.drafts[draftKey], nameKey).map((row, index) => ({
      ...row,
      [nameKey]: String(row[nameKey] || "").trim(),
      display_order: index + 1,
      active: row.active !== false
    }));
    const keptIds = new Set(rows.filter(row => row.id).map(row => row.id));
    const removedIds = [...originalIds].filter(id => !keptIds.has(id));
    for (const id of removedIds) {
      if (usedFn(id)) {
        const original = originalById.get(id);
        throw new Error(`使用中の${masterLabel}は削除できません: ${original ? original[nameKey] : id}`);
      }
    }
    for (const id of removedIds) {
      await assertOk(state.client.from(table).delete().eq("id", id));
    }

    const changedExistingRows = rows.filter(row => {
      const original = row.id ? originalById.get(row.id) : null;
      return original && original[nameKey] !== row[nameKey];
    });
    const usedTempNames = new Set([
      ...state.data[draftKey].map(row => row[nameKey]),
      ...rows.map(row => row[nameKey])
    ]);
    for (const row of changedExistingRows) {
      const temporaryName = temporaryMasterName(draftKey, row.id, usedTempNames);
      await assertOk(state.client.from(table).update({ [nameKey]: temporaryName }).eq("id", row.id));
    }

    for (const row of rows) {
      const payload = {
        [nameKey]: row[nameKey],
        display_order: row.display_order,
        active: row.active
      };
      if (row.id) {
        await assertOk(state.client.from(table).update(payload).eq("id", row.id));
      } else {
        await assertOk(state.client.from(table).insert(payload));
      }
    }
  }

  function temporaryMasterName(draftKey, id, usedNames) {
    let index = 0;
    while (true) {
      const name = `__tmp_${draftKey}_${Date.now()}_${String(id || "").slice(0, 8)}_${index}__`;
      if (!usedNames.has(name)) {
        usedNames.add(name);
        return name;
      }
      index += 1;
    }
  }

  async function saveLotsDraft() {
    const originalIds = new Set(state.data.lots.map(row => row.id));
    const rows = uniqueDraftRows(state.drafts.lots, "lot_name").filter(row => row.lot_name && row.harvest_date).map((row, index) => ({
      ...row,
      display_order: index + 1,
      active: true
    }));
    const keptIds = new Set(rows.filter(row => row.id).map(row => row.id));
    for (const id of originalIds) {
      if (!keptIds.has(id)) {
        if (state.data.entries.some(row => row.harvest_lot_id === id)) throw new Error("使用中の収穫ロットは削除できません。");
        await assertOk(state.client.from(TABLES.lots).delete().eq("id", id));
      }
    }
    for (const row of rows) await assertOk(state.client.from(TABLES.lots).upsert(row));
  }

  async function saveBracketsDraft() {
    const originalIds = new Set(state.data.brackets.map(row => row.id));
    const originalById = new Map(state.data.brackets.map(row => [row.id, row]));
    assertNoDuplicateDraftNames(state.drafts.brackets, "label", "区分名");
    const rows = uniqueDraftRows(state.drafts.brackets, "label").filter(row => row.label).map((row, index) => ({
      ...row,
      label: String(row.label || "").trim(),
      min_days: Math.max(0, Number(row.min_days || 0)),
      max_days: row.max_days === null || row.max_days === "" ? null : Math.max(0, Number(row.max_days)),
      display_order: index + 1,
      active: true
    }));
    const keptIds = new Set(rows.filter(row => row.id).map(row => row.id));
    for (const id of originalIds) {
      if (!keptIds.has(id)) {
        await assertOk(state.client.from(TABLES.rules).delete().eq("age_bracket_id", id));
        await assertOk(state.client.from(TABLES.brackets).delete().eq("id", id));
      }
    }
    const changedExistingRows = rows.filter(row => {
      const original = row.id ? originalById.get(row.id) : null;
      return original && original.label !== row.label;
    });
    const usedTempLabels = new Set([
      ...state.data.brackets.map(row => row.label),
      ...rows.map(row => row.label)
    ]);
    for (const row of changedExistingRows) {
      const temporaryLabel = temporaryBracketLabel(row.id, usedTempLabels);
      await assertOk(state.client.from(TABLES.brackets).update({ label: temporaryLabel }).eq("id", row.id));
    }
    for (const row of rows) {
      const payload = {
        label: row.label,
        min_days: row.min_days,
        max_days: row.max_days,
        display_order: row.display_order,
        active: true
      };
      if (row.id) {
        await assertOk(state.client.from(TABLES.brackets).update(payload).eq("id", row.id));
      } else {
        await assertOk(state.client.from(TABLES.brackets).insert(payload));
      }
    }
  }

  function temporaryBracketLabel(id, usedLabels) {
    let index = 0;
    while (true) {
      const label = `__tmp_bracket_${Date.now()}_${String(id || "").slice(0, 8)}_${index}__`;
      if (!usedLabels.has(label)) {
        usedLabels.add(label);
        return label;
      }
      index += 1;
    }
  }

  async function saveMaturationRules() {
    const inputs = $$("[data-rule-room][data-rule-bracket]");
    const keptRoomIds = new Set(
      state.drafts.rooms
        .filter(row => row.id && String(row.room_name || "").trim())
        .map(row => row.id)
    );
    const keptBracketIds = new Set(
      state.drafts.brackets
        .filter(row => row.id && String(row.label || "").trim())
        .map(row => row.id)
    );
    for (const input of inputs) {
      const roomId = input.dataset.ruleRoom;
      const bracketId = input.dataset.ruleBracket;
      if (!keptRoomIds.has(roomId) || !keptBracketIds.has(bracketId)) continue;
      if (input.value === "") {
        await assertOk(state.client.from(TABLES.rules).delete().eq("room_id", roomId).eq("age_bracket_id", bracketId));
      } else {
        await assertOk(state.client.from(TABLES.rules).upsert({
          room_id: roomId,
          age_bracket_id: bracketId,
          maturation_days: Math.max(0, Math.floor(Number(input.value)))
        }, { onConflict: "room_id,age_bracket_id" }));
      }
    }
  }

  function uniqueDraftRows(rows, nameKey) {
    const seen = new Set();
    const result = [];
    rows.forEach(row => {
      const name = String(row[nameKey] || "").trim();
      if (!name || seen.has(name)) return;
      seen.add(name);
      result.push({ ...row, [nameKey]: name });
    });
    return result;
  }

  function assertNoDuplicateDraftNames(rows, nameKey, label) {
    const seen = new Set();
    rows.forEach(row => {
      const name = String(row[nameKey] || "").trim();
      if (!name) return;
      if (seen.has(name)) throw new Error(`${label}が重複しています: ${name}`);
      seen.add(name);
    });
  }

  function isRoomUsed(id) {
    return state.data.entries.some(row => row.room_id === id);
  }

  function isTypeUsed(id) {
    return state.data.entries.some(row => row.type_id === id);
  }

  function isStorageTypeUsed(id) {
    return state.data.storageEntries.some(row => row.storage_type_id === id);
  }

  function filterEntries(start, end, typeId, roomId) {
    return state.data.entries.filter(row =>
      row.entry_date >= start &&
      row.entry_date <= end &&
      matchesFilters(row, typeId, roomId)
    );
  }

  function matchesFilters(row, typeId, roomId) {
    return isVisibleMainEntry(row) &&
      (typeId === "All" || !typeId || row.type_id === typeId) &&
      (roomId === "All" || !roomId || row.room_id === roomId);
  }

  function inventoryAsOf(ymd, typeId, roomId) {
    const map = new Map();
    state.data.entries
      .filter(row => row.entry_date <= ymd && matchesFilters(row, typeId, roomId))
      .sort((a, b) => compareDisplay(a.entry_date, b.entry_date) || compareDisplay(a.recorded_at, b.recorded_at))
      .forEach(row => {
        map.set(`${row.room_id}|${row.type_id}|${row.harvest_lot_id}`, clampNumber(row.inventory_qty));
      });
    return Array.from(map.values()).reduce((sumValue, value) => sumValue + value, 0);
  }

  function latestStorageTotal(date, typeId, exactDate) {
    const ymd = typeof date === "string" ? date : dateToStr(date);
    const byType = new Map();
    state.data.storageEntries
      .filter(row => row.storage_date <= ymd)
      .filter(isVisibleStorageEntry)
      .filter(row => {
        if (typeId === "All" || !typeId) return true;
        if (!isActiveMasterRow(state.data.types, typeId)) return false;
        const mainType = state.data.types.find(type => type.id === typeId);
        const storageType = state.data.storageTypes.find(type => type.id === row.storage_type_id);
        return mainType && storageType && mainType.type_name === storageType.type_name;
      })
      .sort((a, b) => compareDisplay(a.storage_date, b.storage_date) || compareDisplay(a.recorded_at, b.recorded_at))
      .forEach(row => byType.set(row.storage_type_id, row));
    const rows = Array.from(byType.values());
    return {
      total: rows.reduce((total, row) => total + storageColumns(row), 0),
      hasActualOnDate: exactDate ? rows.some(row => row.storage_date === exactDate) : false
    };
  }

  function storageColumns(row) {
    return clampNumber(row.columns16) + clampNumber(row.pieces) / 16;
  }

  function chartOptions(leftTitle, rightTitle) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { position: "bottom" } },
      scales: {
        y: { beginAtZero: true, position: "left", title: { display: true, text: leftTitle } },
        y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: rightTitle } }
      }
    };
  }

  function setDefaultDates() {
    const today = todayStr();
    $("mainDate").value = today;
    $("mainHistoryDate").value = today;
    $("storageDate").value = today;
    $("storageHistoryDate").value = today;
    $("summaryStartDate").value = today;
    $("summaryStartDate").max = today;
    $("graphStartDate").value = dateToStr(addDays(parseYmd(today), -30));
    $("graphEndDate").value = dateToStr(addDays(parseYmd(today), 1));
    $("predictionStartDate").value = dateToStr(addDays(parseYmd(today), -7));
    $("predictionEndDate").value = dateToStr(addDays(parseYmd(today), 30));
    updateMainDateWeekday();
    updateDateWeekday("storageDate", "storageDateWeekday");
    updateDateWeekday("mainHistoryDate", "mainHistoryDateWeekday");
    updateDateWeekday("storageHistoryDate", "storageHistoryDateWeekday");
    updateSummaryControls();
  }

  function updateMainDateWeekday() {
    updateDateWeekday("mainDate", "mainDateWeekday");
  }

  function updateDateWeekday(dateInputId, weekdayOutputId) {
    const value = $(dateInputId).value;
    $(weekdayOutputId).textContent = value ? `（${weekdayLabel(value)}）` : "";
  }

  function moveDate(id, delta) {
    const input = $(id);
    const nextDate = dateToStr(addDays(parseYmd(input.value), delta));
    input.value = input.max && nextDate > input.max ? input.max : nextDate;
    input.dispatchEvent(new Event("change"));
  }

  function requireFields(payload, fields) {
    const missing = fields.filter(field => !payload[field]);
    if (missing.length) throw new Error("必須項目が未入力です。");
  }

  async function assertOk(resultPromise) {
    const { error } = await resultPromise;
    if (error) throw error;
  }

  async function withBusy(button, fn) {
    if (button.dataset.busy === "true") return;
    const oldDisabled = button.disabled;
    button.dataset.busy = "true";
    button.disabled = true;
    try {
      await fn();
    } finally {
      delete button.dataset.busy;
      button.disabled = oldDisabled;
      if (state.session) renderAccess();
    }
  }

  function showFatal(error) {
    $("loginMessage").textContent = error.message || String(error);
    showError(error);
  }

  function showError(error) {
    console.error(error);
    toast(error.message || String(error), true);
  }

  function toast(message, isError) {
    const el = $("toast");
    el.textContent = message;
    el.classList.toggle("error", !!isError);
    el.classList.remove("hidden");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.add("hidden"), isError ? 5200 : 2400);
  }

  function createIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
  }

  function clone(row) {
    return JSON.parse(JSON.stringify(row));
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[ch]));
  }

  function num(value, digits = 2) {
    if (value === null || value === undefined || value === "") return "";
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    return n.toLocaleString("ja-JP", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  }

  function numOrBlank(value, digits = 2) {
    return clampNumber(value) === 0 ? "" : num(value, digits);
  }

  function nullableNumber(value) {
    return value === "" || value === null || value === undefined ? null : clampNumber(value);
  }

  function clampNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, n);
  }

  function round2(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function sum(rows, key) {
    return rows.reduce((total, row) => total + clampNumber(row[key]), 0);
  }

  function lastValue(rows, key) {
    const row = rows.filter(item => item[key] !== null && item[key] !== undefined && item[key] !== "").at(-1);
    return row ? row[key] : "";
  }

  function lastInventory(rows) {
    const row = rows.slice().sort((a, b) => compareDisplay(a.entry_date, b.entry_date)).at(-1);
    return row ? row.inventory_qty : 0;
  }

  function unique(list) {
    return Array.from(new Set(list));
  }

  function compareDisplay(a, b) {
    return String(a || "").localeCompare(String(b || ""), "ja");
  }

  function todayStr() {
    return dateToStr(new Date());
  }

  function parseYmd(ymd) {
    const text = ymd || todayStr();
    const [y, m, d] = text.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function dateToStr(date) {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function diffDays(start, end) {
    const s = parseYmd(dateToStr(start));
    const e = parseYmd(dateToStr(end));
    return Math.floor((e.getTime() - s.getTime()) / 86400000);
  }

  function dateRange(start, end) {
    const rows = [];
    for (let d = parseYmd(dateToStr(start)); d <= parseYmd(dateToStr(end)); d = addDays(d, 1)) {
      rows.push(new Date(d));
    }
    return rows;
  }

  function startOfWeekMonday(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    return addDays(d, diff);
  }

  function fmtDate(value) {
    if (!value) return "";
    const d = parseYmd(String(value).slice(0, 10));
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    return `${d.getMonth() + 1}/${d.getDate()}(${weekdays[d.getDay()]})`;
  }

  function weekdayLabel(value) {
    if (!value) return "";
    const d = parseYmd(String(value).slice(0, 10));
    const weekdays = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];
    return weekdays[d.getDay()];
  }

  function fmtShortDate(value) {
    if (!value) return "";
    const d = parseYmd(String(value).slice(0, 10));
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  function fmtTime(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  }

  function reiwaMonthLabel(date) {
    const d = new Date(date);
    const reiwa = d.getFullYear() - 2018;
    return `令和${reiwa}年${d.getMonth() + 1}月`;
  }

  function emptyRow(colspan) {
    return `<tr><td colspan="${colspan}" class="text-left muted">データがありません。</td></tr>`;
  }

  function tableHtml(headers, rows, leftIndexes = [], totalRowIndex = -1) {
    const body = rows.length ? rows.map((row, rowIndex) => {
      const rowClass = rowIndex === totalRowIndex ? ' class="total-row"' : "";
      return `<tr${rowClass}>${row.map((cell, index) => `<td${tableCellClass(headers, index, leftIndexes)}>${esc(cell)}</td>`).join("")}</tr>`;
    }).join("") : emptyRow(headers.length);
    return `
      <div class="table-wrap">
        <table>
          <thead><tr>${headers.map((header, index) => `<th${leftIndexes.includes(index) ? ' class="text-left"' : ""}>${esc(header)}</th>`).join("")}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    `;
  }

  function matrixTableHtml(headers, bodyHtml) {
    return `
      <div class="table-wrap">
        <table class="month-matrix-table">
          <thead><tr>${headers.map((header, index) => `<th${index === headers.length - 1 ? ' class="total-col"' : ""}>${esc(header)}</th>`).join("")}</tr></thead>
          <tbody>${bodyHtml}</tbody>
        </table>
      </div>
    `;
  }

  function twoLineCell(upper, lower, upperClass = "", lowerClass = "", tdClass = "") {
    const tdClassAttr = tdClass ? ` class="${tdClass}"` : "";
    const upperClassAttr = upperClass ? ` ${upperClass}` : "";
    const lowerClassAttr = lowerClass ? ` ${lowerClass}` : "";
    return `<td${tdClassAttr}><div class="cell-container"><div class="cell-upper${upperClassAttr}">${esc(upper)}</div><div class="cell-lower${lowerClassAttr}">${esc(lower)}</div></div></td>`;
  }

  function tableCellClass(headers, index, leftIndexes = []) {
    const classes = [];
    const header = String(headers[index] || "");
    if (leftIndexes.includes(index)) classes.push("text-left");
    if (header.includes("出庫") || header.includes("搬出")) classes.push("out-cell");
    if (header.includes("入庫") || header.includes("搬入")) classes.push("in-cell");
    return classes.length ? ` class="${classes.join(" ")}"` : "";
  }

  function markSundayDateCells(root) {
    if (!root) return;
    root.querySelectorAll("tbody tr td:first-child").forEach(cell => {
      if (cell.textContent.includes("(日)")) cell.classList.add("sun-date");
    });
  }

  function fitResponsiveTables(root = document) {
    const scope = root && typeof root.querySelectorAll === "function" ? root : document;
    scope.querySelectorAll("table").forEach(table => {
      if (!table.closest(".table-wrap")) return;
      table.classList.add("responsive-fit-table");
      table.querySelectorAll("th, td").forEach(cell => {
        cell.classList.remove("fit-number-cell", "fit-text-cell", "fit-action-cell");
        if (cell.querySelector("button, input, select, textarea")) {
          cell.classList.add("fit-action-cell");
          return;
        }
        if (cell.classList.contains("num-cell") || isNumericTableText(cell.textContent)) {
          cell.classList.add("fit-number-cell");
        } else {
          cell.classList.add("fit-text-cell");
        }
      });
    });
  }

  function isNumericTableText(value) {
    const text = String(value || "").trim();
    return text === "" || /^[0-9０-９.,+\-/%％:\s]+$/.test(text);
  }

  function workerName(id) {
    const row = state.data.workers.find(item => item.worker_id === id);
    return row ? row.worker_name : id || "";
  }

  function roomName(id) {
    const row = state.data.rooms.find(item => item.id === id);
    return row ? row.room_name : id || "";
  }

  function typeName(id) {
    const row = state.data.types.find(item => item.id === id);
    return row ? row.type_name : id || "";
  }

  function storageTypeName(id) {
    const row = state.data.storageTypes.find(item => item.id === id);
    return row ? row.type_name : id || "";
  }

  function lotName(id) {
    const row = state.data.lots.find(item => item.id === id);
    return row ? row.lot_name : id || "";
  }
})();
