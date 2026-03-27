import mongoose, { Document } from 'mongoose';

interface IPriceHistoryEntry {
  price: number;
  date: Date;
}

export interface IItemPrice extends Document {
  userId: string;
  merchant: string;
  itemName: string;
  price: number;
  currency: string;
  lastSeen: Date;
  priceHistory: IPriceHistoryEntry[];
  occurrences: number;
}

const PriceHistoryEntrySchema = new mongoose.Schema<IPriceHistoryEntry>(
  {
    price: { type: Number, required: true },
    date: { type: Date, required: true },
  },
  { _id: false }
);

const ItemPriceSchema = new mongoose.Schema<IItemPrice>(
  {
    userId: { type: String, required: true },
    merchant: { type: String, required: true },
    itemName: { type: String, required: true },
    price: { type: Number, required: true },
    currency: { type: String, required: true, default: 'HKD' },
    lastSeen: { type: Date, required: true },
    priceHistory: { type: [PriceHistoryEntrySchema], default: [] },
    occurrences: { type: Number, required: true, default: 1 },
  },
  { timestamps: true }
);

// Compound index for fast lookup by user + merchant + item
ItemPriceSchema.index({ userId: 1, merchant: 1, itemName: 1 }, { unique: true });
// Index for suggest endpoint (user + merchant)
ItemPriceSchema.index({ userId: 1, merchant: 1 });

export const ItemPriceModel = mongoose.model<IItemPrice>('ItemPrice', ItemPriceSchema);
export default ItemPriceModel;
