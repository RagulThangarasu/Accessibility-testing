import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { scanUrl, summarize } from './scanner.js';
import { generateReportHtml, htmlToPdf } from './report.js';

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
      url: scan.url,
      finalUrl: scan.finalUrl,
      title: scan.title,
      level: scan.level,
      engines: scan.engines,
      summary,
      reportPdfUrl: pdfUrl
    });
  } catch (err) {
    console.error('Scan failed:', err);
    res.status(500).json({
      error: `Scan failed: ${err.message}`
    });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`\n  Accessibility Scanner running:  http://localhost:${PORT}\n`);
});
