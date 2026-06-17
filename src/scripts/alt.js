// lilAlt: scan a page's images via the /alt-fetch Netlify function and grade
// the alt-text coverage, with thumbnails of the offenders.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------- theme (OS-aware, matches the family) ---------- */
const MOON_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>';
const SUN_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4l1.4-1.4M18 6l1.4-1.4"/></g></svg>';

function setThemeIcon(btn, theme) {
  if (theme === 'dark') { btn.innerHTML = SUN_SVG; btn.setAttribute('aria-label', 'Switch to light mode'); }
  else { btn.innerHTML = MOON_SVG; btn.setAttribute('aria-label', 'Switch to dark mode'); }
}
function initTheme() {
  const btn = $('#ui-theme-btn');
  const current = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  setThemeIcon(btn, current());
  btn.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('lilalt-theme', next); } catch (e) { /* storage may be unavailable; safe to ignore */ }
    setThemeIcon(btn, next);
  });
}

/* ---------- render ---------- */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');

const ICON = {
  err: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
  warn: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.8 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>',
  ok: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  info: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
};

function checkCard(c) {
  return `<div class="check check--${c.k}">
    <span class="check-ic">${ICON[c.k]}</span>
    <div class="check-body">
      <div class="check-t">${esc(c.t)}</div>
      <div class="check-m">${esc(c.m)}</div>
    </div>
  </div>`;
}

function note(kind, msg) {
  return `<div class="t-note t-note--${kind}">${esc(msg)}</div>`;
}

function setLoading(target) {
  $('#results').innerHTML = `<div class="t-loading"><span class="spin" aria-hidden="true"></span> Counting the images on ${esc(target)}&hellip;</div>`;
}

async function run() {
  const raw = $('#f-url').value.trim();
  if (!raw) { $('#f-url').focus(); return; }
  const btn = $('#check-btn');
  btn.disabled = true;
  setLoading(raw);
  try {
    const res = await fetch('/.netlify/functions/alt-fetch?url=' + encodeURIComponent(raw), { headers: { accept: 'application/json' } });
    const d = await res.json();
    if (d.error) { $('#results').innerHTML = note('err', d.error); return; }
    const domain = (() => { try { return new URL(d.url).hostname.replace(/^www\./, ''); } catch { return raw; } })();

    if (d.total === 0) {
      $('#results').innerHTML =
        `<div class="t-head"><div class="t-summary">${esc(`No images found in ${domain}'s served HTML.`)}</div></div>` +
        `<div class="dsec"><div class="dsec-h">Findings</div>` +
        checkCard({ k: 'info', t: 'Zero images in the raw HTML', m: 'The page probably renders its content with JavaScript after load. This scanner reads the HTML the server sends, which is also what crawlers and many assistive tools see first, so there is nothing to audit here.' }) +
        `</div>`;
      return;
    }

    const described = d.withAlt + d.emptyAlt + d.decorative;
    const pct = Math.round((described / d.total) * 100);
    const checks = [];

    if (d.missing > 0) {
      checks.push({ k: 'err', t: `${d.missing} image${d.missing > 1 ? 's have' : ' has'} NO alt attribute`, m: 'Screen readers either skip these or read out the file name, and search engines cannot understand them. Every content image needs alt text; truly decorative ones should get an empty alt="" instead of nothing.' });
    } else {
      checks.push({ k: 'ok', t: 'Every image has an alt attribute', m: 'Nothing is invisible to assistive tech. Nice work.' });
    }
    if (d.withAlt > 0) checks.push({ k: 'ok', t: `${d.withAlt} with real alt text`, m: 'These describe themselves to screen readers and search engines.' });
    if (d.emptyAlt > 0) checks.push({ k: 'info', t: `${d.emptyAlt} with empty alt=""`, m: 'Correct for purely decorative images, since it tells screen readers to skip them on purpose. Worth a spot check that none of these are actually content.' });
    if (d.decorative > 0) checks.push({ k: 'info', t: `${d.decorative} marked decorative`, m: 'Hidden from assistive tech via role="presentation" or aria-hidden.' });
    if (d.longAlt > 0) checks.push({ k: 'info', t: `${d.longAlt} alt text${d.longAlt > 1 ? 's run' : ' runs'} past 125 characters`, m: 'Long descriptions get clunky when read aloud. Aim for one tight sentence.' });

    let html = `<div class="t-head"><div class="t-summary">${esc(`${described} of ${d.total} images on ${domain} are accounted for.`)}</div>` +
      `<span class="pill ${d.missing ? 'pill--err' : 'pill--ok'}">${pct}%</span></div>`;
    html += `<div class="dsec"><div class="dsec-h">Findings</div>${checks.map(checkCard).join('')}</div>`;

    if (d.offenders && d.offenders.length) {
      html += `<div class="dsec"><div class="dsec-h">Missing alt text${d.missing > d.offenders.length ? ` (first ${d.offenders.length} of ${d.missing})` : ''}</div>
        <div class="off-grid">${d.offenders.map((src) =>
          `<div class="off-item"><img class="off-img" src="${escAttr(src)}" alt="" loading="lazy" /><div class="off-src">${esc(src.length > 70 ? src.slice(0, 70) + '…' : src)}</div></div>`).join('')}</div></div>`;
    }
    $('#results').innerHTML = html;
  } catch (e) {
    $('#results').innerHTML = note('err', 'Could not reach the scanner. If you are running locally without Netlify, the function is unavailable.');
  } finally {
    btn.disabled = false;
  }
}

function initAlt() {
  initTheme();
  $('#check-form').addEventListener('submit', (e) => { e.preventDefault(); run(); });
  $$('.ex').forEach((b) => b.addEventListener('click', () => { $('#f-url').value = b.dataset.ex; run(); }));
}

export { initAlt };
