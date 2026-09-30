import { model, models, Schema, type InferSchemaType } from 'mongoose';

export const MEMBERSHIP_TYPES = ['PRIMARY', 'JOINT', 'ASSOCIATE', 'PROVISIONAL'] as const;

export const membershipSchema = new Schema(
  {
    societyId: { type: Schema.Types.ObjectId, ref: 'Society', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    membershipType: { type: String, enum: MEMBERSHIP_TYPES, required: true },
    membershipStatus: { type: String, required: true },
    membershipNumber: { type: String },
    primaryMemberOrder: { type: Number },
    associatedFlatIds: [{ type: Schema.Types.ObjectId, ref: 'Flat' }],
    validFrom: { type: Date },
    validTo: { type: Date },
  },
  { timestamps: true, collection: 'memberships' },
);

membershipSchema.index({ societyId: 1, userId: 1 });
membershipSchema.index({ societyId: 1, membershipStatus: 1 });

export type MembershipRecord = InferSchemaType<typeof membershipSchema>;
export const Membership = models.Membership ?? model('Membership', membershipSchema);
