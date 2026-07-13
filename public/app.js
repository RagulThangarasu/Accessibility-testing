const form = document.getElementById('scan-form');
const urlInput = document.getElementById('url');
const scanBtn = document.getElementById('scan-btn');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const cardsEl = document.getElementById('cards');
const issuesEl = document.getElementById('issues');
const sitemapToggle = document.getElementById('sitemap');
const sitemapPanel = document.getElementById('sitemap-panel');
const sitemapUrlRow = document.getElementById('sitemap-url-row');
const sitemapFileRow = document.getElementById('sitemap-file-row');
const sitemapUrlInput = document.getElementById('sitemap-url');
const sitemapFileInput = document.getElementById('sitemap-file');
const sitemapFileNote = document.getElementById('sitemap-file-note');
const limitSelect = document.getElementById('limit');

const aiToggle = document.getElementById('use-ai');
const aiPanel = document.getElementById('ai-panel');
const apiKeyInput = document.getElementById('api-key');
const validateKeyBtn = document.getElementById('validate-key');
const keyStatus = document.getElementById('key-status');

// The contents of an uploaded sitemap, read in the browser and posted as text.
let uploadedSitemap = null;

// Tracks whether the key currently in the box has been checked against the API.
// Editing the key invalidates the check — a stale "valid" tick on a changed key
// would be worse than no tick at all.
let keyValidated = false;

let serverHasKey = false;
fetch('/api/config')
  .then((r) => r.json())
  .then((c) => {
    serverHasKey = c.hasServerKey;
    if (serverHasKey) {
      apiKeyInput.placeholder = 'Using the key from the server .env';
      setKeyStatus('The server already has a key configured. Leave this blank to use it.');
    }
  })
  .catch(() => {});

function setKeyStatus(msg, state = '') {
  keyStatus.className = 'hint' + (state ? ` ${state}` : '');
  keyStatus.textContent = msg;
}

function sitemapSource() {
  return document.querySelector('input[name="sitemap-src"]:checked')?.value || 'auto';
}

sitemapToggle.addEventListener('change', () => {
  sitemapPanel.hidden = !sitemapToggle.checked;
});

aiToggle.addEventListener('change', () => {
  aiPanel.hidden = !aiToggle.checked;
});

for (const radio of document.querySelectorAll('input[name="sitemap-src"]')) {
  radio.addEventListener('change', () => {
    sitemapUrlRow.hidden = sitemapSource() !== 'url';
    sitemapFileRow.hidden = sitemapSource() !== 'file';
  });
}

sitemapFileInput.addEventListener('change', async () => {
  const file = sitemapFileInput.files?.[0];
  if (!file) {
    uploadedSitemap = null;
    sitemapFileNote.textContent = '';
    return;
  }
  uploadedSitemap = await file.text();
  const urls = (uploadedSitemap.match(/<loc\b/gi) || []).length;
  sitemapFileNote.textContent = urls
    ? `${file.name} — ${urls} URL${urls === 1 ? '' : 's'}`
    : `${file.name} — no <loc> entries found`;
});

// Any edit to the key means the previous check no longer applies.
apiKeyInput.addEventListener('input', () => {
  keyValidated = false;
  setKeyStatus('Key changed — validate it again.', '');
});

async function validateKey() {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey && serverHasKey) {
    keyValidated = true;
    setKeyStatus('✓ Using the server\'s configured key.', 'ok');
    return true;
  }
  if (!apiKey) {
    setKeyStatus('Enter a key first.', 'bad');
    return false;
  }

  validateKeyBtn.disabled = true;
  setKeyStatus('Checking the key…');
  try {
    const res = await fetch('/api/validate-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey })
    });
    const data = await res.json();
    keyValidated = Boolean(data.ok);
    setKeyStatus(
      data.ok ? `✓ Key is valid — ${data.model} is reachable.` : `✗ ${data.error}`,
      data.ok ? 'ok' : 'bad'
    );
    return keyValidated;
  } catch (err) {
    keyValidated = false;
    setKeyStatus(`✗ Could not check the key: ${err.message}`, 'bad');
    return false;
  } finally {
    validateKeyBtn.disabled = false;
  }
}

validateKeyBtn.addEventListener('click', validateKey);

function showStatus(html, isError = false) {
  statusEl.className = 'status' + (isError ? ' error' : '');
  statusEl.innerHTML = html;
  statusEl.classList.remove('hidden');
}

function showLoading(message = '') {
  statusEl.className = 'status loading';
  statusEl.innerHTML =
    '<div class="spinner" aria-hidden="true"></div>' +
    (message ? `<p class="loading-note">${message}</p>` : '');
  statusEl.classList.remove('hidden');
}

// Clears the loading state: removes the spinner, hides the status box, and
// re-enables the button. Called on every completion path so the spinner can
// never keep running after the report is generated.
function stopLoading() {
  statusEl.classList.add('hidden');
  statusEl.innerHTML = '';
  scanBtn.disabled = false;
}

function card(num, label, color) {
  return `<div class="card"><div class="num" style="color:${color}">${num}</div><div class="label">${label}</div></div>`;
}

function esc(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

// Claude judges the criteria the rule engines can't. When it doesn't run, say
// so — a silent skip would read as "those criteria are fine".
function renderAiNote(ai) {
  const el = document.getElementById('ai-note');
  if (!ai) {
    el.classList.add('hidden');
    return;
  }
  if (ai.skipped) {
    el.className = 'ai-note off';
    el.textContent = `Claude review did not run (${ai.skipped}). Criteria needing human judgment were not assessed.`;
  } else {
    const flagged = ai.flagged ?? ai.findings.length;
    el.className = 'ai-note';
    el.textContent =
      `Claude reviewed ${ai.checked} criteria that automated engines can't decide: ` +
      `${flagged} need attention, ${ai.passed} passed, ${ai.notApplicable} not applicable.`;
  }
  el.classList.remove('hidden');
}

const IMPACT_COLOR = {
  critical: '#b00020',
  serious: '#d35400',
  moderate: '#c79100',
  minor: '#2e7d32',
  review: '#6b7280'
};

function levelChip(level) {
  if (!level) return '<span class="lvl lvl-none">—</span>';
  return `<span class="lvl lvl-${level.toLowerCase()}">Level ${level}</span>`;
}

// WCAG is cumulative: AA requires every Level A criterion too. So one Level A
// failure means the page conforms at no level — say that outright rather than
// leaving the reader to work it out from a violation count.
function renderVerdict(summary) {
  const el = document.getElementById('verdict');
  const a = summary.byLevel.A.violations;
  const aa = summary.byLevel.AA.violations;

  let cls, headline, detail;
  if (a) {
    cls = 'fail';
    headline = 'Does not conform — Level A failures found';
    detail =
      `${a} Level A criteri${a === 1 ? 'on is' : 'a are'} failing, so the page conforms at ` +
      `no level — not A, not AA.` +
      (aa ? ` ${aa} Level AA failure${aa === 1 ? '' : 's'} on top of that.` : '') +
      ' Fix the Level A items first.';
  } else if (aa) {
    cls = 'partial';
    headline = 'Conforms to Level A, but not Level AA';
    detail = `No Level A failures. ${aa} Level AA criteri${
      aa === 1 ? 'on is' : 'a are'
    } failing, which is what blocks AA.`;
  } else {
    cls = 'pass';
    headline = 'No automated A or AA failures detected';
    detail =
      summary.review > 0
        ? `${summary.review} item${summary.review === 1 ? '' : 's'} still need human review — ` +
          'automated testing alone cannot prove conformance.'
        : 'Automated testing alone cannot prove conformance; judgment-based criteria still need a person.';
  }

  el.className = `verdict verdict-${cls}`;
  el.innerHTML = `<h3>${headline}</h3><p>${detail}</p>`;
  el.classList.remove('hidden');
}

function levelCards(byLevel) {
  return [
    `<div class="card"><div class="num" style="color:${
      byLevel.A.violations ? '#b00020' : '#2e7d32'
    }">${byLevel.A.violations}</div><div class="label">Level A failures</div>
     <div class="sub">blocks all conformance</div></div>`,
    `<div class="card"><div class="num" style="color:${
      byLevel.AA.violations ? '#d35400' : '#2e7d32'
    }">${byLevel.AA.violations}</div><div class="label">Level AA failures</div>
     <div class="sub">blocks AA</div></div>`
  ].join('');
}

// For a whole site, the useful ranking is by reach: a problem on 9 of 10 pages
// lives in a shared template, so fixing it once clears the site.
function renderIssues(issues) {
  if (!issues?.length) {
    issuesEl.classList.add('hidden');
    return;
  }
  const rows = issues
    .slice(0, 15)
    .map((i) => {
      const color = IMPACT_COLOR[i.impact] || '#555';
      const badge = i.status === 'review' ? 'review' : i.impact;
      return `<tr>
        <td><span class="pill" style="background:${color}">${esc(badge)}</span></td>
        <td>${levelChip(i.level)}</td>
        <td><strong>${esc(i.title)}</strong><div class="sub">${esc(i.scLabel)}</div></td>
        <td class="reach"><strong>${i.pages}</strong> page${i.pages === 1 ? '' : 's'}</td>
      </tr>`;
    })
    .join('');

  issuesEl.innerHTML = `
    <h3>Issues across the site <span class="muted">— worst first, Level A ahead of AA</span></h3>
    <table class="issue-table">
      <thead><tr><th>Severity</th><th>Level</th><th>Issue</th><th>Reach</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="muted">Full detail, with the exact elements and fixes, is in the HTML and PDF reports.</p>`;
  issuesEl.classList.remove('hidden');
}

function setLink(id, href) {
  const el = document.getElementById(id);
  if (href) {
    el.href = href;
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;

  const crawl = sitemapToggle.checked;
  const useAi = aiToggle.checked;
  const limit = Number(limitSelect.value);
  const source = sitemapSource();

  if (crawl && source === 'url' && !sitemapUrlInput.value.trim()) {
    showStatus('⚠️ Enter the sitemap URL, or switch back to finding it automatically.', true);
    return;
  }
  if (crawl && source === 'file' && !uploadedSitemap) {
    showStatus('⚠️ Choose a sitemap file to upload, or switch back to finding it automatically.', true);
    return;
  }

  // Check the key before doing any work. A crawl is minutes long; discovering a
  // bad key at the end of it — after every page has already been scanned — would
  // waste all of that time.
  if (useAi && !keyValidated) {
    scanBtn.disabled = true;
    const ok = await validateKey();
    scanBtn.disabled = false;
    if (!ok) {
      showStatus('⚠️ Fix the Claude API key before scanning, or untick “Validate with Claude AI”.', true);
      return;
    }
  }

  // After clicking Validate, collapse the intro so only the card below shows.
  document.body.classList.add('scanning');
  resultsEl.classList.add('hidden');
  issuesEl.classList.add('hidden');
  scanBtn.disabled = true;

  const aiNote = useAi ? ' Claude is reviewing each page, which adds time.' : '';
  showLoading(
    crawl
      ? `Scanning up to ${limit} pages from the sitemap. This can take several minutes.${aiNote}`
      : useAi
        ? 'Scanning the page and running the Claude review.'
        : ''
  );

  const payload = { url, ai: useAi };
  if (useAi && apiKeyInput.value.trim()) payload.apiKey = apiKeyInput.value.trim();
  if (crawl) {
    payload.limit = limit;
    if (source === 'url') payload.sitemapUrl = sitemapUrlInput.value.trim();
    if (source === 'file') payload.sitemapXml = uploadedSitemap;
  }

  try {
    const res = await fetch(crawl ? '/api/scan-site' : '/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error || 'Scan failed.');
    }

    // Report is ready — stop the spinner before rendering the results card.
    stopLoading();

    const urlLink = document.getElementById('result-url');

    if (data.mode === 'site') {
      const t = data.totals;
      document.getElementById('result-title').textContent =
        `${t.pages} page${t.pages === 1 ? '' : 's'} scanned from the sitemap`;
      urlLink.textContent = data.site;
      urlLink.href = data.site;

      renderVerdict(t);
      cardsEl.innerHTML =
        card(t.pages, 'Pages scanned', '#4f46e5') +
        levelCards(t.byLevel) +
        [
          card(t.byImpact.critical, 'Critical', '#b00020'),
          card(t.byImpact.serious, 'Serious', '#d35400'),
          card(t.byImpact.moderate, 'Moderate', '#c79100'),
          card(t.byImpact.minor, 'Minor', '#2e7d32'),
          card(t.review, 'Needs review', '#6b7280'),
          card(t.affectedElements, 'Elements affected', '#5b6472')
        ].join('');

      renderAiNote(t.ai);
      renderIssues(data.issues);
    } else {
      const s = data.summary;
      document.getElementById('result-title').textContent = data.title || 'Scan results';
      urlLink.textContent = data.finalUrl || data.url;
      urlLink.href = data.finalUrl || data.url;

      renderVerdict(s);
      cardsEl.innerHTML =
        levelCards(s.byLevel) +
        [
          card(s.byImpact.critical, 'Critical', '#b00020'),
          card(s.byImpact.serious, 'Serious', '#d35400'),
          card(s.byImpact.moderate, 'Moderate', '#c79100'),
          card(s.byImpact.minor, 'Minor', '#2e7d32'),
          card(s.review, 'Needs review', '#6b7280'),
          card(s.affectedElements, 'Elements affected', '#5b6472')
        ].join('');

      renderAiNote(s.ai);
      renderIssues(null);
    }

    setLink('download-html', data.reportHtmlUrl);
    setLink('download-pdf', data.reportPdfUrl);

    resultsEl.classList.remove('hidden');
  } catch (err) {
    showStatus(`⚠️ ${err.message}`, true);
  } finally {
    scanBtn.disabled = false;
  }
});
