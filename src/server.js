import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { AccessibilityScanner, WCAG_LEVELS } from './scanner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.use('/reports', express.static(path.join(__dirname, '../reports')));

// Store active scans
const activeScans = new Map();

// API Routes
app.get('/api/wcag-levels', (req, res) => {
  res.json(WCAG_LEVELS);
});

app.post('/api/scan', async (req, res) => {
  const { url, level = 'AA', maxPages = 50 } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  if (!['A', 'AA', 'AAA'].includes(level)) {
    return res.status(400).json({ error: 'Invalid WCAG level. Must be A, AA, or AAA' });
  }

  const scanId = `scan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Initialize scan status
  activeScans.set(scanId, {
    status: 'running',
    progress: 0,
    pagesScanned: 0,
    maxPages,
    startTime: new Date().toISOString()
  });

  res.json({ scanId, message: 'Scan started' });

  // Run scan in background
  try {
    const scanner = new AccessibilityScanner({
      url,
      level,
      maxPages,
      outputDir: './reports'
    });

    await scanner.init();
    
    // Update progress callback would go here in a more sophisticated implementation
    await scanner.crawlSite();

    const pdfPath = await scanner.generatePDFReport();
    const jsonPath = await scanner.generateJSONReport();
    const summary = scanner.generateSummary();

    await scanner.close();

    activeScans.set(scanId, {
      status: 'complete',
      progress: 100,
      pagesScanned: summary.totalPages,
      maxPages,
      startTime: activeScans.get(scanId).startTime,
      endTime: new Date().toISOString(),
      summary,
      reports: {
        pdf: pdfPath,
        json: jsonPath
      }
    });

  } catch (error) {
    activeScans.set(scanId, {
      status: 'error',
      error: error.message,
      startTime: activeScans.get(scanId).startTime,
      endTime: new Date().toISOString()
    });
  }
});

app.get('/api/scan/:scanId', (req, res) => {
  const { scanId } = req.params;
  const scan = activeScans.get(scanId);

  if (!scan) {
    return res.status(404).json({ error: 'Scan not found' });
  }

  res.json(scan);
});

app.get('/api/scans', (req, res) => {
  const scans = Array.from(activeScans.entries()).map(([id, data]) => ({
    id,
    ...data
  }));
  res.json(scans);
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           Accessibility Scanner Server                         ║
║           Running on http://localhost:${PORT}                      ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});
