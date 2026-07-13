// WCAG 2.0 AA success criteria that cannot be reliably automated.
// These are surfaced in every report as a reviewer checklist so the report
// reflects the true scope of WCAG 2.0 AA rather than implying conformance
// from automated checks alone.

export const MANUAL_CHECKLIST = [
  { sc: '1.2.1', level: 'A', name: 'Audio-only and Video-only (Prerecorded)', check: 'Prerecorded audio-only/video-only media has an equivalent text or audio alternative.' },
  { sc: '1.2.2', level: 'A', name: 'Captions (Prerecorded)', check: 'Captions are provided for all prerecorded video with audio.' },
  { sc: '1.2.3', level: 'A', name: 'Audio Description or Media Alternative', check: 'A text alternative or audio description is provided for prerecorded video.' },
  { sc: '1.2.4', level: 'AA', name: 'Captions (Live)', check: 'Captions are provided for live audio content.' },
  { sc: '1.2.5', level: 'AA', name: 'Audio Description (Prerecorded)', check: 'Audio description is provided for prerecorded video content.' },
  { sc: '1.3.2', level: 'A', name: 'Meaningful Sequence', check: 'Reading/navigation order in the DOM matches the meaningful visual order.' },
  { sc: '1.3.3', level: 'A', name: 'Sensory Characteristics', check: 'Instructions do not rely solely on shape, size, or location (e.g. "the button on the right").' },
  { sc: '1.4.1', level: 'A', name: 'Use of Color', check: 'Color is not the only means of conveying information (e.g. links, errors, required fields).' },
  { sc: '1.4.4', level: 'AA', name: 'Resize Text', check: 'Text can be resized up to 200% without loss of content or function.' },
  { sc: '1.4.5', level: 'AA', name: 'Images of Text', check: 'Real text is used instead of images of text (except logos/essential cases).' },
  { sc: '2.1.1', level: 'A', name: 'Keyboard', check: 'All functionality is operable with the keyboard alone.' },
  { sc: '2.1.2', level: 'A', name: 'No Keyboard Trap', check: 'Keyboard focus can move away from every component (no traps).' },
  { sc: '2.3.1', level: 'A', name: 'Three Flashes or Below Threshold', check: 'Nothing flashes more than three times per second.' },
  { sc: '2.4.3', level: 'A', name: 'Focus Order', check: 'Focus order preserves meaning and operability.' },
  { sc: '2.4.5', level: 'AA', name: 'Multiple Ways', check: 'More than one way to locate a page exists (search, sitemap, nav).' },
  { sc: '2.4.7', level: 'AA', name: 'Focus Visible', check: 'A visible focus indicator is present for all keyboard-focusable elements.' },
  { sc: '3.2.1', level: 'A', name: 'On Focus', check: 'Moving focus to a component does not trigger an unexpected context change.' },
  { sc: '3.2.2', level: 'A', name: 'On Input', check: 'Changing a setting does not automatically cause an unexpected context change.' },
  { sc: '3.2.3', level: 'AA', name: 'Consistent Navigation', check: 'Navigation that repeats across pages appears in the same relative order.' },
  { sc: '3.2.4', level: 'AA', name: 'Consistent Identification', check: 'Components with the same function are identified consistently across pages.' },
  { sc: '3.3.1', level: 'A', name: 'Error Identification', check: 'Input errors are identified and described to the user in text.' },
  { sc: '3.3.3', level: 'AA', name: 'Error Suggestion', check: 'When an input error is detected, suggestions for correction are provided.' },
  { sc: '3.3.4', level: 'AA', name: 'Error Prevention (Legal, Financial, Data)', check: 'Submissions for legal/financial/data actions are reversible, checked, or confirmable.' }
];
