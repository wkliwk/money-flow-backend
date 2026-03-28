import mongoose, { Document } from 'mongoose';

export interface ITemplate extends Document {
  userId: string;
  label: string;
  item?: string;
  description: string;
  type: 'income' | 'expense';
  category: string;
  defaultAmount?: number;
}

const TemplateSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    label: { type: String, required: true },
    item: String,
    description: { type: String, default: '' },
    type: { type: String, enum: ['income', 'expense'], default: 'expense' },
    category: { type: String, required: true },
    defaultAmount: Number,
  },
  { timestamps: true }
);

export default mongoose.model<ITemplate>('Template', TemplateSchema);
