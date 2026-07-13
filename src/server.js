import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { scanUrl, summarize } from './scanner.js';
import { scanSitemap, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from './crawler.js';
import { generateReportHtml, generateSiteReportHtml, htmlToPdf } from './report.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const REPORTS_DIR = path.join(ROOT, 'reports');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(PUBLIC_DIR));
app.use('/reports', express.static(REPORTS_DIR));

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

async function clearOldReports() {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  const entries = await fs.readdir(REPORTS_DIR, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((e) => e.isFile())
      .map((e) => fs.unlink(path.join(REPORTS_DIR, e.name)).catch(() => {}))
  );
}

app.post('/api/scan', async (req, res) => {
  const url = normalizeUrl(req.body?.url);
  if (!url) {
    return res.status(400).json({ error: 'Please provide a valid URL.' });
  }

  try {
    const scan = await scanUrl(url);
    const summary = summarize(scan);

    const html = generateReportHtml(scan);

    await clearOldReports();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = `${slugify(url)}-${stamp}`;
    const pdfFile = `${base}.pdf`;
    const htmlFile = `${base}.html`;

    await fs.writeFile(path.join(REPORTS_DIR, htmlFile), html, 'utf-8');

    // PDF generation is best-effort; never fail the whole scan on it.
    let pdfUrl = null;
    try {
      await htmlToPdf(html, path.join(REPORTS_DIR, pdfFile));
      pdfUrl = `/reports/${pdfFile}`;
    } catch (e) {
      console.warn('PDF generation failed:', e.message);
    }

    res.json({
      ok: true,
      mode: 'page',
      url: scan.url,
      finalUrl: scan.finalUrl,
      title: scan.title,
      level: scan.level,
      engines: scan.engines,
      summary,
      reportHtmlUrl: `/reports/${htmlFile}`,
      reportPdfUrl: pdfUrl
    });
  } catch (err) {
    console.error('Scan failed:', err);
    res.status(500).json({
      error: `Scan failed: ${err.message}`
    });
  }
});

// Crawl the site's sitemap and scan every page it lists, up to `limit`.
// A crawl is minutes, not seconds — the client must be prepared to wait.
app.post('/api/scan-site', async (req, res) => {
  const url = normalizeUrl(req.body?.url);
  if (!url) {
    return res.status(400).json({ error: 'Please provide a valid URL.' });
  }

  const limit = Math.min(
    Math.max(1, Number(req.body?.limit) || DEFAULT_PAGE_LIMIT),
    MAX_PAGE_LIMIT
  );

  try {
    const site = await scanSitemap(url, { limit, ai: req.body?.ai !== false });

    // No sitemap is a normal outcome for many sites, not a server fault — say
    // so plainly instead of dressing it up as a 500.
    if (site.error) {
      return res.status(422).json({ error: site.error });
    }

    const html = generateSiteReportHtml(site);

    await clearOldReports();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const pdfFile = `${slugify(url)}-site-${stamp}.pdf`;
    const htmlFile = `${slugify(url)}-site-${stamp}.html`;

    await fs.writeFile(path.join(REPORTS_DIR, htmlFile), html, 'utf-8');

    let pdfUrl = null;
    try {
      await htmlToPdf(html, path.join(REPORTS_DIR, pdfFile));
      pdfUrl = `/reports/${pdfFile}`;
    } catch (e) {
      console.warn('PDF generation failed:', e.message);
    }

    res.json({
      ok: true,
      mode: 'site',
      site: site.site,
      sitemaps: site.sitemaps,
      discovered: site.discovered,
      limit: site.limit,
      level: site.level,
      engines: site.engines,
      totals: site.totals,
      failed: site.failed,
      pages: site.pages.map((p) => ({
        url: p.finalUrl || p.url,
        title: p.title,
        summary: p.summary
      })),
      issues: site.issues.map((i) => ({
        title: i.title,
        scLabel: i.scLabel,
        impact: i.impact,
        status: i.status,
        pages: i.pages.length,
        elements: i.elements
      })),
      reportHtmlUrl: `/reports/${htmlFile}`,
      reportPdfUrl: pdfUrl
    });
  } catch (err) {
    console.error('Site scan failed:', err);
    res.status(500).json({ error: `Site scan failed: ${err.message}` });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`\n  Accessibility Scanner running:  http://localhost:${PORT}\n`);
});
