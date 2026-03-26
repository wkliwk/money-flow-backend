import mongoose, { Document } from 'mongoose';

export interface IAlert extends Document {
  userId: string;
  category: string;
  amount: number;
  limit: number;
  percentUsed: number;
  message: string;
  sent: boolean;
  sentAt?: Date;
  createdAt: Date;
}

const AlertSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    category: { type: String, required: true },
    amount: { type: Number, required: true },
    limit: { type: Number, required: true },
    percentUsed: { type: Number, required: true },
    message: { type: String, required: true },
    sent: { type: Boolean, default: false, index: true },
    sentAt: { type: Date },
  },
  { timestamps: true }
);

export const AlertModel = mongoose.model<IAlert>('Alert', AlertSchema);
export default AlertModel;
