import type { SupportedCurrency } from '../models/Expense';

// Fallback approximate rates: how many HKD per 1 unit of foreign currency
// These are approximate as of early 2026 and serve as fallback when API is unavailable
const FALLBACK_RATES: Record<string, number> = {
  CNY: 1.08,
  JPY: 0.052,
  USD: 7.80,
  EUR: 8.50,
  GBP: 9.90,
  TWD: 0.24,
  THB: 0.22,
  KRW: 0.0057,
};

const EXCHANGE_RATE_API_URL = process.env.EXCHANGE_RATE_API_URL || 'https://open.er-api.com/v6/latest/HKD';

interface ExchangeRateResponse {
  rates: Record<string, number>;
  source: 'api' | 'fallback';
  updatedAt: string;
}

let cachedRates: ExchangeRateResponse | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function getExchangeRates(): Promise<ExchangeRateResponse> {
  if (cachedRates && Date.now() < cacheExpiry) {
    return cachedRates;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(EXCHANGE_RATE_API_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json() as { result: string; rates: Record<string, number> };

    if (data.result !== 'success' || !data.rates) {
      throw new Error('Invalid API response');
    }

    // API returns rates FROM HKD, e.g. HKD->USD = 0.128
    // We need rates TO HKD, e.g. 1 USD = 7.8 HKD
    const targetCurrencies = ['CNY', 'JPY', 'USD', 'EUR', 'GBP', 'TWD', 'THB', 'KRW'];
    const rates: Record<string, number> = {};

    for (const currency of targetCurrencies) {
      const apiRate = data.rates[currency];
      if (apiRate && apiRate > 0) {
        rates[currency] = Math.round((1 / apiRate) * 10000) / 10000;
      } else {
        rates[currency] = FALLBACK_RATES[currency];
      }
    }

    cachedRates = {
      rates,
      source: 'api',
      updatedAt: new Date().toISOString(),
    };
    cacheExpiry = Date.now() + CACHE_TTL_MS;

    return cachedRates;
  } catch {
    // Fallback to hardcoded rates
    const fallback: ExchangeRateResponse = {
      rates: { ...FALLBACK_RATES },
      source: 'fallback',
      updatedAt: new Date().toISOString(),
    };
    cachedRates = fallback;
    cacheExpiry = Date.now() + 5 * 60 * 1000; // Cache fallback for 5 minutes
    return fallback;
  }
}

export function convertToHKD(amount: number, currency: SupportedCurrency, rate: number): number {
  if (currency === 'HKD') return amount;
  return Math.round(amount * rate * 100) / 100;
}

export function clearRateCache(): void {
  cachedRates = null;
  cacheExpiry = 0;
}
