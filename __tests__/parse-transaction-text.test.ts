import { parseTransactionText } from '../src/utils/parseTransactionText';

describe('parseTransactionText', () => {
  describe('basic amount + description', () => {
    it('parses "coffee $4.50 at Starbucks"', () => {
      const result = parseTransactionText('coffee $4.50 at Starbucks');
      expect(result.amount).toBe(4.5);
      expect(result.merchant).toMatch(/coffee/i);
      expect(result.merchant).toMatch(/starbucks/i);
      expect(result.category).toBe('food');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('parses "uber 150 transport"', () => {
      const result = parseTransactionText('uber 150 transport');
      expect(result.amount).toBe(150);
      expect(result.category).toBe('transport');
    });

    it('parses "$12 taxi"', () => {
      const result = parseTransactionText('$12 taxi');
      expect(result.amount).toBe(12);
      expect(result.category).toBe('transport');
    });

    it('parses "lunch 1500 JPY"', () => {
      const result = parseTransactionText('lunch 1500 JPY');
      expect(result.amount).toBe(1500);
      expect(result.currency).toBe('JPY');
      expect(result.category).toBe('food');
    });

    it('parses "rent $2000 monthly"', () => {
      const result = parseTransactionText('rent $2000 monthly');
      expect(result.amount).toBe(2000);
      expect(result.category).toBe('bills');
    });
  });

  describe('participants', () => {
    it('extracts "with Casey"', () => {
      const result = parseTransactionText('lunch with Casey $56');
      expect(result.participants).toEqual(['Casey']);
      expect(result.amount).toBe(56);
    });

    it('extracts "with Casey and Bob"', () => {
      const result = parseTransactionText('dinner $80 with Casey and Bob');
      expect(result.participants).toEqual(['Casey', 'Bob']);
    });
  });

  describe('split bill', () => {
    it('detects "each" keyword', () => {
      const result = parseTransactionText('lunch with Casey $56 each');
      expect(result.participants).toEqual(['Casey']);
      expect(result.notes).toMatch(/split bill/i);
      expect(result.notes).toContain('56');
    });

    it('detects "split" keyword', () => {
      const result = parseTransactionText('dinner $100 with Bob split');
      expect(result.notes).toMatch(/split bill/i);
    });
  });

  describe('date extraction', () => {
    it('extracts "today"', () => {
      const result = parseTransactionText('today coffee $5');
      const today = new Date().toISOString().slice(0, 10);
      expect(result.date).toBe(today);
      expect(result.amount).toBe(5);
    });

    it('extracts "yesterday"', () => {
      const result = parseTransactionText('yesterday lunch $12');
      const d = new Date();
      d.setDate(d.getDate() - 1);
      expect(result.date).toBe(d.toISOString().slice(0, 10));
    });

    it('strips time patterns', () => {
      const result = parseTransactionText('today 12:00 eat dinner $56');
      expect(result.amount).toBe(56);
      expect(result.merchant).not.toMatch(/12:00/);
    });
  });

  describe('full complex input', () => {
    it('parses "today 12:00 eat dinner at cafe with Casey $56 each"', () => {
      const result = parseTransactionText('today 12:00 eat dinner at cafe with Casey $56 each');
      expect(result.amount).toBe(56);
      expect(result.merchant).toMatch(/eat dinner/i);
      expect(result.participants).toEqual(['Casey']);
      expect(result.notes).toMatch(/split bill/i);
      expect(result.category).toBe('food');
      expect(result.date).toBe(new Date().toISOString().slice(0, 10));
    });
  });

  describe('Cantonese input', () => {
    it('parses "今日同Casey食咗麥當勞 $65"', () => {
      const result = parseTransactionText('今日同Casey食咗麥當勞 $65');
      expect(result.amount).toBe(65);
      expect(result.participants).toEqual(['Casey']);
      expect(result.date).toBe(new Date().toISOString().slice(0, 10));
    });

    it('parses "昨日飲咖啡 $40"', () => {
      const result = parseTransactionText('昨日飲咖啡 $40');
      expect(result.amount).toBe(40);
      const d = new Date();
      d.setDate(d.getDate() - 1);
      expect(result.date).toBe(d.toISOString().slice(0, 10));
    });
  });

  describe('edge cases', () => {
    it('returns low confidence for empty input', () => {
      const result = parseTransactionText('');
      expect(result.confidence).toBe(0);
      expect(result.missing_fields).toContain('amount');
    });

    it('returns missing amount for text-only input', () => {
      const result = parseTransactionText('just some random text');
      expect(result.missing_fields).toContain('amount');
    });

    it('handles whitespace-only input', () => {
      const result = parseTransactionText('   ');
      expect(result.confidence).toBe(0);
    });
  });

  describe('currency symbols', () => {
    it('parses EUR symbol', () => {
      const result = parseTransactionText('lunch \u20ac50');
      expect(result.amount).toBe(50);
      expect(result.currency).toBe('EUR');
    });

    it('parses GBP symbol', () => {
      const result = parseTransactionText('tea \u00a320');
      expect(result.amount).toBe(20);
      expect(result.currency).toBe('GBP');
    });

    it('omits HKD as default currency', () => {
      const result = parseTransactionText('coffee 45 HKD');
      expect(result.amount).toBe(45);
      expect(result.currency).toBeUndefined();
    });
  });
});
