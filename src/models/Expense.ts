import mongoose, { Document } from 'mongoose';

interface IExpense extends Document {
  owner: string;
  description?: string;
  purpose?: string;
  currentLocation?: string;
  type?: string;
  parent?: string;
  status?: string;
  profit?: number;
  startDate?: Date | null;
  endDate?: Date | null;
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
    amount: { type: Number, required: true },
  },
  { timestamps: true }
);

ExpenseSchema.index({ owner: 1, date: -1 });
ExpenseSchema.index({ owner: 1, _id: 1 });

export const ExpenseModel = mongoose.model<IExpense>('Expense', ExpenseSchema);
export default ExpenseModel;
