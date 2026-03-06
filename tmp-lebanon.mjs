(async () => {
  // Check feeds known to cover Lebanon: AlJazeera, BBC, MEE, RT, TASS
  const feeds = [
    ['AlJazeera', 'http://localhost:3001/api/rss-proxy?url=https://www.aljazeera.com/xml/rss/all.xml'],
    ['BBC',       'http://localhost:3001/api/rss-proxy?url=https://feeds.bbci.co.uk/news/world/rss.xml'],
    ['MEE',       'http://localhost:3001/api/rss-proxy?url=https://www.middleeasteye.net/rss'],
    ['RT',        'http://localhost:3001/api/rss-proxy?url=https://www.rt.com/rss/'],
    ['TheHindu',  'http://localhost:3001/api/rss-proxy?url=https://www.thehindu.com/feeder/default.rss'],
    ['Guardian',  'http://localhost:3001/api/rss-proxy?url=https://www.theguardian.com/world/rss'],
  ];
  const keyword = /lebanon|beirut|hezbollah/i;
  
  for (const [name, url] of feeds) {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const xml = await r.text();
    // Extract all titles
    const titles = [...xml.matchAll(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/gs)]
      .map(m => m[1].replace(/<[^>]+>/g,'').trim())
      .filter(t => t && !t.includes('CDATA') && t.length > 5);
    const leb = titles.filter(t => keyword.test(t));
    console.log(`\n[${name}] Lebanon stories (${leb.length}/${titles.length}):`);
    leb.forEach(t => console.log(`  - ${t.slice(0, 100)}`));
    if (!leb.length) console.log(`  (none matching 'lebanon|beirut|hezbollah')`);
  }
})();
