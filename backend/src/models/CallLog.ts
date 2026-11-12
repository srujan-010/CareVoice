import mongoose, { Document, Schema, Types } from 'mongoose';
import {
  CALL_LIFECYCLE_STATUSES,
  CALL_OUTCOMES,
  CALL_TYPES,
  CallLifecycleStatus,
  CallOutcome,
  CallType,
  MEDICINE_CONFIRMATION_VALUES,
  MedicineConfirmationValue,
  RECORDING_STATUSES,
  RecordingStatus,
} from '../constants/statuses';

export type SarvamCallConnectivityStatus =
  | 'queued'
  | 'initiating'
  | 'ringing'
  | 'in_progress'
  | 'connected'
  | 'completed'
  | 'no_answer'
  | 'busy'
  | 'failed'
  | 'rejected'
  | 'cancelled'
  | 'canceled';

export interface ICallLifecycleEvent {
  status: CallLifecycleStatus;
  timestamp: Date;
  source: 'SYSTEM' | 'PROVIDER_API' | 'WEBHOOK' | 'ADMIN';
  note?: string;
}

export interface ICallLog extends Document {
  familyId: Types.ObjectId;
  familyMemberId: Types.ObjectId;
  medicineId?: Types.ObjectId;
  doseInstanceId?: Types.ObjectId;
  callScheduleId?: Types.ObjectId;
  callbackId?: Types.ObjectId;
  initiatedByUserId?: Types.ObjectId;
  provider: 'mock' | 'sarvam';
  providerCallId?: string;
  attemptId?: string;
  interactionId?: string;
  sarvamStatus?: SarvamCallConnectivityStatus;
  failureReason?: string;
  channelInfo?: Record<string, unknown>;
  finalAgentVariables?: Record<string, unknown>;
  providerResponseMeta?: Record<string, unknown>;
  contextSnapshot?: Record<string, unknown>;
  processedWebhookIds: string[];
  lastWebhookAt?: Date;
  mode: 'mock' | 'live';
  isMock: boolean;
  isTestCall: boolean;
  callPurpose?: string;
  callStatus: CallLifecycleStatus;
  statusHistory: ICallLifecycleEvent[];
  recordingConsentGranted: boolean;
  transcriptConsentGranted: boolean;
  queuedAt?: Date;
  initiatingAt?: Date;
  ringingAt?: Date;
  answeredAt?: Date;
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

const lifecycleEventSchema = new Schema<ICallLifecycleEvent>(
  {
    status: { type: String, enum: CALL_LIFECYCLE_STATUSES, required: true },
    timestamp: { type: Date, required: true, default: Date.now },
    source: {
      type: String,
      enum: ['SYSTEM', 'PROVIDER_API', 'WEBHOOK', 'ADMIN'],
      required: true,
    },
    note: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false }
);

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
    initiatedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    provider: { type: String, enum: ['mock', 'sarvam'], required: true, default: 'mock' },
    providerCallId: { type: String, trim: true, index: true },
    attemptId: { type: String, trim: true },
    interactionId: { type: String, trim: true, index: true },
    sarvamStatus: {
      type: String,
      enum: [
        'queued',
        'initiating',
        'ringing',
        'in_progress',
        'connected',
        'completed',
        'no_answer',
        'busy',
        'failed',
        'rejected',
        'cancelled',
        'canceled',
      ],
    },
    failureReason: { type: String, trim: true, maxlength: 1000 },
    channelInfo: { type: Schema.Types.Mixed },
    finalAgentVariables: { type: Schema.Types.Mixed },
    providerResponseMeta: { type: Schema.Types.Mixed },
    contextSnapshot: { type: Schema.Types.Mixed },
    processedWebhookIds: { type: [String], default: [] },
    lastWebhookAt: { type: Date },
    mode: { type: String, enum: ['mock', 'live'], required: true, default: 'mock' },
    isMock: { type: Boolean, required: true, default: true },
    isTestCall: { type: Boolean, required: true, default: false },
    callPurpose: { type: String, trim: true, maxlength: 200 },
    callStatus: {
      type: String,
      enum: CALL_LIFECYCLE_STATUSES,
      default: 'QUEUED',
      required: true,
      index: true,
    },
    statusHistory: { type: [lifecycleEventSchema], default: [] },
    recordingConsentGranted: { type: Boolean, required: true, default: false },
    transcriptConsentGranted: { type: Boolean, required: true, default: false },
    queuedAt: { type: Date },
    initiatingAt: { type: Date },
    ringingAt: { type: Date },
    answeredAt: { type: Date },
    callType: { type: String, enum: CALL_TYPES, required: true },
    phoneNumber: { type: String, required: true, trim: true },
    language: { type: String, required: true },
    scheduledAt: { type: Date, required: true },
    startedAt: { type: Date },
    endedAt: { type: Date },
    durationSeconds: { type: Number, default: 0, min: 0 },
    outcome: { type: String, enum: CALL_OUTCOMES, default: 'PENDING', required: true },
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
callLogSchema.index({ familyMemberId: 1, doseInstanceId: 1, callType: 1, callStatus: 1, createdAt: -1 });
callLogSchema.index({ attemptId: 1 }, { unique: true, sparse: true });

export const CallLog = mongoose.model<ICallLog>('CallLog', callLogSchema);

