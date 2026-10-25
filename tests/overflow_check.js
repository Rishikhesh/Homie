() => {
  const out = { overflow: [], leftBorders: [], big: [], clipped: [], docW: document.documentElement.scrollWidth, vw: window.innerWidth };
  const sel = '[data-testid*="card"],[data-testid*="row"],[data-testid^="chat-msg"],[data-testid*="tracker"],[data-testid^="approval-"],[data-testid^="job-"],[data-testid^="grid-"]';
  document.querySelectorAll(sel).forEach(c => {
    const r = c.getBoundingClientRect();
    if (r.width === 0) return;
    let bad = 0, ex = '';
    c.querySelectorAll('*').forEach(k => {
      const kr = k.getBoundingClientRect();
      if (kr.width === 0 || kr.height === 0) return;
      if (kr.left < r.left - 1.5 || kr.right > r.right + 1.5) { bad++; if (!ex) ex = `${k.tagName} ${Math.round(kr.left)}-${Math.round(kr.right)} vs ${Math.round(r.left)}-${Math.round(r.right)}`; }
    });
    if (bad) out.overflow.push(`${c.getAttribute('data-testid')}: ${bad} kids out (${ex})`);
  });
  document.querySelectorAll('div').forEach(d => {
    const s = getComputedStyle(d);
    const w = parseFloat(s.borderLeftWidth);
    if (w >= 3 && parseFloat(s.borderRightWidth) < w && s.borderLeftColor !== 'rgba(0, 0, 0, 0)') out.leftBorders.push((d.getAttribute('data-testid') || '?') + ':' + w + ' ' + s.borderLeftColor);
    const f = parseFloat(s.fontSize);
    if (d.childElementCount === 0 && d.textContent.trim()) {
      if (f >= 26) out.big.push(d.textContent.trim().slice(0, 18) + ':' + f + '/' + s.lineHeight);
      if (d.scrollHeight > d.clientHeight + 2 && s.overflow !== 'visible' && f >= 20) out.clipped.push(d.textContent.trim().slice(0, 18) + ' sh' + d.scrollHeight + ' ch' + d.clientHeight);
    }
  });
  const circles = [];
  document.querySelectorAll('div').forEach(d => { const s = getComputedStyle(d); const r = d.getBoundingClientRect(); if (Math.abs(r.width - r.height) < 1 && parseFloat(s.borderTopLeftRadius) >= r.width / 2 - 1 && r.width >= 20 && r.width <= 70 && d.querySelector('svg,[class*="icon"]') ) circles.push(Math.round(r.width)); });
  out.circleSizes = [...new Set(circles)];
  return out;
}
