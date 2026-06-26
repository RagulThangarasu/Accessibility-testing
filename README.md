# Accessibility Scanner

A comprehensive web accessibility scanning tool that crawls websites and audits them for WCAG 2.0/2.1 compliance. Generate detailed PDF and JSON reports with actionable recommendations.

![Accessibility Scanner](https://img.shields.io/badge/WCAG-2.1-blue) ![License](https://img.shields.io/badge/license-MIT-green)

## Features

- 🔍 **Full Site Crawling**: Automatically discovers and scans all pages on your website
- 📊 **WCAG Compliance Testing**: Tests against Level A, AA, and AAA criteria
- 📄 **PDF Reports**: Generate detailed PDF reports for stakeholders
- 📋 **JSON Export**: Export results in JSON format for integration with other tools
- 🎯 **Impact Analysis**: Issues categorized by severity (Critical, Serious, Moderate, Minor)
- 🌐 **GitHub Pages Support**: Deploy the UI to GitHub Pages for easy access

## Demo

[Live Demo on GitHub Pages](https://yourusername.github.io/accessibility-scanner/)

## Quick Start

### Prerequisites

- Node.js 18 or higher
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/accessibility-scanner.git
cd accessibility-scanner

# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium
```

### Usage

#### Command Line

```bash
# Basic scan with default settings (WCAG AA)
npm run scan -- --url https://example.com

# Scan with specific WCAG level
npm run scan -- --url https://example.com --level AAA

# Scan with custom page limit
npm run scan -- --url https://example.com --level AA --max-pages 100

# Specify output directory
npm run scan -- --url https://example.com --output ./my-reports
```

#### Web Interface

```bash
# Start the web server
npm run dev

# Open http://localhost:3000 in your browser
```

## WCAG Compliance Levels

| Level | Description | Use Case |
|-------|-------------|----------|
| **A** | Minimum accessibility | Basic requirements, essential for any website |
| **AA** | Standard accessibility | Recommended for most websites, required by many regulations |
| **AAA** | Enhanced accessibility | Highest level, recommended for critical content |

## Report Contents

### Executive Summary
- Total pages scanned
- Compliance score (percentage)
- Pages with issues
- Total violations found

### Issues by Impact
- **Critical**: Must be fixed immediately, blocks access for some users
- **Serious**: Should be fixed soon, causes significant barriers
- **Moderate**: Should be addressed, causes some difficulties
- **Minor**: Consider fixing, minor inconveniences

### Detailed Findings
- Issue identification with rule ID
- Number of occurrences
- Affected pages
- Links to remediation guidance

## GitHub Pages Deployment

This tool includes a static web interface that can be deployed to GitHub Pages.

### Automatic Deployment

1. Push to the `main` branch
2. GitHub Actions will automatically build and deploy to GitHub Pages
3. Access at `https://yourusername.github.io/accessibility-scanner/`

### Manual Deployment

```bash
# Build the frontend
npm run build

# The docs/ folder contains the static site
# Configure GitHub Pages to serve from the docs/ folder
```

## Architecture

```
accessibility-scanner/
├── src/
│   ├── scanner.js      # Core accessibility scanner
│   └── server.js       # Express API server
├── public/             # Frontend source files
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── docs/               # GitHub Pages deployment folder
├── reports/            # Generated reports (gitignored)
└── package.json
```

## API Reference

### POST /api/scan

Start a new accessibility scan.

```json
{
  "url": "https://example.com",
  "level": "AA",
  "maxPages": 50
}
```

Response:
```json
{
  "scanId": "scan-123456789-abc",
  "message": "Scan started"
}
```

### GET /api/scan/:scanId

Get scan status and results.

### GET /api/scans

List all scans.

### GET /api/wcag-levels

Get WCAG level configurations.

## Integration

### CI/CD Pipeline

Add to your pipeline:

```yaml
- name: Run Accessibility Scan
  run: |
    npm install
    npx playwright install chromium
    npm run scan -- --url ${{ env.SITE_URL }} --level AA
    
- name: Upload Report
  uses: actions/upload-artifact@v3
  with:
    name: accessibility-report
    path: reports/
```

### Programmatic Usage

```javascript
import { AccessibilityScanner } from './src/scanner.js';

const scanner = new AccessibilityScanner({
  url: 'https://example.com',
  level: 'AA',
  maxPages: 50,
  outputDir: './reports'
});

await scanner.init();
await scanner.crawlSite();
const pdfPath = await scanner.generatePDFReport();
const jsonPath = await scanner.generateJSONReport();
await scanner.close();
```

## Compliance Frameworks

This tool helps you meet requirements for:

- **WCAG 2.0 / WCAG 2.1** - Web Content Accessibility Guidelines
- **Section 508** - US Federal agencies
- **ADA** - Americans with Disabilities Act
- **EN 301 549** - European accessibility standard
- **AODA** - Accessibility for Ontarians with Disabilities Act

## Limitations

⚠️ **Important**: Automated testing can detect approximately **30-40%** of accessibility issues. For comprehensive accessibility audits, supplement automated testing with:

- Manual keyboard navigation testing
- Screen reader testing (NVDA, JAWS, VoiceOver)
- User testing with people with disabilities
- Color blindness simulation
- Cognitive accessibility review

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [axe-core](https://www.deque.com/axe/) - The world's most trusted accessibility testing engine
- [Playwright](https://playwright.dev/) - Browser automation framework
- [pdf-lib](https://pdf-lib.js.org/) - PDF generation library

## Support

- 📖 [WCAG Quick Reference](https://www.w3.org/WAI/WCAG21/quickref/)
- 🐛 [Report Issues](https://github.com/yourusername/accessibility-scanner/issues)
- 💬 [Discussions](https://github.com/yourusername/accessibility-scanner/discussions)
