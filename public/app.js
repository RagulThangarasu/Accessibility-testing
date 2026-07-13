const form = document.getElementById('scan-form');
const urlInput = document.getElementById('url');
const scanBtn = document.getElementById('scan-btn');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const cardsEl = document.getElementById('cards');
const issuesEl = document.getElementById('issues');
const sitemapToggle = document.getElementById('sitemap');
const limitWrap = document.getElementById('limit-wrap');
const limitSelect = document.getElementById('limit');

sitemapToggle.addEventListener('change', () => {
  limitWrap.hidden = !sitemapToggle.checked;
});

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
        <td><strong>${esc(i.title)}</strong><div class="sub">${esc(i.scLabel)}</div></td>
        <td class="reach"><strong>${i.pages}</strong> page${i.pages === 1 ? '' : 's'}</td>
      </tr>`;
    })
    .join('');

  issuesEl.innerHTML = `
    <h3>Issues across the site</h3>
    <table class="issue-table">
      <thead><tr><th>Severity</th><th>Issue</th><th>Reach</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
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
  const limit = Number(limitSelect.value);

  // After clicking Validate, collapse the intro so only the card below shows.
  document.body.classList.add('scanning');
  resultsEl.classList.add('hidden');
  issuesEl.classList.add('hidden');
  scanBtn.disabled = true;
  showLoading(
    crawl
      ? `Finding the sitemap and scanning up to ${limit} pages. This can take several minutes.`
      : ''
  );

  try {
    const res = await fetch(crawl ? '/api/scan-site' : '/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(crawl ? { url, limit } : { url })
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

      cardsEl.innerHTML = [
        card(t.pages, 'Pages', '#4f46e5'),
        card(t.violations, 'Violations', '#b00020'),
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

      cardsEl.innerHTML = [
        card(s.violations, 'Violations', '#b00020'),
        card(s.byImpact.critical, 'Critical', '#b00020'),
        card(s.byImpact.serious, 'Serious', '#d35400'),
        card(s.byImpact.moderate, 'Moderate', '#c79100'),
        card(s.byImpact.minor, 'Minor', '#2e7d32'),
        card(s.review, 'Needs review', '#6b7280'),
        card(s.affectedElements, 'Elements affected', '#5b6472'),
        card(s.passes, 'axe passed', '#2e7d32')
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
