// Finds new GTA VI news and prepends it to news.json.
// Usage: node scripts/update-news.mjs          (needs ANTHROPIC_API_KEY)
//        node scripts/update-news.mjs --check  (offline self-check)
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const FILE = new URL('../news.json', import.meta.url);
const MODEL = 'claude-opus-5-5';
const ROCKSTAR_YT = 'https://www.youtube.com/feeds/videos.xml?channel_id=UC6VcWc1rAoWdBCM0JxrRQ3A';
const TRUSTED = ['rockstargames.com', 'ign.com', 'gamespot.com', 'eurogamer.net', 'polygon.com', 'theverge.com', 'kotaku.com', 'pcgamer.com', 'gamesindustry.biz', 'bloomberg.com'];
const TYPES = ['announcement', 'trailer', 'update', 'leak'];
const FIELDS = ['title', 'type', 'date', 'summary', 'content', 'source', 'url'];

// YouTube Atom feed -> [{ title, url, published }]
export function parseFeed(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    title: e.match(/<title>([^<]*)<\/title>/)?.[1],
    url: e.match(/<link rel="alternate" href="([^"]+)"/)?.[1],
    published: e.match(/<published>([^<]+)<\/published>/)?.[1],
  }));
}

// Validates Claude's entries, drops ones already present, assigns ids, prepends.
export function mergeNews(existing, fresh) {
  const seen = new Set(existing.flatMap((n) => [n.url, n.title.toLowerCase()]).filter(Boolean));
  let id = Math.max(0, ...existing.map((n) => Number(n.id) || 0));
  const added = fresh
    .filter((n) => FIELDS.every((f) => typeof n[f] === 'string' && n[f].trim()) && TYPES.includes(n.type))
    .filter((n) => !seen.has(n.url) && !seen.has(n.title.toLowerCase()))
    .map((n) => ({ id: String(++id), ...Object.fromEntries(FIELDS.map((f) => [f, n[f].trim()])) }));
  return [...added, ...existing];
}

function check() {
  const xml = '<feed><entry><title>Trailer 3</title><link rel="alternate" href="https://youtu.be/x"/><published>2026-10-15T00:00:00Z</published></entry></feed>';
  assert.deepEqual(parseFeed(xml), [{ title: 'Trailer 3', url: 'https://youtu.be/x', published: '2026-10-15T00:00:00Z' }]);
  const existing = [{ id: '6', title: 'Old', url: 'https://a', type: 'leak', date: 'x', summary: 'x', content: 'x', source: 'x' }];
  const item = { title: 'New', type: 'trailer', date: 'October 15, 2026', summary: 's', content: 'c', source: 'Rockstar', url: 'https://b' };
  const out = mergeNews(existing, [item, { ...item, title: 'OLD' }, { ...item, url: 'https://a', title: 'Dup url' }, { ...item, url: 'https://c', title: 'Bad', type: 'rumor' }]);
  assert.deepEqual(out.map((n) => n.id), ['7', '6']);
  assert.equal(mergeNews(out, [item]).length, 2, 'second run adds nothing');
  console.log('check ok');
}

async function main() {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const existing = JSON.parse(await readFile(FILE, 'utf8'));
  const weekAgo = Date.now() - 7 * 864e5;
  const videos = parseFeed(await (await fetch(ROCKSTAR_YT)).text()).filter((v) => Date.parse(v.published) > weekAgo);

  const prompt = `Today is ${new Date().toDateString()}. You maintain the news feed of a Grand Theft Auto VI companion app.
Search the web for GTA VI news from the past 7 days. New videos on Rockstar's official YouTube channel this week:
${JSON.stringify(videos)}

Stories already in the app (skip these and anything covering the same event):
${existing.slice(0, 15).map((n) => `- ${n.title} (${n.date})`).join('\n')}

Rules:
- Only include news confirmed by Rockstar Games/Take-Two or reported by a reputable outlet citing them. No rumors, leaks without confirmation, or speculation.
- Write original text; do not copy article sentences.
- At most 5 entries. If nothing is new, return [].

Reply with only a JSON array, no prose. Each item: {"title","type","date","summary","content","source","url"}
type is one of ${TYPES.join(', ')}. date like "October 15, 2026". summary is one sentence. content is 2-4 sentences. source is the outlet name. url is the source article.`;

  const client = new Anthropic();
  const messages = [{ role: 'user', content: prompt }];
  let res;
  for (let i = 0; i < 5; i++) {
    res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8, allowed_domains: TRUSTED }],
      messages,
    });
    if (res.stop_reason !== 'pause_turn') break;
    messages.splice(1, 1, { role: 'assistant', content: res.content });
  }
  if (res.stop_reason !== 'end_turn') throw new Error(`stopped: ${res.stop_reason} ${JSON.stringify(res.stop_details ?? '')}`);

  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const fresh = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
  const merged = mergeNews(existing, fresh);
  console.log(`added ${merged.length - existing.length} of ${fresh.length} proposed`);
  if (merged.length > existing.length) await writeFile(FILE, JSON.stringify(merged, null, 2) + '\n');
}

if (process.argv.includes('--check')) check();
else await main();
