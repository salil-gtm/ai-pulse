// AI Pulse — New Tab Page Logic

let allItems = [];
let currentFilter = 'all';
let searchQuery = '';

// ========== Settings State ==========

const SETTINGS_DEFAULTS = {
  github_topics: [
    'llm', 'generative-ai', 'machine-learning', 'deep-learning',
    'ai-agents', 'transformers', 'rag', 'large-language-models'
  ],
  anthropic_urls: [
    { url: 'https://www.anthropic.com/news', type: 'html', label: 'Anthropic News' },
    { url: 'https://claude.com/blog', type: 'html', label: 'Claude Blog' },
    { url: 'https://www.anthropic.com/engineering', type: 'html', label: 'Engineering' },
    { url: 'https://www.anthropic.com/research', type: 'html', label: 'Research' },
    { url: 'https://raw.githubusercontent.com/taobojlen/anthropic-rss-feed/main/anthropic_news_rss.xml', type: 'rss', label: 'News RSS' },
    { url: 'https://raw.githubusercontent.com/conoro/anthropic-engineering-rss-feed/main/anthropic_engineering_rss.xml', type: 'rss', label: 'Eng RSS' }
  ],
  openai_urls: [
    { url: 'https://openai.com/news/rss.xml', type: 'rss', label: 'OpenAI News' },
    { url: 'https://developers.openai.com/codex/changelog/rss.xml', type: 'rss', label: 'Codex Changelog' },
    { url: 'https://developers.openai.com/changelog/', type: 'html', label: 'Dev Changelog' },
    { url: 'https://openai.com/news/', type: 'html', label: 'News Page' }
  ],
  custom_rss_feeds: []
};

let settingsState = {
  github_topics: [],
  anthropic_urls: [],
  openai_urls: [],
  custom_rss_feeds: []
};

// ---------- Init ----------

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  bindEvents();
  bindSettingsEvents();
  await loadFeed();
});

// ---------- Event Bindings ----------

function bindEvents() {
  // Tab filters
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      renderFeed();
    });
  });

  // Search
  const searchInput = document.getElementById('searchInput');
  let searchTimeout;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      searchQuery = searchInput.value.trim().toLowerCase();
      renderFeed();
    }, 200);
  });

  // Refresh button
  const refreshBtn = document.getElementById('refreshBtn');
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.classList.add('spinning');
    refreshBtn.disabled = true;
    try {
      await browser.runtime.sendMessage({ action: 'refreshAll' });
      await loadFeed();
    } catch (e) {
      console.error('Refresh failed', e);
    }
    refreshBtn.classList.remove('spinning');
    refreshBtn.disabled = false;
  });

  // Theme toggle
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);

  // Clear all data and re-fetch fresh
  document.getElementById('clearRefreshBtn').addEventListener('click', async () => {
    if (!confirm('Clear all cached data and fetch fresh? This cannot be undone.')) return;

    const btn = document.getElementById('clearRefreshBtn');
    const refreshBtn = document.getElementById('refreshBtn');
    btn.disabled = true;
    refreshBtn.classList.add('spinning');

    try {
      await browser.runtime.sendMessage({ action: 'clearAll' });
      allItems = [];
      renderFeed();
      updateStats();

      // Now re-fetch everything
      await browser.runtime.sendMessage({ action: 'refreshAll' });
      await loadFeed();
    } catch (e) {
      console.error('Clear & refresh failed', e);
      try {
        await AIPulseDB.clearAll();
        allItems = [];
        renderFeed();
      } catch (e2) {}
    }

    btn.disabled = false;
    refreshBtn.classList.remove('spinning');
  });

  // Mark all as read
  document.getElementById('markAllReadBtn').addEventListener('click', async () => {
    try {
      const response = await browser.runtime.sendMessage({ action: 'markAllRead' });
      if (response.success) {
        allItems.forEach(item => item.read = true);
        renderFeed();
        updateStats();
      }
    } catch (e) {
      // Fallback: mark locally
      for (const item of allItems) {
        if (!item.read) {
          item.read = true;
          try { await AIPulseDB.markAsRead(item.id); } catch (e2) {}
        }
      }
      renderFeed();
    }
  });

  // Export saved items as Markdown
  document.getElementById('exportBtn').addEventListener('click', async () => {
    try {
      const response = await browser.runtime.sendMessage({ action: 'exportSaved' });
      if (response.markdown) {
        downloadMarkdown(response.markdown, 'ai-pulse-saved.md');
      }
    } catch (e) {
      console.error('Export failed', e);
    }
  });
}

// ---------- Load Feed ----------

async function loadFeed() {
  try {
    // Try getting items from background script first
    const response = await browser.runtime.sendMessage({ action: 'getItems' });
    allItems = response.items || [];
  } catch (e) {
    // Fallback: read directly from IndexedDB (in case background is slow)
    try {
      allItems = await AIPulseDB.getAllItems();
    } catch (e2) {
      allItems = [];
    }
  }

  // Sort by date descending
  allItems.sort((a, b) => new Date(b.date) - new Date(a.date));

  document.getElementById('loading').classList.add('hidden');
  renderFeed();
  updateStats();
}

// ---------- Render Feed ----------

function renderFeed() {
  const feed = document.getElementById('feed');
  const emptyState = document.getElementById('emptyState');

  // Filter items
  let filtered = allItems;

  if (currentFilter === 'saved') {
    filtered = filtered.filter(item => item.saved);
  } else if (currentFilter !== 'all') {
    filtered = filtered.filter(item => item.source === currentFilter);
  }

  if (searchQuery) {
    filtered = filtered.filter(item =>
      (item.title && item.title.toLowerCase().includes(searchQuery)) ||
      (item.description && item.description.toLowerCase().includes(searchQuery))
    );
  }

  // Clear existing cards (keep loading div)
  feed.querySelectorAll('.card').forEach(c => c.remove());

  if (filtered.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  // Sort: unread first, read at the end
  // Within each group: GitHub by velocity desc, others by date desc
  filtered.sort((a, b) => {
    // Read status first
    const readDiff = (a.read ? 1 : 0) - (b.read ? 1 : 0);
    if (readDiff !== 0) return readDiff;

    // Both GitHub → sort by velocity
    if (a.source === 'github' && b.source === 'github') {
      return (b.metadata?.velocity || 0) - (a.metadata?.velocity || 0);
    }

    // Otherwise by date
    return new Date(b.date) - new Date(a.date);
  });

  // Render cards
  const fragment = document.createDocumentFragment();
  filtered.forEach(item => {
    fragment.appendChild(createCard(item));
  });
  feed.appendChild(fragment);

  updateProgress();
}

// ---------- Create Card ----------

function createCard(item) {
  const card = document.createElement('div');
  card.className = `card${item.read ? ' read' : ''}`;
  card.dataset.id = item.id;

  const sourceLabel = {
    github: 'GitHub',
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    hackernews: 'Hacker News'
  }[item.source] || item.source;

  // Build meta info based on source
  let metaHTML = '';

  if (item.source === 'github') {
    const m = item.metadata || {};
    metaHTML = `
      ${m.topic ? `<span class="tag topic-tag" title="Topic category">${m.topic}</span>` : ''}
      <span title="Stars">★ ${formatNumber(m.stars || 0)}</span>
      ${m.velocity ? `<span title="Stars per day">🔥 ${m.velocity}/day</span>` : ''}
      ${m.language ? `<span class="tag">${m.language}</span>` : ''}
      ${m.forks ? `<span title="Forks">🍴 ${formatNumber(m.forks)}</span>` : ''}
    `;
  } else if (item.source === 'hackernews') {
    const m = item.metadata || {};
    metaHTML = `
      <span title="Points">▲ ${m.points || 0}</span>
      <span title="Comments">💬 ${m.comments || 0}</span>
      ${item.externalUrl ? `<span><a href="${escapeHTML(item.externalUrl)}" target="_blank" class="external-link" onclick="event.stopPropagation()">↗ source</a></span>` : ''}
    `;
  }

  // Tags
  const tags = (item.metadata?.tags || []).slice(0, 3);
  const tagsHTML = tags.map(t => `<span class="tag">${escapeHTML(t)}</span>`).join('');

  card.innerHTML = `
    <div class="card-header">
      <span class="card-source ${item.source}">${sourceLabel}</span>
      <button class="card-save ${item.saved ? 'saved' : ''}" title="Save" data-id="${escapeHTML(item.id)}">
        ${item.saved ? '★' : '☆'}
      </button>
    </div>
    <div class="card-title">
      <a href="${escapeHTML(item.url)}" target="_blank">${escapeHTML(item.title)}</a>
    </div>
    ${item.description ? `<div class="card-description">${escapeHTML(item.description)}</div>` : ''}
    <div class="card-footer">
      <div class="card-meta">
        ${metaHTML}
        ${tagsHTML}
        <span>${timeAgo(item.date)}</span>
      </div>
      <button class="card-read-toggle ${item.read ? 'is-read' : ''}" title="${item.read ? 'Mark unread' : 'Mark as read'}" data-id="${escapeHTML(item.id)}">
        ${item.read ? '↩ unread' : '✓ done'}
      </button>
    </div>
  `;

  // Click on card → open link + mark as read
  card.addEventListener('click', (e) => {
    if (e.target.closest('.card-save') || e.target.closest('.card-read-toggle') || e.target.tagName === 'A') return;
    window.open(item.url, '_blank');
    toggleReadState(item.id, card, true);
  });

  // Read toggle button
  const readToggle = card.querySelector('.card-read-toggle');
  readToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const localItem = allItems.find(i => i.id === item.id);
    const newState = !(localItem?.read);
    toggleReadState(item.id, card, newState);
  });

  // Save button
  const saveBtn = card.querySelector('.card-save');
  saveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSaved(item.id, saveBtn);
  });

  // Mark as read when title link is clicked
  const titleLink = card.querySelector('.card-title a');
  titleLink.addEventListener('click', () => {
    toggleReadState(item.id, card, true);
  });

  return card;
}

// ---------- Actions ----------

async function toggleReadState(itemId, cardEl, readState) {
  // Persist
  try {
    if (readState) {
      await browser.runtime.sendMessage({ action: 'markRead', itemId });
    } else {
      await AIPulseDB.setReadState(itemId, false);
    }
  } catch (e) {
    try { await AIPulseDB.setReadState(itemId, readState); } catch (e2) {}
  }

  // Update local data
  const item = allItems.find(i => i.id === itemId);
  if (item) item.read = readState;

  // Update card appearance
  cardEl.classList.toggle('read', readState);
  const toggle = cardEl.querySelector('.card-read-toggle');
  if (toggle) {
    toggle.classList.toggle('is-read', readState);
    toggle.textContent = readState ? '↩ unread' : '✓ done';
    toggle.title = readState ? 'Mark unread' : 'Mark as read';
  }

  // Animate and reposition
  cardEl.style.transition = 'opacity 0.25s, transform 0.25s';
  cardEl.style.opacity = '0';
  cardEl.style.transform = 'scale(0.97)';

  setTimeout(() => {
    const feed = document.getElementById('feed');
    if (readState) {
      // Move to end (after other read items)
      feed.appendChild(cardEl);
    } else {
      // Move back up — before the first .read card
      const firstRead = feed.querySelector('.card.read');
      if (firstRead && firstRead !== cardEl) {
        feed.insertBefore(cardEl, firstRead);
      } else {
        // No other read cards, just put at the end of unread
        feed.appendChild(cardEl);
      }
    }
    cardEl.style.opacity = '';
    cardEl.style.transform = '';
  }, 250);

  updateProgress();
}

async function toggleSaved(itemId, btnEl) {
  try {
    const response = await browser.runtime.sendMessage({ action: 'toggleSaved', itemId });
    const isSaved = response.saved;
    btnEl.classList.toggle('saved', isSaved);
    btnEl.textContent = isSaved ? '★' : '☆';
    // Update local data
    const item = allItems.find(i => i.id === itemId);
    if (item) item.saved = isSaved;
  } catch (e) {
    try {
      const saved = await AIPulseDB.toggleSaved(itemId);
      btnEl.classList.toggle('saved', saved);
      btnEl.textContent = saved ? '★' : '☆';
    } catch (e2) {}
  }
}

// ---------- Stats ----------

function updateStats() {
  const countEl = document.getElementById('itemCount');
  const sources = {};
  allItems.forEach(item => {
    sources[item.source] = (sources[item.source] || 0) + 1;
  });

  const parts = [];
  if (sources.github) parts.push(`${sources.github} repos`);
  if (sources.anthropic) parts.push(`${sources.anthropic} Anthropic`);
  if (sources.openai) parts.push(`${sources.openai} OpenAI`);
  if (sources.hackernews) parts.push(`${sources.hackernews} HN`);

  const unreadCount = allItems.filter(i => !i.read).length;
  const savedCount = allItems.filter(i => i.saved).length;

  countEl.textContent = allItems.length > 0
    ? `${allItems.length} items (${unreadCount} unread, ${savedCount} saved) — ${parts.join(', ')}`
    : 'No items loaded';

  const refreshEl = document.getElementById('lastRefresh');
  refreshEl.textContent = `Last loaded: ${new Date().toLocaleTimeString()}`;
}

// ---------- Progress Bar ----------

let _prevPct = -1;

// ---- Streak helpers ----

function _todayKey() {
  return new Date().toISOString().split('T')[0]; // "2026-04-11"
}

function _yesterdayKey() {
  return new Date(Date.now() - 86400000).toISOString().split('T')[0];
}

async function _loadStreak() {
  const completedDays = await AIPulseDB.getSetting('streak_days', []);
  const bestStreak   = await AIPulseDB.getSetting('streak_best', 0);
  return { completedDays, bestStreak };
}

function _calcCurrentStreak(days) {
  if (!days.length) return 0;
  const sorted = [...days].sort().reverse(); // newest first
  const today = _todayKey();
  const yesterday = _yesterdayKey();

  // Streak must include today or yesterday to be "active"
  if (sorted[0] !== today && sorted[0] !== yesterday) return 0;

  let streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1] + 'T00:00:00');
    const curr = new Date(sorted[i] + 'T00:00:00');
    const diffDays = (prev - curr) / 86400000;
    if (diffDays === 1) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

async function _recordCompletionToday() {
  const { completedDays, bestStreak } = await _loadStreak();
  const today = _todayKey();

  if (!completedDays.includes(today)) {
    completedDays.push(today);
    // Keep last 365 days max
    if (completedDays.length > 365) completedDays.shift();
    await AIPulseDB.setSetting('streak_days', completedDays);
  }

  const current = _calcCurrentStreak(completedDays);
  if (current > bestStreak) {
    await AIPulseDB.setSetting('streak_best', current);
  }

  return { current, best: Math.max(current, bestStreak), totalDays: completedDays.length };
}

// ---- Progress + streak display ----

async function updateProgress() {
  const total = allItems.length;
  const readCount = allItems.filter(i => i.read).length;
  const pct = total > 0 ? Math.round((readCount / total) * 100) : 0;
  const remaining = total - readCount;

  const fill      = document.getElementById('progressFill');
  const glow      = document.getElementById('progressGlow');
  const pctEl     = document.getElementById('progressPct');
  const msgEl     = document.getElementById('progressStreak');
  const badgeEl   = document.getElementById('streakBadge');
  const detailEl  = document.getElementById('streakDetail');
  const container = document.getElementById('progressContainer');

  if (total === 0) {
    container.classList.add('hidden');
    _prevPct = -1;
    return;
  }

  container.classList.remove('hidden');
  fill.style.width = `${pct}%`;
  pctEl.textContent = `${pct}%`;

  // Gradient tiers
  fill.classList.remove('halfway', 'almost', 'done');
  if (pct === 100) {
    fill.classList.add('done');
    pctEl.style.color = '#22c55e';
  } else if (pct >= 75) {
    fill.classList.add('almost');
    pctEl.style.color = '#10b981';
  } else if (pct >= 40) {
    fill.classList.add('halfway');
    pctEl.style.color = '#6366f1';
  } else {
    pctEl.style.color = '';
  }

  // Leading-edge glow
  glow.classList.toggle('active', pct > 0 && pct < 100);

  // Record streak when 100% hit
  let streakInfo = null;
  if (pct === 100) {
    streakInfo = await _recordCompletionToday();
  } else {
    // Just load current streak for display
    const { completedDays, bestStreak } = await _loadStreak();
    const current = _calcCurrentStreak(completedDays);
    streakInfo = { current, best: Math.max(current, bestStreak), totalDays: completedDays.length };
  }

  // Streak badge — always visible
  badgeEl.classList.remove('fire', 'blaze');
  if (streakInfo.current >= 14) {
    badgeEl.textContent = `\uD83D\uDD25 ${streakInfo.current} days`;
    badgeEl.classList.add('blaze');
  } else if (streakInfo.current >= 5) {
    badgeEl.textContent = `\uD83D\uDD25 ${streakInfo.current} days`;
    badgeEl.classList.add('fire');
  } else if (streakInfo.current > 0) {
    badgeEl.textContent = `\uD83D\uDD25 ${streakInfo.current} day${streakInfo.current > 1 ? 's' : ''}`;
  } else {
    badgeEl.textContent = `\u26A1 0 days`;
  }

  // Streak detail line — always visible
  const detailParts = [];
  if (streakInfo.best > 0 && streakInfo.best > streakInfo.current) {
    detailParts.push(`best: ${streakInfo.best}d`);
  }
  if (streakInfo.totalDays > 0) {
    detailParts.push(`${streakInfo.totalDays} day${streakInfo.totalDays > 1 ? 's' : ''} completed`);
  } else {
    detailParts.push('finish all items to start your streak');
  }
  detailEl.textContent = detailParts.join(' · ');

  // Motivational messages — streak-aware
  if (pct === 0) {
    if (streakInfo.current > 0) {
      msgEl.textContent = `${total} items — keep your ${streakInfo.current}-day streak alive!`;
    } else {
      msgEl.textContent = `${total} items to catch up on — start a streak today`;
    }
  } else if (pct === 100) {
    if (streakInfo.current >= 7) {
      msgEl.textContent = `On fire! ${streakInfo.current}-day streak`;
    } else if (streakInfo.current > 1) {
      msgEl.textContent = `All caught up! ${streakInfo.current} days in a row`;
    } else {
      msgEl.textContent = 'All caught up — day 1 of a new streak!';
    }
  } else if (remaining === 1) {
    msgEl.textContent = 'Just 1 left — finish it!';
  } else if (pct >= 80) {
    msgEl.textContent = `Almost there — ${remaining} to go`;
  } else if (pct >= 50) {
    msgEl.textContent = `Over halfway — ${remaining} remaining`;
  } else if (pct >= 25) {
    msgEl.textContent = `Good pace — ${remaining} left`;
  } else {
    msgEl.textContent = `${readCount} down, ${remaining} to go`;
  }

  // Confetti on 100%
  if (pct === 100 && _prevPct < 100 && _prevPct >= 0) {
    spawnConfetti(container);
  }

  _prevPct = pct;
}

function spawnConfetti(container) {
  const colors = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
  const track = container.querySelector('.progress-track');
  const rect = track.getBoundingClientRect();
  const parentRect = container.getBoundingClientRect();

  for (let i = 0; i < 24; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.left = `${rect.left - parentRect.left + rect.width * Math.random()}px`;
    piece.style.top = `${rect.top - parentRect.top}px`;
    piece.style.width = `${4 + Math.random() * 5}px`;
    piece.style.height = `${4 + Math.random() * 5}px`;
    piece.style.animationDuration = `${0.8 + Math.random() * 0.8}s`;
    piece.style.animationDelay = `${Math.random() * 0.3}s`;
    container.style.position = 'relative';
    container.appendChild(piece);
    setTimeout(() => piece.remove(), 2000);
  }
}

// ---------- Theme ----------

function initTheme() {
  const saved = localStorage.getItem('ai-pulse-theme');
  if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.getElementById('themeToggle').textContent = '☀️';
  }
}

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    document.getElementById('themeToggle').textContent = '🌙';
    localStorage.setItem('ai-pulse-theme', 'light');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.getElementById('themeToggle').textContent = '☀️';
    localStorage.setItem('ai-pulse-theme', 'dark');
  }
}

// ---------- Helpers ----------

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function formatNumber(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function escapeHTML(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function downloadMarkdown(content, filename) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ========================================================================
// SETTINGS PANEL
// ========================================================================

function bindSettingsEvents() {
  // Open / close
  document.getElementById('settingsToggle').addEventListener('click', openSettings);
  document.getElementById('settingsClose').addEventListener('click', closeSettings);
  document.getElementById('settingsOverlay').addEventListener('click', closeSettings);

  // Save
  document.getElementById('sp-save').addEventListener('click', saveSettingsPanel);

  // Add buttons
  document.getElementById('sp-github-topic-add').addEventListener('click', () => {
    const input = document.getElementById('sp-github-topic-input');
    const val = input.value.trim().toLowerCase().replace(/\s+/g, '-');
    if (val && !settingsState.github_topics.includes(val)) {
      settingsState.github_topics.push(val);
      renderSettingsList('sp-github-topics', settingsState.github_topics, 'topic');
      input.value = '';
    }
  });

  document.getElementById('sp-anthropic-url-add').addEventListener('click', () => {
    const input = document.getElementById('sp-anthropic-url-input');
    const type = document.getElementById('sp-anthropic-type').value;
    const url = input.value.trim();
    if (url && !settingsState.anthropic_urls.some(u => u.url === url)) {
      const label = url.replace(/https?:\/\//, '').split('/').slice(0, 2).join('/');
      settingsState.anthropic_urls.push({ url, type, label });
      renderSettingsList('sp-anthropic-urls', settingsState.anthropic_urls, 'url');
      input.value = '';
    }
  });

  document.getElementById('sp-openai-url-add').addEventListener('click', () => {
    const input = document.getElementById('sp-openai-url-input');
    const type = document.getElementById('sp-openai-type').value;
    const url = input.value.trim();
    if (url && !settingsState.openai_urls.some(u => u.url === url)) {
      const label = url.replace(/https?:\/\//, '').split('/').slice(0, 2).join('/');
      settingsState.openai_urls.push({ url, type, label });
      renderSettingsList('sp-openai-urls', settingsState.openai_urls, 'url');
      input.value = '';
    }
  });

  document.getElementById('sp-custom-rss-add').addEventListener('click', () => {
    const input = document.getElementById('sp-custom-rss-input');
    const url = input.value.trim();
    if (url && !settingsState.custom_rss_feeds.some(u => u.url === url)) {
      const label = url.replace(/https?:\/\//, '').split('/')[0];
      settingsState.custom_rss_feeds.push({ url, type: 'rss', label });
      renderSettingsList('sp-custom-rss', settingsState.custom_rss_feeds, 'url');
      input.value = '';
    }
  });

  // Enter key support on all add inputs
  ['sp-github-topic-input', 'sp-anthropic-url-input', 'sp-openai-url-input', 'sp-custom-rss-input'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById(id.replace('-input', '-add')).click();
      }
    });
  });
}

async function openSettings() {
  // Load current settings from DB
  settingsState.github_topics = await AIPulseDB.getSetting('github_topics', SETTINGS_DEFAULTS.github_topics);
  settingsState.anthropic_urls = await AIPulseDB.getSetting('anthropic_urls', SETTINGS_DEFAULTS.anthropic_urls);
  settingsState.openai_urls = await AIPulseDB.getSetting('openai_urls', SETTINGS_DEFAULTS.openai_urls);
  settingsState.custom_rss_feeds = await AIPulseDB.getSetting('custom_rss_feeds', SETTINGS_DEFAULTS.custom_rss_feeds);

  // Simple fields
  document.getElementById('sp-src-github').checked = await AIPulseDB.getSetting('sources_github', true);
  document.getElementById('sp-src-anthropic').checked = await AIPulseDB.getSetting('sources_anthropic', true);
  document.getElementById('sp-src-openai').checked = await AIPulseDB.getSetting('sources_openai', true);
  document.getElementById('sp-src-hackernews').checked = await AIPulseDB.getSetting('sources_hackernews', true);
  document.getElementById('sp-github-token').value = await AIPulseDB.getSetting('github_token', '');
  document.getElementById('sp-github-per-topic').value = await AIPulseDB.getSetting('github_per_topic', 3);
  document.getElementById('sp-github-window').value = await AIPulseDB.getSetting('github_window_days', 4);
  document.getElementById('sp-anthropic-max').value = await AIPulseDB.getSetting('anthropic_max', 3);
  document.getElementById('sp-openai-max').value = await AIPulseDB.getSetting('openai_max', 3);
  document.getElementById('sp-hn-keywords').value = await AIPulseDB.getSetting('hn_keywords', '');
  document.getElementById('sp-hn-top-popular').value = await AIPulseDB.getSetting('hn_top_popular', 20);
  document.getElementById('sp-hn-max').value = await AIPulseDB.getSetting('hn_max', 3);
  document.getElementById('sp-notifications-enabled').checked = await AIPulseDB.getSetting('notifications_enabled', true);
  document.getElementById('sp-retention-days').value = await AIPulseDB.getSetting('retention_days', 30);

  // Render lists
  renderSettingsList('sp-github-topics', settingsState.github_topics, 'topic');
  renderSettingsList('sp-anthropic-urls', settingsState.anthropic_urls, 'url');
  renderSettingsList('sp-openai-urls', settingsState.openai_urls, 'url');
  renderSettingsList('sp-custom-rss', settingsState.custom_rss_feeds, 'url');

  // Show panel
  document.getElementById('settingsPanel').classList.remove('hidden');
  document.getElementById('settingsOverlay').classList.remove('hidden');
}

function closeSettings() {
  document.getElementById('settingsPanel').classList.add('hidden');
  document.getElementById('settingsOverlay').classList.add('hidden');
}

async function saveSettingsPanel() {
  // Save simple fields
  await AIPulseDB.setSetting('sources_github', document.getElementById('sp-src-github').checked);
  await AIPulseDB.setSetting('sources_anthropic', document.getElementById('sp-src-anthropic').checked);
  await AIPulseDB.setSetting('sources_openai', document.getElementById('sp-src-openai').checked);
  await AIPulseDB.setSetting('sources_hackernews', document.getElementById('sp-src-hackernews').checked);
  await AIPulseDB.setSetting('github_token', document.getElementById('sp-github-token').value);
  await AIPulseDB.setSetting('github_per_topic', parseInt(document.getElementById('sp-github-per-topic').value, 10));
  await AIPulseDB.setSetting('github_window_days', parseInt(document.getElementById('sp-github-window').value, 10));
  await AIPulseDB.setSetting('anthropic_max', parseInt(document.getElementById('sp-anthropic-max').value, 10));
  await AIPulseDB.setSetting('openai_max', parseInt(document.getElementById('sp-openai-max').value, 10));
  await AIPulseDB.setSetting('hn_keywords', document.getElementById('sp-hn-keywords').value);
  await AIPulseDB.setSetting('hn_top_popular', parseInt(document.getElementById('sp-hn-top-popular').value, 10));
  await AIPulseDB.setSetting('hn_max', parseInt(document.getElementById('sp-hn-max').value, 10));
  await AIPulseDB.setSetting('notifications_enabled', document.getElementById('sp-notifications-enabled').checked);
  await AIPulseDB.setSetting('retention_days', parseInt(document.getElementById('sp-retention-days').value, 10));

  // Save resource lists
  await AIPulseDB.setSetting('github_topics', settingsState.github_topics);
  await AIPulseDB.setSetting('anthropic_urls', settingsState.anthropic_urls);
  await AIPulseDB.setSetting('openai_urls', settingsState.openai_urls);
  await AIPulseDB.setSetting('custom_rss_feeds', settingsState.custom_rss_feeds);

  // Show status
  const status = document.getElementById('sp-status');
  status.classList.remove('hidden');
  setTimeout(() => status.classList.add('hidden'), 2000);
}

function renderSettingsList(listId, items, mode) {
  const ul = document.getElementById(listId);
  ul.innerHTML = '';

  items.forEach((item, idx) => {
    const li = document.createElement('li');
    li.className = 'sp-list-item';

    if (mode === 'topic') {
      li.innerHTML = `
        <span class="sp-item-type sp-type-api">API</span>
        <span class="sp-item-url">topic:${escapeHTML(item)}</span>
        <button class="sp-remove-btn" data-idx="${idx}">×</button>
      `;
    } else {
      const obj = typeof item === 'string' ? { url: item, type: 'rss', label: '' } : item;
      const typeClass = obj.type === 'rss' ? 'sp-type-rss' : 'sp-type-html';
      li.innerHTML = `
        ${obj.label ? `<span class="sp-item-label">${escapeHTML(obj.label)}</span>` : ''}
        <span class="sp-item-type ${typeClass}">${escapeHTML(obj.type).toUpperCase()}</span>
        <span class="sp-item-url" title="${escapeHTML(obj.url)}">${escapeHTML(obj.url)}</span>
        <button class="sp-remove-btn" data-idx="${idx}">×</button>
      `;
    }

    ul.appendChild(li);
  });

  // Bind remove
  ul.querySelectorAll('.sp-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      if (listId === 'sp-github-topics') {
        settingsState.github_topics.splice(idx, 1);
        renderSettingsList(listId, settingsState.github_topics, 'topic');
      } else if (listId === 'sp-anthropic-urls') {
        settingsState.anthropic_urls.splice(idx, 1);
        renderSettingsList(listId, settingsState.anthropic_urls, 'url');
      } else if (listId === 'sp-openai-urls') {
        settingsState.openai_urls.splice(idx, 1);
        renderSettingsList(listId, settingsState.openai_urls, 'url');
      } else if (listId === 'sp-custom-rss') {
        settingsState.custom_rss_feeds.splice(idx, 1);
        renderSettingsList(listId, settingsState.custom_rss_feeds, 'url');
      }
    });
  });
}
