// ==UserScript==
// @name         WB Logistics Finished Shipments Report
// @namespace    https://logistics.wildberries.ru/
// @version      1.1.0
// @description  Отчет по завершенным рейсам WB Logistics с группировкой по водителям и экспортом CSV.
// @author       Codex
// @match        https://logistics.wildberries.ru/*
// @updateURL    https://raw.githubusercontent.com/AleksTatarinov/WB_KBT_Analize/main/dist/wb-report.user.js
// @downloadURL  https://raw.githubusercontent.com/AleksTatarinov/WB_KBT_Analize/main/dist/wb-report.user.js
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      drive.wb.ru
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  const API_URL = "https://drive.wb.ru/client-gateway/courier/api/v1/admin/shipments/finished/list";
  const SCRIPT_VERSION = "1.1.0";
  const PAGE_LIMIT = 200;
  const DETAILS_DEBUG_LIMIT = 100;
  const BUTTON_ID = "wb-report-open-button";
  const WITHDRAWALS_BUTTON_ID = "wb-withdrawals-open-button";
  const ROOT_ID = "wb-report-root";
  const WITHDRAWALS_ROOT_ID = "wb-withdrawals-root";
  const WITHDRAWALS_API_URL = "https://drive.wb.ru/client-gateway/api/finance/credeber/v2/withdrawals";
  const WITHDRAWALS_DETAILS_API_URL = "https://drive.wb.ru/client-gateway/api/finance/credeber/v2/withdrawals/details";
  const DEFAULT_SUPPLIER_ID = "4125748";
  const STATUS_LABELS = {
    ROUTE_POINT_ACTION_STATUS_DONE: "Выполнено",
    ROUTE_POINT_ACTION_STATUS_CANCELED: "Отменено",
    ROUTE_POINT_ACTION_STATUS_UNSPECIFIED: "Без статуса",
    SELL_RESULT_SOLD: "Продано",
    SELL_RESULT_REJECT: "Отказ",
    SELL_RESULT_REJECT_WITHOUT_CODE: "Отказ без кода",
    SELL_RESULT_UNSPECIFIED: "Без статуса",
    RETURN_STATUS_UNSPECIFIED: "Без возврата",
  };

  let state = {
    rows: [],
    grouped: [],
    summary: null,
    loading: false,
    detailsDebug: [],
    selectedDrivers: new Set(),
    driverFilterOpen: false,
    debug: {
      attempts: [],
      lastError: "",
    },
  };
  let withdrawalsState = {
    rows: [],
    loading: false,
    supplierId: DEFAULT_SUPPLIER_ID,
    selectedIds: new Set(),
  };
  let capturedAuthHeaders = {};
  let capturedBodyTemplate = null;
  let workingPayloadBuilder = null;

  const css = `
    #${BUTTON_ID} {
      position: fixed;
      right: 20px;
      bottom: 24px;
      z-index: 2147483000;
      border: 0;
      border-radius: 8px;
      padding: 12px 16px;
      background: #7c2dff;
      color: #fff;
      font: 600 14px/1.2 Arial, sans-serif;
      box-shadow: 0 10px 30px rgba(0, 0, 0, .24);
      cursor: pointer;
    }
    #${BUTTON_ID}:hover { background: #6421d6; }
    #${WITHDRAWALS_BUTTON_ID} {
      position: fixed;
      right: 20px;
      bottom: 80px;
      z-index: 2147483000;
      border: 0;
      border-radius: 8px;
      padding: 12px 16px;
      background: #0f766e;
      color: #fff;
      font: 600 14px/1.2 Arial, sans-serif;
      box-shadow: 0 10px 30px rgba(0, 0, 0, .24);
      cursor: pointer;
    }
    #${WITHDRAWALS_BUTTON_ID}:hover { background: #115e59; }
    #${ROOT_ID} {
      position: fixed;
      inset: 0;
      z-index: 2147483001;
      display: none;
      font: 14px/1.45 Arial, sans-serif;
      color: #1f2937;
    }
    #${ROOT_ID}.is-open { display: block; }
    #${WITHDRAWALS_ROOT_ID} {
      position: fixed;
      inset: 0;
      z-index: 2147483002;
      display: none;
      font: 14px/1.45 Arial, sans-serif;
      color: #1f2937;
    }
    #${WITHDRAWALS_ROOT_ID}.is-open { display: block; }
    .wb-report-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(15, 23, 42, .48);
    }
    .wb-report-modal {
      position: absolute;
      inset: 32px;
      display: grid;
      grid-template-rows: auto auto 1fr;
      overflow: hidden;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 24px 80px rgba(0, 0, 0, .35);
    }
    .wb-report-header,
    .wb-report-controls {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 20px;
      border-bottom: 1px solid #e5e7eb;
    }
    .wb-report-header { justify-content: space-between; }
    .wb-report-title {
      margin: 0;
      font-size: 18px;
      line-height: 1.2;
      font-weight: 700;
    }
    .wb-report-version {
      margin-left: 8px;
      color: #6b7280;
      font-size: 12px;
      font-weight: 600;
    }
    .wb-report-controls {
      flex-wrap: wrap;
      background: #f9fafb;
    }
    .wb-report-field {
      display: grid;
      gap: 4px;
      color: #4b5563;
      font-size: 12px;
      font-weight: 600;
    }
    .wb-report-field input {
      min-width: 160px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: 8px 10px;
      font: 14px/1.2 Arial, sans-serif;
      color: #111827;
      background: #fff;
    }
    .wb-report-btn {
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: 9px 12px;
      background: #fff;
      color: #111827;
      font: 600 14px/1.2 Arial, sans-serif;
      cursor: pointer;
    }
    .wb-report-btn:hover { background: #f3f4f6; }
    .wb-report-btn-primary {
      border-color: #7c2dff;
      background: #7c2dff;
      color: #fff;
    }
    .wb-report-btn-primary:hover { background: #6421d6; }
    .wb-report-btn:disabled {
      opacity: .55;
      cursor: not-allowed;
    }
    .wb-report-close {
      width: 36px;
      height: 36px;
      padding: 0;
      border-radius: 50%;
      font-size: 22px;
      line-height: 1;
    }
    .wb-report-content {
      overflow: auto;
      padding: 18px 20px 22px;
      background: #fff;
    }
    .wb-report-status {
      min-height: 20px;
      color: #6b7280;
      font-size: 13px;
    }
    .wb-report-summary {
      display: grid;
      grid-template-columns: repeat(5, minmax(120px, 1fr));
      gap: 10px;
      margin: 0 0 18px;
    }
    .wb-report-analytics {
      display: grid;
      grid-template-columns: repeat(4, minmax(180px, 1fr));
      gap: 10px;
      margin: 0 0 18px;
    }
    .wb-report-chart-card {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 12px;
      background: linear-gradient(180deg, #ffffff 0%, #f9fafb 100%);
    }
    .wb-report-chart-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
    }
    .wb-report-chart-label {
      color: #6b7280;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .wb-report-chart-value {
      color: #111827;
      font-size: 22px;
      font-weight: 800;
      line-height: 1.1;
      text-align: right;
    }
    .wb-report-chart-svg {
      display: block;
      width: 100%;
      height: 88px;
      margin: 6px 0 8px;
    }
    .wb-report-chart-footer {
      color: #6b7280;
      font-size: 12px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .wb-report-stat {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 12px;
      background: #f9fafb;
    }
    .wb-report-stat-label {
      margin-bottom: 6px;
      color: #6b7280;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .wb-report-stat-value {
      color: #111827;
      font-size: 20px;
      font-weight: 800;
    }
    .wb-report-section-title {
      margin: 18px 0 8px;
      font-size: 16px;
      line-height: 1.2;
    }
    .wb-report-filter {
      position: relative;
      width: min(420px, 100%);
      margin: 0 0 18px;
    }
    .wb-report-filter > summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 42px;
      padding: 9px 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      background: #fff;
      color: #111827;
      font-weight: 800;
      cursor: pointer;
      list-style: none;
    }
    .wb-report-filter > summary::-webkit-details-marker { display: none; }
    .wb-report-filter > summary::marker { content: ""; }
    .wb-report-filter > summary::after {
      content: "▾";
      color: #6b7280;
      font-size: 12px;
    }
    .wb-report-filter[open] > summary::after { content: "▴"; }
    .wb-report-filter-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      padding: 10px 10px 8px;
      border-bottom: 1px solid #e5e7eb;
    }
    .wb-report-filter-grid {
      max-height: 320px;
      overflow: auto;
      display: grid;
      gap: 4px;
      padding: 8px;
    }
    .wb-report-filter-menu {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      z-index: 20;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 18px 40px rgba(15, 23, 42, .18);
    }
    .wb-report-filter-option {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      padding: 8px 10px;
      border-radius: 6px;
      background: #fff;
      color: #374151;
      font-size: 13px;
      font-weight: 700;
    }
    .wb-report-filter-option:hover { background: #f9fafb; }
    .wb-report-filter-option input { margin: 0; }
    .wb-report-filter-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .wb-report-filter-count {
      margin-left: auto;
      color: #6b7280;
      font-size: 12px;
    }
    .wb-report-table-wrap {
      overflow: auto;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #fff;
    }
    .wb-report-table {
      width: 100%;
      min-width: 980px;
      border-collapse: collapse;
      font-size: 13px;
    }
    .wb-report-table th,
    .wb-report-table td {
      padding: 9px 10px;
      border-bottom: 1px solid #e5e7eb;
      text-align: left;
      vertical-align: top;
      white-space: nowrap;
    }
    .wb-report-table .wb-report-checkbox-col {
      width: 44px;
      min-width: 44px;
      text-align: center;
    }
    .wb-report-table .wb-report-checkbox-col input {
      width: 16px;
      height: 16px;
      cursor: pointer;
    }
    .wb-report-table .wb-report-text-wrap {
      min-width: 220px;
      white-space: normal;
      word-break: break-word;
    }
    .wb-report-table th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: #f3f4f6;
      color: #374151;
      font-size: 12px;
      text-transform: uppercase;
    }
    .wb-report-table tr:last-child td { border-bottom: 0; }
    .wb-report-num { text-align: right !important; }
    .wb-report-driver-list {
      display: grid;
      gap: 10px;
    }
    .wb-report-driver {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #fff;
      overflow: hidden;
    }
    .wb-report-driver summary {
      display: grid;
      grid-template-columns: 18px minmax(220px, 1.6fr) repeat(6, minmax(88px, 1fr));
      gap: 12px;
      align-items: center;
      padding: 12px 14px;
      background: #f9fafb;
      cursor: pointer;
      list-style: none;
    }
    .wb-report-driver summary::-webkit-details-marker { display: none; }
    .wb-report-driver summary::marker { content: ""; }
    .wb-report-driver summary::before {
      content: "›";
      color: #6b7280;
      font-size: 20px;
      font-weight: 800;
      transform: rotate(0deg);
      transition: transform .15s ease;
    }
    .wb-report-driver[open] summary::before { transform: rotate(90deg); }
    .wb-report-driver-main {
      min-width: 0;
      font-weight: 800;
      color: #111827;
    }
    .wb-report-driver-phone {
      margin-top: 2px;
      color: #6b7280;
      font-size: 12px;
      font-weight: 600;
    }
    .wb-report-driver-metric {
      color: #111827;
      font-weight: 800;
      text-align: right;
    }
    .wb-report-driver-metric span {
      display: block;
      margin-bottom: 2px;
      color: #6b7280;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .wb-report-driver-body {
      padding: 12px 14px 14px;
      border-top: 1px solid #e5e7eb;
    }
    .wb-report-trip-status {
      max-width: 260px;
      white-space: normal !important;
      color: #374151;
      font-size: 12px;
    }
    .wb-report-trip-conversion {
      font-weight: 700;
      color: #111827;
    }
    .wb-report-empty {
      padding: 28px;
      border: 1px dashed #d1d5db;
      border-radius: 8px;
      color: #6b7280;
      text-align: center;
    }
    @media (max-width: 900px) {
      .wb-report-modal { inset: 10px; }
      .wb-report-summary { grid-template-columns: repeat(2, minmax(120px, 1fr)); }
      .wb-report-analytics { grid-template-columns: repeat(1, minmax(0, 1fr)); }
      .wb-report-driver summary { grid-template-columns: 1fr; }
      .wb-report-driver summary::before { display: none; }
      .wb-report-driver-metric { text-align: left; }
      .wb-report-filter { width: 100%; }
      .wb-report-header,
      .wb-report-controls { padding: 12px; }
      .wb-report-content { padding: 12px; }
    }
  `;

  function injectStyle() {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  function createOpenButton() {
    if (document.getElementById(BUTTON_ID)) return;
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "📊 Отчет";
    button.addEventListener("click", openModal);
    document.body.appendChild(button);
  }

  function createWithdrawalsButton() {
    if (document.getElementById(WITHDRAWALS_BUTTON_ID)) return;
    const button = document.createElement("button");
    button.id = WITHDRAWALS_BUTTON_ID;
    button.type = "button";
    button.textContent = "🧾 Данные по заявкам";
    button.addEventListener("click", openWithdrawalsModal);
    document.body.appendChild(button);
  }

  function createModal() {
    if (document.getElementById(ROOT_ID)) return;

    const today = formatDateInput(new Date());
    const weekAgo = formatDateInput(addDays(new Date(), -7));
    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.innerHTML = `
      <div class="wb-report-backdrop" data-action="close"></div>
      <section class="wb-report-modal" role="dialog" aria-modal="true" aria-labelledby="wb-report-title">
        <header class="wb-report-header">
          <h2 class="wb-report-title" id="wb-report-title">Отчет по завершенным рейсам <span class="wb-report-version">v${SCRIPT_VERSION}</span></h2>
          <button class="wb-report-btn wb-report-close" type="button" data-action="close" title="Закрыть">×</button>
        </header>
        <div class="wb-report-controls">
          <label class="wb-report-field">
            dateFrom
            <input id="wb-report-date-from" type="date" value="${weekAgo}">
          </label>
          <label class="wb-report-field">
            dateTo
            <input id="wb-report-date-to" type="date" value="${today}">
          </label>
          <button class="wb-report-btn wb-report-btn-primary" type="button" id="wb-report-load">Сформировать</button>
          <button class="wb-report-btn" type="button" id="wb-report-export" disabled>Экспорт CSV</button>
          <button class="wb-report-btn" type="button" id="wb-report-details-debug" disabled>Собрать детали</button>
          <button class="wb-report-btn" type="button" id="wb-report-debug">Скопировать отладку</button>
          <span class="wb-report-status" id="wb-report-status"></span>
        </div>
        <main class="wb-report-content" id="wb-report-content">
          <div class="wb-report-empty">Выберите даты и сформируйте отчет.</div>
        </main>
      </section>
    `;

    root.addEventListener("click", (event) => {
      const target = event.target;
      if (target && target.dataset && target.dataset.action === "close") closeModal();
      if (target && target.dataset && target.dataset.action === "select-all-drivers") {
        state.driverFilterOpen = Boolean(target.closest(".wb-report-filter"));
        setAllDriversSelected(true);
      }
      if (target && target.dataset && target.dataset.action === "clear-drivers") {
        state.driverFilterOpen = Boolean(target.closest(".wb-report-filter"));
        setAllDriversSelected(false);
      }
    });
    root.addEventListener("change", (event) => {
      const target = event.target;
      if (target && target.dataset && target.dataset.driverKey) {
        state.driverFilterOpen = Boolean(target.closest(".wb-report-filter"));
        toggleDriverFilter(target.dataset.driverKey, target.checked);
      }
    });
    root.querySelector("#wb-report-load").addEventListener("click", loadReport);
    root.querySelector("#wb-report-export").addEventListener("click", exportCsv);
    root.querySelector("#wb-report-details-debug").addEventListener("click", collectDetailsDebug);
    root.querySelector("#wb-report-debug").addEventListener("click", copyDebugInfo);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && root.classList.contains("is-open")) closeModal();
    });
    document.body.appendChild(root);
  }

  function createWithdrawalsModal() {
    if (document.getElementById(WITHDRAWALS_ROOT_ID)) return;

    const today = formatDateInput(new Date());
    const monthAgo = formatDateInput(addDays(new Date(), -30));
    const root = document.createElement("div");
    root.id = WITHDRAWALS_ROOT_ID;
    root.innerHTML = `
      <div class="wb-report-backdrop" data-action="close"></div>
      <section class="wb-report-modal" role="dialog" aria-modal="true" aria-labelledby="wb-withdrawals-title">
        <header class="wb-report-header">
          <h2 class="wb-report-title" id="wb-withdrawals-title">Данные по заявкам <span class="wb-report-version">v${SCRIPT_VERSION}</span></h2>
          <button class="wb-report-btn wb-report-close" type="button" data-action="close" title="Закрыть">×</button>
        </header>
        <div class="wb-report-controls">
          <label class="wb-report-field">
            supplierId
            <input id="wb-withdrawals-supplier-id" type="text" value="${escapeHtml(withdrawalsState.supplierId || DEFAULT_SUPPLIER_ID)}" inputmode="numeric">
          </label>
          <label class="wb-report-field">
            dateFrom
            <input id="wb-withdrawals-date-from" type="date" value="${monthAgo}">
          </label>
          <label class="wb-report-field">
            dateTo
            <input id="wb-withdrawals-date-to" type="date" value="${today}">
          </label>
          <button class="wb-report-btn wb-report-btn-primary" type="button" id="wb-withdrawals-load">Загрузить</button>
          <button class="wb-report-btn" type="button" id="wb-withdrawals-export" disabled>Экспорт CSV</button>
          <button class="wb-report-btn" type="button" id="wb-withdrawals-export-xlsx" disabled>Экспорт XLSX</button>
          <button class="wb-report-btn" type="button" id="wb-withdrawals-select-all" disabled>Отметить все</button>
          <button class="wb-report-btn" type="button" id="wb-withdrawals-clear-selection" disabled>Снять выделение</button>
          <span class="wb-report-status" id="wb-withdrawals-status"></span>
        </div>
        <main class="wb-report-content" id="wb-withdrawals-content">
          <div class="wb-report-empty">Укажите supplierId и даты, затем загрузите заявки.</div>
        </main>
      </section>
    `;

    root.addEventListener("click", (event) => {
      const target = event.target;
      if (target && target.dataset && target.dataset.action === "close") closeWithdrawalsModal();
      if (target && target.id === "wb-withdrawals-select-all") setAllWithdrawalsSelected(true);
      if (target && target.id === "wb-withdrawals-clear-selection") setAllWithdrawalsSelected(false);
    });
    root.addEventListener("change", (event) => {
      const target = event.target;
      if (target && target.dataset && target.dataset.withdrawalKey) {
        toggleWithdrawalSelection(target.dataset.withdrawalKey, target.checked);
      }
    });
    root.querySelector("#wb-withdrawals-load").addEventListener("click", loadWithdrawals);
    root.querySelector("#wb-withdrawals-export").addEventListener("click", exportWithdrawalsCsv);
    root.querySelector("#wb-withdrawals-export-xlsx").addEventListener("click", exportWithdrawalsXlsx);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && root.classList.contains("is-open")) closeWithdrawalsModal();
    });
    document.body.appendChild(root);
  }

  function openModal() {
    createModal();
    document.getElementById(ROOT_ID).classList.add("is-open");
  }

  function openWithdrawalsModal() {
    createWithdrawalsModal();
    document.getElementById(WITHDRAWALS_ROOT_ID).classList.add("is-open");
  }

  function closeModal() {
    const root = document.getElementById(ROOT_ID);
    if (root) root.classList.remove("is-open");
  }

  function closeWithdrawalsModal() {
    const root = document.getElementById(WITHDRAWALS_ROOT_ID);
    if (root) root.classList.remove("is-open");
  }

  async function loadReport() {
    const dateFrom = document.getElementById("wb-report-date-from").value;
    const dateTo = document.getElementById("wb-report-date-to").value;

    if (!dateFrom || !dateTo) {
      setStatus("Укажите dateFrom и dateTo.");
      return;
    }
    if (dateFrom > dateTo) {
      setStatus("dateFrom не может быть позже dateTo.");
      return;
    }

    setLoading(true);
    setStatus("Загружаю первую страницу...");
    state.debug.attempts = [];
    state.debug.lastError = "";

    try {
      const rows = await fetchAllPages(dateFrom, dateTo);
      state.rows = rows.map(normalizeShipment);
      state.selectedDrivers = new Set(state.rows.map(driverKey));
      state.driverFilterOpen = false;
      state.grouped = groupByDriver(getFilteredRows());
      state.summary = buildSummary(getFilteredRows());
      state.detailsDebug = [];
      renderReport();
      setStatus(`Готово: ${formatNumber(state.rows.length)} рейсов.`);
    } catch (error) {
      console.error("[WB Report]", error);
      state.debug.lastError = error && error.message ? error.message : String(error);
      renderEmpty(error && error.message ? error.message : "Не удалось сформировать отчет.");
      setStatus("Ошибка загрузки.");
    } finally {
      setLoading(false);
    }
  }

  async function fetchAllPages(dateFrom, dateTo) {
    const result = [];
    let lastId = null;
    let page = 1;
    let hasNext = true;

    while (hasNext) {
      setStatus(`Загружаю страницу ${page}...`);
      const response = await postReportPage({ dateFrom, dateTo, lastId });
      const data = readArray(response, ["data", "items", "shipments", "result.data", "result.items"]);
      const meta = readObject(response, ["meta", "result.meta", "pagination", "result.pagination"]);

      result.push(...data);

      lastId = pick(meta, ["last_id", "lastId", "lastID"]) ?? pick(response, ["last_id", "lastId"]);
      hasNext = Boolean(pick(meta, ["has_next", "hasNext"]) ?? pick(response, ["has_next", "hasNext"]));

      if (hasNext && (lastId === null || lastId === undefined || lastId === "")) {
        throw new Error("API вернул has_next=true, но meta.last_id отсутствует.");
      }

      page += 1;
    }

    return result;
  }

  async function postReportPage(params) {
    const builders = workingPayloadBuilder
      ? [workingPayloadBuilder]
      : buildPayloadBuilders();
    let lastError = null;

    for (const builder of builders) {
      try {
        const payload = builder.build(params);
        rememberPayloadAttempt(builder.name, payload);
        const response = await postJson(API_URL, payload);
        workingPayloadBuilder = builder;
        return response;
      } catch (error) {
        lastError = error;
        if (!isPayloadShapeError(error)) throw error;
        console.warn(`[WB Report] Формат payload не подошел: ${builder.name}`, error);
      }
    }

    throw lastError || new Error("Не удалось подобрать формат тела запроса.");
  }

  async function collectDetailsDebug() {
    if (!state.rows.length) {
      setStatus("Сначала сформируйте отчет.");
      return;
    }

    const rows = getFilteredRows().filter((row) => row.id).slice(0, DETAILS_DEBUG_LIMIT);
    if (!rows.length) {
      setStatus("В рейсах нет ID заданий для загрузки деталей.");
      return;
    }

    setDetailsDebugLoading(true);
    state.detailsDebug = [];

    try {
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        setStatus(`Загружаю детали ${index + 1}/${rows.length}...`);
        state.detailsDebug.push(await fetchShipmentLoadingPointsDebug(row));
      }
      renderReport();
      setStatus(`Детали собраны: ${state.detailsDebug.length}. Нажмите "Скопировать отладку".`);
    } catch (error) {
      console.error("[WB Report]", error);
      state.debug.lastError = error && error.message ? error.message : String(error);
      setStatus("Ошибка загрузки деталей.");
    } finally {
      setDetailsDebugLoading(false);
    }
  }

  async function loadWithdrawals() {
    const supplierId = String(document.getElementById("wb-withdrawals-supplier-id").value || "").trim();
    const dateFrom = document.getElementById("wb-withdrawals-date-from").value;
    const dateTo = document.getElementById("wb-withdrawals-date-to").value;

    if (!supplierId) {
      setWithdrawalsStatus("Укажите supplierId.");
      return;
    }
    if (!dateFrom || !dateTo) {
      setWithdrawalsStatus("Укажите dateFrom и dateTo.");
      return;
    }
    if (dateFrom > dateTo) {
      setWithdrawalsStatus("dateFrom не может быть позже dateTo.");
      return;
    }

    withdrawalsState.supplierId = supplierId;
    setWithdrawalsLoading(true);
    setWithdrawalsStatus("Загружаю заявки...");

    try {
      const rows = await fetchAllWithdrawals({ supplierId, dateFrom, dateTo });
      const normalizedRows = rows.map(normalizeWithdrawal);
      withdrawalsState.rows = await enrichWithdrawalsWithDetails(normalizedRows);
      withdrawalsState.selectedIds = new Set();
      renderWithdrawals();
      setWithdrawalsStatus(`Готово: ${formatNumber(withdrawalsState.rows.length)} заявок.`);
    } catch (error) {
      console.error("[WB Report] Withdrawals", error);
      renderWithdrawalsEmpty(error && error.message ? error.message : "Не удалось загрузить заявки.");
      setWithdrawalsStatus("Ошибка загрузки.");
    } finally {
      setWithdrawalsLoading(false);
    }
  }

  async function fetchAllWithdrawals({ supplierId, dateFrom, dateTo }) {
    const result = [];
    let page = 1;
    let pageField = "";
    let offset = 0;
    let token = "";
    let hasNext = true;
    const seenSignatures = new Set();

    while (hasNext) {
      setWithdrawalsStatus(`Загружаю страницу ${page}...`);
      const response = await getWithdrawalsPage({ supplierId, dateFrom, dateTo, page, pageField, offset, token });
      const rows = readArray(response, [
        "data.withdrawals", "data.items", "data", "items", "withdrawals",
        "result.data", "result.items",
      ]);
      const meta = readObject(response, [
        "meta", "pagination", "data.meta", "result.meta", "result.pagination",
      ]);
      const signature = JSON.stringify(rows.slice(0, 5).map((row) => value(row, [
        "id", "withdrawal_id", "withdrawalId", "request_id", "requestId", "number",
      ])));

      if (seenSignatures.has(signature) && rows.length) break;
      if (signature !== "[]") seenSignatures.add(signature);
      result.push(...rows);

      const nextInfo = resolveWithdrawalsNextPage({ rows, meta, response, page, pageField, offset, token });
      hasNext = nextInfo.hasNext;
      page = nextInfo.page;
      pageField = nextInfo.pageField;
      offset = nextInfo.offset;
      token = nextInfo.token;
    }

    return result;
  }

  async function getWithdrawalsPage({ supplierId, dateFrom, dateTo, page, pageField, offset, token }) {
    const query = new URLSearchParams({
      supplier_id: supplierId,
      create_from: toApiDateStartOffset(dateFrom),
      create_to: toApiDateEndOffset(dateTo),
      page_size: String(PAGE_LIMIT),
    });

    if (token) query.set("page_token", token);
    if (offset > 0) query.set("offset", String(offset));
    if (pageField) query.set(pageField, String(page));

    return requestJson("GET", `${WITHDRAWALS_API_URL}?${query.toString()}`);
  }

  async function enrichWithdrawalsWithDetails(rows) {
    const result = [];

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (!row.ropId) {
        result.push(row);
        continue;
      }

      setWithdrawalsStatus(`Загружаю детали заявок ${index + 1}/${rows.length}...`);

      try {
        const detail = await fetchWithdrawalDetails(row.ropId);
        result.push({ ...row, ...detail });
      } catch (error) {
        console.warn("[WB Report] Withdrawal details", row.ropId, error);
        result.push({
          ...row,
          detailsError: error && error.message ? error.message : String(error),
        });
      }
    }

    return result;
  }

  async function fetchWithdrawalDetails(ropId) {
    const query = new URLSearchParams({ rop_id: String(ropId) });
    const response = await requestJson("GET", `${WITHDRAWALS_DETAILS_API_URL}?${query.toString()}`);
    const detail = readObject(response, ["data", "result.data"]);
    return normalizeWithdrawal(detail);
  }

  function withdrawalKey(row) {
    return String(row && (row.ropId || row.id || ""));
  }

  function getSelectedWithdrawals() {
    if (!withdrawalsState.selectedIds.size) return [];
    return withdrawalsState.rows.filter((row) => withdrawalsState.selectedIds.has(withdrawalKey(row)));
  }

  function toggleWithdrawalSelection(key, selected) {
    if (!key) return;
    if (selected) withdrawalsState.selectedIds.add(String(key));
    else withdrawalsState.selectedIds.delete(String(key));
    updateWithdrawalsSelectionControls();
  }

  function setAllWithdrawalsSelected(selected) {
    withdrawalsState.selectedIds = selected
      ? new Set(withdrawalsState.rows.map(withdrawalKey).filter(Boolean))
      : new Set();
    renderWithdrawals();
  }

  function resolveWithdrawalsNextPage({ rows, meta, response, page, pageField, offset, token }) {
    const explicitHasNext = pick(meta, ["has_next", "hasNext", "next"]) ?? pick(response, ["has_next", "hasNext"]);
    const nextToken = pick(meta, ["next_page_token", "nextPageToken", "page_token", "pageToken"])
      ?? pick(response, ["next_page_token", "nextPageToken", "page_token", "pageToken"]);

    if (nextToken) {
      return {
        hasNext: true,
        page,
        pageField,
        offset,
        token: String(nextToken),
      };
    }

    const currentPage = Number(
      pick(meta, ["page", "page_number", "pageNumber", "current_page", "currentPage"])
      ?? pick(response, ["page", "page_number", "pageNumber", "current_page", "currentPage"])
      ?? page
    ) || page;

    const nextPage = Number(
      pick(meta, ["next_page", "nextPage", "next_page_number", "nextPageNumber"])
      ?? pick(response, ["next_page", "nextPage", "next_page_number", "nextPageNumber"])
    );

    if (Number.isFinite(nextPage) && nextPage > currentPage) {
      return {
        hasNext: true,
        page: nextPage,
        pageField: pageField || "page",
        offset,
        token: "",
      };
    }

    const pageBasedHasNext = explicitHasNext === true || explicitHasNext === "true";
    if (pageBasedHasNext || rows.length === PAGE_LIMIT) {
      return {
        hasNext: rows.length === PAGE_LIMIT || pageBasedHasNext,
        page: currentPage + 1,
        pageField: pageField || "page",
        offset: offset + rows.length,
        token: token || "",
      };
    }

    return {
      hasNext: false,
      page,
      pageField,
      offset,
      token,
    };
  }

  function normalizeWithdrawal(item) {
    return {
      id: value(item, ["id", "withdrawal_id", "withdrawalId", "request_id", "requestId", "number"]),
      ropId: value(item, ["rop_id", "ropId"]),
      createdAt: value(item, ["create_dt", "create_at", "createAt", "created_at", "createdAt", "created_date", "createdDate"]),
      updatedAt: value(item, ["update_dt", "updated_at", "updatedAt", "status_dt", "statusAt"]),
      status: value(item, ["status_name", "statusName", "status", "state", "withdrawal_status", "withdrawalStatus"]),
      statusCode: value(item, ["status", "state", "withdrawal_status", "withdrawalStatus"]),
      statusComment: value(item, ["status_comment", "statusComment"]),
      amount: numberValue(item, [
        "amount_with_vat.value", "amountWithVat.value", "amount", "sum", "total", "value", "money.amount",
      ]),
      amountTaxable: numberValue(item, ["amount_taxable.value", "amountTaxable.value"]),
      amountTaxableWithVat: numberValue(item, ["amount_taxable_with_vat.value", "amountTaxableWithVat.value"]),
      amountCurrencyWithVat: numberValue(item, ["amount_currency_with_vat.value", "amountCurrencyWithVat.value"]),
      currency: value(item, ["currency_name", "currencyName", "currency", "money.currency", "amount_currency"]) || "RUB",
      currencyCode: value(item, ["currency_code", "currencyCode"]),
      currencyRate: numberValue(item, ["currency_rate", "currencyRate"]),
      supplierId: value(item, ["supplier_id", "supplierId"]) || withdrawalsState.supplierId,
      supplierName: value(item, ["supplier_name", "supplierName"]),
      recipient: value(item, [
        "receiver", "recipient", "bank_details.recipient", "bankDetails.recipient",
        "bank_account_holder", "supplier_name", "supplierName",
      ]),
      account: value(item, ["bank_account", "bankAccount", "bank_details.account", "bankDetails.account"]),
      vatName: value(item, ["vat_name", "vatName"]),
      minDeliveryAt: value(item, ["min_delivery_dt", "minDeliveryDt"]),
      maxDeliveryAt: value(item, ["max_delivery_dt", "maxDeliveryDt"]),
      paymentOrderId: value(item, ["findep_data.findep_payment_order_id", "findepData.findepPaymentOrderId"]),
      paymentOrderStatus: value(item, ["findep_data.findep_payment_order_status_id", "findepData.findepPaymentOrderStatusId"]),
      paymentOrderStatusName: value(item, [
        "findep_data.findep_payment_order_status_id_name",
        "findepData.findepPaymentOrderStatusIdName",
      ]),
      paymentOrderStatusDescription: value(item, [
        "findep_data.findep_payment_order_status_description",
        "findepData.findepPaymentOrderStatusDescription",
      ]),
      paymentOrderDate: value(item, ["findep_data.findep_payment_order_date", "findepData.findepPaymentOrderDate"]),
      comment: value(item, ["comment", "description", "reason", "purpose", "status"]),
      raw: item,
    };
  }

  function renderWithdrawals() {
    const content = document.getElementById("wb-withdrawals-content");
    if (!content) return;

    if (!withdrawalsState.rows.length) {
      renderWithdrawalsEmpty("За выбранный период заявки не найдены.");
      setWithdrawalsExportEnabled(false);
      return;
    }

    const totalAmount = sum(withdrawalsState.rows, "amount");
    const statuses = withdrawalsState.rows.reduce((result, row) => {
      const key = row.status || "Без статуса";
      result[key] = (result[key] || 0) + 1;
      return result;
    }, {});

    content.innerHTML = `
      <div class="wb-report-summary">
        ${renderStat("Заявки", formatNumber(withdrawalsState.rows.length))}
        ${renderStat("Сумма", formatMoney(totalAmount))}
        ${renderStat("supplierId", withdrawalsState.supplierId)}
        ${renderStat("Статусы", formatNumber(Object.keys(statuses).length))}
        ${renderStat("Первый статус", Object.keys(statuses)[0] || "—")}
      </div>
      <div class="wb-report-table-wrap">
        <table class="wb-report-table">
          <thead>
            <tr>
              <th class="wb-report-checkbox-col"></th>
              <th>ID</th>
              <th>ROP</th>
              <th>Создано</th>
              <th>Статус</th>
              <th class="wb-report-text-wrap">Комментарий статуса</th>
              <th class="wb-report-num">Сумма</th>
              <th class="wb-report-num">Сумма без НДС</th>
              <th class="wb-report-num">Сумма с НДС база</th>
              <th>Валюта</th>
              <th>Ставка НДС</th>
              <th>Период доставок</th>
              <th>Поставщик</th>
              <th>Статус платежки</th>
              <th>Дата платежки</th>
            </tr>
          </thead>
          <tbody>
            ${withdrawalsState.rows.map((row) => `
              <tr>
                <td class="wb-report-checkbox-col"><input type="checkbox" data-withdrawal-key="${escapeHtml(withdrawalKey(row))}"${withdrawalsState.selectedIds.has(withdrawalKey(row)) ? " checked" : ""}></td>
                <td>${escapeHtml(row.id)}</td>
                <td>${escapeHtml(row.ropId)}</td>
                <td>${escapeHtml(formatDateTime(row.createdAt))}</td>
                <td>${escapeHtml(row.status)}</td>
                <td class="wb-report-text-wrap">${escapeHtml(row.statusComment)}</td>
                <td class="wb-report-num">${escapeHtml(formatMoneyWithCurrency(row.amount, row.currency))}</td>
                <td class="wb-report-num">${escapeHtml(formatMoney(row.amountTaxable))}</td>
                <td class="wb-report-num">${escapeHtml(formatMoney(row.amountTaxableWithVat))}</td>
                <td>${escapeHtml(row.currency)}</td>
                <td>${escapeHtml(row.vatName)}</td>
                <td>${escapeHtml(formatPeriod(row.minDeliveryAt, row.maxDeliveryAt))}</td>
                <td>${escapeHtml(row.supplierName || row.recipient)}</td>
                <td>${escapeHtml(row.paymentOrderStatusName || row.statusCode)}</td>
                <td>${escapeHtml(formatDateTime(row.paymentOrderDate))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
    setWithdrawalsExportEnabled(true);
    updateWithdrawalsSelectionControls();
  }

  function renderWithdrawalsEmpty(message) {
    const content = document.getElementById("wb-withdrawals-content");
    if (!content) return;
    content.innerHTML = `<div class="wb-report-empty">${escapeHtml(message)}</div>`;
  }

  function exportWithdrawalsCsv() {
    if (!withdrawalsState.rows.length) return;

    const lines = [];
    lines.push([
      "ID", "ROP", "Создано", "Статус", "Код статуса", "Комментарий статуса",
      "Сумма", "Сумма без НДС", "Сумма с НДС база", "Сумма в валюте",
      "Валюта", "Код валюты", "Курс", "НДС", "supplierId", "Поставщик",
      "Мин. доставка", "Макс. доставка", "Платежка ID", "Статус платежки",
      "Код статуса платежки", "Описание статуса платежки", "Дата платежки",
    ]);
    for (const row of withdrawalsState.rows) {
      lines.push([
        row.id,
        row.ropId,
        formatDateTime(row.createdAt),
        row.status,
        row.statusCode,
        row.statusComment,
        decimal(row.amount),
        decimal(row.amountTaxable),
        decimal(row.amountTaxableWithVat),
        decimal(row.amountCurrencyWithVat),
        row.currency,
        row.currencyCode,
        decimal(row.currencyRate),
        row.vatName,
        row.supplierId,
        row.supplierName || row.recipient,
        formatDateTime(row.minDeliveryAt),
        formatDateTime(row.maxDeliveryAt),
        row.paymentOrderId,
        row.paymentOrderStatusName,
        row.paymentOrderStatus,
        row.paymentOrderStatusDescription,
        formatDateTime(row.paymentOrderDate),
      ]);
    }

    const csv = "\uFEFF" + lines.map(toCsvLine).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const dateFrom = document.getElementById("wb-withdrawals-date-from").value;
    const dateTo = document.getElementById("wb-withdrawals-date-to").value;

    link.href = url;
    link.download = `wb-withdrawals-${withdrawalsState.supplierId}-${dateFrom}-${dateTo}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function exportWithdrawalsXlsx() {
    const rows = getSelectedWithdrawals();
    if (!rows.length) {
      setWithdrawalsStatus("Отметьте хотя бы одну заявку.");
      return;
    }

    const sheetRows = rows.map((row) => ([
      formatDateOnly(row.createdAt),
      Number(row.amountTaxableWithVat) || 0,
      `Оказание транспортных услуг по реестру №${row.ropId || row.id || ""}`,
    ]));

    const blob = buildXlsxBlob({
      sheetName: "Услуги",
      headers: ["Дата создания документа", "Сумма с НДС база", "Наименование услуги"],
      rows: sheetRows,
      numericColumns: new Set([1]),
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const supplierName = sanitizeFilename(rows[0] && rows[0].supplierName ? rows[0].supplierName : withdrawalsState.supplierId);
    const reportDate = formatDateInput(new Date());

    link.href = url;
    link.download = `${supplierName} ${reportDate}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function fetchShipmentLoadingPointsDebug(row) {
    const url = `${shipmentDetailsBaseUrl(row.id)}/loading-points`;
    const payloads = [
      { name: "no-body", value: undefined },
      { name: "empty-object", value: {} },
      { name: "data-meta-empty", value: { data: {}, meta: {} } },
    ];
    let lastError = "";

    for (const payload of payloads) {
      try {
        const response = await postJson(url, payload.value);
        return {
          id: row.id,
          driverName: row.driverName,
          driverPhone: row.driverPhone,
          url,
          method: "POST",
          payloadName: payload.name,
          payload: payload.value ?? null,
          summary: summarizeLoadingPointsDetails(response),
          packagesSample: flattenLoadingPointsPackages(response).slice(0, 20),
          response,
        };
      } catch (error) {
        lastError = error && error.message ? error.message : String(error);
        if (!isPayloadShapeError(error)) break;
      }
    }

    return {
      id: row.id,
      driverName: row.driverName,
      driverPhone: row.driverPhone,
      url,
      method: "POST",
      error: lastError,
    };
  }

  function shipmentDetailsBaseUrl(id) {
    return `https://drive.wb.ru/client-gateway/courier/api/v1/admin/shipments/${encodeURIComponent(id)}`;
  }

  function summarizeLoadingPointsDetails(response) {
    const loadingPoints = readLoadingPointsDetails(response);
    const packages = flattenLoadingPointsPackages(response);
    const unloadingPoints = flattenUnloadingPoints(response);
    const loadingAddresses = uniqueTexts(loadingPoints.map((point) => addressText(point.route_point)));
    const unloadingAddresses = uniqueTexts(unloadingPoints.map((point) => addressText(point.route_point)));
    const packageWayTypes = countBy(packages, "courier_package_way_type");
    const sellResults = countBy(packages, "sell_result");
    const actionStatuses = countBy(packages, "action_status");
    const deliveryTypes = countBy(packages, "delivery_type");
    const returnResults = countBy(packages, "return_result");

    const loadedDeliveryPackagesCount = packages.filter(isLoadedDeliveryPackage).length;
    const completedDeliveryPackagesCount = packages.filter(isCompletedDeliveryPackage).length;

    return {
      loadingPointsCount: loadingPoints.length,
      unloadingPointsCount: unloadingPoints.length,
      packagesCount: packages.length,
      loadedDeliveryPackagesCount,
      completedDeliveryPackagesCount,
      soldPackagesCount: packages.filter((item) => item.sell_result === "SELL_RESULT_SOLD").length,
      deliveryPackagesCount: completedDeliveryPackagesCount,
      returnPackagesCount: packages.filter(isPickedReturn).length,
      loadingAddresses,
      unloadingAddresses,
      packageWayTypes,
      sellResults,
      actionStatuses,
      deliveryTypes,
      returnResults,
      cargoIds: uniqueTexts(packages.map((item) => item.cargo_id)).slice(0, 50),
      shks: uniqueTexts(packages.map((item) => item.shk)).slice(0, 50),
      rids: uniqueTexts(packages.map((item) => item.rid)).slice(0, 50),
    };
  }

  function readLoadingPointsDetails(response) {
    const points = readArray(response, [
      "data.loading_points_list", "data.loadingPointsList", "loading_points_list",
      "loadingPointsList", "result.data.loading_points_list",
    ]);
    return points.filter((point) => point && typeof point === "object");
  }

  function flattenUnloadingPoints(response) {
    return readLoadingPointsDetails(response).flatMap((loadingPoint) => {
      const points = loadingPoint.unloading_points_list || loadingPoint.unloadingPointsList || [];
      return Array.isArray(points) ? points.filter((point) => point && typeof point === "object") : [];
    });
  }

  function flattenLoadingPointsPackages(response) {
    return readLoadingPointsDetails(response).flatMap((loadingPoint) => {
      const loadingAddress = addressText(loadingPoint.route_point);
      const unloadingPoints = loadingPoint.unloading_points_list || loadingPoint.unloadingPointsList || [];
      if (!Array.isArray(unloadingPoints)) return [];

      return unloadingPoints.flatMap((unloadingPoint) => {
        const unloadingAddress = addressText(unloadingPoint.route_point);
        const unloadingRoutePointId = value(unloadingPoint.route_point || {}, ["route_point_id", "routePointId"]);
        const packages = unloadingPoint.courier_packages || unloadingPoint.courierPackages || [];
        if (!Array.isArray(packages)) return [];

        return packages
          .filter((item) => item && typeof item === "object")
          .map((item) => ({
            ...item,
            loading_address: loadingAddress,
            unloading_address: unloadingAddress,
            unloading_route_point_id: unloadingRoutePointId,
          }));
      });
    });
  }

  function isPickedReturn(item) {
    return Boolean(
      item &&
      item.courier_package_way_type === "COURIER_PACKAGE_WAY_TYPE_RETURN" &&
      item.return_result === "RETURN_STATUS_PICKED"
    );
  }

  function hasNonZeroDate(valueText) {
    return Boolean(normalizeReportDate(valueText));
  }

  function isLoadedDeliveryPackage(item) {
    return Boolean(
      item &&
      item.courier_package_way_type === "COURIER_PACKAGE_WAY_TYPE_DELIVERY" &&
      hasNonZeroDate(item.loading_date)
    );
  }

  function isCompletedDeliveryPackage(item) {
    return Boolean(
      isLoadedDeliveryPackage(item) &&
      item.action_status === "ROUTE_POINT_ACTION_STATUS_DONE" &&
      hasNonZeroDate(item.unloading_date)
    );
  }

  function addressText(routePoint) {
    return value(routePoint || {}, [
      "address.name", "address.full_address", "address.fullAddress", "address.point_id",
    ]);
  }

  function countBy(rows, field) {
    return rows.reduce((result, row) => {
      const key = row && row[field] ? String(row[field]) : "";
      if (!key) return result;
      result[key] = (result[key] || 0) + 1;
      return result;
    }, {});
  }

  function uniqueTexts(values) {
    return Array.from(new Set(values.map((item) => String(item || "").trim()).filter(Boolean)));
  }

  function buildPayloadBuilders() {
    const builders = [];

    if (capturedBodyTemplate && !hasRejectedTopLevelDateFields(capturedBodyTemplate)) {
      builders.push({
        name: "captured-site-template",
        build: (params) => applyParamsToTemplate(capturedBodyTemplate, params),
      });
    }

    builders.push(
      {
        name: "data-meta-searching-date",
        build: ({ dateFrom, dateTo, lastId }) => ({
          data: {
            car_plate: null,
            courier: null,
            courier_phone: null,
            courier_task_id: null,
            delivery_types: [],
            loading_point_id: null,
            package_way_types: [],
            searching_date: {
              from: toApiDateStart(dateFrom),
              to: toApiDateStart(dateTo),
            },
            supplier: null,
          },
          meta: {
            last_id: lastId ?? null,
            limit: String(PAGE_LIMIT),
          },
        }),
      },
      {
        name: "filter-camel",
        build: ({ dateFrom, dateTo, lastId }) => withPagination({
          filter: { dateFrom: toApiDateStart(dateFrom), dateTo: toApiDateEnd(dateTo) },
          limit: PAGE_LIMIT,
        }, lastId, "lastId"),
      },
      {
        name: "filter-snake",
        build: ({ dateFrom, dateTo, lastId }) => withPagination({
          filter: { date_from: toApiDateStart(dateFrom), date_to: toApiDateEnd(dateTo) },
          limit: PAGE_LIMIT,
        }, lastId, "last_id"),
      },
      {
        name: "pagination-filter-camel",
        build: ({ dateFrom, dateTo, lastId }) => withNestedPagination({
          filter: { dateFrom: toApiDateStart(dateFrom), dateTo: toApiDateEnd(dateTo) },
          pagination: { limit: PAGE_LIMIT },
        }, lastId, "lastId"),
      },
      {
        name: "pagination-filter-snake",
        build: ({ dateFrom, dateTo, lastId }) => withNestedPagination({
          filter: { date_from: toApiDateStart(dateFrom), date_to: toApiDateEnd(dateTo) },
          pagination: { limit: PAGE_LIMIT },
        }, lastId, "last_id"),
      },
      {
        name: "period-camel",
        build: ({ dateFrom, dateTo, lastId }) => withPagination({
          period: { from: toApiDateStart(dateFrom), to: toApiDateEnd(dateTo) },
          limit: PAGE_LIMIT,
        }, lastId, "lastId"),
      },
      {
        name: "date-camel",
        build: ({ dateFrom, dateTo, lastId }) => withPagination({
          date: { from: toApiDateStart(dateFrom), to: toApiDateEnd(dateTo) },
          limit: PAGE_LIMIT,
        }, lastId, "lastId"),
      }
    );

    return builders;
  }

  function hasRejectedTopLevelDateFields(payload) {
    return Boolean(payload && typeof payload === "object" && (
      Object.prototype.hasOwnProperty.call(payload, "date_from") ||
      Object.prototype.hasOwnProperty.call(payload, "dateFrom") ||
      Object.prototype.hasOwnProperty.call(payload, "date_to") ||
      Object.prototype.hasOwnProperty.call(payload, "dateTo")
    ));
  }

  function rememberPayloadAttempt(name, payload) {
    state.debug.attempts.push({
      name,
      payload: cloneJson(payload),
    });
    if (state.debug.attempts.length > 10) state.debug.attempts.shift();
  }

  function withPagination(payload, lastId, fieldName) {
    const nextPayload = cloneJson(payload);
    if (lastId !== null && lastId !== undefined && lastId !== "") nextPayload[fieldName] = lastId;
    return nextPayload;
  }

  function withNestedPagination(payload, lastId, fieldName) {
    const nextPayload = cloneJson(payload);
    if (lastId !== null && lastId !== undefined && lastId !== "") nextPayload.pagination[fieldName] = lastId;
    return nextPayload;
  }

  function applyParamsToTemplate(template, { dateFrom, dateTo, lastId }) {
    const payload = cloneJson(template);
    const start = toApiDateStart(dateFrom);
    const end = toApiDateEnd(dateTo);

    replaceDateLikeFields(payload, start, end);
    replaceLimitLikeFields(payload);
    replaceLastIdLikeFields(payload, lastId);
    return payload;
  }

  function replaceDateLikeFields(target, start, end) {
    walkObject(target, (object, key) => {
      const lowerKey = key.toLowerCase();
      if (["datefrom", "date_from", "from", "start", "startdate", "start_date"].includes(lowerKey)) {
        object[key] = start;
      }
      if (["dateto", "date_to", "to", "end", "enddate", "end_date"].includes(lowerKey)) {
        object[key] = end;
      }
    });
  }

  function replaceLimitLikeFields(target) {
    walkObject(target, (object, key) => {
      const lowerKey = key.toLowerCase();
      if (["limit", "pagesize", "page_size", "perpage", "per_page"].includes(lowerKey)) {
        object[key] = PAGE_LIMIT;
      }
    });
  }

  function replaceLastIdLikeFields(target, lastId) {
    walkObject(target, (object, key) => {
      const lowerKey = key.toLowerCase();
      if (["lastid", "last_id"].includes(lowerKey)) {
        if (lastId !== null && lastId !== undefined && lastId !== "") object[key] = lastId;
        else delete object[key];
      }
    });
  }

  function postJson(url, payload) {
    return requestJson("POST", url, payload);
  }

  function requestJson(method, url, payload) {
    return new Promise((resolve, reject) => {
      const request = {
        method,
        url,
        withCredentials: true,
        anonymous: false,
        headers: buildRequestHeaders(),
        timeout: 60000,
        onload(response) {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(buildHttpErrorMessage(response)));
            return;
          }
          try {
            resolve(response.responseText ? JSON.parse(response.responseText) : {});
          } catch (error) {
            reject(new Error(`Не удалось разобрать JSON: ${error.message}`));
          }
        },
        onerror() {
          reject(new Error("Сетевая ошибка при запросе к drive.wb.ru."));
        },
        ontimeout() {
          reject(new Error("Запрос к drive.wb.ru превысил таймаут."));
        },
      };
      if (payload !== undefined) request.data = JSON.stringify(payload);
      GM_xmlhttpRequest(request);
    });
  }

  function buildRequestHeaders() {
    const headers = {
      "Accept": "application/json, text/plain, */*",
      "Content-Type": "application/json;charset=UTF-8",
      ...capturedAuthHeaders,
    };
    const token = findAuthToken();

    if (token && !hasHeader(headers, "authorization")) {
      headers.Authorization = /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`;
    }
    if (token && !hasHeader(headers, "x-user-token")) {
      headers["x-user-token"] = token.replace(/^Bearer\s+/i, "");
    }
    if (token && !hasHeader(headers, "x-auth-token")) {
      headers["x-auth-token"] = token.replace(/^Bearer\s+/i, "");
    }

    return headers;
  }

  function buildHttpErrorMessage(response) {
    const body = response.responseText || response.statusText || "";
    if (response.status === 401 && /token is empty/i.test(body)) {
      return [
        `HTTP ${response.status}: ${body}`,
        "Токен авторизации не найден.",
        "Обновите страницу logistics.wildberries.ru после входа в аккаунт и попробуйте сформировать отчет еще раз.",
      ].join(" ");
    }
    return `HTTP ${response.status}: ${body}`;
  }

  function isPayloadShapeError(error) {
    const message = error && error.message ? error.message : "";
    return /HTTP 400/i.test(message) && /(InvalidArgument|unknown field|invalid json|proto:)/i.test(message);
  }

  function hasHeader(headers, name) {
    const lowerName = name.toLowerCase();
    return Object.keys(headers).some((headerName) => headerName.toLowerCase() === lowerName);
  }

  function installAuthCapture() {
    const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

    try {
      patchFetch(pageWindow);
      patchXhr(pageWindow);
    } catch (error) {
      console.warn("[WB Report] Не удалось включить перехват авторизации", error);
    }
  }

  function patchFetch(pageWindow) {
    const originalFetch = pageWindow.fetch;
    if (!originalFetch || originalFetch.__wbReportPatched) return;

    const patchedFetch = function (input, init) {
      rememberHeaders(input && input.headers);
      rememberHeaders(init && init.headers);
      rememberRequestBody(readRequestUrl(input), init && init.body);
      if (!init || init.body === undefined) rememberRequestBodyFromRequest(input);
      return originalFetch.apply(this, arguments);
    };
    patchedFetch.__wbReportPatched = true;
    pageWindow.fetch = patchedFetch;
  }

  function patchXhr(pageWindow) {
    const proto = pageWindow.XMLHttpRequest && pageWindow.XMLHttpRequest.prototype;
    if (!proto || proto.__wbReportPatched) return;

    const originalOpen = proto.open;
    const originalSetRequestHeader = proto.setRequestHeader;
    const originalSend = proto.send;

    proto.open = function (method, url) {
      this.__wbReportUrl = url;
      return originalOpen.apply(this, arguments);
    };
    proto.setRequestHeader = function (name, value) {
      rememberHeader(name, value);
      return originalSetRequestHeader.apply(this, arguments);
    };
    proto.send = function (body) {
      rememberRequestBody(this.__wbReportUrl, body);
      return originalSend.apply(this, arguments);
    };
    proto.__wbReportPatched = true;
  }

  function readRequestUrl(input) {
    if (!input) return "";
    if (typeof input === "string") return input;
    if (input.url) return input.url;
    return "";
  }

  function rememberRequestBodyFromRequest(input) {
    if (!input || typeof input.clone !== "function" || !input.url) return;
    try {
      input.clone().text().then((body) => rememberRequestBody(input.url, body)).catch(() => {});
    } catch (error) {
      console.warn("[WB Report] Не удалось прочитать тело fetch-запроса", error);
    }
  }

  function rememberRequestBody(url, body) {
    if (!url || !String(url).includes("/shipments/finished/list") || !body) return;

    if (typeof body === "string") {
      rememberRequestBodyText(body);
      return;
    }
    if (body instanceof URLSearchParams) {
      rememberRequestBodyText(body.toString());
      return;
    }
    if (typeof body === "object" && !(body instanceof FormData) && !(body instanceof Blob)) {
      capturedBodyTemplate = cloneJson(body);
      console.info("[WB Report] Найден шаблон payload от сайта", capturedBodyTemplate);
    }
  }

  function rememberRequestBodyText(bodyText) {
    if (!bodyText || typeof bodyText !== "string") return;
    try {
      capturedBodyTemplate = JSON.parse(bodyText);
      console.info("[WB Report] Найден шаблон payload от сайта", capturedBodyTemplate);
    } catch (error) {
      console.warn("[WB Report] Тело запроса найдено, но это не JSON", bodyText);
    }
  }

  function rememberHeaders(headers) {
    if (!headers) return;

    if (headers instanceof Headers) {
      headers.forEach((valueText, name) => rememberHeader(name, valueText));
      return;
    }
    if (Array.isArray(headers)) {
      headers.forEach((entry) => rememberHeader(entry[0], entry[1]));
      return;
    }
    if (typeof headers === "object") {
      Object.keys(headers).forEach((name) => rememberHeader(name, headers[name]));
    }
  }

  function rememberHeader(name, valueText) {
    if (!name || !valueText) return;

    const lowerName = String(name).toLowerCase();
    if (
      lowerName === "authorization" ||
      lowerName.includes("token") ||
      lowerName.includes("auth")
    ) {
      capturedAuthHeaders[name] = String(valueText);
    }
  }

  function findAuthToken() {
    const directToken = findTokenInStorage(localStorage) || findTokenInStorage(sessionStorage);
    if (directToken) return directToken;

    const capturedAuthorization = getCapturedHeader("authorization");
    if (capturedAuthorization) return capturedAuthorization;

    const capturedToken = getCapturedHeader("x-user-token") || getCapturedHeader("x-auth-token");
    return capturedToken || "";
  }

  function getCapturedHeader(name) {
    const lowerName = name.toLowerCase();
    const headerName = Object.keys(capturedAuthHeaders).find((key) => key.toLowerCase() === lowerName);
    return headerName ? capturedAuthHeaders[headerName] : "";
  }

  function findTokenInStorage(storage) {
    if (!storage) return "";

    const preferredNames = [
      "token", "accessToken", "access_token", "authToken", "auth_token",
      "jwt", "idToken", "id_token",
    ];

    for (const name of preferredNames) {
      const found = extractToken(storage.getItem(name));
      if (found) return found;
    }

    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key || !/(token|auth|jwt|session)/i.test(key)) continue;

      const found = extractToken(storage.getItem(key));
      if (found) return found;
    }

    return "";
  }

  function extractToken(rawValue) {
    if (!rawValue || typeof rawValue !== "string") return "";

    const trimmed = rawValue.trim();
    if (/^Bearer\s+[\w-]+\.[\w-]+\.[\w-]+/i.test(trimmed)) return trimmed;
    if (/^[\w-]+\.[\w-]+\.[\w-]+$/.test(trimmed)) return trimmed;

    try {
      const parsed = JSON.parse(trimmed);
      return findTokenInObject(parsed);
    } catch (error) {
      const jwtMatch = trimmed.match(/[\w-]+\.[\w-]+\.[\w-]+/);
      return jwtMatch ? jwtMatch[0] : "";
    }
  }

  function findTokenInObject(valueText) {
    if (!valueText || typeof valueText !== "object") return "";

    const keys = [
      "token", "accessToken", "access_token", "authToken", "auth_token",
      "jwt", "idToken", "id_token",
    ];
    for (const key of keys) {
      const found = extractToken(valueText[key]);
      if (found) return found;
    }
    for (const key of Object.keys(valueText)) {
      if (!/(token|auth|jwt|session)/i.test(key)) continue;
      const found = extractToken(valueText[key]);
      if (found) return found;
    }
    return "";
  }

  function normalizeShipment(item) {
    const id = value(item, [
      "id", "courier_task_id", "courierTaskId", "shipment_id", "shipmentId",
      "route_id", "routeId", "rid", "last_id",
    ]);
    const driverName = value(item, [
      "driver.name", "driver.full_name", "driver.fullName", "driverName", "driver_name",
      "courier.name", "courier.full_name", "courierFullName", "courier_name", "employee.name",
    ]) || "Без водителя";
    const driverPhone = value(item, [
      "driver.phone", "driver.phone_number", "driverPhone", "driver_phone",
      "courier.phone", "courierPhone", "phone",
    ]) || "";
    const startedAt = value(item, [
      "started_at", "startedAt", "task_dates.start_date", "taskDates.startDate",
      "task_dates.loading_start_date", "taskDates.loadingStartDate", "created_at",
      "createdAt", "date_from", "dateFrom", "shipment_date", "shipmentDate",
      "finished_at", "finishedAt", "task_dates.finish_date", "taskDates.finishDate",
    ]) || "";
    const finishedAt = value(item, [
      "finished_at", "finishedAt", "task_dates.finish_date", "taskDates.finishDate",
      "closed_at", "closedAt", "ended_at", "endedAt",
    ]) || "";
    const deliveries = numberValue(item, [
      "deliveries", "deliveries_count", "deliveriesCount", "delivery_count",
      "deliveryCount", "delivered", "orders_delivered", "ordersDelivered",
      "stats.deliveries", "stat.deliveries",
    ]);
    const returns = numberValue(item, [
      "returns", "returns_count", "returnsCount", "return_count", "returnCount",
      "returned", "orders_returned", "ordersReturned", "stats.returns", "stat.returns",
    ]);
    const amount = numberValue(item, [
      "sum", "amount", "total", "total_sum", "totalSum", "price.value",
      "priceValue", "cost", "income", "reward", "payment", "driver_reward",
      "driverReward",
    ]);
    const warehouse = firstLoadingPointName(item) || value(item, [
      "warehouse.name", "warehouseName", "warehouse_name", "office.name", "officeName",
      "src_office.name", "srcOfficeName",
    ]) || "";
    const status = value(item, ["status", "state", "shipment_status", "shipmentStatus"]) || "";

    return {
      id: id ?? "",
      driverName,
      driverPhone,
      startedAt: normalizeReportDate(startedAt),
      finishedAt: normalizeReportDate(finishedAt),
      warehouse,
      status,
      deliveries,
      returns,
      amount,
      raw: item,
    };
  }

  function firstLoadingPointName(item) {
    const loadingPoints = item && Array.isArray(item.loading_points)
      ? item.loading_points
      : item && Array.isArray(item.loadingPoints)
        ? item.loadingPoints
        : [];
    const point = loadingPoints[0];
    if (!point || typeof point !== "object") return "";
    return value(point, [
      "address.name", "address.full_address", "address.fullAddress", "name",
    ]);
  }

  function normalizeReportDate(valueText) {
    if (!valueText || /^0001-01-01T00:00:00Z$/i.test(String(valueText))) return "";
    return valueText;
  }

  function buildSummary(rows) {
    const trips = rows.length;
    const amount = sum(rows, "amount");
    const deliveries = sum(rows, "deliveries");
    const returns = sum(rows, "returns");
    const averageTrip = trips ? amount / trips : 0;

    return { trips, amount, deliveries, returns, averageTrip };
  }

  function groupByDriver(rows) {
    const map = new Map();

    for (const row of rows) {
      const key = [row.driverName, row.driverPhone].join("|");
      const current = map.get(key) || {
        driverName: row.driverName,
        driverPhone: row.driverPhone,
        trips: 0,
        amount: 0,
        deliveries: 0,
        returns: 0,
        averageTrip: 0,
        tripRows: [],
      };
      current.trips += 1;
      current.amount += row.amount;
      current.deliveries += row.deliveries;
      current.returns += row.returns;
      current.averageTrip = current.trips ? current.amount / current.trips : 0;
      current.tripRows.push(row);
      map.set(key, current);
    }

    return Array.from(map.values()).sort((a, b) => b.amount - a.amount || b.trips - a.trips);
  }

  function driverKey(row) {
    return [row.driverName || "", row.driverPhone || ""].join("|");
  }

  function getFilteredRows() {
    if (!state.selectedDrivers.size) return [];
    return state.rows.filter((row) => state.selectedDrivers.has(driverKey(row)));
  }

  function getFilteredDetails() {
    const filteredIds = new Set(getFilteredRows().map((row) => String(row.id)));
    return state.detailsDebug.filter((detail) => filteredIds.has(String(detail.id)));
  }

  function getDriverFilterOptions() {
    return groupByDriver(state.rows).map((row) => ({
      key: driverKey(row),
      name: row.driverName,
      phone: row.driverPhone,
      trips: row.trips,
      selected: state.selectedDrivers.has(driverKey(row)),
    }));
  }

  function refreshDerivedReportState() {
    const rows = getFilteredRows();
    state.grouped = groupByDriver(rows);
    state.summary = buildSummary(rows);
  }

  function toggleDriverFilter(key, selected) {
    if (selected) state.selectedDrivers.add(key);
    else state.selectedDrivers.delete(key);
    refreshDerivedReportState();
    renderReport();
  }

  function setAllDriversSelected(selected) {
    state.selectedDrivers = selected
      ? new Set(state.rows.map(driverKey))
      : new Set();
    refreshDerivedReportState();
    renderReport();
  }

  function buildDetailsSummary(details) {
    return details.reduce((result, detail) => {
      const summary = detail.summary || {};
      result.tasks += 1;
      result.loadingPoints += Number(summary.loadingPointsCount) || 0;
      result.unloadingPoints += Number(summary.unloadingPointsCount) || 0;
      result.packages += Number(summary.packagesCount) || 0;
      result.soldPackages += Number(summary.soldPackagesCount) || 0;
      result.deliveryPackages += Number(summary.deliveryPackagesCount) || 0;
      result.returnPackages += Number(summary.returnPackagesCount) || 0;
      return result;
    }, {
      tasks: 0,
      loadingPoints: 0,
      unloadingPoints: 0,
      packages: 0,
      soldPackages: 0,
      deliveryPackages: 0,
      returnPackages: 0,
    });
  }

  function buildDetailsById() {
    return new Map(state.detailsDebug.map((detail) => [String(detail.id), detail]));
  }

  function buildDriverDetailSummary(rows, detailsById) {
    return rows.reduce((result, row) => {
      const detail = detailsById.get(String(row.id));
      const summary = detail && detail.summary ? detail.summary : {};
      result.loadedPackages += detail ? Number(summary.loadedDeliveryPackagesCount) || 0 : 0;
      result.deliveryPackages += detail ? Number(summary.completedDeliveryPackagesCount ?? summary.deliveryPackagesCount) || 0 : row.deliveries || 0;
      result.returnPackages += detail ? Number(summary.returnPackagesCount) || 0 : row.returns || 0;
      return result;
    }, {
      loadedPackages: 0,
      deliveryPackages: 0,
      returnPackages: 0,
    });
  }

  function buildTripTiming(row, detail) {
    const packages = detail && detail.response ? flattenLoadingPointsPackages(detail.response) : [];
    return {
      loadingAt: earliestDate(packages, "loading_date") || row.startedAt,
      lastUnloadingAt: latestDate(packages, "unloading_date") || row.finishedAt,
    };
  }

  function buildTripMetrics(row, detail) {
    const summary = detail && detail.summary ? detail.summary : {};
    const packagesCount = Number(summary.loadedDeliveryPackagesCount ?? summary.packagesCount) || 0;
    const soldPackagesCount = Number(summary.soldPackagesCount) || 0;
    const deliveries = detail ? Number(summary.completedDeliveryPackagesCount ?? summary.deliveryPackagesCount) || 0 : row.deliveries;
    const returns = detail ? Number(summary.returnPackagesCount) || 0 : row.returns;
    const conversion = packagesCount ? deliveries / packagesCount : null;

    return {
      packagesCount,
      soldPackagesCount,
      deliveries,
      returns,
      conversion,
    };
  }

  function earliestDate(rows, field) {
    return pickExtremeDate(rows, field, (current, next) => next < current);
  }

  function latestDate(rows, field) {
    return pickExtremeDate(rows, field, (current, next) => next > current);
  }

  function pickExtremeDate(rows, field, shouldReplace) {
    let result = "";
    let resultTime = 0;

    for (const row of rows) {
      const raw = row && row[field];
      if (!raw || /^0001-01-01T00:00:00Z$/i.test(String(raw))) continue;

      const time = new Date(raw).getTime();
      if (!Number.isFinite(time)) continue;

      if (!result || shouldReplace(resultTime, time)) {
        result = raw;
        resultTime = time;
      }
    }

    return result;
  }

  function renderReport() {
    const content = document.getElementById("wb-report-content");
    refreshDerivedReportState();
    const filteredRows = getFilteredRows();
    const filteredDetails = getFilteredDetails();
    const summary = state.summary || buildSummary([]);
    const detailsById = buildDetailsById();

    if (!state.rows.length) {
      renderEmpty("За выбранный период рейсы не найдены.");
      setExportEnabled(false);
      setDetailsDebugEnabled(false);
      return;
    }

    content.innerHTML = `
      <div class="wb-report-summary">
        ${renderStat("Рейсы", formatNumber(summary.trips))}
        ${renderStat("Сумма", formatMoney(summary.amount))}
        ${renderStat("Доставки", formatNumber(summary.deliveries))}
        ${renderStat("Возвраты", formatNumber(summary.returns))}
        ${renderStat("Средний рейс", formatMoney(summary.averageTrip))}
      </div>
      ${renderAnalyticsPanel(filteredRows, detailsById)}
      ${renderDriverFilter()}
      ${!filteredRows.length ? `<div class="wb-report-empty">Выберите хотя бы одного водителя.</div>` : `
      <h3 class="wb-report-section-title">По водителям</h3>
      ${renderDriversTable(state.grouped, detailsById)}
      ${filteredDetails.length ? renderDetailsSummary(filteredDetails) : ""}
      <h3 class="wb-report-section-title">Рейсы</h3>
      ${renderTripsTable(filteredRows, detailsById)}
      `}
    `;
    setExportEnabled(filteredRows.length > 0);
    setDetailsDebugEnabled(filteredRows.length > 0);
  }

  function renderStat(label, valueText) {
    return `
      <div class="wb-report-stat">
        <div class="wb-report-stat-label">${escapeHtml(label)}</div>
        <div class="wb-report-stat-value">${escapeHtml(valueText)}</div>
      </div>
    `;
  }

  function renderAnalyticsPanel(rows, detailsById) {
    const series = buildAnalyticsSeries(rows, detailsById);
    return `
      <div class="wb-report-analytics">
        ${renderChartCard("Рейсы", formatNumber(series.trips.total), series.trips.points, "#7c3aed", formatNumber)}
        ${renderChartCard("Сумма", formatMoney(series.amount.total), series.amount.points, "#0f766e", formatMoney)}
        ${renderChartCard("Доставки", formatNumber(series.deliveries.total), series.deliveries.points, "#2563eb", formatNumber)}
        ${renderChartCard("Средний рейс", formatMoney(series.averageTrip.total), series.averageTrip.points, "#ea580c", formatMoney)}
      </div>
    `;
  }

  function renderChartCard(label, totalText, points, color, formatter) {
    return `
      <div class="wb-report-chart-card">
        <div class="wb-report-chart-head">
          <div class="wb-report-chart-label">${escapeHtml(label)}</div>
          <div class="wb-report-chart-value">${escapeHtml(totalText)}</div>
        </div>
        ${buildChartSvg(points.map((point) => point.value), color)}
        <div class="wb-report-chart-footer">${escapeHtml(buildChartFooter(points, formatter))}</div>
      </div>
    `;
  }

  function buildChartFooter(points, formatter) {
    if (!points.length) return "Нет данных";
    return points.map((point) => `${point.label}: ${formatter(point.value)}`).join(" | ");
  }

  function buildChartSvg(values, color) {
    if (!values.length) {
      return `<svg class="wb-report-chart-svg" viewBox="0 0 320 88" preserveAspectRatio="none" aria-hidden="true"></svg>`;
    }

    const width = 320;
    const height = 88;
    const maxValue = Math.max(...values, 1);
    const step = values.length > 1 ? width / (values.length - 1) : 0;
    const points = values.map((value, index) => {
      const x = values.length === 1 ? width / 2 : index * step;
      const y = height - (value / maxValue) * (height - 12) - 6;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    const area = [`0,${height}`, ...points, `${width},${height}`].join(" ");

    return `
      <svg class="wb-report-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
        <polyline points="${area}" fill="${color}" fill-opacity="0.12" stroke="none"></polyline>
        <polyline points="${points.join(" ")}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>
      </svg>
    `;
  }

  function buildAnalyticsSeries(rows, detailsById) {
    const daily = new Map();

    for (const row of rows) {
      const detail = detailsById.get(String(row.id));
      const metrics = buildTripMetrics(row, detail);
      const key = tripDateKey(row, detail);
      const current = daily.get(key) || {
        label: formatDayMonth(key),
        trips: 0,
        amount: 0,
        deliveries: 0,
      };
      current.trips += 1;
      current.amount += Number(row.amount) || 0;
      current.deliveries += metrics.deliveries;
      daily.set(key, current);
    }

    const ordered = Array.from(daily.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, item]) => item);

    return {
      trips: {
        total: ordered.reduce((sumValue, item) => sumValue + item.trips, 0),
        points: ordered.map((item) => ({ label: item.label, value: item.trips })),
      },
      amount: {
        total: ordered.reduce((sumValue, item) => sumValue + item.amount, 0),
        points: ordered.map((item) => ({ label: item.label, value: item.amount })),
      },
      deliveries: {
        total: ordered.reduce((sumValue, item) => sumValue + item.deliveries, 0),
        points: ordered.map((item) => ({ label: item.label, value: item.deliveries })),
      },
      averageTrip: {
        total: rows.length ? rows.reduce((sumValue, row) => sumValue + (Number(row.amount) || 0), 0) / rows.length : 0,
        points: ordered.map((item) => ({ label: item.label, value: item.trips ? item.amount / item.trips : 0 })),
      },
    };
  }

  function tripDateKey(row, detail) {
    const timing = buildTripTiming(row, detail);
    const source = timing.lastUnloadingAt || row.finishedAt || timing.loadingAt || row.startedAt;
    return toDateKey(source);
  }

  function toDateKey(valueText) {
    if (!valueText) return "0000-00-00";
    const date = new Date(valueText);
    if (Number.isNaN(date.getTime())) return "0000-00-00";
    return date.toISOString().slice(0, 10);
  }

  function formatDayMonth(dateKey) {
    if (!dateKey || dateKey === "0000-00-00") return "Без даты";
    const date = new Date(`${dateKey}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return dateKey;
    return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
  }

  function renderDriverFilter() {
    const options = getDriverFilterOptions();
    const selectedCount = options.filter((option) => option.selected).length;

    return `
      <details class="wb-report-filter"${state.driverFilterOpen ? " open" : ""}>
        <summary>Водители: ${formatNumber(selectedCount)} из ${formatNumber(options.length)}</summary>
        <div class="wb-report-filter-menu">
          <div class="wb-report-filter-actions">
            <button class="wb-report-btn" type="button" data-action="select-all-drivers">Все</button>
            <button class="wb-report-btn" type="button" data-action="clear-drivers">Сбросить</button>
          </div>
          <div class="wb-report-filter-grid">
            ${options.map((option) => `
              <label class="wb-report-filter-option" title="${escapeHtml(option.name)}">
                <input type="checkbox" data-driver-key="${escapeHtml(option.key)}"${option.selected ? " checked" : ""}>
                <span class="wb-report-filter-name">${escapeHtml(option.name)}</span>
                <span class="wb-report-filter-count">${formatNumber(option.trips)}</span>
              </label>
            `).join("")}
          </div>
        </div>
      </details>
    `;
  }

  function renderDriversTable(rows, detailsById) {
    return `
      <div class="wb-report-driver-list">
        ${rows.map((row, index) => renderDriverSection(row, detailsById, index === 0)).join("")}
      </div>
    `;
  }

  function renderDriverSection(row, detailsById, isOpen) {
    const detailSummary = buildDriverDetailSummary(row.tripRows || [], detailsById);
    const driverConversion = detailSummary.loadedPackages
      ? detailSummary.deliveryPackages / detailSummary.loadedPackages
      : null;

    return `
      <details class="wb-report-driver"${isOpen ? " open" : ""}>
        <summary>
          <div class="wb-report-driver-main">
            ${escapeHtml(row.driverName)}
            <div class="wb-report-driver-phone">${escapeHtml(row.driverPhone)}</div>
          </div>
          <div class="wb-report-driver-metric"><span>Рейсы</span>${formatNumber(row.trips)}</div>
          <div class="wb-report-driver-metric"><span>Сумма</span>${formatMoney(row.amount)}</div>
          <div class="wb-report-driver-metric"><span>Доставки</span>${formatNumber(detailSummary.deliveryPackages || row.deliveries)}</div>
          <div class="wb-report-driver-metric"><span>Конверсия</span>${formatPercent(driverConversion)}</div>
          <div class="wb-report-driver-metric"><span>Возвраты</span>${formatNumber(detailSummary.returnPackages || row.returns)}</div>
          <div class="wb-report-driver-metric"><span>Средний рейс</span>${formatMoney(row.averageTrip)}</div>
        </summary>
        <div class="wb-report-driver-body">
          ${renderDriverTripsTable(row.tripRows || [], detailsById)}
        </div>
      </details>
    `;
  }

  function renderDriverTripsTable(rows, detailsById) {
    return `
      <div class="wb-report-table-wrap">
        <table class="wb-report-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Загрузка</th>
              <th>Последняя выгрузка</th>
              <th>Склад</th>
              <th class="wb-report-num">Сумма</th>
              <th class="wb-report-num">Доставки</th>
              <th class="wb-report-num">Возвраты</th>
              <th class="wb-report-num">Конверсия</th>
              <th>Статусы доставок</th>
              <th>Статусы продаж</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => renderDriverTripRow(row, detailsById.get(String(row.id)))).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderDriverTripRow(row, detail) {
    const summary = detail && detail.summary ? detail.summary : {};
    const timing = buildTripTiming(row, detail);
    const metrics = buildTripMetrics(row, detail);

    return `
      <tr>
        <td>${escapeHtml(row.id)}</td>
        <td>${escapeHtml(formatDateTime(timing.loadingAt))}</td>
        <td>${escapeHtml(formatDateTime(timing.lastUnloadingAt))}</td>
        <td>${escapeHtml(joinCsvList(summary.loadingAddresses) || row.warehouse)}</td>
        <td class="wb-report-num">${formatMoney(row.amount)}</td>
        <td class="wb-report-num">${formatNumber(metrics.deliveries)}</td>
        <td class="wb-report-num">${formatNumber(metrics.returns)}</td>
        <td class="wb-report-num wb-report-trip-conversion">${escapeHtml(formatPercent(metrics.conversion))}</td>
        <td class="wb-report-trip-status">${escapeHtml(formatCountMap(summary.actionStatuses))}</td>
        <td class="wb-report-trip-status">${escapeHtml(formatCountMap(summary.sellResults))}</td>
      </tr>
    `;
  }

  function renderDetailsSummary(details) {
    const summary = buildDetailsSummary(details);

    return `
      <div class="wb-report-summary">
        ${renderStat("Задания", formatNumber(summary.tasks))}
        ${renderStat("Выгрузки", formatNumber(summary.unloadingPoints))}
        ${renderStat("Пакеты", formatNumber(summary.packages))}
        ${renderStat("Продано", formatNumber(summary.soldPackages))}
        ${renderStat("Возвраты", formatNumber(summary.returnPackages))}
      </div>
    `;
  }

  function renderTripsTable(rows, detailsById) {
    return `
      <div class="wb-report-table-wrap">
        <table class="wb-report-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Водитель</th>
              <th>Телефон</th>
              <th>Старт</th>
              <th>Финиш</th>
              <th>Склад</th>
              <th>Статус</th>
              <th class="wb-report-num">Сумма</th>
              <th class="wb-report-num">Доставки</th>
              <th class="wb-report-num">Возвраты</th>
              <th class="wb-report-num">Конверсия</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => {
              const detail = detailsById.get(String(row.id));
              const metrics = buildTripMetrics(row, detail);
              return `
                <tr>
                  <td>${escapeHtml(row.id)}</td>
                  <td>${escapeHtml(row.driverName)}</td>
                  <td>${escapeHtml(row.driverPhone)}</td>
                  <td>${escapeHtml(formatDateTime(row.startedAt))}</td>
                  <td>${escapeHtml(formatDateTime(row.finishedAt))}</td>
                  <td>${escapeHtml(row.warehouse)}</td>
                  <td>${escapeHtml(row.status)}</td>
                  <td class="wb-report-num">${formatMoney(row.amount)}</td>
                  <td class="wb-report-num">${formatNumber(metrics.deliveries)}</td>
                  <td class="wb-report-num">${formatNumber(metrics.returns)}</td>
                  <td class="wb-report-num wb-report-trip-conversion">${escapeHtml(formatPercent(metrics.conversion))}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderEmpty(message) {
    const content = document.getElementById("wb-report-content");
    if (!content) return;
    content.innerHTML = `<div class="wb-report-empty">${escapeHtml(message)}</div>`;
  }

  function exportCsv() {
    const rows = getFilteredRows();
    const grouped = groupByDriver(rows);
    const details = getFilteredDetails();
    const detailsById = buildDetailsById();
    if (!rows.length) return;

    const summary = buildSummary(rows);
    const lines = [];

    lines.push(["Сводка"]);
    lines.push(["Рейсы", "Сумма", "Доставки", "Возвраты", "Средний рейс"]);
    lines.push([
      summary.trips,
      decimal(summary.amount),
      summary.deliveries,
      summary.returns,
      decimal(summary.averageTrip),
    ]);
    lines.push([]);
    lines.push(["По водителям"]);
    lines.push(["Водитель", "Телефон", "Рейсы", "Сумма", "Доставки", "Возвраты", "Средний рейс"]);
    for (const row of grouped) {
      lines.push([
        row.driverName,
        row.driverPhone,
        row.trips,
        decimal(row.amount),
        row.deliveries,
        row.returns,
        decimal(row.averageTrip),
      ]);
    }
    lines.push([]);
    lines.push(["Рейсы"]);
    lines.push(["ID", "Водитель", "Телефон", "Старт", "Финиш", "Склад", "Статус", "Сумма", "Доставки", "Возвраты", "Конверсия"]);
    for (const row of rows) {
      const metrics = buildTripMetrics(row, detailsById.get(String(row.id)));
      lines.push([
        row.id,
        row.driverName,
        row.driverPhone,
        formatDateTime(row.startedAt),
        formatDateTime(row.finishedAt),
        row.warehouse,
        row.status,
        decimal(row.amount),
        metrics.deliveries,
        metrics.returns,
        percentDecimal(metrics.conversion),
      ]);
    }

    appendDetailsCsv(lines, details);

    const csv = "\uFEFF" + lines.map(toCsvLine).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const dateFrom = document.getElementById("wb-report-date-from").value;
    const dateTo = document.getElementById("wb-report-date-to").value;

    link.href = url;
    link.download = `wb-report-${dateFrom}-${dateTo}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function appendDetailsCsv(lines, details) {
    if (!details.length) return;

    lines.push([]);
    lines.push(["Детали заданий"]);
    lines.push([
      "ID", "Водитель", "Телефон", "Точек загрузки", "Точек выгрузки",
      "Пакетов", "Продано", "Доставки", "Возвраты", "Адреса загрузки", "Адреса выгрузки",
    ]);
    for (const detail of details) {
      const summary = detail.summary || {};
      lines.push([
        detail.id,
        detail.driverName,
        detail.driverPhone,
        summary.loadingPointsCount,
        summary.unloadingPointsCount,
        summary.packagesCount,
        summary.soldPackagesCount,
        summary.deliveryPackagesCount,
        summary.returnPackagesCount,
        joinCsvList(summary.loadingAddresses),
        joinCsvList(summary.unloadingAddresses),
      ]);
    }

    lines.push([]);
    lines.push(["Пакеты заданий"]);
    lines.push([
      "ID", "Водитель", "Телефон", "package_id", "sticker", "rid", "shk", "external_id",
      "cargo_id", "way_type", "sell_result", "action_status", "delivery_type",
      "loading_date", "unloading_date", "Адрес загрузки", "Адрес выгрузки", "photo",
    ]);
    for (const detail of details) {
      const packages = detail.response ? flattenLoadingPointsPackages(detail.response) : [];
      for (const item of packages) {
        lines.push([
          detail.id,
          detail.driverName,
          detail.driverPhone,
          item.package_id,
          item.sticker,
          item.rid,
          item.shk,
          item.external_id,
          item.cargo_id,
          item.courier_package_way_type,
          item.sell_result,
          item.action_status,
          item.delivery_type,
          formatDateTime(item.loading_date),
          formatDateTime(item.unloading_date),
          item.loading_address,
          item.unloading_address,
          item.big_photo_url,
        ]);
      }
    }
  }

  async function copyDebugInfo() {
    const debugInfo = {
      version: SCRIPT_VERSION,
      url: location.href,
      hasCapturedTemplate: Boolean(capturedBodyTemplate),
      capturedTemplate: capturedBodyTemplate,
      capturedAuthHeaderNames: Object.keys(capturedAuthHeaders),
      lastError: state.debug.lastError,
      attempts: state.debug.attempts,
      rowCount: state.rows.length,
      filteredRowCount: getFilteredRows().length,
      selectedDrivers: getDriverFilterOptions()
        .filter((option) => option.selected)
        .map((option) => ({ name: option.name, phone: option.phone, trips: option.trips })),
      normalizedRowsSample: state.rows.slice(0, 3).map(({ raw, ...row }) => row),
      rawRowsSample: state.rows.slice(0, 3).map((row) => row.raw),
      detailsDebugLimit: DETAILS_DEBUG_LIMIT,
      detailsDebugCount: state.detailsDebug.length,
      detailsDebug: state.detailsDebug,
    };
    const text = JSON.stringify(debugInfo, null, 2);

    try {
      await navigator.clipboard.writeText(text);
      setStatus("Отладка скопирована.");
    } catch (error) {
      console.info("[WB Report] Debug info", debugInfo);
      setStatus("Не удалось скопировать, отладка выведена в консоль.");
    }
  }

  function toCsvLine(values) {
    return values.map((value) => {
      const text = value === null || value === undefined ? "" : String(value);
      return `"${text.replace(/"/g, '""')}"`;
    }).join(";");
  }

  function joinCsvList(values) {
    return Array.isArray(values) ? values.join(" | ") : "";
  }

  function formatCountMap(valueText) {
    if (!valueText || typeof valueText !== "object") return "";
    return Object.keys(valueText)
      .sort()
      .map((key) => `${STATUS_LABELS[key] || key}: ${valueText[key]}`)
      .join(" | ");
  }

  function setStatus(message) {
    const status = document.getElementById("wb-report-status");
    if (status) status.textContent = message || "";
  }

  function setWithdrawalsStatus(message) {
    const status = document.getElementById("wb-withdrawals-status");
    if (status) status.textContent = message || "";
  }

  function setLoading(isLoading) {
    state.loading = isLoading;
    const loadButton = document.getElementById("wb-report-load");
    if (loadButton) {
      loadButton.disabled = isLoading;
      loadButton.textContent = isLoading ? "Загрузка..." : "Сформировать";
    }
    setExportEnabled(!isLoading && getFilteredRows().length > 0);
    setDetailsDebugEnabled(!isLoading && getFilteredRows().length > 0);
  }

  function setDetailsDebugLoading(isLoading) {
    const button = document.getElementById("wb-report-details-debug");
    if (!button) return;
    button.disabled = isLoading || !getFilteredRows().length;
    button.textContent = isLoading ? "Детали..." : "Собрать детали";
  }

  function setWithdrawalsLoading(isLoading) {
    withdrawalsState.loading = isLoading;
    const loadButton = document.getElementById("wb-withdrawals-load");
    if (loadButton) {
      loadButton.disabled = isLoading;
      loadButton.textContent = isLoading ? "Загрузка..." : "Загрузить";
    }
    setWithdrawalsExportEnabled(!isLoading && withdrawalsState.rows.length > 0);
    updateWithdrawalsSelectionControls();
  }

  function setExportEnabled(enabled) {
    const exportButton = document.getElementById("wb-report-export");
    if (exportButton) exportButton.disabled = !enabled;
  }

  function setDetailsDebugEnabled(enabled) {
    const button = document.getElementById("wb-report-details-debug");
    if (button) button.disabled = !enabled;
  }

  function setWithdrawalsExportEnabled(enabled) {
    const button = document.getElementById("wb-withdrawals-export");
    if (button) button.disabled = !enabled;
  }

  function updateWithdrawalsSelectionControls() {
    const hasRows = withdrawalsState.rows.length > 0;
    const selectedCount = getSelectedWithdrawals().length;
    const xlsxButton = document.getElementById("wb-withdrawals-export-xlsx");
    const selectAllButton = document.getElementById("wb-withdrawals-select-all");
    const clearButton = document.getElementById("wb-withdrawals-clear-selection");
    if (xlsxButton) xlsxButton.disabled = withdrawalsState.loading || selectedCount === 0;
    if (selectAllButton) selectAllButton.disabled = withdrawalsState.loading || !hasRows;
    if (clearButton) clearButton.disabled = withdrawalsState.loading || selectedCount === 0;
  }

  function readArray(source, paths) {
    for (const path of paths) {
      const found = getPath(source, path);
      if (Array.isArray(found)) return found;
    }
    return [];
  }

  function readObject(source, paths) {
    for (const path of paths) {
      const found = getPath(source, path);
      if (found && typeof found === "object" && !Array.isArray(found)) return found;
    }
    return {};
  }

  function value(source, paths) {
    for (const path of paths) {
      const found = getPath(source, path);
      if (found !== null && found !== undefined && found !== "") return found;
    }
    return "";
  }

  function numberValue(source, paths) {
    const raw = value(source, paths);
    if (raw === "") return 0;
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
    const parsed = Number(String(raw).replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function pick(source, keys) {
    for (const key of keys) {
      if (source && Object.prototype.hasOwnProperty.call(source, key)) return source[key];
    }
    return undefined;
  }

  function getPath(source, path) {
    return path.split(".").reduce((current, part) => {
      if (current === null || current === undefined) return undefined;
      return current[part];
    }, source);
  }

  function cloneJson(valueText) {
    return JSON.parse(JSON.stringify(valueText));
  }

  function walkObject(target, visitor) {
    if (!target || typeof target !== "object") return;

    if (Array.isArray(target)) {
      target.forEach((item) => walkObject(item, visitor));
      return;
    }

    Object.keys(target).forEach((key) => {
      visitor(target, key);
      walkObject(target[key], visitor);
    });
  }

  function sum(rows, field) {
    return rows.reduce((total, row) => total + (Number(row[field]) || 0), 0);
  }

  function toApiDateStart(date) {
    return `${date}T00:00:00.000Z`;
  }

  function toApiDateEnd(date) {
    return `${date}T23:59:59.999Z`;
  }

  function toApiDateStartOffset(date) {
    return `${date}T00:00:00+03:00`;
  }

  function toApiDateEndOffset(date) {
    return `${date}T23:59:59+03:00`;
  }

  function addDays(date, days) {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
  }

  function formatDateInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatDateTime(valueText) {
    if (!valueText) return "";
    const date = new Date(valueText);
    if (Number.isNaN(date.getTime())) return String(valueText);
    return date.toLocaleString("ru-RU");
  }

  function formatDateOnly(valueText) {
    if (!valueText) return "";
    const date = new Date(valueText);
    if (Number.isNaN(date.getTime())) return String(valueText);
    return date.toLocaleDateString("ru-RU");
  }

  function formatPeriod(fromValue, toValue) {
    const fromText = formatDateTime(fromValue);
    const toText = formatDateTime(toValue);
    if (fromText && toText) return `${fromText} - ${toText}`;
    return fromText || toText || "";
  }

  function formatNumber(valueText) {
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Number(valueText) || 0);
  }

  function formatMoney(valueText) {
    return new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(valueText) || 0);
  }

  function formatPercent(valueText) {
    if (valueText === null || valueText === undefined || Number.isNaN(Number(valueText))) return "—";
    return `${new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format((Number(valueText) || 0) * 100)}%`;
  }

  function formatMoneyWithCurrency(valueText, currency) {
    const money = formatMoney(valueText);
    return currency ? `${money} ${currency}` : money;
  }

  function decimal(valueText) {
    return String(Math.round((Number(valueText) || 0) * 100) / 100).replace(".", ",");
  }

  function percentDecimal(valueText) {
    if (valueText === null || valueText === undefined || Number.isNaN(Number(valueText))) return "";
    return decimal((Number(valueText) || 0) * 100);
  }

  function escapeHtml(valueText) {
    return String(valueText ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeXml(valueText) {
    return String(valueText ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function sanitizeFilename(valueText) {
    return String(valueText ?? "")
      .trim()
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "report";
  }

  function buildXlsxBlob({ sheetName, headers, rows, numericColumns }) {
    const files = new Map();
    const nowIso = new Date().toISOString();
    const safeSheetName = String(sheetName || "Sheet1").slice(0, 31);
    const table = [headers, ...rows];
    const lastColumn = excelColumnName(headers.length || 1);
    const lastRow = table.length || 1;
    const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${table.map((row, rowIndex) => `
    <row r="${rowIndex + 1}">
      ${row.map((cell, columnIndex) => {
        const ref = `${excelColumnName(columnIndex + 1)}${rowIndex + 1}`;
        if (rowIndex > 0 && numericColumns && numericColumns.has(columnIndex)) {
          const numeric = Number(cell) || 0;
          return `<c r="${ref}"><v>${numeric}</v></c>`;
        }
        return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`;
      }).join("")}
    </row>`).join("")}
  </sheetData>
</worksheet>`;

    files.set("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`);
    files.set("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);
    files.set("docProps/app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Microsoft Excel</Application>
</Properties>`);
    files.set("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>Codex</dc:creator>
  <cp:lastModifiedBy>Codex</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:modified>
</cp:coreProperties>`);
    files.set("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXml(safeSheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`);
    files.set("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
    files.set("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`);
    files.set("xl/worksheets/sheet1.xml", sheetXml);

    return buildZipBlob(files);
  }

  function excelColumnName(index) {
    let valueText = "";
    let current = Number(index) || 1;
    while (current > 0) {
      const remainder = (current - 1) % 26;
      valueText = String.fromCharCode(65 + remainder) + valueText;
      current = Math.floor((current - 1) / 26);
    }
    return valueText;
  }

  function buildZipBlob(files) {
    const encoder = new TextEncoder();
    const entries = Array.from(files.entries()).map(([name, content]) => {
      const nameBytes = encoder.encode(name);
      const dataBytes = encoder.encode(content);
      return {
        name,
        nameBytes,
        dataBytes,
        crc32: crc32(dataBytes),
      };
    });

    let localOffset = 0;
    const localParts = [];
    const centralParts = [];

    for (const entry of entries) {
      const localHeader = createZipLocalHeader(entry.nameBytes, entry.dataBytes, entry.crc32);
      localParts.push(localHeader, entry.nameBytes, entry.dataBytes);

      const centralHeader = createZipCentralHeader(entry.nameBytes, entry.dataBytes, entry.crc32, localOffset);
      centralParts.push(centralHeader, entry.nameBytes);

      localOffset += localHeader.length + entry.nameBytes.length + entry.dataBytes.length;
    }

    const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
    const endRecord = createZipEndRecord(entries.length, centralSize, localOffset);
    return new Blob([...localParts, ...centralParts, endRecord], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  function createZipLocalHeader(nameBytes, dataBytes, crc) {
    const buffer = new ArrayBuffer(30);
    const view = new DataView(buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint32(14, crc >>> 0, true);
    view.setUint32(18, dataBytes.length, true);
    view.setUint32(22, dataBytes.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    return new Uint8Array(buffer);
  }

  function createZipCentralHeader(nameBytes, dataBytes, crc, offset) {
    const buffer = new ArrayBuffer(46);
    const view = new DataView(buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, 0, true);
    view.setUint32(16, crc >>> 0, true);
    view.setUint32(20, dataBytes.length, true);
    view.setUint32(24, dataBytes.length, true);
    view.setUint16(28, nameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, offset, true);
    return new Uint8Array(buffer);
  }

  function createZipEndRecord(entriesCount, centralSize, centralOffset) {
    const buffer = new ArrayBuffer(22);
    const view = new DataView(buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(4, 0, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, entriesCount, true);
    view.setUint16(10, entriesCount, true);
    view.setUint32(12, centralSize, true);
    view.setUint32(16, centralOffset, true);
    view.setUint16(20, 0, true);
    return new Uint8Array(buffer);
  }

  let crc32TableCache = null;

  function crc32(bytes) {
    const table = getCrc32Table();
    let crc = -1;
    for (let index = 0; index < bytes.length; index += 1) {
      crc = (crc >>> 8) ^ table[(crc ^ bytes[index]) & 0xff];
    }
    return (crc ^ -1) >>> 0;
  }

  function getCrc32Table() {
    if (crc32TableCache) return crc32TableCache;
    crc32TableCache = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let valueText = index;
      for (let bit = 0; bit < 8; bit += 1) {
        valueText = (valueText & 1) ? (0xedb88320 ^ (valueText >>> 1)) : (valueText >>> 1);
      }
      crc32TableCache[index] = valueText >>> 0;
    }
    return crc32TableCache;
  }

  function init() {
    injectStyle();
    createOpenButton();
    createWithdrawalsButton();
  }

  installAuthCapture();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
