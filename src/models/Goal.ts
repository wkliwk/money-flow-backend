import mongoose, { Document } from 'mongoose';

interface IGoal extends Document {
  userId: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  deadline?: Date;
  category?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const GoalSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    name: { type: String, required: true },
    targetAmount: { type: Number, required: true },
    currentAmount: { type: Number, default: 0 },
    deadline: { type: Date },
    category: { type: String },
  },
  { timestamps: true }
);

GoalSchema.index({ userId: 1, createdAt: -1 });

export const GoalModel = mongoose.model<IGoal>('Goal', GoalSchema);
export default GoalModel;
