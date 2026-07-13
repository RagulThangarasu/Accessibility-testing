const form = document.getElementById('scan-form');
const urlInput = document.getElementById('url');
const scanBtn = document.getElementById('scan-btn');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const cardsEl = document.getElementById('cards');

function showStatus(html, isError = false) {
  statusEl.className = 'status' + (isError ? ' error' : '');
  statusEl.innerHTML = html;
  statusEl.classList.remove('hidden');
}

function showLoading() {
  statusEl.className = 'status loading';
  statusEl.innerHTML = '<div class="spinner" aria-hidden="true"></div>';
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

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;

  // After clicking Validate, collapse the intro so only the card below shows.
  document.body.classList.add('scanning');
  resultsEl.classList.add('hidden');
  scanBtn.disabled = true;
  showLoading();

  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error || 'Scan failed.');
    }

    // Report is ready — stop the spinner before rendering the results card.
    stopLoading();

    document.getElementById('result-title').textContent = data.title || 'Scan results';
    const urlLink = document.getElementById('result-url');
    urlLink.textContent = data.finalUrl || data.url;
    urlLink.href = data.finalUrl || data.url;

    const pdfBtn = document.getElementById('download-pdf');
    if (data.reportPdfUrl) {
      pdfBtn.href = data.reportPdfUrl;
      pdfBtn.style.display = '';
    } else {
      pdfBtn.style.display = 'none';
    }

    const s = data.summary;
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

    resultsEl.classList.remove('hidden');
  } catch (err) {
    showStatus(`⚠️ ${err.message}`, true);
  } finally {
    scanBtn.disabled = false;
  }
});
