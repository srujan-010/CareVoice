import { env, getSarvamWebhookReadiness, isTelephonyReady } from '../../config/env';
import { AppError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { normalizeAndValidateE164 } from '../../utils/phone';
import {
  IVoiceProvider,
  MockCallScenario,
  VoiceCallContextPayload,
  VoiceCallExecutionResult,
} from './voiceProvider.interface';

export interface SarvamOutboundRequestPayload {
  app_config: {
    app_id: string;
    app_version: number;
    connection_config: {
      connection_id: string;
      agent_phone_number: string;
    };
  };
  user_config: {
    user_phone_number: string;
  };
  webhook_config?: {
    url: string;
    metadata: {
      patient_id: string;
      dose_id: string;
      call_log_id: string;
      family_id: string;
      call_type: string;
      language: string;
    };
  };
}

/**
 * Official Sarvam AI Voice Agents Instant Outbound Call Adapter.
 * Documentation: https://docs.sarvam.ai/voice-agents/api/instant-outbound/create
 *
 * Security & Safety Guardrails:
 * - Real telephony stays strictly disabled unless VOICE_PROVIDER_MODE=sarvam AND
 *   TELEPHONY_ENABLED=true AND all required Sarvam credentials + E.164 phone number exist.
 * - Never invents undocumented endpoints.
 * - Never logs API keys, authorization headers, or high-entropy webhook route tokens.
 */
export class SarvamVoiceProvider implements IVoiceProvider {
  public readonly providerName = 'sarvam' as const;

  isConfigured(): boolean {
    return isTelephonyReady().ready;
  }

  getStatus() {
    const info = isTelephonyReady();
    const webhookInfo = getSarvamWebhookReadiness();
    return {
      provider: 'sarvam' as const,
      configured: info.ready,
      telephonyEnabled: env.TELEPHONY_ENABLED,
      missingFields: info.missingFields,
      webhookReady: webhookInfo.ready,
      missingWebhookFields: webhookInfo.missingFields,
    };
  }

  public getOutboundEndpointUrl(): string {
    const baseUrl = env.SARVAM_API_BASE_URL.replace(/\/$/, '');
    const orgId = encodeURIComponent(env.SARVAM_ORG_ID);
    const workspaceId = encodeURIComponent(env.SARVAM_WORKSPACE_ID);
    return `${baseUrl}/api/outbounds/v1/orgs/${orgId}/workspaces/${workspaceId}/outbounds`;
  }

  public buildOutboundPayload(context: VoiceCallContextPayload): SarvamOutboundRequestPayload {
    const agentPhoneNumber = normalizeAndValidateE164(
      env.SARVAM_PHONE_NUMBER,
      'SARVAM_PHONE_NUMBER'
    );
    const userPhoneNumber = normalizeAndValidateE164(
      context.phoneNumber,
      'user_config.user_phone_number'
    );

    const appVersion = env.SARVAM_AGENT_VERSION;
    if (!Number.isInteger(appVersion) || appVersion < 1) {
      throw new AppError(
        'SARVAM_AGENT_VERSION must resolve to a positive integer app_version',
        500,
        'INVALID_SARVAM_AGENT_VERSION'
      );
    }

    const requestBody: SarvamOutboundRequestPayload = {
      app_config: {
        app_id: env.SARVAM_AGENT_ID,
        app_version: appVersion,
        connection_config: {
          connection_id: env.SARVAM_CONNECTION_ID,
          agent_phone_number: agentPhoneNumber,
        },
      },
      user_config: {
        user_phone_number: userPhoneNumber,
      },
    };

    if (env.PUBLIC_WEBHOOK_BASE_URL) {
      const webhookBase = env.PUBLIC_WEBHOOK_BASE_URL.replace(/\/$/, '');
      let webhookUrl: string;

      if (env.SARVAM_WEBHOOK_TOKEN) {
        webhookUrl = `${webhookBase}/api/voice-agent/webhook/sarvam/${encodeURIComponent(
          env.SARVAM_WEBHOOK_TOKEN
        )}`;
      } else if (env.SARVAM_WEBHOOK_SECRET) {
        webhookUrl = `${webhookBase}/api/voice-agent/webhook/sarvam`;
      } else {
        throw new AppError(
          'Refusing to configure Sarvam webhook without SARVAM_WEBHOOK_TOKEN (or SARVAM_WEBHOOK_SECRET)',
          503,
          'WEBHOOK_AUTH_NOT_CONFIGURED'
        );
      }

      requestBody.webhook_config = {
        url: webhookUrl,
        metadata: {
          patient_id: context.familyMemberId,
          dose_id: context.doseInstanceId,
          call_log_id: context.callLogId,
          family_id: context.familyId,
          call_type: context.callType,
          language: context.languageBcp47,
        },
      };
    }

    return requestBody;
  }

  async initiateLiveCall(context: VoiceCallContextPayload): Promise<{
    accepted: boolean;
    attemptId: string;
    providerCallId: string;
    rawStatus: string;
  }> {
    const status = this.getStatus();
    if (!status.configured) {
      throw new AppError(
        `Sarvam live telephony is disabled or missing configuration: ${status.missingFields.join(', ')}`,
        503,
        'TELEPHONY_DISABLED'
      );
    }

    const url = this.getOutboundEndpointUrl();
    const requestBody = this.buildOutboundPayload(context);

    logger.info('Dispatching outbound call via official Sarvam Instant Outbound API', {
      callLogId: context.callLogId,
      patientId: context.familyMemberId,
      doseId: context.doseInstanceId,
      languageBcp47: context.languageBcp47,
      callType: context.callType,
      appVersion: requestBody.app_config.app_version,
      hasWebhookConfig: Boolean(requestBody.webhook_config),
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': env.SARVAM_API_KEY,
      },
      body: JSON.stringify(requestBody),
    });

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      logger.warn('Sarvam outbound API returned non-2xx status', {
        statusCode: response.status,
        callLogId: context.callLogId,
        patientId: context.familyMemberId,
        doseId: context.doseInstanceId,
      });
      throw new AppError(
        `Sarvam telephony call request failed (${response.status})`,
        502,
        'SARVAM_PROVIDER_ERROR',
        {
          upstreamStatus: response.status,
          detail: typeof payload.detail === 'string' ? payload.detail : undefined,
        }
      );
    }

    const attemptId =
      typeof payload.attempt_id === 'string' ? payload.attempt_id.trim() : '';

    if (!attemptId) {
      throw new AppError(
        'Sarvam Instant Outbound API response did not include attempt_id',
        502,
        'SARVAM_INVALID_RESPONSE'
      );
    }

    return {
      accepted: true,
      attemptId,
      providerCallId: attemptId,
      rawStatus: typeof payload.status === 'string' && payload.status ? payload.status : 'INITIATED',
    };
  }

  async simulateCall(
    _context: VoiceCallContextPayload,
    _scenario: MockCallScenario
  ): Promise<VoiceCallExecutionResult> {
    throw new AppError(
      'Simulation is only available on MockVoiceProvider',
      400,
      'SIMULATION_NOT_SUPPORTED_ON_LIVE'
    );
  }
}
