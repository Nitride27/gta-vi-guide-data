// Syncs trailers.json with Rockstar's official YouTube feed: adds new GTA VI trailers, refreshes view counts.
// Usage: node scripts/update-trailers.mjs          (fetches the feed, writes trailers.json if anything changed)
//        node scripts/update-trailers.mjs --check  (offline self-check)
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const FILE = new URL('../trailers.json', import.meta.url);
const FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id=UC6VcWc1rAoWdBCM0JxrRQ3A';

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// Full-length videos only (Shorts are re-cuts of the same trailers).
export function parseFeed(xml) {
  return xml.split('<entry>').slice(1).map((e) => {
    const get = (re) => (e.match(re) || [])[1] ?? '';
    return {
      url: get(/<link rel="alternate" href="([^"]+)"/),
      title: decode(get(/<title>([^<]*)<\/title>/)),
      published: get(/<published>([^<]+)<\/published>/),
      description: decode(get(/<media:description>([\s\S]*?)<\/media:description>/)),
      views: Number(get(/views="(\d+)"/)) || 0,
    };
  }).filter((v) => v.url.includes('/watch?v='));
}

export const formatViews = (n) => (n >= 1e6 ? `${Math.floor(n / 1e6)}M+` : n >= 1e3 ? `${Math.floor(n / 1e3)}K+` : String(n));
const formatDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const slug = (s) => s.toLowerCase().replace(/grand theft auto vi:?/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const firstSentence = (s) => (s.split('\n').map((l) => l.trim()).find((l) => l.length > 40) ?? s).slice(0, 180);

export function mergeTrailers(existing, feed) {
  const byUrl = new Map(feed.map((v) => [v.url, v]));
  const updated = existing.map((t) => {
    const v = byUrl.get(t.url);
    return v?.views ? { ...t, views: formatViews(v.views) } : t;
  });
  const known = new Set(existing.map((t) => t.url));
  const added = feed
    .filter((v) => !known.has(v.url) && /^Grand Theft Auto VI\b/.test(v.title) && /trailer/i.test(v.title))
    .map((v) => ({
      id: slug(v.title) || v.url.split('v=')[1],
      title: v.title.replace(/^Grand Theft Auto VI:?\s*/, ''),
      date: formatDate(v.published),
      description: firstSentence(v.description),
      url: v.url,
      views: formatViews(v.views),
    }));
  return [...added, ...updated];
}

function check() {
  const xml = `<feed><entry><title>Grand Theft Auto VI Trailer 3</title><link rel="alternate" href="https://www.youtube.com/watch?v=new"/>
    <published>2026-11-01T13:00:00+00:00</published><media:description>Short.
This is the long first real sentence of the trailer description text.</media:description><media:statistics views="1234567"/></entry>
    <entry><title>Grand Theft Auto VI Trailer 3</title><link rel="alternate" href="https://www.youtube.com/shorts/new"/></entry>
    <entry><title>GTA Online: Heist Trailer</title><link rel="alternate" href="https://www.youtube.com/watch?v=online"/></entry>
    <entry><title>Grand Theft Auto VI Launch Trailer</title><link rel="alternate" href="https://www.youtube.com/watch?v=old"/><media:statistics views="68720828"/></entry></feed>`;
  const feed = parseFeed(xml);
  assert.equal(feed.length, 3, 'shorts dropped');
  const out = mergeTrailers([{ id: 'launch', title: 'Launch Trailer', url: 'https://www.youtube.com/watch?v=old', views: '24M+' }], feed);
  assert.deepEqual(out.map((t) => t.id), ['trailer-3', 'launch'], 'only new GTA VI trailers added, newest first');
  assert.equal(out[0].date, 'November 1, 2026');
  assert.equal(out[0].views, '1M+');
  assert.match(out[0].description, /^This is the long/);
  assert.equal(out[1].views, '68M+', 'views refreshed');
  assert.equal(mergeTrailers(out, feed).length, 2, 'second run adds nothing');
  console.log('check ok');
}

async function sync() {
  const res = await fetch(FEED);
  if (!res.ok) { console.log(`feed unavailable (${res.status}), trailers unchanged`); return; }
  const existing = JSON.parse(await readFile(FILE, 'utf8'));
  const merged = mergeTrailers(existing, parseFeed(await res.text()));
  const changed = JSON.stringify(merged) !== JSON.stringify(existing);
  console.log(`trailers: ${merged.length - existing.length} added${changed ? ', file updated' : ', no change'}`);
  if (changed) await writeFile(FILE, JSON.stringify(merged, null, 2) + '\n');
}

if (process.argv[2] === '--check') check();
else await sync();
