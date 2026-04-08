import ExchangeRateModel from '../models/ExchangeRate';
import type { SupportedCurrency } from '../models/Expense';

const FRANKFURTER_URL = 'https://api.frankfurter.app/latest?from=USD';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface ExchangeRateData {
  base: string;
  rates: Record<string, number>;
  updatedAt: string;
  source: 'mongodb' | 'api' | 'fallback';
}

async function fetchFromApi(): Promise<Record<string, number>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(FRANKFURTER_URL, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    const data = await response.json() as { base: string; rates: Record<string, number> };
    if (!data.rates) throw new Error('Invalid API response');
    return { ...data.rates, USD: 1 };
  } catch {
    clearTimeout(timeout);
    throw new Error('Exchange rate API unavailable');
  }
}

async function getCachedRates(): Promise<{ rates: Record<string, number>; fetchedAt: Date; fresh: boolean } | null> {
  try {
    const doc = await ExchangeRateModel.findOne({ base: 'USD' }).lean();
    if (!doc) return null;
    const age = Date.now() - new Date(doc.fetchedAt as Date).getTime();
    const rates = doc.rates instanceof Map
      ? Object.fromEntries(doc.rates)
      : (doc.rates as unknown as Record<string, number>);
    return { rates, fetchedAt: doc.fetchedAt as Date, fresh: age <= CACHE_TTL_MS };
  } catch {
    return null;
  }
}

async function storeCachedRates(rates: Record<string, number>): Promise<void> {
  try {
    await ExchangeRateModel.findOneAndUpdate(
      { base: 'USD' },
      { base: 'USD', rates, fetchedAt: new Date() },
      { upsert: true, new: true }
    );
  } catch {
    // Non-fatal
  }
}

export async function getExchangeRates(base: string = 'USD'): Promise<ExchangeRateData> {
  const normalizedBase = base.toUpperCase();

  const cached = await getCachedRates();

  if (cached?.fresh) {
    const rates = convertRatesToBase(cached.rates, normalizedBase);
    return { base: normalizedBase, rates, updatedAt: cached.fetchedAt.toISOString(), source: 'mongodb' };
  }

  try {
    const usdRates = await fetchFromApi();
    await storeCachedRates(usdRates);
    const rates = convertRatesToBase(usdRates, normalizedBase);
    return { base: normalizedBase, rates, updatedAt: new Date().toISOString(), source: 'api' };
  } catch {
    // API failed — use stale MongoDB cache if available
    if (cached) {
      const rates = convertRatesToBase(cached.rates, normalizedBase);
      return { base: normalizedBase, rates, updatedAt: cached.fetchedAt.toISOString(), source: 'mongodb' };
    }
    // No cache and no API — return identity rates (no conversion for unknown currencies)
    return { base: normalizedBase, rates: { [normalizedBase]: 1, USD: 1 }, updatedAt: new Date().toISOString(), source: 'fallback' };
  }
}

function convertRatesToBase(usdRates: Record<string, number>, base: string): Record<string, number> {
  if (base === 'USD') return { ...usdRates };
  const baseRate = usdRates[base];
  if (!baseRate) return { ...usdRates };
  const result: Record<string, number> = {};
  for (const [currency, rate] of Object.entries(usdRates)) {
    result[currency] = Math.round((rate / baseRate) * 10000) / 10000;
  }
  result[base] = 1;
  return result;
}

// Convert amount from one currency to another using USD-base rates.
// usdRates maps each currency to how many units per 1 USD.
// Returns original amount unchanged if either currency is not in rates.
export function convertCurrency(
  amount: number,
  from: string,
  to: string,
  usdRates: Record<string, number>
): number {
  if (from === to) return amount;
  const rateFrom = from === 'USD' ? 1 : (usdRates[from] ?? 0);
  const rateTo = to === 'USD' ? 1 : (usdRates[to] ?? 0);
  if (!rateFrom || !rateTo) return amount;
  return Math.round((amount * rateTo / rateFrom) * 100) / 100;
}

export async function clearRateCache(): Promise<void> {
  try {
    await ExchangeRateModel.deleteMany({ base: 'USD' });
  } catch {
    // Non-fatal
  }
}

// Legacy: convert amount to HKD given an explicit rate (synchronous)
export function convertToHKD(amount: number, currency: SupportedCurrency, rate: number): number {
  if (currency === 'HKD') return amount;
  return Math.round(amount * rate * 100) / 100;
}
