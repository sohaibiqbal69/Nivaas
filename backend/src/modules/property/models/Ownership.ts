import { model, models, Schema, type InferSchemaType } from 'mongoose';

export const ownershipSchema = new Schema(
  {
    societyId: { type: Schema.Types.ObjectId, ref: 'Society', required: true },
    flatId: { type: Schema.Types.ObjectId, ref: 'Flat', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    ownershipType: { type: String, required: true },
    ownershipOrder: { type: Number },
    status: { type: String, required: true },
    startDate: { type: Date },
    endDate: { type: Date },
  },
  { timestamps: true, collection: 'ownerships' },
);

ownershipSchema.index({ flatId: 1 });
ownershipSchema.index({ userId: 1 });

export type OwnershipRecord = InferSchemaType<typeof ownershipSchema>;
export const Ownership = models.Ownership ?? model('Ownership', ownershipSchema);
