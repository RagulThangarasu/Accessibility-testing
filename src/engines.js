import { createRequire } from 'module';
import { HtmlValidate } from 'html-validate';

const require = createRequire(import.meta.url);
const HTMLCS_PATH = require.resolve('html_codesniffer/build/HTMLCS.js');

// ---------------------------------------------------------------------------
// Success-criterion helpers
// ---------------------------------------------------------------------------

// axe tags look like "wcag111" (1.1.1), "wcag412" (4.1.2), "wcag1410" (1.4.10).
export function scFromAxeTags(tags = []) {
  for (const t of tags) {
    const m = /^wcag(\d)(\d)(\d+)$/.exec(t);
    if (m) return `${m[1]}.${m[2]}.${m[3]}`;
  }
  return '';
}

// HTMLCS codes embed the SC, e.g. "...Guideline1_1.1_1_1.H37" -> 1.1.1
export function scFromHtmlcsCode(code = '') {
  const m = /\.(\d+)_(\d+)_(\d+)\./.exec(code);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : '';
}

// Plain-English name for each WCAG 2.0 success criterion, so the report can
// show "1.1.1 Non-text Content" instead of a bare number and no external link.
const SC_NAMES = {
  '1.1.1': 'Non-text Content',
  '1.2.1': 'Audio-only and Video-only (Prerecorded)',
  '1.2.2': 'Captions (Prerecorded)',
  '1.2.3': 'Audio Description or Media Alternative (Prerecorded)',
  '1.2.4': 'Captions (Live)',
  '1.2.5': 'Audio Description (Prerecorded)',
  '1.3.1': 'Info and Relationships',
  '1.3.2': 'Meaningful Sequence',
  '1.3.3': 'Sensory Characteristics',
  '1.3.4': 'Orientation',
  '1.3.5': 'Identify Input Purpose',
  '1.4.1': 'Use of Color',
  '1.4.2': 'Audio Control',
  '1.4.3': 'Contrast (Minimum)',
  '1.4.4': 'Resize Text',
  '1.4.5': 'Images of Text',
  '1.4.10': 'Reflow',
  '1.4.11': 'Non-text Contrast',
  '1.4.12': 'Text Spacing',
  '1.4.13': 'Content on Hover or Focus',
  '2.1.1': 'Keyboard',
  '2.1.2': 'No Keyboard Trap',
  '2.1.4': 'Character Key Shortcuts',
  '2.2.1': 'Timing Adjustable',
  '2.2.2': 'Pause, Stop, Hide',
  '2.3.1': 'Three Flashes or Below Threshold',
  '2.4.1': 'Bypass Blocks',
  '2.4.2': 'Page Titled',
  '2.4.3': 'Focus Order',
  '2.4.4': 'Link Purpose (In Context)',
  '2.4.5': 'Multiple Ways',
  '2.4.6': 'Headings and Labels',
  '2.4.7': 'Focus Visible',
  '2.5.1': 'Pointer Gestures',
  '2.5.2': 'Pointer Cancellation',
  '2.5.3': 'Label in Name',
  '2.5.4': 'Motion Actuation',
  '3.1.1': 'Language of Page',
  '3.1.2': 'Language of Parts',
  '3.2.1': 'On Focus',
  '3.2.2': 'On Input',
  '3.2.3': 'Consistent Navigation',
  '3.2.4': 'Consistent Identification',
  '3.3.1': 'Error Identification',
  '3.3.2': 'Labels or Instructions',
  '3.3.3': 'Error Suggestion',
  '3.3.4': 'Error Prevention (Legal, Financial, Data)',
  '4.1.1': 'Parsing',
  '4.1.2': 'Name, Role, Value',
  '4.1.3': 'Status Messages'
};

export function scName(sc) {
  return SC_NAMES[sc] || '';
}

// ---------------------------------------------------------------------------
// Engine 2 — HTML_CodeSniffer (WCAG2AA standard)
// ---------------------------------------------------------------------------

export async function runHtmlcs(page) {
  await page.addScriptTag({ path: HTMLCS_PATH });
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        function selectorFor(el) {
          if (!el || !el.tagName) return '';
          const tag = el.tagName.toLowerCase();
          if (el.id) return `${tag}#${el.id}`;
          let sel = tag;
          if (el.className && typeof el.className === 'string') {
            const c = el.className.trim().split(/\s+/).slice(0, 2).join('.');
            if (c) sel += `.${c}`;
          }
          return sel;
        }
        try {
          window.HTMLCS.process(
            'WCAG2AA',
            window.document,
            () => {
              const msgs = window.HTMLCS.getMessages().map((m) => ({
                type: m.type, // 1 error, 2 warning, 3 notice
                code: m.code,
                msg: m.msg,
                selector: selectorFor(m.element),
                html:
                  m.element && m.element.outerHTML
                    ? m.element.outerHTML.slice(0, 400)
                    : ''
              }));
              resolve(msgs);
            },
            () => resolve([])
          );
        } catch {
          resolve([]);
        }
      })
  );
}

function shortHtmlcsCode(code = '') {
  // Drop the WCAG2AA.PrincipleX.GuidelineX_Y.X_Y_Z prefix; keep technique tail.
  const parts = code.split('.');
  return parts.slice(4).join('.') || code;
}

export function normalizeHtmlcs(raw = []) {
  const groups = new Map();
  for (const m of raw) {
    if (m.type !== 1 && m.type !== 2) continue; // skip notices (type 3)
    if (!groups.has(m.code)) {
      const short = shortHtmlcsCode(m.code);
      const sc = scFromHtmlcsCode(m.code);
      groups.set(m.code, {
        engine: 'HTML_CodeSniffer',
        status: m.type === 1 ? 'violation' : 'review',
        impact: m.type === 1 ? 'serious' : 'review',
        ruleId: short,
        sc,
        title: m.msg,
        description: '',
        fix: '',
        nodes: []
      });
    }
    groups.get(m.code).nodes.push({
      selector: m.selector,
      html: m.html,
      summary: ''
    });
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// Engine 3 — html-validate (markup validity -> SC 4.1.1 Parsing)
// ---------------------------------------------------------------------------

// Curated rule set focused on genuine parsing/structure problems, so findings
// map cleanly to 4.1.1 and don't drown the report in stylistic noise.
const htmlValidate = new HtmlValidate({
  root: true,
  rules: {
    'no-dup-id': 'error',
    'no-dup-attr': 'error',
    'no-dup-class': 'off',
    'close-order': 'error',
    'close-attr': 'error',
    'no-implicit-close': 'error',
    'void-content': 'error',
    'element-permitted-content': 'error',
    'element-permitted-order': 'error',
    'element-required-attributes': 'error',
    'attr-delimiter': 'error',
    'unrecognized-char-ref': 'error',
    'no-deprecated-attr': 'error'
  }
});

export async function runHtmlValidate(html) {
  try {
    return await htmlValidate.validateString(html);
  } catch {
    return { results: [] };
  }
}

const HV_FIX = {
  'no-dup-id': 'Make every id attribute unique — no two elements may share the same id.',
  'no-dup-attr': 'Remove the duplicated attribute so each attribute appears only once on the element.',
  'close-order': 'Close tags in the correct nesting order and remove any stray closing tags.',
  'close-attr': 'Fix the malformed or unclosed attribute / tag.',
  'no-implicit-close': 'Add the missing closing tag instead of relying on the browser to auto-close it.',
  'void-content': 'Void elements (img, br, input, hr…) must not have content or a closing tag.',
  'element-permitted-content': 'Only nest elements where HTML allows them (e.g. do not put a <div> inside a <p>).',
  'element-permitted-order': 'Place child elements in the order the HTML spec requires.',
  'element-required-attributes': 'Add the attribute(s) this element is required to have.',
  'attr-delimiter': 'Wrap the attribute value in quotes.',
  'unrecognized-char-ref': 'Use a valid HTML entity (for example &amp; instead of a bare &).',
  'no-deprecated-attr': 'Replace the deprecated HTML attribute with a current CSS or HTML equivalent.'
};

export function normalizeHtmlValidate(report) {
  const groups = new Map();
  for (const result of report.results || []) {
    for (const m of result.messages || []) {
      if (!groups.has(m.ruleId)) {
        groups.set(m.ruleId, {
          engine: 'html-validate',
          status: m.severity === 2 ? 'violation' : 'review',
          impact: m.severity === 2 ? 'moderate' : 'review',
          ruleId: m.ruleId,
          sc: '4.1.1',
          title: m.message,
          description:
            'Invalid HTML markup. Browsers and assistive technologies may interpret malformed markup differently, which can break the page for screen-reader users (WCAG 4.1.1 Parsing).',
          fix: HV_FIX[m.ruleId] || 'Correct the markup so the HTML is valid and well-formed.',
          nodes: []
        });
      }
      groups.get(m.ruleId).nodes.push({
        selector: m.selector || '',
        html: '',
        summary: `Line ${m.line}, col ${m.column}: ${m.message}`
      });
    }
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// Engine 4 — additional reliable DOM checks
// ---------------------------------------------------------------------------

export async function runExtraChecks(page) {
  return page.evaluate(() => {
    const sel = (el) => {
      if (!el || !el.tagName) return '';
      const tag = el.tagName.toLowerCase();
      if (el.id) return `${tag}#${el.id}`;
      let s = tag;
      if (el.className && typeof el.className === 'string') {
        const c = el.className.trim().split(/\s+/).slice(0, 2).join('.');
        if (c) s += `.${c}`;
      }
      return s;
    };
    const out = {
      autoplay: [],
      metaRefresh: [],
      blink: [],
      ambiguousLinks: [],
      headings: { skips: [] }
    };

    // 1.4.2 Audio Control — autoplaying, non-muted media
    document.querySelectorAll('audio[autoplay], video[autoplay]').forEach((el) => {
      if (!el.muted && !el.hasAttribute('muted')) {
        out.autoplay.push({ selector: sel(el), html: el.outerHTML.slice(0, 300) });
      }
    });

    // 2.2.1 Timing Adjustable — meta refresh / redirect
    document.querySelectorAll('meta[http-equiv="refresh" i]').forEach((el) => {
      out.metaRefresh.push({
        selector: 'meta[http-equiv=refresh]',
        html: el.outerHTML.slice(0, 300)
      });
    });

    // 2.2.2 Pause, Stop, Hide — blink/marquee
    document.querySelectorAll('blink, marquee').forEach((el) => {
      out.blink.push({ selector: sel(el), html: el.outerHTML.slice(0, 200) });
    });

    // 2.4.4 Link Purpose — ambiguous link text without accessible context
    const bad = new Set([
      'click here', 'here', 'read more', 'more', 'learn more',
      'details', 'link', 'this', 'continue', 'go', 'read', 'view'
    ]);
    document.querySelectorAll('a[href]').forEach((a) => {
      const txt = (a.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const acc = (a.getAttribute('aria-label') || a.getAttribute('title') || '').trim();
      if (txt && bad.has(txt) && !acc) {
        out.ambiguousLinks.push({ selector: sel(a), html: a.outerHTML.slice(0, 200) });
      }
    });

    // 1.3.1 / 2.4.6 Heading hierarchy
    const heads = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    let prev = 0;
    for (const h of heads) {
      const lvl = +h.tagName[1];
      if (prev && lvl > prev + 1) {
        out.headings.skips.push({
          selector: sel(h),
          html: h.outerHTML.slice(0, 200),
          summary: `Heading level skipped: h${prev} → h${lvl}`
        });
      }
      prev = lvl;
    }
    return out;
  });
}

function mk(impact, status, ruleId, sc, title, description, fix, nodes) {
  return {
    engine: 'checks',
    status,
    impact,
    ruleId,
    sc,
    title,
    description,
    fix,
    nodes
  };
}

export function normalizeExtraChecks(data) {
  const findings = [];

  if (data.autoplay.length) {
    findings.push(
      mk('serious', 'violation', 'autoplay-media', '1.4.2',
        'Audio or video plays automatically with no way to stop it',
        'Media that plays automatically for more than 3 seconds can interfere with screen readers and distract users who cannot easily stop it.',
        'Remove autoplay, start the media muted, or add a clearly visible pause/stop/volume control near the top of the page.',
        data.autoplay.map((n) => ({ ...n, summary: '' })))
    );
  }

  if (data.metaRefresh.length) {
    findings.push(
      mk('moderate', 'violation', 'meta-refresh', '2.2.1',
        'Page auto-refreshes or redirects on a timer',
        'A <meta http-equiv="refresh"> reloads or redirects the page automatically. This can move users away before they finish reading or interacting.',
        'Remove the meta refresh. If you must redirect, use a server-side 301/302 redirect, or let the user turn off / extend the timer.',
        data.metaRefresh.map((n) => ({ ...n, summary: '' })))
    );
  }

  if (data.blink.length) {
    findings.push(
      mk('serious', 'violation', 'blink-marquee', '2.2.2',
        'Page uses <blink> or <marquee> (auto-moving content)',
        'Content that blinks or scrolls on its own is hard to read and can be a problem for people with attention or vestibular conditions.',
        'Replace <blink>/<marquee> with static content, or a CSS animation the user can pause or that respects prefers-reduced-motion.',
        data.blink.map((n) => ({ ...n, summary: '' })))
    );
  }

  if (data.ambiguousLinks.length) {
    findings.push(
      mk('review', 'review', 'ambiguous-link-text', '2.4.4',
        'Links with vague text such as "click here" or "read more"',
        'Screen-reader users often jump between links out of context. Vague link text does not tell them where the link goes.',
        'Rewrite the link text to describe its destination (e.g. "Read the 2024 security report"), or add an aria-label with the full purpose.',
        data.ambiguousLinks.map((n) => ({ ...n, summary: '' })))
    );
  }

  if (data.headings.skips.length) {
    findings.push(
      mk('review', 'review', 'heading-order-advisory', '2.4.6',
        'Heading levels are skipped',
        'Headings jump a level (for example from <h2> straight to <h4>). This can make the document outline harder to follow for assistive technology users.',
        'Use heading levels in order without skipping (h1 → h2 → h3). Control the visual size with CSS instead of changing the level.',
        data.headings.skips)
    );
  }

  return findings;
}
