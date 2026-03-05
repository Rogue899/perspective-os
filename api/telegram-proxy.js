/**
 * /api/telegram-proxy?channel=CHANNELNAME
 *
 * Fetches the public Telegram channel web view (t.me/s/CHANNELNAME)
 * and extracts the latest posts as a JSON array.
 *
 * No API key required. Only works for PUBLIC channels.
 * Returns: { posts: [{ id, text, date, views, url }] }
 *
 * Allowed channels are allowlisted below to prevent abuse.
 */

export const config = { runtime: 'edge' };

const ALLOWED_CHANNELS = [
  // OSINT
  'intelcrab', 'GeoConfirmed', 'OSINTdefender',
  // Ukraine war
  'nexta_tv', 'wartranslated', 'militaryland_net', 'UkraineNow',
  // Russian perspective (for framing comparison)
  'rybar',
  // MENA
  'alarabiya_breaking', 'AJArabic',
  // General news
  'bbcnews', 'reutersagency',
];

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const channel = searchParams.get('channel')?.replace(/[^a-zA-Z0-9_]/g, '');

  if (!channel) {
    return json({ error: 'Missing channel param' }, 400);
  }

  const normalized = ALLOWED_CHANNELS.find(c => c.toLowerCase() === channel.toLowerCase());
  if (!normalized) {
    return json({ error: `Channel not in allowlist: ${channel}` }, 403);
  }

  try {
    const url = `https://t.me/s/${normalized}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PerspectiveOS/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      cf: { cacheTtl: 120, cacheEverything: true },
    });

    if (!res.ok) {
      return json({ error: `Upstream ${res.status}` }, 502);
    }

    const html = await res.text();
    const posts = parseChannelHtml(html, normalized);

    return json({ channel: normalized, posts }, 200);
  } catch (err) {
    return json({ error: String(err) }, 502);
  }
}

/**
 * Parse Telegram's web view HTML for post content.
 * The structure: .tgme_widget_message_wrap > .tgme_widget_message
 * Each post has: data-post="CHANNEL/ID", .tgme_widget_message_text, .tgme_widget_message_date time
 */
function parseChannelHtml(html, channel) {
  const posts = [];

  // Match message blocks
  const msgPattern = /data-post="[^"]+\/(\d+)"[^>]*>[\s\S]*?class="tgme_widget_message[^"]*"[\s\S]*?<\/div>\s*<\/div>/g;

  // Simpler approach: extract key fields with targeted regex
  const textPattern = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  const datePattern = /<time datetime="([^"]+)"[^>]*>/g;
  const idPattern = /data-post="[^\/]+\/(\d+)"/g;
  const viewPattern = /class="tgme_widget_message_views"[^>]*>([\d.,KkMm]+)</g;

  const texts = [];
  const dates = [];
  const ids = [];
  const views = [];

  let m;
  while ((m = textPattern.exec(html)) !== null) texts.push(stripHtml(m[1]));
  while ((m = datePattern.exec(html)) !== null) dates.push(m[1]);
  while ((m = idPattern.exec(html)) !== null) ids.push(m[1]);
  while ((m = viewPattern.exec(html)) !== null) views.push(m[1]);

  const count = Math.min(texts.length, dates.length, ids.length, 20);
  for (let i = 0; i < count; i++) {
    const text = texts[i]?.trim();
    if (!text || text.length < 10) continue;
    posts.push({
      id: ids[i] ?? String(i),
      text: text.slice(0, 500),
      date: dates[i] ?? new Date().toISOString(),
      views: views[i] ?? '0',
      url: `https://t.me/${channel}/${ids[i] ?? ''}`,
    });
  }

  // Return newest first
  return posts.reverse().slice(0, 15);
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{3,}/g, '\n\n')
    .trim();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': status === 200 ? 'public, s-maxage=120' : 'no-store',
    },
  });
}
