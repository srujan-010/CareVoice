import mongoose, { Document, Schema, Types } from 'mongoose';
import {
  CALL_ERROR_CATEGORIES,
  CALL_LIFECYCLE_STATUSES,
  CALL_OUTCOMES,
  CALL_TYPES,
  CallErrorCategory,
  CallLifecycleStatus,
  CallOutcome,
  CallType,
  LANGUAGE_STATUSES,
  LanguageStatus,
  MEDICINE_CONFIRMATION_VALUES,
  MedicineConfirmationValue,
  RECORDING_STATUSES,
  RecordingStatus,
  TRANSCRIPT_STATUSES,
  TranscriptStatus,
} from '../constants/statuses';

export type SarvamCallConnectivityStatus =
  | 'queued'
  | 'initiating'
  | 'dialing'
  | 'ringing'
  | 'answered'
  | 'in_progress'
  | 'connected'
  | 'completed'
  | 'no_answer'
  | 'unanswered'
  | 'busy'
  | 'failed'
  | 'rejected'
  | 'not_connected'
  | 'cancelled'
  | 'canceled'
  | 'unknown'
  | (string & {});

export interface ICallLifecycleEvent {
  status: CallLifecycleStatus;
  timestamp: Date;
  source: 'SYSTEM' | 'PROVIDER_API' | 'WEBHOOK' | 'RECONCILIATION' | 'ADMIN';
  note?: string;
}

export interface ICallWebhookEventRecord {
  eventId: string;
  receivedAt: Date;
  source: 'WEBHOOK' | 'ANALYTICS_API';
  rawStatus: string;
  mappedStatus: CallLifecycleStatus;
  sanitizedPayload: Record<string, unknown>;
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
  providerStatusRaw?: string;
  failureReason?: string;
  errorCategory?: CallErrorCategory;
  channelInfo?: Record<string, unknown>;
  finalAgentVariables?: Record<string, unknown>;
  providerResponseMeta?: Record<string, unknown>;
  contextSnapshot?: Record<string, unknown>;
  processedWebhookIds: string[];
  webhookEvents: ICallWebhookEventRecord[];
  lastWebhookAt?: Date;
  lastStatusUpdateAt?: Date;
  lastReconciledAt?: Date;
  providerUpdatedAt?: Date;
  mode: 'mock' | 'live';
  isMock: boolean;
  isTestCall: boolean;
  callPurpose?: string;
  callStatus: CallLifecycleStatus;
  statusHistory: ICallLifecycleEvent[];
  voiceCallingConsentGranted: boolean;
  transcriptConsentGranted: boolean;
  audioRecordingConsentGranted: boolean;
  recordingConsentGranted: boolean;
  queuedAt?: Date;
  initiatingAt?: Date;
  ringingAt?: Date;
  answeredAt?: Date;
  callType: CallType;
  phoneNumber: string;
  language: string;
  requestedLanguage?: string;
  actualLanguageUsed?: string;
  fallbackLanguage?: string;
  languageStatus: LanguageStatus;
  fallbackAuthorizedByUserId?: Types.ObjectId;
  scheduledAt: Date;
  startedAt?: Date;
  endedAt?: Date;
  durationSeconds: number;
  outcome: CallOutcome;
  recordingStatus: RecordingStatus;
  recordingNote?: string;
  transcriptStatus: TranscriptStatus;
  transcriptSource?: 'WEBHOOK' | 'ANALYTICS_API' | 'MOCK' | 'NONE';
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
      enum: ['SYSTEM', 'PROVIDER_API', 'WEBHOOK', 'RECONCILIATION', 'ADMIN'],
      required: true,
    },
    note: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false }
);

const webhookEventSchema = new Schema<ICallWebhookEventRecord>(
  {
    eventId: { type: String, required: true, trim: true },
    receivedAt: { type: Date, required: true, default: Date.now },
    source: { type: String, enum: ['WEBHOOK', 'ANALYTICS_API'], required: true },
    rawStatus: { type: String, required: true, trim: true },
    mappedStatus: { type: String, enum: CALL_LIFECYCLE_STATUSES, required: true },
    sanitizedPayload: { type: Schema.Types.Mixed, default: {} },
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
    sarvamStatus: { type: String, trim: true, lowercase: true },
    providerStatusRaw: { type: String, trim: true },
    failureReason: { type: String, trim: true, maxlength: 1000 },
    errorCategory: { type: String, enum: CALL_ERROR_CATEGORIES },
    channelInfo: { type: Schema.Types.Mixed },
    finalAgentVariables: { type: Schema.Types.Mixed },
    providerResponseMeta: { type: Schema.Types.Mixed },
    contextSnapshot: { type: Schema.Types.Mixed },
    processedWebhookIds: { type: [String], default: [] },
    webhookEvents: { type: [webhookEventSchema], default: [] },
    lastWebhookAt: { type: Date },
    lastStatusUpdateAt: { type: Date },
    lastReconciledAt: { type: Date },
    providerUpdatedAt: { type: Date },
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
    voiceCallingConsentGranted: { type: Boolean, required: true, default: true },
    transcriptConsentGranted: { type: Boolean, required: true, default: false },
    audioRecordingConsentGranted: { type: Boolean, required: true, default: false },
    recordingConsentGranted: { type: Boolean, required: true, default: false },
    queuedAt: { type: Date },
    initiatingAt: { type: Date },
    ringingAt: { type: Date },
    answeredAt: { type: Date },
    callType: { type: String, enum: CALL_TYPES, required: true },
    phoneNumber: { type: String, required: true, trim: true },
    language: { type: String, required: true },
    requestedLanguage: { type: String, trim: true },
    actualLanguageUsed: { type: String, trim: true },
    fallbackLanguage: { type: String, trim: true },
    languageStatus: {
      type: String,
      enum: LANGUAGE_STATUSES,
      default: 'MATCHED',
      required: true,
    },
    fallbackAuthorizedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
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
    recordingNote: { type: String, trim: true, maxlength: 500 },
    transcriptStatus: {
      type: String,
      enum: TRANSCRIPT_STATUSES,
      default: 'PENDING',
      required: true,
    },
    transcriptSource: {
      type: String,
      enum: ['WEBHOOK', 'ANALYTICS_API', 'MOCK', 'NONE'],
      default: 'NONE',
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

