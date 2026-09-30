import { model, models, Schema, type InferSchemaType } from 'mongoose';

export const USER_ROLES = [
  'SYSTEM_ADMIN',
  'SOCIETY_MANAGER',
  'COMMITTEE_MEMBER',
  'OWNER_MEMBER',
  'RESIDENT',
] as const;

export const userSchema = new Schema(
  {
    societyId: { type: Schema.Types.ObjectId, ref: 'Society', required: true },
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: USER_ROLES, required: true },
    walletAddress: { type: String },
    status: { type: String, required: true },
  },
  { timestamps: true, collection: 'users' },
);

userSchema.index({ email: 1 });
userSchema.index({ societyId: 1 });

export type UserRecord = InferSchemaType<typeof userSchema>;
export const User = models.User ?? model('User', userSchema);
