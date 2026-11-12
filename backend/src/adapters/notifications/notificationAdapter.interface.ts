import { NotificationChannel, NotificationStatus } from '../../constants/statuses';

export interface NotificationDispatchPayload {
  recipientName: string;
  recipientContact: string;
  title: string;
  message: string;
  consentGranted: boolean;
}

export interface NotificationDispatchResult {
  channel: NotificationChannel;
  status: NotificationStatus;
  providerMetadata?: Record<string, unknown>;
}

export interface INotificationAdapter {
  readonly channel: NotificationChannel;
  isConfigured(): boolean;
  send(payload: NotificationDispatchPayload): Promise<NotificationDispatchResult>;
}

