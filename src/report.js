import { chromium } from 'playwright';
import { summarize } from './scanner.js';
import { scName } from './engines.js';

const IMPACT_ORDER = ['critical', 'serious', 'moderate', 'minor', 'review'];

const IMPACT_COLOR = {
  critical: '#b00020',
  serious: '#d35400',
  moderate: '#c79100',
  minor: '#2e7d32',
  review: '#6b7280'
};

const ENGINE_LABEL = {
  'axe-core': 'axe-core',
  'HTML_CodeSniffer': 'HTML_CodeSniffer (WCAG2AA)',
  'html-validate': 'HTML validation — markup parsing (SC 4.1.1)',
  'checks': 'Additional automated checks'
};

const ENGINE_SHORT = {
  'axe-core': 'axe-core',
  'HTML_CodeSniffer': 'HTML_CodeSniffer',
  'html-validate': 'HTML validator',
  'checks': 'custom check'
};

function scLabel(sc) {
  if (!sc) return 'Not mapped';
  const name = scName(sc);
  return name ? `${sc} — ${name}` : sc;
}

function esc(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(str = '', n = 600) {
  return str.length > n ? str.slice(0, n) + ' …' : str;
}

function nodeBlock(node) {
  const parts = [];
  if (node.selector) parts.push(`<div class="node-target">${esc(node.selector)}</div>`);
  if (node.html) parts.push(`<pre class="node-html">${esc(truncate(node.html, 400))}</pre>`);
  if (node.summary) parts.push(`<div class="node-fix">${esc(truncate(node.summary, 500))}</div>`);
  return `<div class="node">${parts.join('')}</div>`;
}

function findingCard(f, idx) {
  const color = IMPACT_COLOR[f.impact] || '#555';
  const nodesHtml = f.nodes.map(nodeBlock).join('');

  const elementsLine = f.nodes.length
    ? `<details><summary>Show the ${f.nodes.length} affected element${
        f.nodes.length === 1 ? '' : 's'
      } (with exact code)</summary><div class="nodes">${nodesHtml}</div></details>`
    : '';

  const badge = f.status === 'review' ? 'review' : f.impact;

  return `
    <section class="finding" style="border-left-color:${color}">
      <header class="finding-head">
        <span class="impact" style="background:${color}">${esc(badge)}</span>
        <h4>${idx}. ${esc(f.title)}</h4>
      </header>
      <div class="finding-meta">
        <span><strong>WCAG:</strong> ${esc(scLabel(f.sc))}</span>
        <span><strong>Detected by:</strong> ${esc(ENGINE_SHORT[f.engine] || f.engine)}</span>
        ${f.nodes.length ? `<span><strong>Affected elements:</strong> ${f.nodes.length}</span>` : ''}
        <span><strong>Rule:</strong> <code>${esc(f.ruleId)}</code></span>
      </div>
      ${f.description ? `<p class="finding-block"><strong>What it means:</strong> ${esc(f.description)}</p>` : ''}
      ${f.fix ? `<p class="finding-block fix"><strong>How to fix:</strong> ${esc(f.fix)}</p>` : ''}
      ${elementsLine}
    </section>`;
}

function statCard(num, label, color) {
  return `<div class="stat"><div class="stat-num" style="color:${color}">${num}</div><div class="stat-label">${label}</div></div>`;
}

function engineSection(engine, findings) {
  if (!findings.length) return '';
  const sorted = [...findings].sort((a, b) => {
    const ai = IMPACT_ORDER.indexOf(a.impact);
    const bi = IMPACT_ORDER.indexOf(b.impact);
    if (ai !== bi) return ai - bi;
    return b.nodes.length - a.nodes.length;
  });
  const vCount = findings.filter((f) => f.status === 'violation').length;
  const rCount = findings.length - vCount;
  return `
    <div class="engine">
      <h3 class="engine-title">${esc(ENGINE_LABEL[engine] || engine)}
        <span class="engine-counts">${vCount} violation${vCount === 1 ? '' : 's'}${
    rCount ? ` · ${rCount} to review` : ''
  }</span>
      </h3>
      ${sorted.map((f, i) => findingCard(f, i + 1)).join('')}
    </div>`;
}

/**
 * Build a standalone HTML accessibility report from a combined scan result.
 */
export function generateReportHtml(scan) {
  const summary = summarize(scan);
  const generatedAt = new Date(scan.generatedAt || Date.now()).toLocaleString();

  const byEngine = {};
  for (const e of scan.engines) byEngine[e] = [];
  for (const f of scan.findings) {
    if (!byEngine[f.engine]) byEngine[f.engine] = [];
    byEngine[f.engine].push(f);
  }

  const engineSections = scan.engines.map((e) => engineSection(e, byEngine[e] || [])).join('');
  const cleanState =
    summary.violations === 0
      ? `<div class="all-clear">✅ No automated WCAG 2.0 AA violations detected across all engines.${
          summary.review ? ` (${summary.review} items still need review.)` : ''
        }</div>`
      : '';

  const engineList = scan.engines.map((e) => ENGINE_LABEL[e] || e).join(' · ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Accessibility Report — ${esc(scan.title || scan.url)}</title>
<style>
  :root { --ink:#1a1a2e; --muted:#5b6472; --line:#e6e8ee; --bg:#f6f7fb; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; color:var(--ink); background:var(--bg); line-height:1.5; }
  .wrap { max-width:980px; margin:0 auto; padding:32px 24px 80px; }
  .report-header { background:linear-gradient(135deg,#4f46e5,#7c3aed); color:#fff; border-radius:16px; padding:28px 32px; }
  .report-header h1 { margin:0 0 4px; font-size:24px; }
  .report-header .url { word-break:break-all; opacity:.95; font-size:14px; }
  .report-header .badge { display:inline-block; margin-top:14px; background:rgba(255,255,255,.18); padding:6px 14px; border-radius:999px; font-size:13px; font-weight:600; }
  .meta-line { color:#e9e9ff; font-size:13px; margin-top:10px; }
  .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:12px; margin:24px 0; }
  .stat { background:#fff; border:1px solid var(--line); border-radius:12px; padding:16px; text-align:center; }
  .stat-num { font-size:28px; font-weight:700; }
  .stat-label { text-transform:capitalize; color:var(--muted); font-size:12px; margin-top:4px; }
  .section-title { font-size:19px; margin:34px 0 12px; }
  .muted { color:var(--muted); font-weight:400; font-size:13px; }
  .engine { margin-bottom:26px; }
  .engine-title { font-size:16px; margin:24px 0 12px; padding-bottom:8px; border-bottom:2px solid var(--line); display:flex; justify-content:space-between; align-items:baseline; gap:12px; }
  .engine-counts { font-size:12px; color:var(--muted); font-weight:500; }
  .finding { background:#fff; border:1px solid var(--line); border-left:5px solid #ccc; border-radius:12px; padding:16px 18px; margin-bottom:14px; }
  .finding-head { display:flex; align-items:center; gap:10px; }
  .finding-head h4 { margin:0; font-size:15px; }
  .impact { color:#fff; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; padding:4px 8px; border-radius:6px; flex-shrink:0; }
  .finding-meta { display:flex; flex-wrap:wrap; gap:14px; font-size:12.5px; align-items:center; padding:8px 0; border-top:1px dashed var(--line); border-bottom:1px dashed var(--line); margin-bottom:10px; }
  .finding-meta code { background:#f0f1f6; padding:1px 6px; border-radius:5px; }
  .finding-block { margin:8px 0; font-size:13.5px; color:var(--ink); }
  .finding-block strong { color:#1a1a2e; }
  .finding-block.fix { background:#f3f2ff; border-left:3px solid #7c3aed; padding:8px 12px; border-radius:6px; }
  .legend { background:#fff; border:1px solid var(--line); border-radius:12px; padding:6px 22px 18px; }
  .legend ul { margin:6px 0 0; padding-left:20px; }
  .legend li { font-size:13.5px; color:var(--ink); margin:5px 0; }
  details { margin-top:10px; }
  summary { cursor:pointer; font-size:12.5px; color:#4f46e5; font-weight:600; }
  .nodes { margin-top:10px; }
  .node { border:1px solid var(--line); border-radius:8px; padding:10px; margin-bottom:8px; background:#fbfbfd; }
  .node-target { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11.5px; color:#7c3aed; margin-bottom:6px; word-break:break-all; }
  .node-html { background:#1e1e2e; color:#e0e0f0; padding:10px; border-radius:6px; font-size:11.5px; overflow-x:auto; white-space:pre-wrap; word-break:break-word; margin:0 0 6px; }
  .node-fix { font-size:12.5px; color:#b00020; white-space:pre-wrap; }
  .more-note { font-size:12px; color:var(--muted); }
  .all-clear { background:#e7f6ec; border:1px solid #b6e0c4; color:#1b5e35; padding:18px; border-radius:12px; font-size:15px; font-weight:600; text-align:center; }
  .manual-list { list-style:none; padding:0; margin:12px 0; }
  .manual-item { display:flex; gap:10px; background:#fff; border:1px solid var(--line); border-radius:10px; padding:12px 14px; margin-bottom:8px; }
  .manual-box { font-size:18px; color:#7c3aed; }
  .manual-item .lvl { font-size:11px; color:#fff; background:#7c3aed; padding:1px 7px; border-radius:999px; }
  .manual-check { color:var(--muted); font-size:13px; margin-top:3px; }
  footer { margin-top:40px; color:var(--muted); font-size:12px; text-align:center; }
  @media print { body { background:#fff; } .finding, .stat, .manual-item { break-inside:avoid; } }
</style>
</head>
<body>
<div class="wrap">
  <header class="report-header">
    <h1>Accessibility Audit Report</h1>
    <div class="url">${esc(scan.finalUrl || scan.url)}</div>
    <div class="badge">Standard: ${esc(scan.level)}</div>
    <div class="meta-line">Page title: ${esc(scan.title || '—')}<br/>Engines: ${esc(
    engineList
  )}<br/>Generated: ${esc(generatedAt)}</div>
  </header>

  <div class="stats">
    ${statCard(summary.violations, 'Violations', '#b00020')}
    ${statCard(summary.byImpact.critical, 'Critical', IMPACT_COLOR.critical)}
    ${statCard(summary.byImpact.serious, 'Serious', IMPACT_COLOR.serious)}
    ${statCard(summary.byImpact.moderate, 'Moderate', IMPACT_COLOR.moderate)}
    ${statCard(summary.byImpact.minor, 'Minor', IMPACT_COLOR.minor)}
    ${statCard(summary.review, 'Needs review', IMPACT_COLOR.review)}
    ${statCard(summary.affectedElements, 'Elements', '#5b6472')}
    ${statCard(summary.passes, 'axe passed', '#2e7d32')}
  </div>

  <div class="legend">
    <h2 class="section-title">How to read this report</h2>
    <ul>
      <li><strong>Violation</strong> — an automated check failed. This almost certainly needs fixing.</li>
      <li><strong>Needs review</strong> — a potential issue that requires manual verification.</li>
      <li><strong>Severity</strong> — critical &gt; serious &gt; moderate &gt; minor (how much it affects users).</li>
    </ul>
  </div>

  <h2 class="section-title">Automated findings</h2>
  ${cleanState}
  ${engineSections}

  <footer>
    Generated by the Accessibility Scanner • Engines: axe-core, HTML_CodeSniffer, html-validate, custom checks • ${esc(
      scan.level
    )}.
  </footer>
</div>
</body>
</html>`;
}

/**
 * Render an HTML string to a PDF file using Playwright/Chromium.
 */
export async function htmlToPdf(html, outputPath) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => {
      document.querySelectorAll('details').forEach((d) => (d.open = true));
    });
    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', bottom: '16mm', left: '12mm', right: '12mm' }
    });
  } finally {
    await browser.close();
  }
}
