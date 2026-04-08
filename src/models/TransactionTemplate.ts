import mongoose, { Document } from 'mongoose';

export type TemplateFrequency = 'weekly' | 'biweekly' | 'monthly';

export interface ITransactionTemplate extends Document {
  owner: string;
  name: string;
  amount: number;
  category?: string;
  description?: string;
  frequency: TemplateFrequency;
  createdAt: Date;
  updatedAt: Date;
}

const TransactionTemplateSchema = new mongoose.Schema(
  {
    owner: { type: String, required: true, index: true },
    name: { type: String, required: true },
    amount: { type: Number, required: true, min: 0.01 },
    category: { type: String },
    description: { type: String },
    frequency: {
      type: String,
      enum: ['weekly', 'biweekly', 'monthly'],
      required: true,
    },
  },
  { timestamps: true }
);

TransactionTemplateSchema.index({ owner: 1, createdAt: -1 });

export const TransactionTemplateModel = mongoose.model<ITransactionTemplate>(
  'TransactionTemplate',
  TransactionTemplateSchema
);
export default TransactionTemplateModel;
