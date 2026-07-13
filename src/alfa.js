/**
 * Siteimprove Alfa — the reference implementation of the W3C ACT Rules.
 *
 * This is the closest thing to a normative automated engine: its rules are the
 * W3C's own Accessibility Conformance Testing rules, so where Alfa and axe
 * disagree, Alfa is the one that traces back to the standard. It also reports
 * `CantTell` honestly instead of silently passing — which is exactly the signal
 * the Claude stage then adjudicates.
 */
import { Playwright } from '@siteimprove/alfa-playwright';
import { Audit } from '@siteimprove/alfa-act';
import alfaRules from '@siteimprove/alfa-rules';
import { inScope } from './wcag.js';

export const ALFA_ENGINE = 'alfa';

// Alfa's own severity is not part of the ACT rules, so it does not ship one.
// These map the criteria we care about onto the same impact vocabulary the other
// engines use, so a reader never has to learn a second scale.
const IMPACT_BY_SC = {
  '1.1.1': 'critical',
  '1.3.1': 'serious',
  '1.4.3': 'serious',
  '2.1.1': 'serious',
  '2.4.1': 'moderate',
  '2.4.2': 'serious',
  '2.4.4': 'serious',
  '2.4.7': 'serious',
  '3.1.1': 'serious',
  '3.1.2': 'moderate',
  '3.3.2': 'serious',
  '4.1.1': 'moderate',
  '4.1.2': 'critical'
};

/** Pull the plain-text message out of Alfa's structured expectation result. */
function messageFrom(outcome) {
  try {
    const expectations = outcome.toJSON().expectations || [];
    for (const [, result] of expectations) {
      if (result?.type === 'err' && result.error?.message) {
        return String(result.error.message).replace(/\s+/g, ' ').trim();
      }
    }
  } catch {
    // An outcome with no serializable expectation still tells us it failed.
  }
  return '';
}

/**
 * Turn an Alfa target into something the rest of the pipeline understands.
 *
 * Alfa addresses elements by XPath, not CSS. Playwright's locator accepts XPath
 * directly, so the path is kept verbatim — it is precise, and it survives pages
 * where class names are hashed or absent.
 */
function nodeFrom(outcome) {
  const target = outcome.target;
  if (!target) return null;

  let selector = '';
  try {
    const path = target.path?.();
    if (path) selector = `xpath=${path}`;
  } catch {
    /* text nodes and some pseudo-targets have no path */
  }

  const html = String(target).replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!selector && !html) return null;

  return { selector, html, summary: messageFrom(outcome) };
}

/**
 * Run the ACT rules over the live page.
 *
 * Alfa is given the real DOM through Playwright rather than a parsed HTML string,
 * so computed styles — which is how contrast, focus, and visibility rules are
 * actually decided — are the browser's, not a re-implementation's.
 */
export async function runAlfa(page) {
  try {
    const handle = await page.evaluateHandle(() => document);
    const alfaPage = await Playwright.toPage(handle);
    const outcomes = await Audit.of(alfaPage, alfaRules).evaluate();
    return [...outcomes];
  } catch (err) {
    console.warn(`Siteimprove Alfa could not run on this page: ${err.message}`);
    return [];
  }
}

/**
 * Group Alfa's per-element outcomes into findings, one per rule.
 *
 * Alfa emits one outcome per failing element; the rest of the pipeline expects
 * one finding per rule carrying all its elements. `Passed` and `Inapplicable`
 * are counted but not reported — a report listing everything that *didn't* go
 * wrong is a report nobody reads.
 */
export function normalizeAlfa(outcomes) {
  const findings = new Map();
  let passed = 0;

  for (const outcome of outcomes) {
    const kind = outcome.constructor.name;
    if (kind === 'Passed') {
      passed++;
      continue;
    }
    if (kind !== 'Failed' && kind !== 'CantTell') continue;

    const json = outcome.toJSON();
    const criteria = (json.rule?.requirements || []).filter((r) => r.type === 'criterion');

    // Only criteria inside WCAG 2.0 AA. Alfa also ships AAA and 2.1 rules, and
    // failing the page against a criterion it was never measured on would be
    // simply wrong.
    const criterion = criteria.find((c) => inScope(c.chapter));
    if (!criterion) continue;

    const sc = criterion.chapter;
    const ruleId = json.rule.uri.split('/').pop() || 'alfa';
    const key = `${ruleId}::${kind}`;

    let finding = findings.get(key);
    if (!finding) {
      const isFailure = kind === 'Failed';
      finding = {
        engine: ALFA_ENGINE,
        status: isFailure ? 'violation' : 'review',
        impact: isFailure ? IMPACT_BY_SC[sc] || 'moderate' : 'review',
        ruleId,
        sc,
        title: isFailure
          ? `${criterion.title}: the page fails the W3C ACT rule ${ruleId}`
          : `${criterion.title}: the W3C ACT rule ${ruleId} could not decide automatically`,
        description: isFailure
          ? `Siteimprove Alfa evaluated this against the W3C's own ACT rule ${ruleId} and it failed.`
          : `Alfa reached this element but could not determine the outcome automatically — it needs a judgment call rather than a pass or a fail.`,
        nodes: []
      };
      findings.set(key, finding);
    }

    const node = nodeFrom(outcome);
    if (node) finding.nodes.push(node);
  }

  return { findings: [...findings.values()], passed };
}
