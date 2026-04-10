// Hacker News Fetcher — Firebase API + AI/ML keyword filter

const HackerNewsFetcher = {
  SOURCE: 'hackernews',
  BASE_URL: 'https://hacker-news.firebaseio.com/v0',
  BATCH_SIZE: 10,       // concurrent fetches per batch
  MAX_STORIES: 200,     // how many top stories to scan

  async fetch() {
    try {
      // Load configurable limits from settings
      const topPopular = await AIPulseDB.getSetting('hn_top_popular', 20);
      const maxResults = await AIPulseDB.getSetting('hn_max', 3);

      // 1. Get top story IDs
      const response = await fetch(`${this.BASE_URL}/topstories.json`);
      if (!response.ok) {
        console.error('AI Pulse HN: Failed to fetch top stories');
        return [];
      }

      const storyIds = await response.json();
      const idsToFetch = storyIds.slice(0, this.MAX_STORIES);

      // 2. Batch-fetch story details
      const stories = await this._batchFetch(idsToFetch);

      // 3. Filter by AI/ML keywords
      const aiStories = stories.filter(story =>
        story && story.title && matchesAIKeywords(story.title)
      );

      // 4. Normalize
      const items = aiStories.map(story => ({
        id: `hn-${story.id}`,
        source: 'hackernews',
        title: story.title,
        description: story.url ? `Link: ${story.url}` : 'Ask HN / Show HN',
        summary: story.title, // HN titles are already concise
        url: `https://news.ycombinator.com/item?id=${story.id}`,
        externalUrl: story.url || null,
        date: new Date(story.time * 1000).toISOString(),
        fetchedAt: new Date().toISOString(),
        metadata: {
          points: story.score || 0,
          comments: story.descendants || 0,
          author: story.by || '',
          tags: []
        },
        read: false,
        saved: false
      }));

      // Step 1: Sort by points descending → take top N most popular
      items.sort((a, b) => b.metadata.points - a.metadata.points);
      const topByPopularity = items.slice(0, topPopular);

      // Step 2: From those, sort by timestamp descending → take top M most recent
      topByPopularity.sort((a, b) => new Date(b.date) - new Date(a.date));
      const topByRecency = topByPopularity.slice(0, maxResults);

      console.log(`AI Pulse HN: ${items.length} AI/ML stories → top ${topPopular} by points → top ${maxResults} by recency`);
      return topByRecency;
    } catch (error) {
      console.error('AI Pulse HN: Fetch failed', error);
      return [];
    }
  },

  async _batchFetch(ids) {
    const results = [];

    for (let i = 0; i < ids.length; i += this.BATCH_SIZE) {
      const batch = ids.slice(i, i + this.BATCH_SIZE);
      const promises = batch.map(id =>
        fetch(`${this.BASE_URL}/item/${id}.json`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      );

      const batchResults = await Promise.all(promises);
      results.push(...batchResults.filter(Boolean));
    }

    return results;
  }
};
