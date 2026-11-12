import mongoose, { Document, Schema, Types } from 'mongoose';
import {
  CONSENT_STATUSES,
  CONSENT_TYPES,
  ConsentStatus,
  ConsentType,
} from '../constants/statuses';

export interface IConsent extends Document {
  familyId: Types.ObjectId;
  familyMemberId: Types.ObjectId;
  consentType: ConsentType;
  status: ConsentStatus;
  grantedByUserId?: Types.ObjectId;
  grantedByName?: string;
  method: 'DASHBOARD' | 'VERBAL_CALL' | 'WRITTEN';
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const consentSchema = new Schema<IConsent>(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true, index: true },
    familyMemberId: {
      type: Schema.Types.ObjectId,
      ref: 'FamilyMember',
      required: true,
      index: true,
    },
    consentType: { type: String, enum: CONSENT_TYPES, required: true },
    status: { type: String, enum: CONSENT_STATUSES, required: true, default: 'PENDING' },
    grantedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    grantedByName: { type: String, trim: true },
    method: {
      type: String,
      enum: ['DASHBOARD', 'VERBAL_CALL', 'WRITTEN'],
      default: 'DASHBOARD',
    },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

consentSchema.index({ familyMemberId: 1, consentType: 1 }, { unique: true });

export const Consent = mongoose.model<IConsent>('Consent', consentSchema);

