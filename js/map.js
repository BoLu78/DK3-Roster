// Mappa offline: contorni dei continenti salvati nell'app, aeroporti e tratte (cerchio massimo).
// Nessuna richiesta di rete: niente mappe online.
import { LAND } from './worldmap.js';
import { coordsFor } from '../src/airports-geo.js';
import { greatCircle, fitView } from '../src/geo.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

// opts: { routes, airports: Map(code -> n), height, interactive, onSelect(code) }
export function createMap(container, opts) {
  const { routes, airports, height = 300, interactive = true, onSelect } = opts;
  const W = 1000; // unità interne: la larghezza vera la decide il contenitore
  const H = Math.round((W * height) / Math.max(container.clientWidth || 360, 200));
  const codes = [...airports.keys()];
  const pts = codes.map(coordsFor);
  const { project } = fitView(pts, W, H);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'mp', role: 'img', 'aria-label': 'Mappa delle tratte' });
  svg.style.height = `${height}px`;
  svg.style.touchAction = interactive ? 'none' : 'auto';
  svg.append(el('rect', { x: -5000, y: -5000, width: 12000, height: 12000, class: 'mp-sea' }));

  // terra: solo gli anelli che finiscono vicino all'inquadratura
  let d = '';
  const lo = -W * 1.5, hi = W * 2.5, loY = -H * 1.5, hiY = H * 2.5;
  for (const ring of LAND) {
    let near = false;
    const xy = [];
    for (let i = 0; i < ring.length; i += 2) {
      const [x, y] = project([ring[i + 1] / 20, ring[i] / 20]);
      xy.push(x, y);
      if (x > lo && x < hi && y > loY && y < hiY) near = true;
    }
    if (!near) continue;
    d += 'M' + xy.map((v, i) => (i % 2 ? ' ' : i ? 'L' : '') + v.toFixed(1)).join('') + 'Z';
  }
  svg.append(el('path', { d, class: 'mp-land' }));

  const arcs = el('g');
  for (const r of routes) {
    const a = coordsFor(r.from);
    const b = coordsFor(r.to);
    const line = greatCircle(a, b, 28).map(project);
    const path = el('path', { d: 'M' + line.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L'), class: 'mp-arc', 'vector-effect': 'non-scaling-stroke' });
    path.style.strokeWidth = `${Math.min(1.5 + r.count * 0.5, 5)}px`;
    arcs.append(path);
  }
  svg.append(arcs);

  const dots = [];
  const labels = [];
  const g = el('g');
  for (const code of codes) {
    const [x, y] = project(coordsFor(code));
    const c = el('circle', { cx: x, cy: y, r: 5, class: 'mp-dot' });
    const t = el('text', { x: x + 8, y: y - 8, class: 'mp-lbl' });
    t.textContent = code;
    if (interactive) {
      c.addEventListener('click', () => onSelect?.(code));
      t.addEventListener('click', () => onSelect?.(code));
    }
    g.append(c, t);
    dots.push(c);
    labels.push(t);
  }
  svg.append(g);
  container.replaceChildren(svg);

  // ---- zoom / spostamento
  const full = { x: 0, y: 0, w: W, h: H };
  let vb = { ...full };
  const px = () => container.clientWidth || 360;
  const apply = () => {
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    const u = vb.w / px(); // unità interne per pixel
    for (const c of dots) c.setAttribute('r', (4.5 * u).toFixed(2));
    for (const t of labels) {
      t.setAttribute('font-size', (11 * u).toFixed(2));
      t.setAttribute('x', (+t.previousSibling.getAttribute('cx') + 7 * u).toFixed(2));
      t.setAttribute('y', (+t.previousSibling.getAttribute('cy') - 7 * u).toFixed(2));
    }
  };
  const zoom = (f, cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2) => {
    const nw = Math.min(Math.max(vb.w * f, W / 60), W * 4);
    const k = nw / vb.w;
    vb = { x: cx - (cx - vb.x) * k, y: cy - (cy - vb.y) * k, w: nw, h: vb.h * k };
    apply();
  };
  apply();
  if (interactive) {
    const ptrs = new Map();
    const toSvg = (e) => {
      const r = svg.getBoundingClientRect();
      return [vb.x + ((e.clientX - r.left) / r.width) * vb.w, vb.y + ((e.clientY - r.top) / r.height) * vb.h];
    };
    svg.addEventListener('pointerdown', (e) => {
      svg.setPointerCapture?.(e.pointerId);
      ptrs.set(e.pointerId, e);
    });
    svg.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId)) return;
      const prev = ptrs.get(e.pointerId);
      if (ptrs.size === 1) {
        const r = svg.getBoundingClientRect();
        vb.x -= ((e.clientX - prev.clientX) / r.width) * vb.w;
        vb.y -= ((e.clientY - prev.clientY) / r.height) * vb.h;
        apply();
      } else if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        const before = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        ptrs.set(e.pointerId, e);
        const [a2, b2] = [...ptrs.values()];
        const now = Math.hypot(a2.clientX - b2.clientX, a2.clientY - b2.clientY);
        if (before > 0 && now > 0) zoom(before / now, ...toSvg({ clientX: (a2.clientX + b2.clientX) / 2, clientY: (a2.clientY + b2.clientY) / 2 }));
      }
      ptrs.set(e.pointerId, e);
    });
    const up = (e) => ptrs.delete(e.pointerId);
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoom(e.deltaY > 0 ? 1.2 : 1 / 1.2, ...toSvg(e));
    }, { passive: false });
  }
  return {
    zoomIn: () => zoom(1 / 1.5),
    zoomOut: () => zoom(1.5),
    reset: () => {
      vb = { ...full };
      apply();
    },
  };
}
