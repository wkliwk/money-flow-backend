// src/models/Expense.ts
import mongoose, { Document } from 'mongoose';

interface IExpense extends Document {
  description: string;
  amount: number;
  date: Date;
}

const ExpenseSchema = new mongoose.Schema({
  description: String,
  amount: Number,
  date: Date,
});

export const ExpenseModel = mongoose.model<IExpense>('Expense', ExpenseSchema);

export default ExpenseModel;
