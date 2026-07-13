# Accessibility Scanner

Enter a URL, scan the page against **WCAG 2.0 Level AA**, and get back an HTML/PDF
report that lists every issue, the element it affects, and how to fix it.

The scanner runs four engines over the rendered page and merges the results, so a
problem found by more than one engine is reported once — not four times.

## What it checks

| Engine | Role |
|--------|------|
| **axe-core** (`@axe-core/playwright`) | Primary automated engine, filtered to the `wcag2a` + `wcag2aa` tags |
| **Siteimprove Alfa** (`@siteimprove/alfa-*`) | The **W3C ACT Rules** reference implementation — see below |
| **HTML_CodeSniffer** | Second opinion using the W3C-derived WCAG2AA ruleset — widens coverage of 1.3.1 and 3.3.x |
| **html-validate** | Markup validity, which is what SC **4.1.1 Parsing** actually asks for |
| **Interaction checks** | The things a rule engine *can't* see, because they require driving the page — see below |
| **DOM checks** | Autoplaying media (1.4.2), `meta refresh` (2.2.1), `blink`/`marquee` (2.2.2), ambiguous link text (2.4.4), skipped heading levels (2.4.6) |
| **Claude** (`claude-opus-4-8`) | Returns a verdict on **all 38** WCAG 2.0 AA criteria and settles everything the rule engines couldn't decide — see below |

### Siteimprove Alfa — the normative engine

Alfa implements the **W3C's own ACT Rules** (Accessibility Conformance Testing).
That makes it the closest thing to a normative automated engine: where Alfa and axe
disagree, Alfa is the one that traces back to the standard. It runs against the
**live DOM** through Playwright, not a parsed HTML string, so contrast, focus and
visibility are decided on the browser's real computed styles rather than a
re-implementation of them.

Two details worth knowing:

- Alfa also ships **AAA and WCAG 2.1** rules. Those are filtered out — failing a page
  against a criterion it was never measured against would overstate the result. Scope
  is enforced by `inScope()` in [src/wcag.js](src/wcag.js), the single source of truth
  for the 38-criterion matrix.
- Alfa reports **`CantTell`** honestly instead of silently passing. Those are precisely
  the items the Claude stage then settles.

### Claude: a verdict on everything, nothing left manual

Rule engines emit "needs review" when they hit the limit of what markup can prove.
Left alone, those become a manual to-do list — which is exactly what you don't want
from an automated scan.

With an API key, Claude does two jobs:

1. **Returns a verdict on all 38 WCAG 2.0 AA criteria** — violation, pass, or not
   applicable. "Needs review" is not an available answer.
2. **Settles every unresolved item** the engines flagged. Each becomes a real
   violation (the suspicion was right) or is dropped (a false positive).

The result is a report with **no manual leftovers**. Uncertainty is not hidden — it's
expressed as a **confidence level on the answer** rather than a refusal to answer, and
low-confidence verdicts are chipped in the report so you know which ones to
double-check by hand.

Without a key, everything still runs; unresolved items just stay as "needs review".

### Interaction checks — the gap most scanners leave open

axe and HTML_CodeSniffer read a static DOM snapshot. They cannot press Tab, cannot
zoom the viewport, and cannot tell whether focusing an element changes how it looks.
Those are exactly the criteria people assume are covered and aren't.
[src/interaction-checks.js](src/interaction-checks.js) covers them by actually
operating the page:

| Check | SC | How |
|---|---|---|
| **Keyboard reachability** | 2.1.1 | Elements that respond to a click but that Tab can never reach (a `<div onclick>` with no `tabindex`) |
| **Keyboard traps** | 2.1.2 | A real Tab walk; if focus refuses to advance three times running, it's a trap |
| **Visible focus** | 2.4.7 | Each element's computed style is captured *unfocused*, then compared while focused via a genuine Tab press — programmatic `.focus()` wouldn't do, because `:focus-visible` only applies to keyboard focus |
| **Focus order** | 2.4.3 | The Tab sequence is compared against DOM order; positive `tabindex` is flagged outright |
| **Zoom / reflow at 200%** | 1.4.4 | The page is re-rendered at half the viewport width — which is what 200% zoom actually does to a layout — and checked for sideways scrolling and text clipped by fixed heights |
| **Colour alone** | 1.4.1 | Links inside running prose that differ from the surrounding text in colour and *nothing else* — no underline, weight, or border |
| **Form errors** | 3.3.1 | `aria-invalid="true"` with no error text: a screen reader announces "invalid" and nothing more |
| **Form instructions** | 3.3.2 | Required fields with a format rule but no stated rule; radio/checkbox groups with no `fieldset`/`legend` |

Every report also opens with a **"What this scan validated"** table listing each of
these areas, the criteria it maps to, and — just as importantly — where automation
stops and a human has to take over.

### Steps to reproduce, and screenshots

Every violation carries **numbered steps to reproduce**, written per issue type
([src/steps.js](src/steps.js)) — which key to press, what to look at, what you
should have seen instead:

> 1. Open `https://example.com`.
> 2. Click once in the address bar, then press Tab repeatedly. **Do not touch the mouse.**
> 3. Try to reach `div.fake-btn`.
> 4. **Expected:** the control receives focus and can be activated with Enter or Space.
> 5. **Actual:** Tab never reaches it. The control works on click only, so a keyboard-only user cannot operate it at all.

Violations also carry a **screenshot of the offending element**, captured on a clean
page and embedded as a data URI — so the HTML report stays a single self-contained
file you can email, and the PDF carries the images too.

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

The Claude review stage needs an [Anthropic API key](https://console.anthropic.com/settings/keys).
Supply it either way:

- **In the browser** — tick **Validate with Claude AI** and paste the key. Hit
  **Validate key** and it is checked against the API before any scan starts, so a
  bad key fails in a second rather than after a ten-minute crawl. The key is used
  for that request only: never written to disk, never logged.
- **On the server** — put it in a `.env` file at the project root. Both `npm start`
  and `npm run scan` load it automatically, and the browser field then becomes
  optional.

```
ANTHROPIC_API_KEY=sk-ant-...
```

Without a key the four deterministic engines still run; the report just states
that the judgment criteria were not assessed.

### Web UI

```bash
startnpm 
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

## The report

The report is organized the way you'd act on it, not the way the tool produced it.

**It opens with a verdict, in one sentence.** WCAG is cumulative — Level AA
conformance requires every Level A criterion *as well*. So a single Level A
failure means the page conforms at **no** level, AA included. The report says that
outright rather than leaving you to infer it from a violation count:

> **Does not conform to WCAG 2.0 — Level A failures found**
> 6 Level A criteria are failing. Level A is the minimum bar, so the page currently
> conforms at no level — not A, and not AA. Fix the Level A items first.

**Every finding carries its conformance level.** A `Level A` or `Level AA` chip sits
on each issue, in the at-a-glance index, and in the site-wide table, alongside a
"Conformance by level" breakdown. That mapping (all 50 WCAG 2.0/2.1 success
criteria) lives in `SC_LEVELS` in [src/engines.js](src/engines.js).

**Issues are grouped by severity, Level A first within each group.** Severity
(critical → serious → moderate → minor) is how badly a *user* is affected; level is
what *conformance* depends on. They're independent — a Level A issue can be
"moderate" and still be the one thing blocking conformance — so the report shows
both and sorts by both.

Each issue then gives you: what it is, the success criterion, **why it matters**,
**how to fix it**, which engine found it, and the exact offending elements with
their code.

**None of this needs an API key.** The verdict, levels, severity ranking, and
per-element detail all come from the deterministic engines. Claude adds the
judgment-based criteria on top when a key is present — and when it isn't, the
report states plainly that those criteria were *not assessed*, so a missing review
is never mistaken for a pass.

## Sitemap crawl

Give it any URL on the site. The sitemap can come from three places:

| Source | When to use it |
|--------|----------------|
| **Find it automatically** (default) | Normal sites. Reads `robots.txt`, then probes `/sitemap.xml`, `/sitemap_index.xml`, `/wp-sitemap.xml`, … |
| **Sitemap URL** | The sitemap exists but lives somewhere non-standard |
| **Upload a file** | Staging sites, sitemaps behind auth, or a hand-picked list of pages |

Whichever it uses, it follows sitemap *indexes* down to the page URLs (gzipped
sitemaps included), keeps only same-origin pages, and scans them with one shared
Chromium instance, three at a time. If you upload a sitemap for a *different*
site than the URL you typed, it says so rather than quietly auditing someone
else's pages.

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

`POST /api/validate-key` with `{ "apiKey": "sk-ant-..." }` checks a key against the
Models endpoint — it authenticates the key and confirms model access **without
spending a token**. Returns `{ ok: true, model }` or `{ ok: false, error }`.

`GET /api/config` → `{ "hasServerKey": true|false }`, so the UI can tell you whether
the key field is optional.

`GET /api/health` → `{ "ok": true }`

## Scope

Sitemap mode audits every page the sitemap lists, but each page is still judged on
its own. The three criteria that require *comparing* pages — 2.4.5 Multiple Ways,
3.2.3 Consistent Navigation, 3.2.4 Consistent Identification — are not yet
implemented and remain on the manual checklist. The crawler now provides the
multi-page data they need, so they are the natural next addition.
