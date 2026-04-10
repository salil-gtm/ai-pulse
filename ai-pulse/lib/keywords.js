// AI/ML keywords for filtering Hacker News and scoring relevance
const AI_KEYWORDS = [
  'ai', 'ml', 'llm', 'gpt', 'claude', 'anthropic', 'openai', 'chatgpt',
  'transformer', 'diffusion', 'neural', 'deep learning', 'machine learning',
  'rag', 'fine-tune', 'fine-tuning', 'hugging face', 'huggingface',
  'langchain', 'langgraph', 'agent', 'ai agent', 'codex', 'gemini',
  'mistral', 'llama', 'stable diffusion', 'midjourney', 'copilot',
  'embedding', 'vector', 'tokenizer', 'lora', 'qlora', 'rlhf',
  'reasoning', 'chain of thought', 'mcp', 'tool use', 'function calling',
  'multimodal', 'vision model', 'text-to-image', 'text-to-speech',
  'foundation model', 'large language model', 'small language model',
  'inference', 'quantization', 'distillation', 'mlops', 'model context protocol'
];

const GITHUB_TOPICS = [
  'machine-learning', 'deep-learning', 'llm', 'large-language-models',
  'generative-ai', 'transformers', 'ai-agents', 'rag',
  'fine-tuning', 'mlops', 'natural-language-processing',
  'computer-vision', 'reinforcement-learning', 'diffusion-models'
];

function matchesAIKeywords(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return AI_KEYWORDS.some(kw => lower.includes(kw));
}
