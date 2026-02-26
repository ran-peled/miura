'use strict';

// ── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'miura-ori-settings';

const DEFAULTS = {
  cellWidth:     40,
  cellHeight:    30,
  cols:           8,
  rows:           6,
  angle:         60,
  colorMode:    false,
  smoothEnabled: false,
  smoothWidth:   10,
};

const SVG_NS = 'http://www.w3.org/2000/svg';

// ── State ────────────────────────────────────────────────────────────────────

let state = Object.assign({}, DEFAULTS);

// ── Algorithm ─────────────────────────────────────────────────────────────────

function clampAngle(deg) {
  return Math.max(10, Math.min(90, deg));
}

/**
 * Returns:
 *   hEdges   — horizontal fold segments with type
 *   dCols    — diagonal columns: [{pts:[{x,y}…], type}]
 *   rightCol — right boundary column vertices, j=0→R
 *   leftCol  — left  boundary column vertices, j=R→0
 *   topLeft, topRight, botLeft — boundary corner points
 *   width, height
 */
function computePattern(s) {
  const cw = s.cellWidth;
  const ch = s.cellHeight;
  const R  = s.rows;
  const C  = s.cols;
  const alpha = clampAngle(s.angle) * Math.PI / 180;
  const dx = ch / Math.tan(alpha);
  const dy = ch;

  const vx = (j, i) => i * cw + (j % 2 === 1 ? dx : 0);
  const vy = (j)    => j * dy;

  // Horizontal adjustment so segments meet the smooth diagonal curves.
  // The Bézier at an interior vertex crosses y=j·dy at x = V.x ± w_eff·dx/(2·L).
  // Even rows shift right (+), odd rows shift left (−).
  // Boundary rows (j=0 and j=R) have no curve, so no shift.
  let hShift = 0;
  if (s.smoothEnabled && s.smoothWidth > 0) {
    const Lseg = Math.sqrt(dx * dx + dy * dy);
    const wEff = Math.min(s.smoothWidth / 2, Lseg * 0.45);
    hShift = wEff * dx / (2 * Lseg);
  }

  // Horizontal edges — checkerboard mountain/valley
  const hEdges = [];
  for (let j = 0; j <= R; j++) {
    const isInterior = j > 0 && j < R;
    const xShift = isInterior ? (j % 2 === 0 ? hShift : -hShift) : 0;
    for (let i = 0; i < C; i++) {
      const type = ((i + j) % 2 === 0) ? 'mountain' : 'valley';
      hEdges.push({ x1: vx(j,i) + xShift, y1: vy(j), x2: vx(j,i+1) + xShift, y2: vy(j), type });
    }
  }

  // Diagonal columns — each column i is uniformly one type
  const dCols = [];
  for (let i = 0; i <= C; i++) {
    const pts = [];
    for (let j = 0; j <= R; j++) pts.push({ x: vx(j, i), y: vy(j) });
    dCols.push({ pts, type: (i % 2 === 0) ? 'valley' : 'mountain' });
  }

  const width  = C * cw + dx;
  const height = R * dy;

  // Boundary columns for the outline polygon
  const rightCol = [];
  for (let j = 0; j <= R; j++) rightCol.push({ x: vx(j, C), y: vy(j) });
  const leftCol = [];
  for (let j = R; j >= 0; j--) leftCol.push({ x: vx(j, 0), y: vy(j) });

  const topLeft  = { x: vx(0, 0), y: vy(0) };
  const topRight = { x: vx(0, C), y: vy(0) };
  const botLeft  = { x: vx(R, 0), y: vy(R) };

  return { hEdges, dCols, rightCol, leftCol, topLeft, topRight, botLeft, width, height };
}

// ── SVG helpers ───────────────────────────────────────────────────────────────

function makeSVGEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function getLineStyle(type, colorMode) {
  if (!colorMode)
    return { stroke: '#222', 'stroke-width': '0.5', 'stroke-dasharray': 'none' };
  if (type === 'mountain')
    return { stroke: '#c0392b', 'stroke-width': '0.5', 'stroke-dasharray': 'none' };
  return { stroke: '#2980b9', 'stroke-width': '0.5', 'stroke-dasharray': '4 3' };
}

// ── Path building ─────────────────────────────────────────────────────────────

/**
 * Returns path segment commands (L / Q) starting from pts[1].
 * The caller must have already moved to pts[0].
 * Interior vertices (1 … n-2) get a quadratic Bézier rounded corner;
 * boundary vertices get a plain L.
 * W is the total arc-length of the smooth region around each corner.
 */
function buildColSegments(pts, W) {
  const n = pts.length;
  let d = '';
  for (let j = 1; j < n; j++) {
    const isInterior = j < n - 1;   // first and last are not rounded
    if (W <= 0 || !isInterior) {
      d += ` L ${pts[j].x.toFixed(4)} ${pts[j].y.toFixed(4)}`;
      continue;
    }
    const prev = pts[j - 1], curr = pts[j], next = pts[j + 1];

    const dxIn = curr.x - prev.x, dyIn = curr.y - prev.y;
    const lIn  = Math.sqrt(dxIn * dxIn + dyIn * dyIn);
    const uxIn = dxIn / lIn,  uyIn = dyIn / lIn;

    const dxOut = next.x - curr.x, dyOut = next.y - curr.y;
    const lOut  = Math.sqrt(dxOut * dxOut + dyOut * dyOut);
    const uxOut = dxOut / lOut, uyOut = dyOut / lOut;

    // Clamp half-width so adjacent curves never overlap
    const w = Math.min(W / 2, lIn * 0.45, lOut * 0.45);

    const p1x = curr.x - w * uxIn,  p1y = curr.y - w * uyIn;
    const p2x = curr.x + w * uxOut, p2y = curr.y + w * uyOut;

    d += ` L ${p1x.toFixed(4)} ${p1y.toFixed(4)}`;
    d += ` Q ${curr.x.toFixed(4)} ${curr.y.toFixed(4)} ${p2x.toFixed(4)} ${p2y.toFixed(4)}`;
  }
  return d;
}

function buildColPath(pts, W) {
  if (!pts.length) return '';
  return `M ${pts[0].x.toFixed(4)} ${pts[0].y.toFixed(4)}` + buildColSegments(pts, W);
}

/**
 * Closed boundary path:
 *   straight top edge → smooth right zigzag → straight bottom edge → smooth left zigzag
 * The four outer corners (topLeft, topRight, botRight, botLeft) are NOT rounded.
 */
function buildBoundaryPath(topLeft, topRight, botLeft, rightCol, leftCol, W) {
  let d = `M ${topLeft.x.toFixed(4)} ${topLeft.y.toFixed(4)}`;
  d += ` L ${topRight.x.toFixed(4)} ${topRight.y.toFixed(4)}`;  // top edge
  d += buildColSegments(rightCol, W);                             // right zigzag ↓
  d += ` L ${botLeft.x.toFixed(4)} ${botLeft.y.toFixed(4)}`;    // bottom edge
  d += buildColSegments(leftCol, W);                              // left zigzag ↑
  d += ' Z';
  return d;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderPattern() {
  const svg = document.getElementById('crease-svg');
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const { hEdges, dCols, rightCol, leftCol,
          topLeft, topRight, botLeft, width, height } = computePattern(state);
  const pad = 4;

  svg.setAttribute('viewBox',
    `${-pad} ${-pad} ${(width + pad * 2).toFixed(4)} ${(height + pad * 2).toFixed(4)}`);

  // White background
  svg.appendChild(makeSVGEl('rect', {
    x: (-pad).toString(), y: (-pad).toString(),
    width: (width + pad * 2).toFixed(4), height: (height + pad * 2).toFixed(4),
    fill: '#ffffff',
  }));

  // Horizontal fold edges
  for (const e of hEdges) {
    svg.appendChild(makeSVGEl('line', {
      x1: e.x1.toFixed(4), y1: e.y1.toFixed(4),
      x2: e.x2.toFixed(4), y2: e.y2.toFixed(4),
      ...getLineStyle(e.type, state.colorMode),
    }));
  }

  // Diagonal columns — smooth when enabled
  const W = state.smoothEnabled ? state.smoothWidth : 0;
  for (const col of dCols) {
    svg.appendChild(makeSVGEl('path', {
      d:    buildColPath(col.pts, W),
      fill: 'none',
      ...getLineStyle(col.type, state.colorMode),
    }));
  }

  // Outer boundary
  svg.appendChild(makeSVGEl('path', {
    d:    buildBoundaryPath(topLeft, topRight, botLeft, rightCol, leftCol, W),
    fill: 'none',
    stroke: '#000',
    'stroke-width': '1',
    'stroke-linejoin': 'miter',
  }));
}

// ── localStorage ──────────────────────────────────────────────────────────────

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    for (const key of Object.keys(DEFAULTS)) {
      if (key in saved) state[key] = saved[key];
    }
  } catch (_) {}
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
}

// ── Control sync ──────────────────────────────────────────────────────────────

function syncControlsToState() {
  document.getElementById('cellWidth').value    = state.cellWidth;
  document.getElementById('cellHeight').value   = state.cellHeight;
  document.getElementById('cols').value         = state.cols;
  document.getElementById('rows').value         = state.rows;
  document.getElementById('angle').value        = state.angle;
  document.getElementById('smoothWidth').value  = state.smoothWidth;
  document.getElementById('colorMode').checked    = state.colorMode;
  document.getElementById('smoothEnabled').checked = state.smoothEnabled;
  document.getElementById('smoothWidthGroup').style.display =
    state.smoothEnabled ? 'flex' : 'none';
  updateDisplays();
}

function updateDisplays() {
  document.getElementById('cellWidth-num').value   = state.cellWidth;
  document.getElementById('cellHeight-num').value  = state.cellHeight;
  document.getElementById('cols-num').value        = state.cols;
  document.getElementById('rows-num').value        = state.rows;
  document.getElementById('angle-num').value       = state.angle;
  document.getElementById('smoothWidth-num').value = state.smoothWidth;
}

// ── Event handlers ────────────────────────────────────────────────────────────

function onSliderInput(event) {
  const id  = event.target.id;
  const val = parseInt(event.target.value, 10);
  state[id] = val;
  const numEl = document.getElementById(id + '-num');
  if (numEl) numEl.value = val;
  saveState();
  renderPattern();
}

function onNumberInput(event) {
  const el  = event.target;
  const id  = el.id.replace('-num', '');
  let   val = parseInt(el.value, 10);
  if (isNaN(val)) return;
  val = Math.max(parseInt(el.min, 10), Math.min(parseInt(el.max, 10), val));
  el.value = val;
  state[id] = val;
  document.getElementById(id).value = val;
  saveState();
  renderPattern();
}

function onToggleChange() {
  state.colorMode = document.getElementById('colorMode').checked;
  saveState();
  renderPattern();
}

function onSmoothToggle() {
  state.smoothEnabled = document.getElementById('smoothEnabled').checked;
  document.getElementById('smoothWidthGroup').style.display =
    state.smoothEnabled ? 'flex' : 'none';
  saveState();
  renderPattern();
}

function onExport() {
  const svg = document.getElementById('crease-svg');
  const svgStr = new XMLSerializer().serializeToString(svg);
  const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + svgStr],
                        { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'miura-ori.svg';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Event binding ─────────────────────────────────────────────────────────────

function bindEvents() {
  for (const id of ['cellWidth', 'cellHeight', 'cols', 'rows', 'angle', 'smoothWidth']) {
    document.getElementById(id).addEventListener('input', onSliderInput);
    document.getElementById(id + '-num').addEventListener('change', onNumberInput);
  }
  document.getElementById('colorMode').addEventListener('change', onToggleChange);
  document.getElementById('smoothEnabled').addEventListener('change', onSmoothToggle);
  document.getElementById('exportBtn').addEventListener('click', onExport);
}

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  loadState();
  syncControlsToState();
  bindEvents();
  renderPattern();
}

document.addEventListener('DOMContentLoaded', init);
