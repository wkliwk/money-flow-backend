import mongoose, { Document } from 'mongoose';

interface IExpense extends Document {
  owner: string;
  description?: string;
  amount: number;
  type?: string;
  category?: string;
  date?: Date;
  notes?: string;
  participants?: string[];
  isRecurring?: boolean;
  recurringFrequency?: string;
}

const ExpenseSchema = new mongoose.Schema(
  {
    owner: { type: String, required: true },
    description: String,
    type: String,
    category: String,
    date: { type: Date, default: Date.now },
    notes: String,
    participants: [String],
    amount: { type: Number, required: true },
    isRecurring: Boolean,
    recurringFrequency: String,
  },
  { timestamps: true }
);

export const ExpenseModel = mongoose.model<IExpense>('Expense', ExpenseSchema);
export default ExpenseModel;
