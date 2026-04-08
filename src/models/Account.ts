import mongoose, { Document } from 'mongoose';

const ACCOUNT_TYPES = [
  'checking',
  'savings',
  'credit_card',
  'cash',
  'investment',
  'other',
] as const;

type AccountType = typeof ACCOUNT_TYPES[number];

interface IAccount extends Document {
  userId: string;
  name: string;
  type: AccountType;
  startingBalance: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const AccountSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    name: { type: String, required: true },
    type: {
      type: String,
      enum: ACCOUNT_TYPES,
      required: true,
    },
    startingBalance: { type: Number, default: 0 },
  },
  { timestamps: true }
);

AccountSchema.index({ userId: 1, createdAt: -1 });

export { ACCOUNT_TYPES };
export type { AccountType };
export const AccountModel = mongoose.model<IAccount>('Account', AccountSchema);
export default AccountModel;
