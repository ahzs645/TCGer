// ---------------------------------------------------------------------------
// RSS/News Feed Aggregator
// ---------------------------------------------------------------------------

interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  tcg?: string;
  snippet?: string;
}

// Default RSS feeds per TCG
const DEFAULT_FEEDS: Record<string, string[]> = {
  magic: [
    'https://magic.wizards.com/en/rss/rss.xml'
  ],
  pokemon: [
    'https://www.pokemon.com/us/pokemon-news/rss'
  ],
  yugioh: [
    'https://www.yugioh-card.com/en/news/rss.xml'
  ]
};

// In-memory cache for news items
let newsCache: NewsItem[] = [];
let lastFetched = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export async function getNews(tcg?: string): Promise<NewsItem[]> {
  if (Date.now() - lastFetched > CACHE_TTL) {
    await refreshNews();
  }

  if (tcg) {
    return newsCache.filter(n => n.tcg === tcg);
  }
  return newsCache;
}

export async function refreshNews(): Promise<void> {
  const items: NewsItem[] = [];

  for (const [tcg, feeds] of Object.entries(DEFAULT_FEEDS)) {
    for (const feedUrl of feeds) {
      try {
        const res = await fetch(feedUrl);
        if (!res.ok) continue;
        const xml = await res.text();

        // Simple XML parsing for RSS items
        const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
        for (const match of itemMatches) {
          const itemXml = match[1];
          const title = itemXml.match(/<title><!\[CDATA\[(.*?)\]\]>|<title>(.*?)<\/title>/)?.[1] || itemXml.match(/<title>(.*?)<\/title>/)?.[1] || '';
          const link = itemXml.match(/<link>(.*?)<\/link>/)?.[1] || '';
          const pubDate = itemXml.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
          const description = itemXml.match(/<description><!\[CDATA\[(.*?)\]\]>|<description>(.*?)<\/description>/)?.[1] || '';

          if (title) {
            items.push({
              title: title.trim(),
              link: link.trim(),
              pubDate: pubDate || new Date().toISOString(),
              source: feedUrl,
              tcg,
              snippet: description.substring(0, 200).trim()
            });
          }
        }
      } catch (err) {
        console.error(`[news] Failed to fetch feed ${feedUrl}:`, err);
      }
    }
  }

  newsCache = items.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()).slice(0, 100);
  lastFetched = Date.now();
}
