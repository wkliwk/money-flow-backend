import mongoose, { Document } from 'mongoose';

export interface IRecurringExpense extends Document {
  userId: string;
  label: string;
  item?: string;
  description: string;
  amount: number;
  type: 'income' | 'expense';
  category?: string;
  participants?: string[];
  frequency?: 'monthly' | 'weekly' | 'daily';
  lastApplied?: string;
}

const RecurringExpenseSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    label: { type: String, required: true },
    item: String,
    description: { type: String, required: true },
    amount: { type: Number, required: true, min: 0.01 },
    type: { type: String, enum: ['income', 'expense'], default: 'expense' },
    category: String,
    participants: { type: [String], default: [] },
    frequency: { type: String, enum: ['monthly', 'weekly', 'daily'], default: 'monthly' },
    lastApplied: String,
  },
  { timestamps: true }
);

export default mongoose.model<IRecurringExpense>('RecurringExpense', RecurringExpenseSchema);
