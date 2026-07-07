// ==UserScript==
// @name         WB Logistics Finished Shipments Report
// @namespace    https://logistics.wildberries.ru/
// @version      1.0.4
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
  const SCRIPT_VERSION = "1.0.4";
  const PAGE_LIMIT = 100;
  const BUTTON_ID = "wb-report-open-button";
  const ROOT_ID = "wb-report-root";

  let state = {
    rows: [],
    grouped: [],
    summary: null,
    loading: false,
    debug: {
      attempts: [],
      lastError: "",
    },
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
    #${ROOT_ID} {
      position: fixed;
      inset: 0;
      z-index: 2147483001;
      display: none;
      font: 14px/1.45 Arial, sans-serif;
      color: #1f2937;
    }
    #${ROOT_ID}.is-open { display: block; }
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
    });
    root.querySelector("#wb-report-load").addEventListener("click", loadReport);
    root.querySelector("#wb-report-export").addEventListener("click", exportCsv);
    root.querySelector("#wb-report-debug").addEventListener("click", copyDebugInfo);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && root.classList.contains("is-open")) closeModal();
    });
    document.body.appendChild(root);
  }

  function openModal() {
    createModal();
    document.getElementById(ROOT_ID).classList.add("is-open");
  }

  function closeModal() {
    const root = document.getElementById(ROOT_ID);
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
      state.grouped = groupByDriver(state.rows);
      state.summary = buildSummary(state.rows);
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
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url,
        data: JSON.stringify(payload),
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
      });
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
      "id", "shipment_id", "shipmentId", "route_id", "routeId", "rid", "last_id",
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
      "started_at", "startedAt", "created_at", "createdAt", "date_from", "dateFrom",
      "shipment_date", "shipmentDate", "finished_at", "finishedAt",
    ]) || "";
    const finishedAt = value(item, [
      "finished_at", "finishedAt", "closed_at", "closedAt", "ended_at", "endedAt",
    ]) || "";
    const deliveries = numberValue(item, [
      "deliveries", "delivery_count", "deliveryCount", "delivered", "orders_delivered",
      "ordersDelivered", "stats.deliveries", "stat.deliveries",
    ]);
    const returns = numberValue(item, [
      "returns", "return_count", "returnCount", "returned", "orders_returned",
      "ordersReturned", "stats.returns", "stat.returns",
    ]);
    const amount = numberValue(item, [
      "sum", "amount", "total", "total_sum", "totalSum", "price", "cost",
      "income", "reward", "payment", "driver_reward", "driverReward",
    ]);
    const warehouse = value(item, [
      "warehouse.name", "warehouseName", "warehouse_name", "office.name", "officeName",
      "src_office.name", "srcOfficeName",
    ]) || "";
    const status = value(item, ["status", "state", "shipment_status", "shipmentStatus"]) || "";

    return {
      id: id ?? "",
      driverName,
      driverPhone,
      startedAt,
      finishedAt,
      warehouse,
      status,
      deliveries,
      returns,
      amount,
      raw: item,
    };
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
      };
      current.trips += 1;
      current.amount += row.amount;
      current.deliveries += row.deliveries;
      current.returns += row.returns;
      current.averageTrip = current.trips ? current.amount / current.trips : 0;
      map.set(key, current);
    }

    return Array.from(map.values()).sort((a, b) => b.amount - a.amount || b.trips - a.trips);
  }

  function renderReport() {
    const content = document.getElementById("wb-report-content");
    const summary = state.summary || buildSummary([]);

    if (!state.rows.length) {
      renderEmpty("За выбранный период рейсы не найдены.");
      setExportEnabled(false);
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
      <h3 class="wb-report-section-title">По водителям</h3>
      ${renderDriversTable(state.grouped)}
      <h3 class="wb-report-section-title">Рейсы</h3>
      ${renderTripsTable(state.rows)}
    `;
    setExportEnabled(true);
  }

  function renderStat(label, valueText) {
    return `
      <div class="wb-report-stat">
        <div class="wb-report-stat-label">${escapeHtml(label)}</div>
        <div class="wb-report-stat-value">${escapeHtml(valueText)}</div>
      </div>
    `;
  }

  function renderDriversTable(rows) {
    return `
      <div class="wb-report-table-wrap">
        <table class="wb-report-table">
          <thead>
            <tr>
              <th>Водитель</th>
              <th>Телефон</th>
              <th class="wb-report-num">Рейсы</th>
              <th class="wb-report-num">Сумма</th>
              <th class="wb-report-num">Доставки</th>
              <th class="wb-report-num">Возвраты</th>
              <th class="wb-report-num">Средний рейс</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>${escapeHtml(row.driverName)}</td>
                <td>${escapeHtml(row.driverPhone)}</td>
                <td class="wb-report-num">${formatNumber(row.trips)}</td>
                <td class="wb-report-num">${formatMoney(row.amount)}</td>
                <td class="wb-report-num">${formatNumber(row.deliveries)}</td>
                <td class="wb-report-num">${formatNumber(row.returns)}</td>
                <td class="wb-report-num">${formatMoney(row.averageTrip)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderTripsTable(rows) {
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
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>${escapeHtml(row.id)}</td>
                <td>${escapeHtml(row.driverName)}</td>
                <td>${escapeHtml(row.driverPhone)}</td>
                <td>${escapeHtml(formatDateTime(row.startedAt))}</td>
                <td>${escapeHtml(formatDateTime(row.finishedAt))}</td>
                <td>${escapeHtml(row.warehouse)}</td>
                <td>${escapeHtml(row.status)}</td>
                <td class="wb-report-num">${formatMoney(row.amount)}</td>
                <td class="wb-report-num">${formatNumber(row.deliveries)}</td>
                <td class="wb-report-num">${formatNumber(row.returns)}</td>
              </tr>
            `).join("")}
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
    if (!state.rows.length) return;

    const summary = state.summary || buildSummary(state.rows);
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
    for (const row of state.grouped) {
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
    lines.push(["ID", "Водитель", "Телефон", "Старт", "Финиш", "Склад", "Статус", "Сумма", "Доставки", "Возвраты"]);
    for (const row of state.rows) {
      lines.push([
        row.id,
        row.driverName,
        row.driverPhone,
        formatDateTime(row.startedAt),
        formatDateTime(row.finishedAt),
        row.warehouse,
        row.status,
        decimal(row.amount),
        row.deliveries,
        row.returns,
      ]);
    }

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

  async function copyDebugInfo() {
    const debugInfo = {
      version: SCRIPT_VERSION,
      url: location.href,
      hasCapturedTemplate: Boolean(capturedBodyTemplate),
      capturedTemplate: capturedBodyTemplate,
      capturedAuthHeaderNames: Object.keys(capturedAuthHeaders),
      lastError: state.debug.lastError,
      attempts: state.debug.attempts,
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

  function setStatus(message) {
    const status = document.getElementById("wb-report-status");
    if (status) status.textContent = message || "";
  }

  function setLoading(isLoading) {
    state.loading = isLoading;
    const loadButton = document.getElementById("wb-report-load");
    if (loadButton) {
      loadButton.disabled = isLoading;
      loadButton.textContent = isLoading ? "Загрузка..." : "Сформировать";
    }
    setExportEnabled(!isLoading && state.rows.length > 0);
  }

  function setExportEnabled(enabled) {
    const exportButton = document.getElementById("wb-report-export");
    if (exportButton) exportButton.disabled = !enabled;
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

  function formatNumber(valueText) {
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Number(valueText) || 0);
  }

  function formatMoney(valueText) {
    return new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(valueText) || 0);
  }

  function decimal(valueText) {
    return String(Math.round((Number(valueText) || 0) * 100) / 100).replace(".", ",");
  }

  function escapeHtml(valueText) {
    return String(valueText ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function init() {
    injectStyle();
    createOpenButton();
  }

  installAuthCapture();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
