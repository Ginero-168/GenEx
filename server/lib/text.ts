const trademarkTerms = [
  "nike",
  "adidas",
  "apple logo",
  "coca-cola",
  "coke",
  "disney",
  "marvel",
  "starbucks",
  "mcdonald",
  "tesla",
  "pokemon",
  "lego",
  "barbie"
];

const sensitiveTerms = [
  "blood",
  "gore",
  "nudity",
  "explicit",
  "weapon",
  "drug",
  "hate symbol"
];

const peopleTerms = [
  "person",
  "people",
  "portrait",
  "face",
  "model",
  "child",
  "baby",
  "crowd",
  "celebrity",
  "famous"
];

export function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function sentenceCase(value: string): string {
  const cleaned = compactWhitespace(value.toLowerCase());
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function findMatches(text: string, terms: string[]): string[] {
  const haystack = text.toLowerCase();
  return terms.filter((term) => haystack.includes(term));
}

export function detectPromptRisks(prompt: string) {
  return {
    trademarks: findMatches(prompt, trademarkTerms),
    sensitive: findMatches(prompt, sensitiveTerms),
    people: findMatches(prompt, peopleTerms)
  };
}

export function sanitizeForStock(prompt: string): string {
  let sanitized = compactWhitespace(prompt);
  for (const term of trademarkTerms) {
    const pattern = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig");
    sanitized = sanitized.replace(pattern, "generic unbranded product");
  }
  return compactWhitespace(sanitized);
}

export function extractKeywords(prompt: string): string[] {
  const stopWords = new Set([
    "with",
    "from",
    "that",
    "this",
    "into",
    "และ",
    "ของ",
    "ที่",
    "ใน",
    "ให้",
    "เป็น",
    "สำหรับ",
    "the",
    "and",
    "for",
    "image",
    "photo"
  ]);

  const terms = prompt
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word));

  return Array.from(new Set(terms)).slice(0, 18);
}

export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
