import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {
  runHtmlcs,
  normalizeHtmlcs,
  runHtmlValidate,
  normalizeHtmlValidate,
  runExtraChecks,
  normalizeExtraChecks,
  scFromAxeTags,
  scLevel
} from './engines.js';
import {
  runKeyboardChecks,
  runMouseOnlyChecks,
  runColorOnlyChecks,
  runFormChecks,
  runZoomChecks,
  normalizeKeyboard,
  normalizeColorOnly,
  normalizeForms,
  normalizeZoom
} from './interaction-checks.js';
import { runAlfa, normalizeAlfa, ALFA_ENGINE } from './alfa.js';
import { stepsFor } from './steps.js';
import { captureFindingShots } from './screenshots.js';
import { fillGuidance } from './guidance.js';
import { runClaudeReview, AI_ENGINE } from './ai-review.js';

// WCAG 2.0 AA = axe-core tags "wcag2a" (Level A) + "wcag2aa" (Level AA).
export const WCAG_20_AA_TAGS = ['wcag2a', 'wcag2aa'];
export const DEFAULT_TAGS = [...WCAG_20_AA_TAGS];
export const WCAG_LEVEL_LABEL = 'WCAG 2.0 AA';
export const ENGINES = [
  'axe-core',
  ALFA_ENGINE,
  'HTML_CodeSniffer',
  'html-validate',
  'checks',
  AI_ENGINE
];

// Engines overlap heavily — axe-core, Alfa, and HTML_CodeSniffer all flag the same
// WCAG criterion on the same element. This priority decides whose version of a
// duplicated finding survives (lower = more authoritative).
//
// Alfa sits directly behind axe: its rules ARE the W3C ACT rules, so its wording
// traces back to the standard. But axe's messages are the more actionable of the
// two, so where they collide on the same element, axe's phrasing wins and Alfa
// contributes the criteria axe never reaches. Claude is last — it settles what the
// rule engines could not, so wherever a rule engine has a definite answer, that
// answer stands.
const ENGINE_PRIORITY = {
  'axe-core': 0,
  [ALFA_ENGINE]: 1,
  'HTML_CodeSniffer': 2,
  'html-validate': 3,
  'checks': 4,
  [AI_ENGINE]: 5
};

function normHtml(html = '') {
  return String(html).replace(/\s+/g, ' ').trim().slice(0, 200);
}

// Identity of one reported element for a given criterion: what the problem is
// (success criterion) and where it is (the element). Two engines flagging the
// same criterion on the same element produce the same key.
function nodeKey(f, node) {
  const what = f.sc || f.ruleId || f.title;
  const where = normHtml(node.html) || node.selector;
  return `${what}::${where}`;
}

/**
 * Remove duplicate issues across engines so each problem is reported once.
 *
 * axe-core and HTML_CodeSniffer especially flag the same WCAG criterion on the
 * same element with different wording. We process findings from the most
 * authoritative engine first; for each criterion + element we keep it only the
 * first time it appears. A node already reported by another engine is dropped,
 * and a finding left with no elements is dropped entirely.
 *
 * Distinct findings from the *same* engine are preserved — one element can have
 * several different problems under one criterion — so no real issue is lost.
 */
export function dedupeFindings(findings) {
  const ordered = [...findings].sort(
    (a, b) => (ENGINE_PRIORITY[a.engine] ?? 9) - (ENGINE_PRIORITY[b.engine] ?? 9)
  );
  const ownerByKey = new Map();   // `${criterion}::${element}` -> owning engine
  const seenNodeless = new Set(); // criterion-level findings with no element
  const result = [];

  for (const f of ordered) {
    // Findings with no element (e.g. "page has no <h1>") dedupe by rule.
    if (!f.nodes.length) {
      const key = `${f.status}::${f.sc || f.ruleId || f.title}::${f.ruleId}`;
      if (seenNodeless.has(key)) continue;
      seenNodeless.add(key);
      result.push(f);
      continue;
    }

    const localSeen = new Set();
    const freshNodes = [];
    for (const node of f.nodes) {
      const key = nodeKey(f, node);
      if (localSeen.has(key)) continue;          // same element twice in one finding
      const owner = ownerByKey.get(key);
      if (owner && owner !== f.engine) continue; // another engine already reported it
      localSeen.add(key);
      if (!owner) ownerByKey.set(key, f.engine);
      freshNodes.push(node);
    }
    if (!freshNodes.length) continue; // every element already covered elsewhere
    result.push(freshNodes.length === f.nodes.length ? f : { ...f, nodes: freshNodes });
  }
  return result;
}

function normalizeAxe(results) {
  const toFinding = (v, status, impact) => ({
    engine: 'axe-core',
    status,
    impact,
    ruleId: v.id,
    sc: scFromAxeTags(v.tags),
    title: v.help,
    description: v.description,
    helpUrl: v.helpUrl,
    nodes: v.nodes.map((n) => ({
      selector: n.target.join(', '),
      html: n.html,
      summary: n.failureSummary || ''
    }))
  });

  return [
    ...results.violations.map((v) => toFinding(v, 'violation', v.impact || 'minor')),
    ...results.incomplete.map((v) => toFinding(v, 'review', 'review'))
  ];
}

// The zoom check halves this width to simulate 200% zoom, and screenshots are
// taken at it, so every part of the scan agrees on what "the viewport" means.
const VIEWPORT = { width: 1366, height: 900 };

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export function launchBrowser() {
  return chromium.launch({ headless: true });
}

/**
 * Fold Claude's rulings back into the engines' findings.
 *
 * A rule engine emits "needs review" when it hits the limit of what markup can
 * prove — it has a suspicion it cannot confirm. Left alone, those become a manual
 * to-do list. Claude settles each one, and this applies the ruling:
 *
 *   - "violation" → the suspicion was right. The item becomes a real failure,
 *     carrying Claude's reasoning and fix, and the engine that spotted it keeps
 *     the credit.
 *   - "pass"      → it was a false positive. The item is dropped entirely.
 *
 * An item Claude did not rule on stays exactly as the engine left it, as a review
 * item. Silently promoting or dropping it would be inventing a verdict nobody gave.
 */
function applyAdjudications(findings, adjudications = []) {
  if (!adjudications.length) return findings;

  const ruling = new Map(adjudications.map((a) => [a.finding, a]));
  const out = [];

  for (const f of findings) {
    const verdict = ruling.get(f);
    if (!verdict) {
      out.push(f);
      continue;
    }

    if (verdict.verdict === 'pass') continue; // false positive — drop it

    out.push({
      ...f,
      status: 'violation',
      impact: verdict.impact || 'moderate',
      description: verdict.reasoning || f.description,
      fix: verdict.fix || f.fix,
      confidence: verdict.confidence,
      adjudicated: true
    });
  }

  return out;
}

/**
 * Scan one URL using an already-running browser.
 *
 * A sitemap crawl scans many pages in a row; launching Chromium per page would
 * dominate the run time, so the crawler owns the browser and passes it in here.
 * Each page still gets its own context, so no cookies or storage leak between
 * pages.
 *
 * @returns {Promise<object>} combined, normalized scan result.
 */
export async function scanWithBrowser(browser, url, options = {}) {
  const tags = options.tags || DEFAULT_TAGS;
  const timeout = options.timeout || 60000;

  const context = await browser.newContext({
    viewport: VIEWPORT,
    userAgent: USER_AGENT
  });

  try {
    const page = await context.newPage();

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForTimeout(3500);

    const title = await page.title();
    const finalUrl = page.url();

    // Order matters. axe first on the pristine DOM, then the HTML snapshot, then
    // the interaction checks (which type into the page and move focus around),
    // and only then HTML_CodeSniffer — HTMLCS injects its own <script> into the
    // document, so anything that reads the page's own markup must run before it.
    const axeResults = await new AxeBuilder({ page }).withTags(tags).analyze();
    const alfaOutcomes = await runAlfa(page);
    const html = await page.content();
    const extraRaw = await runExtraChecks(page);
    const colorOnlyRaw = await runColorOnlyChecks(page);
    const formsRaw = await runFormChecks(page);
    const mouseOnlyRaw = await runMouseOnlyChecks(page);

    // The Tab walk is last of the on-page checks: it leaves focus somewhere and
    // tags elements with data-a11y-idx, so nothing that reads the DOM should
    // follow it.
    const keyboardRaw = await runKeyboardChecks(page);

    // 200% zoom needs its own page at half the viewport width.
    const zoomRaw = await runZoomChecks(context, finalUrl, VIEWPORT).catch(() => ({
      horizontalScroll: false,
      overflowWidth: 0,
      spilling: [],
      clipped: []
    }));

    const hvReport = await runHtmlValidate(html);
    const htmlcsRaw = await runHtmlcs(page);

    const alfa = normalizeAlfa(alfaOutcomes);

    const engineFindings = [
      ...normalizeAxe(axeResults),
      ...alfa.findings,
      ...normalizeHtmlcs(htmlcsRaw),
      ...normalizeHtmlValidate(hvReport),
      ...normalizeExtraChecks(extraRaw),
      ...normalizeKeyboard(keyboardRaw, mouseOnlyRaw),
      ...normalizeColorOnly(colorOnlyRaw),
      ...normalizeForms(formsRaw),
      ...normalizeZoom(zoomRaw)
    ];

    // Claude runs last: it returns a verdict on the whole standard and settles
    // everything the rule engines left undecided. A crawl can turn it off — one
    // API call per page adds up across a large sitemap.
    const aiReview =
      options.ai === false
        ? {
            findings: [],
            adjudications: [],
            checked: 0,
            passed: 0,
            notApplicable: 0,
            resolved: 0,
            lowConfidence: 0,
            skipped: 'AI review disabled'
          }
        : await runClaudeReview({
            url: finalUrl,
            title,
            html,
            findings: engineFindings,
            apiKey: options.apiKey
          });

    const settled = applyAdjudications(engineFindings, aiReview.adjudications);

    const findings = dedupeFindings(
      [...settled, ...aiReview.findings].map((f) => {
        const g = fillGuidance(f);
        return {
          ...f,
          level: scLevel(f.sc),
          description: g.description,
          fix: g.fix,
          steps: stepsFor(f, finalUrl)
        };
      })
    );

    // Screenshots go last: they need the final, deduped findings, and they need a
    // clean page (this one now has HTMLCS injected into it).
    const shots =
      options.screenshots === false
        ? 0
        : await captureFindingShots(context, finalUrl, findings, { viewport: VIEWPORT });

    return {
      url,
      finalUrl,
      title,
      level: WCAG_LEVEL_LABEL,
      engines: ENGINES,
      generatedAt: new Date().toISOString(),
      findings,
      aiReview,
      screenshots: shots,
      axePasses: axeResults.passes.length
    };
  } finally {
    await context.close();
  }
}

/**
 * Scan a single URL, launching and disposing of a browser for it.
 */
export async function scanUrl(url, options = {}) {
  const browser = await launchBrowser();
  try {
    return await scanWithBrowser(browser, url, options);
  } finally {
    await browser.close();
  }
}

/**
 * Roll a scan up into the headline numbers shown in the report and UI.
 *
 * `byLevel` and `conformance` are the numbers that actually answer "did we
 * pass". WCAG is cumulative: Level AA conformance requires every Level A
 * criterion *and* every Level AA one. So a single Level A failure means the page
 * conforms at no level at all — which is why the two are counted separately
 * instead of being lumped into one violation total.
 */
export function summarize(scan) {
  const byImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const byLevel = { A: { violations: 0, review: 0 }, AA: { violations: 0, review: 0 } };
  const byEngine = {};
  let violations = 0;
  let review = 0;
  let affectedElements = 0;

  for (const f of scan.findings) {
    byEngine[f.engine] = (byEngine[f.engine] || 0) + 1;
    const level = byLevel[f.level];

    if (f.status === 'violation') {
      violations += 1;
      affectedElements += f.nodes.length;
      if (byImpact[f.impact] !== undefined) byImpact[f.impact] += 1;
      if (level) level.violations += 1;
    } else {
      review += 1;
      if (level) level.review += 1;
    }
  }

  const conformance = byLevel.A.violations
    ? 'fails-a'
    : byLevel.AA.violations
      ? 'fails-aa'
      : 'no-failures';

  return {
    violations,
    review,
    affectedElements,
    byImpact,
    byLevel,
    conformance,
    byEngine,
    passes: scan.axePasses,
    ai: scan.aiReview || null
  };
}
