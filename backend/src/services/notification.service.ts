import { ClientSession, Types } from 'mongoose';
import { InAppNotificationAdapter } from '../adapters/notifications/inAppNotification.adapter';
import { SmsNotificationAdapter } from '../adapters/notifications/smsNotification.adapter';
import { WhatsAppNotificationAdapter } from '../adapters/notifications/whatsappNotification.adapter';
import { NotificationChannel, NotificationTrigger } from '../constants/statuses';
import { Consent } from '../models/Consent';
import { Family } from '../models/Family';
import { FamilyMember } from '../models/FamilyMember';
import { Notification } from '../models/Notification';
import { NotFoundError } from '../utils/errors';

const inAppAdapter = new InAppNotificationAdapter();
const whatsappAdapter = new WhatsAppNotificationAdapter();
const smsAdapter = new SmsNotificationAdapter();

export function getNotificationAdapterStatus() {
  return {
    inApp: { enabled: true, configured: inAppAdapter.isConfigured() },
    whatsapp: { enabled: whatsappAdapter.isConfigured(), configured: whatsappAdapter.isConfigured() },
    sms: { enabled: smsAdapter.isConfigured(), configured: smsAdapter.isConfigured() },
  };
}

export async function dispatchFamilyAlert(
  input: {
    familyId: string | Types.ObjectId;
    familyMemberId: string | Types.ObjectId;
    doseInstanceId?: string | Types.ObjectId;
    callLogId?: string | Types.ObjectId;
    escalationId?: string | Types.ObjectId;
    triggerType: NotificationTrigger;
    title: string;
    message: string;
    channels?: NotificationChannel[];
  },
  session?: ClientSession
) {
  const familyObjectId = new Types.ObjectId(String(input.familyId));
  const memberObjectId = new Types.ObjectId(String(input.familyMemberId));

  const [family, member, consents] = await Promise.all([
    Family.findById(familyObjectId).lean(),
    FamilyMember.findById(memberObjectId).lean(),
    Consent.find({
      familyId: familyObjectId,
      familyMemberId: memberObjectId,
      consentType: { $in: ['WHATSAPP_ALERTS', 'SMS_ALERTS'] },
    }).lean(),
  ]);

  const recipientName = member?.emergencyContact?.name || family?.primaryContactName || 'Family Caregiver';
  const recipientPhone =
    member?.emergencyContact?.phoneNumber || family?.primaryContactPhone || 'In-app contact';
  const recipientEmail = family?.primaryContactEmail || 'caregiver@family';

  const whatsappConsent = consents.some(
    (c) => c.consentType === 'WHATSAPP_ALERTS' && c.status === 'GRANTED'
  );
  const smsConsent = consents.some(
    (c) => c.consentType === 'SMS_ALERTS' && c.status === 'GRANTED'
  );

  const targetChannels: NotificationChannel[] = input.channels ?? ['IN_APP', 'WHATSAPP', 'SMS'];
  const createdRecords = [];

  for (const ch of targetChannels) {
    let result;
    if (ch === 'IN_APP') {
      result = await inAppAdapter.send({
        recipientName,
        recipientContact: recipientEmail,
        title: input.title,
        message: input.message,
        consentGranted: true,
      });
    } else if (ch === 'WHATSAPP') {
      result = await whatsappAdapter.send({
        recipientName,
        recipientContact: recipientPhone,
        title: input.title,
        message: input.message,
        consentGranted: whatsappConsent,
      });
    } else {
      result = await smsAdapter.send({
        recipientName,
        recipientContact: recipientPhone,
        title: input.title,
        message: input.message,
        consentGranted: smsConsent,
      });
    }

    const [created] = await Notification.create(
      [
        {
          familyId: familyObjectId,
          familyMemberId: memberObjectId,
          doseInstanceId: input.doseInstanceId
            ? new Types.ObjectId(String(input.doseInstanceId))
            : undefined,
          callLogId: input.callLogId ? new Types.ObjectId(String(input.callLogId)) : undefined,
          escalationId: input.escalationId
            ? new Types.ObjectId(String(input.escalationId))
            : undefined,
          channel: ch,
          triggerType: input.triggerType,
          recipientName,
          recipientContact: ch === 'IN_APP' ? recipientEmail : recipientPhone,
          title: input.title,
          message: input.message,
          status: result.status,
          isRead: false,
          providerMetadata: result.providerMetadata,
        },
      ],
      session ? { session } : undefined
    );
    createdRecords.push(created);
  }

  return createdRecords;
}

export async function listNotifications(
  familyId: string,
  filters?: { channel?: NotificationChannel; unreadOnly?: boolean }
) {
  const query: Record<string, unknown> = { familyId: new Types.ObjectId(familyId) };
  if (filters?.channel) query.channel = filters.channel;
  if (filters?.unreadOnly) query.isRead = false;

  const notifications = await Notification.find(query)
    .populate('familyMemberId', 'fullName relationship')
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  return {
    notifications,
    adapterStatus: getNotificationAdapterStatus(),
  };
}

export async function markNotificationRead(familyId: string, notificationId: string) {
  const notif = await Notification.findOneAndUpdate(
    {
      _id: new Types.ObjectId(notificationId),
      familyId: new Types.ObjectId(familyId),
    },
    { isRead: true, readAt: new Date() },
    { new: true }
  );
  if (!notif) throw new NotFoundError('Notification');
  return notif;
}

export async function markAllNotificationsRead(familyId: string) {
  await Notification.updateMany(
    { familyId: new Types.ObjectId(familyId), isRead: false },
    { isRead: true, readAt: new Date() }
  );
  return { updated: true };
}

