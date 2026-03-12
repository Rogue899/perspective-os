import fs from 'node:fs';

const txt = fs.readFileSync('src/config/sources.ts','utf8');
const idMatches = [...txt.matchAll(/id:\s*'([^']+)'[\s\S]*?rss:\s*'([^']+)'/g)];
const entries = idMatches.map(m => ({ id: m[1], rss: m[2] }));

const base = 'http://127.0.0.1:3001';
const out = [];
for (const e of entries) {
  const url = e.rss.startsWith('/api/') ? base + e.rss : e.rss;
  try {
    const r = await fetch(url, { redirect: 'follow' });
    const text = await r.text();
    const low = text.toLowerCase();
    const looksXml = low.includes('<rss') || low.includes('<feed') || low.includes('<?xml');
    const isErrorJson = text.trim().startsWith('{') && low.includes('"error"');
    const ok = r.ok && looksXml && !isErrorJson;
    out.push({ id: e.id, status: r.status, ok, len: text.length, sample: text.slice(0, 120).replace(/\s+/g,' ') });
  } catch (err) {
    out.push({ id: e.id, status: 0, ok: false, len: 0, sample: String(err) });
  }
  await new Promise(r => setTimeout(r, 100));
}

const bad = out.filter(x => !x.ok);
console.log('TOTAL', out.length, 'BAD', bad.length);
for (const b of bad) console.log(`${b.id}\tstatus=${b.status}\tlen=${b.len}\t${b.sample}`);
