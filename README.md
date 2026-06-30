# Log Mini Tool

A tiny browser-based tool to import `.log` files, search lines, and pretty-print JSON content found in a selected line.

## Run

1. Open `index.html` in your browser.
2. Click **Import Log File** and choose a log file (for example: `uno-netty-service-12h.log`).
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
