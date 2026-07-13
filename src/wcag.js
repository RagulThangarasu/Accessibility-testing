/**
 * The complete WCAG 2.0 Level AA matrix — all 38 success criteria (25 at Level A,
 * 13 at Level AA).
 *
 * This is the single source of truth for scope. Engines are filtered against it,
 * and Claude is asked to return a verdict on every one of these, so the report can
 * account for the whole standard rather than only the parts a rule engine happens
 * to reach.
 */
export const WCAG_20_AA = [
  // Principle 1 — Perceivable
  { sc: '1.1.1', level: 'A', name: 'Non-text Content', check: 'Every image, icon, and control that conveys meaning has a text alternative that serves the same purpose. Decorative images are hidden from assistive technology.' },
  { sc: '1.2.1', level: 'A', name: 'Audio-only and Video-only (Prerecorded)', check: 'Prerecorded audio-only or video-only media has an equivalent text or audio alternative.' },
  { sc: '1.2.2', level: 'A', name: 'Captions (Prerecorded)', check: 'Captions are provided for all prerecorded video that has audio.' },
  { sc: '1.2.3', level: 'A', name: 'Audio Description or Media Alternative (Prerecorded)', check: 'A text alternative or audio description is provided for prerecorded video.' },
  { sc: '1.2.4', level: 'AA', name: 'Captions (Live)', check: 'Captions are provided for live audio content.' },
  { sc: '1.2.5', level: 'AA', name: 'Audio Description (Prerecorded)', check: 'Audio description is provided for prerecorded video content.' },
  { sc: '1.3.1', level: 'A', name: 'Info and Relationships', check: 'Structure conveyed visually — headings, lists, tables, form labels, groups — is also conveyed in the markup so assistive technology can read it.' },
  { sc: '1.3.2', level: 'A', name: 'Meaningful Sequence', check: 'The DOM reading order matches the meaningful visual order. Nothing relies on CSS positioning to make sense.' },
  { sc: '1.3.3', level: 'A', name: 'Sensory Characteristics', check: 'Instructions do not rely solely on shape, size, position, or sound ("click the round button on the right").' },
  { sc: '1.4.1', level: 'A', name: 'Use of Color', check: 'Colour is never the only way information is conveyed — links, errors, required fields, chart series, status indicators.' },
  { sc: '1.4.2', level: 'A', name: 'Audio Control', check: 'Audio that plays automatically for more than 3 seconds can be paused, stopped, or muted.' },
  { sc: '1.4.3', level: 'AA', name: 'Contrast (Minimum)', check: 'Text has a contrast ratio of at least 4.5:1 (3:1 for large text) against its background.' },
  { sc: '1.4.4', level: 'AA', name: 'Resize Text', check: 'Text can be resized to 200% without loss of content or functionality — no clipping, no horizontal scrolling.' },
  { sc: '1.4.5', level: 'AA', name: 'Images of Text', check: 'Real text is used rather than pictures of text, except for logos and cases where a particular presentation is essential.' },

  // Principle 2 — Operable
  { sc: '2.1.1', level: 'A', name: 'Keyboard', check: 'All functionality is operable with the keyboard alone — every control reachable by Tab and activatable by Enter or Space.' },
  { sc: '2.1.2', level: 'A', name: 'No Keyboard Trap', check: 'Keyboard focus can always be moved away from any component using the keyboard.' },
  { sc: '2.2.1', level: 'A', name: 'Timing Adjustable', check: 'Any time limit can be turned off, adjusted, or extended. No unexpected auto-refresh or redirect.' },
  { sc: '2.2.2', level: 'A', name: 'Pause, Stop, Hide', check: 'Moving, blinking, scrolling, or auto-updating content can be paused, stopped, or hidden.' },
  { sc: '2.3.1', level: 'A', name: 'Three Flashes or Below Threshold', check: 'Nothing on the page flashes more than three times per second.' },
  { sc: '2.4.1', level: 'A', name: 'Bypass Blocks', check: 'A skip link or landmark regions let users jump past repeated navigation.' },
  { sc: '2.4.2', level: 'A', name: 'Page Titled', check: 'The page has a title that describes its topic or purpose.' },
  { sc: '2.4.3', level: 'A', name: 'Focus Order', check: 'The focus order preserves meaning and operability — it follows the order the content reads on screen.' },
  { sc: '2.4.4', level: 'A', name: 'Link Purpose (In Context)', check: 'The purpose of each link is clear from its text, or from its text plus its immediate context.' },
  { sc: '2.4.5', level: 'AA', name: 'Multiple Ways', check: 'There is more than one way to find a page — search, a sitemap, or navigation.' },
  { sc: '2.4.6', level: 'AA', name: 'Headings and Labels', check: 'Headings and labels describe the topic or purpose of the content they introduce.' },
  { sc: '2.4.7', level: 'AA', name: 'Focus Visible', check: 'Every keyboard-focusable element has a clearly visible focus indicator.' },

  // Principle 3 — Understandable
  { sc: '3.1.1', level: 'A', name: 'Language of Page', check: 'The page declares its language, e.g. <html lang="en">.' },
  { sc: '3.1.2', level: 'AA', name: 'Language of Parts', check: 'Passages in a different language declare that language with a lang attribute.' },
  { sc: '3.2.1', level: 'A', name: 'On Focus', check: 'Moving focus to a component does not cause an unexpected change of context.' },
  { sc: '3.2.2', level: 'A', name: 'On Input', check: 'Changing a setting does not automatically cause an unexpected change of context — no auto-submit on select.' },
  { sc: '3.2.3', level: 'AA', name: 'Consistent Navigation', check: 'Navigation repeated across pages appears in the same relative order each time.' },
  { sc: '3.2.4', level: 'AA', name: 'Consistent Identification', check: 'Components with the same function are labelled consistently across pages.' },
  { sc: '3.3.1', level: 'A', name: 'Error Identification', check: 'Input errors are identified and described to the user in text.' },
  { sc: '3.3.2', level: 'A', name: 'Labels or Instructions', check: 'Labels or instructions are provided when content requires user input, including format requirements.' },
  { sc: '3.3.3', level: 'AA', name: 'Error Suggestion', check: 'When an input error is detected, a correction is suggested where possible.' },
  { sc: '3.3.4', level: 'AA', name: 'Error Prevention (Legal, Financial, Data)', check: 'Submissions with legal or financial consequences are reversible, checked, or confirmable.' },

  // Principle 4 — Robust
  { sc: '4.1.1', level: 'A', name: 'Parsing', check: 'The markup is valid and well-formed — no duplicate IDs, no unclosed or misnested elements.' },
  { sc: '4.1.2', level: 'A', name: 'Name, Role, Value', check: 'Every interactive component exposes an accessible name, a correct role, and its current state.' }
];

/** Fast membership test — is this criterion inside WCAG 2.0 Level AA at all? */
const IN_SCOPE = new Set(WCAG_20_AA.map((c) => c.sc));

/**
 * Engines report criteria outside our scope — Alfa in particular covers AAA
 * (1.4.6 Contrast Enhanced) and WCAG 2.1. Reporting those against a "WCAG 2.0 AA"
 * verdict would overstate the failure, so they are filtered out here.
 */
export function inScope(sc) {
  return IN_SCOPE.has(sc);
}

export const TOTAL_CRITERIA = WCAG_20_AA.length;
