import mongoose, { Document } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IBudget {
  category: string;
  limit: number;
  alert_threshold?: number;
  enable_alerts?: boolean;
}

export interface IUser extends Document {
  email: string;
  password: string;
  budgets: IBudget[];
  createdAt: Date;
  comparePassword(candidate: string): Promise<boolean>;
}

const UserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6 },
    budgets: {
      type: [
        {
          category: String,
          limit: Number,
          alert_threshold: { type: Number, default: 0.9 },
          enable_alerts: { type: Boolean, default: false },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

UserSchema.methods.comparePassword = async function (candidate: string): Promise<boolean> {
  return bcrypt.compare(candidate, this.password);
};

export const UserModel = mongoose.model<IUser>('User', UserSchema);
export default UserModel;
