import { chromium } from 'playwright';
import { summarize } from './scanner.js';
import { scName } from './engines.js';
import { MANUAL_CHECKLIST } from './manual-checklist.js';

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
  'checks': 'Additional automated checks',
  'claude': 'Claude review — criteria that need human judgment'
};

const ENGINE_SHORT = {
  'axe-core': 'axe-core',
  'HTML_CodeSniffer': 'HTML_CodeSniffer',
  'html-validate': 'HTML validator',
  'checks': 'custom check',
  'claude': 'Claude'
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

// The Claude pass is optional — it only runs when an API key is configured.
// Say plainly which state the report is in, so nobody reads a report that
// skipped the judgment criteria as if those criteria had passed.
function aiNote(ai) {
  if (!ai) return '';
  if (ai.skipped) {
    return `<div class="ai-note ai-note-off">
      <strong>Claude review did not run.</strong> ${esc(ai.skipped)}.
      The ${MANUAL_CHECKLIST.length} WCAG criteria that require human judgment were
      <em>not</em> assessed — this report covers automated checks only.
    </div>`;
  }
  const flagged = ai.findings.length;
  return `<div class="ai-note">
    <strong>Claude reviewed ${ai.checked} WCAG criteria that automated engines cannot decide.</strong>
    ${flagged} need${flagged === 1 ? 's' : ''} attention · ${ai.passed} passed ·
    ${ai.notApplicable} not applicable to this page.
    Claude judges the rendered markup, so treat its findings as expert review, not proof.
  </div>`;
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

function engineSectionsFor(scan) {
  const byEngine = {};
  for (const e of scan.engines) byEngine[e] = [];
  for (const f of scan.findings) {
    if (!byEngine[f.engine]) byEngine[f.engine] = [];
    byEngine[f.engine].push(f);
  }
  return scan.engines.map((e) => engineSection(e, byEngine[e] || [])).join('');
}

const REPORT_CSS = `
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
  .ai-note { background:#f3f2ff; border:1px solid #d7d2ff; border-left:4px solid #7c3aed; border-radius:10px; padding:14px 16px; font-size:13.5px; margin-bottom:16px; }
  .ai-note-off { background:#fff6e5; border-color:#f0d9a8; border-left-color:#c79100; }
  .manual-list { list-style:none; padding:0; margin:12px 0; }
  .manual-item { display:flex; gap:10px; background:#fff; border:1px solid var(--line); border-radius:10px; padding:12px 14px; margin-bottom:8px; }
  .manual-box { font-size:18px; color:#7c3aed; }
  .manual-item .lvl { font-size:11px; color:#fff; background:#7c3aed; padding:1px 7px; border-radius:999px; }
  .manual-check { color:var(--muted); font-size:13px; margin-top:3px; }
  footer { margin-top:40px; color:var(--muted); font-size:12px; text-align:center; }
  .page-block { background:#fff; border:1px solid var(--line); border-radius:14px; padding:18px 20px; margin-bottom:18px; }
  .page-head { display:flex; justify-content:space-between; align-items:baseline; gap:16px; flex-wrap:wrap; }
  .page-head h3 { margin:0; font-size:16px; }
  .page-url { font-size:12px; color:#7c3aed; word-break:break-all; }
  .page-counts { font-size:12px; color:var(--muted); white-space:nowrap; }
  .page-clean { color:#1b5e35; font-weight:600; font-size:13px; margin-top:8px; }
  .issue-table { width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--line); border-radius:12px; overflow:hidden; font-size:13px; }
  .issue-table th { text-align:left; background:#f0f1f6; padding:10px 12px; font-size:12px; color:var(--muted); }
  .issue-table td { padding:10px 12px; border-top:1px solid var(--line); vertical-align:top; }
  .issue-table .pill { color:#fff; font-size:10px; font-weight:700; text-transform:uppercase; padding:3px 7px; border-radius:5px; white-space:nowrap; }
  .issue-pages { font-size:12px; color:var(--muted); }
  .failed { background:#fff6e5; border:1px solid #f0d9a8; border-radius:10px; padding:12px 16px; font-size:13px; margin-bottom:16px; }
  @media print { body { background:#fff; } .finding, .stat, .manual-item, .page-block { break-inside:avoid; } }
`;

const LEGEND = `
  <div class="legend">
    <h2 class="section-title">How to read this report</h2>
    <ul>
      <li><strong>Violation</strong> — an automated check failed. This almost certainly needs fixing.</li>
      <li><strong>Needs review</strong> — a potential issue that requires manual verification.</li>
      <li><strong>Severity</strong> — critical &gt; serious &gt; moderate &gt; minor (how much it affects users).</li>
    </ul>
  </div>`;

function shell(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="wrap">
${body}
</div>
</body>
</html>`;
}

/**
 * Build a standalone HTML accessibility report for a single scanned page.
 */
export function generateReportHtml(scan) {
  const summary = summarize(scan);
  const generatedAt = new Date(scan.generatedAt || Date.now()).toLocaleString();
  const engineList = scan.engines.map((e) => ENGINE_LABEL[e] || e).join(' · ');

  const cleanState =
    summary.violations === 0
      ? `<div class="all-clear">✅ No automated WCAG 2.0 AA violations detected across all engines.${
          summary.review ? ` (${summary.review} items still need review.)` : ''
        }</div>`
      : '';

  return shell(
    `Accessibility Report — ${scan.title || scan.url}`,
    `
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

  ${LEGEND}

  <h2 class="section-title">Findings</h2>
  ${aiNote(scan.aiReview)}
  ${cleanState}
  ${engineSectionsFor(scan)}

  <footer>
    Generated by the Accessibility Scanner • Engines: ${esc(engineList)} • ${esc(scan.level)}.
  </footer>`
  );
}

function siteAiNote(ai) {
  if (!ai) return '';
  if (ai.skipped) {
    return `<div class="ai-note ai-note-off">
      <strong>Claude review did not run.</strong> ${esc(ai.skipped)}.
      The ${MANUAL_CHECKLIST.length} WCAG criteria that require human judgment were
      <em>not</em> assessed on any page — this report covers automated checks only.
    </div>`;
  }
  return `<div class="ai-note">
    <strong>Claude reviewed ${ai.checked} judgment-based criteria across the site.</strong>
    ${ai.flagged} need attention · ${ai.passed} passed · ${ai.notApplicable} not applicable.
    Claude judges the rendered markup, so treat its findings as expert review, not proof.
  </div>`;
}

// The site-wide view most worth acting on: one row per distinct problem, with
// how many pages carry it. A rule affecting 9 of 10 pages is almost always in a
// shared header, nav, or template — fix it once and the whole site improves.
function issueRow(issue) {
  const color = IMPACT_COLOR[issue.impact] || '#555';
  const badge = issue.status === 'review' ? 'review' : issue.impact;
  const n = issue.pages.length;
  return `
    <tr>
      <td><span class="pill" style="background:${color}">${esc(badge)}</span></td>
      <td>
        <strong>${esc(issue.title)}</strong>
        <div class="issue-pages">${esc(issue.scLabel)} · <code>${esc(issue.ruleId)}</code> ·
          found by ${esc(ENGINE_SHORT[issue.engine] || issue.engine)}</div>
      </td>
      <td><strong>${n}</strong> page${n === 1 ? '' : 's'}<div class="issue-pages">${
        issue.elements
      } element${issue.elements === 1 ? '' : 's'}</div></td>
    </tr>`;
}

function pageBlock(page, idx) {
  const s = page.summary;
  const url = page.finalUrl || page.url;
  const body = s.violations === 0 && s.review === 0
    ? '<div class="page-clean">✅ No issues found on this page.</div>'
    : `<details><summary>Show the ${s.violations} violation${
        s.violations === 1 ? '' : 's'
      } and ${s.review} review item${s.review === 1 ? '' : 's'} on this page</summary>
       ${engineSectionsFor(page)}</details>`;

  return `
    <div class="page-block">
      <div class="page-head">
        <div>
          <h3>${idx}. ${esc(page.title || 'Untitled page')}</h3>
          <div class="page-url">${esc(url)}</div>
        </div>
        <div class="page-counts">
          ${s.violations} violation${s.violations === 1 ? '' : 's'} ·
          ${s.review} to review · ${s.affectedElements} element${
            s.affectedElements === 1 ? '' : 's'
          }
        </div>
      </div>
      ${body}
    </div>`;
}

/**
 * Build a standalone HTML report for a whole site crawled from its sitemap.
 *
 * Leads with the site-wide picture (which problems repeat across pages), then
 * drops into the per-page detail — a template-level bug is worth fixing before
 * anything one page happens to have.
 */
export function generateSiteReportHtml(site) {
  const t = site.totals;
  const generatedAt = new Date(site.generatedAt || Date.now()).toLocaleString();
  const engineList = site.engines.map((e) => ENGINE_LABEL[e] || e).join(' · ');

  const capped =
    site.discovered > site.pages.length + site.failed.length
      ? ` (of ${site.discovered} in the sitemap — capped at ${site.limit})`
      : '';

  const failedBlock = site.failed.length
    ? `<div class="failed"><strong>${site.failed.length} page${
        site.failed.length === 1 ? '' : 's'
      } could not be scanned:</strong><ul>${site.failed
        .map((f) => `<li>${esc(f.url)} — ${esc(f.error)}</li>`)
        .join('')}</ul></div>`
    : '';

  const issuesTable = t.violations === 0 && t.review === 0
    ? `<div class="all-clear">✅ No WCAG 2.0 AA issues detected on any of the ${t.pages} pages scanned.</div>`
    : `<table class="issue-table">
        <thead><tr><th>Severity</th><th>Issue</th><th>Reach</th></tr></thead>
        <tbody>${site.issues.map(issueRow).join('')}</tbody>
       </table>`;

  return shell(
    `Accessibility Report — ${site.site}`,
    `
  <header class="report-header">
    <h1>Site Accessibility Audit</h1>
    <div class="url">${esc(site.site)}</div>
    <div class="badge">Standard: ${esc(site.level)}</div>
    <div class="meta-line">Pages scanned: ${t.pages}${esc(capped)}<br/>Sitemap: ${esc(
      site.sitemaps.join(', ')
    )}<br/>Engines: ${esc(engineList)}<br/>Generated: ${esc(generatedAt)}</div>
  </header>

  <div class="stats">
    ${statCard(t.pages, 'Pages', '#4f46e5')}
    ${statCard(t.violations, 'Violations', '#b00020')}
    ${statCard(t.byImpact.critical, 'Critical', IMPACT_COLOR.critical)}
    ${statCard(t.byImpact.serious, 'Serious', IMPACT_COLOR.serious)}
    ${statCard(t.byImpact.moderate, 'Moderate', IMPACT_COLOR.moderate)}
    ${statCard(t.byImpact.minor, 'Minor', IMPACT_COLOR.minor)}
    ${statCard(t.review, 'Needs review', IMPACT_COLOR.review)}
    ${statCard(t.affectedElements, 'Elements', '#5b6472')}
  </div>

  ${LEGEND}

  <h2 class="section-title">Issues across the site
    <span class="muted">— sorted by severity, then by how many pages they affect</span>
  </h2>
  ${siteAiNote(t.ai)}
  ${failedBlock}
  ${issuesTable}

  <h2 class="section-title">Page-by-page detail</h2>
  ${site.pages.map((p, i) => pageBlock(p, i + 1)).join('')}

  <footer>
    Generated by the Accessibility Scanner • Engines: ${esc(engineList)} • ${esc(site.level)}.
  </footer>`
  );
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
