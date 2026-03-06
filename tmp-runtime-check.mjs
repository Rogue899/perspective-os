const checks = [
  ['BBC', 'http://localhost:3001/api/rss-proxy?url=https://feeds.bbci.co.uk/news/world/rss.xml'],
  ['RedditLeb', 'http://localhost:3001/api/rss-proxy?url=https://www.reddit.com/r/lebanon/new/.rss'],
  ['TuckerX', 'http://localhost:3001/api/rss-proxy?url=https://nitter.net/TuckerCarlson/rss'],
  ['MTVLeb', 'http://localhost:3001/api/rss-proxy?url=https://www.mtv.com.lb/RSS'],
];

for (const [name, url] of checks) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
    const t = await r.text();
    const items = (t.match(/<item>/g) || t.match(/<entry>/g) || []).length;
    console.log(`${name}: ${r.status} (${items} items)`);
  } catch (e) {
    console.log(`${name}: FAIL (${e.message})`);
  }
}

try {
  const aiRes = await fetch('http://localhost:3001/api/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'Return JSON: {"ok":true}', tier: 'flash-lite', maxTokens: 20 }),
    signal: AbortSignal.timeout(20000),
  });
  const ai = await aiRes.json();
  console.log(`AI: ${aiRes.status} provider=${ai.provider || 'none'} text=${String(ai.text || '').slice(0, 40)}`);
} catch (e) {
  console.log(`AI: FAIL (${e.message})`);
}
