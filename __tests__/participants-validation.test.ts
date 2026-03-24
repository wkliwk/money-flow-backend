// Unit tests for participants field validation logic
// Mirrors the custom validator in src/routes/expenses.ts

function validateParticipants(value: unknown): void {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) throw new Error('participants must be an array');
  if ((value as unknown[]).length > 20) throw new Error('participants cannot exceed 20 items');
  const seen = new Set<string>();
  for (const item of value as unknown[]) {
    if (typeof item !== 'string') throw new Error('each participant must be a string');
    if ((item as string).trim() === '') throw new Error('participant names cannot be empty');
    if ((item as string).length > 100) throw new Error('participant names cannot exceed 100 characters');
    const lower = (item as string).toLowerCase();
    if (seen.has(lower)) throw new Error(`duplicate participant: "${item}"`);
    seen.add(lower);
  }
}

describe('participants validation', () => {
  it('accepts undefined (field optional)', () => expect(() => validateParticipants(undefined)).not.toThrow());
  it('accepts null', () => expect(() => validateParticipants(null)).not.toThrow());
  it('accepts empty array', () => expect(() => validateParticipants([])).not.toThrow());
  it('accepts valid names', () => expect(() => validateParticipants(['Alice', 'Bob'])).not.toThrow());

  it('rejects non-array', () => expect(() => validateParticipants('Alice')).toThrow('must be an array'));
  it('rejects array exceeding 20 items', () => {
    const big = Array.from({ length: 21 }, (_, i) => `Person${i}`);
    expect(() => validateParticipants(big)).toThrow('cannot exceed 20 items');
  });
  it('rejects non-string values', () => expect(() => validateParticipants([123])).toThrow('must be a string'));
  it('rejects empty strings', () => expect(() => validateParticipants([''])).toThrow('cannot be empty'));
  it('rejects whitespace-only strings', () => expect(() => validateParticipants(['   '])).toThrow('cannot be empty'));
  it('rejects names over 100 chars', () => {
    const long = 'a'.repeat(101);
    expect(() => validateParticipants([long])).toThrow('cannot exceed 100 characters');
  });
  it('rejects duplicate names (case-insensitive)', () => {
    expect(() => validateParticipants(['Alice', 'alice'])).toThrow('duplicate participant');
  });
  it('allows max 20 items exactly', () => {
    const exactly20 = Array.from({ length: 20 }, (_, i) => `Person${i}`);
    expect(() => validateParticipants(exactly20)).not.toThrow();
  });
});
