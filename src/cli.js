import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { scanUrl, summarize, WCAG_LEVEL_LABEL } from './scanner.js';
import { generateReportHtml, htmlToPdf } from './report.js';

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

const url = normalizeUrl(process.argv[2]);
if (!url) {
  console.error('Usage: npm run scan -- <url>');
  console.error('Example: npm run scan -- https://www.infoblox.com/');
  process.exit(1);
}

console.log(`\nScanning ${url}`);
console.log(`Standard: ${WCAG_LEVEL_LABEL}`);
console.log('Engines : axe-core, HTML_CodeSniffer, html-validate, custom checks\n');

const scan = await scanUrl(url);
const summary = summarize(scan);

const html = generateReportHtml(scan);
await fs.mkdir(REPORTS_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const base = `${slugify(url)}-${stamp}`;
const htmlPath = path.join(REPORTS_DIR, `${base}.html`);
const pdfPath = path.join(REPORTS_DIR, `${base}.pdf`);

await fs.writeFile(htmlPath, html, 'utf-8');
try {
  await htmlToPdf(html, pdfPath);
} catch (e) {
  console.warn('PDF generation skipped:', e.message);
}

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
console.log(`\nHTML report: ${htmlPath}`);
console.log(`PDF report : ${pdfPath}\n`);
