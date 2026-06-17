// lilAlt fetcher.
// Fetches a page server-side and inventories its <img> tags: which have alt
// text, which are decorative, and which are missing it entirely.

const MAX_HOPS = 5;
const TIMEOUT_MS = 9000;
const MAX_HTML = 900000;

function isBlockedHost(hostname) {
  const h = (hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(obj),
});

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 lilAlt/1.0';

export const handler = async (event) => {
  const raw = (event.queryStringParameters && event.queryStringParameters.url || '').trim();
  if (!raw) return json(400, { error: 'Enter a URL to scan.' });
  const start = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;

  let u;
  try { u = new URL(start); } catch { return json(400, { error: 'That does not look like a valid URL.' }); }
  if (!/^https?:$/.test(u.protocol)) return json(400, { error: 'Only http and https URLs can be scanned.' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let current = u.toString();
  let resp = null;

  try {
    for (let i = 0; i < MAX_HOPS; i++) {
      const host = (() => { try { return new URL(current).hostname; } catch { return ''; } })();
      if (isBlockedHost(host)) { clearTimeout(timer); return json(400, { error: 'For safety, local and private addresses cannot be scanned.' }); }
      let r;
      try {
        r = await fetch(current, { method: 'GET', redirect: 'manual', signal: controller.signal, headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8' } });
      } catch (e) {
        clearTimeout(timer);
        if (e && e.name === 'AbortError') return json(504, { error: 'The page took too long to respond.' });
        return json(502, { error: 'Could not reach that URL. Check the link and try again.' });
      }
      const loc = r.headers.get('location');
      if (r.status >= 300 && r.status < 400 && loc) {
        try { current = new URL(loc, current).toString(); } catch { current = loc; }
        continue;
      }
      resp = r;
      break;
    }
  } finally {
    clearTimeout(timer);
  }

  if (!resp) return json(502, { error: 'Too many redirects while loading that page.' });
  if (resp.status >= 400) return json(502, { error: `The page responded with HTTP ${resp.status}.` });

  let html = '';
  try { html = (await resp.text()).slice(0, MAX_HTML); } catch { html = ''; }

  const imgRe = /<img\b[^>]*>/gi;
  const attr = (tag, name) => {
    const m = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
    return m ? (m[2] !== undefined ? m[2] : m[3]) : undefined;
  };
  const hasAttr = (tag, name) => new RegExp(`\\s${name}(\\s|=|>|/)`, 'i').test(tag);

  let total = 0, withAlt = 0, emptyAlt = 0, missing = 0, decorative = 0, longAlt = 0;
  const offenders = [];
  let m;
  while ((m = imgRe.exec(html))) {
    const tag = m[0];
    let src = attr(tag, 'src') || (attr(tag, 'srcset') || '').split(/[\s,]+/)[0] || attr(tag, 'data-src') || '';
    if (src.startsWith('data:')) continue;
    // skip obvious tracking pixels
    const w = attr(tag, 'width'), h = attr(tag, 'height');
    if ((w === '1' && h === '1') || (w === '0' || h === '0')) continue;
    total++;
    const isDecorative = /role\s*=\s*["']?presentation/i.test(tag) || /aria-hidden\s*=\s*["']?true/i.test(tag);
    const alt = attr(tag, 'alt');
    let abs = src;
    try { abs = new URL(src, current).toString(); } catch { /* keep raw */ }
    if (alt === undefined && !hasAttr(tag, 'alt')) {
      if (isDecorative) { decorative++; }
      else { missing++; if (offenders.length < 12 && abs) offenders.push(abs); }
    } else if ((alt || '').trim() === '') {
      emptyAlt++;
    } else {
      withAlt++;
      if (alt.length > 125) longAlt++;
    }
  }

  return json(200, { url: current, total, withAlt, emptyAlt, missing, decorative, longAlt, offenders });
};
