// Unit tests for CSV import parsing logic
// These test the pure parsing/validation logic extracted from the route

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[,$\s]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function parseDate(raw: string): Date | null {
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function inferType(typeRaw: string, amount: number): 'income' | 'expense' {
  const t = typeRaw.toLowerCase();
  if (t === 'income' || t === 'credit') return 'income';
  if (t === 'expense' || t === 'debit') return 'expense';
  return amount >= 0 ? 'income' : 'expense';
}

describe('parseAmount', () => {
  it('parses plain number', () => expect(parseAmount('150')).toBe(150));
  it('parses negative number', () => expect(parseAmount('-50')).toBe(-50));
  it('strips currency symbols', () => expect(parseAmount('$1,234.56')).toBe(1234.56));
  it('returns null for empty string', () => expect(parseAmount('')).toBeNull());
  it('returns null for non-numeric', () => expect(parseAmount('N/A')).toBeNull());
});

describe('parseDate', () => {
  it('parses ISO date', () => {
    const d = parseDate('2024-01-15');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2024);
  });
  it('returns null for invalid date', () => expect(parseDate('not-a-date')).toBeNull());
  it('returns null for empty string', () => expect(parseDate('')).toBeNull());
});

describe('inferType', () => {
  it('explicit income', () => expect(inferType('income', 100)).toBe('income'));
  it('explicit credit', () => expect(inferType('credit', 100)).toBe('income'));
  it('explicit expense', () => expect(inferType('expense', -100)).toBe('expense'));
  it('explicit debit', () => expect(inferType('debit', 100)).toBe('expense'));
  it('positive amount with no type → income', () => expect(inferType('', 100)).toBe('income'));
  it('negative amount with no type → expense', () => expect(inferType('', -50)).toBe('expense'));
});
