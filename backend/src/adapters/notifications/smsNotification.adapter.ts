import { env } from '../../config/env';
import {
  INotificationAdapter,
  NotificationDispatchPayload,
  NotificationDispatchResult,
} from './notificationAdapter.interface';

export class SmsNotificationAdapter implements INotificationAdapter {
  public readonly channel = 'SMS' as const;

  isConfigured(): boolean {
    return Boolean(env.SMS_ENABLED && env.SMS_PROVIDER_URL && env.SMS_API_TOKEN);
  }

  async send(payload: NotificationDispatchPayload): Promise<NotificationDispatchResult> {
    if (!payload.consentGranted) {
      return {
        channel: 'SMS',
        status: 'SKIPPED_NO_CONSENT',
        providerMetadata: { reason: 'SMS_ALERTS consent is not granted' },
      };
    }

    if (!this.isConfigured()) {
      return {
        channel: 'SMS',
        status: 'SKIPPED_NO_CONFIG',
        providerMetadata: {
          reason: 'SMS credentials not configured (SMS_ENABLED=false)',
        },
      };
    }

    try {
      const response = await fetch(env.SMS_PROVIDER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.SMS_API_TOKEN}`,
        },
        body: JSON.stringify({
          to: payload.recipientContact,
          message: `${payload.title}: ${payload.message}`,
        }),
      });

      if (!response.ok) {
        return {
          channel: 'SMS',
          status: 'FAILED',
          providerMetadata: { httpStatus: response.status },
        };
      }

      return {
        channel: 'SMS',
        status: 'SENT',
        providerMetadata: { sentAt: new Date().toISOString() },
      };
    } catch (err) {
      return {
        channel: 'SMS',
        status: 'FAILED',
        providerMetadata: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  }
}

