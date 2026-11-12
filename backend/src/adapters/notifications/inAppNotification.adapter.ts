import {
  INotificationAdapter,
  NotificationDispatchPayload,
  NotificationDispatchResult,
} from './notificationAdapter.interface';

export class InAppNotificationAdapter implements INotificationAdapter {
  public readonly channel = 'IN_APP' as const;

  isConfigured(): boolean {
    return true;
  }

  async send(payload: NotificationDispatchPayload): Promise<NotificationDispatchResult> {
    return {
      channel: 'IN_APP',
      status: 'DELIVERED',
      providerMetadata: {
        deliveredAt: new Date().toISOString(),
        recipient: payload.recipientContact,
      },
    };
  }
}

