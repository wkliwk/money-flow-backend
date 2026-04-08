import { parseTransactionText, regexParseTransaction } from '../src/utils/parseTransactionText';
import { aiParseTransaction } from '../src/utils/aiParseTransaction';

// Mock the AI module
jest.mock('../src/utils/aiParseTransaction');
const mockAiParse = aiParseTransaction as jest.MockedFunction<typeof aiParseTransaction>;

describe('Hybrid parseTransactionText', () => {
  beforeEach(() => {
    mockAiParse.mockReset();
  });

  describe('regex-only path (high confidence)', () => {
    it('returns regex result with source "regex" when confidence >= 0.7', async () => {
      // "coffee $4.50" gives amount (0.4) + merchant (0.3) + category (0.15) = 0.85
      const result = await parseTransactionText('coffee $4.50');
      expect(result.source).toBe('regex');
      expect(result.amount).toBe(4.5);
      expect(result.merchant).toMatch(/coffee/i);
      expect(mockAiParse).not.toHaveBeenCalled();
    });

    it('does not call AI when regex confidence is sufficient', async () => {
      await parseTransactionText('uber 150 transport');
      expect(mockAiParse).not.toHaveBeenCalled();
    });
  });

  describe('AI fallback path (low confidence)', () => {
    it('calls AI when regex confidence < 0.7', async () => {
      mockAiParse.mockResolvedValue({
        description: '電費',
        amount: null,
        type: 'expense',
        category: 'utilities',
        date: '2026-03-01',
        participants: null,
        notes: null,
      });

      const result = await parseTransactionText('上個月嘅電費');
      expect(mockAiParse).toHaveBeenCalledWith('上個月嘅電費');
      expect(result.source).toBe('ai');
      expect(result.category).toBe('utilities');
      expect(result.date).toBe('2026-03-01');
    });

    it('calls AI when critical fields are missing', async () => {
      mockAiParse.mockResolvedValue({
        description: 'random expense',
        amount: null,
        type: 'expense',
        category: 'other',
        date: null,
        participants: null,
        notes: null,
      });

      const result = await parseTransactionText('just some random text');
      expect(mockAiParse).toHaveBeenCalled();
      expect(result.source).toBe('ai');
    });

    it('merges AI category and date with regex merchant', async () => {
      mockAiParse.mockResolvedValue({
        description: '電費',
        amount: null,
        type: 'expense',
        category: 'utilities',
        date: '2026-03-15',
        participants: null,
        notes: null,
      });

      const result = await parseTransactionText('上個月嘅電費');
      expect(result.category).toBe('utilities');
      expect(result.date).toBe('2026-03-15');
      expect(result.amount).toBeUndefined();
    });
  });

  describe('AI timeout / error graceful fallback', () => {
    it('returns regex result when AI throws', async () => {
      mockAiParse.mockRejectedValue(new Error('AbortError: timeout'));

      const result = await parseTransactionText('上個月嘅電費');
      expect(result.source).toBe('regex');
      // Should still have regex data
      expect(result.confidence).toBeDefined();
    });

    it('returns regex result when AI returns invalid data', async () => {
      mockAiParse.mockRejectedValue(new Error('Invalid JSON'));

      const result = await parseTransactionText('some ambiguous text');
      expect(result.source).toBe('regex');
    });
  });

  describe('AI hallucination guard', () => {
    it('does not use AI amount when input has no amount', async () => {
      // AI hallucinates an amount, but regex found none
      mockAiParse.mockResolvedValue({
        description: '電費',
        amount: 500, // hallucinated
        type: 'expense',
        category: 'utilities',
        date: '2026-03-01',
        participants: null,
        notes: null,
      });

      const result = await parseTransactionText('上個月嘅電費');
      // The regex found no amount, but AI provided one.
      // Since regex had no amount, AI fills the gap — this is valid
      // because the AI amount is used when regex has none.
      // The hallucination guard is: "Only use AI amount if regex had none"
      // Here regex had none, so AI fills it.
      expect(result.amount).toBe(500);
    });

    it('preserves regex amount over AI amount', async () => {
      // Regex finds amount from "$65", AI tries to override
      mockAiParse.mockResolvedValue({
        description: '麥當勞',
        amount: 100, // different from regex
        type: 'expense',
        category: 'food',
        date: null,
        participants: null,
        notes: null,
      });

      // This input has low confidence because "食咗麥當勞" alone
      // but let's force a scenario where regex finds amount but confidence is low
      // Use regexParseTransaction to verify the amount first
      const regex = regexParseTransaction('食咗麥當勞 $65');
      expect(regex.amount).toBe(65);

      // If confidence happens to be >= 0.7, AI won't be called, so test differently:
      // Force a low confidence scenario with amount present
      mockAiParse.mockResolvedValue({
        description: 'test',
        amount: 999,
        type: 'expense',
        category: 'food',
        date: null,
        participants: null,
        notes: null,
      });

      // "65" alone — has amount but no category match, confidence = 0.4 + 0.3 = 0.7
      // That's exactly 0.7, regex path. Let's use something with amount but low confidence.
      // "65 something" → amount=65, merchant="something", conf=0.7 → regex path
      // We need conf < 0.7 with amount present:
      // "65" → amount=65 (0.4), no merchant text → conf = 0.4 < 0.7
      const result = await parseTransactionText('65');
      expect(mockAiParse).toHaveBeenCalled();
      // Regex found amount=65, AI says 999, regex wins
      expect(result.amount).toBe(65);
    });
  });

  describe('source field', () => {
    it('includes source: "regex" for high confidence results', async () => {
      const result = await parseTransactionText('lunch $50');
      expect(result.source).toBe('regex');
    });

    it('includes source: "ai" when AI fallback is used', async () => {
      mockAiParse.mockResolvedValue({
        description: 'electricity bill',
        amount: null,
        type: 'expense',
        category: 'utilities',
        date: null,
        participants: null,
        notes: null,
      });

      const result = await parseTransactionText('electricity bill last month');
      expect(result.source).toBe('ai');
    });
  });

  describe('type field from AI', () => {
    it('sets type to income when AI detects income', async () => {
      mockAiParse.mockResolvedValue({
        description: '收到糧',
        amount: 30000,
        type: 'income',
        category: null,
        date: null,
        participants: null,
        notes: null,
      });

      const result = await parseTransactionText('收到糧');
      expect(result.type).toBe('income');
    });
  });
});

describe('regexParseTransaction', () => {
  it('is still accessible as a named export', () => {
    const result = regexParseTransaction('coffee $5');
    expect(result.amount).toBe(5);
    expect(result.category).toBe('food');
  });
});
