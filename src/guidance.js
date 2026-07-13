// Ensures every finding has a plain-English "What it means" (description) and a
// one-line "How to fix", regardless of which engine produced it. axe-core gives
// a description but no single fix line; HTML_CodeSniffer gives neither in a
// structured form. This module fills the gaps so every report card is uniform.

// One-line fix per axe-core rule id (the common WCAG 2.0 AA rules).
const AXE_FIX = {
  'image-alt': 'Add an alt attribute — descriptive text for meaningful images, or alt="" for decorative ones.',
  'input-image-alt': 'Give the image button an alt attribute describing what it does.',
  'area-alt': 'Add alt text to each <area> in the image map.',
  'object-alt': 'Provide alternative text for the <object> element.',
  'svg-img-alt': 'Add a <title> or aria-label to the SVG, or aria-hidden="true" if it is decorative.',
  'role-img-alt': 'Add an accessible name (aria-label or alt) to the element with role="img".',
  'color-contrast': 'Raise the text-to-background contrast to at least 4.5:1 (3:1 for large text).',
  'link-name': 'Give the link discernible text, or an aria-label describing where it goes.',
  'button-name': 'Give the button text content or an aria-label describing its action.',
  'aria-allowed-attr': 'Remove ARIA attributes the element’s role does not support, or change the role.',
  'aria-required-attr': 'Add the ARIA attributes this role requires.',
  'aria-required-children': 'Add the required child roles (e.g. options inside a listbox).',
  'aria-required-parent': 'Place the element inside its required parent role.',
  'aria-valid-attr-value': 'Correct the ARIA attribute value (e.g. point aria-labelledby at a real id).',
  'aria-valid-attr': 'Use a valid ARIA attribute name.',
  'aria-roles': 'Use a valid ARIA role.',
  'aria-hidden-focus': 'Remove focusable elements from inside aria-hidden="true" containers.',
  'aria-command-name': 'Give the control (button/link/menuitem) an accessible name.',
  'aria-input-field-name': 'Give the ARIA input field an accessible name via label or aria-label.',
  'label': 'Associate a <label> with the field (for/id), or add aria-label / aria-labelledby.',
  'select-name': 'Give the <select> an accessible name via <label> or aria-label.',
  'form-field-multiple-labels': 'Ensure each form field has exactly one label.',
  'html-has-lang': 'Add a lang attribute to the <html> element (e.g. lang="en").',
  'html-lang-valid': 'Use a valid language code in the <html> lang attribute.',
  'valid-lang': 'Use a valid value for the lang attribute on inline elements.',
  'document-title': 'Add a non-empty, descriptive <title> in the <head>.',
  'bypass': 'Provide a skip link, landmark regions, or headings so users can skip repeated blocks.',
  'duplicate-id': 'Make every id on the page unique.',
  'duplicate-id-active': 'Make ids of active elements unique.',
  'duplicate-id-aria': 'Make ids referenced by ARIA unique.',
  'list': 'Ensure <ul>/<ol> contain only <li> (and script-supporting) elements.',
  'listitem': 'Place <li> only directly inside <ul> or <ol>.',
  'definition-list': 'Structure the <dl> with properly ordered <dt>/<dd> pairs.',
  'dlitem': 'Place <dt>/<dd> directly inside a <dl>.',
  'heading-order': 'Use heading levels in order, without skipping a level.',
  'empty-heading': 'Add text to the heading, or remove the empty heading element.',
  'region': 'Place page content inside landmark regions (main, nav, header, footer…).',
  'landmark-one-main': 'Include exactly one <main> landmark on the page.',
  'frame-title': 'Add a descriptive title attribute to the <iframe>.',
  'th-has-data-cells': 'Make sure each table header relates to data cells.',
  'td-headers-attr': 'Point the cell’s headers attribute at valid header cell ids.',
  'scrollable-region-focusable': 'Make scrollable regions keyboard-focusable with tabindex="0".',
  'meta-viewport': 'Allow zoom — remove user-scalable=no and maximum-scale from the viewport meta.',
  'nested-interactive': 'Do not nest interactive controls (e.g. a button inside a link).',
  'tabindex': 'Avoid tabindex values greater than 0; let the natural DOM order drive focus.'
};

// Per-criterion fallback "what it means" / "how to fix" — used mainly for
// HTML_CodeSniffer findings, which don't carry a structured description/fix.
const SC_GUIDANCE = {
  '1.1.1': {
    means: 'Non-text content (images, icons, controls) needs a text alternative so screen-reader users get the same information.',
    fix: 'Add descriptive alt text, or alt="" for decorative images, or an accessible label for controls.'
  },
  '1.3.1': {
    means: 'Structure shown visually — headings, labels, lists, tables — must also exist in the markup so assistive technology can perceive it.',
    fix: 'Use correct semantic HTML (real headings, <label>s, list and table markup), or ARIA where needed.'
  },
  '1.4.2': {
    means: 'Audio that plays automatically can interfere with screen readers and distract users.',
    fix: 'Avoid autoplay, or provide a clear way to pause, stop, or mute the sound.'
  },
  '1.4.3': {
    means: 'Text must contrast enough with its background to be readable by people with low vision.',
    fix: 'Use a contrast ratio of at least 4.5:1 (3:1 for large text).'
  },
  '2.4.1': {
    means: 'Users need a way to skip past blocks that repeat on every page, such as navigation.',
    fix: 'Provide a skip link, landmark regions, or a clear heading structure.'
  },
  '2.4.2': {
    means: 'Each page needs a descriptive title that identifies its topic or purpose.',
    fix: 'Add a unique, descriptive <title> element.'
  },
  '2.4.4': {
    means: 'Each link’s purpose should be clear from its text together with its context.',
    fix: 'Write descriptive link text, or add an aria-label describing the destination.'
  },
  '2.4.6': {
    means: 'Headings and labels should describe their topic or purpose.',
    fix: 'Make every heading and label clear and descriptive.'
  },
  '3.1.1': {
    means: 'The page’s language must be set so screen readers pronounce content correctly.',
    fix: 'Add a valid lang attribute to the <html> element.'
  },
  '3.1.2': {
    means: 'Passages in another language must be marked so they are pronounced correctly.',
    fix: 'Add a lang attribute to the element that contains the foreign-language text.'
  },
  '3.3.2': {
    means: 'Form fields need visible labels or instructions so users know what to enter.',
    fix: 'Add a <label> (or aria-label) and any needed instructions to each field.'
  },
  '4.1.1': {
    means: 'Invalid markup can be interpreted differently by browsers and assistive technology, breaking the page.',
    fix: 'Correct the HTML so it is valid and well-formed.'
  },
  '4.1.2': {
    means: 'Interactive and custom components must expose a name, role and state to assistive technology.',
    fix: 'Use native elements, or correct ARIA, so each control has an accessible name, role and value.'
  }
};

const GENERIC_MEANS =
  'This can prevent some users — especially those using assistive technology — from accessing the content.';

function genericFix(sc) {
  return sc
    ? `Review the affected elements below and correct them to meet WCAG ${sc}.`
    : 'Review the affected elements below and correct the markup.';
}

/**
 * Return { description, fix } for a finding, preserving anything the engine
 * already supplied and filling in the rest.
 */
export function fillGuidance(f) {
  const sc = SC_GUIDANCE[f.sc];
  const description = f.description || (sc && sc.means) || GENERIC_MEANS;
  const fix =
    f.fix || AXE_FIX[f.ruleId] || (sc && sc.fix) || genericFix(f.sc);
  return { description, fix };
}
