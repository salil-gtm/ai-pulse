// Extractive summarization — no API keys needed
// Uses simple sentence extraction from article text

function extractSummary(text, maxSentences = 3) {
  if (!text || text.trim().length === 0) {
    return '';
  }

  // Clean up whitespace
  const cleaned = text.replace(/\s+/g, ' ').trim();

  // Split into sentences (handles Mr., Dr., etc. reasonably)
  const sentences = cleaned.match(/[^.!?]+[.!?]+[\s]*/g) || [];

  if (sentences.length === 0) {
    // No proper sentences found, return first 200 chars
    return cleaned.substring(0, 200) + (cleaned.length > 200 ? '...' : '');
  }

  // Take first N sentences, trim each
  return sentences
    .slice(0, maxSentences)
    .map(s => s.trim())
    .join(' ');
}

function extractTextFromHTML(htmlString) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');

    // Remove scripts, styles, nav, footer, header
    const removeSelectors = ['script', 'style', 'nav', 'footer', 'header', 'aside', 'iframe'];
    removeSelectors.forEach(sel => {
      doc.querySelectorAll(sel).forEach(el => el.remove());
    });

    // Try to find main content area
    const mainContent = doc.querySelector('article') ||
                        doc.querySelector('main') ||
                        doc.querySelector('[role="main"]') ||
                        doc.querySelector('.post-content') ||
                        doc.querySelector('.article-content') ||
                        doc.querySelector('.entry-content') ||
                        doc.body;

    if (!mainContent) return '';

    return mainContent.textContent || '';
  } catch (e) {
    console.error('AI Pulse: Error extracting text from HTML', e);
    return '';
  }
}
