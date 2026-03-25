import mongoose, { Document } from 'mongoose';

interface INetWorthSnapshot extends Document {
  userId: string;
  date: Date;
  assets: {
    cash?: number;
    investments?: number;
    property?: number;
    other?: number;
  };
  liabilities: {
    loans?: number;
    creditCardDebt?: number;
    other?: number;
  };
  netWorth: number;
}

const NetWorthSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    date: { type: Date, required: true, index: true },
    assets: {
      cash: { type: Number, default: 0 },
      investments: { type: Number, default: 0 },
      property: { type: Number, default: 0 },
      other: { type: Number, default: 0 },
    },
    liabilities: {
      loans: { type: Number, default: 0 },
      creditCardDebt: { type: Number, default: 0 },
      other: { type: Number, default: 0 },
    },
    netWorth: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Calculate netWorth before saving
NetWorthSchema.pre('save', function (this: INetWorthSnapshot) {
  const totalAssets =
    (this.assets?.cash || 0) +
    (this.assets?.investments || 0) +
    (this.assets?.property || 0) +
    (this.assets?.other || 0);

  const totalLiabilities =
    (this.liabilities?.loans || 0) +
    (this.liabilities?.creditCardDebt || 0) +
    (this.liabilities?.other || 0);

  this.netWorth = totalAssets - totalLiabilities;
});

export const NetWorthModel = mongoose.model<INetWorthSnapshot>('NetWorth', NetWorthSchema);
export default NetWorthModel;
