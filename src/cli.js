import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { scanUrl, summarize, WCAG_LEVEL_LABEL } from './scanner.js';
import { scanSitemap, DEFAULT_PAGE_LIMIT } from './crawler.js';
import { generateReportHtml, generateSiteReportHtml, htmlToPdf } from './report.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPORTS_DIR = path.join(__dirname, '..', 'reports');

function normalizeUrl(input) {
  let u = String(input || '').trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try {
    return new URL(u).href;
  } catch {
    return null;
  }
}

function slugify(url) {
  try {
    return new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '_');
  } catch {
    return 'report';
  }
}

function usage() {
  console.error('Usage: npm run scan -- <url> [--sitemap] [--limit N] [--no-ai]');
  console.error('');
  console.error('  --sitemap    Find the site\'s sitemap and scan every page it lists');
  console.error(`  --limit N    Max pages to scan in sitemap mode (default ${DEFAULT_PAGE_LIMIT})`);
  console.error('  --no-ai      Skip the Claude review stage');
  console.error('');
  console.error('Examples:');
  console.error('  npm run scan -- https://www.infoblox.com/');
  console.error('  npm run scan -- https://www.infoblox.com/ --sitemap --limit 20');
  process.exit(1);
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const url = normalizeUrl(args.find((a) => !a.startsWith('--')));
if (!url) usage();

const limitArg = args.find((a) => a.startsWith('--limit'));
const limit = limitArg
  ? Number(limitArg.includes('=') ? limitArg.split('=')[1] : args[args.indexOf(limitArg) + 1])
  : DEFAULT_PAGE_LIMIT;

const useAi = !flags.has('--no-ai');
const sitemapMode = flags.has('--sitemap');

/** Write the report to reports/ as both HTML and PDF. */
async function writeReports(html, base) {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const htmlPath = path.join(REPORTS_DIR, `${base}.html`);
  const pdfPath = path.join(REPORTS_DIR, `${base}.pdf`);

  await fs.writeFile(htmlPath, html, 'utf-8');
  console.log(`\nHTML report: ${htmlPath}`);

  try {
    await htmlToPdf(html, pdfPath);
    console.log(`PDF report : ${pdfPath}\n`);
  } catch (e) {
    console.warn(`PDF generation skipped: ${e.message}\n`);
  }
}

function printAi(ai, scope) {
  if (ai?.skipped) {
    console.log(`\nClaude review skipped: ${ai.skipped}`);
    console.log('Criteria needing human judgment were not assessed.');
  } else if (ai) {
    const flagged = ai.flagged ?? ai.findings.length;
    console.log(
      `\nClaude reviewed ${ai.checked} judgment-based criteria${scope}: ` +
        `${flagged} flagged, ${ai.passed} passed, ${ai.notApplicable} n/a`
    );
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');

if (sitemapMode) {
  console.log(`\nCrawling the sitemap for ${new URL(url).origin}`);
  console.log(`Standard: ${WCAG_LEVEL_LABEL}`);
  console.log(`Page limit: ${limit}${useAi ? '' : ' · Claude review disabled'}\n`);

  const site = await scanSitemap(url, {
    limit,
    ai: useAi,
    onProgress: ({ done, total, url: pageUrl }) => {
      console.log(`  [${String(done).padStart(2)}/${total}] ${pageUrl}`);
    }
  });

  if (site.error) {
    console.error(`\n${site.error}`);
    process.exit(1);
  }

  const t = site.totals;
  console.log('\nSite results');
  console.log('───────────────────────────────');
  console.log(`Sitemap           : ${site.sitemaps.join(', ')}`);
  console.log(`Pages in sitemap  : ${site.discovered}`);
  console.log(`Pages scanned     : ${t.pages}${site.failed.length ? ` (${site.failed.length} failed)` : ''}`);
  console.log(`Violations        : ${t.violations}`);
  console.log(`  critical        : ${t.byImpact.critical}`);
  console.log(`  serious         : ${t.byImpact.serious}`);
  console.log(`  moderate        : ${t.byImpact.moderate}`);
  console.log(`  minor           : ${t.byImpact.minor}`);
  console.log(`Needs review      : ${t.review}`);
  console.log(`Elements affected : ${t.affectedElements}`);
  console.log('───────────────────────────────');

  // The rows worth acting on first: one problem repeated across many pages is
  // almost always in a shared template.
  const top = site.issues.filter((i) => i.status === 'violation').slice(0, 5);
  if (top.length) {
    console.log('\nTop issues by reach');
    for (const i of top) {
      console.log(`  ${String(i.pages.length).padStart(2)} pages · ${i.impact.padEnd(8)} ${i.title}`);
    }
  }

  printAi(t.ai, ' across the site');
  await writeReports(generateSiteReportHtml(site), `${slugify(url)}-site-${stamp}`);
} else {
  console.log(`\nScanning ${url}`);
  console.log(`Standard: ${WCAG_LEVEL_LABEL}`);
  console.log(
    `Engines : axe-core, HTML_CodeSniffer, html-validate, custom checks${useAi ? ', Claude' : ''}\n`
  );

  const scan = await scanUrl(url, { ai: useAi });
  const summary = summarize(scan);

  console.log('Results');
  console.log('───────────────────────────────');
  console.log(`Page title        : ${scan.title || '—'}`);
  console.log(`Violations        : ${summary.violations}`);
  console.log(`  critical        : ${summary.byImpact.critical}`);
  console.log(`  serious         : ${summary.byImpact.serious}`);
  console.log(`  moderate        : ${summary.byImpact.moderate}`);
  console.log(`  minor           : ${summary.byImpact.minor}`);
  console.log(`Needs review      : ${summary.review}`);
  console.log(`Elements affected : ${summary.affectedElements}`);
  console.log(`axe checks passed : ${summary.passes}`);
  console.log('─────── findings by engine ───────');
  for (const [engine, count] of Object.entries(summary.byEngine)) {
    console.log(`  ${engine.padEnd(16)}: ${count}`);
  }
  console.log('───────────────────────────────');

  printAi(summary.ai, '');
  await writeReports(generateReportHtml(scan), `${slugify(url)}-${stamp}`);
}
