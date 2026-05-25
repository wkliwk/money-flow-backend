import mongoose, { Document } from 'mongoose';

export interface IContact extends Document {
  userId: string;
  name: string;
  email?: string;
  color?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ContactSchema = new mongoose.Schema<IContact>(
  {
    userId: { type: String, required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, trim: true, lowercase: true, maxlength: 200 },
    color: { type: String, maxlength: 16 },
  },
  { timestamps: true }
);

ContactSchema.index({ userId: 1, name: 1 });
ContactSchema.index({ userId: 1, createdAt: -1 });

export const ContactModel = mongoose.model<IContact>('Contact', ContactSchema);
export default ContactModel;
