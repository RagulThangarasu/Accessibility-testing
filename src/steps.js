/**
 * Steps to reproduce, written per issue type.
 *
 * A finding that only says "colour contrast is insufficient" is a fact. A finding
 * that tells you which key to press, what to look at, and what you should have
 * seen instead is a bug report someone can act on and verify. These are the steps
 * a tester would follow by hand to confirm each issue is real.
 */

const target = (node) => (node?.selector ? `\`${node.selector}\`` : 'the affected element');

// Keyed by success criterion, because the way you *verify* an issue follows from
// the criterion, not from which engine happened to report it.
const BY_SC = {
  '1.1.1': (url, node) => [
    `Open ${url} in a browser.`,
    `Right-click ${target(node)} and choose Inspect.`,
    'Look for an `alt` attribute on the image element.',
    '**Expected:** an `alt` describing the image\'s purpose, or `alt=""` if it is purely decorative.',
    '**Actual:** the `alt` attribute is missing or empty on an image that carries meaning, so a screen reader announces only "image" or the file name.'
  ],

  '1.3.1': (url, node) => [
    `Open ${url}.`,
    `Inspect ${target(node)} in DevTools.`,
    'Check the element\'s Accessibility tree entry (DevTools → Elements → Accessibility pane).',
    '**Expected:** the structure and relationships are conveyed by semantic markup that assistive technology can read.',
    '**Actual:** the relationship exists visually but not in the markup, so it is lost to a screen reader.'
  ],

  '1.4.1': (url, node) => [
    `Open ${url}.`,
    `Find ${target(node)} — a link inside a paragraph of text.`,
    'Apply a greyscale filter (DevTools → Rendering → Emulate vision deficiencies → Achromatopsia).',
    '**Expected:** the link is still identifiable as a link.',
    '**Actual:** with colour removed the link is indistinguishable from the surrounding text — colour was the only cue.'
  ],

  '1.4.3': (url, node) => [
    `Open ${url}.`,
    `Inspect ${target(node)}.`,
    'In DevTools, click the colour swatch next to `color` to read the contrast ratio.',
    '**Expected:** at least 4.5:1 for normal text, or 3:1 for large text (18.66px bold / 24px regular).',
    '**Actual:** the measured ratio is below that threshold — see the element detail for the exact figure.'
  ],

  '1.4.4': (url, node) => [
    `Open ${url} in a browser at a 1366px-wide window.`,
    'Zoom to 200% (⌘/Ctrl and `+`, four times — or set the window to 683px wide).',
    `Look at ${target(node)}.`,
    '**Expected:** content reflows into the narrower space; no horizontal scrollbar, no clipped text.',
    '**Actual:** the content overflows sideways or is cut off, so some of it cannot be read at all.'
  ],

  '2.1.1': (url, node) => [
    `Open ${url}.`,
    'Click once in the address bar, then press Tab repeatedly to move through the page. **Do not touch the mouse.**',
    `Try to reach ${target(node)}.`,
    '**Expected:** the control receives focus and can be activated with Enter or Space.',
    '**Actual:** Tab never reaches it. The control works on click only, so a keyboard-only user cannot operate it at all.'
  ],

  '2.1.2': (url, node) => [
    `Open ${url}.`,
    `Press Tab until focus reaches ${target(node)}.`,
    'Keep pressing Tab.',
    '**Expected:** focus moves on to the next control.',
    '**Actual:** focus stays put. The user is trapped and cannot reach the rest of the page without a mouse.'
  ],

  '2.4.1': (url) => [
    `Open ${url}.`,
    'Press Tab once, before touching anything else.',
    '**Expected:** the first stop is a "Skip to main content" link, or the page exposes landmark regions (`<main>`, `<nav>`) a screen reader can jump between.',
    '**Actual:** neither exists, so a screen reader user must listen through the entire header and navigation on every page.'
  ],

  '2.4.2': (url) => [
    `Open ${url}.`,
    'Read the browser tab title, or inspect the `<title>` element.',
    '**Expected:** a unique title that describes this page\'s purpose.',
    '**Actual:** the title is missing, empty, or generic, so a user with many tabs open (or a screen reader announcing the page) cannot tell what this page is.'
  ],

  '2.4.3': (url, node) => [
    `Open ${url}.`,
    'Press Tab repeatedly and watch where the focus ring goes.',
    `Note the position of ${target(node)} in that sequence.`,
    '**Expected:** focus moves in the order the content reads on screen — left to right, top to bottom.',
    '**Actual:** focus jumps out of that order, so the page makes no sense to someone navigating it by keyboard.'
  ],

  '2.4.4': (url, node) => [
    `Open ${url}.`,
    `Look at the text of ${target(node)} on its own, with no surrounding context.`,
    '**Expected:** the link text alone says where it goes — screen reader users often pull up a list of links out of context.',
    '**Actual:** the text is generic ("click here", "read more"), so out of context it tells the user nothing.'
  ],

  '2.4.6': (url, node) => [
    `Open ${url}.`,
    `Inspect the heading structure (DevTools, or a headings-outline extension). Look at ${target(node)}.`,
    '**Expected:** headings descend one level at a time — h1 → h2 → h3 — forming a readable outline.',
    '**Actual:** a level is skipped, so the document outline a screen reader user navigates by is broken.'
  ],

  '2.4.7': (url, node) => [
    `Open ${url}.`,
    `Press Tab until focus lands on ${target(node)}. Use the keyboard only — a mouse click does not trigger \`:focus-visible\`.`,
    'Watch the element carefully as it receives focus.',
    '**Expected:** a clearly visible focus indicator — an outline, ring, or strong colour change.',
    '**Actual:** nothing changes. The element is focused but a sighted keyboard user has no way to know where they are.'
  ],

  '3.1.1': (url) => [
    `Open ${url}.`,
    'Inspect the `<html>` element.',
    '**Expected:** a valid `lang` attribute, e.g. `<html lang="en">`.',
    '**Actual:** it is missing or invalid, so a screen reader may read the page in the wrong language and pronounce it as gibberish.'
  ],

  '3.3.1': (url, node) => [
    `Open ${url} and submit the form with ${target(node)} left blank or filled in incorrectly.`,
    'Read the error state with a screen reader (VoiceOver: ⌘F5, NVDA: Ctrl+Alt+N), or inspect the field\'s `aria-describedby`.',
    '**Expected:** the error is announced in text and says what is wrong and how to fix it.',
    '**Actual:** the field is marked invalid but no text describes the problem — a screen reader announces "invalid" and nothing else.'
  ],

  '3.3.2': (url, node) => [
    `Open ${url}.`,
    `Look at ${target(node)} before typing anything into it.`,
    '**Expected:** the label and any format rule (required, minimum length, expected pattern) are stated up front and linked with `aria-describedby`.',
    '**Actual:** the requirement is not communicated, so the user must submit, fail, and guess.'
  ],

  '4.1.1': (url, node) => [
    `View the page source of ${url} (⌘/Ctrl + U).`,
    `Find ${target(node)}, or paste the source into validator.w3.org.`,
    '**Expected:** valid, well-formed HTML that every browser and screen reader parses the same way.',
    '**Actual:** the markup is invalid at this point, so different assistive technologies may build different accessibility trees from it.'
  ],

  '4.1.2': (url, node) => [
    `Open ${url}.`,
    `Inspect ${target(node)} and open the Accessibility pane in DevTools.`,
    'Read the computed Name, Role, and Value.',
    '**Expected:** the control exposes an accessible name, a correct role, and its current state.',
    '**Actual:** one or more is missing, so a screen reader announces the control without saying what it is or what it does.'
  ]
};

// When a rule needs a more specific script than its criterion's generic one.
const BY_RULE = {
  'mouse-only-control': BY_SC['2.1.1'],
  'keyboard-trap': BY_SC['2.1.2'],
  'focus-not-visible': BY_SC['2.4.7'],
  'positive-tabindex': (url, node) => [
    `Open ${url}.`,
    `Inspect ${target(node)} and read its \`tabindex\` value.`,
    'Press Tab from the top of the page and note when this element is reached.',
    '**Expected:** `tabindex="0"` or no tabindex, so the element takes its natural place in the order.',
    '**Actual:** a positive tabindex pulls it ahead of everything else, ahead of content that visually precedes it.'
  ],
  'zoom-horizontal-scroll': BY_SC['1.4.4'],
  'zoom-clipped-content': BY_SC['1.4.4'],
  'link-color-only': BY_SC['1.4.1'],
  'ambiguous-link-text': BY_SC['2.4.4'],
  'autoplay-media': (url, node) => [
    `Open ${url} with the volume up.`,
    `Observe ${target(node)}.`,
    '**Expected:** nothing plays automatically, or a pause/stop control is available within the first Tab stop.',
    '**Actual:** audio starts on its own and cannot be stopped, drowning out a screen reader\'s speech.'
  ],
  'meta-refresh': (url) => [
    `Open ${url} and start reading without interacting.`,
    'Wait for the timer set in `<meta http-equiv="refresh">`.',
    '**Expected:** the page does not move on its own, or the user can turn the timer off or extend it.',
    '**Actual:** the page reloads or redirects on a timer, moving users away before they can finish.'
  ]
};

/**
 * Build reproduction steps for one finding.
 *
 * Falls back to a generic-but-still-usable script: which page, which element,
 * what the engine reported, and what should have been true instead. Better a
 * plain script than none — a finding nobody can reproduce is a finding nobody
 * fixes.
 */
export function stepsFor(finding, url) {
  const node = finding.nodes?.[0];
  const builder = BY_RULE[finding.ruleId] || BY_SC[finding.sc];
  if (builder) return builder(url, node);

  const generic = [
    `Open ${url}.`,
    node?.selector ? `Inspect ${target(node)} in DevTools.` : 'Inspect the page markup in DevTools.'
  ];
  if (node?.summary) generic.push(`Check the reported problem: ${node.summary}`);
  generic.push(
    `**Expected:** the page satisfies WCAG ${finding.sc || 'the relevant success criterion'}.`,
    `**Actual:** ${finding.title}.`
  );
  return generic;
}
