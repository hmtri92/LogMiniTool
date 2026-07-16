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
const firstPageBtn = document.getElementById("firstPageBtn");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const pageInfo = document.getElementById("pageInfo");
const gotoPageInput = document.getElementById("gotoPageInput");
const gotoPageBtn = document.getElementById("gotoPageBtn");
const dropZone = document.getElementById("dropZone");

let allLines = [];
let matchedItems = [];
let currentPage = 1;
let currentQuery = buildQuerySpec("", "include");
let currentMode = "include";
let currentRegex = null;
let currentFileBaseName = "log";
let selectedLineIndex = null;
let pendingExpandedScrollIndex = null;
let dragCounter = 0;
let collapsingLineIndex = null;
let collapseTimerId = null;
const COLLAPSE_ANIMATION_MS = 220;
let expandScrollTimerId = null;
const EXPAND_SCROLL_DELAY_MS = COLLAPSE_ANIMATION_MS + 20;

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

if (dropZone && fileInput) {
  dropZone.addEventListener("dragenter", onDropZoneDragEnter);
  dropZone.addEventListener("dragover", onDropZoneDragOver);
  dropZone.addEventListener("dragleave", onDropZoneDragLeave);
  dropZone.addEventListener("drop", onDropZoneDrop);
}

function parseCsv(text) {
  const lines = [];
  
  try {
    const rows = parseSimpleCsv(text);
    if (!rows.length) {
      console.warn('CSV parsing resulted in 0 rows');
      return { lines };
    }

    const headers = rows[0].map(h => h.trim());
    
    let emptyRowCount = 0;
    let validRowCount = 0;
    
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      
      // Skip completely empty rows
      if (!row || row.length === 0) {
        emptyRowCount++;
        continue;
      }
      
      // Check if row has any non-empty data
      const hasData = row.some(cell => cell && cell.trim());
      if (!hasData) {
        emptyRowCount++;
        continue;
      }
      
      const record = {};
      for (let j = 0; j < headers.length; j++) {
        record[headers[j]] = row[j] ? row[j].trim() : "";
      }
      
      // Extract the main log content from common field names
      const logField = record.log || record.message || record.content || "";
      
      // Try to extract JSON from the log field
      let enrichedRecord = { ...record };
      if (logField) {
        // Look for JSON object in the log field
        const jsonStart = logField.indexOf('{');
        if (jsonStart >= 0) {
          const jsonPart = logField.substring(jsonStart);
          try {
            // Handle escaped quotes in JSON
            const unescaped = jsonPart.replace(/""/g, '"');
            const logJson = JSON.parse(unescaped);
            
            // Preserve CSV column timestamps - they are the authoritative source
            const csvTimestamp = record['@timestamp'];
            const csvTimestampAlt = record['timestamp'];
            
            // Merge log JSON fields into the record for better level/field extraction
            // Store nested JSON timestamps separately to avoid overwriting CSV columns
            enrichedRecord = { 
              ...record, 
              ...logJson, 
              _csvRow: record,
              _nestedTimestamp: logJson['@timestamp'] || logJson['timestamp']
            };
            
            // Restore CSV column timestamps (they take priority)
            if (csvTimestamp) enrichedRecord['@timestamp'] = csvTimestamp;
            if (csvTimestampAlt) enrichedRecord['timestamp'] = csvTimestampAlt;
          } catch (e) {
            // If parsing fails, try with original
            try {
              const logJson = JSON.parse(jsonPart);
              
              const csvTimestamp = record['@timestamp'];
              const csvTimestampAlt = record['timestamp'];
              
              enrichedRecord = { 
                ...record, 
                ...logJson, 
                _csvRow: record,
                _nestedTimestamp: logJson['@timestamp'] || logJson['timestamp']
              };
              
              if (csvTimestamp) enrichedRecord['@timestamp'] = csvTimestamp;
              if (csvTimestampAlt) enrichedRecord['timestamp'] = csvTimestampAlt;
            } catch (e2) {
              // If still fails, keep original record
              if (validRowCount === 0) {
                console.warn(`First row JSON parsing failed:`, e.message, e2.message);
              }
            }
          }
        }
      }
      
      // Create a searchable line with both the log content and full record
      const line = `${logField}|${JSON.stringify(enrichedRecord)}`;
      lines.push(line);
      validRowCount++;
    }
  } catch (error) {
    console.error('CSV parsing error:', error);
    throw error;
  }
  
  return { lines };
}

function parseSimpleCsv(text) {
  const rows = [];
  let currentRow = [];
  let currentField = "";
  let insideQuotes = false;
  
  const textLength = text.length;
  let lastProgressPercent = 0;

  for (let i = 0; i < textLength; i++) {
    
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentField += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      currentRow.push(currentField);
      currentField = "";
    } else if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (currentField || currentRow.length > 0) {
        currentRow.push(currentField);
        // Don't filter out rows here - let parseCsv handle it
        rows.push(currentRow);
        currentRow = [];
        currentField = "";
      }
      if (char === "\r" && nextChar === "\n") i++;
    } else {
      currentField += char;
    }
  }

  // Don't forget the last row
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

async function handleFileSelection(event) {
  const file = event.target?.files?.[0];
  if (!file) return;

  await processSelectedFile(file);
}

async function processSelectedFile(file) {
  if (!file) return;

  setDropZoneState("loading");
  
  // Display file size info
  const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
  const sizeInfo = file.size > 1024 * 1024 
    ? `${fileSizeMB} MB` 
    : `${(file.size / 1024).toFixed(2)} KB`;
  
  // Warn about very large files
  if (file.size > 200 * 1024 * 1024) { // 200MB+
    fileMeta.textContent = `Loading large file ${file.name} (${sizeInfo})... Please wait...`;
  } else if (file.size > 50 * 1024 * 1024) { // 50MB+
    fileMeta.textContent = `Loading ${file.name} (${sizeInfo})...`;
  } else {
    fileMeta.textContent = `Loading ${file.name} (${sizeInfo})...`;
  }

  let text = "";
  try {
    // For very large files, use FileReader in chunks to avoid memory issues
    if (file.size > 200 * 1024 * 1024) {
      // Use streaming parser for very large files
      const startTime = performance.now();
      allLines = await parseCSVFileInChunks(file, fileMeta);
      const parseTime = ((performance.now() - startTime) / 1000).toFixed(2);
      
      currentFileBaseName = (file.name || "log").replace(/\.[^.]+$/, "") || "log";
      selectedLineIndex = null;
      
      const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
      const sizeDisplay = file.size > 1024 * 1024 
        ? `${fileSizeMB} MB` 
        : `${(file.size / 1024).toFixed(2)} KB`;
      fileMeta.textContent = `${file.name} | ${allLines.length.toLocaleString()} lines | ${sizeDisplay} | Parsed in ${parseTime}s, processing...`;
      
      setDropZoneState("ready");
      const totalStartTime = performance.now();
      runSearch();
      const totalTime = ((totalStartTime - startTime) / 1000).toFixed(2);
      fileMeta.textContent = `${file.name} | ${allLines.length.toLocaleString()} lines | ${sizeDisplay} | Ready in ${totalTime}s (parsed ${parseTime}s)`;
      return; // Exit early since we've already processed
    } else if (file.size > 50 * 1024 * 1024) {
      // For medium-large files, use FileReader
      text = await readFileInChunks(file);
    } else {
      text = await file.text();
    }
  } catch (error) {
    fileMeta.textContent = `Cannot read file: ${file.name}`;
    setDropZoneState("error");
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
    const isCsv = file.name.toLowerCase().endsWith(".csv");
    const startTime = performance.now();
    
    if (isCsv) {
      const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
      const sizeInfo = file.size > 1024 * 1024 
        ? `${fileSizeMB} MB` 
        : `${(file.size / 1024).toFixed(2)} KB`;
      fileMeta.textContent = `Parsing CSV ${file.name} (${sizeInfo})...`;
      
      const csv = parseCsv(text);
      allLines = csv.lines;
      
      const parseTime = ((performance.now() - startTime) / 1000).toFixed(2);
    } else {
      allLines = text.split(/\r?\n/);
    }
    
    // Clear large text from memory after parsing
    text = "";
    
    currentFileBaseName = (file.name || "log").replace(/\.[^.]+$/, "") || "log";
    selectedLineIndex = null;
    
    // Display final stats with size
    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
    const sizeDisplay = file.size > 1024 * 1024 
      ? `${fileSizeMB} MB` 
      : `${(file.size / 1024).toFixed(2)} KB`;
    const parseTime = ((performance.now() - startTime) / 1000).toFixed(2);
    fileMeta.textContent = `${file.name} | ${allLines.length.toLocaleString()} lines | ${sizeDisplay} | Parsed in ${parseTime}s, processing...`;
    setDropZoneState("ready");
    runSearch();
    const totalTime = ((performance.now() - startTime) / 1000).toFixed(2);
    fileMeta.textContent = `${file.name} | ${allLines.length.toLocaleString()} lines | ${sizeDisplay} | Ready in ${totalTime}s (parsed ${parseTime}s)`;
  } catch (error) {
    fileMeta.textContent = `${file.name} | ${allLines.length.toLocaleString()} lines (loaded)`;
    setDropZoneState("error");
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

function onDropZoneDragEnter(event) {
  event.preventDefault();
  dragCounter += 1;
  setDropZoneState("active");
}

function onDropZoneDragOver(event) {
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
}

function onDropZoneDragLeave(event) {
  event.preventDefault();
  dragCounter = Math.max(0, dragCounter - 1);
  if (dragCounter === 0) {
    setDropZoneState("ready");
  }
}

async function onDropZoneDrop(event) {
  event.preventDefault();
  dragCounter = 0;
  setDropZoneState("ready");

  const file = event.dataTransfer?.files?.[0];
  if (!file) {
    setDropZoneState("error");
    fileMeta.textContent = "Drop failed: no file found";
    return;
  }

  await processSelectedFile(file);
}

// Streaming CSV parser for very large files (processes in chunks, then reverses for newest-first)
async function parseCSVFileInChunks(file, statusElement) {
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks
  const lines = [];
  let offset = 0;
  let buffer = '';
  let headers = null;
  let validRowCount = 0;
  
  while (offset < file.size) {
    const chunk = file.slice(offset, offset + CHUNK_SIZE);
    const chunkText = await readChunk(chunk);
    buffer += chunkText;
    
    // Process complete lines in the buffer
    const lastNewline = buffer.lastIndexOf('\n');
    if (lastNewline === -1) {
      // No complete line yet, continue reading
      offset += CHUNK_SIZE;
      continue;
    }
    
    const completeText = buffer.substring(0, lastNewline);
    buffer = buffer.substring(lastNewline + 1); // Keep incomplete line in buffer
    
    // Split into lines and process
    const chunkLines = completeText.split(/\r?\n/);
    
    for (const csvLine of chunkLines) {
      if (!csvLine.trim()) continue;
      
      const fields = parseCSVLine(csvLine);
      if (!fields || fields.length === 0) continue;
      
      // First line is headers
      if (!headers) {
        headers = fields.map(f => f.trim());
        continue;
      }
      
      // Build record from fields
      const record = {};
      for (let i = 0; i < headers.length; i++) {
        record[headers[i]] = fields[i] ? fields[i].trim() : '';
      }
      
      // Extract log field
      const logField = record.log || record.message || record.content || '';
      
      // Try to parse JSON from log field
      let enrichedRecord = { ...record };
      if (logField) {
        const jsonStart = logField.indexOf('{');
        if (jsonStart >= 0) {
          const jsonPart = logField.substring(jsonStart);
          try {
            const unescaped = jsonPart.replace(/""/g, '"');
            const logJson = JSON.parse(unescaped);
            enrichedRecord = { ...record, ...logJson, _csvRow: record };
          } catch {
            // Keep original record if JSON parse fails
          }
        }
      }
      
      const line = `${logField}|${JSON.stringify(enrichedRecord)}`;
      lines.push(line);
      validRowCount++;
    }
    
    // Update progress
    offset += CHUNK_SIZE;
    const progress = Math.min(100, Math.floor((offset / file.size) * 100));
    if (progress % 10 === 0 || offset >= file.size) {
      if (statusElement) {
        statusElement.textContent = `Parsing ${file.name}... ${progress}% (${validRowCount.toLocaleString()} rows)`;
      }
    }
  }
  
  // Process any remaining buffer
  if (buffer.trim()) {
    const fields = parseCSVLine(buffer);
    if (fields && fields.length > 0 && headers) {
      const record = {};
      for (let i = 0; i < headers.length; i++) {
        record[headers[i]] = fields[i] ? fields[i].trim() : '';
      }
      const logField = record.log || record.message || record.content || '';
      let enrichedRecord = { ...record };
      if (logField) {
        const jsonStart = logField.indexOf('{');
        if (jsonStart >= 0) {
          try {
            const logJson = JSON.parse(logField.substring(jsonStart).replace(/""/g, '"'));
            enrichedRecord = { ...record, ...logJson, _csvRow: record };
          } catch {}
        }
      }
      lines.push(`${logField}|${JSON.stringify(enrichedRecord)}`);
      validRowCount++;
    }
  }
  
  return lines;
}

// Read a single chunk as text
async function readChunk(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result || '');
    reader.onerror = (e) => reject(new Error('Chunk read failed'));
    reader.readAsText(blob);
  });
}

// Parse a single CSV line handling quotes
function parseCSVLine(line) {
  const fields = [];
  let currentField = '';
  let insideQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentField += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      fields.push(currentField);
      currentField = '';
    } else {
      currentField += char;
    }
  }
  
  fields.push(currentField);
  return fields;
}

// Read a sample from the file to verify it's readable
async function readFileSample(file, sampleSize) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const blob = file.slice(0, sampleSize);
    
    reader.onload = (e) => {
      resolve(e.target.result || '');
    };
    
    reader.onerror = (e) => {
      console.error('Sample read error:', e);
      reject(new Error('Failed to read file sample'));
    };
    
    reader.readAsText(blob);
  });
}

// Chunked file reader for very large files
async function readFileInChunks(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const result = e.target.result;
      
      if (!result || result.length === 0) {
        console.error('FileReader returned empty result despite file size:', file.size);
        reject(new Error(`File read failed - empty result from ${(file.size / (1024 * 1024)).toFixed(2)} MB file`));
        return;
      }
      
      const text = result;
      resolve(text);
    };
    
    reader.onerror = (e) => {
      console.error('FileReader error:', e);
      console.error('FileReader error details:', reader.error);
      reject(new Error(`Failed to read file: ${reader.error?.message || 'Unknown error'}`));
    };
    
    reader.onabort = (e) => {
      console.error('FileReader aborted:', e);
      reject(new Error('File read was aborted'));
    };
    
    reader.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.floor((e.loaded / e.total) * 100);
        if (percent % 10 === 0) {
          fileMeta.textContent = `Reading ${file.name}... ${percent}%`;
        }
      }
    };
    
    // Read as text
    reader.readAsText(file);
  });
}

function setDropZoneState(state) {
  if (!dropZone) return;

  dropZone.classList.remove("is-active", "has-error");

  if (state === "active") {
    dropZone.classList.add("is-active");
    return;
  }

  if (state === "loading") {
    dropZone.setAttribute("aria-busy", "true");
    return;
  }

  if (state === "error") {
    dropZone.classList.add("has-error");
    dropZone.removeAttribute("aria-busy");
    return;
  }

  dropZone.removeAttribute("aria-busy");
}

searchBtn.addEventListener("click", runSearch);
clearBtn.addEventListener("click", () => {
  searchInput.value = "";
  searchMode.value = "include";
  startTime.value = "";
  endTime.value = "";
  levelFilter.value = "all";
  pageSize.value = "100";
  runSearch();
});

exportTxtBtn.addEventListener("click", () => exportMatches("txt"));
exportJsonBtn.addEventListener("click", () => exportMatches("json"));

firstPageBtn.addEventListener("click", () => {
  if (currentPage <= 1) return;
  currentPage = 1;
  renderCurrentPage();
});

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

gotoPageBtn.addEventListener("click", () => {
  const totalPages = getTotalPages();
  const targetPage = Number.parseInt(gotoPageInput.value, 10);
  if (isNaN(targetPage) || targetPage < 1 || targetPage > totalPages) {
    gotoPageInput.value = currentPage;
    return;
  }
  currentPage = targetPage;
  renderCurrentPage();
});

gotoPageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    gotoPageBtn.click();
  }
});

pageSize.addEventListener("change", () => {
  currentPage = 1;
  renderCurrentPage();
});

// Datetime range filtering requires manual Search button click
// (no auto-filter on date/time selection)

levelFilter.addEventListener("change", runSearch);

searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") runSearch();
});

function runSearch() {
  const searchStartTime = performance.now();
  
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

  let matches = allLines
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => {
      const passesTime = linePassesTimeFilter(line, fromMs, toMs);
      const passesLevel = linePassesLevelFilter(line, selectedLevel);
      const passesQuery = !hasQuery || isMatch(line, query, mode, regex);
      
      return passesTime && passesLevel && passesQuery;
    });
  
  // Optimize sorting: cache timestamps before sort to avoid repeated extraction
  // For 27k lines, this reduces ~400k extractTimestamp calls to just 27k
  const sortStartTime = performance.now();
  const matchesWithTime = matches.map(item => ({
    ...item,
    cachedTime: extractTimestamp(item.line)
  }));
  
  // Sort by cached datetime descending (newest first)
  matchesWithTime.sort((a, b) => {
    const timeA = a.cachedTime;
    const timeB = b.cachedTime;
    
    // Handle null timestamps (lines without parseable datetime)
    if (timeA === null && timeB === null) return 0;
    if (timeA === null) return 1; // Put nulls at the end
    if (timeB === null) return -1; // Put nulls at the end
    
    return timeB - timeA; // Descending order (newest first)
  });
  
  matches = matchesWithTime;

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

  const utcTimestampHeader = document.createElement("div");
  utcTimestampHeader.className = "line-ts-utc";
  utcTimestampHeader.textContent = "Time (UTC)";

  const messageHeader = document.createElement("div");
  messageHeader.className = "line-text";
  messageHeader.textContent = "Message";

  const actionHeader = document.createElement("div");
  actionHeader.className = "line-action";
  actionHeader.textContent = "Action";

  headerRow.appendChild(lineHeader);
  headerRow.appendChild(utcTimestampHeader);
  headerRow.appendChild(messageHeader);
  headerRow.appendChild(actionHeader);
  fragment.appendChild(headerRow);

  items.forEach(({ line, index }) => {
    const utcTime = extractUTCTimestamp(line);
    const isExpanded = selectedLineIndex === index;
    const isCollapsing = collapsingLineIndex === index;
    const isPanelVisible = isExpanded || isCollapsing;
    const prettyJson = prettyJsonFromLine(line);

    const row = document.createElement("button");
    row.className = "row";
    row.type = "button";
    if (isPanelVisible) {
      row.classList.add("selected-row");
    }

    const lineNo = document.createElement("div");
    lineNo.className = "line-no";
    lineNo.textContent = `Line ${index + 1}`;

    const utcTimestamp = document.createElement("div");
    utcTimestamp.className = "line-ts-utc";
    utcTimestamp.textContent = utcTime ?? "-";

    const text = document.createElement("div");
    text.className = "line-text";
    text.innerHTML = highlight(line, query, mode, regex);

    const actionCell = document.createElement("div");
    actionCell.className = "row-actions";

    const copyBtn = document.createElement("button");
    copyBtn.className = "btn ghost row-copy-btn";
    copyBtn.type = "button";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      const copied = await copyTextToClipboard(line);
      const originalLabel = copyBtn.textContent;
      copyBtn.textContent = copied ? "Copied" : "Copy failed";
      window.setTimeout(() => {
        copyBtn.textContent = originalLabel;
      }, 1200);
    });

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "btn ghost row-toggle-btn";
    toggleBtn.type = "button";
    toggleBtn.textContent = isPanelVisible ? "Collapse" : "Expand";
    toggleBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleExpandedRow(index);
    });

    actionCell.appendChild(copyBtn);
    actionCell.appendChild(toggleBtn);

    row.appendChild(lineNo);
    row.appendChild(utcTimestamp);
    row.appendChild(text);
    row.appendChild(actionCell);

    row.addEventListener("click", () => {
      if (hasActiveTextSelection()) {
        return;
      }
      // Row click keeps text selection behavior stable; expand/collapse uses explicit button.
    });

    fragment.appendChild(row);

    if (isPanelVisible) {
      const expandedPanel = buildExpandedRowPanel(prettyJson, isCollapsing);
      expandedPanel.dataset.rowIndex = String(index);
      fragment.appendChild(expandedPanel);
    }
  });

  resultList.appendChild(fragment);
}

function buildExpandedRowPanel(prettyJson, isCollapsing = false) {
  const panel = document.createElement("div");
  panel.className = `row-expanded${isCollapsing ? " is-collapsing" : ""}`;

  const tabs = document.createElement("div");
  tabs.className = "row-expanded-tabs";

  const jsonBtn = document.createElement("button");
  jsonBtn.className = "row-tab-btn active";
  jsonBtn.type = "button";
  jsonBtn.textContent = "JSON";

  const copyJsonBtn = document.createElement("button");
  copyJsonBtn.className = "row-tab-btn row-tab-copy-btn";
  copyJsonBtn.type = "button";
  copyJsonBtn.textContent = "Copy JSON";

  tabs.appendChild(jsonBtn);
  tabs.appendChild(copyJsonBtn);

  const jsonView = document.createElement("div");
  jsonView.className = "scroll-container";
  
  const jsonViewEl = document.createElement("pre");
  jsonViewEl.className = "row-expanded-json scroll-item";
  jsonViewEl.textContent = prettyJson;

  jsonView.appendChild(jsonViewEl);

  copyJsonBtn.addEventListener("click", async () => {
    const copied = await copyTextToClipboard(String(prettyJson || ""));
    const original = copyJsonBtn.textContent;
    copyJsonBtn.textContent = copied ? "Copied" : "Copy failed";
    window.setTimeout(() => {
      copyJsonBtn.textContent = original;
    }, 1200);
  });

  panel.appendChild(tabs);
  panel.appendChild(jsonView);
  return panel;
}

function toggleExpandedRow(index) {
  if (collapsingLineIndex !== null) return;

  if (selectedLineIndex === index) {
    startCollapseAnimation(index);
    return;
  }

  clearCollapseAnimationTimer();
  clearExpandScrollTimer();
  collapsingLineIndex = null;
  selectedLineIndex = index;
  pendingExpandedScrollIndex = index;
  renderCurrentPage();
}

function startCollapseAnimation(index) {
  clearCollapseAnimationTimer();
  clearExpandScrollTimer();
  collapsingLineIndex = index;
  pendingExpandedScrollIndex = null;
  renderCurrentPage();

  collapseTimerId = window.setTimeout(() => {
    if (selectedLineIndex === index) {
      selectedLineIndex = null;
    }
    collapsingLineIndex = null;
    collapseTimerId = null;
    renderCurrentPage();
  }, COLLAPSE_ANIMATION_MS);
}

function clearCollapseAnimationTimer() {
  if (collapseTimerId === null) return;
  window.clearTimeout(collapseTimerId);
  collapseTimerId = null;
}

function clearExpandScrollTimer() {
  if (expandScrollTimerId === null) return;
  window.clearTimeout(expandScrollTimerId);
  expandScrollTimerId = null;
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

  if (pendingExpandedScrollIndex !== null) {
    scheduleExpandedRowScroll(pendingExpandedScrollIndex);
    pendingExpandedScrollIndex = null;
  }
}

function scheduleExpandedRowScroll(rowIndex) {
  clearExpandScrollTimer();
  expandScrollTimerId = window.setTimeout(() => {
    scrollExpandedRowIntoView(rowIndex);
    expandScrollTimerId = null;
  }, EXPAND_SCROLL_DELAY_MS);
}

function scrollExpandedRowIntoView(rowIndex) {
  const expandedPanel = resultList.querySelector(`.row-expanded[data-row-index="${rowIndex}"]`);
  if (!expandedPanel) return;
  expandedPanel.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
}

function updatePaginationUi(totalPages) {
  pageInfo.textContent = `Page ${currentPage} / ${totalPages}`;
  firstPageBtn.disabled = currentPage <= 1;
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= totalPages;
  gotoPageInput.value = currentPage;
  gotoPageInput.max = totalPages;
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

  if (mode === "regex") {
    return highlightRegex(line, regex);
  }

  // For exact mode, highlight the exact phrase (case-insensitive)
  if (mode === "exact") {
    const searchTerm = query.raw;
    if (!searchTerm) return escapeHtml(line);
    
    // Escape the search term for regex
    const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const exactRegex = new RegExp(escapedTerm, "gi"); // case-insensitive
    
    return escapeHtml(line).replace(exactRegex, (token) => `<mark>${token}</mark>`);
  }

  // For include mode, highlight all terms
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

function extractUTCTimestamp(line) {
  // Use extractTimestampColumns which handles both CSV and JSON formats correctly
  const columns = extractTimestampColumns(line);
  
  // Prefer @timestamp over timestamp field, and ensure it's in UTC format
  if (columns.atTimestamp) {
    return formatAsUTC(columns.atTimestamp);
  }
  
  if (columns.timestamp) {
    return formatAsUTC(columns.timestamp);
  }
  
  return null;
}

function formatAsUTC(timestampValue) {
  if (!timestampValue) return null;
  
  const text = String(timestampValue);
  
  // If already ends with Z, it's already UTC format
  if (text.endsWith('Z')) {
    return text;
  }
  
  // Try to parse as timestamp and convert to UTC ISO string
  const ms = parseTimestampTextToMillis(text);
  if (ms !== null) {
    return new Date(ms).toISOString();
  }
  
  return null;
}

function parseDateInput(value) {
  if (!value) return null;
  // Treat datetime-local input as UTC time to match the UTC timestamps in logs
  // Input format: "2026-07-09T06:33" -> treat as "2026-07-09T06:33:00.000Z"
  const utcDate = new Date(value + 'Z');
  const time = utcDate.getTime();
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
  // Use extractTimestampColumns FIRST - it correctly handles CSV format by parsing the enrichedRecord JSON
  // This ensures filtering matches the Time (UTC) column display
  const columns = extractTimestampColumns(line);

  if (columns.atTimestamp) {
    const fromAt = parseTimestampTextToMillis(columns.atTimestamp);
    if (fromAt !== null) return fromAt;
  }

  if (columns.timestamp) {
    const fromTs = parseTimestampTextToMillis(columns.timestamp);
    if (fromTs !== null) return fromTs;
  }

  // Fallback: try parsing the whole line
  const fromLine = parseTimestampTextToMillis(line);
  if (fromLine !== null) return fromLine;

  return extractTimestamp(line);
}

function extractNamedTimestampValue(line, fieldName) {
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`"${escaped}"\\s*:\\s*"([^"]+)"`, "i"),
    new RegExp(`\\"${escaped}\\"\\s*:\\s*\\"([^\\"]+)\\"`, "i")
  ];

  for (const pattern of patterns) {
    const match = String(line || "").match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
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
  // For CSV format, the line is: logField|enrichedRecord
  // Parse the enrichedRecord JSON which has the correct CSV column timestamps
  const pipeIndex = line.indexOf('|');
  if (pipeIndex > 0 && pipeIndex < line.length - 1) {
    // This is likely a CSV line with format: logField|enrichedRecord_json
    const jsonPart = line.substring(pipeIndex + 1);
    try {
      const obj = JSON.parse(jsonPart);
      const atTimestamp = obj["@timestamp"];
      const timestamp = obj["timestamp"];
      return {
        atTimestamp,
        timestamp
      };
    } catch (e) {
      // If parsing fails, fall through to regular parsing
    }
  }
  
  // For non-CSV format (regular JSON logs)
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
  const candidates = buildJsonCandidates(line);

  for (const candidate of candidates) {
    const parsed = parseJsonCandidate(candidate);
    if (parsed !== null) {
      return JSON.stringify(parsed, null, 2);
    }
  }

  return "No valid JSON found in this line.";
}

function buildJsonCandidates(line) {
  const text = String(line || "").trim();
  const candidates = [text];

  const markers = ["):", "RequestBody:", "requestBody:", "responseBody:", "payload:"];
  for (const marker of markers) {
    const markerIndex = text.indexOf(marker);
    if (markerIndex >= 0) {
      const afterMarker = text.slice(markerIndex + marker.length).trim();
      if (afterMarker) {
        candidates.push(afterMarker);
        const extracted = extractLeadingJsonFragment(afterMarker);
        if (extracted) candidates.push(extracted);
      }
    }
  }

  const objectStart = text.indexOf("{");
  if (objectStart >= 0) {
    candidates.push(text.slice(objectStart).trim());
    const extracted = extractLeadingJsonFragment(text.slice(objectStart));
    if (extracted) candidates.push(extracted);
  }

  const escapedObjectStart = text.indexOf('{\\"');
  if (escapedObjectStart >= 0) {
    candidates.push(text.slice(escapedObjectStart).trim());
  }

  const arrayStart = text.indexOf("[");
  if (arrayStart >= 0) {
    candidates.push(text.slice(arrayStart).trim());
    const extracted = extractLeadingJsonFragment(text.slice(arrayStart));
    if (extracted) candidates.push(extracted);
  }

  return [...new Set(candidates.filter(Boolean))];
}

function parseJsonCandidate(candidate) {
  const text = String(candidate || "").trim();
  if (!text) return null;

  try {
    const parsed = JSON.parse(text);
    return normalizeParsedJsonValue(parsed);
  } catch {
    // Try escaped-json recovery next.
  }

  const escapedNormalized = normalizeEscapedJsonText(text);
  if (escapedNormalized !== text) {
    try {
      return normalizeParsedJsonValue(JSON.parse(escapedNormalized));
    } catch {
      // Ignore and fall through.
    }
  }

  return null;
}

function normalizeParsedJsonValue(value) {
  if (typeof value === "string") {
    const nested = tryParseNestedJsonString(value);
    return nested ?? value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeParsedJsonValue(item));
  }

  if (value && typeof value === "object") {
    const normalized = {};
    for (const [key, entry] of Object.entries(value)) {
      normalized[key] = normalizeParsedJsonValue(entry);
    }
    return normalized;
  }

  return value;
}

function tryParseNestedJsonString(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  const candidates = buildJsonCandidates(text);
  for (const candidate of candidates) {
    const isSameText = candidate === text;
    const looksJsonLike = /^[\[{]/.test(candidate) || candidate.includes("):") || /(?:request|response)Body:/i.test(candidate);
    if (!isSameText || looksJsonLike) {
      const parsed = parseJsonCandidateShallow(candidate);
      if (parsed !== null) {
        return normalizeParsedJsonValue(parsed);
      }
    }
  }

  return null;
}

function parseJsonCandidateShallow(candidate) {
  const text = String(candidate || "").trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    // Try escaped-json recovery next.
  }

  const escapedNormalized = normalizeEscapedJsonText(text);
  if (escapedNormalized !== text) {
    try {
      return JSON.parse(escapedNormalized);
    } catch {
      // Ignore and fall through.
    }
  }

  return null;
}

function normalizeEscapedJsonText(value) {
  return String(value || "")
    .replace(/^"(.*)"$/, "$1")
    .replaceAll('\\"', '"');
}

function extractLeadingJsonFragment(value) {
  const text = String(value || "");
  const start = text.search(/[\[{]/);
  if (start < 0) return null;

  const openChar = text[start];
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === openChar) depth += 1;
    if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1).trim();
      }
    }
  }

  return null;
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

async function copyTextToClipboard(text) {
  const value = String(text ?? "");

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall back for environments where clipboard permissions are restricted.
    }
  }

  const ta = document.createElement("textarea");
  ta.value = value;
  ta.setAttribute("readonly", "true");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }

  document.body.removeChild(ta);
  return copied;
}

function hasActiveTextSelection() {
  const selection = window.getSelection();
  return Boolean(selection && selection.toString().trim().length > 0);
}
