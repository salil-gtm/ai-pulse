# ⚡ AI Pulse

A Firefox new-tab extension that aggregates AI/ML content into a single dashboard.

<img width="1121" height="965" alt="Screenshot 2026-04-11 at 11 16 35 AM" src="https://github.com/user-attachments/assets/e8ef1b48-c540-4766-b15e-8014c188019d" />

## Demo

https://youtu.be/ghECyLx3EIQ

## Sources

- **GitHub** — Top trending AI/ML repos by velocity (stars/day), searched across configurable topic categories (llm, generative-ai, transformers, etc.) with a 4-day rolling window. Top 3 per topic, final top 5 by velocity.
- **Anthropic & Claude** — Scraped from anthropic.com/news, claude.com/blog, engineering, and research pages, plus community RSS feeds. Top 3 by recency.
- **OpenAI & Codex** — RSS feeds (news, codex changelog) plus HTML scraping of developer changelog and news pages. Top 3 by recency.
- **Hacker News** — Firebase API, filters by AI/ML keywords. Top 20 by points, then top 3 by recency.

## Features

- New-tab dashboard with cards for each item
- Dark/light theme toggle
- Read/unread toggle per card with animated reordering
- Save items and export saved as Markdown
- Progress bar with animated gradient fill, motivational messages, and confetti on 100%
- Day streak tracking — consecutive days of completing all items, with best-streak memory
- Desktop notifications for high-signal items (HN 500+ pts, GitHub 1000+ stars, new Anthropic/OpenAI posts)
- Unread badge count on the extension icon
- Configurable settings panel (gear icon) — add/remove topics, URLs, adjust thresholds
- Optional GitHub PAT support for higher API rate limits
- All data stored locally in IndexedDB — no external accounts, no tracking

## Install

1. Clone this repo
2. Open Firefox and go to `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on"
4. Select `manifest.json` from the cloned folder
5. Open a new tab


## Configuration

Click the gear icon on the new-tab page to access settings:

- **GitHub**: Add/remove topic categories, set repos-per-topic count, window size in days, optional PAT
- **Anthropic & OpenAI**: Add/remove scrape URLs and RSS feeds, set max results
- **Hacker News**: Configure keyword filters, popularity threshold, max results
- **General**: Toggle notifications, set data retention period

## Privacy

AI Pulse runs entirely in your browser. No data is sent to any server. All fetched content is stored locally in IndexedDB and never leaves your machine. The only network requests are to the public APIs and websites listed as sources.

## License

MIT
