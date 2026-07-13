import { gunzipSync } from 'zlib';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Tried in order when robots.txt names no sitemap. These cover the conventional
// location plus the index names WordPress, Yoast, and Next.js emit.
const FALLBACK_PATHS = [
  '/sitemap.xml',
  '/sitemap_index.xml',
  '/sitemap-index.xml',
  '/wp-sitemap.xml',
  '/sitemap.xml.gz'
];

// A sitemap index can point at another index. Real sites nest one level; the
// cap stops a malformed or self-referential sitemap from looping forever.
const MAX_DEPTH = 3;

async function fetchText(url, timeout = 20000) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/xml,text/xml,text/plain,*/*' },
    signal: AbortSignal.timeout(timeout),
    redirect: 'follow'
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  // Gzipped sitemaps are common and are not always served with an encoding
  // header, so sniff the magic bytes rather than trusting Content-Type.
  const gzipped = buf[0] === 0x1f && buf[1] === 0x8b;
  return (gzipped ? gunzipSync(buf) : buf).toString('utf-8');
}

function tag(xml, name) {
  const out = [];
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'gi');
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

function decodeLoc(raw = '') {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .trim()
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function locsIn(block) {
  return tag(block, 'loc').map(decodeLoc).filter(Boolean);
}

/**
 * Read robots.txt and return every sitemap it advertises.
 * A site with no robots.txt is normal, not an error — return nothing.
 */
async function sitemapsFromRobots(origin) {
  try {
    const txt = await fetchText(new URL('/robots.txt', origin).href, 10000);
    return [...txt.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1].trim());
  } catch {
    return [];
  }
}

/**
 * Find the sitemap for a site: ask robots.txt first, then probe the
 * conventional locations.
 *
 * @returns {Promise<string[]>} sitemap URLs, empty if the site has none.
 */
export async function discoverSitemaps(pageUrl) {
  const origin = new URL(pageUrl).origin;

  const advertised = await sitemapsFromRobots(origin);
  if (advertised.length) return advertised;

  for (const path of FALLBACK_PATHS) {
    const candidate = new URL(path, origin).href;
    try {
      const body = await fetchText(candidate, 10000);
      // A missing sitemap often 200s with the site's HTML 404 page. Only accept
      // a body that actually looks like a sitemap.
      if (/<(urlset|sitemapindex)\b/i.test(body)) return [candidate];
    } catch {
      // try the next candidate
    }
  }
  return [];
}

/**
 * Expand sitemaps into the page URLs they list, following sitemap indexes.
 *
 * Only same-origin URLs are kept: a scan is scoped to one site, and following
 * a sitemap off-origin would silently audit somebody else's pages.
 *
 * @param {string[]} sitemapUrls sitemaps to fetch and walk.
 * @param {object} options `origin`, `limit`, and `inlineXml` — the contents of an
 *   uploaded sitemap file, walked as if it had been fetched. Indexes inside it
 *   are still followed over the network.
 * @returns {Promise<{urls: string[], total: number, sources: string[], offOrigin: number}>}
 *   `urls` is capped at `limit`; `total` is how many were found before the cap;
 *   `offOrigin` counts URLs dropped for belonging to another site.
 */
export async function collectSitemapUrls(sitemapUrls, { origin, limit = 10, inlineXml } = {}) {
  const seen = new Set();
  const found = [];
  const sources = [];
  const visited = new Set();
  let offOrigin = 0;

  async function walk(sitemapUrl, depth, preloaded) {
    if (depth > MAX_DEPTH || visited.has(sitemapUrl)) return;
    visited.add(sitemapUrl);

    let xml = preloaded;
    if (xml == null) {
      try {
        xml = await fetchText(sitemapUrl);
      } catch {
        return; // a dead sitemap entry shouldn't abort the others
      }
    }
    sources.push(sitemapUrl);

    // <sitemapindex> points at more sitemaps; <urlset> points at pages.
    const indexBlocks = tag(xml, 'sitemap');
    if (indexBlocks.length) {
      for (const block of indexBlocks) {
        for (const loc of locsIn(block)) await walk(loc, depth + 1);
      }
      return;
    }

    const pageLocs = tag(xml, 'url').flatMap(locsIn);
    // Plain-text sitemaps (one URL per line) are permitted by the spec.
    const locs = pageLocs.length
      ? pageLocs
      : /<\w/.test(xml)
        ? []
        : xml.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^https?:\/\//.test(l));

    for (const loc of locs) {
      let normalized;
      try {
        const u = new URL(loc);
        if (origin && u.origin !== origin) {
          offOrigin++;
          continue;
        }
        u.hash = '';
        normalized = u.href;
      } catch {
        continue;
      }
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      found.push(normalized);
    }
  }

  if (inlineXml != null) {
    await walk('(uploaded sitemap)', 0, inlineXml);
  }
  for (const url of sitemapUrls) await walk(url, 0);

  return { urls: found.slice(0, limit), total: found.length, sources, offOrigin };
}
