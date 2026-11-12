import mongoose, { Document, Schema, Types } from 'mongoose';
import {
  ESCALATION_REASONS,
  ESCALATION_SEVERITIES,
  ESCALATION_STATUSES,
  EscalationReason,
  EscalationSeverity,
  EscalationStatus,
} from '../constants/statuses';

export interface IEscalation extends Document {
  familyId: Types.ObjectId;
  familyMemberId: Types.ObjectId;
  doseInstanceId?: Types.ObjectId;
  callLogId?: Types.ObjectId;
  reason: EscalationReason;
  severity: EscalationSeverity;
  status: EscalationStatus;
  description: string;
  acknowledgedByUserId?: Types.ObjectId;
  resolvedByUserId?: Types.ObjectId;
  resolutionNotes?: string;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const escalationSchema = new Schema<IEscalation>(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true, index: true },
    familyMemberId: {
      type: Schema.Types.ObjectId,
      ref: 'FamilyMember',
      required: true,
      index: true,
    },
    doseInstanceId: { type: Schema.Types.ObjectId, ref: 'DoseInstance' },
    callLogId: { type: Schema.Types.ObjectId, ref: 'CallLog' },
    reason: { type: String, enum: ESCALATION_REASONS, required: true },
    severity: { type: String, enum: ESCALATION_SEVERITIES, default: 'HIGH', required: true },
    status: { type: String, enum: ESCALATION_STATUSES, default: 'OPEN', required: true },
    description: { type: String, required: true, trim: true, maxlength: 1000 },
    acknowledgedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    resolvedByUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    resolutionNotes: { type: String, trim: true, maxlength: 1000 },
    resolvedAt: { type: Date },
  },
  { timestamps: true }
);

escalationSchema.index({ familyId: 1, status: 1, createdAt: -1 });

export const Escalation = mongoose.model<IEscalation>('Escalation', escalationSchema);

