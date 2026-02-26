'use strict';

// ── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'miura-ori-settings';

const DEFAULTS = {
  cellWidth:  40,
  cellHeight: 30,
  cols:        8,
  rows:        6,
  angle:      60,
  colorMode: false,
};

const SVG_NS = 'http://www.w3.org/2000/svg';

// ── State ────────────────────────────────────────────────────────────────────

let state = Object.assign({}, DEFAULTS);

// ── Algorithm ─────────────────────────────────────────────────────────────────

/**
 * Clamp angle to [10°, 90°]. At 90° tan() is ~1.6e16 in JS so dx ≈ 0 (vertical zigzags).
 */
function clampAngle(deg) {
  return Math.max(10, Math.min(90, deg));
}

/**
 * Compute the Miura-ori crease pattern from the current state.
 * Returns { edges: [{x1,y1,x2,y2,type}], width, height }
 *
 * Vertex(row j, col i):
 *   x = i * cw + (j odd ? dx : 0)
 *   y = j * dy
 *
 * Fold classification:
 *   Horizontal at even row → valley
 *   Horizontal at odd row  → mountain
 *   Diagonal right (x2>x1) → mountain
 *   Diagonal left  (x2<x1) → valley
 */
function computePattern(s) {
  const cw = s.cellWidth;
  const ch = s.cellHeight;
  const R  = s.rows;
  const C  = s.cols;
  const alpha = clampAngle(s.angle) * Math.PI / 180;
  const dx = ch / Math.tan(alpha);
  const dy = ch;

  // Build vertex grid
  const vx = (j, i) => i * cw + (j % 2 === 1 ? dx : 0);
  const vy = (j)    => j * dy;

  const edges = [];

  // Horizontal edges: row j, col i → i+1
  // Segments alternate M/V within each row; row parity sets the starting type.
  // type = mountain if (i + j) is even, valley if odd.
  for (let j = 0; j <= R; j++) {
    for (let i = 0; i < C; i++) {
      const x1 = vx(j, i),   y1 = vy(j);
      const x2 = vx(j, i+1), y2 = vy(j);
      const type = ((i + j) % 2 === 0) ? 'mountain' : 'valley';
      edges.push({ x1, y1, x2, y2, type });
    }
  }

  // Diagonal edges: (j,i) → (j+1,i)
  // Each zigzag column i is uniformly one type for its full height:
  // even column index → valley, odd column index → mountain.
  for (let j = 0; j < R; j++) {
    for (let i = 0; i <= C; i++) {
      const x1 = vx(j,   i), y1 = vy(j);
      const x2 = vx(j+1, i), y2 = vy(j+1);
      const type = (i % 2 === 0) ? 'valley' : 'mountain';
      edges.push({ x1, y1, x2, y2, type });
    }
  }

  const width  = C * cw + dx;
  const height = R * dy;

  // Outer boundary: straight top/bottom, zigzag left (col 0) and right (col C)
  const boundaryPts = [];
  boundaryPts.push([vx(0, 0), vy(0)]);              // top-left
  boundaryPts.push([vx(0, C), vy(0)]);              // top-right
  for (let j = 1; j <= R; j++)                       // right zigzag ↓
    boundaryPts.push([vx(j, C), vy(j)]);
  boundaryPts.push([vx(R, 0), vy(R)]);              // bottom-left
  for (let j = R - 1; j >= 1; j--)                  // left zigzag ↑
    boundaryPts.push([vx(j, 0), vy(j)]);

  return { edges, width, height, boundaryPts };
}

// ── SVG Helpers ───────────────────────────────────────────────────────────────

function makeSVGEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  return el;
}

/**
 * Return inline stroke attributes for a fold edge.
 * colorMode=false → all black solid lines
 * colorMode=true  → mountain=red solid, valley=blue dashed
 */
function getLineStyle(type, colorMode) {
  if (!colorMode) {
    return { stroke: '#222', 'stroke-width': '0.5', 'stroke-dasharray': 'none' };
  }
  if (type === 'mountain') {
    return { stroke: '#c0392b', 'stroke-width': '0.5', 'stroke-dasharray': 'none' };
  }
  // valley
  return { stroke: '#2980b9', 'stroke-width': '0.5', 'stroke-dasharray': '4 3' };
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderPattern() {
  const svg = document.getElementById('crease-svg');

  // Clear previous content
  while (svg.firstChild) {
    svg.removeChild(svg.firstChild);
  }

  const { edges, width, height, boundaryPts } = computePattern(state);
  const pad = 4;

  svg.setAttribute('viewBox', `${-pad} ${-pad} ${(width + pad * 2).toFixed(4)} ${(height + pad * 2).toFixed(4)}`);

  // White background (for clean SVG export)
  const bg = makeSVGEl('rect', {
    x: (-pad).toString(),
    y: (-pad).toString(),
    width:  (width  + pad * 2).toFixed(4),
    height: (height + pad * 2).toFixed(4),
    fill: '#ffffff',
  });
  svg.appendChild(bg);

  // Draw each edge
  for (const e of edges) {
    const styleAttrs = getLineStyle(e.type, state.colorMode);
    const line = makeSVGEl('line', {
      x1: e.x1.toFixed(4),
      y1: e.y1.toFixed(4),
      x2: e.x2.toFixed(4),
      y2: e.y2.toFixed(4),
      ...styleAttrs,
    });
    svg.appendChild(line);
  }

  // Outer boundary: follows the actual zigzag edges on left and right
  const border = makeSVGEl('polygon', {
    points: boundaryPts.map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).join(' '),
    fill:   'none',
    stroke: '#000',
    'stroke-width': '1',
    'stroke-linejoin': 'miter',
  });
  svg.appendChild(border);
}

// ── localStorage ──────────────────────────────────────────────────────────────

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    // Only apply keys that exist in DEFAULTS, ignore stale/unknown entries
    for (const key of Object.keys(DEFAULTS)) {
      if (key in saved) {
        state[key] = saved[key];
      }
    }
  } catch (_) {
    // Silently ignore parse errors or missing localStorage
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_) {
    // Ignore quota errors
  }
}

// ── Control sync ──────────────────────────────────────────────────────────────

function syncControlsToState() {
  document.getElementById('cellWidth').value  = state.cellWidth;
  document.getElementById('cellHeight').value = state.cellHeight;
  document.getElementById('cols').value       = state.cols;
  document.getElementById('rows').value       = state.rows;
  document.getElementById('angle').value      = state.angle;
  document.getElementById('colorMode').checked = state.colorMode;

  updateDisplays();
}

function updateDisplays() {
  document.getElementById('cellWidth-num').value  = state.cellWidth;
  document.getElementById('cellHeight-num').value = state.cellHeight;
  document.getElementById('cols-num').value       = state.cols;
  document.getElementById('rows-num').value       = state.rows;
  document.getElementById('angle-num').value      = state.angle;
}

function readControlsToState() {
  state.cellWidth  = parseInt(document.getElementById('cellWidth').value,  10);
  state.cellHeight = parseInt(document.getElementById('cellHeight').value, 10);
  state.cols       = parseInt(document.getElementById('cols').value,       10);
  state.rows       = parseInt(document.getElementById('rows').value,       10);
  state.angle      = parseInt(document.getElementById('angle').value,      10);
  state.colorMode  = document.getElementById('colorMode').checked;
}

// ── Event handlers ────────────────────────────────────────────────────────────

function onSliderInput(event) {
  const id = event.target.id;
  const val = parseInt(event.target.value, 10);
  state[id] = val;
  const numEl = document.getElementById(id + '-num');
  if (numEl) numEl.value = val;
  saveState();
  renderPattern();
}

function onNumberInput(event) {
  const el = event.target;
  const id = el.id.replace('-num', '');
  let val = parseInt(el.value, 10);
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

function onExport() {
  const svg = document.getElementById('crease-svg');
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(svg);
  const xmlDecl = '<?xml version="1.0" encoding="UTF-8"?>\n';
  const blob = new Blob([xmlDecl + svgStr], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = 'miura-ori.svg';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Event binding ─────────────────────────────────────────────────────────────

function bindEvents() {
  const sliderIds = ['cellWidth', 'cellHeight', 'cols', 'rows', 'angle'];
  for (const id of sliderIds) {
    document.getElementById(id).addEventListener('input', onSliderInput);
    document.getElementById(id + '-num').addEventListener('change', onNumberInput);
  }

  document.getElementById('colorMode').addEventListener('change', onToggleChange);
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
