# Accessibility Scanner — WCAG 2.0 AA Validation Requirements

Aligned to the **W3C WAI** normative material: the **WCAG 2.0** standard and the
**W3C ACT Rules** (Accessibility Conformance Testing). This document lists the
validations the scanner must perform and the packages needed to perform them.
No code or assets are taken from `w3c/wai-website` — only the requirements.

---

## 1. Scope

- **Standard:** WCAG 2.0, conformance **Level AA** (= all Level **A** + Level **AA** success criteria).
- **Total success criteria to validate: 38** (25 at Level A, 13 at Level AA).
- **Testing model:** automated where W3C ACT Rules allow, plus a **manual-review
  checklist** for criteria that cannot be reliably automated (these must be
  *surfaced as "needs review"*, never silently passed).

---

## 2. Current coverage (today)

The scanner runs **axe-core** filtered to tags `wcag2a` + `wcag2aa`. That covers
the *automatable subset* of ~10–12 success criteria (alt text, ARIA validity,
contrast, document title, page language, headings, labels, bypass blocks…).
It does **not** yet cover: HTML validity (4.1.1), media checks (1.2.x), and the
large set of judgment-based criteria. Those are the gaps below.

---

## 3. Required validations — full WCAG 2.0 AA matrix

Legend — **Auto** = fully automatable · **Partial** = automated check + human confirmation · **Manual** = human review only.

### Principle 1 — Perceivable

| SC | Name | Level | Type | Status today | Validation to add / package |
|----|------|-------|------|--------------|------------------------------|
| 1.1.1 | Non-text Content (alt text) | A | Partial | ✅ axe (`image-alt`, `input-image-alt`, `area-alt`, `object-alt`, `svg-img-alt`) | Add "alt is *meaningful*" manual flag |
| 1.2.1 | Audio-only / Video-only (Prerecorded) | A | Manual | ❌ | Media inventory + manual checklist |
| 1.2.2 | Captions (Prerecorded) | A | Manual | ❌ | Detect `<video>`/`<track kind=captions>`; flag for review |
| 1.2.3 | Audio Description / Media Alternative | A | Manual | ❌ | Media checklist |
| 1.2.4 | Captions (Live) | AA | Manual | ❌ | Media checklist |
| 1.2.5 | Audio Description (Prerecorded) | AA | Manual | ❌ | Media checklist |
| 1.3.1 | Info & Relationships (semantic structure) | A | Partial | ⚠️ partial axe (`list`, `th-has-data-cells`, `td-headers-attr`, `label`, `aria-required-children`) | Add HTML_CodeSniffer + Alfa rules for fuller coverage |
| 1.3.2 | Meaningful Sequence | A | Manual | ❌ | DOM-order vs visual-order review flag |
| 1.3.3 | Sensory Characteristics | A | Manual | ❌ | Manual checklist |
| 1.4.1 | Use of Color | A | Manual | ❌ | Manual checklist (color-only meaning) |
| 1.4.2 | Audio Control | A | Partial | ❌ | Detect autoplaying audio (`no-autoplay-audio`) |
| 1.4.3 | Contrast (Minimum) | AA | Partial | ✅ axe (`color-contrast`) | Keep; surface "needs review" for gradients/images-of-text |
| 1.4.4 | Resize Text (to 200%) | AA | Partial | ❌ | Add zoom/reflow check (Playwright 200% zoom + overflow detection) |
| 1.4.5 | Images of Text | AA | Manual | ❌ | Manual checklist |

### Principle 2 — Operable

| SC | Name | Level | Type | Status today | Validation to add / package |
|----|------|-------|------|--------------|------------------------------|
| 2.1.1 | Keyboard | A | Partial | ⚠️ partial | Add keyboard-trap/focusable checks (Alfa, scripted Tab walk) |
| 2.1.2 | No Keyboard Trap | A | Manual | ❌ | Scripted focus-cycle detection |
| 2.2.1 | Timing Adjustable | A | Partial | ❌ | Detect `<meta http-equiv=refresh>` (`meta-refresh`) |
| 2.2.2 | Pause, Stop, Hide | A | Partial | ❌ | Detect `blink`/`marquee`/auto-updating regions |
| 2.3.1 | Three Flashes or Below Threshold | A | Manual | ❌ | Manual checklist |
| 2.4.1 | Bypass Blocks (skip link / landmarks) | A | Auto | ✅ axe (`bypass`, `region`) | Covered |
| 2.4.2 | Page Titled | A | Auto | ✅ axe (`document-title`) | Covered |
| 2.4.3 | Focus Order | A | Manual | ❌ | Tab-order review flag |
| 2.4.4 | Link Purpose (In Context) | A | Partial | ✅ axe (`link-name`) | Add ambiguous-link-text heuristic ("click here") |
| 2.4.5 | Multiple Ways | AA | Partial | ❌ | Detect site search + nav/sitemap presence |
| 2.4.6 | Headings and Labels | AA | Partial | ⚠️ partial axe (`empty-heading`) | Add heading-hierarchy + label-quality checks |
| 2.4.7 | Focus Visible | AA | Partial | ❌ | Scripted focus + outline/style detection (Alfa) |

### Principle 3 — Understandable

| SC | Name | Level | Type | Status today | Validation to add / package |
|----|------|-------|------|--------------|------------------------------|
| 3.1.1 | Language of Page | A | Auto | ✅ axe (`html-has-lang`, `html-lang-valid`) | Covered |
| 3.1.2 | Language of Parts | AA | Partial | ✅ axe (`valid-lang`) | Covered (partial) |
| 3.2.1 | On Focus (no context change) | A | Manual | ❌ | Manual checklist |
| 3.2.2 | On Input (no context change) | A | Manual | ❌ | Manual checklist |
| 3.2.3 | Consistent Navigation | AA | Manual | ❌ | Multi-page comparison (needs crawler) |
| 3.2.4 | Consistent Identification | AA | Manual | ❌ | Multi-page comparison (needs crawler) |
| 3.3.1 | Error Identification | A | Partial | ❌ | Form error-handling checks (Alfa / HTML_CodeSniffer) |
| 3.3.2 | Labels or Instructions | A | Partial | ✅ axe (`label`, `select-name`) | Add fieldset/instruction checks |
| 3.3.3 | Error Suggestion | AA | Manual | ❌ | Manual checklist |
| 3.3.4 | Error Prevention (Legal/Financial/Data) | AA | Manual | ❌ | Manual checklist |

### Principle 4 — Robust

| SC | Name | Level | Type | Status today | Validation to add / package |
|----|------|-------|------|--------------|------------------------------|
| 4.1.1 | Parsing (valid HTML) | A | Auto | ⚠️ partial axe (`duplicate-id`) | **Add HTML validator** (Nu Html Checker via `vnu-jar`, or `html-validate`) |
| 4.1.2 | Name, Role, Value | A | Partial | ✅ axe (`button-name`, `link-name`, `aria-*`) | Covered (partial); deepen with Alfa ACT rules |

---

## 4. Gap summary — what must be ADDED

**A. New automated validations (codeable now):**
1. **HTML validity / parsing (4.1.1)** — run an HTML validator.
2. **Auto-playing audio (1.4.2)** and **meta-refresh timing (2.2.1)**.
3. **`blink`/`marquee` / auto-updating content (2.2.2)**.
4. **Text resize / 200% zoom reflow (1.4.4)** — Playwright re-render at zoom and detect clipping/overflow.
5. **Keyboard focus checks (2.1.1, 2.1.2, 2.4.7)** — scripted Tab traversal + focus-visible detection.
6. **Ambiguous link text heuristic (2.4.4)** and **heading-hierarchy (2.4.6)**.
7. **Second engine cross-check** — run HTML_CodeSniffer (WCAG2AA) and/or Alfa (ACT Rules) and merge, to widen 1.3.1 / 3.3.x coverage.

**B. Manual-review checklist (must be surfaced as "needs review", not passed):**
- All media criteria: 1.2.1–1.2.5
- 1.3.2, 1.3.3, 1.4.1, 1.4.5
- 2.3.1, 2.4.3
- 3.2.1, 3.2.2, 3.3.3, 3.3.4

**C. Requires multi-page crawl (out of single-page scope):**
- 2.4.5 Multiple Ways, 3.2.3 Consistent Navigation, 3.2.4 Consistent Identification.

---

## 5. Packages to add

| Package | Purpose | Covers |
|---------|---------|--------|
| `@axe-core/playwright`, `axe-core` *(already installed)* | Primary automated engine | Core A/AA auto rules |
| `pa11y` **or** `html_codesniffer` | Second engine; W3C-derived **WCAG2AA** ruleset | Extra 1.3.1, 1.4.x, 3.3.x heuristics |
| `@siteimprove/alfa-rules`, `@siteimprove/alfa-playwright`, `@siteimprove/alfa-act`, `@siteimprove/alfa-wcag` | **W3C ACT Rules** reference implementation (closest to WAI) | 2.1.x, 2.4.7, 4.1.2 depth |
| `vnu-jar` (Nu Html Checker) **or** `html-validate` | HTML/markup validation | **4.1.1 Parsing** |
| `lighthouse` *(optional)* | Extra automated audits + 0–100 score | Cross-check + scoring |

**Install (recommended minimal set):**
```bash
npm install pa11y vnu-jar
# optional deeper / W3C ACT alignment:
npm install @siteimprove/alfa-rules @siteimprove/alfa-playwright @siteimprove/alfa-act @siteimprove/alfa-wcag
# optional scoring:
npm install lighthouse
```
> Note: `vnu-jar` needs a Java runtime; `html-validate` is pure-JS if you want to avoid Java.

---

## 6. Coverage outcome

- **Today:** ~10–12 of 38 criteria automatically checked (axe only).
- **After section 4.A + packages:** ~18–22 criteria with automated/partial checks.
- **Remaining ~16:** genuinely manual — the tool's job is to *list them as a
  reviewer checklist per scan*, so the report reflects true WCAG 2.0 AA scope
  instead of implying the page is conformant from automated checks alone.
