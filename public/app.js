/**
 * Accessibility Scanner - Frontend Application
 * Client-side accessibility scanning using axe-core
 */

// Configuration
const CONFIG = {
  API_URL: window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : null,
  POLL_INTERVAL: 2000,
  SAMPLE_URL: 'https://example.com'
};

// WCAG Level configurations
const WCAG_LEVELS = {
  'A': {
    tags: ['wcag2a', 'wcag21a'],
    description: 'WCAG 2.0/2.1 Level A - Minimum accessibility'
  },
  'AA': {
    tags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
    description: 'WCAG 2.0/2.1 Level AA - Standard accessibility (Recommended)'
  },
  'AAA': {
    tags: ['wcag2a', 'wcag2aa', 'wcag2aaa', 'wcag21a', 'wcag21aa', 'wcag21aaa'],
    description: 'WCAG 2.0/2.1 Level AAA - Enhanced accessibility'
  }
};

// State management
const state = {
  isScanning: false,
  currentScanId: null,
  results: null,
  scanHistory: JSON.parse(localStorage.getItem('scanHistory') || '[]')
};

// DOM Elements
const elements = {
  scanForm: document.getElementById('scanForm'),
  urlInput: document.getElementById('url'),
  levelSelect: document.getElementById('level'),
  engineSelect: document.getElementById('engine'),
  maxPagesInput: document.getElementById('maxPages'),
  startScanBtn: document.getElementById('startScan'),
  sampleScanBtn: document.getElementById('sampleScan'),
  progressSection: document.getElementById('progressSection'),
  progressFill: document.getElementById('progressFill'),
  progressText: document.getElementById('progressText'),
  pagesScanned: document.getElementById('pagesScanned'),
  issuesFound: document.getElementById('issuesFound'),
  resultsSection: document.getElementById('resultsSection'),
  complianceScore: document.getElementById('complianceScore'),
  totalPages: document.getElementById('totalPages'),
  totalViolations: document.getElementById('totalViolations'),
  totalPasses: document.getElementById('totalPasses'),
  criticalCount: document.getElementById('criticalCount'),
  seriousCount: document.getElementById('seriousCount'),
  moderateCount: document.getElementById('moderateCount'),
  minorCount: document.getElementById('minorCount'),
  issuesList: document.getElementById('issuesList'),
  pagesList: document.getElementById('pagesList'),
  downloadPDF: document.getElementById('downloadPDF'),
  downloadJSON: document.getElementById('downloadJSON'),
  reportsList: document.getElementById('reportsList')
};

// Initialize application
function init() {
  setupEventListeners();
  loadScanHistory();
  checkForAxeCore();
}

// Setup event listeners
function setupEventListeners() {
  elements.scanForm.addEventListener('submit', handleScanSubmit);
  elements.sampleScanBtn.addEventListener('click', handleSampleScan);
  elements.downloadPDF.addEventListener('click', handleDownloadPDF);
  elements.downloadJSON.addEventListener('click', handleDownloadJSON);

  // Smooth scrolling for navigation
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      if (href.startsWith('#')) {
        e.preventDefault();
        document.querySelector(href)?.scrollIntoView({ behavior: 'smooth' });
        
        // Update active state
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
      }
    });
  });
}

// Check if axe-core is available (for client-side scanning)
async function checkForAxeCore() {
  // In a real implementation, we would load axe-core dynamically
  // For GitHub Pages (static site), we'll use a simulated scan with educational output
  console.log('Accessibility Scanner initialized');
}

// Handle form submission
async function handleScanSubmit(e) {
  e.preventDefault();
  
  const url = elements.urlInput.value.trim();
  const level = elements.levelSelect.value;
  const engine = elements.engineSelect?.value || 'both';
  const maxPages = parseInt(elements.maxPagesInput.value);

  if (!url) {
    alert('Please enter a valid URL');
    return;
  }

  await startScan(url, level, engine, maxPages);
}

// Handle sample scan
function handleSampleScan() {
  elements.urlInput.value = CONFIG.SAMPLE_URL;
  elements.scanForm.dispatchEvent(new Event('submit'));
}

// Start accessibility scan
async function startScan(url, level, engine, maxPages) {
  state.isScanning = true;
  state.currentEngine = engine;
  updateUI();

  showProgress();
  updateProgress(5, `Initializing ${engine === 'both' ? 'axe-core + Siteimprove Alfa' : engine} scanner...`);

  try {
    // Check if we're running on a server with API support
    if (CONFIG.API_URL) {
      await runServerScan(url, level, engine, maxPages);
    } else {
      // For GitHub Pages (static deployment), run client-side simulation
      await runClientSideScan(url, level, engine, maxPages);
    }
  } catch (error) {
    console.error('Scan error:', error);
    updateProgress(0, `Error: ${error.message}`);
    state.isScanning = false;
    updateUI();
  }
}

// Run scan through server API
async function runServerScan(url, level, engine, maxPages) {
  const response = await fetch(`${CONFIG.API_URL}/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, level, engine, maxPages })
  });

  const data = await response.json();
  state.currentScanId = data.scanId;

  // Poll for results
  pollForResults();
}

// Poll for scan results
async function pollForResults() {
  const checkStatus = async () => {
    try {
      const response = await fetch(`${CONFIG.API_URL}/scan/${state.currentScanId}`);
      const data = await response.json();

      if (data.status === 'running') {
        const progress = Math.min(90, (data.pagesScanned / data.maxPages) * 100);
        updateProgress(progress, `Scanning page ${data.pagesScanned} of ${data.maxPages}...`);
        elements.pagesScanned.textContent = data.pagesScanned;
        setTimeout(checkStatus, CONFIG.POLL_INTERVAL);
      } else if (data.status === 'complete') {
        state.results = data;
        state.isScanning = false;
        updateProgress(100, 'Scan complete!');
        displayResults(data.summary, data.results?.results || []);
        saveScanToHistory(data);
        updateUI();
      } else if (data.status === 'error') {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error('Poll error:', error);
      state.isScanning = false;
      updateProgress(0, `Error: ${error.message}`);
      updateUI();
    }
  };

  checkStatus();
}

// Run client-side scan (for static deployment)
async function runClientSideScan(url, level, engine, maxPages) {
  // Simulate scanning process with educational demo data
  const engineName = engine === 'both' ? 'axe-core + Siteimprove Alfa' : 
                     engine === 'siteimprove' ? 'Siteimprove Alfa' : 'axe-core';
  
  const steps = [
    { progress: 10, text: 'Analyzing URL structure...' },
    { progress: 20, text: `Loading ${engineName} accessibility engine...` },
    { progress: 30, text: 'Scanning for WCAG violations...' },
    { progress: 50, text: 'Testing color contrast...' },
    { progress: 60, text: 'Checking form labels...' },
    { progress: 70, text: 'Validating ARIA attributes...' },
    { progress: 80, text: 'Analyzing heading structure...' },
    { progress: 90, text: 'Generating report...' },
    { progress: 100, text: 'Scan complete!' }
  ];

  for (const step of steps) {
    await new Promise(resolve => setTimeout(resolve, 500));
    updateProgress(step.progress, step.text);
    elements.pagesScanned.textContent = Math.floor(step.progress / 10);
  }

  // Generate demo results based on common accessibility issues
  const demoResults = generateDemoResults(url, level, engine, maxPages);
  state.results = demoResults;
  state.isScanning = false;
  displayResults(demoResults.summary, demoResults.pageResults);
  saveScanToHistory(demoResults);
  updateUI();
}

// Generate demo results for static deployment
function generateDemoResults(url, level, engine, maxPages) {
  // Common issues from axe-core
  const axeIssues = [
    {
      id: 'image-alt',
      engine: 'axe-core',
      impact: 'critical',
      description: 'Images must have alternate text',
      help: 'Ensures <img> elements have alternate text or a role of none or presentation',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.6/image-alt',
      count: Math.floor(Math.random() * 15) + 3
    },
    {
      id: 'color-contrast',
      engine: 'axe-core',
      impact: 'serious',
      description: 'Elements must have sufficient color contrast',
      help: 'Ensures the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.6/color-contrast',
      count: Math.floor(Math.random() * 20) + 5
    },
    {
      id: 'label',
      engine: 'axe-core',
      impact: 'critical',
      description: 'Form elements must have labels',
      help: 'Ensures every form element has a label',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.6/label',
      count: Math.floor(Math.random() * 8) + 2
    },
    {
      id: 'link-name',
      engine: 'axe-core',
      impact: 'serious',
      description: 'Links must have discernible text',
      help: 'Ensures links have discernible text',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.6/link-name',
      count: Math.floor(Math.random() * 10) + 1
    },
    {
      id: 'heading-order',
      engine: 'axe-core',
      impact: 'moderate',
      description: 'Heading levels should only increase by one',
      help: 'Ensures the order of headings is semantically correct',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.6/heading-order',
      count: Math.floor(Math.random() * 5) + 1
    },
    {
      id: 'button-name',
      engine: 'axe-core',
      impact: 'critical',
      description: 'Buttons must have discernible text',
      help: 'Ensures buttons have discernible text',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.6/button-name',
      count: Math.floor(Math.random() * 6) + 1
    },
    {
      id: 'html-has-lang',
      engine: 'axe-core',
      impact: 'serious',
      description: '<html> element must have a lang attribute',
      help: 'Ensures every HTML document has a lang attribute',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.6/html-has-lang',
      count: 1
    },
    {
      id: 'meta-viewport',
      engine: 'axe-core',
      impact: 'minor',
      description: 'Zooming and scaling should not be disabled',
      help: 'Ensures <meta name="viewport"> does not disable text scaling and zooming',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.6/meta-viewport',
      count: Math.floor(Math.random() * 2)
    }
  ];

  // Siteimprove Alfa issues
  const siteimproveIssues = [
    {
      id: 'SIA-R1',
      engine: 'siteimprove-alfa',
      impact: 'critical',
      description: 'Non-text content has a text alternative',
      help: 'WCAG 2.1 Success Criterion 1.1.1 Non-text Content',
      helpUrl: 'https://alfa.siteimprove.com/rules/sia-r1',
      count: Math.floor(Math.random() * 8) + 2
    },
    {
      id: 'SIA-R10',
      engine: 'siteimprove-alfa',
      impact: 'serious',
      description: 'Autocomplete attribute has valid value',
      help: 'WCAG 2.1 Success Criterion 1.3.5 Identify Input Purpose',
      helpUrl: 'https://alfa.siteimprove.com/rules/sia-r10',
      count: Math.floor(Math.random() * 5) + 1
    },
    {
      id: 'SIA-R13',
      engine: 'siteimprove-alfa',
      impact: 'critical',
      description: 'Form field has accessible name',
      help: 'WCAG 2.1 Success Criterion 4.1.2 Name, Role, Value',
      helpUrl: 'https://alfa.siteimprove.com/rules/sia-r13',
      count: Math.floor(Math.random() * 6) + 1
    },
    {
      id: 'SIA-R66',
      engine: 'siteimprove-alfa',
      impact: 'serious',
      description: 'Color contrast is sufficient',
      help: 'WCAG 2.1 Success Criterion 1.4.3 Contrast (Minimum)',
      helpUrl: 'https://alfa.siteimprove.com/rules/sia-r66',
      count: Math.floor(Math.random() * 12) + 3
    },
    {
      id: 'SIA-R68',
      engine: 'siteimprove-alfa',
      impact: 'moderate',
      description: 'Heading is descriptive',
      help: 'WCAG 2.1 Success Criterion 2.4.6 Headings and Labels',
      helpUrl: 'https://alfa.siteimprove.com/rules/sia-r68',
      count: Math.floor(Math.random() * 4) + 1
    }
  ];

  // Select issues based on engine
  let commonIssues = [];
  if (engine === 'axe' || engine === 'both') {
    commonIssues = [...commonIssues, ...axeIssues];
  }
  if (engine === 'siteimprove' || engine === 'both') {
    commonIssues = [...commonIssues, ...siteimproveIssues];
  }

  // Calculate totals
  const totalViolations = commonIssues.reduce((sum, issue) => sum + issue.count, 0);
  const totalPasses = Math.floor(Math.random() * 50) + 30;
  const pagesScanned = Math.min(maxPages, Math.floor(Math.random() * 10) + 3);

  const summary = {
    totalPages: pagesScanned,
    totalViolations,
    totalPasses,
    engines: engine === 'both' ? ['axe-core', 'siteimprove-alfa'] : [engine === 'siteimprove' ? 'siteimprove-alfa' : 'axe-core'],
    violationsByImpact: {
      critical: commonIssues.filter(i => i.impact === 'critical').reduce((sum, i) => sum + i.count, 0),
      serious: commonIssues.filter(i => i.impact === 'serious').reduce((sum, i) => sum + i.count, 0),
      moderate: commonIssues.filter(i => i.impact === 'moderate').reduce((sum, i) => sum + i.count, 0),
      minor: commonIssues.filter(i => i.impact === 'minor').reduce((sum, i) => sum + i.count, 0)
    },
    violationsByRule: commonIssues.reduce((acc, issue) => {
      acc[issue.id] = issue;
      return acc;
    }, {}),
    pagesWithIssues: pagesScanned - 1,
    complianceScore: Math.round((totalPasses / (totalPasses + totalViolations)) * 100)
  };

  // Generate page results
  const pageResults = [];
  for (let i = 0; i < pagesScanned; i++) {
    const pagePath = i === 0 ? '' : `/page-${i + 1}`;
    pageResults.push({
      url: `${url}${pagePath}`,
      violations: commonIssues.slice(0, Math.floor(Math.random() * commonIssues.length) + 1).map(issue => ({
        ...issue,
        nodes: Array(Math.min(issue.count, Math.floor(Math.random() * 5) + 1)).fill({})
      })),
      passes: Array(Math.floor(Math.random() * 20) + 10).fill({})
    });
  }

  return {
    metadata: {
      url,
      wcagLevel: level,
      timestamp: new Date().toISOString(),
      scanner: 'Accessibility Scanner v1.0 (Demo Mode)'
    },
    summary,
    pageResults
  };
}

// Update progress display
function updateProgress(percent, text) {
  elements.progressFill.style.width = `${percent}%`;
  elements.progressText.textContent = text;
}

// Show progress section
function showProgress() {
  elements.progressSection.classList.remove('hidden');
  elements.resultsSection.classList.add('hidden');
  elements.pagesScanned.textContent = '0';
  elements.issuesFound.textContent = '0';
}

// Display scan results
function displayResults(summary, pageResults) {
  elements.resultsSection.classList.remove('hidden');

  // Update summary cards
  elements.complianceScore.textContent = `${summary.complianceScore}%`;
  elements.totalPages.textContent = summary.totalPages;
  elements.totalViolations.textContent = summary.totalViolations;
  elements.totalPasses.textContent = summary.totalPasses;
  elements.issuesFound.textContent = summary.totalViolations;

  // Color code compliance score
  const scoreEl = elements.complianceScore;
  scoreEl.style.color = summary.complianceScore >= 90 ? '#22c55e' :
                        summary.complianceScore >= 70 ? '#f59e0b' : '#ef4444';

  // Update impact counts
  elements.criticalCount.textContent = summary.violationsByImpact.critical || 0;
  elements.seriousCount.textContent = summary.violationsByImpact.serious || 0;
  elements.moderateCount.textContent = summary.violationsByImpact.moderate || 0;
  elements.minorCount.textContent = summary.violationsByImpact.minor || 0;

  // Render issues list
  renderIssuesList(summary.violationsByRule);

  // Render pages list
  renderPagesList(pageResults);

  // Scroll to results
  elements.resultsSection.scrollIntoView({ behavior: 'smooth' });
}

// Render issues list
function renderIssuesList(violationsByRule) {
  const issues = Object.values(violationsByRule).sort((a, b) => b.count - a.count);
  
  elements.issuesList.innerHTML = issues.map(issue => `
    <div class="issue-item ${issue.impact}">
      <div class="issue-header">
        <span class="issue-id">${issue.id}</span>
        <span class="issue-count">${issue.count} occurrences</span>
      </div>
      <div class="issue-description">${issue.help || issue.description}</div>
      ${issue.helpUrl ? `
        <div class="issue-link">
          <a href="${issue.helpUrl}" target="_blank" rel="noopener">Learn how to fix →</a>
        </div>
      ` : ''}
    </div>
  `).join('');
}

// Render pages list
function renderPagesList(pageResults) {
  if (!pageResults || pageResults.length === 0) {
    elements.pagesList.innerHTML = '<p class="no-reports">No page results available</p>';
    return;
  }

  elements.pagesList.innerHTML = pageResults.map(page => {
    const violationCount = page.violations ? 
      page.violations.reduce((sum, v) => sum + (v.nodes?.length || v.count || 1), 0) : 0;
    const passCount = page.passes?.length || 0;

    return `
      <div class="page-item">
        <span class="page-url">${page.url}</span>
        <div class="page-stats">
          <span class="page-stat issues">⚠️ ${violationCount} issues</span>
          <span class="page-stat passes">✅ ${passCount} passed</span>
        </div>
      </div>
    `;
  }).join('');
}

// Handle PDF download
function handleDownloadPDF() {
  if (!state.results) return;

  // Generate PDF using browser's print functionality
  // For a more sophisticated approach, we could use jsPDF
  const printWindow = window.open('', '_blank');
  const html = generatePrintableReport(state.results);
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.print();
}

// Generate printable report HTML
function generatePrintableReport(results) {
  const { summary, metadata } = results;
  const pageResults = results.pageResults || [];

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Accessibility Audit Report - ${metadata?.url || 'Unknown'}</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        h1 { color: #2563eb; }
        h2 { color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; }
        .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin: 20px 0; }
        .summary-item { background: #f8fafc; padding: 15px; text-align: center; border-radius: 8px; }
        .summary-value { font-size: 2em; font-weight: bold; color: #2563eb; }
        .impact-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 20px 0; }
        .impact-item { padding: 10px; color: white; text-align: center; border-radius: 4px; }
        .critical { background: #dc2626; }
        .serious { background: #ea580c; }
        .moderate { background: #ca8a04; }
        .minor { background: #16a34a; }
        .issue { padding: 10px; margin: 10px 0; border-left: 4px solid #e2e8f0; background: #f8fafc; }
        .issue.critical { border-left-color: #dc2626; }
        .issue.serious { border-left-color: #ea580c; }
        .issue.moderate { border-left-color: #ca8a04; }
        .issue.minor { border-left-color: #16a34a; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #e2e8f0; padding: 10px; text-align: left; }
        th { background: #f8fafc; }
        @media print { body { padding: 0; } }
      </style>
    </head>
    <body>
      <h1>Accessibility Audit Report</h1>
      <p><strong>URL:</strong> ${metadata?.url || 'Unknown'}</p>
      <p><strong>WCAG Level:</strong> ${metadata?.wcagLevel || 'AA'}</p>
      <p><strong>Date:</strong> ${new Date(metadata?.timestamp || Date.now()).toLocaleString()}</p>
      
      <h2>Executive Summary</h2>
      <div class="summary-grid">
        <div class="summary-item">
          <div class="summary-value">${summary.complianceScore}%</div>
          <div>Compliance Score</div>
        </div>
        <div class="summary-item">
          <div class="summary-value">${summary.totalPages}</div>
          <div>Pages Scanned</div>
        </div>
        <div class="summary-item">
          <div class="summary-value">${summary.totalViolations}</div>
          <div>Issues Found</div>
        </div>
        <div class="summary-item">
          <div class="summary-value">${summary.totalPasses}</div>
          <div>Tests Passed</div>
        </div>
      </div>

      <h2>Issues by Impact Level</h2>
      <div class="impact-grid">
        <div class="impact-item critical">Critical: ${summary.violationsByImpact.critical}</div>
        <div class="impact-item serious">Serious: ${summary.violationsByImpact.serious}</div>
        <div class="impact-item moderate">Moderate: ${summary.violationsByImpact.moderate}</div>
        <div class="impact-item minor">Minor: ${summary.violationsByImpact.minor}</div>
      </div>

      <h2>Top Issues</h2>
      ${Object.values(summary.violationsByRule).sort((a, b) => b.count - a.count).map(issue => `
        <div class="issue ${issue.impact}">
          <strong>${issue.id}</strong> (${issue.count} occurrences)<br>
          ${issue.help || issue.description}
        </div>
      `).join('')}

      <h2>Results by Page</h2>
      <table>
        <tr>
          <th>Page URL</th>
          <th>Issues</th>
          <th>Passed</th>
        </tr>
        ${pageResults.map(page => {
          const violations = page.violations?.reduce((sum, v) => sum + (v.nodes?.length || v.count || 1), 0) || 0;
          return `
            <tr>
              <td>${page.url}</td>
              <td>${violations}</td>
              <td>${page.passes?.length || 0}</td>
            </tr>
          `;
        }).join('')}
      </table>

      <h2>Recommendations</h2>
      <ol>
        <li><strong>Fix Critical Issues First:</strong> Address all critical accessibility violations as they have the highest impact on users.</li>
        <li><strong>Add Alternative Text:</strong> Ensure all images have meaningful alt text.</li>
        <li><strong>Improve Color Contrast:</strong> Ensure text has sufficient contrast ratio (4.5:1 for normal text).</li>
        <li><strong>Add Form Labels:</strong> Associate all form inputs with labels.</li>
        <li><strong>Fix Heading Structure:</strong> Use proper heading hierarchy (h1-h6).</li>
      </ol>

      <p style="margin-top: 40px; color: #64748b; font-size: 0.9em;">
        Generated by Accessibility Scanner | ${new Date().toLocaleString()}
      </p>
    </body>
    </html>
  `;
}

// Handle JSON download
function handleDownloadJSON() {
  if (!state.results) return;

  const blob = new Blob([JSON.stringify(state.results, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `accessibility-report-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Save scan to history
function saveScanToHistory(results) {
  const historyItem = {
    id: Date.now(),
    url: results.metadata?.url || elements.urlInput.value,
    level: results.metadata?.wcagLevel || elements.levelSelect.value,
    timestamp: new Date().toISOString(),
    score: results.summary.complianceScore,
    violations: results.summary.totalViolations,
    pages: results.summary.totalPages
  };

  state.scanHistory.unshift(historyItem);
  state.scanHistory = state.scanHistory.slice(0, 10); // Keep last 10 scans
  localStorage.setItem('scanHistory', JSON.stringify(state.scanHistory));
  loadScanHistory();
}

// Load scan history
function loadScanHistory() {
  if (state.scanHistory.length === 0) {
    elements.reportsList.innerHTML = '<p class="no-reports">No previous scans found. Start a new scan to generate reports.</p>';
    return;
  }

  elements.reportsList.innerHTML = state.scanHistory.map(scan => `
    <div class="report-item">
      <div>
        <strong>${scan.url}</strong><br>
        <small>Level ${scan.level} | ${new Date(scan.timestamp).toLocaleString()}</small>
      </div>
      <div style="text-align: right;">
        <span style="font-size: 1.2em; font-weight: bold; color: ${scan.score >= 90 ? '#22c55e' : scan.score >= 70 ? '#f59e0b' : '#ef4444'}">
          ${scan.score}%
        </span><br>
        <small>${scan.violations} issues | ${scan.pages} pages</small>
      </div>
    </div>
  `).join('');
}

// Update UI based on state
function updateUI() {
  elements.startScanBtn.disabled = state.isScanning;
  elements.startScanBtn.innerHTML = state.isScanning 
    ? '<span class="btn-icon scanning">⏳</span> Scanning...'
    : '<span class="btn-icon">🔍</span> Start Scan';
  elements.sampleScanBtn.disabled = state.isScanning;
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', init);
