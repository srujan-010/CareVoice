import mongoose, { Document, Schema, Types } from 'mongoose';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUSES,
  NOTIFICATION_TRIGGERS,
  NotificationChannel,
  NotificationStatus,
  NotificationTrigger,
} from '../constants/statuses';

export interface INotification extends Document {
  familyId: Types.ObjectId;
  familyMemberId: Types.ObjectId;
  doseInstanceId?: Types.ObjectId;
  callLogId?: Types.ObjectId;
  escalationId?: Types.ObjectId;
  channel: NotificationChannel;
  triggerType: NotificationTrigger;
  recipientName: string;
  recipientContact: string;
  title: string;
  message: string;
  status: NotificationStatus;
  isRead: boolean;
  readAt?: Date;
  providerMetadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
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
    escalationId: { type: Schema.Types.ObjectId, ref: 'Escalation' },
    channel: { type: String, enum: NOTIFICATION_CHANNELS, required: true },
    triggerType: { type: String, enum: NOTIFICATION_TRIGGERS, required: true },
    recipientName: { type: String, required: true, trim: true },
    recipientContact: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    message: { type: String, required: true, trim: true, maxlength: 1000 },
    status: {
      type: String,
      enum: NOTIFICATION_STATUSES,
      default: 'PENDING',
      required: true,
    },
    isRead: { type: Boolean, default: false },
    readAt: { type: Date },
    providerMetadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

notificationSchema.index({ familyId: 1, createdAt: -1, isRead: 1 });

export const Notification = mongoose.model<INotification>('Notification', notificationSchema);

