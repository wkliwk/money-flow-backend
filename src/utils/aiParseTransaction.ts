import Groq from 'groq-sdk';

export interface AIParsedTransaction {
  description: string | null;
  amount: number | null;
  type: 'expense' | 'income';
  category: string | null;
  date: string | null;
  participants: string[] | null;
  notes: string | null;
}

const SYSTEM_PROMPT = `You are a transaction parser for a personal expense tracking app. Parse the user's natural language input into structured data.

Rules:
- Extract ONLY information explicitly stated. Do NOT guess or infer amounts.
- If the amount is not mentioned, set amount to null.
- Understand Cantonese, English, and mixed input.
- For dates: "今日"=today, "尋日"=yesterday, "上個月"=last month, "上個禮拜"=last week
- For categories, use: food, transport, entertainment, shopping, utilities, healthcare, education, housing, other
- type is always "expense" unless clearly income (e.g. "收到糧", "salary")

Return ONLY valid JSON matching this schema (no markdown fences):
{"description":"string","amount":number|null,"type":"expense"|"income","category":"string|null","date":"YYYY-MM-DD|null","participants":["string"]|null,"notes":"string|null"}`;

function buildDateContext(): string {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  const lastMonth = new Date(now);
  lastMonth.setMonth(lastMonth.getMonth() - 1);

  const lastWeek = new Date(now);
  lastWeek.setDate(lastWeek.getDate() - 7);

  return `Today is ${today}. Yesterday was ${yesterday.toISOString().slice(0, 10)}. Last month started ${lastMonth.toISOString().slice(0, 10)}. Last week was ${lastWeek.toISOString().slice(0, 10)}.`;
}

export async function aiParseTransaction(
  text: string,
  groqClient?: Groq,
): Promise<AIParsedTransaction> {
  const client = groqClient ?? new Groq({ apiKey: process.env.GROQ_API_KEY });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await client.chat.completions.create(
      {
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `${buildDateContext()}\n\nParse this: "${text}"` },
        ],
        temperature: 0.1,
        max_tokens: 300,
      },
      { signal: controller.signal },
    );

    clearTimeout(timeout);

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('Empty AI response');
    }

    // Strip markdown fences if present
    const jsonStr = content.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    const parsed: AIParsedTransaction = JSON.parse(jsonStr);

    // Validate required shape
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('AI returned non-object');
    }

    // Enforce type safety on known fields
    return {
      description: typeof parsed.description === 'string' ? parsed.description : null,
      amount: typeof parsed.amount === 'number' && isFinite(parsed.amount) ? parsed.amount : null,
      type: parsed.type === 'income' ? 'income' : 'expense',
      category: typeof parsed.category === 'string' ? parsed.category : null,
      date: typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null,
      participants: Array.isArray(parsed.participants) ? parsed.participants.filter((p): p is string => typeof p === 'string') : null,
      notes: typeof parsed.notes === 'string' ? parsed.notes : null,
    };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}
