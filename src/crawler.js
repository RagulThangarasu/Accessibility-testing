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
    byLevel: { A: { violations: 0, review: 0 }, AA: { violations: 0, review: 0 } },
    conformance: 'no-failures',
    byEngine: {},
    passes: 0,
    ai: {
      checked: 0,
      passed: 0,
      notApplicable: 0,
      flagged: 0,
      resolved: 0,
      lowConfidence: 0,
      skipped: null
    }
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
    for (const level of ['A', 'AA']) {
      totals.byLevel[level].violations += s.byLevel[level].violations;
      totals.byLevel[level].review += s.byLevel[level].review;
    }
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
      totals.ai.resolved += s.ai.resolved || 0;
      totals.ai.lowConfidence += s.ai.lowConfidence || 0;
    }

    for (const f of page.findings) {
      const key = `${f.engine}::${f.ruleId}`;
      let entry = issues.get(key);
      if (!entry) {
        entry = {
          ruleId: f.ruleId,
          engine: f.engine,
          sc: f.sc,
          level: f.level,
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

  totals.conformance = totals.byLevel.A.violations
    ? 'fails-a'
    : totals.byLevel.AA.violations
      ? 'fails-aa'
      : 'no-failures';

  // Severity first, then Level A ahead of AA, then reach. A Level A issue on 3
  // pages outranks a Level AA issue on 8: the former is what makes the site
  // non-conformant at all.
  const order = ['critical', 'serious', 'moderate', 'minor', 'review'];
  const levelRank = (l) => (l === 'A' ? 0 : l === 'AA' ? 1 : 2);
  const ranked = [...issues.values()].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'violation' ? -1 : 1;
    const oi = order.indexOf(a.impact) - order.indexOf(b.impact);
    if (oi !== 0) return oi;
    const li = levelRank(a.level) - levelRank(b.level);
    if (li !== 0) return li;
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
 * Scan every page a site's sitemap lists (up to `limit`).
 *
 * The sitemap comes from one of three places, in priority order: an uploaded
 * file (`sitemapXml`), an explicit URL (`sitemapUrl`), or auto-discovery via
 * robots.txt and the conventional paths. Supplying it directly is the escape
 * hatch for sites whose sitemap lives somewhere non-standard.
 *
 * A page that fails to load is recorded in `failed` and the crawl continues —
 * one dead URL in a sitemap must not throw away the pages already scanned.
 *
 * @param {string} startUrl any URL on the site; its origin is what gets crawled.
 * @param {object} options `limit`, `concurrency`, `ai`, `apiKey`, `sitemapUrl`,
 *   `sitemapXml`, `onProgress`.
 * @returns {Promise<object>} site scan, or `{ error }` if no sitemap yields pages.
 */
export async function scanSitemap(startUrl, options = {}) {
  const limit = Math.min(Math.max(1, options.limit || DEFAULT_PAGE_LIMIT), MAX_PAGE_LIMIT);
  const concurrency = options.concurrency || DEFAULT_CONCURRENCY;
  const onProgress = options.onProgress || (() => {});
  const origin = new URL(startUrl).origin;

  const inlineXml = options.sitemapXml?.trim() || null;
  if (inlineXml && !/<(urlset|sitemapindex)\b/i.test(inlineXml) && !/https?:\/\//.test(inlineXml)) {
    return { error: 'That file is not a sitemap — it has no <urlset>, <sitemapindex>, or URLs in it.' };
  }

  let sitemaps = [];
  if (!inlineXml) {
    sitemaps = options.sitemapUrl ? [options.sitemapUrl] : await discoverSitemaps(startUrl);
    if (!sitemaps.length) {
      return {
        error:
          `No sitemap found for ${origin}. Looked in robots.txt and at the ` +
          `conventional locations (/sitemap.xml, /sitemap_index.xml, …). ` +
          `If the site has one elsewhere, give its URL or upload the file.`
      };
    }
  }

  const { urls, total, sources, offOrigin } = await collectSitemapUrls(sitemaps, {
    origin,
    limit,
    inlineXml
  });

  if (!urls.length) {
    // The commonest cause of an empty result on a supplied sitemap: it belongs
    // to a different site than the URL that was typed. Say that outright rather
    // than reporting a bare "no pages".
    if (offOrigin) {
      return {
        error:
          `That sitemap lists ${offOrigin} page${offOrigin === 1 ? '' : 's'}, but none on ` +
          `${origin}. Check that the sitemap and the URL are for the same site.`
      };
    }
    return { error: `The sitemap for ${origin} lists no pages on this origin.` };
  }

  const browser = await launchBrowser();
  const pages = [];
  const failed = [];
  let done = 0;

  try {
    await pool(urls, concurrency, async (url) => {
      try {
        const scan = await scanWithBrowser(browser, url, {
          ai: options.ai,
          apiKey: options.apiKey
        });
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
