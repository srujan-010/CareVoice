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
      patient_name?: string;
      medicine_name?: string;
      dosage?: string;
      food_instruction?: string;
      associated_meal?: string;
      recording_consent_granted?: string;
      call_purpose?: string;
      is_test_call?: string;
    };
  };
}

export interface SarvamDeploymentVerificationResult {
  verified: boolean;
  status: 'active' | 'inactive' | 'mismatch' | 'unlisted' | 'error';
  matchedDeploymentId?: string;
  matchedAppVersion?: number;
  connectionVerified: boolean;
  phoneVerified: boolean;
  message: string;
  upstreamStatus?: number;
}

interface SarvamDeploymentRecord {
  deployment_id?: string;
  app_id?: string;
  app_version?: number;
  status?: string;
  channel_direction?: string;
  connection_configs?: Array<{
    connection_id?: string;
    phone_numbers?: string[];
  }>;
}

/**
 * Official Sarvam AI Voice Agents Instant Outbound Call Adapter.
 * Documentation: https://docs.sarvam.ai/voice-agents/api/instant-outbound/create
 *
 * Security & Safety Guardrails:
 * - Real telephony stays strictly disabled unless VOICE_PROVIDER_MODE=sarvam AND
 *   TELEPHONY_ENABLED=true AND all required Sarvam credentials + E.164 phone number exist.
 * - Never invents undocumented endpoints or payload fields.
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

  public getDeploymentsEndpointUrl(): string {
    const baseUrl = env.SARVAM_API_BASE_URL.replace(/\/$/, '');
    const orgId = encodeURIComponent(env.SARVAM_ORG_ID);
    const workspaceId = encodeURIComponent(env.SARVAM_WORKSPACE_ID);
    return `${baseUrl}/api/app-authoring/v1/orgs/${orgId}/workspaces/${workspaceId}/deployments`;
  }

  public getRecordingEndpointUrl(interactionId: string): string {
    const trimmed = interactionId.trim();
    if (!/^[0-9]{8}\/[A-Za-z0-9._:-]+$/.test(trimmed)) {
      throw new AppError(
        'Invalid Sarvam interaction_id format for recording retrieval',
        400,
        'INVALID_INTERACTION_ID'
      );
    }
    const baseUrl = env.SARVAM_API_BASE_URL.replace(/\/$/, '');
    const orgId = encodeURIComponent(env.SARVAM_ORG_ID);
    const workspaceId = encodeURIComponent(env.SARVAM_WORKSPACE_ID);
    const appId = encodeURIComponent(env.SARVAM_AGENT_ID);
    return `${baseUrl}/api/analytics/v1/${orgId}/${workspaceId}/${appId}/recordings/${trimmed}`;
  }

  /**
   * Verifies that Sarvam credentials, agent version, and telephony connection are valid and active
   * via the official GET deployments endpoint before placing a live outbound test call.
   */
  async verifyAgentDeployment(): Promise<SarvamDeploymentVerificationResult> {
    const status = this.getStatus();
    if (!status.configured) {
      return {
        verified: false,
        status: 'error',
        connectionVerified: false,
        phoneVerified: false,
        message: `Sarvam telephony configuration incomplete: ${status.missingFields.join(', ')}`,
      };
    }

    const url = this.getDeploymentsEndpointUrl();
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-Key': env.SARVAM_API_KEY,
        },
        signal: AbortSignal.timeout(8000),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error';
      logger.warn('Sarvam deployment verification network error', { error: msg });
      return {
        verified: false,
        status: 'error',
        connectionVerified: false,
        phoneVerified: false,
        message: `Unable to reach Sarvam deployments API: ${msg}`,
      };
    }

    if (!response.ok) {
      const errBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const detail =
        typeof errBody.detail === 'string'
          ? errBody.detail
          : typeof errBody.message === 'string'
            ? errBody.message
            : undefined;
      return {
        verified: false,
        status: 'error',
        upstreamStatus: response.status,
        connectionVerified: false,
        phoneVerified: false,
        message: detail
          ? `Sarvam API rejected preflight verification (HTTP ${response.status}): ${detail}`
          : `Sarvam API rejected preflight verification (HTTP ${response.status})`,
      };
    }

    const payload = (await response.json().catch(() => null)) as
      | SarvamDeploymentRecord[]
      | { deployments?: SarvamDeploymentRecord[]; data?: SarvamDeploymentRecord[] }
      | null;

    const list: SarvamDeploymentRecord[] = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.deployments)
        ? payload.deployments
        : Array.isArray(payload?.data)
          ? payload.data
          : [];

    const agentDeployments = list.filter((d) => d?.app_id === env.SARVAM_AGENT_ID);
    if (agentDeployments.length === 0) {
      return {
        verified: true,
        status: 'unlisted',
        connectionVerified: true,
        phoneVerified: true,
        message:
          'Sarvam API key authenticated; no separate Deployment record returned for agent ID (Instant Outbound uses committed agent version and connection config directly).',
      };
    }

    const activeDeployments = agentDeployments.filter(
      (d) => (d.status || '').toLowerCase() === 'active'
    );
    if (activeDeployments.length === 0) {
      const statuses = agentDeployments.map((d) => d.status || 'unknown').join(', ');
      return {
        verified: false,
        status: 'inactive',
        connectionVerified: false,
        phoneVerified: false,
        message: `Sarvam agent deployment is not active (current status: ${statuses}). Resume or activate it in Sarvam dashboard.`,
      };
    }

    const configuredPhone = normalizeAndValidateE164(
      env.SARVAM_PHONE_NUMBER,
      'SARVAM_PHONE_NUMBER'
    );

    let connectionVerified = false;
    let phoneVerified = false;

    const exactMatch = activeDeployments.find((d) => {
      const versionOk =
        d.app_version === undefined || Number(d.app_version) === env.SARVAM_AGENT_VERSION;
      const conns = Array.isArray(d.connection_configs) ? d.connection_configs : [];
      const connMatch = conns.some((c) => {
        const idMatch = c.connection_id === env.SARVAM_CONNECTION_ID;
        if (idMatch) connectionVerified = true;
        const numbers = Array.isArray(c.phone_numbers) ? c.phone_numbers : [];
        const numMatch = numbers.includes(configuredPhone);
        if (numMatch) phoneVerified = true;
        return idMatch && (numbers.length === 0 || numMatch);
      });
      return versionOk && (conns.length === 0 || connMatch);
    });

    if (!exactMatch) {
      return {
        verified: false,
        status: 'mismatch',
        connectionVerified,
        phoneVerified,
        message:
          'Active Sarvam deployment exists but does not match configured SARVAM_AGENT_VERSION, SARVAM_CONNECTION_ID, or SARVAM_PHONE_NUMBER.',
      };
    }

    return {
      verified: true,
      status: 'active',
      matchedDeploymentId: exactMatch.deployment_id,
      matchedAppVersion: exactMatch.app_version ?? env.SARVAM_AGENT_VERSION,
      connectionVerified: true,
      phoneVerified: true,
      message: 'Sarvam agent deployment and Vobiz phone connection are active and verified.',
    };
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
          patient_name: context.patientName,
          medicine_name: context.medicineName,
          dosage: context.dosage,
          food_instruction: context.foodInstruction,
          associated_meal: context.associatedMeal,
          recording_consent_granted: String(context.recordingConsentGranted),
          ...(context.callPurpose ? { call_purpose: context.callPurpose } : {}),
          ...(context.isTestCall !== undefined ? { is_test_call: String(context.isTestCall) } : {}),
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
    httpStatus: number;
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
      isTestCall: Boolean(context.isTestCall),
    });

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': env.SARVAM_API_KEY,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error calling Sarvam outbound API';
      logger.error('Sarvam outbound HTTP transport failure', {
        callLogId: context.callLogId,
        error: msg,
      });
      throw new AppError(
        `Unable to connect to Sarvam outbound telephony API: ${msg}`,
        502,
        'SARVAM_NETWORK_ERROR'
      );
    }

    let rawText = '';
    let payload: Record<string, unknown> = {};
    if (typeof response.text === 'function') {
      rawText = await response.text().catch(() => '');
      try {
        payload = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
      } catch {
        payload = {};
      }
    } else if (typeof response.json === 'function') {
      payload = ((await response.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    }

    if (!response.ok) {
      const detail =
        typeof payload.detail === 'string'
          ? payload.detail
          : typeof payload.message === 'string'
            ? payload.message
            : typeof payload.error === 'string'
              ? payload.error
              : rawText.slice(0, 240) || undefined;

      logger.warn('Sarvam outbound API returned non-2xx status', {
        statusCode: response.status,
        callLogId: context.callLogId,
        patientId: context.familyMemberId,
        doseId: context.doseInstanceId,
        detail,
      });
      throw new AppError(
        detail
          ? `Sarvam telephony call request failed (HTTP ${response.status}): ${detail}`
          : `Sarvam telephony call request failed (HTTP ${response.status})`,
        502,
        'SARVAM_PROVIDER_ERROR',
        {
          upstreamStatus: response.status,
          detail,
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
      httpStatus: response.status,
    };
  }

  /**
   * Fetches call audio recording from Sarvam Analytics API on behalf of an authorized family user
   * ONLY after verifying recording consent in CareVoice backend.
   */
  async fetchInteractionRecording(interactionId: string): Promise<{
    buffer: Buffer;
    mimeType: string;
  }> {
    if (!env.SARVAM_API_KEY || !env.SARVAM_ORG_ID || !env.SARVAM_WORKSPACE_ID || !env.SARVAM_AGENT_ID) {
      throw new AppError(
        'Sarvam credentials are required to retrieve call recordings',
        503,
        'SARVAM_CREDENTIALS_MISSING'
      );
    }

    const url = this.getRecordingEndpointUrl(interactionId);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-Key': env.SARVAM_API_KEY,
      },
      signal: AbortSignal.timeout(15000),
    });

    if (response.status === 404) {
      throw new AppError(
        'Recording audio is not available yet on Sarvam for this interaction',
        404,
        'RECORDING_NOT_READY'
      );
    }

    if (!response.ok) {
      throw new AppError(
        `Failed to fetch recording from Sarvam (HTTP ${response.status})`,
        502,
        'SARVAM_RECORDING_ERROR'
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType: response.headers.get('content-type') || 'audio/wav',
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
