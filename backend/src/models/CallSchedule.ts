import mongoose, { Document, Schema, Types } from 'mongoose';
import {
  CALL_ERROR_CATEGORIES,
  CALL_SCHEDULE_STATUSES,
  CALL_TYPES,
  CallErrorCategory,
  CallScheduleStatus,
  CallType,
} from '../constants/statuses';

export interface ICallSchedule extends Document {
  familyId: Types.ObjectId;
  familyMemberId: Types.ObjectId;
  medicineId: Types.ObjectId;
  doseInstanceId: Types.ObjectId;
  callbackId?: Types.ObjectId;
  callType: CallType;
  scheduledFor: Date;
  status: CallScheduleStatus;
  jobKey: string;
  attemptNumber: number;
  maxAttempts: number;
  dispatchedAt?: Date;
  completedAt?: Date;
  failureReason?: string;
  errorCategory?: CallErrorCategory;
  nonRetryable?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const callScheduleSchema = new Schema<ICallSchedule>(
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
      index: true,
    },
    callbackId: { type: Schema.Types.ObjectId, ref: 'Callback' },
    callType: { type: String, enum: CALL_TYPES, required: true },
    scheduledFor: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: CALL_SCHEDULE_STATUSES,
      default: 'QUEUED',
      required: true,
    },
    jobKey: { type: String, required: true, unique: true },
    attemptNumber: { type: Number, default: 1, min: 1 },
    maxAttempts: { type: Number, default: 2, min: 1, max: 5 },
    dispatchedAt: { type: Date },
    completedAt: { type: Date },
    failureReason: { type: String, trim: true },
    errorCategory: { type: String, enum: CALL_ERROR_CATEGORIES },
    nonRetryable: { type: Boolean, default: false },
  },
  { timestamps: true }
);

callScheduleSchema.index({ familyId: 1, scheduledFor: 1, status: 1 });
callScheduleSchema.index({ status: 1, scheduledFor: 1 });

export const CallSchedule = mongoose.model<ICallSchedule>('CallSchedule', callScheduleSchema);

