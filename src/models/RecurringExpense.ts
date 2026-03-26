import mongoose, { Document } from 'mongoose';

export type RecurringFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

export interface IRecurringExpense extends Document {
  userId: string;
  name: string;
  amount: number;
  category?: string;
  start_date: Date;
  end_date?: Date;
  frequency: RecurringFrequency;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

const RecurringExpenseSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    amount: { type: Number, required: true, min: 0.01 },
    category: { type: String },
    start_date: { type: Date, required: true },
    end_date: { type: Date },
    frequency: {
      type: String,
      enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'],
      required: true,
    },
    description: { type: String },
  },
  { timestamps: true }
);

// Validate that end_date (if set) is after start_date
RecurringExpenseSchema.pre('save', function (next) {
  if (this.end_date && this.start_date > this.end_date) {
    next(new Error('end_date must be after start_date'));
  } else {
    next();
  }
});

export const RecurringExpenseModel = mongoose.model<IRecurringExpense>(
  'RecurringExpense',
  RecurringExpenseSchema
);
export default RecurringExpenseModel;
