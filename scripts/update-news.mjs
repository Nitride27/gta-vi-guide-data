// Merges Claude's proposed entries (fresh.json) into news.json.
// Usage: node scripts/update-news.mjs fresh.json
//        node scripts/update-news.mjs --check  (offline self-check)
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const FILE = new URL('../news.json', import.meta.url);
const TYPES = ['announcement', 'trailer', 'update', 'leak'];
const FIELDS = ['title', 'type', 'date', 'summary', 'content', 'source', 'url'];

// Validates entries, drops ones already present, assigns ids, prepends.
export function mergeNews(existing, fresh) {
  const seen = new Set(existing.flatMap((n) => [n.url, n.title.toLowerCase()]).filter(Boolean));
  let id = Math.max(0, ...existing.map((n) => Number(n.id) || 0));
  const added = fresh
    .filter((n) => FIELDS.every((f) => typeof n[f] === 'string' && n[f].trim()) && TYPES.includes(n.type))
    .filter((n) => !seen.has(n.url) && !seen.has(n.title.toLowerCase()))
    .slice(0, 5)
    .map((n) => ({ id: String(++id), ...Object.fromEntries(FIELDS.map((f) => [f, n[f].trim()])) }));
  return [...added, ...existing];
}

function check() {
  const existing = [{ id: '6', title: 'Old', url: 'https://a', type: 'leak', date: 'x', summary: 'x', content: 'x', source: 'x' }];
  const item = { title: 'New', type: 'trailer', date: 'October 15, 2026', summary: 's', content: 'c', source: 'Rockstar', url: 'https://b' };
  const out = mergeNews(existing, [item, { ...item, title: 'OLD' }, { ...item, url: 'https://a', title: 'Dup url' }, { ...item, url: 'https://c', title: 'Bad', type: 'rumor' }]);
  assert.deepEqual(out.map((n) => n.id), ['7', '6']);
  assert.equal(mergeNews(out, [item]).length, 2, 'second run adds nothing');
  console.log('check ok');
}

async function merge(path) {
  const existing = JSON.parse(await readFile(FILE, 'utf8'));
  let fresh = [];
  try { fresh = JSON.parse(await readFile(path, 'utf8')); } catch { console.log(`no usable ${path}`); }
  if (!Array.isArray(fresh)) fresh = [];
  const merged = mergeNews(existing, fresh);
  console.log(`added ${merged.length - existing.length} of ${fresh.length} proposed`);
  if (merged.length > existing.length) await writeFile(FILE, JSON.stringify(merged, null, 2) + '\n');
}

if (process.argv[2] === '--check') check();
else await merge(process.argv[2] ?? 'fresh.json');
