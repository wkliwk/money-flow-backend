import mongoose, { Document } from 'mongoose';

export type FriendshipStatus = 'pending' | 'accepted' | 'rejected';

export interface IFriendship extends Document {
  requester: string;
  recipient: string;
  status: FriendshipStatus;
  createdAt: Date;
  updatedAt: Date;
}

const FriendshipSchema = new mongoose.Schema(
  {
    requester: { type: String, required: true },
    recipient: { type: String, required: true },
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
  },
  { timestamps: true }
);

FriendshipSchema.index({ requester: 1, recipient: 1 }, { unique: true });
FriendshipSchema.index({ recipient: 1, status: 1 });

export const FriendshipModel = mongoose.model<IFriendship>('Friendship', FriendshipSchema);
export default FriendshipModel;
