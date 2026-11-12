import { env } from '../../config/env';
import {
  INotificationAdapter,
  NotificationDispatchPayload,
  NotificationDispatchResult,
} from './notificationAdapter.interface';

export class WhatsAppNotificationAdapter implements INotificationAdapter {
  public readonly channel = 'WHATSAPP' as const;

  isConfigured(): boolean {
    return Boolean(
      env.WHATSAPP_ENABLED && env.WHATSAPP_PROVIDER_URL && env.WHATSAPP_API_TOKEN
    );
  }

  async send(payload: NotificationDispatchPayload): Promise<NotificationDispatchResult> {
    if (!payload.consentGranted) {
      return {
        channel: 'WHATSAPP',
        status: 'SKIPPED_NO_CONSENT',
        providerMetadata: { reason: 'WHATSAPP_ALERTS consent is not granted' },
      };
    }

    if (!this.isConfigured()) {
      return {
        channel: 'WHATSAPP',
        status: 'SKIPPED_NO_CONFIG',
        providerMetadata: {
          reason: 'WhatsApp credentials not configured (WHATSAPP_ENABLED=false)',
        },
      };
    }

    try {
      const response = await fetch(env.WHATSAPP_PROVIDER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.WHATSAPP_API_TOKEN}`,
        },
        body: JSON.stringify({
          to: payload.recipientContact,
          title: payload.title,
          message: payload.message,
        }),
      });

      if (!response.ok) {
        return {
          channel: 'WHATSAPP',
          status: 'FAILED',
          providerMetadata: { httpStatus: response.status },
        };
      }

      return {
        channel: 'WHATSAPP',
        status: 'SENT',
        providerMetadata: { sentAt: new Date().toISOString() },
      };
    } catch (err) {
      return {
        channel: 'WHATSAPP',
        status: 'FAILED',
        providerMetadata: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  }
}

