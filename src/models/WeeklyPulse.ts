import mongoose, { Document } from 'mongoose';

export interface IWeeklyPulseStats {
  totalSpend: number;
  fourWeekAverage: number;
  deltaPercent: number;
  topCategory: string;
  highestSpendDay: string;
  largestTransaction: { description: string; amount: number; category: string } | null;
  transactionCount: number;
}

interface IWeeklyPulse extends Document {
  userId: string;
  weekStart: string; // YYYY-MM-DD (Monday)
  narrative: string;
  stats: IWeeklyPulseStats;
  createdAt?: Date;
  updatedAt?: Date;
}

const WeeklyPulseSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    weekStart: { type: String, required: true },
    narrative: { type: String, required: true },
    stats: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

WeeklyPulseSchema.index({ userId: 1, weekStart: -1 });

export const WeeklyPulseModel = mongoose.model<IWeeklyPulse>('WeeklyPulse', WeeklyPulseSchema);
