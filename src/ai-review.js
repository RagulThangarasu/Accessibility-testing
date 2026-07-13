import Anthropic from '@anthropic-ai/sdk';
import { MANUAL_CHECKLIST } from './manual-checklist.js';
import { scName } from './engines.js';

export const AI_ENGINE = 'claude';
const MODEL = 'claude-opus-4-8';

// The rendered page is sent verbatim so Claude can cite real selectors and
// markup. Scripts and styles carry no accessibility signal, so they are dropped
// before the cap is applied — otherwise a single bundled JS file would eat the
// whole budget and push the actual content out.
const MAX_HTML_CHARS = 120_000;

function condenseHtml(html = '') {
  const stripped = String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return stripped.length > MAX_HTML_CHARS
    ? { html: stripped.slice(0, MAX_HTML_CHARS), truncated: true }
    : { html: stripped, truncated: false };
}

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      description: 'One entry per success criterion you were asked to judge.',
      items: {
        type: 'object',
        properties: {
          sc: {
            type: 'string',
            description: 'WCAG success criterion number, e.g. "1.4.1".'
          },
          verdict: {
            type: 'string',
            enum: ['violation', 'review', 'pass', 'not_applicable'],
            description:
              'violation = the page clearly fails. review = a human must confirm. ' +
              'pass = the page clearly meets it. not_applicable = the page has no ' +
              'content this criterion applies to.'
          },
          impact: {
            type: 'string',
            enum: ['critical', 'serious', 'moderate', 'minor'],
            description: 'How much a real user is affected. Ignored unless verdict is "violation".'
          },
          title: {
            type: 'string',
            description: 'One line naming the specific problem on THIS page, not the criterion.'
          },
          reasoning: {
            type: 'string',
            description: 'What in the page led to this verdict. Cite concrete evidence.'
          },
          fix: {
            type: 'string',
            description: 'A concrete change a developer can make to this page. Empty if verdict is pass or not_applicable.'
          },
          elements: {
            type: 'array',
            description: 'The elements this verdict is about. Empty if none apply.',
            items: {
              type: 'object',
              properties: {
                selector: { type: 'string', description: 'CSS selector for the element.' },
                snippet: { type: 'string', description: 'The element\'s markup, copied from the page.' },
                issue: { type: 'string', description: 'What is wrong with this specific element.' }
              },
              required: ['selector', 'snippet', 'issue'],
              additionalProperties: false
            }
          }
        },
        required: ['sc', 'verdict', 'impact', 'title', 'reasoning', 'fix', 'elements'],
        additionalProperties: false
      }
    }
  },
  required: ['results'],
  additionalProperties: false
};

const SYSTEM = `You are a WCAG 2.0 Level AA accessibility auditor reviewing a single web page.

You are the manual-review stage of a scanner. Automated engines (axe-core,
HTML_CodeSniffer, an HTML validator, and DOM checks) have already run and caught
everything a rule engine can catch. Your job is the criteria a rule engine
CANNOT decide — the ones that need judgment about meaning, sequence, and intent.

Rules:
- Judge only what the supplied markup actually shows. Never assume content you
  cannot see. If the page has no media, say not_applicable for the media criteria
  rather than guessing.
- Do not re-report a criterion the automated engines already flagged. Those are
  listed for you; they are covered.
- "review" is the correct verdict whenever the markup is genuinely ambiguous —
  for example, whether colour alone conveys meaning usually needs a rendered
  view. Do not inflate a suspicion into a violation.
- A "violation" means you can point at the element and say what is wrong. Cite it.
- Write the title, reasoning, and fix for a developer who has not read the WCAG
  spec. Name the element and the change, not the criterion.`;

function buildPrompt({ url, title, html, truncated, flaggedScs }) {
  const checklist = MANUAL_CHECKLIST.map(
    (c) => `- ${c.sc} (Level ${c.level}) ${c.name}: ${c.check}`
  ).join('\n');

  const covered = flaggedScs.length
    ? flaggedScs.map((sc) => `${sc} — ${scName(sc) || 'unnamed'}`).join(', ')
    : 'none';

  return `Page URL: ${url}
Page title: ${title || '(none)'}

Success criteria already flagged by the automated engines (do NOT re-report these):
${covered}

Judge each of these WCAG 2.0 AA criteria against the page below:
${checklist}

Return one result per criterion listed above.
${truncated ? '\nNote: the markup below was truncated to fit. Judge only what is present.\n' : ''}
Rendered page markup:
<page>
${html}
</page>`;
}

function toFinding(r) {
  const status = r.verdict === 'violation' ? 'violation' : 'review';
  return {
    engine: AI_ENGINE,
    status,
    impact: status === 'violation' ? r.impact || 'moderate' : 'review',
    ruleId: `claude-${r.sc}`,
    sc: r.sc,
    title: r.title,
    description: r.reasoning,
    fix: r.fix,
    nodes: (r.elements || []).map((e) => ({
      selector: e.selector || '',
      html: e.snippet || '',
      summary: e.issue || ''
    }))
  };
}

/**
 * Ask Claude to judge the WCAG 2.0 AA criteria that automated engines cannot
 * decide, using the page's own markup as evidence.
 *
 * Returns findings in the same shape as every other engine, so they dedupe,
 * summarize, and render exactly like axe-core's. `passed` and `notApplicable`
 * are reported separately — they are not findings and must not inflate the
 * "needs review" count.
 *
 * @returns {Promise<{findings: object[], checked: number, passed: number,
 *   notApplicable: number, skipped?: string}>}
 */
export async function runClaudeReview({ url, title, html, findings = [] }) {
  const empty = { findings: [], checked: 0, passed: 0, notApplicable: 0 };

  if (!process.env.ANTHROPIC_API_KEY) {
    return { ...empty, skipped: 'ANTHROPIC_API_KEY is not set' };
  }

  const client = new Anthropic();
  const { html: pageHtml, truncated } = condenseHtml(html);
  const flaggedScs = [...new Set(findings.map((f) => f.sc).filter(Boolean))].sort();

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'high',
        format: { type: 'json_schema', schema: RESULT_SCHEMA }
      },
      messages: [
        { role: 'user', content: buildPrompt({ url, title, html: pageHtml, truncated, flaggedScs }) }
      ]
    });

    if (response.stop_reason === 'refusal') {
      return { ...empty, skipped: 'Claude declined to review this page' };
    }

    const text = response.content.find((b) => b.type === 'text')?.text;
    if (!text) return { ...empty, skipped: 'Claude returned no result' };

    const results = JSON.parse(text).results || [];

    return {
      findings: results
        .filter((r) => r.verdict === 'violation' || r.verdict === 'review')
        .map(toFinding),
      checked: results.length,
      passed: results.filter((r) => r.verdict === 'pass').length,
      notApplicable: results.filter((r) => r.verdict === 'not_applicable').length
    };
  } catch (err) {
    // The AI pass is additive — a failure here must never sink a scan that the
    // four deterministic engines already completed.
    if (err instanceof Anthropic.AuthenticationError) {
      return { ...empty, skipped: 'ANTHROPIC_API_KEY was rejected' };
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { ...empty, skipped: 'Claude API rate limit reached — try again shortly' };
    }
    if (err instanceof Anthropic.APIError) {
      return { ...empty, skipped: `Claude API error (${err.status}): ${err.message}` };
    }
    return { ...empty, skipped: `Claude review failed: ${err.message}` };
  }
}
