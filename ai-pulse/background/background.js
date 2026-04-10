// AI Pulse — Background Script (v2)
// Manages periodic fetching, badge count, notifications, and export

const FETCHERS = {
  github: { fetcher: GitHubFetcher, intervalMinutes: 360 },      // 6 hours
  anthropic: { fetcher: AnthropicFetcher, intervalMinutes: 240 }, // 4 hours
  openai: { fetcher: OpenAIFetcher, intervalMinutes: 240 },      // 4 hours
  hackernews: { fetcher: HackerNewsFetcher, intervalMinutes: 120 } // 2 hours
};

// Notification thresholds
const HN_NOTIFY_POINTS = 500;
const GITHUB_NOTIFY_STARS = 1000;

// ---------- Alarm-based scheduling ----------

function setupAlarms() {
  for (const [name, config] of Object.entries(FETCHERS)) {
    browser.alarms.create(`fetch-${name}`, {
      periodInMinutes: config.intervalMinutes
    });
  }
  // Badge update every 30 minutes
  browser.alarms.create('update-badge', { periodInMinutes: 30 });
  console.log('AI Pulse: Alarms set up');
}

browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'update-badge') {
    await updateBadge();
    return;
  }

  const sourceName = alarm.name.replace('fetch-', '');
  if (FETCHERS[sourceName]) {
    await fetchSource(sourceName);
  }
});

// ---------- Badge Count ----------

async function updateBadge() {
  try {
    const items = await AIPulseDB.getAllItems();
    const unreadCount = items.filter(item => !item.read).length;

    if (unreadCount > 0) {
      const text = unreadCount > 99 ? '99+' : String(unreadCount);
      browser.browserAction.setBadgeText({ text });
      browser.browserAction.setBadgeBackgroundColor({ color: '#007aff' });
    } else {
      browser.browserAction.setBadgeText({ text: '' });
    }
  } catch (e) {
    console.error('AI Pulse: Badge update error', e);
  }
}

// ---------- Notifications for high-signal items ----------

async function checkAndNotify(newItems) {
  const notificationsEnabled = await AIPulseDB.getSetting('notifications_enabled', true);
  if (!notificationsEnabled) return;

  for (const item of newItems) {
    let shouldNotify = false;
    let message = '';

    if (item.source === 'hackernews' && item.metadata?.points >= HN_NOTIFY_POINTS) {
      shouldNotify = true;
      message = `🔥 ${item.metadata.points} points on HN`;
    } else if (item.source === 'github' && item.metadata?.stars >= GITHUB_NOTIFY_STARS && item.metadata?.velocity >= 100) {
      shouldNotify = true;
      message = `⭐ ${item.metadata.stars} stars, ${item.metadata.velocity}/day velocity`;
    } else if (item.source === 'anthropic' || item.source === 'openai') {
      // Always notify for new blog posts from Anthropic/OpenAI (they're infrequent)
      shouldNotify = true;
      const label = item.source === 'anthropic' ? 'Anthropic' : 'OpenAI';
      message = `📝 New ${label} post`;
    }

    if (shouldNotify) {
      try {
        browser.notifications.create(item.id, {
          type: 'basic',
          iconUrl: 'icons/icon-96.svg',
          title: `AI Pulse: ${message}`,
          message: item.title
        });
      } catch (e) {
        console.warn('AI Pulse: Notification failed', e);
      }
    }
  }
}

// Open item URL when notification is clicked
browser.notifications.onClicked.addListener(async (notificationId) => {
  try {
    const items = await AIPulseDB.getAllItems();
    const item = items.find(i => i.id === notificationId);
    if (item) {
      browser.tabs.create({ url: item.url });
      await AIPulseDB.markAsRead(item.id);
      await updateBadge();
    }
  } catch (e) {
    console.error('AI Pulse: Notification click error', e);
  }
});

// ---------- Fetch a single source ----------

async function fetchSource(sourceName) {
  const config = FETCHERS[sourceName];
  if (!config) return;

  console.log(`AI Pulse: Fetching ${sourceName}...`);
  try {
    const items = await config.fetcher.fetch();

    if (items.length > 0) {
      // Preserve read/saved state for existing items
      const existing = await AIPulseDB.getItemsBySource(sourceName);
      const existingMap = new Map(existing.map(e => [e.id, e]));

      const newItems = []; // truly new items (not seen before)

      const merged = items.map(item => {
        const prev = existingMap.get(item.id);
        if (prev) {
          item.read = prev.read;
          item.saved = prev.saved;
        } else {
          newItems.push(item);
        }
        return item;
      });

      await AIPulseDB.addItems(merged);
      await AIPulseDB.setLastFetch(sourceName);

      // Notify for high-signal new items
      if (newItems.length > 0) {
        await checkAndNotify(newItems);
      }

      // Update badge
      await updateBadge();

      console.log(`AI Pulse: Stored ${merged.length} items for ${sourceName} (${newItems.length} new)`);
    }
  } catch (error) {
    console.error(`AI Pulse: Error fetching ${sourceName}`, error);
  }
}

// ---------- Fetch all sources ----------

async function fetchAllSources() {
  console.log('AI Pulse: Fetching all sources...');

  // Purge old items first
  try {
    const retentionDays = await AIPulseDB.getSetting('retention_days', 30);
    await AIPulseDB.purgeOlderThan(retentionDays);
  } catch (e) {
    console.error('AI Pulse: Purge error', e);
  }

  // Fetch all sources in parallel
  const promises = Object.keys(FETCHERS).map(name => fetchSource(name));
  await Promise.allSettled(promises);

  await updateBadge();
  console.log('AI Pulse: All sources fetched');
}

// ---------- Export saved items as Markdown ----------

function exportSavedAsMarkdown(items) {
  const saved = items.filter(i => i.saved);
  if (saved.length === 0) return '# AI Pulse — Saved Items\n\nNo saved items yet.';

  // Group by source
  const groups = {};
  saved.forEach(item => {
    if (!groups[item.source]) groups[item.source] = [];
    groups[item.source].push(item);
  });

  const sourceLabels = {
    github: 'GitHub',
    anthropic: 'Anthropic & Claude',
    openai: 'OpenAI & Codex',
    hackernews: 'Hacker News'
  };

  let md = `# AI Pulse — Saved Items\n\n`;
  md += `*Exported on ${new Date().toLocaleDateString()}*\n\n`;

  for (const [source, sourceItems] of Object.entries(groups)) {
    md += `## ${sourceLabels[source] || source}\n\n`;

    sourceItems.forEach(item => {
      md += `### [${item.title}](${item.url})\n`;
      if (item.description) {
        md += `${item.description}\n`;
      }

      const meta = [];
      if (item.metadata?.stars) meta.push(`⭐ ${item.metadata.stars}`);
      if (item.metadata?.velocity) meta.push(`🔥 ${item.metadata.velocity}/day`);
      if (item.metadata?.points) meta.push(`▲ ${item.metadata.points}`);
      if (item.metadata?.comments) meta.push(`💬 ${item.metadata.comments}`);
      if (item.metadata?.language) meta.push(item.metadata.language);
      if (item.metadata?.subSource) meta.push(`via ${item.metadata.subSource}`);
      if (item.date) meta.push(new Date(item.date).toLocaleDateString());

      if (meta.length > 0) {
        md += `\n${meta.join(' · ')}\n`;
      }
      md += `\n---\n\n`;
    });
  }

  return md;
}

// ---------- Message handling ----------

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'refreshAll') {
    fetchAllSources().then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.action === 'refreshSource') {
    fetchSource(message.source).then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.action === 'getItems') {
    AIPulseDB.getAllItems().then(items => sendResponse({ items }));
    return true;
  }

  if (message.action === 'markRead') {
    AIPulseDB.markAsRead(message.itemId)
      .then(() => updateBadge())
      .then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.action === 'toggleSaved') {
    AIPulseDB.toggleSaved(message.itemId).then(saved => sendResponse({ saved }));
    return true;
  }

  if (message.action === 'getLastFetch') {
    AIPulseDB.getLastFetch(message.source).then(ts => sendResponse({ timestamp: ts }));
    return true;
  }

  if (message.action === 'exportSaved') {
    AIPulseDB.getAllItems().then(items => {
      const markdown = exportSavedAsMarkdown(items);
      sendResponse({ markdown });
    });
    return true;
  }

  if (message.action === 'clearAll') {
    AIPulseDB.clearAll()
      .then(() => updateBadge())
      .then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.action === 'markAllRead') {
    AIPulseDB.getAllItems().then(async (items) => {
      const unread = items.filter(i => !i.read);
      for (const item of unread) {
        await AIPulseDB.markAsRead(item.id);
      }
      await updateBadge();
      sendResponse({ success: true, count: unread.length });
    });
    return true;
  }
});

// ---------- Browser action click → open new tab ----------

browser.browserAction.onClicked.addListener(() => {
  browser.tabs.create({ url: 'newtab/newtab.html' });
});

// ---------- Initial fetch on install / startup ----------

browser.runtime.onInstalled.addListener(() => {
  console.log('AI Pulse: Extension installed');
  setupAlarms();
  fetchAllSources();
});

browser.runtime.onStartup.addListener(() => {
  console.log('AI Pulse: Browser started');
  setupAlarms();
  AIPulseDB.getLastFetch('hackernews').then(ts => {
    if (!ts || (Date.now() - new Date(ts).getTime()) > 60 * 60 * 1000) {
      fetchAllSources();
    } else {
      updateBadge(); // At least update badge on startup
    }
  });
});
