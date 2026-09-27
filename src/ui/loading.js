// Loading / failure screen (#loading in index.html, visible before any script runs).
//   loading.stage(label, k) -> Promise   what is being built now + progress 0..1; resolves once the browser could paint
//   loading.done(instant)               first frame is on screen: fade out (instant: no fade, screenshot mode)
//   loading.fail(title, detail)         the game cannot start / cannot go on: message + Reload button
const el = document.getElementById('loading');
const $ = (id) => document.getElementById(id);

// The city build blocks the main thread between stages, so a stage only shows if the browser gets a frame in. The
// timeout keeps a background tab loading (it gets no animation frames).
const painted = () => new Promise((res) => {
  let done = false; const go = () => { if (!done) { done = true; res(); } };
  requestAnimationFrame(() => setTimeout(go, 0)); setTimeout(go, 60);
});

export const loading = {
  stage(label, k) {
    if (!el || el.hidden) return Promise.resolve();
    $('ld-stage').textContent = label; $('ld-fill').style.width = Math.round(k * 100) + '%';
    return painted();
  },
  done(instant = false) {
    if (!el || el.hidden || el.classList.contains('fail')) return;
    if (instant) { el.hidden = true; return; }
    el.classList.add('out');
    setTimeout(() => { if (!el.classList.contains('fail')) el.hidden = true; }, 500);
  },
  fail(title, detail = '') {
    if (!el) return;
    el.hidden = false; el.classList.remove('out'); el.classList.add('fail');
    $('ld-stage').textContent = title;
    $('ld-detail').textContent = detail; $('ld-detail').hidden = !detail;
    $('ld-reload').hidden = false; $('ld-reload').onclick = () => location.reload();
  },
};
