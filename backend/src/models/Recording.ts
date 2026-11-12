import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IRecording extends Document {
  callLogId: Types.ObjectId;
  familyId: Types.ObjectId;
  familyMemberId: Types.ObjectId;
  provider: 'mock' | 'sarvam';
  storageKey: string;
  mimeType: string;
  durationSeconds: number;
  consentVerified: boolean;
  audioDataBase64?: string;
  externalUrl?: string;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const recordingSchema = new Schema<IRecording>(
  {
    callLogId: {
      type: Schema.Types.ObjectId,
      ref: 'CallLog',
      required: true,
      unique: true,
    },
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true, index: true },
    familyMemberId: {
      type: Schema.Types.ObjectId,
      ref: 'FamilyMember',
      required: true,
    },
    provider: { type: String, enum: ['mock', 'sarvam'], required: true },
    storageKey: { type: String, required: true },
    mimeType: { type: String, default: 'audio/wav' },
    durationSeconds: { type: Number, default: 0 },
    consentVerified: { type: Boolean, required: true, default: false },
    audioDataBase64: { type: String, select: false },
    externalUrl: { type: String, select: false },
    expiresAt: { type: Date },
  },
  { timestamps: true }
);

recordingSchema.index({ familyId: 1, callLogId: 1 });

export const Recording = mongoose.model<IRecording>('Recording', recordingSchema);

