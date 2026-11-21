// Top-10 high score table kept in this browser's localStorage.

const KEY = 'gyro-strike-hiscores';
const SIZE = 10;

const DEFAULTS = [
  ['GYR', 30000], ['TLT', 25000], ['ACE', 20000], ['ZAP', 15000], ['PEW', 12000],
  ['BOP', 10000], ['NAV', 8000], ['ION', 6000], ['ORB', 4000], ['SKY', 2000],
].map(([n, s]) => ({ n, s, w: 1 }));

export function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    if (Array.isArray(v) && v.length) return v.slice(0, SIZE);
  } catch { /* storage blocked or corrupt */ }
  return DEFAULTS.map((e) => ({ ...e }));
}

function save(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

export const qualifies = (list, score) =>
  score > 0 && (list.length < SIZE || score > list[list.length - 1].s);

export function insert(list, entry) {
  list.push(entry);
  list.sort((a, b) => b.s - a.s);
  list.length = Math.min(list.length, SIZE);
  save(list);
}
