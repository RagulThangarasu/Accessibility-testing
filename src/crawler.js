import {
  launchBrowser,
  scanWithBrowser,
  summarize,
  ENGINES,
  WCAG_LEVEL_LABEL
} from './scanner.js';
import { discoverSitemaps, collectSitemapUrls } from './sitemap.js';
import { scName } from './engines.js';

export const DEFAULT_PAGE_LIMIT = 10;
export const MAX_PAGE_LIMIT = 100;
const DEFAULT_CONCURRENCY = 3;

/**
 * Roll every page's findings up into one site-level view.
 *
 * The per-page numbers answer "is this page broken". The interesting question
 * for a whole site is different: which single problem, if fixed once, would
 * clear the most pages? That's what `issues` is for — findings grouped by rule,
 * carrying how many pages each one affects.
 */
function aggregate(pages) {
  const totals = {
    pages: pages.length,
    violations: 0,
    review: 0,
    affectedElements: 0,
    byImpact: { critical: 0, serious: 0, moderate: 0, minor: 0 },
    byEngine: {},
    passes: 0,
    ai: { checked: 0, passed: 0, notApplicable: 0, flagged: 0, skipped: null }
  };

  const issues = new Map();
  const skipReasons = new Set();

  for (const page of pages) {
    const s = page.summary;
    totals.violations += s.violations;
    totals.review += s.review;
    totals.affectedElements += s.affectedElements;
    totals.passes += s.passes;
    for (const k of Object.keys(totals.byImpact)) totals.byImpact[k] += s.byImpact[k];
    for (const [engine, n] of Object.entries(s.byEngine)) {
      totals.byEngine[engine] = (totals.byEngine[engine] || 0) + n;
    }

    if (s.ai?.skipped) {
      skipReasons.add(s.ai.skipped);
    } else if (s.ai) {
      totals.ai.checked += s.ai.checked;
      totals.ai.passed += s.ai.passed;
      totals.ai.notApplicable += s.ai.notApplicable;
      totals.ai.flagged += s.ai.findings.length;
    }

    for (const f of page.findings) {
      const key = `${f.engine}::${f.ruleId}`;
      let entry = issues.get(key);
      if (!entry) {
        entry = {
          ruleId: f.ruleId,
          engine: f.engine,
          sc: f.sc,
          scLabel: f.sc ? `${f.sc} — ${scName(f.sc) || 'unnamed'}` : 'Not mapped',
          title: f.title,
          status: f.status,
          impact: f.impact,
          description: f.description,
          fix: f.fix,
          pages: [],
          elements: 0
        };
        issues.set(key, entry);
      }
      entry.pages.push({ url: page.finalUrl || page.url, title: page.title, nodes: f.nodes.length });
      entry.elements += f.nodes.length;
    }
  }

  // Every page skipped the AI pass for the same reason (usually no API key) —
  // report it once at the site level rather than per page.
  if (skipReasons.size && totals.ai.checked === 0) {
    totals.ai.skipped = [...skipReasons].join('; ');
  }

  const order = ['critical', 'serious', 'moderate', 'minor', 'review'];
  const ranked = [...issues.values()].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'violation' ? -1 : 1;
    const ai = order.indexOf(a.impact);
    const bi = order.indexOf(b.impact);
    if (ai !== bi) return ai - bi;
    return b.pages.length - a.pages.length;
  });

  return { totals, issues: ranked };
}

/** Run `task` over `items`, at most `n` at a time. */
async function pool(items, n, task) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await task(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Find the site's sitemap, then scan every page it lists (up to `limit`).
 *
 * A page that fails to load is recorded in `failed` and the crawl continues —
 * one dead URL in a sitemap must not throw away the pages already scanned.
 *
 * @param {string} startUrl any URL on the site; its origin is what gets crawled.
 * @param {object} options `limit`, `concurrency`, `ai`, `onProgress`.
 * @returns {Promise<object>} site scan, or `{ error }` if there is no sitemap.
 */
export async function scanSitemap(startUrl, options = {}) {
  const limit = Math.min(Math.max(1, options.limit || DEFAULT_PAGE_LIMIT), MAX_PAGE_LIMIT);
  const concurrency = options.concurrency || DEFAULT_CONCURRENCY;
  const onProgress = options.onProgress || (() => {});
  const origin = new URL(startUrl).origin;

  const sitemaps = await discoverSitemaps(startUrl);
  if (!sitemaps.length) {
    return {
      error:
        `No sitemap found for ${origin}. Looked in robots.txt and at the ` +
        `conventional locations (/sitemap.xml, /sitemap_index.xml, …).`
    };
  }

  const { urls, total, sources } = await collectSitemapUrls(sitemaps, { origin, limit });
  if (!urls.length) {
    return { error: `The sitemap for ${origin} lists no pages on this origin.` };
  }

  const browser = await launchBrowser();
  const pages = [];
  const failed = [];
  let done = 0;

  try {
    await pool(urls, concurrency, async (url) => {
      try {
        const scan = await scanWithBrowser(browser, url, { ai: options.ai });
        pages.push({ ...scan, summary: summarize(scan) });
      } catch (err) {
        failed.push({ url, error: err.message });
      } finally {
        onProgress({ done: ++done, total: urls.length, url });
      }
    });
  } finally {
    await browser.close();
  }

  // Concurrency finishes pages out of order; restore sitemap order so the
  // report reads the way the site is structured.
  pages.sort((a, b) => urls.indexOf(a.url) - urls.indexOf(b.url));

  const { totals, issues } = aggregate(pages);

  return {
    site: origin,
    startUrl,
    sitemaps: sources,
    discovered: total,
    limit,
    level: WCAG_LEVEL_LABEL,
    engines: ENGINES,
    generatedAt: new Date().toISOString(),
    pages,
    failed,
    totals,
    issues
  };
}
