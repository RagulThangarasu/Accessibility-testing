import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Siteimprove Alfa imports
import { Audit, Rule } from '@siteimprove/alfa-act';
import * as alfaPlaywright from '@siteimprove/alfa-playwright';
import * as alfaRules from '@siteimprove/alfa-rules';
import { Criterion } from '@siteimprove/alfa-wcag';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Scanning engine options
const SCAN_ENGINES = {
  AXE: 'axe',
  SITEIMPROVE: 'siteimprove',
  BOTH: 'both'
};

// WCAG Level configurations
const WCAG_LEVELS = {
  'A': {
    tags: ['wcag2a', 'wcag21a'],
    description: 'WCAG 2.0/2.1 Level A - Minimum accessibility',
    alfaCriteria: ['A']
  },
  'AA': {
    tags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
    description: 'WCAG 2.0/2.1 Level AA - Standard accessibility (Recommended)',
    alfaCriteria: ['A', 'AA']
  },
  'AAA': {
    tags: ['wcag2a', 'wcag2aa', 'wcag2aaa', 'wcag21a', 'wcag21aa', 'wcag21aaa'],
    description: 'WCAG 2.0/2.1 Level AAA - Enhanced accessibility',
    alfaCriteria: ['A', 'AA', 'AAA']
  }
};

// Impact severity colors for PDF
const IMPACT_COLORS = {
  critical: rgb(0.8, 0.1, 0.1),
  serious: rgb(0.9, 0.4, 0.1),
  moderate: rgb(0.9, 0.7, 0.1),
  minor: rgb(0.2, 0.6, 0.2)
};

class AccessibilityScanner {
  constructor(options = {}) {
    this.baseUrl = options.url;
    this.wcagLevel = options.level || 'AA';
    this.maxPages = options.maxPages || 50;
    this.outputDir = options.outputDir || './reports';
    this.engine = options.engine || SCAN_ENGINES.BOTH; // axe, siteimprove, or both
    this.visitedUrls = new Set();
    this.results = [];
    this.browser = null;
    this.context = null;
  }

  async init() {
    this.browser = await chromium.launch({
      headless: true
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 }
    });
    
    // Ensure output directory exists
    await fs.mkdir(this.outputDir, { recursive: true });
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  normalizeUrl(url) {
    try {
      const urlObj = new URL(url, this.baseUrl);
      // Remove hash and trailing slashes
      urlObj.hash = '';
      let normalized = urlObj.href.replace(/\/$/, '');
      return normalized;
    } catch {
      return null;
    }
  }

  isInternalUrl(url) {
    try {
      const baseUrlObj = new URL(this.baseUrl);
      const urlObj = new URL(url);
      return urlObj.hostname === baseUrlObj.hostname;
    } catch {
      return false;
    }
  }

  async crawlPage(url) {
    const normalizedUrl = this.normalizeUrl(url);
    
    if (!normalizedUrl || this.visitedUrls.has(normalizedUrl)) {
      return [];
    }
    
    if (this.visitedUrls.size >= this.maxPages) {
      return [];
    }

    this.visitedUrls.add(normalizedUrl);
    console.log(`[${this.visitedUrls.size}/${this.maxPages}] Scanning: ${normalizedUrl}`);

    const page = await this.context.newPage();
    let links = [];

    try {
      await page.goto(normalizedUrl, { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });

      // Run accessibility scan
      const scanResult = await this.scanPage(page, normalizedUrl);
      this.results.push(scanResult);

      // Extract links for crawling
      links = await page.evaluate(() => {
        const anchors = document.querySelectorAll('a[href]');
        return Array.from(anchors).map(a => a.href).filter(href => 
          href && !href.startsWith('javascript:') && !href.startsWith('mailto:') && !href.startsWith('tel:')
        );
      });

    } catch (error) {
      console.error(`Error scanning ${normalizedUrl}: ${error.message}`);
      this.results.push({
        url: normalizedUrl,
        error: error.message,
        violations: [],
        passes: [],
        incomplete: [],
        timestamp: new Date().toISOString()
      });
    } finally {
      await page.close();
    }

    return links.filter(link => this.isInternalUrl(link));
  }

  async scanPage(page, url) {
    const levelConfig = WCAG_LEVELS[this.wcagLevel];
    const result = {
      url,
      violations: [],
      passes: [],
      incomplete: [],
      inapplicable: [],
      timestamp: new Date().toISOString(),
      wcagLevel: this.wcagLevel,
      engines: []
    };
    
    try {
      // Run axe-core scan
      if (this.engine === SCAN_ENGINES.AXE || this.engine === SCAN_ENGINES.BOTH) {
        const axeResults = await this.scanWithAxe(page, levelConfig);
        result.violations.push(...axeResults.violations.map(v => ({ ...v, engine: 'axe-core' })));
        result.passes.push(...axeResults.passes.map(p => ({ ...p, engine: 'axe-core' })));
        result.incomplete.push(...(axeResults.incomplete || []).map(i => ({ ...i, engine: 'axe-core' })));
        result.inapplicable.push(...(axeResults.inapplicable || []).map(i => ({ ...i, engine: 'axe-core' })));
        result.engines.push('axe-core');
        result.testEngine = axeResults.testEngine;
      }

      // Run Siteimprove Alfa scan
      if (this.engine === SCAN_ENGINES.SITEIMPROVE || this.engine === SCAN_ENGINES.BOTH) {
        const alfaResults = await this.scanWithSiteimprove(page, levelConfig);
        result.violations.push(...alfaResults.violations);
        result.passes.push(...alfaResults.passes);
        result.engines.push('siteimprove-alfa');
      }

      return result;
    } catch (error) {
      return {
        url,
        error: error.message,
        violations: [],
        passes: [],
        incomplete: [],
        timestamp: new Date().toISOString()
      };
    }
  }

  async scanWithAxe(page, levelConfig) {
    const axeResults = await new AxeBuilder({ page })
      .withTags(levelConfig.tags)
      .analyze();
    return axeResults;
  }

  async scanWithSiteimprove(page, levelConfig) {
    const violations = [];
    const passes = [];

    try {
      // Scrape the page with Alfa's Playwright integration
      const alfaPage = await alfaPlaywright.Playwright.toPage(page);
      const document = alfaPage.document;

      // Get all Alfa rules
      const rules = [...alfaRules.Rules.values()];

      // Filter rules by WCAG criteria based on selected level
      const targetCriteria = levelConfig.alfaCriteria;
      
      for (const rule of rules) {
        try {
          // Check if rule is applicable to our WCAG level
          const ruleRequirements = rule.requirements || [];
          const wcagRequirements = ruleRequirements.filter(req => {
            if (req && req.criterion) {
              const criterionLevel = this.getCriterionLevel(req.criterion);
              return targetCriteria.includes(criterionLevel);
            }
            return true; // Include rules without specific criteria
          });

          if (wcagRequirements.length === 0 && ruleRequirements.length > 0) {
            continue; // Skip rules that don't match our WCAG level
          }

          // Run the rule audit
          const outcomes = await Audit.of(alfaPage, [rule]).evaluate();

          for (const outcome of outcomes) {
            if (outcome.outcome === 'failed') {
              violations.push({
                id: rule.uri,
                engine: 'siteimprove-alfa',
                impact: this.mapAlfaImpact(rule),
                description: this.getRuleDescription(rule),
                help: this.getRuleHelp(rule),
                helpUrl: `https://alfa.siteimprove.com/rules/${encodeURIComponent(rule.uri)}`,
                nodes: [{
                  target: outcome.target ? outcome.target.toString() : 'unknown',
                  failureSummary: outcome.expectations ? 
                    Array.from(outcome.expectations).map(e => e[1].toString()).join('; ') : 
                    'Accessibility check failed'
                }],
                wcagCriteria: wcagRequirements.map(r => r.criterion?.toString() || 'unknown')
              });
            } else if (outcome.outcome === 'passed') {
              passes.push({
                id: rule.uri,
                engine: 'siteimprove-alfa',
                description: this.getRuleDescription(rule)
              });
            }
          }
        } catch (ruleError) {
          // Skip rules that fail to execute
          console.debug(`Rule ${rule.uri} skipped: ${ruleError.message}`);
        }
      }
    } catch (error) {
      console.error(`Siteimprove Alfa scan error: ${error.message}`);
    }

    return { violations, passes };
  }

  getCriterionLevel(criterion) {
    if (!criterion) return 'A';
    const criterionStr = criterion.toString();
    if (criterionStr.includes('AAA')) return 'AAA';
    if (criterionStr.includes('AA')) return 'AA';
    return 'A';
  }

  mapAlfaImpact(rule) {
    // Map Alfa rule requirements to impact levels
    const requirements = rule.requirements || [];
    for (const req of requirements) {
      if (req && req.criterion) {
        const level = this.getCriterionLevel(req.criterion);
        if (level === 'A') return 'critical';
        if (level === 'AA') return 'serious';
        if (level === 'AAA') return 'moderate';
      }
    }
    return 'moderate';
  }

  getRuleDescription(rule) {
    if (rule.requirements && rule.requirements.length > 0) {
      return rule.requirements.map(r => r.toString()).join(', ');
    }
    return rule.uri || 'Accessibility rule';
  }

  getRuleHelp(rule) {
    return `Check compliance with: ${this.getRuleDescription(rule)}`;
  }

  async crawlSite() {
    const urlsToVisit = [this.baseUrl];
    
    while (urlsToVisit.length > 0 && this.visitedUrls.size < this.maxPages) {
      const url = urlsToVisit.shift();
      const newLinks = await this.crawlPage(url);
      
      for (const link of newLinks) {
        const normalizedLink = this.normalizeUrl(link);
        if (normalizedLink && !this.visitedUrls.has(normalizedLink)) {
          urlsToVisit.push(normalizedLink);
        }
      }
    }

    return this.results;
  }

  generateSummary() {
    const summary = {
      totalPages: this.results.length,
      totalViolations: 0,
      totalPasses: 0,
      violationsByImpact: {
        critical: 0,
        serious: 0,
        moderate: 0,
        minor: 0
      },
      violationsByRule: {},
      pagesWithIssues: 0,
      complianceScore: 0
    };

    for (const result of this.results) {
      if (result.violations.length > 0) {
        summary.pagesWithIssues++;
      }
      
      for (const violation of result.violations) {
        summary.totalViolations += violation.nodes.length;
        const impact = violation.impact || 'minor';
        summary.violationsByImpact[impact] = (summary.violationsByImpact[impact] || 0) + violation.nodes.length;
        
        if (!summary.violationsByRule[violation.id]) {
          summary.violationsByRule[violation.id] = {
            id: violation.id,
            description: violation.description,
            help: violation.help,
            impact: violation.impact,
            count: 0,
            helpUrl: violation.helpUrl
          };
        }
        summary.violationsByRule[violation.id].count += violation.nodes.length;
      }
      
      summary.totalPasses += result.passes.length;
    }

    // Calculate compliance score
    const totalChecks = summary.totalViolations + summary.totalPasses;
    summary.complianceScore = totalChecks > 0 
      ? Math.round((summary.totalPasses / totalChecks) * 100) 
      : 100;

    return summary;
  }

  async generatePDFReport() {
    const summary = this.generateSummary();
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    let currentPage = pdfDoc.addPage([612, 792]); // Letter size
    let yPosition = 750;
    const margin = 50;
    const lineHeight = 14;

    const addText = (text, options = {}) => {
      const { 
        size = 10, 
        bold = false, 
        color = rgb(0, 0, 0),
        indent = 0 
      } = options;
      
      if (yPosition < 50) {
        currentPage = pdfDoc.addPage([612, 792]);
        yPosition = 750;
      }

      const selectedFont = bold ? fontBold : font;
      
      // Word wrap for long text
      const maxWidth = 512 - indent;
      const words = text.split(' ');
      let line = '';
      
      for (const word of words) {
        const testLine = line + (line ? ' ' : '') + word;
        const width = selectedFont.widthOfTextAtSize(testLine, size);
        
        if (width > maxWidth && line) {
          currentPage.drawText(line, {
            x: margin + indent,
            y: yPosition,
            size,
            font: selectedFont,
            color
          });
          yPosition -= lineHeight;
          line = word;
          
          if (yPosition < 50) {
            currentPage = pdfDoc.addPage([612, 792]);
            yPosition = 750;
          }
        } else {
          line = testLine;
        }
      }
      
      if (line) {
        currentPage.drawText(line, {
          x: margin + indent,
          y: yPosition,
          size,
          font: selectedFont,
          color
        });
        yPosition -= lineHeight;
      }
    };

    const addLine = () => {
      currentPage.drawLine({
        start: { x: margin, y: yPosition },
        end: { x: 562, y: yPosition },
        thickness: 1,
        color: rgb(0.8, 0.8, 0.8)
      });
      yPosition -= 10;
    };

    // Title
    addText('Accessibility Audit Report', { size: 24, bold: true });
    yPosition -= 10;
    addText(`Generated: ${new Date().toLocaleString()}`, { size: 10, color: rgb(0.5, 0.5, 0.5) });
    yPosition -= 5;
    addText(`WCAG Level: ${this.wcagLevel} - ${WCAG_LEVELS[this.wcagLevel].description}`, { size: 10 });
    yPosition -= 20;
    addLine();
    yPosition -= 10;

    // Executive Summary
    addText('Executive Summary', { size: 16, bold: true });
    yPosition -= 10;
    
    addText(`Site URL: ${this.baseUrl}`, { size: 10 });
    addText(`Total Pages Scanned: ${summary.totalPages}`, { size: 10 });
    addText(`Pages with Issues: ${summary.pagesWithIssues}`, { size: 10 });
    addText(`Total Violations Found: ${summary.totalViolations}`, { size: 10 });
    addText(`Compliance Score: ${summary.complianceScore}%`, { size: 12, bold: true, 
      color: summary.complianceScore >= 90 ? rgb(0.1, 0.6, 0.1) : 
             summary.complianceScore >= 70 ? rgb(0.9, 0.6, 0.1) : rgb(0.8, 0.1, 0.1) });
    yPosition -= 20;

    // Violations by Impact
    addText('Violations by Impact Level', { size: 14, bold: true });
    yPosition -= 5;
    
    for (const [impact, count] of Object.entries(summary.violationsByImpact)) {
      if (count > 0) {
        addText(`• ${impact.charAt(0).toUpperCase() + impact.slice(1)}: ${count}`, { 
          size: 10, 
          color: IMPACT_COLORS[impact],
          indent: 10 
        });
      }
    }
    yPosition -= 15;
    addLine();
    yPosition -= 10;

    // Top Issues
    addText('Top Accessibility Issues', { size: 14, bold: true });
    yPosition -= 10;

    const sortedRules = Object.values(summary.violationsByRule)
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    for (const rule of sortedRules) {
      addText(`${rule.id} (${rule.count} occurrences)`, { 
        size: 11, 
        bold: true,
        color: IMPACT_COLORS[rule.impact] || rgb(0, 0, 0)
      });
      addText(rule.help, { size: 9, indent: 10 });
      addText(`Impact: ${rule.impact}`, { size: 9, indent: 10, color: rgb(0.5, 0.5, 0.5) });
      yPosition -= 5;
    }

    yPosition -= 10;
    addLine();
    yPosition -= 10;

    // Detailed Results by Page
    addText('Detailed Results by Page', { size: 14, bold: true });
    yPosition -= 10;

    for (const result of this.results) {
      if (yPosition < 100) {
        currentPage = pdfDoc.addPage([612, 792]);
        yPosition = 750;
      }

      const violationCount = result.violations.reduce((sum, v) => sum + v.nodes.length, 0);
      addText(result.url, { size: 11, bold: true });
      
      if (result.error) {
        addText(`Error: ${result.error}`, { size: 9, color: rgb(0.8, 0.1, 0.1), indent: 10 });
      } else {
        addText(`Violations: ${violationCount} | Passes: ${result.passes.length}`, { 
          size: 9, 
          indent: 10,
          color: violationCount > 0 ? rgb(0.8, 0.4, 0.1) : rgb(0.1, 0.6, 0.1)
        });

        // List top violations for this page
        const topViolations = result.violations.slice(0, 5);
        for (const v of topViolations) {
          addText(`• ${v.id}: ${v.help} (${v.nodes.length} instances)`, { 
            size: 8, 
            indent: 20,
            color: IMPACT_COLORS[v.impact] || rgb(0.5, 0.5, 0.5)
          });
        }
        if (result.violations.length > 5) {
          addText(`  ... and ${result.violations.length - 5} more rules`, { 
            size: 8, 
            indent: 20,
            color: rgb(0.5, 0.5, 0.5)
          });
        }
      }
      yPosition -= 10;
    }

    // Recommendations
    currentPage = pdfDoc.addPage([612, 792]);
    yPosition = 750;
    
    addText('Recommendations', { size: 16, bold: true });
    yPosition -= 15;

    const recommendations = [
      'Fix Critical Issues First: Address all critical and serious accessibility violations as they have the highest impact on users.',
      'Add Alternative Text: Ensure all images have meaningful alt text that describes the content or purpose of the image.',
      'Keyboard Navigation: Verify all interactive elements are accessible via keyboard and have visible focus indicators.',
      'Color Contrast: Ensure text has sufficient contrast ratio against its background (4.5:1 for normal text, 3:1 for large text).',
      'Form Labels: Associate all form inputs with labels using the "for" attribute or by nesting inputs within labels.',
      'Heading Structure: Use proper heading hierarchy (h1-h6) to create a logical document outline.',
      'Link Purpose: Make sure link text clearly indicates the destination or purpose without relying on surrounding context.',
      'ARIA Usage: Use ARIA attributes appropriately and ensure custom widgets follow ARIA authoring practices.',
      'Regular Testing: Implement automated accessibility testing in your CI/CD pipeline to catch issues early.',
      'Manual Testing: Supplement automated testing with manual testing using screen readers and keyboard-only navigation.'
    ];

    for (let i = 0; i < recommendations.length; i++) {
      addText(`${i + 1}. ${recommendations[i]}`, { size: 10, indent: 0 });
      yPosition -= 5;
    }

    // Footer with compliance information
    yPosition -= 20;
    addLine();
    addText('Compliance Note', { size: 10, bold: true });
    addText(`This report tests against WCAG 2.1 Level ${this.wcagLevel} success criteria. Automated testing can detect approximately 30-40% of accessibility issues. Manual testing is recommended for comprehensive coverage.`, { size: 9, color: rgb(0.4, 0.4, 0.4) });

    // Save PDF
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `accessibility-report-${this.wcagLevel}-${timestamp}.pdf`;
    const pdfBytes = await pdfDoc.save();
    const outputPath = path.join(this.outputDir, filename);
    
    await fs.writeFile(outputPath, pdfBytes);
    return outputPath;
  }

  async generateJSONReport() {
    const summary = this.generateSummary();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `accessibility-report-${this.wcagLevel}-${timestamp}.json`;
    const outputPath = path.join(this.outputDir, filename);
    
    const report = {
      metadata: {
        url: this.baseUrl,
        wcagLevel: this.wcagLevel,
        timestamp: new Date().toISOString(),
        scanner: 'Accessibility Scanner v1.0'
      },
      summary,
      results: this.results
    };

    await fs.writeFile(outputPath, JSON.stringify(report, null, 2));
    return outputPath;
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Accessibility Scanner - Crawl and audit websites for WCAG compliance
Powered by axe-core and Siteimprove Alfa

Usage:
  node scanner.js --url <url> [options]

Options:
  --url, -u      Target website URL (required)
  --level, -l    WCAG compliance level: A, AA, or AAA (default: AA)
  --engine, -e   Scanning engine: axe, siteimprove, or both (default: both)
  --max-pages    Maximum number of pages to scan (default: 50)
  --output, -o   Output directory for reports (default: ./reports)
  --help, -h     Show this help message

Engines:
  axe           Use axe-core accessibility engine only
  siteimprove   Use Siteimprove Alfa accessibility engine only
  both          Use both engines for comprehensive coverage (recommended)

Examples:
  node scanner.js --url https://example.com --level AA
  node scanner.js -u https://example.com -l AAA --engine siteimprove
  node scanner.js -u https://example.com -e both --max-pages 100
    `);
    process.exit(0);
  }

  // Parse arguments
  const urlIndex = args.findIndex(a => a === '--url' || a === '-u');
  const levelIndex = args.findIndex(a => a === '--level' || a === '-l');
  const engineIndex = args.findIndex(a => a === '--engine' || a === '-e');
  const maxPagesIndex = args.findIndex(a => a === '--max-pages');
  const outputIndex = args.findIndex(a => a === '--output' || a === '-o');

  const url = urlIndex !== -1 ? args[urlIndex + 1] : null;
  const level = levelIndex !== -1 ? args[levelIndex + 1] : 'AA';
  const engine = engineIndex !== -1 ? args[engineIndex + 1] : 'both';
  const maxPages = maxPagesIndex !== -1 ? parseInt(args[maxPagesIndex + 1]) : 50;
  const outputDir = outputIndex !== -1 ? args[outputIndex + 1] : './reports';

  if (!url) {
    console.error('Error: URL is required. Use --url or -u to specify the target website.');
    process.exit(1);
  }

  if (!['A', 'AA', 'AAA'].includes(level)) {
    console.error('Error: Invalid WCAG level. Must be A, AA, or AAA.');
    process.exit(1);
  }

  if (!['axe', 'siteimprove', 'both'].includes(engine)) {
    console.error('Error: Invalid engine. Must be axe, siteimprove, or both.');
    process.exit(1);
  }

  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           Accessibility Scanner                                ║
║           WCAG ${level} Compliance Audit                              ║
║           Engine: ${engine.padEnd(10)}                                   ║
╚═══════════════════════════════════════════════════════════════╝
`);

  console.log(`Target URL: ${url}`);
  console.log(`WCAG Level: ${level}`);
  console.log(`Engine: ${engine}`);
  console.log(`Max Pages: ${maxPages}`);
  console.log(`Output Directory: ${outputDir}`);
  console.log('');

  const scanner = new AccessibilityScanner({
    url,
    level,
    engine,
    maxPages,
    outputDir
  });

  try {
    console.log('Initializing scanner...');
    await scanner.init();

    console.log('Starting crawl and accessibility audit...\n');
    await scanner.crawlSite();

    console.log('\nGenerating reports...');
    const pdfPath = await scanner.generatePDFReport();
    const jsonPath = await scanner.generateJSONReport();

    const summary = scanner.generateSummary();

    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                    SCAN COMPLETE                               ║
╚═══════════════════════════════════════════════════════════════╝

Summary:
  Pages Scanned: ${summary.totalPages}
  Pages with Issues: ${summary.pagesWithIssues}
  Total Violations: ${summary.totalViolations}
  Compliance Score: ${summary.complianceScore}%

Violations by Impact:
  Critical: ${summary.violationsByImpact.critical}
  Serious: ${summary.violationsByImpact.serious}
  Moderate: ${summary.violationsByImpact.moderate}
  Minor: ${summary.violationsByImpact.minor}

Reports Generated:
  PDF: ${pdfPath}
  JSON: ${jsonPath}
`);

  } catch (error) {
    console.error('Error during scan:', error);
    process.exit(1);
  } finally {
    await scanner.close();
  }
}

// Export for use as module
export { AccessibilityScanner, WCAG_LEVELS, SCAN_ENGINES };

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
