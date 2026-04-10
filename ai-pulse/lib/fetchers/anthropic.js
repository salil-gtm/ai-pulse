// Anthropic & Claude Blog Fetcher
// Covers ALL Anthropic sources:
//   1. anthropic.com/news         — main announcements (HTML scrape)
//   2. claude.com/blog             — Claude product blog (HTML scrape)
//   3. anthropic.com/engineering   — engineering blog (HTML scrape)
//   4. anthropic.com/research      — research papers & posts (HTML scrape)
//   5. Community RSS feeds         — fallback aggregated RSS

const AnthropicFetcher = {
  SOURCE: 'anthropic',

  // All Anthropic sources to scrape
  SOURCES: [
    {
      name: 'Anthropic News',
      url: 'https://www.anthropic.com/news',
      linkSelector: 'a[href*="/news/"]',
      excludeHrefs: ['/news', '/news/'],
      baseUrl: 'https://www.anthropic.com',
      tags: ['anthropic', 'announcements']
    },
    {
      name: 'Claude Blog',
      url: 'https://claude.com/blog',
      linkSelector: 'a[href*="/blog/"]',
      excludeHrefs: ['/blog', '/blog/'],
      baseUrl: 'https://claude.com',
      tags: ['claude', 'product']
    },
    {
      name: 'Anthropic Engineering',
      url: 'https://www.anthropic.com/engineering',
      linkSelector: 'a[href*="/engineering/"]',
      excludeHrefs: ['/engineering', '/engineering/'],
      baseUrl: 'https://www.anthropic.com',
      tags: ['anthropic', 'engineering']
    },
    {
      name: 'Anthropic Research',
      url: 'https://www.anthropic.com/research',
      linkSelector: 'a[href*="/research/"]',
      excludeHrefs: ['/research', '/research/'],
      baseUrl: 'https://www.anthropic.com',
      tags: ['anthropic', 'research']
    }
  ],

  // Community-maintained RSS feeds as fallback
  RSS_FEEDS: [
    {
      name: 'Anthropic News RSS',
      url: 'https://raw.githubusercontent.com/taobojlen/anthropic-rss-feed/main/anthropic_news_rss.xml',
      tags: ['anthropic', 'announcements']
    },
    {
      name: 'Anthropic Engineering RSS',
      url: 'https://raw.githubusercontent.com/conoro/anthropic-engineering-rss-feed/main/anthropic_engineering_rss.xml',
      tags: ['anthropic', 'engineering']
    }
  ],

  async fetch() {
    // Load configured URLs from settings
    const configuredUrls = await AIPulseDB.getSetting('anthropic_urls', null);
    const maxResults = await AIPulseDB.getSetting('anthropic_max', 3);

    const allItems = [];

    if (configuredUrls && Array.isArray(configuredUrls)) {
      // Use user-configured URLs
      const htmlSources = configuredUrls.filter(u => u.type === 'html');
      const rssFeeds = configuredUrls.filter(u => u.type === 'rss');

      // Scrape HTML sources
      const scrapePromises = htmlSources.map(source => this._scrapeSource({
        name: source.label || source.url,
        url: source.url,
        linkSelector: 'a[href*="/news/"], a[href*="/blog/"], a[href*="/engineering/"], a[href*="/research/"]',
        excludeHrefs: ['/', '#'],
        baseUrl: new URL(source.url).origin,
        tags: ['anthropic']
      }));

      const scrapeResults = await Promise.allSettled(scrapePromises);
      scrapeResults.forEach(r => { if (r.status === 'fulfilled') allItems.push(...r.value); });

      // Fetch RSS feeds
      const rssPromises = rssFeeds.map(feed => this._fetchRSS({
        name: feed.label || feed.url,
        url: feed.url,
        tags: ['anthropic']
      }));

      const rssResults = await Promise.allSettled(rssPromises);
      rssResults.forEach(r => { if (r.status === 'fulfilled') allItems.push(...r.value); });

    } else {
      // Fallback: use hardcoded sources
      const scrapePromises = this.SOURCES.map(source => this._scrapeSource(source));
      const scrapeResults = await Promise.allSettled(scrapePromises);
      scrapeResults.forEach(r => { if (r.status === 'fulfilled') allItems.push(...r.value); });

      if (allItems.length < 5) {
        const rssPromises = this.RSS_FEEDS.map(feed => this._fetchRSS(feed));
        const rssResults = await Promise.allSettled(rssPromises);
        rssResults.forEach(r => { if (r.status === 'fulfilled') allItems.push(...r.value); });
      }
    }

    // Deduplicate by URL
    const seen = new Set();
    const unique = allItems.filter(item => {
      const key = item.url.replace(/\/$/, '').toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by date descending → take top N most recent
    unique.sort((a, b) => new Date(b.date) - new Date(a.date));
    const topN = unique.slice(0, maxResults);

    console.log(`AI Pulse Anthropic: ${unique.length} total posts → top ${maxResults} by recency`);
    return topN;
  },

  // ---------- HTML Scraper ----------

  async _scrapeSource(source) {
    try {
      const response = await fetch(source.url);
      if (!response.ok) {
        console.warn(`AI Pulse Anthropic: ${source.name} returned ${response.status}`);
        return [];
      }

      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const items = [];
      const articleLinks = doc.querySelectorAll(source.linkSelector);
      const seen = new Set();

      articleLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (!href || source.excludeHrefs.includes(href) || seen.has(href)) return;
        seen.add(href);

        const title = this._extractTitle(link);
        if (!title || title.length < 5) return;

        const description = this._extractDescription(link);
        const date = this._extractDate(link);
        const fullUrl = href.startsWith('http') ? href : `${source.baseUrl}${href}`;

        items.push({
          id: `anthropic-${href.replace(/[^a-z0-9]/gi, '-')}`,
          source: 'anthropic',
          title: title.trim(),
          description: description,
          summary: extractSummary(description, 2),
          url: fullUrl,
          date: date || new Date().toISOString(),
          fetchedAt: new Date().toISOString(),
          metadata: {
            tags: [...source.tags],
            subSource: source.name
          },
          read: false,
          saved: false
        });
      });

      console.log(`AI Pulse Anthropic: ${source.name} → ${items.length} posts`);
      return items;
    } catch (error) {
      console.error(`AI Pulse Anthropic: ${source.name} failed`, error);
      return [];
    }
  },

  // ---------- RSS Fallback ----------

  async _fetchRSS(feed) {
    try {
      const response = await fetch(feed.url);
      if (!response.ok) return [];

      const xml = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, 'application/xml');

      if (doc.querySelector('parsererror')) return [];

      const items = [];
      const rssItems = doc.querySelectorAll('item');

      rssItems.forEach(rssItem => {
        const title = rssItem.querySelector('title')?.textContent?.trim() || '';
        const link = rssItem.querySelector('link')?.textContent?.trim() || '';
        const description = rssItem.querySelector('description')?.textContent?.trim() || '';
        const pubDate = rssItem.querySelector('pubDate')?.textContent?.trim() || '';

        if (!title || !link) return;

        const cleanDesc = description.replace(/<[^>]*>/g, '').trim();

        items.push({
          id: `anthropic-${link.replace(/[^a-z0-9]/gi, '-').substring(0, 80)}`,
          source: 'anthropic',
          title: title,
          description: cleanDesc,
          summary: extractSummary(cleanDesc, 2),
          url: link,
          date: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
          fetchedAt: new Date().toISOString(),
          metadata: {
            tags: [...feed.tags],
            subSource: feed.name
          },
          read: false,
          saved: false
        });
      });

      console.log(`AI Pulse Anthropic RSS: ${feed.name} → ${items.length} posts`);
      return items;
    } catch (error) {
      console.error(`AI Pulse Anthropic RSS: ${feed.name} failed`, error);
      return [];
    }
  },

  // ---------- Extraction Helpers ----------

  _extractTitle(linkEl) {
    const heading = linkEl.querySelector('h1, h2, h3, h4, h5, h6');
    if (heading) return heading.textContent.trim();

    const titleEl = linkEl.querySelector('[class*="title"], [class*="heading"], [class*="name"]');
    if (titleEl) return titleEl.textContent.trim();

    const text = linkEl.textContent.trim();
    const firstLine = text.split('\n')[0].trim();
    return firstLine.length > 120 ? firstLine.substring(0, 120) + '...' : firstLine;
  },

  _extractDescription(linkEl) {
    const desc = linkEl.querySelector('p, [class*="desc"], [class*="excerpt"], [class*="summary"], [class*="snippet"]');
    if (desc) return desc.textContent.trim();

    const parent = linkEl.closest('article, [class*="card"], [class*="post"], [class*="item"]') || linkEl.parentElement;
    if (parent) {
      const siblingP = parent.querySelector('p');
      if (siblingP) return siblingP.textContent.trim();
    }

    return '';
  },

  _extractDate(linkEl) {
    const timeEl = linkEl.querySelector('time') || linkEl.parentElement?.querySelector('time');
    if (timeEl) return timeEl.getAttribute('datetime') || timeEl.textContent.trim();

    const parent = linkEl.closest('article, [class*="card"], [class*="post"], [class*="item"]') || linkEl.parentElement;
    if (parent) {
      const dateEl = parent.querySelector('[class*="date"], [class*="time"], [class*="published"]');
      if (dateEl) return dateEl.textContent.trim();
    }

    return null;
  }
};
