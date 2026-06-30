const fileInput = document.getElementById("fileInput");
const importBtn = document.getElementById("importBtn");
const fileMeta = document.getElementById("fileMeta");
const searchInput = document.getElementById("searchInput");
const searchMode = document.getElementById("searchMode");
const startTime = document.getElementById("startTime");
const endTime = document.getElementById("endTime");
const levelFilter = document.getElementById("levelFilter");
const pageSize = document.getElementById("pageSize");
const searchBtn = document.getElementById("searchBtn");
const clearBtn = document.getElementById("clearBtn");
const exportTxtBtn = document.getElementById("exportTxtBtn");
const exportJsonBtn = document.getElementById("exportJsonBtn");
const resultList = document.getElementById("resultList");
const resultCount = document.getElementById("resultCount");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const pageInfo = document.getElementById("pageInfo");
const jsonView = document.getElementById("jsonView");

let allLines = [];
let matchedItems = [];
let currentPage = 1;
let currentQuery = buildQuerySpec("", "include");
let currentMode = "include";
let currentRegex = null;
let currentFileBaseName = "log";
let selectedLineIndex = null;

if (importBtn && fileInput) {
  importBtn.addEventListener("click", () => {
    // Reset so selecting the same file again still triggers change.
    fileInput.value = "";
    fileInput.click();
  });
}

if (fileInput) {
  fileInput.addEventListener("change", handleFileSelection);
  // Some browsers are more reliable with input event for file controls.
  fileInput.addEventListener("input", handleFileSelection);
}

async function handleFileSelection(event) {
  const file = event.target?.files?.[0];
  if (!file) return;

  let text = "";
  try {
    text = await file.text();
  } catch (error) {
    fileMeta.textContent = `Cannot read file: ${file.name}`;
    resultList.innerHTML = "";
    resultCount.textContent = "0";
    const msg = document.createElement("div");
    msg.className = "row";
    const detail = error instanceof Error ? error.message : "Unknown read error";
    msg.innerHTML = `<div class="line-text">File import failed: ${escapeHtml(detail)}</div>`;
    resultList.appendChild(msg);
    console.error("File read failed", error);
    return;
  }

  try {
    allLines = text.split(/\r?\n/);
    currentFileBaseName = (file.name || "log").replace(/\.[^.]+$/, "") || "log";
    selectedLineIndex = null;
    fileMeta.textContent = `${file.name} | ${allLines.length.toLocaleString()} lines`;
    runSearch();
  } catch (error) {
    fileMeta.textContent = `${file.name} | ${allLines.length.toLocaleString()} lines (loaded)`;
    resultList.innerHTML = "";
    resultCount.textContent = "0";
    const msg = document.createElement("div");
    msg.className = "row";
    const detail = error instanceof Error ? error.message : "Unknown processing error";
    msg.innerHTML = `<div class="line-text">File loaded, but processing failed: ${escapeHtml(detail)}</div>`;
    resultList.appendChild(msg);
    console.error("Post-load processing failed", error);
  }
}

searchBtn.addEventListener("click", runSearch);
clearBtn.addEventListener("click", () => {
  searchInput.value = "";
  searchMode.value = "include";
  startTime.value = "";
  endTime.value = "";
  levelFilter.value = "all";
  pageSize.value = "100";
  jsonView.textContent = "Select a matched line to parse JSON.";
  runSearch();
});

exportTxtBtn.addEventListener("click", () => exportMatches("txt"));
exportJsonBtn.addEventListener("click", () => exportMatches("json"));

prevPageBtn.addEventListener("click", () => {
  if (currentPage <= 1) return;
  currentPage -= 1;
  renderCurrentPage();
});

nextPageBtn.addEventListener("click", () => {
  const totalPages = getTotalPages();
  if (currentPage >= totalPages) return;
  currentPage += 1;
  renderCurrentPage();
});

pageSize.addEventListener("change", () => {
  currentPage = 1;
  renderCurrentPage();
});

startTime.addEventListener("change", runSearch);
endTime.addEventListener("change", runSearch);

searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") runSearch();
});

function runSearch() {
  if (!allLines.length) {
    matchedItems = [];
    currentQuery = buildQuerySpec("", "include");
    currentMode = "include";
    currentRegex = null;
    currentPage = 1;
    renderCurrentPage();
    return;
  }

  const raw = searchInput.value.trim();
  const fromMs = parseDateInput(startTime.value);
  const toMs = parseDateInput(endTime.value);
  const selectedLevel = levelFilter.value;
  const hasQuery = Boolean(raw);

  if (fromMs !== null && toMs !== null && fromMs > toMs) {
    resultList.innerHTML = "";
    resultCount.textContent = "0";
    pageInfo.textContent = "Page 1 / 1";
    prevPageBtn.disabled = true;
    nextPageBtn.disabled = true;
    const msg = document.createElement("div");
    msg.className = "row";
    msg.innerHTML = '<div class="line-text">Invalid time range: From must be before To.</div>';
    resultList.appendChild(msg);
    return;
  }

  let query = buildQuerySpec("", "include");
  let mode = searchMode.value;
  let regex = null;

  if (!raw) {
    mode = "include";
  } else {
    const autoExact = /^"[^\"]+"$/.test(raw);
    const normalizedInput = autoExact ? raw.slice(1, -1) : raw;
    mode = autoExact ? "exact" : searchMode.value;
    query = buildQuerySpec(normalizedInput, mode);

    if (mode === "regex") {
      try {
        regex = new RegExp(query.raw, "i");
      } catch (error) {
        resultList.innerHTML = "";
        resultCount.textContent = "0";
        const msg = document.createElement("div");
        msg.className = "row";
        msg.innerHTML = `<div class="line-text">Invalid regex: ${escapeHtml(error.message)}</div>`;
        resultList.appendChild(msg);
        return;
      }
    }
  }

  const matches = allLines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => {
      if (!linePassesTimeFilter(line, fromMs, toMs)) return false;
      if (!linePassesLevelFilter(line, selectedLevel)) return false;
      if (!hasQuery) return true;
      return isMatch(line, query, mode, regex);
    });

  matchedItems = matches;
  currentQuery = query;
  currentMode = mode;
  currentRegex = regex;
  currentPage = 1;
  renderCurrentPage();
}

function isMatch(line, query, mode, regex) {
  if (mode === "regex") return Boolean(regex?.test(line));

  const terms = query.terms.length ? query.terms : [query.raw];
  const normalizedTerms = terms.filter((term) => term.length > 0);
  if (!normalizedTerms.length) return true;

  const termMatches = (term) => {
    if (mode === "exact") return line.includes(term);
    return line.toLowerCase().includes(term.toLowerCase());
  };

  if (query.operator === "and") {
    return normalizedTerms.every(termMatches);
  }

  return normalizedTerms.some(termMatches);
}

function renderResults(items, query, mode, regex) {
  resultList.innerHTML = "";
  resultCount.textContent = String(matchedItems.length);

  if (!items.length) {
    selectedLineIndex = null;
    const empty = document.createElement("div");
    empty.className = "row";
    empty.innerHTML = '<div class="line-text">No matches found.</div>';
    resultList.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  const headerRow = document.createElement("div");
  headerRow.className = "row header-row";

  const lineHeader = document.createElement("div");
  lineHeader.className = "line-no";
  lineHeader.textContent = "Line";

  const atTimestampHeader = document.createElement("div");
  atTimestampHeader.className = "line-ts";
  atTimestampHeader.textContent = "@timestamp";

  const timestampHeader = document.createElement("div");
  timestampHeader.className = "line-ts";
  timestampHeader.textContent = "timestamp";

  const messageHeader = document.createElement("div");
  messageHeader.className = "line-text";
  messageHeader.textContent = "Message";

  headerRow.appendChild(lineHeader);
  headerRow.appendChild(atTimestampHeader);
  headerRow.appendChild(timestampHeader);
  headerRow.appendChild(messageHeader);
  fragment.appendChild(headerRow);

  items.forEach(({ line, index }) => {
    const timestamps = extractTimestampColumns(line);

    const row = document.createElement("button");
    row.className = "row";
    row.type = "button";
    if (selectedLineIndex === index) {
      row.classList.add("selected-row");
    }

    const lineNo = document.createElement("div");
    lineNo.className = "line-no";
    lineNo.textContent = `Line ${index + 1}`;

    const atTimestamp = document.createElement("div");
    atTimestamp.className = "line-ts";
    atTimestamp.textContent = timestamps.atTimestamp ?? "-";

    const timestamp = document.createElement("div");
    timestamp.className = "line-ts";
    timestamp.textContent = timestamps.timestamp ?? "-";

    const text = document.createElement("div");
    text.className = "line-text";
    text.innerHTML = highlight(line, query, mode, regex);

    row.appendChild(lineNo);
    row.appendChild(atTimestamp);
    row.appendChild(timestamp);
    row.appendChild(text);

    row.addEventListener("click", () => {
      selectedLineIndex = index;
      jsonView.textContent = prettyJsonFromLine(line);
      renderCurrentPage();
    });

    fragment.appendChild(row);
  });

  resultList.appendChild(fragment);
}

function renderCurrentPage() {
  const size = getPageSizeValue();
  const total = matchedItems.length;
  const totalPages = Math.max(1, Math.ceil(total / size));

  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const start = (currentPage - 1) * size;
  const end = start + size;
  const pageItems = matchedItems.slice(start, end);

  renderResults(pageItems, currentQuery, currentMode, currentRegex);
  updatePaginationUi(totalPages);
}

function updatePaginationUi(totalPages) {
  pageInfo.textContent = `Page ${currentPage} / ${totalPages}`;
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= totalPages;
}

function getPageSizeValue() {
  const size = Number.parseInt(pageSize.value, 10);
  return Number.isNaN(size) || size <= 0 ? 100 : size;
}

function getTotalPages() {
  return Math.max(1, Math.ceil(matchedItems.length / getPageSizeValue()));
}

function highlight(line, query, mode, regex) {
  if (!query.raw) return escapeHtml(line);
  if (mode === "exact") return escapeHtml(line);

  if (mode === "regex") {
    return highlightRegex(line, regex);
  }

  const terms = query.terms.length ? query.terms : [query.raw];
  const escapedTerms = [...new Set(terms.filter((t) => t.length > 0))]
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  if (!escapedTerms.length) return escapeHtml(line);

  const includeRegex = new RegExp(escapedTerms.join("|"), "gi");
  return escapeHtml(line).replace(includeRegex, (token) => `<mark>${token}</mark>`);
}

function buildQuerySpec(raw, mode) {
  const input = String(raw || "").trim();
  if (!input) {
    return { raw: "", terms: [], operator: "or" };
  }

  if (mode === "regex") {
    return { raw: input, terms: [input], operator: "or" };
  }

  const quotedTerms = [];
  const quotedRegex = /"([^"]+)"/g;
  for (const match of input.matchAll(quotedRegex)) {
    quotedTerms.push(match[1]);
  }

  if (quotedTerms.length >= 2 && /\band\b|&&/i.test(input)) {
    return { raw: input, terms: quotedTerms, operator: "and" };
  }

  if (quotedTerms.length >= 2 && /\bor\b|\|\|/i.test(input)) {
    return { raw: input, terms: quotedTerms, operator: "or" };
  }

  if (quotedTerms.length >= 2) {
    return { raw: input, terms: quotedTerms, operator: "or" };
  }

  return { raw: input, terms: [input], operator: "or" };
}

function highlightRegex(line, regex) {
  if (!regex) return escapeHtml(line);

  const source = line;
  const out = [];
  let lastIndex = 0;
  const globalRegex = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);

  for (const match of source.matchAll(globalRegex)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;

    if (start > lastIndex) {
      out.push(escapeHtml(source.slice(lastIndex, start)));
    }

    if (match[0].length > 0) {
      out.push(`<mark>${escapeHtml(match[0])}</mark>`);
      lastIndex = end;
    } else {
      out.push(escapeHtml(source.slice(start, start + 1)));
      lastIndex = start + 1;
    }
  }

  if (lastIndex < source.length) {
    out.push(escapeHtml(source.slice(lastIndex)));
  }

  return out.length ? out.join("") : escapeHtml(line);
}

function parseDateInput(value) {
  if (!value) return null;
  const date = new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

function linePassesTimeFilter(line, fromMs, toMs) {
  if (fromMs === null && toMs === null) return true;

  const ts = extractTimestampForFilter(line);
  if (!ts) return false;

  if (fromMs !== null && ts < fromMs) return false;
  if (toMs !== null && ts > toMs) return false;
  return true;
}

function extractTimestampForFilter(line) {
  const columns = extractTimestampColumns(line);

  if (columns.atTimestamp) {
    const fromAt = parseLocalWallClockMillis(columns.atTimestamp);
    if (fromAt !== null) return fromAt;
  }

  if (columns.timestamp) {
    const fromTs = parseLocalWallClockMillis(columns.timestamp);
    if (fromTs !== null) return fromTs;
  }

  const fromLine = parseLocalWallClockMillis(line);
  if (fromLine !== null) return fromLine;

  return extractTimestamp(line);
}

function parseLocalWallClockMillis(value) {
  const text = String(value || "");

  const ymd = text.match(/(\d{4})[-\/](\d{2})[-\/](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?/);
  if (ymd) {
    const year = Number.parseInt(ymd[1], 10);
    const month = Number.parseInt(ymd[2], 10) - 1;
    const day = Number.parseInt(ymd[3], 10);
    const hour = Number.parseInt(ymd[4], 10);
    const minute = Number.parseInt(ymd[5], 10);
    const second = Number.parseInt(ymd[6], 10);
    const milliText = (ymd[7] || "0").slice(0, 3).padEnd(3, "0");
    const millis = Number.parseInt(milliText, 10);
    return new Date(year, month, day, hour, minute, second, millis).getTime();
  }

  const dmy = text.match(/(\d{2})-(\d{2})-(\d{4})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?/);
  if (dmy) {
    const day = Number.parseInt(dmy[1], 10);
    const month = Number.parseInt(dmy[2], 10) - 1;
    const year = Number.parseInt(dmy[3], 10);
    const hour = Number.parseInt(dmy[4], 10);
    const minute = Number.parseInt(dmy[5], 10);
    const second = Number.parseInt(dmy[6], 10);
    const milliText = (dmy[7] || "0").slice(0, 3).padEnd(3, "0");
    const millis = Number.parseInt(milliText, 10);
    return new Date(year, month, day, hour, minute, second, millis).getTime();
  }

  return null;
}

function linePassesLevelFilter(line, selectedLevel) {
  if (selectedLevel === "all") return true;
  return extractLogLevel(line) === selectedLevel;
}

function extractLogLevel(line) {
  const fromJson = extractLevelFromJson(line);
  if (fromJson) return fromJson;

  const plainMatch = line.match(/\b(INFO|WARN|WARNING|ERROR)\b/i);
  if (!plainMatch) return null;

  return normalizeLevel(plainMatch[1]);
}

function extractLevelFromJson(line) {
  const candidates = [];
  candidates.push(line.trim());

  const objectStart = line.indexOf("{");
  if (objectStart >= 0) {
    candidates.push(line.slice(objectStart).trim());
  }

  for (const candidate of candidates) {
    try {
      const obj = JSON.parse(candidate);
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) continue;

      const fields = ["level", "severity", "logLevel", "lvl"];
      for (const field of fields) {
        if (typeof obj[field] === "string") {
          const normalized = normalizeLevel(obj[field]);
          if (normalized) return normalized;
        }
      }
    } catch {
      // Ignore invalid json while probing level.
    }
  }

  return null;
}

function normalizeLevel(value) {
  const v = String(value).toUpperCase();
  if (v === "INFO") return "INFO";
  if (v === "WARN" || v === "WARNING") return "WARN";
  if (v === "ERROR") return "ERROR";
  return null;
}

function extractTimestamp(line) {
  const columns = extractTimestampColumns(line);

  if (columns.atTimestamp) {
    const fromAtTimestamp = parseTimestampTextToMillis(columns.atTimestamp);
    if (fromAtTimestamp !== null) return fromAtTimestamp;
  }

  if (columns.timestamp) {
    const fromTimestamp = parseTimestampTextToMillis(columns.timestamp);
    if (fromTimestamp !== null) return fromTimestamp;
  }

  return extractTimestampFromPatterns(line);
}

function extractTimestampFromPatterns(line) {
  const patterns = [
    /\b(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?)\b/,
    /\b(\d{4}\/\d{2}\/\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\b/,
    /\b(\d{2}-\d{2}-\d{4}[ T]\d{2}:\d{2}:\d{2})\b/
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (!match) continue;

    const candidate = match[1].replace(" ", "T");
    const d = new Date(candidate);
    const ms = d.getTime();
    if (!Number.isNaN(ms)) return ms;
  }

  return null;
}

function extractTimestampColumns(line) {
  const obj = parseJsonObjectFromLine(line);
  if (!obj) {
    const detected = extractTimestampFromPatterns(line);
    return {
      atTimestamp: null,
      timestamp: detected === null ? null : new Date(detected).toISOString()
    };
  }

  const atTimestamp = readObjectTextValue(obj, "@timestamp");
  const timestamp = readObjectTextValue(obj, "timestamp");

  return {
    atTimestamp,
    timestamp
  };
}

function parseJsonObjectFromLine(line) {
  const candidates = [line.trim()];
  const objectStart = line.indexOf("{");
  if (objectStart >= 0) {
    candidates.push(line.slice(objectStart).trim());
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Ignore non-json line variants.
    }
  }

  return null;
}

function readObjectTextValue(obj, key) {
  if (!(key in obj)) return null;
  const value = obj[key];
  if (value === null || value === undefined) return null;
  return String(value);
}

function parseTimestampTextToMillis(value) {
  const asNumber = Number(value);
  if (!Number.isNaN(asNumber) && Number.isFinite(asNumber)) {
    const ms = asNumber > 9999999999 ? asNumber : asNumber * 1000;
    const d = new Date(ms);
    const result = d.getTime();
    return Number.isNaN(result) ? null : result;
  }

  const normalized = String(value).replace(" ", "T");
  const d = new Date(normalized);
  const ms = d.getTime();
  return Number.isNaN(ms) ? null : ms;
}

function prettyJsonFromLine(line) {
  const candidates = [];

  candidates.push(line.trim());

  const jsonObjectStart = line.indexOf("{");
  if (jsonObjectStart >= 0) {
    candidates.push(line.slice(jsonObjectStart).trim());
  }

  const jsonArrayStart = line.indexOf("[");
  if (jsonArrayStart >= 0) {
    candidates.push(line.slice(jsonArrayStart).trim());
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      return JSON.stringify(parsed, null, 2);
    } catch {
      // Try next candidate.
    }
  }

  return "No valid JSON found in this line.";
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function exportMatches(format) {
  if (!matchedItems.length) {
    window.alert("No matched lines to export.");
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  if (format === "txt") {
    const content = matchedItems.map((item) => item.line).join("\n");
    downloadBlob(content, "text/plain;charset=utf-8", `${currentFileBaseName}-matches-${stamp}.txt`);
    return;
  }

  const payload = matchedItems.map(({ line, index }) => {
    const cols = extractTimestampColumns(line);
    return {
      lineNumber: index + 1,
      level: extractLogLevel(line),
      "@timestamp": cols.atTimestamp,
      timestamp: cols.timestamp,
      line
    };
  });

  downloadBlob(
    JSON.stringify(payload, null, 2),
    "application/json;charset=utf-8",
    `${currentFileBaseName}-matches-${stamp}.json`
  );
}

function downloadBlob(content, mimeType, filename) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
