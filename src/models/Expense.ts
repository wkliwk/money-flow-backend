import mongoose, { Document } from 'mongoose';

const PAYMENT_METHODS = [
  'cash',
  'credit_card',
  'debit_card',
  'octopus',
  'payme',
  'fps',
  'alipay_hk',
  'wechat_pay',
  'other',
] as const;

type PaymentMethod = typeof PAYMENT_METHODS[number];

interface IExpense extends Document {
  owner: string;
  description?: string;
  purpose?: string;
  currentLocation?: string;
  type?: string;
  category?: string;
  item?: string;
  participants?: string[];
  parent?: string;
  status?: string;
  profit?: number;
  startDate?: Date | null;
  endDate?: Date | null;
  date?: Date;
  amount: number;
  paymentMethod?: PaymentMethod | null;
  createdAt?: Date;
  updatedAt?: Date;
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
    item: String,
    participants: [String],
    amount: { type: Number, required: true },
    paymentMethod: {
      type: String,
      enum: [...PAYMENT_METHODS, null],
      default: null,
    },
  },
  { timestamps: true }
);

ExpenseSchema.index({ owner: 1, date: -1 });
ExpenseSchema.index({ owner: 1, _id: 1 });

export { PAYMENT_METHODS };
export const ExpenseModel = mongoose.model<IExpense>('Expense', ExpenseSchema);
export default ExpenseModel;
