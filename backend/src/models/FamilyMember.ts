import mongoose, { Document, Schema, Types } from 'mongoose';
import { CONSENT_STATUSES, ConsentStatus } from '../constants/statuses';
import { LANGUAGE_CODES } from '../constants/languages';

export interface IEmergencyContact {
  name: string;
  phoneNumber: string;
  relationship: string;
}

export interface ICallingPreferences {
  quietHoursStart: string;
  quietHoursEnd: string;
  maxRetries: number;
  retryIntervalMinutes: number;
  allowMealReminders: boolean;
  allowMedicineReminders: boolean;
  allowConfirmationCalls: boolean;
  preferredVoiceGender: 'FEMALE' | 'MALE' | 'NEUTRAL';
}

export interface IFamilyMember extends Document {
  familyId: Types.ObjectId;
  fullName: string;
  phoneNumber: string;
  age?: number;
  preferredLanguage: string;
  timezone: string;
  relationship: string;
  emergencyContact: IEmergencyContact;
  callingPreferences: ICallingPreferences;
  recordingConsentStatus: ConsentStatus;
  voiceCallingConsentStatus: ConsentStatus;
  isActive: boolean;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const familyMemberSchema = new Schema<IFamilyMember>(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true, index: true },
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    phoneNumber: { type: String, required: true, trim: true },
    age: { type: Number, min: 0, max: 130 },
    preferredLanguage: {
      type: String,
      required: true,
      default: 'en',
      enum: LANGUAGE_CODES,
    },
    timezone: { type: String, required: true, default: 'Asia/Kolkata' },
    relationship: { type: String, required: true, trim: true, maxlength: 60 },
    emergencyContact: {
      name: { type: String, required: true, trim: true, maxlength: 120 },
      phoneNumber: { type: String, required: true, trim: true },
      relationship: { type: String, required: true, trim: true, maxlength: 60 },
    },
    callingPreferences: {
      quietHoursStart: { type: String, default: '22:00' },
      quietHoursEnd: { type: String, default: '06:30' },
      maxRetries: { type: Number, default: 2, min: 0, max: 5 },
      retryIntervalMinutes: { type: Number, default: 10, min: 5, max: 60 },
      allowMealReminders: { type: Boolean, default: true },
      allowMedicineReminders: { type: Boolean, default: true },
      allowConfirmationCalls: { type: Boolean, default: true },
      preferredVoiceGender: {
        type: String,
        enum: ['FEMALE', 'MALE', 'NEUTRAL'],
        default: 'FEMALE',
      },
    },
    recordingConsentStatus: {
      type: String,
      enum: CONSENT_STATUSES,
      default: 'PENDING',
    },
    voiceCallingConsentStatus: {
      type: String,
      enum: CONSENT_STATUSES,
      default: 'GRANTED',
    },
    isActive: { type: Boolean, default: true },
    notes: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true }
);

familyMemberSchema.index({ familyId: 1, phoneNumber: 1 }, { unique: true });
familyMemberSchema.index({ familyId: 1, isActive: 1 });

export const FamilyMember = mongoose.model<IFamilyMember>('FamilyMember', familyMemberSchema);

