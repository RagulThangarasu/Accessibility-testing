/**
 * Element screenshots for violations.
 *
 * A selector and a code snippet tell a developer where the problem is. A picture
 * tells whoever has to sign off on the fix *what it looks like* — which is the
 * difference between a report an engineer reads and a report a stakeholder can
 * act on.
 *
 * Screenshots are embedded as data URIs so the HTML report stays a single
 * self-contained file you can email, and the PDF carries them too.
 */

// Every screenshot inflates both reports. These caps keep an audit of a busy page
// from turning into a 50MB PDF, while still illustrating each distinct problem.
const MAX_PER_FINDING = 2;
const MAX_PER_PAGE = 24;
const MAX_HEIGHT = 900;

/**
 * Capture the offending elements, on a page of their own.
 *
 * A fresh page is used because by this point the scanned page has had
 * HTML_CodeSniffer injected into it — screenshotting that would photograph the
 * scanner's own DOM changes rather than the site as a user sees it.
 */
export async function captureFindingShots(context, url, findings, { viewport } = {}) {
  const violations = findings.filter((f) => f.status === 'violation' && f.nodes.length);
  if (!violations.length) return 0;

  const page = await context.newPage();
  let taken = 0;

  try {
    if (viewport) await page.setViewportSize(viewport);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2000);

    // Freeze animation so a screenshot can't catch an element mid-transition.
    await page.addStyleTag({
      content: '*,*::before,*::after{animation:none!important;transition:none!important}'
    });

    for (const finding of violations) {
      if (taken >= MAX_PER_PAGE) break;

      for (const node of finding.nodes.slice(0, MAX_PER_FINDING)) {
        if (taken >= MAX_PER_PAGE) break;
        if (!node.selector) continue;

        try {
          const locator = page.locator(node.selector).first();
          if (!(await locator.count())) continue;

          await locator.scrollIntoViewIfNeeded({ timeout: 3000 });
          const box = await locator.boundingBox();
          // Zero-sized or off-screen elements photograph as nothing useful.
          if (!box || box.width < 2 || box.height < 2) continue;

          const shot = await locator.screenshot({
            timeout: 5000,
            ...(box.height > MAX_HEIGHT ? { clip: { ...box, height: MAX_HEIGHT } } : {})
          });

          node.screenshot = `data:image/png;base64,${shot.toString('base64')}`;
          taken++;
        } catch {
          // An element can be detached, covered, or animated out from under us.
          // A missing screenshot must never cost us the finding itself.
        }
      }
    }
  } catch {
    // The page failed to load a second time — report without pictures.
  } finally {
    await page.close();
  }

  return taken;
}
