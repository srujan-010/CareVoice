import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IAuditLog extends Document {
  familyId?: Types.ObjectId;
  actorType: 'USER' | 'VOICE_AGENT' | 'SYSTEM' | 'WEBHOOK';
  actorId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', index: true },
    actorType: {
      type: String,
      enum: ['USER', 'VOICE_AGENT', 'SYSTEM', 'WEBHOOK'],
      required: true,
    },
    actorId: { type: String, required: true },
    action: { type: String, required: true, trim: true },
    resourceType: { type: String, required: true, trim: true },
    resourceId: { type: String, trim: true },
    ipAddress: { type: String, trim: true },
    metadata: { type: Schema.Types.Mixed },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

auditLogSchema.index({ familyId: 1, createdAt: -1 });

export const AuditLog = mongoose.model<IAuditLog>('AuditLog', auditLogSchema);

