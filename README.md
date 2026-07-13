# Accessibility Scanner

Enter a URL, scan the page against **WCAG 2.0 Level AA**, and get back an HTML/PDF
report that lists every issue, the element it affects, and how to fix it.

The scanner runs four engines over the rendered page and merges the results, so a
problem found by more than one engine is reported once — not four times.

## What it checks

| Engine | Role |
|--------|------|
| **axe-core** (`@axe-core/playwright`) | Primary automated engine, filtered to the `wcag2a` + `wcag2aa` tags |
| **HTML_CodeSniffer** | Second opinion using the W3C-derived WCAG2AA ruleset — widens coverage of 1.3.1 and 3.3.x |
| **html-validate** | Markup validity, which is what SC **4.1.1 Parsing** actually asks for |
| **Custom DOM checks** | Autoplaying media (1.4.2), `meta refresh` (2.2.1), `blink`/`marquee` (2.2.2), ambiguous link text (2.4.4), skipped heading levels (2.4.6) |

Automated tooling can only reach part of WCAG 2.0 AA. The criteria that need a
human — captions, meaningful sequence, use of color, keyboard traps, focus order,
error suggestion — are **not silently passed**. They are emitted with every report
as a reviewer checklist (see [src/manual-checklist.js](src/manual-checklist.js)),
so the report reflects the real scope of the standard.

[REQUIREMENTS.md](REQUIREMENTS.md) has the full 38-criterion matrix and states
which criteria are automated, partial, or manual.

## Getting started

Requires Node.js 18+.

```bash
npm install
npx playwright install chromium
```

### Web UI

```bash
npm start
# → http://localhost:3000
```

Enter a URL, run the scan, and download the generated PDF.

### CLI

```bash
npm run scan -- https://example.com
```

Prints a summary and writes both an HTML and a PDF report to `reports/`:

```
Results
───────────────────────────────
Violations        : 14
  critical        : 2
  serious         : 6
  ...
Needs review      : 9
Elements affected : 63
```

## How a scan works

1. Playwright loads the page in headless Chromium (1366×900) and waits for it to settle.
2. axe-core analyzes the live page; the DOM snapshot is captured *before* HTML_CodeSniffer
   injects its script, so the markup passed to `html-validate` is the page's own.
3. All four engines' findings are normalized to a common shape — engine, status
   (`violation` / `review`), impact, success criterion, affected elements.
4. Findings are deduplicated by *criterion + element*, keeping the most authoritative
   engine's wording (axe first). See `dedupeFindings` in [src/scanner.js](src/scanner.js).
5. Each finding is enriched with a plain-English description and a concrete fix,
   then rendered to HTML and printed to PDF.

## Project layout

```
src/
  server.js           Express app + POST /api/scan
  cli.js              Command-line entry point
  scanner.js          Orchestrates the engines, dedupes, summarizes
  engines.js          HTML_CodeSniffer, html-validate, custom DOM checks
  guidance.js         Plain-English descriptions and fixes per rule
  manual-checklist.js WCAG 2.0 AA criteria that require human review
  report.js           HTML report template + PDF rendering
public/               Web UI
reports/              Generated reports (gitignored)
```

## API

`POST /api/scan` with `{ "url": "https://example.com" }` returns the summary and a
link to the generated PDF:

```json
{
  "ok": true,
  "url": "https://example.com",
  "title": "Example Domain",
  "level": "WCAG 2.0 AA",
  "engines": ["axe-core", "HTML_CodeSniffer", "html-validate", "checks"],
  "summary": { "violations": 14, "review": 9, "byImpact": { "critical": 2 } },
  "reportPdfUrl": "/reports/example.com-2026-07-13.pdf"
}
```

`GET /api/health` → `{ "ok": true }`

## Scope

A scan covers a **single page**. Criteria that can only be judged across a site —
2.4.5 Multiple Ways, 3.2.3 Consistent Navigation, 3.2.4 Consistent Identification —
would need a crawler and are currently listed in the manual checklist.
