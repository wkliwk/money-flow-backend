import mongoose, { Document } from 'mongoose';

const PAYMENT_METHODS = [
  'cash',
  'credit_card',
  'debit_card',
  'octopus',
  'payme',
  'fps',
  'bank_transfer',
  'alipay_hk',
  'wechat_pay',
  'other',
] as const;

type PaymentMethod = typeof PAYMENT_METHODS[number];

const SUPPORTED_CURRENCIES = [
  'HKD', 'CNY', 'JPY', 'USD', 'EUR', 'GBP', 'TWD', 'THB', 'KRW',
] as const;

type SupportedCurrency = typeof SUPPORTED_CURRENCIES[number];

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
  currency?: SupportedCurrency;
  originalAmount?: number | null;
  exchangeRate?: number | null;
  paymentMethod?: PaymentMethod | null;
  splitBill?: boolean | string;
  tags?: mongoose.Types.ObjectId[];
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
    currency: {
      type: String,
      enum: SUPPORTED_CURRENCIES,
      default: 'HKD',
    },
    originalAmount: { type: Number, default: null },
    exchangeRate: { type: Number, default: null },
    paymentMethod: {
      type: String,
      enum: [...PAYMENT_METHODS, null],
      default: null,
    },
    splitBill: { type: mongoose.Schema.Types.Mixed, default: false },
    tags: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Tag', default: [] }],
  },
  { timestamps: true }
);

ExpenseSchema.index({ owner: 1, date: -1 });
ExpenseSchema.index({ owner: 1, _id: 1 });
ExpenseSchema.index({ owner: 1, category: 1, date: -1 }); // budget + report queries filtered by category
ExpenseSchema.index({ owner: 1, tags: 1 }); // tag filter queries

export { PAYMENT_METHODS, SUPPORTED_CURRENCIES };
export type { SupportedCurrency };
export const ExpenseModel = mongoose.model<IExpense>('Expense', ExpenseSchema);
export default ExpenseModel;
