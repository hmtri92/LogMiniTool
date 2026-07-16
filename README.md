# Log Mini Tool

A tiny browser-based tool to import log files (`.log`, `.txt`, `.json`, `.ndjson`, `.csv`), search lines, and pretty-print JSON content found in a selected line.

## Run

1. Open `index.html` in your browser.
2. Click **Import Log File** and choose a log file:
   - Plain text: `.log`, `.txt`
   - JSON: `.json`, `.ndjson`
   - CSV: `.csv` (extracts log field and all columns as JSON)
3. Search using:
   - **Include** mode: finds lines containing the keyword.
   - **Exact** mode: line must contain the exact phrase (case-sensitive).
   - **Regex** mode: pattern search (case-insensitive), e.g. `ERROR|WARN`.
   - Or type quoted query like `"timeout error"` to force exact mode automatically.
4. Optional time filter:
   - Set **From** and/or **To** to filter by timestamp in each line.
   - Supported timestamp formats include:
     - `YYYY-MM-DD HH:mm:ss` (or with `T`)
     - `YYYY-MM-DDTHH:mm:ssZ` / timezone offsets
     - `YYYY/MM/DD HH:mm:ss`
5. Optional level filter:
   - Filter parsed levels: `INFO`, `WARN`, `ERROR`.
   - Works with plain text logs and JSON logs (`level`, `severity`, `logLevel`, `lvl`).
6. Pagination:
   - Choose page size: 50 / 100 / 250 / 500 lines per page.
   - Use `Prev` / `Next` to navigate very large result sets.
7. Export:
   - `Export TXT`: writes all current matched lines to a text file.
   - `Export JSON`: writes all current matched lines with `lineNumber`, `level`, `timestamp`, and `line`.
8. Click a matched line to pretty-print JSON in the lower panel.

## Files

- `index.html` - UI structure
- `styles.css` - styles (desktop/mobile)
- `app.js` - log import, search logic, JSON prettify logic

## CSV Support

When importing CSV files, the tool:
- Uses the first row as column headers
- Extracts the main log content from fields named: `log`, `message`, or `content`
- Detects and parses nested JSON within the log field
- Merges nested JSON fields (like `@timestamp`, `level`, `traceId`) to the top level for filtering
- Displays the full CSV row as JSON when you expand a line
- Supports all filtering features (search, time range, log level) on CSV data
- **Handles very large CSV files** (tested with 600MB+ files)
  - Files < 50MB: Uses standard browser File API
  - Files 50-200MB: Uses FileReader with progress tracking
  - Files ≥ 200MB: **Uses reverse streaming parser** (reads from end to start in 10MB chunks)
  - **Optimized for newest-first display**: Large files are read in reverse order to avoid sorting
  - Never loads entire file into memory for large files
  - Shows progress during parsing: "Parsing (newest first)... 20% (5,000 rows)"

**Performance notes:**
- Small files (<10MB): Instant loading
- Medium files (10-50MB): 1-5 seconds
- Large files (50-200MB): 5-30 seconds
- Very large files (200-600MB): 30-120 seconds with reverse streaming
- **Reverse streaming eliminates sorting delay** - 600MB file loads ready to view newest logs first!

**How reverse streaming works for large files:**
1. Reads file headers from the beginning
2. **Reads file content from END to START in 10MB chunks** (newest logs first)
3. Parses CSV line-by-line without loading entire file
4. Builds result array in descending datetime order (newest first)
5. **No sorting needed** - data is already in the correct order!
6. Shows real-time progress: "Parsing (newest first)... 40% (50,000 rows)"
7. Memory-efficient: only keeps parsed lines, not raw CSV text

**Benefits of reverse streaming:**
- ⚡ **Faster initial view**: No sorting delay for large files
- 🎯 **Newest logs appear first**: Perfect for troubleshooting recent issues
- 💾 **Memory-efficient**: Processes 10MB at a time instead of loading all 600MB
- 📊 **Progress tracking**: Real-time feedback during long operations

**For the best experience with very large files:**
- Use Chrome or Edge (better memory handling)
- Close other tabs to free up RAM
- Monitor the browser console (F12) for detailed progress updates

Example CSV format supported:
```csv
_id,@timestamp,log,kubernetes.pod_name,...
abc123,2026-07-10T03:04:32.487Z,"{""level"":""INFO"",""message"":""API Call"",...}",pod-name,...
```
