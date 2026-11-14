import { model, models, Schema, type InferSchemaType } from 'mongoose';

/** A per-login session. Only a hash of the browser-held refresh secret is stored. */
export const authSessionSchema = new Schema(
  {
    sessionId: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true, unique: true },
    createdAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
  },
  { collection: 'authSessions', timestamps: false },
);

authSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
authSessionSchema.index({ userId: 1, revokedAt: 1 });

export type AuthSessionRecord = InferSchemaType<typeof authSessionSchema>;
export const AuthSession = models.AuthSession ?? model('AuthSession', authSessionSchema);
