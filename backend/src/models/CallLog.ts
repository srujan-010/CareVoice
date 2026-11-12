import mongoose, { Document, Schema, Types } from 'mongoose';
import {
  CALL_OUTCOMES,
  CALL_TYPES,
  CallOutcome,
  CallType,
  MEDICINE_CONFIRMATION_VALUES,
  MedicineConfirmationValue,
  RECORDING_STATUSES,
  RecordingStatus,
} from '../constants/statuses';

export type SarvamCallConnectivityStatus = 'connected' | 'no_answer' | 'busy' | 'failed';

export interface ICallLog extends Document {
  familyId: Types.ObjectId;
  familyMemberId: Types.ObjectId;
  medicineId?: Types.ObjectId;
  doseInstanceId?: Types.ObjectId;
  callScheduleId?: Types.ObjectId;
  callbackId?: Types.ObjectId;
  provider: 'mock' | 'sarvam';
  providerCallId?: string;
  attemptId?: string;
  interactionId?: string;
  sarvamStatus?: SarvamCallConnectivityStatus;
  failureReason?: string;
  channelInfo?: Record<string, unknown>;
  finalAgentVariables?: Record<string, unknown>;
  processedWebhookIds: string[];
  lastWebhookAt?: Date;
  mode: 'mock' | 'live';
  callType: CallType;
  phoneNumber: string;
  language: string;
  scheduledAt: Date;
  startedAt?: Date;
  endedAt?: Date;
  durationSeconds: number;
  outcome: CallOutcome;
  recordingStatus: RecordingStatus;
  transcriptAvailable: boolean;
  mealConfirmed: boolean | null;
  medicineConfirmed: MedicineConfirmationValue;
  aiSummary?: string;
  createdAt: Date;
  updatedAt: Date;
}

const callLogSchema = new Schema<ICallLog>(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true, index: true },
    familyMemberId: {
      type: Schema.Types.ObjectId,
      ref: 'FamilyMember',
      required: true,
      index: true,
    },
    medicineId: { type: Schema.Types.ObjectId, ref: 'Medicine' },
    doseInstanceId: { type: Schema.Types.ObjectId, ref: 'DoseInstance', index: true },
    callScheduleId: { type: Schema.Types.ObjectId, ref: 'CallSchedule' },
    callbackId: { type: Schema.Types.ObjectId, ref: 'Callback' },
    provider: { type: String, enum: ['mock', 'sarvam'], required: true, default: 'mock' },
    providerCallId: { type: String, trim: true, index: true },
    attemptId: { type: String, trim: true },
    interactionId: { type: String, trim: true, index: true },
    sarvamStatus: {
      type: String,
      enum: ['connected', 'no_answer', 'busy', 'failed'],
    },
    failureReason: { type: String, trim: true, maxlength: 1000 },
    channelInfo: { type: Schema.Types.Mixed },
    finalAgentVariables: { type: Schema.Types.Mixed },
    processedWebhookIds: { type: [String], default: [] },
    lastWebhookAt: { type: Date },
    mode: { type: String, enum: ['mock', 'live'], required: true, default: 'mock' },
    callType: { type: String, enum: CALL_TYPES, required: true },
    phoneNumber: { type: String, required: true, trim: true },
    language: { type: String, required: true },
    scheduledAt: { type: Date, required: true },
    startedAt: { type: Date },
    endedAt: { type: Date },
    durationSeconds: { type: Number, default: 0, min: 0 },
    outcome: { type: String, enum: CALL_OUTCOMES, required: true },
    recordingStatus: {
      type: String,
      enum: RECORDING_STATUSES,
      default: 'UNAVAILABLE',
      required: true,
    },
    transcriptAvailable: { type: Boolean, default: false },
    mealConfirmed: { type: Boolean, default: null },
    medicineConfirmed: {
      type: String,
      enum: MEDICINE_CONFIRMATION_VALUES,
      default: 'UNCONFIRMED',
      required: true,
    },
    aiSummary: { type: String, trim: true, maxlength: 1500 },
  },
  { timestamps: true }
);

callLogSchema.index({ familyId: 1, createdAt: -1 });
callLogSchema.index({ familyMemberId: 1, createdAt: -1 });
callLogSchema.index({ attemptId: 1 }, { unique: true, sparse: true });

export const CallLog = mongoose.model<ICallLog>('CallLog', callLogSchema);

