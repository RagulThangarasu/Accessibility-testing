import Anthropic from '@anthropic-ai/sdk';
import { WCAG_20_AA, TOTAL_CRITERIA } from './wcag.js';
import { scName } from './engines.js';

export const AI_ENGINE = 'claude';
const MODEL = 'claude-opus-4-8';

// The rendered page is sent verbatim so Claude can cite real selectors and
// markup. Scripts and styles carry no accessibility signal, so they are dropped
// before the cap is applied — otherwise a single bundled JS file would eat the
// whole budget and push the actual content out.
const MAX_HTML_CHARS = 120_000;

// Unresolved items are sent for adjudication with their markup. This cap keeps a
// pathological page from blowing out the request.
const MAX_UNRESOLVED = 40;

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

const ELEMENT_SCHEMA = {
  type: 'object',
  properties: {
    selector: { type: 'string', description: 'CSS selector for the element.' },
    snippet: { type: 'string', description: "The element's markup, copied from the page." },
    issue: { type: 'string', description: 'What is wrong with this specific element.' }
  },
  required: ['selector', 'snippet', 'issue'],
  additionalProperties: false
};

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    criteria: {
      type: 'array',
      description: 'One entry for EVERY success criterion you were given. No omissions.',
      items: {
        type: 'object',
        properties: {
          sc: { type: 'string', description: 'Success criterion number, e.g. "1.4.1".' },
          verdict: {
            type: 'string',
            enum: ['violation', 'pass', 'not_applicable'],
            description:
              'violation = the page fails this criterion. pass = the page meets it. ' +
              'not_applicable = the page contains no content this criterion governs ' +
              '(e.g. no video, so captions cannot apply). You MUST choose one — ' +
              '"needs review" is not an option.'
          },
          confidence: {
            type: 'string',
            enum: ['high', 'medium', 'low'],
            description:
              'How certain the verdict is from the markup alone. Use low when a ' +
              'rendered view would be needed to be sure. Report it honestly — a ' +
              'confident-sounding wrong answer is worse than a hedged right one.'
          },
          impact: {
            type: 'string',
            enum: ['critical', 'serious', 'moderate', 'minor'],
            description: 'How badly a real user is affected. Ignored unless verdict is "violation".'
          },
          title: {
            type: 'string',
            description: 'One line naming the specific problem on THIS page, not the criterion.'
          },
          reasoning: {
            type: 'string',
            description: 'The evidence in the page that led to this verdict. Be concrete.'
          },
          fix: {
            type: 'string',
            description: 'A concrete change a developer can make. Empty unless verdict is "violation".'
          },
          elements: {
            type: 'array',
            description: 'The elements this verdict is about. Empty if none apply.',
            items: ELEMENT_SCHEMA
          }
        },
        required: ['sc', 'verdict', 'confidence', 'impact', 'title', 'reasoning', 'fix', 'elements'],
        additionalProperties: false
      }
    },
    adjudications: {
      type: 'array',
      description:
        'One entry for EVERY unresolved item you were given, matched by id. Each must ' +
        'be settled as a violation or a pass — that is the whole point of this step.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'The id of the unresolved item.' },
          verdict: {
            type: 'string',
            enum: ['violation', 'pass'],
            description: 'Settle it. "violation" = the engine\'s suspicion is correct. "pass" = it is a false positive.'
          },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          impact: {
            type: 'string',
            enum: ['critical', 'serious', 'moderate', 'minor'],
            description: 'Ignored unless verdict is "violation".'
          },
          reasoning: { type: 'string', description: 'Why this is or is not a real failure.' },
          fix: { type: 'string', description: 'The concrete fix. Empty if verdict is "pass".' }
        },
        required: ['id', 'verdict', 'confidence', 'impact', 'reasoning', 'fix'],
        additionalProperties: false
      }
    }
  },
  required: ['criteria', 'adjudications'],
  additionalProperties: false
};

const SYSTEM = `You are a WCAG 2.0 Level AA accessibility auditor. You are the final
stage of an automated scanner, and you are the one who decides.

Five engines have already run: axe-core, Siteimprove Alfa (the W3C ACT Rules
reference implementation), HTML_CodeSniffer, an HTML validator, and scripted
interaction checks that actually drive the keyboard and zoom the page.

You have two jobs, and there is no third option in either:

1. RETURN A VERDICT ON EVERY SUCCESS CRITERION you are given — all of them, with no
   omissions. Each is a violation, a pass, or not applicable. "Needs review" does
   not exist here. This report leaves nothing for a human to pick up afterwards, so
   if you defer, the criterion goes unanswered.

2. SETTLE EVERY UNRESOLVED ITEM the engines could not decide. Each was flagged
   because a rule engine hit its limit — a suspected problem it cannot confirm from
   markup alone. Look at the element and rule: violation, or false positive.

How to decide well:

- Judge only what the supplied markup actually shows. Never invent content you
  cannot see. If the page has no <video>, captions are not_applicable — not a pass,
  and certainly not a violation.
- Absence of evidence is evidence, when the evidence would have to be in the markup.
  A <video> with no <track kind="captions"> fails 1.2.2, full stop. You do not need
  to watch the video to know the captions are not there.
- Where a criterion genuinely depends on something markup cannot show (whether a
  caption is accurate, whether a flash exceeds three per second), decide from what
  the markup DOES establish and set confidence to "low". State the limit in your
  reasoning. Do not refuse to answer.
- The criteria already failed by the engines are listed for you. Do not re-report
  them — they are covered, and duplicating them inflates the count.
- Write the title, reasoning, and fix for a developer who has not read the WCAG
  spec. Name the element and the change, not the criterion.`;

function buildPrompt({ url, title, html, truncated, flaggedScs, unresolved }) {
  const criteria = WCAG_20_AA.map(
    (c) => `- ${c.sc} (Level ${c.level}) ${c.name}: ${c.check}`
  ).join('\n');

  const covered = flaggedScs.length
    ? flaggedScs.map((sc) => `${sc} ${scName(sc) || ''}`.trim()).join(', ')
    : 'none';

  const unresolvedBlock = unresolved.length
    ? unresolved
        .map(({ id, finding: f }) => {
          const els = f.nodes
            .slice(0, 3)
            .map((n) => `      element: ${n.selector || '(no selector)'}\n      markup: ${n.html || '(none)'}`)
            .join('\n');
          return `  id ${id} — SC ${f.sc || 'unmapped'} — flagged by ${f.engine}
      rule: ${f.ruleId}
      concern: ${f.title}
${els || '      (no specific element)'}`;
        })
        .join('\n\n')
    : '  (none — the engines settled everything they saw)';

  return `Page URL: ${url}
Page title: ${title || '(none)'}

=== ALREADY FAILED BY THE ENGINES — do NOT re-report these ===
${covered}

=== JOB 1: return a verdict on every one of these ${TOTAL_CRITERIA} criteria ===
${criteria}

=== JOB 2: settle every one of these unresolved items ===
${unresolvedBlock}
${truncated ? '\nNote: the markup below was truncated to fit. Judge only what is present.\n' : ''}
=== The rendered page ===
<page>
${html}
</page>`;
}

/**
 * Check that an Anthropic API key works *and* can reach the model we review with,
 * before a scan is started.
 *
 * This calls the Models endpoint, not Messages: it authenticates the key and
 * confirms model access without spending a single token. Catching a bad key here
 * means the user finds out in a second, rather than after a ten-minute crawl.
 *
 * @returns {Promise<{ok: boolean, model?: string, error?: string}>}
 */
export async function validateApiKey(apiKey) {
  const key = (apiKey || process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) return { ok: false, error: 'No API key provided.' };

  try {
    const model = await new Anthropic({ apiKey: key }).models.retrieve(MODEL);
    return { ok: true, model: model.display_name || model.id };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: 'This key was rejected by Anthropic. Check it and try again.' };
    }
    if (err instanceof Anthropic.PermissionDeniedError) {
      return { ok: false, error: `This key is valid but has no access to ${MODEL}.` };
    }
    if (err instanceof Anthropic.NotFoundError) {
      return { ok: false, error: `${MODEL} is not available to this account.` };
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'Rate limited while checking the key. Try again shortly.' };
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return { ok: false, error: 'Could not reach the Anthropic API. Check your network.' };
    }
    if (err instanceof Anthropic.APIError) {
      return { ok: false, error: `Anthropic API error (${err.status}): ${err.message}` };
    }
    return { ok: false, error: err.message };
  }
}

function toFinding(r) {
  return {
    engine: AI_ENGINE,
    status: 'violation',
    impact: r.impact || 'moderate',
    ruleId: `claude-${r.sc}`,
    sc: r.sc,
    title: r.title,
    description: r.reasoning,
    fix: r.fix,
    confidence: r.confidence,
    nodes: (r.elements || []).map((e) => ({
      selector: e.selector || '',
      html: e.snippet || '',
      summary: e.issue || ''
    }))
  };
}

/**
 * Have Claude decide the whole standard, and settle everything the engines could
 * not.
 *
 * The point is a report with **no manual leftovers**: every one of the 38 WCAG 2.0
 * AA criteria gets a verdict, and every "needs review" item an engine emitted gets
 * resolved into a pass or a violation. Uncertainty is expressed as a confidence
 * level on the answer, not as a refusal to answer.
 *
 * @returns {Promise<{findings, adjudications, checked, passed, notApplicable,
 *   resolved, lowConfidence, skipped?}>}
 */
export async function runClaudeReview({ url, title, html, findings = [], apiKey }) {
  const empty = {
    findings: [],
    adjudications: [],
    checked: 0,
    passed: 0,
    notApplicable: 0,
    resolved: 0,
    lowConfidence: 0
  };

  // A key supplied with the request wins over the server's environment, so the
  // UI can drive a review on a server that has no key of its own.
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) return { ...empty, skipped: 'no Anthropic API key provided' };

  const client = new Anthropic({ apiKey: key });
  const { html: pageHtml, truncated } = condenseHtml(html);

  const flaggedScs = [
    ...new Set(findings.filter((f) => f.status === 'violation').map((f) => f.sc).filter(Boolean))
  ].sort();

  // Everything the engines flagged but could not decide. Settling these is what
  // removes the manual step.
  //
  // The original finding object is carried by reference, not copied: the caller
  // folds each ruling back onto the exact finding it settles, and a copy would
  // never match.
  const unresolved = findings
    .filter((f) => f.status === 'review')
    .slice(0, MAX_UNRESOLVED)
    .map((f, i) => ({ id: i, finding: f }));

  try {
    // Streamed, not a plain create(): judging 38 criteria against a full page with
    // adaptive thinking is a long generation, and a non-streaming request with a
    // max_tokens this high is rejected outright by the SDK — it cannot guarantee
    // the response arrives inside the 10-minute request timeout. finalMessage()
    // reassembles the stream, so the rest of this function is unchanged.
    const response = await client.messages
      .stream({
        model: MODEL,
        max_tokens: 32000,
        system: SYSTEM,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'high',
          format: { type: 'json_schema', schema: RESULT_SCHEMA }
        },
        messages: [
          {
            role: 'user',
            content: buildPrompt({
              url,
              title,
              html: pageHtml,
              truncated,
              flaggedScs,
              unresolved
            })
          }
        ]
      })
      .finalMessage();

    if (response.stop_reason === 'refusal') {
      return { ...empty, skipped: 'Claude declined to review this page' };
    }
    if (response.stop_reason === 'max_tokens') {
      return { ...empty, skipped: 'Claude\'s review was cut short — the page is too large' };
    }

    const text = response.content.find((b) => b.type === 'text')?.text;
    if (!text) return { ...empty, skipped: 'Claude returned no result' };

    const parsed = JSON.parse(text);
    const criteria = parsed.criteria || [];
    const rulings = parsed.adjudications || [];

    // Map each ruling back to the finding it settles, by the id we assigned.
    const byId = new Map(unresolved.map((u) => [u.id, u.finding]));
    const adjudications = rulings
      .filter((r) => byId.has(r.id))
      .map((r) => ({ ...r, finding: byId.get(r.id) }));

    const lowConfidence =
      criteria.filter((c) => c.confidence === 'low').length +
      rulings.filter((r) => r.confidence === 'low').length;

    return {
      findings: criteria.filter((c) => c.verdict === 'violation').map(toFinding),
      adjudications,
      checked: criteria.length,
      passed: criteria.filter((c) => c.verdict === 'pass').length,
      notApplicable: criteria.filter((c) => c.verdict === 'not_applicable').length,
      resolved: adjudications.length,
      lowConfidence
    };
  } catch (err) {
    // The AI pass is additive — a failure here must never sink a scan that the
    // deterministic engines already completed.
    if (err instanceof Anthropic.AuthenticationError) {
      return { ...empty, skipped: 'the Anthropic API key was rejected' };
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
