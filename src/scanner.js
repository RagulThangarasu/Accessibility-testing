import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {
  runHtmlcs,
  normalizeHtmlcs,
  runHtmlValidate,
  normalizeHtmlValidate,
  runExtraChecks,
  normalizeExtraChecks,
  scFromAxeTags
} from './engines.js';
import { fillGuidance } from './guidance.js';

// WCAG 2.0 AA = axe-core tags "wcag2a" (Level A) + "wcag2aa" (Level AA).
export const WCAG_20_AA_TAGS = ['wcag2a', 'wcag2aa'];
export const DEFAULT_TAGS = [...WCAG_20_AA_TAGS];
export const WCAG_LEVEL_LABEL = 'WCAG 2.0 AA';
export const ENGINES = ['axe-core', 'HTML_CodeSniffer', 'html-validate', 'checks'];

// Engines overlap heavily — axe-core and HTML_CodeSniffer in particular flag the
// same WCAG criterion on the same element. This priority decides which engine's
// version of a duplicated finding is kept (lower number = more authoritative).
const ENGINE_PRIORITY = {
  'axe-core': 0,
  'HTML_CodeSniffer': 1,
  'html-validate': 2,
  'checks': 3
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

/**
 * Scan a URL with four engines (axe-core, HTML_CodeSniffer, html-validate,
 * plus extra DOM checks), all filtered/oriented to WCAG 2.0 AA.
 *
 * @returns {Promise<object>} combined, normalized scan result.
 */
export async function scanUrl(url, options = {}) {
  const tags = options.tags || DEFAULT_TAGS;
  const timeout = options.timeout || 60000;

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForTimeout(3500);

    const title = await page.title();
    const finalUrl = page.url();

    // Run axe first, capture clean HTML, run DOM checks, THEN inject HTMLCS
    // (HTMLCS adds a <script> to the DOM, so capture page HTML before it).
    const axeResults = await new AxeBuilder({ page }).withTags(tags).analyze();
    const html = await page.content();
    const extraRaw = await runExtraChecks(page);
    const hvReport = await runHtmlValidate(html);
    const htmlcsRaw = await runHtmlcs(page);

    const findings = dedupeFindings(
      [
        ...normalizeAxe(axeResults),
        ...normalizeHtmlcs(htmlcsRaw),
        ...normalizeHtmlValidate(hvReport),
        ...normalizeExtraChecks(extraRaw)
      ].map((f) => {
        const g = fillGuidance(f);
        return { ...f, description: g.description, fix: g.fix };
      })
    );

    return {
      url,
      finalUrl,
      title,
      level: WCAG_LEVEL_LABEL,
      engines: ENGINES,
      generatedAt: new Date().toISOString(),
      findings,
      axePasses: axeResults.passes.length
    };
  } finally {
    await browser.close();
  }
}

/**
 * Roll a scan up into the headline numbers shown in the report and UI.
 */
export function summarize(scan) {
  const byImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const byEngine = {};
  let violations = 0;
  let review = 0;
  let affectedElements = 0;

  for (const f of scan.findings) {
    byEngine[f.engine] = (byEngine[f.engine] || 0) + 1;
    if (f.status === 'violation') {
      violations += 1;
      affectedElements += f.nodes.length;
      if (byImpact[f.impact] !== undefined) byImpact[f.impact] += 1;
    } else {
      review += 1;
    }
  }

  return {
    violations,
    review,
    affectedElements,
    byImpact,
    byEngine,
    passes: scan.axePasses
  };
}
