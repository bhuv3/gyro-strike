// Formation layout, entry flight paths and dive paths.

export const W = 224;
export const H = 288;

// Rows from top: commanders, two rows of butterflies, two rows of bees.
// Later stages swap rows for tougher monsters.
function layout(wave) {
  const rows = [['cmdr', 4], ['fly', 8], ['fly', 8], ['bee', 10], ['bee', 10]];
  if (wave >= 2) rows[2][0] = 'zig';
  if (wave >= 3) rows[4][0] = 'split';
  if (wave >= 5) rows[1][0] = 'tank';
  if (wave >= 7) {
    const mix = ['fly', 'zig', 'tank', 'split', 'bee'];
    for (let r = 1; r < rows.length; r++) rows[r][0] = mix[Math.floor(Math.random() * mix.length)];
  }
  return rows;
}

export function formationSlots(wave = 1) {
  const slots = [];
  layout(wave).forEach(([type, n], row) => {
    for (let i = 0; i < n; i++) slots.push({ type, row, col: i - (n - 1) / 2 });
  });
  return slots;
}

// Catmull-Rom spline through the points, sampled every ~`step` px.
export function sampleSpline(pts, step = 2) {
  const out = [];
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((j) => 0.5 * (
        2 * p1[j] +
        (-p0[j] + p2[j]) * t +
        (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 +
        (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// Move `e` along e.path by `dist` px. Returns true when the path is finished.
export function followPath(e, dist) {
  while (dist > 0 && e.pi < e.path.length - 1) {
    const [tx, ty] = e.path[e.pi + 1];
    const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy);
    if (d > 0.01) e.angle = Math.atan2(dy, dx);
    if (d <= dist) { e.x = tx; e.y = ty; e.pi++; dist -= d; }
    else { e.x += (dx / d) * dist; e.y += (dy / d) * dist; dist = 0; }
  }
  return e.pi >= e.path.length - 1;
}

// Entry templates for the left-hand stream; the right stream is mirrored.
const TEMPLATES = {
  A: [[100, -12], [100, 40], [76, 110], [40, 160], [30, 200], [56, 226], [90, 206], [96, 168]],
  B: [[-12, 250], [30, 226], [74, 196], [104, 150], [100, 108], [70, 92], [46, 112], [56, 140]],
  C: [[-12, 40], [40, 70], [88, 118], [116, 168], [100, 206], [64, 198], [52, 160]],
};
const COMBOS = [['A', 'A'], ['B', 'B'], ['C', 'C'], ['A', 'B'], ['C', 'A'], ['B', 'C']];
const cache = {};

function template(name, mirrored) {
  const key = name + (mirrored ? 'm' : '');
  cache[key] ??= sampleSpline(TEMPLATES[name].map(([x, y]) => [mirrored ? W - x : x, y]));
  return cache[key];
}

// Which enemies fly in when: four groups, each as two mirrored streams.
export function entryPlan(wave) {
  const slots = formationSlots(wave);
  const row = (r) => slots.filter((s) => s.row === r);
  const groups = [row(3), row(1), [...row(0), ...row(2)], row(4)];
  const plan = [];
  groups.forEach((grp, gi) => {
    const [tl, tr] = COMBOS[(gi + wave - 1) % COMBOS.length];
    const base = 1.8 + gi * 2.6;
    grp.filter((s) => s.col < 0).forEach((slot, i) => plan.push({ slot, path: template(tl, false), delay: base + i * 0.11 }));
    grp.filter((s) => s.col >= 0).forEach((slot, i) => plan.push({ slot, path: template(tr, true), delay: base + i * 0.11 }));
  });
  return plan;
}

// Galaga-style dive: little loop out of formation, swoop at the target, exit bottom.
export function divePath(from, targetX) {
  const cx = (v) => Math.max(8, Math.min(W - 8, v));
  const dir = from.x < W / 2 ? -1 : 1;
  const { x, y } = from;
  return sampleSpline([
    [x, y],
    [x + dir * 14, y - 14],
    [x + dir * 26, y + 6],
    [cx((x + targetX) / 2), y + 80],
    [cx(targetX), 214],
    [cx(targetX - dir * 30), 262],
    [cx(targetX - dir * 50), H + 24],
  ]);
}

// Zig dive: fast side-to-side weave down toward the target.
export function zigPath(from, targetX) {
  const cx = (v) => Math.max(8, Math.min(W - 8, v));
  const pts = [[from.x, from.y], [from.x, from.y + 18]];
  let side = targetX < from.x ? 1 : -1;
  for (let y = from.y + 52; y < 260; y += 34) {
    side = -side;
    pts.push([cx(targetX + side * 36), y]);
  }
  pts.push([cx(targetX), H + 24]);
  return sampleSpline(pts);
}
