import mongoose, { Document } from 'mongoose';

interface IExpense extends Document {
  owner: string;
  description?: string;
  purpose?: string;
  currentLocation?: string;
  type?: string;
  category?: string;
  parent?: string;
  status?: string;
  profit?: number;
  startDate?: Date | null;
  endDate?: Date | null;
  date?: Date;
  amount: number;
}

const ExpenseSchema = new mongoose.Schema(
  {
    owner: { type: String, required: true },
    description: String,
    purpose: String,
    currentLocation: String,
    type: String,
    parent: String,
    status: String,
    profit: Number,
    startDate: Date,
    endDate: Date,
    date: { type: Date, default: Date.now },
    category: String,
    amount: { type: Number, required: true },
  },
  { timestamps: true }
);

export const ExpenseModel = mongoose.model<IExpense>('Expense', ExpenseSchema);
export default ExpenseModel;
