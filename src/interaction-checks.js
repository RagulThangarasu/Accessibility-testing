/**
 * Checks that require *driving* the page, not just reading its DOM.
 *
 * The rule engines (axe, HTMLCS) inspect a static snapshot. They cannot press
 * Tab, they cannot zoom the viewport, and they cannot tell whether focusing an
 * element changes how it looks. Those criteria — 2.1.1, 2.1.2, 2.4.3, 2.4.7,
 * 1.4.4 — are exactly the ones people assume are covered and aren't. This module
 * covers them by actually operating the page.
 */

const FOCUSABLE =
  'a[href], button, input:not([type="hidden"]), select, textarea, summary, ' +
  '[tabindex], [contenteditable="true"], audio[controls], video[controls]';

// Tab walks are bounded: a long page can have hundreds of stops, and we only
// need enough of the order to judge it.
const MAX_TABS = 75;

// ---------------------------------------------------------------------------
// Keyboard: reachability, traps, focus order, focus visibility
// ---------------------------------------------------------------------------

/**
 * Walk the page with the Tab key exactly as a keyboard user would.
 *
 * The baseline pass records how each focusable element looks *unfocused*. The
 * Tab walk then compares each element against its own baseline while focused —
 * that difference is the visible focus indicator. Real Tab presses are used
 * rather than element.focus(), because `:focus-visible` styles (the modern way
 * to draw focus rings) only apply to keyboard focus and would be missed by a
 * programmatic focus call.
 */
export async function runKeyboardChecks(page) {
  // Tag every focusable element so we can identify it across evaluate() calls,
  // and snapshot its resting appearance.
  const baseline = await page.evaluate((sel) => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return (
        r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
      );
    };
    const style = (el) => {
      const s = getComputedStyle(el);
      return [
        s.outlineStyle,
        s.outlineWidth,
        s.outlineColor,
        s.boxShadow,
        s.border,
        s.backgroundColor,
        s.color,
        s.textDecorationLine
      ].join('|');
    };
    const describe = (el) => {
      const tag = el.tagName.toLowerCase();
      let s = tag;
      if (el.id) s += `#${el.id}`;
      else if (el.className && typeof el.className === 'string') {
        const c = el.className.trim().split(/\s+/).slice(0, 2).join('.');
        if (c) s += `.${c}`;
      }
      return s;
    };

    const els = [...document.querySelectorAll(sel)];
    const out = [];
    els.forEach((el, i) => {
      el.setAttribute('data-a11y-idx', String(i));
      const ti = el.getAttribute('tabindex');
      out.push({
        idx: i,
        selector: describe(el),
        html: el.outerHTML.slice(0, 200),
        tabindex: ti === null ? null : Number(ti),
        visible: visible(el),
        native: ['a', 'button', 'input', 'select', 'textarea', 'summary'].includes(
          el.tagName.toLowerCase()
        ),
        style: style(el),
        label: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 60)
      });
    });
    return out;
  }, FOCUSABLE);

  // Walk the page with Tab and record where focus actually lands.
  await page.evaluate(() => {
    document.body.setAttribute('tabindex', '-1');
    document.body.focus();
  });

  const stops = [];
  let stuck = 0;
  let lastIdx = null;

  for (let i = 0; i < MAX_TABS; i++) {
    await page.keyboard.press('Tab');

    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      return {
        idx: el.hasAttribute('data-a11y-idx') ? Number(el.getAttribute('data-a11y-idx')) : -1,
        tag: el.tagName.toLowerCase(),
        style: [
          s.outlineStyle,
          s.outlineWidth,
          s.outlineColor,
          s.boxShadow,
          s.border,
          s.backgroundColor,
          s.color,
          s.textDecorationLine
        ].join('|')
      };
    });

    if (!stop) break; // focus left the document (browser chrome) — the walk is done
    if (stop.idx === lastIdx) {
      // Focus refused to move. Three in a row is a trap, not a coincidence.
      if (++stuck >= 3) break;
    } else {
      stuck = 0;
    }
    lastIdx = stop.idx;
    stops.push(stop);

    // A full cycle back to the first stop means we've seen the whole tab ring.
    if (stops.length > 1 && stop.idx === stops[0].idx) break;
  }

  return { baseline, stops, trapped: stuck >= 3, lastIdx };
}

/** Elements that respond to a click but that a keyboard can never reach. */
export async function runMouseOnlyChecks(page) {
  return page.evaluate(() => {
    const describe = (el) => {
      const tag = el.tagName.toLowerCase();
      if (el.id) return `${tag}#${el.id}`;
      const c =
        el.className && typeof el.className === 'string'
          ? el.className.trim().split(/\s+/).slice(0, 2).join('.')
          : '';
      return c ? `${tag}.${c}` : tag;
    };
    const NATIVE = ['a', 'button', 'input', 'select', 'textarea', 'summary'];
    const INTERACTIVE_ROLES = ['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem'];

    const out = [];
    for (const el of document.querySelectorAll('[onclick], [role]')) {
      const tag = el.tagName.toLowerCase();
      if (NATIVE.includes(tag)) continue;

      const role = el.getAttribute('role');
      const clickable = el.hasAttribute('onclick') || INTERACTIVE_ROLES.includes(role);
      if (!clickable) continue;

      const ti = el.getAttribute('tabindex');
      const focusable = ti !== null && Number(ti) >= 0;
      if (focusable) continue;

      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;

      out.push({
        selector: describe(el),
        html: el.outerHTML.slice(0, 200),
        reason: role
          ? `has role="${role}" but no tabindex, so Tab never reaches it`
          : 'has a click handler but no tabindex, so Tab never reaches it'
      });
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// 1.4.1 Use of Color — links told apart from body text by colour alone
// ---------------------------------------------------------------------------

export async function runColorOnlyChecks(page) {
  return page.evaluate(() => {
    const describe = (el) => {
      const tag = el.tagName.toLowerCase();
      if (el.id) return `${tag}#${el.id}`;
      const c =
        el.className && typeof el.className === 'string'
          ? el.className.trim().split(/\s+/).slice(0, 2).join('.')
          : '';
      return c ? `${tag}.${c}` : tag;
    };

    const out = [];
    for (const a of document.querySelectorAll('a[href]')) {
      const parent = a.parentElement;
      if (!parent) continue;

      // Only links sitting *inside running text* are at risk. A link in a nav bar
      // or a card is identifiable by position; one buried in a paragraph is not.
      const parentText = (parent.textContent || '').replace(a.textContent || '', '').trim();
      if (parentText.length < 20) continue;

      const as = getComputedStyle(a);
      const ps = getComputedStyle(parent);

      const underlined = as.textDecorationLine.includes('underline');
      const bordered = parseFloat(as.borderBottomWidth) > 0;
      const bolder = parseInt(as.fontWeight, 10) > parseInt(ps.fontWeight, 10);
      const differentBg = as.backgroundColor !== ps.backgroundColor &&
        as.backgroundColor !== 'rgba(0, 0, 0, 0)';
      const colored = as.color !== ps.color;

      // Colour is the only signal: the link differs in colour and in nothing else.
      if (colored && !underlined && !bordered && !bolder && !differentBg) {
        const r = a.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        out.push({
          selector: describe(a),
          html: a.outerHTML.slice(0, 200),
          linkColor: as.color,
          textColor: ps.color
        });
      }
    }
    return out.slice(0, 25);
  });
}

// ---------------------------------------------------------------------------
// 3.3.1 / 3.3.2 — form errors and instructions
// ---------------------------------------------------------------------------

export async function runFormChecks(page) {
  return page.evaluate(() => {
    const describe = (el) => {
      const tag = el.tagName.toLowerCase();
      if (el.id) return `${tag}#${el.id}`;
      if (el.name) return `${tag}[name="${el.name}"]`;
      return tag;
    };

    const out = { invalidNoMessage: [], requiredNoHint: [], groupsNoFieldset: [] };

    // An input marked invalid must SAY what is wrong, in text. A red border is
    // not an error message.
    for (const el of document.querySelectorAll('[aria-invalid="true"]')) {
      const described = el.getAttribute('aria-describedby');
      const hasText = described
        ? described
            .split(/\s+/)
            .some((id) => (document.getElementById(id)?.textContent || '').trim().length > 0)
        : false;
      if (!hasText) {
        out.invalidNoMessage.push({
          selector: describe(el),
          html: el.outerHTML.slice(0, 200)
        });
      }
    }

    // A required field with a constraint (pattern, minlength, type=email…) needs
    // to tell the user the rule *before* they get it wrong.
    for (const el of document.querySelectorAll(
      'input[required], select[required], textarea[required], [aria-required="true"]'
    )) {
      const constrained =
        el.hasAttribute('pattern') ||
        el.hasAttribute('minlength') ||
        el.hasAttribute('min') ||
        el.hasAttribute('max') ||
        ['email', 'tel', 'url', 'number', 'password'].includes(el.getAttribute('type') || '');
      if (!constrained) continue;

      const hint =
        el.getAttribute('aria-describedby') || el.getAttribute('title') || el.getAttribute('placeholder');
      if (!hint) {
        out.requiredNoHint.push({
          selector: describe(el),
          html: el.outerHTML.slice(0, 200),
          rule: el.getAttribute('pattern')
            ? `pattern="${el.getAttribute('pattern')}"`
            : `type="${el.getAttribute('type') || 'text'}"`
        });
      }
    }

    // Radio/checkbox groups need a shared, programmatic label — that is what
    // <fieldset><legend> is for. Without it a screen reader announces each option
    // with no idea what question it answers.
    const groups = {};
    for (const el of document.querySelectorAll(
      'input[type="radio"][name], input[type="checkbox"][name]'
    )) {
      (groups[el.name] ||= []).push(el);
    }
    for (const [name, els] of Object.entries(groups)) {
      if (els.length < 2) continue;
      const first = els[0];
      const fs = first.closest('fieldset');
      const hasLegend = fs && fs.querySelector('legend')?.textContent.trim();
      const grouped = first.closest('[role="group"], [role="radiogroup"]');
      const labelled =
        grouped &&
        (grouped.getAttribute('aria-label') || grouped.getAttribute('aria-labelledby'));

      if (!hasLegend && !labelled) {
        out.groupsNoFieldset.push({
          selector: `input[name="${name}"]`,
          html: first.outerHTML.slice(0, 200),
          count: els.length,
          name
        });
      }
    }

    return out;
  });
}

// ---------------------------------------------------------------------------
// 1.4.4 Resize Text — the page at 200%
// ---------------------------------------------------------------------------

/**
 * Re-render the page at 200% zoom and look for content that breaks.
 *
 * Halving the viewport width is how a browser's 200% zoom actually behaves: the
 * layout gets half as many CSS pixels to work with. Content that then spills
 * sideways or gets clipped is content the user has lost.
 */
export async function runZoomChecks(context, url, { width = 1366, height = 900 } = {}) {
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: Math.round(width / 2), height });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2000);

    return await page.evaluate(() => {
      const describe = (el) => {
        const tag = el.tagName.toLowerCase();
        if (el.id) return `${tag}#${el.id}`;
        const c =
          el.className && typeof el.className === 'string'
            ? el.className.trim().split(/\s+/).slice(0, 2).join('.')
            : '';
        return c ? `${tag}.${c}` : tag;
      };

      const vw = document.documentElement.clientWidth;
      const out = { horizontalScroll: false, overflowWidth: 0, spilling: [], clipped: [] };

      // A horizontal scrollbar at 200% means the user must scroll in two
      // directions to read one line of text.
      const docWidth = Math.max(
        document.documentElement.scrollWidth,
        document.body ? document.body.scrollWidth : 0
      );
      if (docWidth > vw + 2) {
        out.horizontalScroll = true;
        out.overflowWidth = Math.round(docWidth - vw);

        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right <= vw + 2) continue;
          // Report the outermost offenders, not every descendant of them.
          if (el.parentElement && el.parentElement.getBoundingClientRect().right > vw + 2) continue;
          out.spilling.push({
            selector: describe(el),
            html: el.outerHTML.slice(0, 200),
            overhang: Math.round(r.right - vw)
          });
          if (out.spilling.length >= 10) break;
        }
      }

      // Text cut off by a fixed height: the words are there in the DOM but the
      // user cannot see them.
      for (const el of document.querySelectorAll('body *')) {
        const s = getComputedStyle(el);
        if (s.overflow !== 'hidden' && s.overflowY !== 'hidden') continue;
        if (el.scrollHeight <= el.clientHeight + 3) continue;
        if (el.clientHeight === 0) continue;
        const text = (el.textContent || '').trim();
        if (text.length < 12) continue;
        out.clipped.push({
          selector: describe(el),
          html: el.outerHTML.slice(0, 200),
          hidden: Math.round(el.scrollHeight - el.clientHeight)
        });
        if (out.clipped.length >= 10) break;
      }

      return out;
    });
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// Normalizers — turn the raw results into standard findings
// ---------------------------------------------------------------------------

function mk(impact, status, ruleId, sc, title, description, fix, nodes) {
  return { engine: 'checks', status, impact, ruleId, sc, title, description, fix, nodes };
}

export function normalizeKeyboard(kb, mouseOnly) {
  const findings = [];
  const { baseline, stops, trapped } = kb;

  // 2.4.7 — focused elements that look identical to unfocused ones.
  const byIdx = new Map(baseline.map((b) => [b.idx, b]));
  const noFocusStyle = [];
  for (const stop of stops) {
    const base = byIdx.get(stop.idx);
    if (!base || !base.visible) continue;
    if (stop.style === base.style) {
      noFocusStyle.push({
        selector: base.selector,
        html: base.html,
        summary: 'Focusing this element with Tab produces no visible change at all.'
      });
    }
  }
  if (noFocusStyle.length) {
    findings.push(
      mk(
        'serious',
        'violation',
        'focus-not-visible',
        '2.4.7',
        'Keyboard focus is invisible on some controls',
        'When these elements receive keyboard focus, nothing about them changes visually — no outline, border, shadow, or colour shift. A keyboard user cannot tell where they are on the page.',
        'Give every focusable element a visible focus style, e.g. `:focus-visible { outline: 2px solid #005fcc; outline-offset: 2px; }`. Never remove the default outline without replacing it.',
        noFocusStyle.slice(0, 15)
      )
    );
  }

  // 2.1.2 — Tab cannot escape.
  if (trapped) {
    const base = byIdx.get(kb.lastIdx);
    findings.push(
      mk(
        'critical',
        'violation',
        'keyboard-trap',
        '2.1.2',
        'Keyboard focus is trapped and cannot move on',
        'Pressing Tab repeatedly does not move focus past this point. A keyboard-only user is stuck here and cannot reach the rest of the page.',
        'Make sure every component releases focus on Tab. If this is a modal, implement a deliberate focus loop with an Escape key that closes it and restores focus.',
        base ? [{ selector: base.selector, html: base.html, summary: 'Focus does not advance past this element.' }] : []
      )
    );
  }

  // 2.4.3 — a positive tabindex overrides the natural order.
  const positive = baseline.filter((b) => b.tabindex > 0);
  if (positive.length) {
    findings.push(
      mk(
        'moderate',
        'violation',
        'positive-tabindex',
        '2.4.3',
        'Positive tabindex forces an unnatural focus order',
        'A tabindex greater than 0 pulls elements to the front of the tab order, ahead of everything else on the page. The result is a focus order that no longer matches what the user sees.',
        'Use tabindex="0" (focusable, natural order) or tabindex="-1" (focusable only by script). Reorder the DOM instead of overriding the tab sequence.',
        positive.slice(0, 15).map((b) => ({
          selector: b.selector,
          html: b.html,
          summary: `tabindex="${b.tabindex}" jumps this element ahead in the tab order.`
        }))
      )
    );
  }

  // 2.4.3 — focus jumps around relative to DOM order.
  const seq = stops.map((s) => s.idx).filter((i) => i >= 0);
  const jumps = seq.filter((v, i) => i > 0 && v < seq[i - 1]).length;
  if (jumps > 1 && !positive.length) {
    findings.push(
      mk(
        'review',
        'review',
        'focus-order-mismatch',
        '2.4.3',
        'Focus order does not follow the order of the page',
        `Tabbing moved backwards through the document ${jumps} times. This often means the visual order and the DOM order disagree (for example, CSS flex/grid \`order\`, or absolutely positioned content).`,
        'Tab through the page and confirm the focus order still makes sense to someone reading it. If it does not, reorder the DOM to match the visual layout rather than repositioning with CSS.',
        []
      )
    );
  }

  // 2.1.1 — clickable but not reachable.
  if (mouseOnly.length) {
    findings.push(
      mk(
        'serious',
        'violation',
        'mouse-only-control',
        '2.1.1',
        'Controls that work with a mouse but not a keyboard',
        'These elements act like buttons or links when clicked, but they cannot be reached with the Tab key and cannot be activated with Enter or Space. Anyone who does not use a mouse cannot operate them at all.',
        'Use a real <button> or <a href>. If you must keep a <div>, add tabindex="0", a role, and key handlers for Enter and Space.',
        mouseOnly.slice(0, 15).map((m) => ({
          selector: m.selector,
          html: m.html,
          summary: m.reason
        }))
      )
    );
  }

  return findings;
}

export function normalizeColorOnly(items) {
  if (!items.length) return [];
  return [
    mk(
      'review',
      'review',
      'link-color-only',
      '1.4.1',
      'Links in body text are distinguished by colour alone',
      'These links sit inside paragraphs of text and differ from the surrounding words only in colour — no underline, no weight change, no border. Users who cannot distinguish those colours cannot tell there is a link there.',
      'Underline links in body text, or give them another non-colour cue (weight, an icon, a bottom border). Confirm the cue is present at rest, not only on hover.',
      items.map((i) => ({
        selector: i.selector,
        html: i.html,
        summary: `Link colour ${i.linkColor} vs surrounding text ${i.textColor}, with no other visual difference.`
      }))
    )
  ];
}

export function normalizeForms(f) {
  const findings = [];

  if (f.invalidNoMessage.length) {
    findings.push(
      mk(
        'serious',
        'violation',
        'error-not-described',
        '3.3.1',
        'A field is marked invalid but never says what is wrong',
        'The field carries aria-invalid="true" but no text explains the error. A screen reader announces "invalid" and nothing more — the user knows something is wrong but not what.',
        'Point aria-describedby at an element containing the error text, e.g. `<input aria-invalid="true" aria-describedby="email-err">` with `<p id="email-err">Enter an email address like name@example.com.</p>`.',
        f.invalidNoMessage.map((n) => ({
          selector: n.selector,
          html: n.html,
          summary: 'aria-invalid="true" with no associated error message.'
        }))
      )
    );
  }

  if (f.requiredNoHint.length) {
    findings.push(
      mk(
        'moderate',
        'violation',
        'input-no-instructions',
        '3.3.2',
        'Required fields with format rules give no instructions',
        'These fields are required and only accept a particular format, but nothing tells the user what that format is before they submit. They have to guess, fail, and try again.',
        'Describe the requirement up front and link it with aria-describedby, e.g. "Password must be at least 8 characters and contain a number."',
        f.requiredNoHint.map((n) => ({
          selector: n.selector,
          html: n.html,
          summary: `Required, constrained by ${n.rule}, but no instructions are provided.`
        }))
      )
    );
  }

  if (f.groupsNoFieldset.length) {
    findings.push(
      mk(
        'moderate',
        'violation',
        'group-no-legend',
        '3.3.2',
        'Radio or checkbox groups have no group label',
        'Each option has its own label, but nothing labels the group as a whole. A screen reader reads out "Yes" and "No" with no idea what question is being asked.',
        'Wrap the group in <fieldset> with a <legend> naming the question, or use role="group" with aria-label.',
        f.groupsNoFieldset.map((n) => ({
          selector: n.selector,
          html: n.html,
          summary: `${n.count} inputs named "${n.name}" with no fieldset/legend or labelled group.`
        }))
      )
    );
  }

  return findings;
}

export function normalizeZoom(z) {
  const findings = [];

  if (z.horizontalScroll) {
    findings.push(
      mk(
        'serious',
        'violation',
        'zoom-horizontal-scroll',
        '1.4.4',
        'Page scrolls sideways at 200% zoom',
        `At 200% zoom the content is ${z.overflowWidth}px wider than the screen, forcing horizontal scrolling. Users with low vision then have to scroll left and right to read every single line.`,
        'Make the layout reflow instead of overflowing: use max-width:100%, flexible grids, and wrap long content. Avoid fixed pixel widths on containers.',
        z.spilling.map((n) => ({
          selector: n.selector,
          html: n.html,
          summary: `Extends ${n.overhang}px past the right edge of the viewport at 200% zoom.`
        }))
      )
    );
  }

  if (z.clipped.length) {
    findings.push(
      mk(
        'serious',
        'violation',
        'zoom-clipped-content',
        '1.4.4',
        'Text is cut off at 200% zoom',
        'At 200% zoom these containers cannot hold their own text, and the overflow is hidden. The content is still in the DOM but the user simply cannot see it.',
        'Avoid fixed heights on containers that hold text. Let them grow — use min-height instead of height, and never pair a fixed height with overflow:hidden on text.',
        z.clipped.map((n) => ({
          selector: n.selector,
          html: n.html,
          summary: `${n.hidden}px of content is clipped and unreachable at 200% zoom.`
        }))
      )
    );
  }

  return findings;
}
