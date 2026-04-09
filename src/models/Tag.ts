import mongoose, { Document } from 'mongoose';

interface ITag extends Document {
  name: string;
  color: string;
  owner: string;
  createdAt: Date;
  updatedAt: Date;
}

const TagSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 50 },
    color: { type: String, required: true, default: '#6366f1', match: /^#[0-9A-Fa-f]{6}$/ },
    owner: { type: String, required: true },
  },
  { timestamps: true }
);

// Unique tag name per user (case-insensitive enforced at route level)
TagSchema.index({ owner: 1, name: 1 }, { unique: true });
TagSchema.index({ owner: 1 });

export type { ITag };
export const TagModel = mongoose.model<ITag>('Tag', TagSchema);
export default TagModel;
