import { model, models, Schema, type InferSchemaType } from 'mongoose';

export const accountSetupCredentialSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    credentialHash: {
      type: String,
      required: true,
      unique: true,
    },
    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    consumedAt: {
      type: Date,
    },
    revokedAt: {
      type: Date,
    },
  },
  { collection: 'accountSetupCredentials', timestamps: false },
);


export type AccountSetupCredentialRecord = InferSchemaType<typeof accountSetupCredentialSchema>;
export const AccountSetupCredential = models.AccountSetupCredential
  ?? model('AccountSetupCredential', accountSetupCredentialSchema);
