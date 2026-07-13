import { chromium } from 'playwright';
import { summarize } from './scanner.js';
import { scName } from './engines.js';
import { TOTAL_CRITERIA } from './wcag.js';

// Findings are presented in priority order, not engine order. A reader wants to
// know what to fix first; which library happened to catch it is a footnote.
const PRIORITY = [
  {
    impact: 'critical',
    label: 'Critical',
    blurb: 'Blocks users outright. Fix these first.'
  },
  {
    impact: 'serious',
    label: 'Serious',
    blurb: 'Makes core content or functionality very hard to use.'
  },
  {
    impact: 'moderate',
    label: 'Moderate',
    blurb: 'Causes real friction, with a workaround available.'
  },
  {
    impact: 'minor',
    label: 'Minor',
    blurb: 'A nuisance rather than a barrier.'
  },
  {
    impact: 'review',
    label: 'Needs human review',
    blurb: 'Cannot be decided automatically — someone has to look.'
  }
];

const IMPACT_COLOR = {
  critical: '#b00020',
  serious: '#d35400',
  moderate: '#c79100',
  minor: '#2e7d32',
  review: '#6b7280'
};

const ENGINE_SHORT = {
  'axe-core': 'axe-core',
  'alfa': 'Siteimprove Alfa',
  'HTML_CodeSniffer': 'HTML_CodeSniffer',
  'html-validate': 'HTML validator',
  'checks': 'built-in check',
  'claude': 'Claude review'
};

const ENGINE_LABEL = {
  'axe-core': 'axe-core',
  'alfa': 'Siteimprove Alfa (W3C ACT Rules)',
  'HTML_CodeSniffer': 'HTML_CodeSniffer (WCAG2AA)',
  'html-validate': 'HTML validation (SC 4.1.1 Parsing)',
  'checks': 'Built-in DOM checks',
  'claude': 'Claude review of judgment-based criteria'
};

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

function scLabel(sc) {
  if (!sc) return 'Not mapped to a success criterion';
  const name = scName(sc);
  return name ? `${sc} ${name}` : sc;
}

/**
 * The Level A / AA chip. This is the single most load-bearing badge in the
 * report: Level A is the conformance floor, so an A failure is categorically
 * different from an AA one, no matter what severity the engine assigned it.
 */
function levelChip(level) {
  if (!level) return '<span class="lvl lvl-none" title="Not mapped to a WCAG success criterion">—</span>';
  const cls = level === 'A' ? 'lvl-a' : 'lvl-aa';
  const title =
    level === 'A'
      ? 'Level A — the minimum. Failing this means the page conforms at no level.'
      : 'Level AA — the standard target. Failing this blocks AA conformance.';
  return `<span class="lvl ${cls}" title="${title}">Level ${esc(level)}</span>`;
}

// Level A first within a severity band: two "serious" issues are not equally
// urgent if one of them is the difference between conforming and not.
function orderFindings(findings) {
  const levelRank = (l) => (l === 'A' ? 0 : l === 'AA' ? 1 : 2);
  return [...findings].sort((a, b) => {
    const lr = levelRank(a.level) - levelRank(b.level);
    if (lr !== 0) return lr;
    if (b.nodes.length !== a.nodes.length) return b.nodes.length - a.nodes.length;
    return (a.sc || '').localeCompare(b.sc || '');
  });
}

function nodeBlock(node) {
  const parts = [];
  if (node.selector) parts.push(`<div class="node-target">${esc(node.selector)}</div>`);
  if (node.screenshot) {
    parts.push(
      `<figure class="shot"><img src="${node.screenshot}" alt="Screenshot of the element that fails this check" /><figcaption>The element as it appears on the page</figcaption></figure>`
    );
  }
  if (node.html) parts.push(`<pre class="node-html">${esc(truncate(node.html, 400))}</pre>`);
  if (node.summary) parts.push(`<div class="node-fix">${esc(truncate(node.summary, 500))}</div>`);
  return `<div class="node">${parts.join('')}</div>`;
}

// Steps carry **bold** markers on the Expected/Actual lines — the one bit of
// markdown worth honouring, because those two lines are what a tester reads first.
function stepLine(step) {
  return esc(step).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function stepsBlock(steps) {
  if (!steps?.length) return '';
  return `
    <div class="steps">
      <div class="steps-title">Steps to reproduce</div>
      <ol>${steps.map((s) => `<li>${stepLine(s)}</li>`).join('')}</ol>
    </div>`;
}

function findingCard(f, id) {
  const color = IMPACT_COLOR[f.impact] || '#555';
  const badge = f.status === 'review' ? 'review' : f.impact;
  const n = f.nodes.length;

  const elements = n
    ? `<details>
         <summary>Show the ${n} affected element${n === 1 ? '' : 's'}, with the exact code</summary>
         <div class="nodes">${f.nodes.map(nodeBlock).join('')}</div>
       </details>`
    : '';

  // A low-confidence verdict is still a verdict, but the reader deserves to know
  // which ones to check by hand. Hiding the uncertainty would be the one thing
  // worse than reporting it.
  const confChip =
    f.confidence && f.confidence !== 'high'
      ? `<span class="conf conf-${esc(f.confidence)}" title="Claude's confidence in this verdict, from the markup alone">${esc(
          f.confidence
        )} confidence</span>`
      : '';

  const settled = f.adjudicated
    ? '<span class="settled" title="A rule engine flagged this but could not decide it. Claude settled it.">settled by Claude</span>'
    : '';

  return `
    <section class="finding" id="${esc(id)}" style="border-left-color:${color}">
      <header class="finding-head">
        <span class="impact" style="background:${color}">${esc(badge)}</span>
        ${levelChip(f.level)}
        ${confChip}
        ${settled}
        <h4>${esc(f.title)}</h4>
      </header>

      <div class="finding-meta">
        <span><strong>WCAG:</strong> ${esc(scLabel(f.sc))}</span>
        ${n ? `<span><strong>Affected elements:</strong> ${n}</span>` : ''}
        <span><strong>Found by:</strong> ${esc(ENGINE_SHORT[f.engine] || f.engine)}</span>
        <span><strong>Rule:</strong> <code>${esc(f.ruleId)}</code></span>
      </div>

      ${f.description ? `<p class="finding-block"><strong>Why it matters:</strong> ${esc(f.description)}</p>` : ''}
      ${stepsBlock(f.steps)}
      ${f.fix ? `<p class="finding-block fix"><strong>How to fix it:</strong> ${esc(f.fix)}</p>` : ''}
      ${elements}
    </section>`;
}

function inBand(findings, band) {
  return band.impact === 'review'
    ? findings.filter((f) => f.status === 'review')
    : findings.filter((f) => f.status === 'violation' && f.impact === band.impact);
}

/**
 * Assign every finding its anchor id, once.
 *
 * The at-a-glance index and the detail cards must agree on these — derive them
 * in two places and a link silently lands on the wrong issue. So both callers
 * read from this one map.
 */
function anchorMap(findings, prefix) {
  const ids = new Map();
  for (const band of PRIORITY) {
    orderFindings(inBand(findings, band)).forEach((f, i) => {
      ids.set(f, `${prefix}-${band.impact}-${i + 1}`);
    });
  }
  return ids;
}

/** One severity band, e.g. all the Critical issues, Level A first. */
function prioritySection(band, findings, ids) {
  if (!findings.length) return '';
  const color = IMPACT_COLOR[band.impact];
  const aCount = findings.filter((f) => f.level === 'A').length;

  return `
    <div class="band">
      <h3 class="band-title" style="border-left-color:${color}">
        <span class="band-name" style="color:${color}">${esc(band.label)}</span>
        <span class="band-count">${findings.length} issue${findings.length === 1 ? '' : 's'}${
          aCount ? ` · ${aCount} at Level A` : ''
        }</span>
      </h3>
      <p class="band-blurb">${esc(band.blurb)}</p>
      ${orderFindings(findings)
        .map((f) => findingCard(f, ids.get(f)))
        .join('')}
    </div>`;
}

function prioritySections(findings, ids) {
  return PRIORITY.map((band) => prioritySection(band, inBand(findings, band), ids)).join('');
}

/**
 * The verdict, stated in one sentence at the top.
 *
 * WCAG is cumulative — AA conformance requires every Level A criterion as well.
 * So one Level A failure means the page conforms at no level at all, and the
 * report should say that plainly rather than leaving the reader to infer it from
 * a violation count.
 */
function verdict(summary) {
  const a = summary.byLevel.A.violations;
  const aa = summary.byLevel.AA.violations;
  const review = summary.review;

  if (a) {
    return {
      cls: 'fail',
      headline: 'Does not conform to WCAG 2.0 — Level A failures found',
      detail:
        `${a} Level A criteri${a === 1 ? 'on is' : 'a are'} failing. Level A is the ` +
        `minimum bar, so the page currently conforms at <strong>no</strong> level — ` +
        `not A, and not AA.${aa ? ` There ${aa === 1 ? 'is' : 'are'} also ${aa} Level AA failure${aa === 1 ? '' : 's'}.` : ''} ` +
        `Fix the Level A items first.`
    };
  }
  if (aa) {
    return {
      cls: 'partial',
      headline: 'Conforms to Level A, but not to Level AA',
      detail:
        `No Level A failures — the minimum bar is met. ${aa} Level AA criteri` +
        `${aa === 1 ? 'on is' : 'a are'} still failing, which is what blocks AA conformance.`
    };
  }
  return {
    cls: 'pass',
    headline: 'No automated WCAG 2.0 A or AA failures detected',
    detail: review
      ? `Nothing failed automatically. ${review} item${review === 1 ? '' : 's'} still need${
          review === 1 ? 's' : ''
        } human review before conformance can be claimed — automated testing alone cannot prove it.`
      : 'Nothing failed automatically. Automated testing alone cannot prove conformance; the judgment-based criteria still need a human.'
  };
}

function verdictBlock(summary) {
  const v = verdict(summary);
  return `
    <div class="verdict verdict-${v.cls}">
      <h2>${esc(v.headline)}</h2>
      <p>${v.detail}</p>
    </div>`;
}

function statCard(num, label, color, sub = '') {
  return `<div class="stat">
    <div class="stat-num" style="color:${color}">${num}</div>
    <div class="stat-label">${esc(label)}</div>
    ${sub ? `<div class="stat-sub">${esc(sub)}</div>` : ''}
  </div>`;
}

/** Level A vs AA, side by side — the breakdown that decides conformance. */
function levelBreakdown(byLevel) {
  const row = (level, data, note) => `
    <tr>
      <td>${levelChip(level)}</td>
      <td class="lvl-note">${esc(note)}</td>
      <td><strong style="color:${data.violations ? '#b00020' : '#2e7d32'}">${
        data.violations
      }</strong> failing</td>
      <td>${data.review} to review</td>
    </tr>`;

  return `
    <table class="level-table">
      <thead><tr><th>Level</th><th>What it means</th><th>Violations</th><th>Review</th></tr></thead>
      <tbody>
        ${row('A', byLevel.A, 'The minimum. Any failure here means no conformance at all.')}
        ${row('AA', byLevel.AA, 'The standard legal/policy target, and what this scan aims at.')}
      </tbody>
    </table>`;
}

/**
 * A skimmable index — every issue on one screen, in the same order as the detail
 * below, each row linking to its card.
 */
function atAGlance(findings, ids) {
  const rows = PRIORITY.flatMap((band) => orderFindings(inBand(findings, band)))
    .map((f) => {
      const color = IMPACT_COLOR[f.impact];
      const badge = f.status === 'review' ? 'review' : f.impact;
      return `<tr>
        <td><span class="impact" style="background:${color}">${esc(badge)}</span></td>
        <td>${levelChip(f.level)}</td>
        <td><a href="#${esc(ids.get(f))}">${esc(f.title)}</a>
            <div class="sub">${esc(scLabel(f.sc))}</div></td>
        <td class="num-cell">${f.nodes.length}</td>
      </tr>`;
    })
    .join('');

  if (!rows) return '';

  return `
    <h2 class="section-title">Every issue at a glance
      <span class="muted">— worst first; click any row for the detail</span>
    </h2>
    <table class="glance-table">
      <thead><tr><th>Severity</th><th>Level</th><th>Issue</th><th>Elements</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/**
 * What this scan actually validated, and how.
 *
 * Without this table a reader has to take the tool's word for it. With it, they
 * can see exactly which checks ran, which criteria each one maps to, and — just
 * as importantly — where automation stops and a human has to take over. A tool
 * that hides its own limits produces false confidence, which is worse than no
 * report at all.
 */
const COVERAGE = [
  {
    area: 'Keyboard navigation — all functionality usable without a mouse',
    sc: '2.1.1, 2.1.2',
    how: 'Scripted Tab walk through the page: every focus stop recorded, keyboard traps detected, and elements that respond to a click but can never receive focus flagged.',
    auto: 'Automated'
  },
  {
    area: 'Visible keyboard focus indicators',
    sc: '2.4.7',
    how: 'Each element\'s computed style is captured unfocused, then compared while focused via a real Tab press (so :focus-visible applies). No visual change = failure.',
    auto: 'Automated'
  },
  {
    area: 'Focus order follows the page',
    sc: '2.4.3',
    how: 'The Tab sequence is compared against DOM order; positive tabindex values are flagged outright.',
    auto: 'Automated'
  },
  {
    area: 'Heading structure and semantic HTML',
    sc: '1.3.1, 2.4.6',
    how: 'axe-core landmark/heading rules, HTML_CodeSniffer structure rules, a heading-level-skip check, and full markup validation.',
    auto: 'Automated'
  },
  {
    area: 'Alternative text for informative images',
    sc: '1.1.1',
    how: 'axe-core (image-alt, input-image-alt, area-alt, object-alt, svg-img-alt). Whether the alt text is *meaningful* is judged by Claude when enabled.',
    auto: 'Automated + AI'
  },
  {
    area: 'Sufficient colour contrast',
    sc: '1.4.3',
    how: 'axe-core computes the contrast ratio of every text node against its background and checks it against the 4.5:1 / 3:1 thresholds.',
    auto: 'Automated'
  },
  {
    area: 'Information not conveyed by colour alone',
    sc: '1.4.1',
    how: 'Links inside body text are checked for a non-colour cue (underline, weight, border). Colour-only links are flagged. Charts and status indicators still need a human.',
    auto: 'Automated + review'
  },
  {
    area: 'Form labels, instructions and error messages',
    sc: '3.3.1, 3.3.2',
    how: 'axe-core label rules, plus checks for aria-invalid with no error text, constrained required fields with no instructions, and radio/checkbox groups with no fieldset or legend.',
    auto: 'Automated'
  },
  {
    area: 'Screen reader compatibility — page title, link text, landmarks',
    sc: '2.4.2, 2.4.4, 2.4.1, 4.1.2',
    how: 'axe-core (document-title, link-name, button-name, bypass, region, aria-*), plus a heuristic for vague link text such as "click here".',
    auto: 'Automated'
  },
  {
    area: 'Zoom and reflow at 200%',
    sc: '1.4.4',
    how: 'The page is re-rendered at half the viewport width (equivalent to 200% zoom) and checked for horizontal scrolling and for text clipped by fixed-height containers.',
    auto: 'Automated'
  },
  {
    area: 'Valid, parseable markup',
    sc: '4.1.1',
    how: 'Full HTML validation of the rendered DOM.',
    auto: 'Automated'
  },
  {
    area: 'W3C ACT Rules conformance',
    sc: 'Across all criteria',
    how: 'Siteimprove Alfa — the reference implementation of the W3C\'s own Accessibility Conformance Testing rules — runs against the live DOM, so contrast, focus and visibility are judged on the browser\'s computed styles.',
    auto: 'Automated'
  },
  {
    area: 'Captions, audio description, and other media alternatives',
    sc: '1.2.1–1.2.5',
    how: 'No rule engine can judge whether a caption is accurate. Claude decides from what the markup does establish — a <video> with no <track kind="captions"> fails, regardless of what the video contains — and reports its confidence.',
    auto: 'AI verdict'
  },
  {
    area: 'Meaningful sequence, sensory characteristics, error suggestion, context changes',
    sc: '1.3.2, 1.3.3, 3.2.1, 3.2.2, 3.3.3, 3.3.4',
    how: 'Judgment-based criteria no rule engine reaches. Claude returns a verdict on each, and also settles every item the engines flagged but could not decide — so the report leaves nothing for a human to triage.',
    auto: 'AI verdict'
  }
];

function coverageTable() {
  const rows = COVERAGE.map(
    (c) => `
      <tr>
        <td><strong>${esc(c.area)}</strong><div class="sub">WCAG ${esc(c.sc)}</div></td>
        <td>${esc(c.how)}</td>
        <td><span class="cov cov-${c.auto.startsWith('Automated') ? 'auto' : 'human'}">${esc(
          c.auto
        )}</span></td>
      </tr>`
  ).join('');

  return `
    <h2 class="section-title">What this scan validated
      <span class="muted">— and where automation stops</span>
    </h2>
    <table class="cov-table">
      <thead><tr><th>Area</th><th>How it was tested</th><th>Method</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="muted cov-caveat">
      Automated testing cannot prove conformance. It proves the presence of failures,
      never their absence — the judgment-based criteria always need a person.
    </p>`;
}

function aiNote(ai, remainingReview = 0) {
  if (!ai) return '';

  if (ai.skipped) {
    return `<div class="ai-note ai-note-off">
      <strong>Claude review did not run</strong> — ${esc(ai.skipped)}.
      Everything below comes from the deterministic engines, and anything they could
      not settle is left as <em>needs review</em> for a human. With an API key,
      Claude returns a verdict on all ${TOTAL_CRITERIA} criteria and settles those
      items, leaving nothing manual.
    </div>`;
  }

  const flagged = ai.flagged ?? ai.findings.length;
  const conf =
    ai.lowConfidence > 0
      ? ` ${ai.lowConfidence} verdict${ai.lowConfidence === 1 ? '' : 's'} came back
         <strong>low-confidence</strong> — those are the ones to double-check by hand.`
      : '';

  // The headline claim of the AI pass: nothing left over. Only make it when it is
  // actually true — an item Claude did not rule on is still an item somebody has
  // to look at, and saying otherwise would be a lie the reader would act on.
  const leftover =
    remainingReview > 0
      ? ` <strong>${remainingReview} item${
          remainingReview === 1 ? '' : 's'
        } still need${remainingReview === 1 ? 's' : ''} a human</strong> — Claude did not
        return a ruling on ${remainingReview === 1 ? 'it' : 'them'}.`
      : ' <strong>Nothing is left for a human to triage.</strong>';

  return `<div class="ai-note">
    <strong>Claude returned a verdict on all ${ai.checked} of the ${TOTAL_CRITERIA} WCAG 2.0 AA criteria.</strong>
    ${flagged} failed · ${ai.passed} passed · ${ai.notApplicable} not applicable to this page.
    It also settled ${ai.resolved} item${ai.resolved === 1 ? '' : 's'} the rule engines
    could not decide.${leftover}${conf}
  </div>`;
}

const REPORT_CSS = `
  :root { --ink:#1a1a2e; --muted:#5b6472; --line:#e6e8ee; --bg:#f6f7fb; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; color:var(--ink); background:var(--bg); line-height:1.55; }
  .wrap { max-width:1000px; margin:0 auto; padding:32px 24px 80px; }
  a { color:#4f46e5; }

  .report-header { background:linear-gradient(135deg,#4f46e5,#7c3aed); color:#fff; border-radius:16px; padding:28px 32px; }
  .report-header h1 { margin:0 0 6px; font-size:25px; }
  .report-header .url { word-break:break-all; opacity:.95; font-size:14px; }
  .report-header .badge { display:inline-block; margin-top:14px; background:rgba(255,255,255,.18); padding:6px 14px; border-radius:999px; font-size:13px; font-weight:600; }
  .meta-line { color:#e9e9ff; font-size:13px; margin-top:10px; }

  .verdict { border-radius:14px; padding:20px 24px; margin:22px 0; border:1px solid; }
  .verdict h2 { margin:0 0 6px; font-size:19px; }
  .verdict p { margin:0; font-size:14px; }
  .verdict-fail { background:#fdecef; border-color:#f3c2cc; color:#7a0016; }
  .verdict-partial { background:#fff6e5; border-color:#f0d9a8; color:#7a5600; }
  .verdict-pass { background:#e7f6ec; border-color:#b6e0c4; color:#1b5e35; }

  .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:12px; margin:22px 0; }
  .stat { background:#fff; border:1px solid var(--line); border-radius:12px; padding:16px; text-align:center; }
  .stat-num { font-size:28px; font-weight:700; }
  .stat-label { color:var(--muted); font-size:12px; margin-top:4px; }
  .stat-sub { color:var(--muted); font-size:11px; margin-top:2px; opacity:.85; }

  .section-title { font-size:19px; margin:34px 0 12px; }
  .muted { color:var(--muted); font-weight:400; font-size:13px; }

  .lvl { font-size:10.5px; font-weight:700; padding:3px 8px; border-radius:999px; white-space:nowrap; letter-spacing:.03em; }
  .lvl-a { background:#7a0016; color:#fff; }
  .lvl-aa { background:#1d4ed8; color:#fff; }
  .lvl-none { background:#e6e8ee; color:var(--muted); }

  .level-table, .glance-table, .issue-table { width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--line); border-radius:12px; overflow:hidden; font-size:13.5px; }
  .level-table th, .glance-table th, .issue-table th { text-align:left; background:#f0f1f6; padding:10px 12px; font-size:12px; color:var(--muted); }
  .level-table td, .glance-table td, .issue-table td { padding:11px 12px; border-top:1px solid var(--line); vertical-align:middle; }
  .glance-table td { vertical-align:top; }
  .glance-table .sub, .issue-table .sub { font-size:12px; color:var(--muted); margin-top:2px; }
  .glance-table .num-cell { text-align:center; font-weight:600; }
  .lvl-note { color:var(--muted); font-size:12.5px; }

  .band { margin:26px 0; }
  .band-title { display:flex; justify-content:space-between; align-items:baseline; gap:12px; font-size:17px; margin:0; padding:4px 0 4px 12px; border-left:5px solid #ccc; }
  .band-count { font-size:12px; color:var(--muted); font-weight:500; }
  .band-blurb { color:var(--muted); font-size:13px; margin:6px 0 12px 17px; }

  .finding { background:#fff; border:1px solid var(--line); border-left:5px solid #ccc; border-radius:12px; padding:16px 18px; margin-bottom:14px; }
  .finding-head { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .finding-head h4 { margin:0; font-size:15.5px; flex:1; min-width:220px; }
  .impact { color:#fff; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; padding:4px 8px; border-radius:6px; white-space:nowrap; }
  .finding-meta { display:flex; flex-wrap:wrap; gap:14px; font-size:12.5px; padding:9px 0; border-top:1px dashed var(--line); border-bottom:1px dashed var(--line); margin:10px 0; color:var(--muted); }
  .finding-meta strong { color:var(--ink); font-weight:600; }
  .finding-meta code { background:#f0f1f6; padding:1px 6px; border-radius:5px; }
  .finding-block { margin:8px 0; font-size:13.5px; }
  .finding-block.fix { background:#f3f2ff; border-left:3px solid #7c3aed; padding:9px 12px; border-radius:6px; }

  .steps { background:#f8f9fc; border:1px solid var(--line); border-radius:8px; padding:10px 14px 12px; margin:10px 0; }
  .steps-title { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin-bottom:6px; }
  .steps ol { margin:0; padding-left:20px; }
  .steps li { font-size:13px; margin:4px 0; }
  .steps strong { color:#1a1a2e; }

  .shot { margin:0 0 8px; }
  .shot img { max-width:100%; border:1px solid var(--line); border-radius:6px; background:#fff; display:block; }
  .shot figcaption { font-size:11px; color:var(--muted); margin-top:4px; }

  .cov-table { width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--line); border-radius:12px; overflow:hidden; font-size:13px; }
  .cov-table th { text-align:left; background:#f0f1f6; padding:10px 12px; font-size:12px; color:var(--muted); }
  .cov-table td { padding:11px 12px; border-top:1px solid var(--line); vertical-align:top; }
  .cov { font-size:10.5px; font-weight:700; padding:3px 8px; border-radius:999px; white-space:nowrap; }
  .cov-auto { background:#e7f6ec; color:#1b5e35; }
  .cov-human { background:#f3f2ff; color:#4c1d95; }
  .cov-caveat { margin-top:10px; }

  .conf { font-size:10px; font-weight:700; padding:3px 8px; border-radius:999px; text-transform:uppercase; letter-spacing:.03em; }
  .conf-medium { background:#fff6e5; color:#7a5600; }
  .conf-low { background:#fdecef; color:#7a0016; }
  .settled { font-size:10px; font-weight:700; padding:3px 8px; border-radius:999px; background:#f3f2ff; color:#4c1d95; white-space:nowrap; }

  .legend { background:#fff; border:1px solid var(--line); border-radius:12px; padding:6px 22px 18px; }
  .legend ul { margin:6px 0 0; padding-left:20px; }
  .legend li { font-size:13.5px; margin:6px 0; }

  details { margin-top:10px; }
  summary { cursor:pointer; font-size:12.5px; color:#4f46e5; font-weight:600; }
  .nodes { margin-top:10px; }
  .node { border:1px solid var(--line); border-radius:8px; padding:10px; margin-bottom:8px; background:#fbfbfd; }
  .node-target { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11.5px; color:#7c3aed; margin-bottom:6px; word-break:break-all; }
  .node-html { background:#1e1e2e; color:#e0e0f0; padding:10px; border-radius:6px; font-size:11.5px; overflow-x:auto; white-space:pre-wrap; word-break:break-word; margin:0 0 6px; }
  .node-fix { font-size:12.5px; color:#b00020; white-space:pre-wrap; }

  .all-clear { background:#e7f6ec; border:1px solid #b6e0c4; color:#1b5e35; padding:18px; border-radius:12px; font-size:15px; font-weight:600; text-align:center; }
  .ai-note { background:#f3f2ff; border:1px solid #d7d2ff; border-left:4px solid #7c3aed; border-radius:10px; padding:14px 16px; font-size:13.5px; margin-bottom:16px; }
  .ai-note-off { background:#fff6e5; border-color:#f0d9a8; border-left-color:#c79100; }
  .failed { background:#fff6e5; border:1px solid #f0d9a8; border-radius:10px; padding:12px 16px; font-size:13px; margin-bottom:16px; }

  .page-block { background:#fff; border:1px solid var(--line); border-radius:14px; padding:18px 20px; margin-bottom:18px; }
  .page-head { display:flex; justify-content:space-between; align-items:baseline; gap:16px; flex-wrap:wrap; }
  .page-head h3 { margin:0; font-size:16px; }
  .page-url { font-size:12px; color:#7c3aed; word-break:break-all; }
  .page-counts { font-size:12px; color:var(--muted); white-space:nowrap; }
  .page-clean { color:#1b5e35; font-weight:600; font-size:13px; margin-top:8px; }
  .pill { color:#fff; font-size:10px; font-weight:700; text-transform:uppercase; padding:3px 7px; border-radius:5px; white-space:nowrap; }

  footer { margin-top:40px; color:var(--muted); font-size:12px; text-align:center; }
  @media print {
    body { background:#fff; }
    .finding, .stat, .page-block, .verdict, tr { break-inside:avoid; }
    a { color:var(--ink); text-decoration:none; }
  }
`;

const LEGEND = `
  <div class="legend">
    <h2 class="section-title">How to read this report</h2>
    <ul>
      <li><strong>Level A</strong> — the minimum bar. Any Level A failure means the page conforms at <em>no</em> level, AA included. Fix these first.</li>
      <li><strong>Level AA</strong> — the target this scan is measured against, and the level most policies and laws require.</li>
      <li><strong>Severity</strong> — how badly a real user is affected: critical &gt; serious &gt; moderate &gt; minor. It is independent of level, so a Level A issue can be "moderate" and still be the one that blocks conformance.</li>
      <li><strong>Violation</strong> — a check failed outright. <strong>Needs review</strong> — a human has to decide; it is neither passed nor failed.</li>
      <li><strong>Passing an automated scan is not conformance.</strong> Automated tools reach only part of WCAG; the judgment-based criteria still need a person.</li>
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

function engineList(engines) {
  return engines.map((e) => ENGINE_LABEL[e] || e).join(' · ');
}

/**
 * Build a standalone HTML accessibility report for a single scanned page.
 */
export function generateReportHtml(scan) {
  const summary = summarize(scan);
  const generatedAt = new Date(scan.generatedAt || Date.now()).toLocaleString();
  const engines = engineList(scan.engines);
  const bl = summary.byLevel;

  const ids = anchorMap(scan.findings, 'f');
  const clean =
    summary.violations === 0 && summary.review === 0
      ? '<div class="all-clear">No WCAG 2.0 A or AA issues detected by any engine.</div>'
      : '';

  return shell(
    `Accessibility Report — ${scan.title || scan.url}`,
    `
  <header class="report-header">
    <h1>Accessibility Audit</h1>
    <div class="url">${esc(scan.finalUrl || scan.url)}</div>
    <div class="badge">Measured against ${esc(scan.level)}</div>
    <div class="meta-line">Page: ${esc(scan.title || '—')}<br/>Engines: ${esc(
      engines
    )}<br/>Generated: ${esc(generatedAt)}</div>
  </header>

  ${verdictBlock(summary)}

  <div class="stats">
    ${statCard(bl.A.violations, 'Level A failures', bl.A.violations ? '#b00020' : '#2e7d32', 'blocks all conformance')}
    ${statCard(bl.AA.violations, 'Level AA failures', bl.AA.violations ? '#d35400' : '#2e7d32', 'blocks AA')}
    ${statCard(summary.byImpact.critical, 'Critical', IMPACT_COLOR.critical)}
    ${statCard(summary.byImpact.serious, 'Serious', IMPACT_COLOR.serious)}
    ${statCard(summary.byImpact.moderate, 'Moderate', IMPACT_COLOR.moderate)}
    ${statCard(summary.byImpact.minor, 'Minor', IMPACT_COLOR.minor)}
    ${statCard(summary.review, 'Needs review', IMPACT_COLOR.review)}
    ${statCard(summary.affectedElements, 'Elements affected', '#5b6472')}
  </div>

  <h2 class="section-title">Conformance by level</h2>
  ${levelBreakdown(bl)}

  ${coverageTable()}

  ${LEGEND}

  ${aiNote(scan.aiReview, summary.review)}
  ${clean}
  ${atAGlance(scan.findings, ids)}

  <h2 class="section-title">Issues in detail
    <span class="muted">— grouped by severity, Level A first within each group</span>
  </h2>
  ${prioritySections(scan.findings, ids)}

  <footer>
    Accessibility Scanner • ${esc(engines)} • ${esc(scan.level)}
  </footer>`
  );
}

// ---------------------------------------------------------------------------
// Site report
// ---------------------------------------------------------------------------

function issueRow(issue) {
  const color = IMPACT_COLOR[issue.impact] || '#555';
  const badge = issue.status === 'review' ? 'review' : issue.impact;
  const n = issue.pages.length;
  return `
    <tr>
      <td><span class="pill" style="background:${color}">${esc(badge)}</span></td>
      <td>${levelChip(issue.level)}</td>
      <td>
        <strong>${esc(issue.title)}</strong>
        <div class="sub">${esc(scLabel(issue.sc))} · found by ${esc(
          ENGINE_SHORT[issue.engine] || issue.engine
        )}</div>
      </td>
      <td class="num-cell"><strong>${n}</strong> page${n === 1 ? '' : 's'}<div class="sub">${
        issue.elements
      } element${issue.elements === 1 ? '' : 's'}</div></td>
    </tr>`;
}

function pageBlock(page, idx) {
  const s = page.summary;
  const url = page.finalUrl || page.url;
  const bl = s.byLevel;
  const total = s.violations + s.review;

  const body =
    total === 0
      ? '<div class="page-clean">No issues found on this page.</div>'
      : `<details>
           <summary>Show all ${total} finding${total === 1 ? '' : 's'} on this page, in priority order</summary>
           ${prioritySections(page.findings, anchorMap(page.findings, `p${idx}`))}
         </details>`;

  return `
    <div class="page-block">
      <div class="page-head">
        <div>
          <h3>${idx}. ${esc(page.title || 'Untitled page')}</h3>
          <div class="page-url">${esc(url)}</div>
        </div>
        <div class="page-counts">
          ${levelChip('A')} ${bl.A.violations} · ${levelChip('AA')} ${bl.AA.violations}
          <br/>${s.review} to review · ${s.affectedElements} element${
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
 * Leads with the site-wide picture — which problems repeat across pages — then
 * drops into per-page detail. A template-level bug is worth fixing before
 * anything one page happens to have.
 */
export function generateSiteReportHtml(site) {
  const t = site.totals;
  const generatedAt = new Date(site.generatedAt || Date.now()).toLocaleString();
  const engines = engineList(site.engines);
  const bl = t.byLevel;

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

  const issuesTable =
    t.violations === 0 && t.review === 0
      ? `<div class="all-clear">No WCAG 2.0 A or AA issues detected on any of the ${t.pages} pages scanned.</div>`
      : `<table class="issue-table">
          <thead><tr><th>Severity</th><th>Level</th><th>Issue</th><th>Reach</th></tr></thead>
          <tbody>${site.issues.map(issueRow).join('')}</tbody>
         </table>`;

  return shell(
    `Accessibility Report — ${site.site}`,
    `
  <header class="report-header">
    <h1>Site Accessibility Audit</h1>
    <div class="url">${esc(site.site)}</div>
    <div class="badge">Measured against ${esc(site.level)}</div>
    <div class="meta-line">Pages scanned: ${t.pages}${esc(capped)}<br/>Sitemap: ${esc(
      site.sitemaps.join(', ')
    )}<br/>Engines: ${esc(engines)}<br/>Generated: ${esc(generatedAt)}</div>
  </header>

  ${verdictBlock(t)}

  <div class="stats">
    ${statCard(t.pages, 'Pages scanned', '#4f46e5')}
    ${statCard(bl.A.violations, 'Level A failures', bl.A.violations ? '#b00020' : '#2e7d32', 'blocks all conformance')}
    ${statCard(bl.AA.violations, 'Level AA failures', bl.AA.violations ? '#d35400' : '#2e7d32', 'blocks AA')}
    ${statCard(t.byImpact.critical, 'Critical', IMPACT_COLOR.critical)}
    ${statCard(t.byImpact.serious, 'Serious', IMPACT_COLOR.serious)}
    ${statCard(t.byImpact.moderate, 'Moderate', IMPACT_COLOR.moderate)}
    ${statCard(t.review, 'Needs review', IMPACT_COLOR.review)}
    ${statCard(t.affectedElements, 'Elements affected', '#5b6472')}
  </div>

  <h2 class="section-title">Conformance by level <span class="muted">— across all pages</span></h2>
  ${levelBreakdown(bl)}

  ${coverageTable()}

  ${LEGEND}

  <h2 class="section-title">Issues across the site
    <span class="muted">— worst first, then by how many pages they affect</span>
  </h2>
  ${aiNote(t.ai, t.review)}
  ${failedBlock}
  ${issuesTable}

  <h2 class="section-title">Page-by-page detail</h2>
  ${site.pages.map((p, i) => pageBlock(p, i + 1)).join('')}

  <footer>
    Accessibility Scanner • ${esc(engines)} • ${esc(site.level)}
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
