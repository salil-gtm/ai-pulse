// GitHub Trending AI/ML Repos — Search API with proper URL construction
// Uses one small query per topic (avoids query length limits)
// Returns top N per topic sorted by velocity (stars/day)

const GitHubFetcher = {
  SOURCE: 'github',

  // Default topics (overridden by settings)
  DEFAULT_TOPICS: [
    'llm', 'generative-ai', 'machine-learning', 'deep-learning',
    'ai-agents', 'transformers', 'rag', 'large-language-models'
  ],

  async fetch() {
    // Load configured topics and settings
    const topics = await AIPulseDB.getSetting('github_topics', this.DEFAULT_TOPICS);
    this._topics = topics;
    this._perTopic = await AIPulseDB.getSetting('github_per_topic', 3);
    this._windowDays = await AIPulseDB.getSetting('github_window_days', 4);

    let topicResults = {};

    // --- Strategy 1: GitHub Search API (one call per topic) ---
    console.log('AI Pulse GitHub: Fetching via Search API...');
    topicResults = await this._fetchAllTopics();

    // If API returned nothing (rate-limited / no token), log it — no noisy fallback
    const hasResults = Object.values(topicResults).some(arr => arr.length > 0);
    if (!hasResults) {
      console.warn('AI Pulse GitHub: Search API returned no results. Add a GitHub PAT in settings to avoid rate limits.');
      return [];
    }

    // For each topic: deduplicate, sort by velocity, take top N
    const finalItems = [];
    const globalSeen = new Set(); // prevent same repo appearing under multiple topics

    for (const [topic, items] of Object.entries(topicResults)) {
      // Sort by velocity descending
      items.sort((a, b) => (b.metadata?.velocity || 0) - (a.metadata?.velocity || 0));

      let count = 0;
      for (const item of items) {
        if (count >= this._perTopic) break;
        const key = item.url.toLowerCase();
        if (globalSeen.has(key)) continue;
        globalSeen.add(key);

        // Tag the item with its topic category
        item.metadata.topic = topic;
        finalItems.push(item);
        count++;
      }
    }

    // Final cut: sort all collected repos by velocity, keep top 5
    finalItems.sort((a, b) => (b.metadata?.velocity || 0) - (a.metadata?.velocity || 0));
    const topN = finalItems.slice(0, 5);

    console.log(`AI Pulse GitHub: ${topN.length} repos (top 5 by velocity from ${finalItems.length} candidates across ${Object.keys(topicResults).length} topics)`);
    return topN;
  },

  // ========== Strategy 1: Search API ==========

  async _fetchAllTopics() {
    const token = await AIPulseDB.getSetting('github_token', '');
    const headers = { 'Accept': 'application/vnd.github.v3+json' };
    if (token) headers['Authorization'] = `token ${token}`;

    // Configurable window (default 4 days)
    const since = new Date(Date.now() - this._windowDays * 86400000).toISOString().split('T')[0];
    const topicResults = {}; // { topic: [items] }
    let rateLimited = false;

    for (const topic of this._topics) {
      if (rateLimited) break;
      topicResults[topic] = [];

      try {
        // Use URL + URLSearchParams for correct encoding
        const url = new URL('https://api.github.com/search/repositories');
        url.searchParams.set('q', `topic:${topic} pushed:>${since} stars:>50`);
        url.searchParams.set('sort', 'stars');
        url.searchParams.set('order', 'desc');
        url.searchParams.set('per_page', '15');

        console.log(`AI Pulse GitHub: Fetching topic:${topic} (${this._windowDays}-day window)...`);
        const response = await fetch(url.toString(), { headers });

        if (response.status === 403 || response.status === 429) {
          console.warn(`AI Pulse GitHub: Rate limited at topic:${topic}`);
          rateLimited = true;
          break;
        }

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          console.error(`AI Pulse GitHub: ${response.status} for topic:${topic}`, errorText.substring(0, 200));
          continue;
        }

        const data = await response.json();
        console.log(`AI Pulse GitHub: topic:${topic} → ${data.total_count || 0} total, got ${(data.items || []).length}`);

        const items = (data.items || []).map(repo => this._normalizeRepo(repo));
        topicResults[topic] = items;

        // 2s delay between calls to stay well within rate limits
        await new Promise(r => setTimeout(r, 2000));

      } catch (error) {
        console.error(`AI Pulse GitHub: Failed for topic:${topic}`, error.message || error);
      }
    }

    const totalCount = Object.values(topicResults).reduce((sum, arr) => sum + arr.length, 0);
    console.log(`AI Pulse GitHub: Search API total: ${totalCount} repos across ${this._topics.length} topics`);
    return topicResults;
  },

  _normalizeRepo(repo) {
    const daysSinceCreation = Math.max(1,
      (Date.now() - new Date(repo.created_at).getTime()) / 86400000
    );
    const velocity = Math.round(repo.stargazers_count / daysSinceCreation);

    return {
      id: `github-${repo.id}`,
      source: 'github',
      title: repo.full_name,
      description: repo.description || 'No description available.',
      summary: extractSummary(repo.description || '', 2),
      url: repo.html_url,
      date: repo.pushed_at,
      fetchedAt: new Date().toISOString(),
      metadata: {
        stars: repo.stargazers_count,
        velocity: velocity,
        language: repo.language,
        forks: repo.forks_count,
        tags: repo.topics || []
      },
      read: false,
      saved: false
    };
  }
};
