// Desktop-only flourish: while recording, a slack cable visually connects the
// player container (#app) and the notes panel, re-drawn on drag/resize via
// rAF. No physics engine — a quadratic sag whose depth scales with the gap.

export function mountRecordingCable() {
  if (matchMedia('(pointer: coarse)').matches) {
    return { show() {}, hide() {} };
  }

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.dataset.role = 'recording-cable';
  Object.assign(svg.style, {
    position: 'fixed', inset: '0', width: '100%', height: '100%',
    pointerEvents: 'none', zIndex: '60', display: 'none',
  });
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#cd0025');
  path.setAttribute('stroke-width', '3');
  path.setAttribute('stroke-linecap', 'round');
  svg.appendChild(path);
  document.body.appendChild(svg);

  let raf = 0, running = false;

  function edgeAnchor(el, otherRect) {
    const r = el.getBoundingClientRect();
    const side = r.left + r.width / 2 < otherRect.left + otherRect.width / 2 ? r.right : r.left;
    return { x: side, y: r.top + r.height / 2 };
  }

  function draw() {
    const app = document.getElementById('app');
    const panel = document.querySelector('.notes-panel.is-open') || document.querySelector('.notes-panel');
    if (app && panel) {
      const ar = app.getBoundingClientRect();
      const pr = panel.getBoundingClientRect();
      const a = edgeAnchor(app, pr);
      const b = edgeAnchor(panel, ar);
      const midX = (a.x + b.x) / 2;
      const gap = Math.hypot(b.x - a.x, b.y - a.y);
      const sagY = Math.max(a.y, b.y) + Math.min(140, gap * 0.28);
      path.setAttribute('d', `M ${a.x} ${a.y} Q ${midX} ${sagY} ${b.x} ${b.y}`);
    }
    if (running) raf = requestAnimationFrame(draw);
  }

  return {
    show() {
      if (running) return;
      running = true;
      svg.style.display = '';
      draw();
    },
    hide() {
      running = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      svg.style.display = 'none';
    },
  };
}
