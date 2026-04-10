// OpenAI & Codex Blog Fetcher
// Covers ALL OpenAI sources:
//   1. openai.com/news/rss.xml                    — main blog/news RSS
//   2. developers.openai.com/codex/changelog/rss.xml — Codex changelog RSS
//   3. developers.openai.com/changelog/            — Developer changelog (HTML scrape)
//   4. openai.com/news/                            — HTML scrape fallback

const OpenAIFetcher = {
  SOURCE: 'openai',

  // RSS feeds (preferred — structured data)
  RSS_FEEDS: [
    {
      name: 'OpenAI News',
      url: 'https://openai.com/news/rss.xml',
      tags: ['openai', 'announcements']
    },
    {
      name: 'Codex Changelog',
      url: 'https://developers.openai.com/codex/changelog/rss.xml',
      tags: ['openai', 'codex', 'changelog']
    }
  ],

  // HTML scrape sources (fallback + additional coverage)
  HTML_SOURCES: [
    {
      name: 'OpenAI Developer Changelog',
      url: 'https://developers.openai.com/changelog/',
      linkSelector: 'a[href*="/changelog/"]',
      excludePatterns: ['/changelog/$', '/changelog$', '/changelog/rss'],
      baseUrl: 'https://developers.openai.com',
      tags: ['openai', 'developer', 'changelog']
    },
    {
      name: 'OpenAI News Page',
      url: 'https://openai.com/news/',
      linkSelector: 'a[href*="/index/"], a[href*="/news/"]',
      excludePatterns: ['/news/$', '/news$', '/news/rss'],
      baseUrl: 'https://openai.com',
      tags: ['openai', 'announcements']
    }
  ],

  async fetch() {
    // Load configured URLs from settings
    const configuredUrls = await AIPulseDB.getSetting('openai_urls', null);
    const maxResults = await AIPulseDB.getSetting('openai_max', 3);

    const allItems = [];

    if (configuredUrls && Array.isArray(configuredUrls)) {
      // Use user-configured URLs
      const rssFeeds = configuredUrls.filter(u => u.type === 'rss');
      const htmlSources = configuredUrls.filter(u => u.type === 'html');

      const rssPromises = rssFeeds.map(feed => this._fetchRSS({
        name: feed.label || feed.url,
        url: feed.url,
        tags: ['openai']
      }));

      const htmlPromises = htmlSources.map(source => this._scrapeSource({
        name: source.label || source.url,
        url: source.url,
        linkSelector: 'a[href*="/index/"], a[href*="/news/"], a[href*="/changelog/"], a[href*="/codex/"]',
        excludePatterns: ['/$', '/rss'],
        baseUrl: new URL(source.url).origin,
        tags: ['openai']
      }));

      const [rssResults, htmlResults] = await Promise.all([
        Promise.allSettled(rssPromises),
        Promise.allSettled(htmlPromises)
      ]);

      rssResults.forEach(r => { if (r.status === 'fulfilled') allItems.push(...r.value); });
      htmlResults.forEach(r => { if (r.status === 'fulfilled') allItems.push(...r.value); });

    } else {
      // Fallback: use hardcoded sources
      const rssPromises = this.RSS_FEEDS.map(feed => this._fetchRSS(feed));
      const rssResults = await Promise.allSettled(rssPromises);
      rssResults.forEach(r => { if (r.status === 'fulfilled') allItems.push(...r.value); });

      const htmlPromises = this.HTML_SOURCES.map(source => this._scrapeSource(source));
      const htmlResults = await Promise.allSettled(htmlPromises);
      htmlResults.forEach(r => { if (r.status === 'fulfilled') allItems.push(...r.value); });
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

    console.log(`AI Pulse OpenAI: ${unique.length} total posts → top ${maxResults} by recency`);
    return topN;
  },

  // ---------- RSS Fetcher ----------

  async _fetchRSS(feed) {
    try {
      const response = await fetch(feed.url);
      if (!response.ok) {
        console.warn(`AI Pulse OpenAI RSS: ${feed.name} returned ${response.status}`);
        return [];
      }

      const xml = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, 'application/xml');

      if (doc.querySelector('parsererror')) {
        console.error(`AI Pulse OpenAI RSS: ${feed.name} parse error`);
        return [];
      }

      const rssItems = doc.querySelectorAll('item');
      const items = [];

      rssItems.forEach(rssItem => {
        const title = rssItem.querySelector('title')?.textContent?.trim() || '';
        const link = rssItem.querySelector('link')?.textContent?.trim() || '';
        const description = rssItem.querySelector('description')?.textContent?.trim() || '';
        const pubDate = rssItem.querySelector('pubDate')?.textContent?.trim() || '';

        if (!title || !link) return;

        const cleanDesc = description.replace(/<[^>]*>/g, '').trim();

        // Auto-tag Codex-related items
        const tags = [...feed.tags];
        const lowerTitle = title.toLowerCase();
        if (lowerTitle.includes('codex') && !tags.includes('codex')) {
          tags.push('codex');
        }
        if (lowerTitle.includes('gpt') && !tags.includes('gpt')) {
          tags.push('gpt');
        }

        items.push({
          id: `openai-${link.replace(/[^a-z0-9]/gi, '-').substring(0, 80)}`,
          source: 'openai',
          title: title,
          description: cleanDesc,
          summary: extractSummary(cleanDesc, 2),
          url: link,
          date: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
          fetchedAt: new Date().toISOString(),
          metadata: {
            tags: tags,
            subSource: feed.name
          },
          read: false,
          saved: false
        });
      });

      console.log(`AI Pulse OpenAI RSS: ${feed.name} → ${items.length} posts`);
      return items;
    } catch (error) {
      console.error(`AI Pulse OpenAI RSS: ${feed.name} failed`, error);
      return [];
    }
  },

  // ---------- HTML Scraper ----------

  async _scrapeSource(source) {
    try {
      const response = await fetch(source.url);
      if (!response.ok) {
        console.warn(`AI Pulse OpenAI HTML: ${source.name} returned ${response.status}`);
        return [];
      }

      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const items = [];
      const links = doc.querySelectorAll(source.linkSelector);
      const seen = new Set();

      links.forEach(link => {
        const href = link.getAttribute('href');
        if (!href || seen.has(href)) return;

        // Check exclude patterns
        const shouldExclude = source.excludePatterns.some(pattern =>
          new RegExp(pattern).test(href)
        );
        if (shouldExclude) return;
        seen.add(href);

        // Extract content
        const title = this._extractTitle(link);
        if (!title || title.length < 5) return;

        const description = this._extractDescription(link);
        const date = this._extractDate(link);
        const fullUrl = href.startsWith('http') ? href : `${source.baseUrl}${href}`;

        // Auto-tag
        const tags = [...source.tags];
        const lowerTitle = title.toLowerCase();
        if (lowerTitle.includes('codex')) tags.push('codex');
        if (lowerTitle.includes('gpt')) tags.push('gpt');
        if (lowerTitle.includes('dall')) tags.push('dall-e');
        if (lowerTitle.includes('sora')) tags.push('sora');
        if (lowerTitle.includes('whisper')) tags.push('whisper');

        items.push({
          id: `openai-${href.replace(/[^a-z0-9]/gi, '-').substring(0, 80)}`,
          source: 'openai',
          title: title.trim(),
          description: description,
          summary: extractSummary(description, 2),
          url: fullUrl,
          date: date || new Date().toISOString(),
          fetchedAt: new Date().toISOString(),
          metadata: {
            tags: [...new Set(tags)], // dedupe tags
            subSource: source.name
          },
          read: false,
          saved: false
        });
      });

      console.log(`AI Pulse OpenAI HTML: ${source.name} → ${items.length} posts`);
      return items;
    } catch (error) {
      console.error(`AI Pulse OpenAI HTML: ${source.name} failed`, error);
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
    const desc = linkEl.querySelector('p, [class*="desc"], [class*="excerpt"], [class*="summary"]');
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
