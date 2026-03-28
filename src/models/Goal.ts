import mongoose, { Document } from 'mongoose';

export interface IGoal extends Document {
  userId: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  deadline?: string;
  category?: string;
}

const GoalSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    targetAmount: { type: Number, required: true, min: 0.01 },
    currentAmount: { type: Number, default: 0, min: 0 },
    deadline: String,
    category: String,
  },
  { timestamps: true }
);

export default mongoose.model<IGoal>('Goal', GoalSchema);
