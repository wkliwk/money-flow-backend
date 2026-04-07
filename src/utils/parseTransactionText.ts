/**
 * Natural-language parser for quick expense entry.
 *
 * Ported from money-flow-mobile/lib/parse-quick-expense.ts and enhanced
 * with participant detection, date parsing, split-bill support, and
 * Cantonese/Chinese patterns.
 */

export interface ParsedTransaction {
  merchant?: string;
  amount?: number;
  currency?: string;
  category?: string;
  subcategory?: string;
  participants?: string[];
  date?: string;
  notes?: string;
  confidence?: number;
  missing_fields?: string[];
}

// ── Category keyword map ────────────────────────────────────────────────

const CATEGORY_KEYWORDS: Record<string, readonly string[]> = {
  food: [
    'food', 'restaurant', 'dinner', 'lunch', 'breakfast', 'cafe', 'coffee',
    'pizza', 'burger', 'sushi', 'grocery', 'groceries', 'supermarket', 'market',
    'starbucks', 'mcdonald', 'kfc', 'subway', 'snack', 'milk', 'tea', 'ramen',
    'noodle', 'rice', 'bread', 'bakery', 'eat', 'meal', 'brunch',
    // Cantonese food keywords
    '食', '飲', '餐', '茶', '麥當勞', '咖啡', '奶茶', '飯', '麵',
  ],
  transport: [
    'transport', 'uber', 'taxi', 'gas', 'petrol', 'bus', 'metro', 'mtr',
    'parking', 'fuel', 'grab', 'lyft', 'train', 'flight',
    '車', '巴士', '的士', '地鐵', '港鐵',
  ],
  shopping: [
    'shopping', 'clothes', 'fashion', 'dress', 'shoes', 'clothing', 'amazon',
    'shirt', 'pants',
    '買', '衫',
  ],
  entertainment: [
    'entertainment', 'movie', 'cinema', 'game', 'show', 'concert', 'netflix',
    'gaming', 'spotify', 'museum', 'tickets',
    '戲', '電影',
  ],
  bills: [
    'bill', 'bills', 'utilities', 'electricity', 'water', 'internet', 'phone',
    'utility', 'rent', 'insurance', 'subscription',
    '租', '水電', '電話',
  ],
  health: [
    'health', 'doctor', 'pharmacy', 'medicine', 'gym', 'medical', 'dental',
    'hospital',
    '醫', '藥',
  ],
  education: [
    'education', 'school', 'course', 'book', 'tuition', 'class', 'textbook',
    'udemy', 'coursera',
    '書', '學',
  ],
};

// ── Currency maps ───────────────────────────────────────────────────────

const CURRENCY_CODES: Record<string, string> = {
  cny: 'CNY', rmb: 'CNY', jpy: 'JPY', yen: 'JPY',
  usd: 'USD', eur: 'EUR', gbp: 'GBP', twd: 'TWD',
  thb: 'THB', krw: 'KRW', cad: 'CAD', hkd: 'HKD',
};

const CURRENCY_SYMBOL_PREFIXES: Record<string, string> = {
  '\u00a5': 'CNY', '\uffe5': 'CNY', '\u20ac': 'EUR',
  '\u00a3': 'GBP', '\u20a9': 'KRW',
};

// ── Date helpers ────────────────────────────────────────────────────────

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const DATE_KEYWORDS: Record<string, () => string> = {
  today: () => toISODate(new Date()),
  yesterday: () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return toISODate(d);
  },
  '今日': () => toISODate(new Date()),
  '今天': () => toISODate(new Date()),
  '昨日': () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return toISODate(d);
  },
  '昨天': () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return toISODate(d);
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────

function suggestCategory(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return category;
    }
  }
  return undefined;
}

function extractParticipants(text: string): { participants: string[]; cleaned: string } {
  const participants: string[] = [];
  let cleaned = text;

  // English: "with Casey", "with Casey and Bob"
  const withPattern = /\bwith\s+([A-Z][a-z]+(?:\s+and\s+[A-Z][a-z]+)*)/g;
  let match = withPattern.exec(cleaned);
  while (match) {
    const names = match[1].split(/\s+and\s+/i);
    participants.push(...names.map((n) => n.trim()));
    cleaned = cleaned.replace(match[0], '');
    match = withPattern.exec(cleaned);
  }

  // Cantonese: "同Casey" or "同Casey同Bob"
  const cantoneseWithPattern = /同([A-Z][a-z]+)/g;
  let cantMatch = cantoneseWithPattern.exec(cleaned);
  while (cantMatch) {
    participants.push(cantMatch[1]);
    cleaned = cleaned.replace(cantMatch[0], '');
    cantMatch = cantoneseWithPattern.exec(cleaned);
  }

  return { participants: [...new Set(participants)], cleaned: cleaned.trim() };
}

function extractDate(text: string): { date: string | undefined; cleaned: string } {
  let cleaned = text;
  let date: string | undefined;

  // Check keyword dates
  for (const [keyword, fn] of Object.entries(DATE_KEYWORDS)) {
    if (cleaned.toLowerCase().includes(keyword.toLowerCase())) {
      cleaned = cleaned.replace(new RegExp(keyword, 'i'), '').trim();
      date = fn();
      break;
    }
  }

  // Always strip time patterns like "12:00"
  cleaned = cleaned.replace(/\b\d{1,2}:\d{2}\b/, '').trim();

  return { date, cleaned };
}

function extractSplitBill(text: string): { splitBill: boolean; cleaned: string } {
  const patterns = [/\beach\b/i, /\bper\s+person\b/i, /\bsplit\b/i, /\bAA\b/, /每人/];
  for (const pat of patterns) {
    if (pat.test(text)) {
      return { splitBill: true, cleaned: text.replace(pat, '').trim() };
    }
  }
  return { splitBill: false, cleaned: text };
}

function extractAmount(text: string): { amount: number | undefined; currency: string | undefined; cleaned: string } {
  let cleaned = text;
  let currency: string | undefined;

  // Check symbol-prefixed amounts (e.g., "EUR50", "GBP12")
  for (const [sym, cur] of Object.entries(CURRENCY_SYMBOL_PREFIXES)) {
    const escaped = sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`${escaped}(\\d+\\.?\\d*)`);
    const m = cleaned.match(regex);
    if (m) {
      currency = cur;
      cleaned = cleaned.replace(regex, m[1]);
      break;
    }
  }

  // $-prefixed amounts
  const dollarMatch = cleaned.match(/\$(\d+\.?\d*)/);
  if (dollarMatch) {
    cleaned = cleaned.replace(/\$\d+\.?\d*/, dollarMatch[1]);
  }

  // Find amount — first numeric token
  const parts = cleaned.split(/\s+/);
  let amount: number | undefined;
  const remaining: string[] = [];

  for (const part of parts) {
    const num = parseFloat(part);
    if (!isNaN(num) && num >= 0 && amount === undefined) {
      amount = num;
      // Check if the next-ish word is a currency code
    } else {
      // Check for currency code
      const curCode = CURRENCY_CODES[part.toLowerCase()];
      if (curCode && !currency) {
        currency = curCode;
      } else {
        remaining.push(part);
      }
    }
  }

  // HKD is default — omit from response
  if (currency === 'HKD') {
    currency = undefined;
  }

  return { amount, currency, cleaned: remaining.join(' ').trim() };
}

// ── Main parser ─────────────────────────────────────────────────────────

export function parseTransactionText(text: string, _locale?: string): ParsedTransaction {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      confidence: 0,
      missing_fields: ['amount', 'merchant'],
    };
  }

  // Pipeline: extract structured data step by step, cleaning the text along the way
  const dateResult = extractDate(trimmed);
  const participantResult = extractParticipants(dateResult.cleaned);
  const splitResult = extractSplitBill(participantResult.cleaned);
  const amountResult = extractAmount(splitResult.cleaned);

  const description = amountResult.cleaned
    .replace(/\s{2,}/g, ' ')
    .trim();

  const category = suggestCategory(description || trimmed);

  // Build the result
  const result: ParsedTransaction = {};
  let confidence = 0;
  const missingFields: string[] = [];

  if (amountResult.amount !== undefined && amountResult.amount > 0) {
    result.amount = amountResult.amount;
    confidence += 0.4;
  } else {
    missingFields.push('amount');
  }

  if (description) {
    result.merchant = description;
    confidence += 0.3;
  } else {
    missingFields.push('merchant');
  }

  if (category) {
    result.category = category;
    confidence += 0.15;
  }

  if (amountResult.currency) {
    result.currency = amountResult.currency;
  }

  if (dateResult.date) {
    result.date = dateResult.date;
    confidence += 0.05;
  }

  if (participantResult.participants.length > 0) {
    result.participants = participantResult.participants;
    confidence += 0.05;

    // If split bill, note it
    if (splitResult.splitBill) {
      result.notes = `Split bill (${amountResult.amount ?? '?'} each)`;
      confidence += 0.05;
    }
  }

  result.confidence = Math.min(confidence, 1);
  if (missingFields.length > 0) {
    result.missing_fields = missingFields;
  }

  return result;
}
