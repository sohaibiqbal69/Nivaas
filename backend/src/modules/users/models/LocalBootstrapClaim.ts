import { model, models, Schema } from 'mongoose';

export const localBootstrapClaimSchema = new Schema(
  {
    _id: { type: String, required: true },
    claimedAt: { type: Date, required: true, immutable: true },
    administratorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  },
  { versionKey: false, collection: 'localBootstrapClaims' },
);

export const LocalBootstrapClaim = models.LocalBootstrapClaim
  ?? model('LocalBootstrapClaim', localBootstrapClaimSchema);
