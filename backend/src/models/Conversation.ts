import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IConversationTurn {
  speaker: 'AI' | 'PATIENT';
  text: string;
  translatedText?: string;
  timestamp: Date;
  intent?: string;
}

export interface IPatientResponses {
  mealFinished: boolean | null;
  delayMinutes?: number;
  medicineTaken: boolean | null;
  feelingUnwell: boolean;
  requestedHelp: boolean;
}

export interface IConversation extends Document {
  callLogId: Types.ObjectId;
  familyId: Types.ObjectId;
  familyMemberId: Types.ObjectId;
  doseInstanceId?: Types.ObjectId;
  interactionId?: string;
  language: string;
  turns: IConversationTurn[];
  patientResponses: IPatientResponses;
  finalAgentVariables?: Record<string, unknown>;
  aiSummary: string;
  safetyFlags: string[];
  createdAt: Date;
  updatedAt: Date;
}

const conversationTurnSchema = new Schema<IConversationTurn>(
  {
    speaker: { type: String, enum: ['AI', 'PATIENT'], required: true },
    text: { type: String, required: true },
    translatedText: { type: String },
    timestamp: { type: Date, default: Date.now },
    intent: { type: String, trim: true },
  },
  { _id: false }
);

const conversationSchema = new Schema<IConversation>(
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
      index: true,
    },
    doseInstanceId: { type: Schema.Types.ObjectId, ref: 'DoseInstance' },
    interactionId: { type: String, trim: true },
    language: { type: String, required: true },
    turns: { type: [conversationTurnSchema], default: [] },
    patientResponses: {
      mealFinished: { type: Boolean, default: null },
      delayMinutes: { type: Number },
      medicineTaken: { type: Boolean, default: null },
      feelingUnwell: { type: Boolean, default: false },
      requestedHelp: { type: Boolean, default: false },
    },
    finalAgentVariables: { type: Schema.Types.Mixed },
    aiSummary: { type: String, required: true, maxlength: 2000 },
    safetyFlags: [{ type: String }],
  },
  { timestamps: true }
);

export const Conversation = mongoose.model<IConversation>('Conversation', conversationSchema);

