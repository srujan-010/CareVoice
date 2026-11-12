import mongoose, { Document, Schema, Types } from 'mongoose';
import { CALLBACK_STATUSES, CallbackStatus } from '../constants/statuses';

export interface ICallback extends Document {
  familyId: Types.ObjectId;
  familyMemberId: Types.ObjectId;
  medicineId: Types.ObjectId;
  doseInstanceId: Types.ObjectId;
  sourceCallLogId?: Types.ObjectId;
  reason: string;
  requestedDelayMinutes: number;
  scheduledFor: Date;
  status: CallbackStatus;
  attemptNumber: number;
  maxRetries: number;
  idempotencyKey: string;
  validationNotes?: string;
  resultingCallLogId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const callbackSchema = new Schema<ICallback>(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true, index: true },
    familyMemberId: {
      type: Schema.Types.ObjectId,
      ref: 'FamilyMember',
      required: true,
      index: true,
    },
    medicineId: { type: Schema.Types.ObjectId, ref: 'Medicine', required: true },
    doseInstanceId: {
      type: Schema.Types.ObjectId,
      ref: 'DoseInstance',
      required: true,
    },
    sourceCallLogId: { type: Schema.Types.ObjectId, ref: 'CallLog' },
    reason: { type: String, required: true, trim: true, maxlength: 300 },
    requestedDelayMinutes: { type: Number, required: true, min: 1, max: 180 },
    scheduledFor: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: CALLBACK_STATUSES,
      default: 'REQUESTED',
      required: true,
    },
    attemptNumber: { type: Number, default: 1, min: 1 },
    maxRetries: { type: Number, default: 3, min: 1, max: 5 },
    idempotencyKey: { type: String, required: true, unique: true },
    validationNotes: { type: String, trim: true },
    resultingCallLogId: { type: Schema.Types.ObjectId, ref: 'CallLog' },
  },
  { timestamps: true }
);

// Guarantees at most one active callback per dose instance
callbackSchema.index(
  { doseInstanceId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ['REQUESTED', 'CONFIRMED', 'SCHEDULED'] },
    },
  }
);
callbackSchema.index({ familyId: 1, status: 1, scheduledFor: 1 });

export const Callback = mongoose.model<ICallback>('Callback', callbackSchema);
