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
| **Claude** (`claude-opus-4-8`) | Reviews the 23 criteria a rule engine *cannot* decide — meaningful sequence, use of color, sensory characteristics, error suggestion, and the media criteria |

### Why an LLM is the fourth engine and not a gimmick

Rule engines can only check what is mechanically decidable. Roughly two-thirds of
WCAG 2.0 AA needs judgment about *meaning* — is that alt text actually
descriptive, does color alone carry the information, does the DOM order match the
visual order. Those criteria are listed in
[src/manual-checklist.js](src/manual-checklist.js) and were previously left for a
human.

Claude now runs as the review stage. It receives the rendered markup, the page
URL, and the criteria the four rule engines already flagged, then judges each
manual criterion as `violation` / `review` / `pass` / `not_applicable` with the
element cited as evidence. Its findings are normalized into the same shape as
axe-core's, so they deduplicate, summarize, and render identically — but they sit
last in engine priority, so where Claude overlaps a deterministic engine, the
deterministic engine wins.

Two guardrails matter:

- **The AI pass is additive.** If the API key is missing, rejected, rate-limited,
  or the call fails, the scan still completes on the four deterministic engines.
- **A skipped review is never silent.** The report and UI say plainly that the
  judgment criteria were not assessed, so nobody mistakes a missing review for a
  clean one.

[REQUIREMENTS.md](REQUIREMENTS.md) has the full 38-criterion matrix and states
which criteria are automated, partial, or manual.

## Getting started

Requires Node.js 20.12+ (for `--env-file-if-exists`).

```bash
npm install
npx playwright install chromium
```

To enable the Claude review stage, put an [Anthropic API key](https://console.anthropic.com/settings/keys)
in a `.env` file at the project root — both `npm start` and `npm run scan` load it
automatically:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Without it the four deterministic engines still run; the report just states that
the judgment criteria were not assessed.

### Web UI

```bash
npm start
# → http://localhost:3000
```

Enter a URL, run the scan, and download the generated PDF.

Enter a URL to scan one page, or tick **Crawl the whole site from its sitemap**
to audit every page the sitemap lists. Either way you get an HTML report and a
downloadable PDF.

### CLI

```bash
# One page
npm run scan -- https://example.com

# The whole site, from its sitemap
npm run scan -- https://example.com --sitemap --limit 20

# Skip the Claude stage (one API call per page adds up on a large crawl)
npm run scan -- https://example.com --sitemap --no-ai
```

Both modes write an HTML **and** a PDF report to `reports/`.

## Sitemap crawl

Give it any URL on the site. It finds the sitemap the way a crawler would —
`robots.txt` first, then the conventional locations (`/sitemap.xml`,
`/sitemap_index.xml`, `/wp-sitemap.xml`, …) — follows sitemap *indexes* down to
the page URLs, keeps only same-origin pages, and scans them with one shared
Chromium instance, three at a time.

The site report leads with the question a per-page report can't answer: **which
single fix clears the most pages?** Findings are grouped by rule and ranked by
reach, because a problem on 9 of 10 pages lives in a shared header, nav, or
template.

```
Top issues by reach
   3 pages · moderate  <img> is missing required "src" attribute
   2 pages · serious   Elements must meet minimum color contrast ratio thresholds
   1 pages · moderate  Zooming and scaling must not be disabled
```

Below that, the report drops into collapsible per-page detail with the exact
elements and code.

Notes on behaviour:

- **A dead URL doesn't sink the crawl.** Pages that fail to load are listed in a
  "could not be scanned" block; the rest still get reported.
- **No sitemap is a normal answer, not a crash.** You get a plain message saying
  where it looked.
- `--limit` defaults to **10** and caps at 100. The report states when the sitemap
  had more pages than were scanned, so a capped crawl is never mistaken for a
  complete one.

## How a scan works

1. Playwright loads the page in headless Chromium (1366×900) and waits for it to settle.
2. axe-core analyzes the live page; the DOM snapshot is captured *before* HTML_CodeSniffer
   injects its script, so the markup passed to `html-validate` is the page's own.
3. Claude receives that same markup plus the criteria the rule engines already flagged,
   and judges the manual checklist against it. See [src/ai-review.js](src/ai-review.js).
4. All five engines' findings are normalized to a common shape — engine, status
   (`violation` / `review`), impact, success criterion, affected elements.
5. Findings are deduplicated by *criterion + element*, keeping the most authoritative
   engine's wording (axe first, Claude last). See `dedupeFindings` in [src/scanner.js](src/scanner.js).
6. Each finding is enriched with a plain-English description and a concrete fix,
   then rendered to HTML and printed to PDF.

## Project layout

```
src/
  server.js           Express app + POST /api/scan, /api/scan-site
  cli.js              Command-line entry point
  scanner.js          Orchestrates the engines on one page, dedupes, summarizes
  sitemap.js          Sitemap discovery (robots.txt → conventional paths) + parsing
  crawler.js          Scans every sitemap page, aggregates site-wide totals
  engines.js          HTML_CodeSniffer, html-validate, custom DOM checks
  ai-review.js        Claude review of the judgment-based criteria
  guidance.js         Plain-English descriptions and fixes per rule
  manual-checklist.js WCAG 2.0 AA criteria that require human review
  report.js           HTML report templates (page + site) and PDF rendering
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
  "engines": ["axe-core", "HTML_CodeSniffer", "html-validate", "checks", "claude"],
  "summary": {
    "violations": 14,
    "review": 9,
    "byImpact": { "critical": 2 },
    "ai": { "checked": 23, "passed": 12, "notApplicable": 6, "findings": [] }
  },
  "reportPdfUrl": "/reports/example.com-2026-07-13.pdf"
}
```

`POST /api/scan-site` with `{ "url": "https://example.com", "limit": 20 }` crawls the
sitemap and returns site-wide totals, the issues ranked by reach, a per-page
summary, any pages that failed, and links to both reports. A crawl takes minutes,
not seconds — the request stays open for its duration.

`GET /api/health` → `{ "ok": true }`

## Scope

Sitemap mode audits every page the sitemap lists, but each page is still judged on
its own. The three criteria that require *comparing* pages — 2.4.5 Multiple Ways,
3.2.3 Consistent Navigation, 3.2.4 Consistent Identification — are not yet
implemented and remain on the manual checklist. The crawler now provides the
multi-page data they need, so they are the natural next addition.
