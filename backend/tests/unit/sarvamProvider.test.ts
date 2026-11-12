import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VoiceCallContextPayload } from '../../src/adapters/voice/voiceProvider.interface';

const sampleContext: VoiceCallContextPayload = {
  callLogId: 'call_log_001',
  familyId: 'family_001',
  familyMemberId: 'member_001',
  patientName: 'Savitri Devi',
  phoneNumber: '+919876500001',
  languageCode: 'te',
  languageBcp47: 'te-IN',
  voiceGender: 'FEMALE',
  recordingConsentGranted: true,
  medicineId: 'med_001',
  medicineName: 'Metformin',
  dosage: '500mg',
  foodInstruction: 'BEFORE_FOOD',
  associatedMeal: 'BREAKFAST',
  prescribedInstructions: 'Take 1 tablet before breakfast',
  doseInstanceId: 'dose_001',
  callType: 'MEDICINE_REMINDER',
  scheduledAtIso: '2026-11-12T02:00:00.000Z',
  safetyDirectives: ['Never prescribe or adjust dosages.'],
};

describe('SarvamVoiceProvider, Env Validation & Safety Guardrails', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('keeps live telephony disabled by default and even when Sarvam IDs exist without activation flags', async () => {
    vi.resetModules();
    vi.stubEnv('TELEPHONY_ENABLED', 'false');
    vi.stubEnv('VOICE_PROVIDER_MODE', 'mock');
    vi.stubEnv('SARVAM_WORKSPACE_ID', '');
    vi.stubEnv('SARVAM_PHONE_NUMBER', '');

    const { isTelephonyReady } = await import('../../src/config/env');
    const { SarvamVoiceProvider } = await import('../../src/adapters/voice/sarvamVoice.provider');
    const { getActiveVoiceProvider } = await import('../../src/services/sarvamVoice.service');

    const readiness = isTelephonyReady();
    expect(readiness.ready).toBe(false);
    expect(readiness.mode).toBe('mock');
    expect(readiness.missingFields).toEqual(
      expect.arrayContaining([
        'VOICE_PROVIDER_MODE=sarvam',
        'TELEPHONY_ENABLED=true',
        'SARVAM_WORKSPACE_ID',
        'SARVAM_PHONE_NUMBER',
      ])
    );

    expect(getActiveVoiceProvider().providerName).toBe('mock');

    const provider = new SarvamVoiceProvider();
    await expect(provider.initiateLiveCall(sampleContext)).rejects.toMatchObject({
      statusCode: 503,
      code: 'TELEPHONY_DISABLED',
    });

    vi.resetModules();
    vi.stubEnv('TELEPHONY_ENABLED', 'false');
    vi.stubEnv('VOICE_PROVIDER_MODE', 'mock');
    vi.stubEnv('SARVAM_API_KEY', 'test-sarvam-key');
    vi.stubEnv('SARVAM_ORG_ID', 'org-uuid-123');
    vi.stubEnv('SARVAM_WORKSPACE_ID', 'ws-uuid-456');
    vi.stubEnv('SARVAM_AGENT_ID', 'agent-id-789');
    vi.stubEnv('SARVAM_CONNECTION_ID', 'conn-id-abc');
    vi.stubEnv('SARVAM_PHONE_NUMBER', '+917965860596');

    const { isTelephonyReady: isReadyLocked } = await import('../../src/config/env');
    expect(isReadyLocked()).toEqual({
      ready: false,
      missingFields: ['VOICE_PROVIDER_MODE=sarvam', 'TELEPHONY_ENABLED=true'],
      mode: 'mock',
    });
  });

  it('validates strict E.164 phone numbers and positive integer SARVAM_AGENT_VERSION', async () => {
    const { isValidE164PhoneNumber, normalizeAndValidateE164 } = await import(
      '../../src/utils/phone'
    );

    expect(isValidE164PhoneNumber('+917965860596')).toBe(true);
    expect(isValidE164PhoneNumber('+14155550199')).toBe(true);
    expect(isValidE164PhoneNumber('9876543210')).toBe(false);
    expect(isValidE164PhoneNumber('+0919876543210')).toBe(false);
    expect(isValidE164PhoneNumber('+91123')).toBe(false);

    expect(normalizeAndValidateE164(' +91 98765-43210 ')).toBe('+919876543210');
    expect(() => normalizeAndValidateE164('9876543210')).toThrow(/E\.164/);

    vi.resetModules();
    vi.stubEnv('SARVAM_AGENT_VERSION', '1.5');
    await expect(import('../../src/config/env')).rejects.toThrow(/Environment validation failed/);

    vi.resetModules();
    vi.stubEnv('SARVAM_AGENT_VERSION', '');
    vi.stubEnv('SARVAM_PHONE_NUMBER', '7965860596');
    await expect(import('../../src/config/env')).rejects.toThrow(/Environment validation failed/);

    vi.resetModules();
    vi.stubEnv('SARVAM_AGENT_VERSION', '3');
    vi.stubEnv('SARVAM_PHONE_NUMBER', '+917965860596');
    const { env } = await import('../../src/config/env');
    expect(env.SARVAM_AGENT_VERSION).toBe(3);
  });

  it('dispatches official Sarvam outbound call payload with X-API-Key, webhook token URL & never logs secrets', async () => {
    vi.resetModules();
    const secretApiKey = 'sk_test_super_secret_key_999';
    const secretWebhookToken = 'wh_tok_super_secret_entropy_token_12345678';

    vi.stubEnv('TELEPHONY_ENABLED', 'true');
    vi.stubEnv('VOICE_PROVIDER_MODE', 'sarvam');
    vi.stubEnv('SARVAM_API_BASE_URL', 'https://apps.sarvam.ai');
    vi.stubEnv('SARVAM_API_KEY', secretApiKey);
    vi.stubEnv('SARVAM_ORG_ID', 'org-uuid-123');
    vi.stubEnv('SARVAM_WORKSPACE_ID', 'ws-uuid-456');
    vi.stubEnv('SARVAM_AGENT_ID', 'agent-id-789');
    vi.stubEnv('SARVAM_AGENT_VERSION', '2');
    vi.stubEnv('SARVAM_CONNECTION_ID', 'conn-id-abc');
    vi.stubEnv('SARVAM_PHONE_NUMBER', '+918012345678');
    vi.stubEnv('SARVAM_WEBHOOK_TOKEN', secretWebhookToken);
    vi.stubEnv('PUBLIC_WEBHOOK_BASE_URL', 'https://api.carevoice.example');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        attempt_id: 'attempt_xyz_001',
        status: 'QUEUED',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { isTelephonyReady } = await import('../../src/config/env');
    const { SarvamVoiceProvider } = await import('../../src/adapters/voice/sarvamVoice.provider');
    const { dispatchLiveVoiceCall } = await import('../../src/services/sarvamVoice.service');

    const readiness = isTelephonyReady();
    expect(readiness.ready).toBe(true);
    expect(readiness.mode).toBe('sarvam');

    const res = await dispatchLiveVoiceCall(sampleContext);
    expect(res).toEqual({
      accepted: true,
      attemptId: 'attempt_xyz_001',
      providerCallId: 'attempt_xyz_001',
      rawStatus: 'QUEUED',
      httpStatus: 200,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(
      'https://apps.sarvam.ai/api/outbounds/v1/orgs/org-uuid-123/workspaces/ws-uuid-456/outbounds'
    );
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe(secretApiKey);

    const parsedBody = JSON.parse(String(init.body));
    expect(parsedBody).toMatchObject({
      app_config: {
        app_id: 'agent-id-789',
        app_version: 2,
        connection_config: {
          connection_id: 'conn-id-abc',
          agent_phone_number: '+918012345678',
        },
        agent_variables: {
          patient_name: 'Savitri Devi',
          preferred_language: 'Telugu',
          language_name: 'Telugu',
          language_code: 'te',
          language_bcp47: 'te-IN',
          recommended_voice: 'Manisha',
          medicine_name: 'Metformin',
          dosage: '500mg',
          patient_id: 'member_001',
          dose_id: 'dose_001',
          call_log_id: 'call_log_001',
        },
        app_overrides: {
          initial_language_name: 'Telugu',
        },
      },
      user_config: {
        user_phone_number: '+919876500001',
      },
      webhook_config: {
        url: `https://api.carevoice.example/api/voice-agent/webhook/sarvam/${secretWebhookToken}`,
        metadata: {
          patient_id: 'member_001',
          dose_id: 'dose_001',
          call_log_id: 'call_log_001',
          family_id: 'family_001',
          call_type: 'MEDICINE_REMINDER',
          language: 'te-IN',
          preferred_language_name: 'Telugu',
          patient_name: 'Savitri Devi',
          medicine_name: 'Metformin',
          dosage: '500mg',
          food_instruction: 'BEFORE_FOOD',
          associated_meal: 'BREAKFAST',
          recording_consent_granted: 'true',
          transcript_consent_granted: 'true',
        },
      },
    });
    expect(parsedBody.app_config.app_overrides.initial_bot_message).toContain('నమస్కారం');
    expect(parsedBody.app_config.agent_variables.language_directive).toContain('Telugu (te-IN)');

    // Reject non-E.164 patient phone numbers prior to outbound HTTP call
    const provider = new SarvamVoiceProvider();
    await expect(
      provider.initiateLiveCall({ ...sampleContext, phoneNumber: '9876500001' })
    ).rejects.toMatchObject({ statusCode: 422 });

    const allLogs = [...logSpy.mock.calls, ...errorSpy.mock.calls, ...warnSpy.mock.calls]
      .flat()
      .join(' ');
    expect(allLogs).not.toContain(secretApiKey);
    expect(allLogs).not.toContain(secretWebhookToken);
  });

  it('safely maps Sarvam interaction_transcript and enforces medical safety across all webhook statuses', async () => {
    const { evaluateSarvamAgentOutcome, mapSarvamTranscript } = await import(
      '../../src/services/sarvamVoice.service'
    );

    const turns = mapSarvamTranscript([
      { role: 'agent', en_text: 'Have you finished breakfast?', indic_text: 'మీరు టిఫిన్ చేశారా?' },
      { role: 'user', en_text: 'Yes I ate.', indic_text: 'అవును, తిన్నాను.' },
    ]);
    expect(turns).toEqual([
      {
        speaker: 'AI',
        text: 'మీరు టిఫిన్ చేశారా?',
        translatedText: 'Have you finished breakfast?',
      },
      {
        speaker: 'PATIENT',
        text: 'అవును, తిన్నాను.',
        translatedText: 'Yes I ate.',
      },
    ]);

    // Connected with ONLY meal confirmed -> NEVER mark taken
    const mealOnly = evaluateSarvamAgentOutcome(
      {
        attempt_id: 'a1',
        status: 'connected',
        duration: 24,
        final_agent_variables: { meal_finished: true },
      },
      'Savitri',
      'Metformin'
    );
    expect(mealOnly.outcome).toBe('ANSWERED');
    expect(mealOnly.mealConfirmed).toBe(true);
    expect(mealOnly.medicineConfirmed).toBe('UNCONFIRMED');

    // Connected with explicit medicine_taken: true -> TAKEN
    const taken = evaluateSarvamAgentOutcome(
      {
        attempt_id: 'a2',
        status: 'connected',
        duration: 31,
        final_agent_variables: { meal_finished: true, medicine_taken: true },
      },
      'Savitri',
      'Metformin'
    );
    expect(taken.outcome).toBe('COMPLETED');
    expect(taken.medicineConfirmed).toBe('TAKEN');

    // Non-connected statuses must stay UNCONFIRMED even if stray variables appear
    for (const [sarvamStatus, expectedOutcome] of [
      ['no_answer', 'NO_ANSWER'],
      ['busy', 'BUSY'],
      ['rejected', 'REJECTED'],
      ['cancelled', 'CANCELLED'],
      ['failed', 'FAILED'],
    ] as const) {
      const res = evaluateSarvamAgentOutcome(
        {
          attempt_id: `a_${sarvamStatus}`,
          status: sarvamStatus,
          duration: null,
          failure_reason: sarvamStatus === 'failed' ? 'Carrier rejected' : null,
          final_agent_variables: { medicine_taken: true },
        },
        'Savitri',
        'Metformin'
      );
      expect(res.outcome).toBe(expectedOutcome);
      expect(res.medicineConfirmed).toBe('UNCONFIRMED');
      expect(res.mealConfirmed).toBeNull();
    }

    // Intermediate lifecycle statuses stay intermediate + PENDING outcome
    for (const [stage, expectedLifecycle] of [
      ['queued', 'QUEUED'],
      ['initiating', 'INITIATING'],
      ['ringing', 'RINGING'],
      ['in_progress', 'IN_PROGRESS'],
    ] as const) {
      const mid = evaluateSarvamAgentOutcome(
        { attempt_id: `a_${stage}`, status: stage },
        'Savitri',
        'Metformin'
      );
      expect(mid.isIntermediateEvent).toBe(true);
      expect(mid.callStatus).toBe(expectedLifecycle);
      expect(mid.outcome).toBe('PENDING');
    }

    // Recording consent denied: withhold transcript turns & summary while still evaluating outcome safely
    const noRecConsent = evaluateSarvamAgentOutcome(
      {
        attempt_id: 'a_no_rec',
        status: 'connected',
        duration: 22,
        final_agent_variables: {
          medicine_taken: true,
          summary: 'Sensitive raw note that must be withheld',
        },
        interaction_transcript: [
          { role: 'agent', en_text: 'Did you take Metformin?' },
          { role: 'user', en_text: 'Yes, I took it.' },
        ],
      },
      'Savitri',
      'Metformin',
      { recordingConsentGranted: false }
    );
    expect(noRecConsent.outcome).toBe('COMPLETED');
    expect(noRecConsent.medicineConfirmed).toBe('TAKEN');
    expect(noRecConsent.turns).toEqual([]);
    expect(noRecConsent.aiSummary).not.toContain('Sensitive raw note');
    expect(noRecConsent.safetyFlags).toContain('RECORDING_AND_TRANSCRIPT_WITHHELD_NO_CONSENT');
  });

  it('requires HTTPS webhook URL and validates Sarvam deployment verification states', async () => {
    vi.resetModules();
    vi.stubEnv('TELEPHONY_ENABLED', 'true');
    vi.stubEnv('VOICE_PROVIDER_MODE', 'sarvam');
    vi.stubEnv('SARVAM_API_BASE_URL', 'https://apps.sarvam.ai');
    vi.stubEnv('SARVAM_API_KEY', 'sk_test_deploy_check');
    vi.stubEnv('SARVAM_ORG_ID', 'org-1');
    vi.stubEnv('SARVAM_WORKSPACE_ID', 'ws-1');
    vi.stubEnv('SARVAM_AGENT_ID', 'agent-1');
    vi.stubEnv('SARVAM_AGENT_VERSION', '3');
    vi.stubEnv('SARVAM_CONNECTION_ID', 'conn-1');
    vi.stubEnv('SARVAM_PHONE_NUMBER', '+917965860596');
    vi.stubEnv('SARVAM_WEBHOOK_TOKEN', 'tok_12345678901234567890');
    vi.stubEnv('PUBLIC_WEBHOOK_BASE_URL', 'http://localhost:4000');

    const { getSarvamWebhookReadiness } = await import('../../src/config/env');
    expect(getSarvamWebhookReadiness()).toMatchObject({
      ready: false,
      isHttps: false,
    });

    vi.resetModules();
    vi.stubEnv('PUBLIC_WEBHOOK_BASE_URL', 'https://carevoice.onrender.com');
    const { getSarvamWebhookReadiness: httpsReadiness } = await import('../../src/config/env');
    expect(httpsReadiness()).toMatchObject({
      ready: true,
      isHttps: true,
    });

    const { SarvamVoiceProvider } = await import('../../src/adapters/voice/sarvamVoice.provider');
    const provider = new SarvamVoiceProvider();

    // Active matching deployment passes
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          {
            deployment_id: 'dep_1',
            app_id: 'agent-1',
            app_version: 3,
            status: 'active',
            connection_configs: [
              { connection_id: 'conn-1', phone_numbers: ['+917965860596'] },
            ],
          },
        ],
      })
    );
    const okDeploy = await provider.verifyAgentDeployment();
    expect(okDeploy).toMatchObject({
      verified: true,
      status: 'active',
      connectionVerified: true,
      phoneVerified: true,
    });

    // Inactive deployment blocks
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [{ deployment_id: 'dep_1', app_id: 'agent-1', status: 'paused' }],
      })
    );
    const inactiveDeploy = await provider.verifyAgentDeployment();
    expect(inactiveDeploy.verified).toBe(false);
    expect(inactiveDeploy.status).toBe('inactive');

    // Official paginated { items: [...] } deployment envelope with top-level phone_numbers
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              deployment_id: 'dep_paginated_1',
              app_id: 'agent-1',
              app_version: 3,
              status: 'active',
              channel_direction: 'inbound_outbound',
              phone_numbers: ['+917965860596'],
            },
          ],
          total: 1,
          limit: 10,
          offset: 0,
        }),
      })
    );
    const paginatedDeploy = await provider.verifyAgentDeployment();
    expect(paginatedDeploy).toMatchObject({
      verified: true,
      status: 'active',
      authCategory: 'VERIFIED',
      matchedDeploymentId: 'dep_paginated_1',
      phoneVerified: true,
    });
  });

  it('extracts nested Sarvam 401/403/404 auth diagnostics, checks syntax/trimming, confirms credential parity, and redacts secrets', async () => {
    vi.resetModules();
    const secretKey = 'sk_secret_model_key_should_never_leak';
    vi.stubEnv('TELEPHONY_ENABLED', 'true');
    vi.stubEnv('VOICE_PROVIDER_MODE', 'sarvam');
    vi.stubEnv('SARVAM_API_BASE_URL', 'https://apps.sarvam.ai');
    vi.stubEnv('SARVAM_API_KEY', `  ${secretKey}  `);
    vi.stubEnv('SARVAM_ORG_ID', '019f94e8-30dd-71f1-8cc7-d6398bf00fb1');
    vi.stubEnv('SARVAM_WORKSPACE_ID', '019f94e8-30e1-79b6-9357-17bcb1f1e5bf');
    vi.stubEnv('SARVAM_AGENT_ID', 'Conversatio-a7e64173-3c11');
    vi.stubEnv('SARVAM_AGENT_VERSION', '3');
    vi.stubEnv('SARVAM_CONNECTION_ID', '50141c04-3e-a97582cf-bbd0');
    vi.stubEnv('SARVAM_PHONE_NUMBER', '+917965860596');
    vi.stubEnv('SARVAM_WEBHOOK_TOKEN', 'wh_tok_secret_parity_test_1234567890');
    vi.stubEnv('PUBLIC_WEBHOOK_BASE_URL', 'https://carevoice-v2h2.onrender.com');

    const { env } = await import('../../src/config/env');
    // Leading/trailing whitespace is safely trimmed on load
    expect(env.SARVAM_API_KEY).toBe(secretKey);

    const { SarvamVoiceProvider } = await import('../../src/adapters/voice/sarvamVoice.provider');
    const provider = new SarvamVoiceProvider();

    // Verify preflight and outbound use the exact same credentials and workspace
    expect(provider.getCredentialParitySummary()).toEqual({
      authHeader: 'X-API-Key',
      preflightEndpoint:
        'https://apps.sarvam.ai/api/app-authoring/v1/orgs/019f94e8-30dd-71f1-8cc7-d6398bf00fb1/workspaces/019f94e8-30e1-79b6-9357-17bcb1f1e5bf/deployments',
      outboundEndpoint:
        'https://apps.sarvam.ai/api/outbounds/v1/orgs/019f94e8-30dd-71f1-8cc7-d6398bf00fb1/workspaces/019f94e8-30e1-79b6-9357-17bcb1f1e5bf/outbounds',
      sameApiBaseUrl: true,
      sameOrgId: '019f94e8-30dd-71f1-8cc7-d6398bf00fb1',
      sameWorkspaceId: '019f94e8-30e1-79b6-9357-17bcb1f1e5bf',
      sameAgentId: 'Conversatio-a7e64173-3c11',
      agentVersion: 3,
      connectionId: '50141c04-3e-a97582cf-bbd0',
    });

    // Safe non-dialing outbound request preparation works cleanly without HTTP calls
    const prepared = provider.buildOutboundPayload(sampleContext);
    expect(prepared.app_config).toMatchObject({
      app_id: 'Conversatio-a7e64173-3c11',
      app_version: 3,
      connection_config: {
        connection_id: '50141c04-3e-a97582cf-bbd0',
        agent_phone_number: '+917965860596',
      },
      app_overrides: {
        initial_language_name: 'Telugu',
      },
      agent_variables: {
        language_code: 'te',
        language_bcp47: 'te-IN',
        preferred_language: 'Telugu',
      },
    });
    expect(prepared.app_config.app_overrides?.initial_bot_message).toContain('నమస్కారం');
    expect(prepared.user_config.user_phone_number).toBe('+919876500001');

    // 1) Sarvam nested 401 Invalid API key format (plus simulated echoed secret redaction)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () =>
          JSON.stringify({
            error: {
              message: '(401) Unauthorized',
              type: 'unauthorized',
              code: 401,
              data: {
                details: `Invalid API key format. Rejected header for ${secretKey}`,
              },
            },
          }),
      })
    );

    const invalidFmt = await provider.verifyAgentDeployment();
    expect(invalidFmt.verified).toBe(false);
    expect(invalidFmt.upstreamStatus).toBe(401);
    expect(invalidFmt.authCategory).toBe('INVALID_API_KEY_FORMAT');
    expect(invalidFmt.upstreamDetail).toContain('Invalid API key format.');
    expect(invalidFmt.upstreamDetail).not.toContain(secretKey);
    expect(invalidFmt.message).not.toContain(secretKey);
    expect(invalidFmt.diagnosticHint).toContain('apps.sarvam.ai');

    // 2) Generic 401 (revoked/expired key) vs 403 (permissions) vs 404 (org/workspace mismatch)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ detail: 'API key has been revoked' }),
      })
    );
    const revoked = await provider.verifyAgentDeployment();
    expect(revoked.authCategory).toBe('UNAUTHORIZED_INVALID_OR_REVOKED_KEY');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ detail: 'Workspace permission denied' }),
      })
    );
    const forbidden = await provider.verifyAgentDeployment();
    expect(forbidden.authCategory).toBe('INSUFFICIENT_PERMISSIONS');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ detail: 'Workspace not found' }),
      })
    );
    const notFound = await provider.verifyAgentDeployment();
    expect(notFound.authCategory).toBe('WORKSPACE_OR_ORG_NOT_FOUND');

    // 3) Surrounding quotes / Bearer prefix detected locally before calling Sarvam
    const mutableEnv = env as { SARVAM_API_KEY: string };
    const syntaxSpy = vi.fn();
    vi.stubGlobal('fetch', syntaxSpy);
    mutableEnv.SARVAM_API_KEY = '"wrapped_in_quotes_key"';
    const quotedRes = await provider.verifyAgentDeployment();
    expect(quotedRes.verified).toBe(false);
    expect(quotedRes.authCategory).toBe('KEY_SYNTAX_ERROR');
    expect(syntaxSpy).not.toHaveBeenCalled();

    mutableEnv.SARVAM_API_KEY = 'Bearer accidental_bearer_prefix';
    const bearerRes = await provider.verifyAgentDeployment();
    expect(bearerRes.verified).toBe(false);
    expect(bearerRes.authCategory).toBe('KEY_SYNTAX_ERROR');
    expect(syntaxSpy).not.toHaveBeenCalled();
  });

  it('performs read-only multi-endpoint workspace discovery on 404/empty deployments, keeps unverified agents locked, and redacts PII/secrets', async () => {
    vi.resetModules();
    const secretApiKey = 'sk_discovery_secret_key_001';
    const secretWebhookUrl = 'https://carevoice.example/api/voice-agent/webhook/sarvam/super_secret_wh_tok';

    vi.stubEnv('TELEPHONY_ENABLED', 'true');
    vi.stubEnv('VOICE_PROVIDER_MODE', 'sarvam');
    vi.stubEnv('SARVAM_API_BASE_URL', 'https://apps.sarvam.ai');
    vi.stubEnv('SARVAM_API_KEY', secretApiKey);
    vi.stubEnv('SARVAM_ORG_ID', '019f94e8-30dd-71f1-8cc7-d6398bf00fb1');
    vi.stubEnv('SARVAM_WORKSPACE_ID', '019f94e8-30e1-79b6-9357-17bcb1f1e5bf');
    vi.stubEnv('SARVAM_AGENT_ID', 'Conversatio-a7e64173-3c11');
    vi.stubEnv('SARVAM_AGENT_VERSION', '3');
    vi.stubEnv('SARVAM_CONNECTION_ID', '50141c04-3e-a97582cf-bbd0');
    vi.stubEnv('SARVAM_PHONE_NUMBER', '+917965860596');
    vi.stubEnv('SARVAM_WEBHOOK_TOKEN', 'super_secret_wh_tok_1234567890');
    vi.stubEnv('PUBLIC_WEBHOOK_BASE_URL', 'https://carevoice-v2h2.onrender.com');

    const { SarvamVoiceProvider } = await import('../../src/adapters/voice/sarvamVoice.provider');
    const provider = new SarvamVoiceProvider();

    // Case A: 404 App not found on Analytics + another real candidate app_id discovered in Campaigns (never POSTs)
    const discoveryFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(init?.method || 'GET').toBe('GET');

      if (url.includes('/deployments?')) {
        return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
      }
      if (url.includes('/campaigns?')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                campaign_id: 'camp_cand_1',
                name: 'Morning Reminders',
                status: 'Paused',
                created_by: 'private.admin@carevoice.local',
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.endsWith('/campaigns/camp_cand_1')) {
        return new Response(
          JSON.stringify({
            campaign_id: 'camp_cand_1',
            status: 'Paused',
            app_config: {
              app_id: 'CareVoice-Real-a1b2c3d4-9988',
              app_version: 2,
              connection_configs: [
                {
                  connection_id: 'conn_real_999',
                  phone_numbers: ['+918012349999'],
                },
              ],
            },
            webhook_config: {
              url: secretWebhookUrl,
            },
          }),
          { status: 200 }
        );
      }
      if (url.includes('/experiments?')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      if (url.includes('/test-suites?')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      if (url.includes('/analytics/v1/') && url.includes('/interactions')) {
        return new Response(
          JSON.stringify({
            detail:
              "App 'Conversatio-a7e64173-3c11' not found under the configured organization and workspace. User +919876543210",
          }),
          { status: 404 }
        );
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });
    vi.stubGlobal('fetch', discoveryFetch);

    const notFoundResult = await provider.verifyAgentDeployment();
    expect(notFoundResult.verified).toBe(false);
    expect(notFoundResult.status).toBe('not_found');
    expect(notFoundResult.authCategory).toBe('APP_NOT_FOUND_IN_WORKSPACE');
    expect(notFoundResult.upstreamStatus).toBe(404);
    expect(notFoundResult.workspaceDiscovery).toBeDefined();
    expect(notFoundResult.workspaceDiscovery?.analyticsAppCheckStatus).toBe(404);
    expect(notFoundResult.workspaceDiscovery?.discoveredApps).toEqual([
      expect.objectContaining({
        appId: 'CareVoice-Real-a1b2c3d4-9988',
        matchesConfiguredAppId: false,
        sources: ['campaign'],
        versions: [2],
        connectionIds: ['conn_real_999'],
        phoneNumbersMasked: ['+91******9999'],
      }),
    ]);
    expect(notFoundResult.diagnosticHint).toContain('CareVoice-Real-a1b2c3d4-9988');
    // Must not expose webhook URL, API key, or creator email
    const serialized = JSON.stringify(notFoundResult);
    expect(serialized).not.toContain(secretApiKey);
    expect(serialized).not.toContain(secretWebhookUrl);
    expect(serialized).not.toContain('private.admin@carevoice.local');
    expect(serialized).not.toContain('+918012349999');

    // Case B: Active deployment list item omits connection_configs -> detail GET /deployments/{id} verifies connection
    const detailVerifyFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/deployments?')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                deployment_id: 'dep_detail_1',
                app_id: 'Conversatio-a7e64173-3c11',
                app_version: 3,
                status: 'active',
                phone_numbers: ['+917965860596'],
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.endsWith('/deployments/dep_detail_1')) {
        return new Response(
          JSON.stringify({
            deployment_id: 'dep_detail_1',
            app_id: 'Conversatio-a7e64173-3c11',
            app_version: 3,
            status: 'active',
            connection_configs: [
              {
                connection_id: '50141c04-3e-a97582cf-bbd0',
                phone_numbers: ['+917965860596'],
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', detailVerifyFetch);

    const activeViaDetail = await provider.verifyAgentDeployment();
    expect(activeViaDetail).toMatchObject({
      verified: true,
      status: 'active',
      authCategory: 'VERIFIED',
      matchedDeploymentId: 'dep_detail_1',
      connectionVerified: true,
      phoneVerified: true,
    });

    // Case C: Matching Campaign verifies app_id + committed version + connection_id + phone (when Analytics does not 404)
    const campaignVerifyFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/deployments?')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      if (url.includes('/campaigns?')) {
        return new Response(
          JSON.stringify({
            items: [{ campaign_id: 'camp_match_1', status: 'Completed' }],
          }),
          { status: 200 }
        );
      }
      if (url.endsWith('/campaigns/camp_match_1')) {
        return new Response(
          JSON.stringify({
            campaign_id: 'camp_match_1',
            app_config: {
              app_id: 'Conversatio-a7e64173-3c11',
              app_version: 3,
              connection_configs: [
                {
                  connection_id: '50141c04-3e-a97582cf-bbd0',
                  phone_numbers: ['+917965860596'],
                },
              ],
            },
          }),
          { status: 200 }
        );
      }
      if (url.includes('/analytics/v1/') && url.includes('/interactions')) {
        return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', campaignVerifyFetch);

    const verifiedViaCampaign = await provider.verifyAgentDeployment();
    expect(verifiedViaCampaign).toMatchObject({
      verified: true,
      status: 'verified_campaign',
      authCategory: 'VERIFIED',
      matchedAppVersion: 3,
      connectionVerified: true,
      phoneVerified: true,
    });

    // Case D: Agent exists ONLY in Experiments -> stays strictly locked as unverified
    const expOnlyFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/experiments?')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                experiment_id: 'exp_1',
                variants: [
                  {
                    app_config: {
                      app_id: 'Conversatio-a7e64173-3c11',
                      app_version: 3,
                    },
                  },
                ],
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', expOnlyFetch);

    const expOnlyRes = await provider.verifyAgentDeployment();
    expect(expOnlyRes.verified).toBe(false);
    expect(expOnlyRes.status).toBe('unverified');
    expect(expOnlyRes.authCategory).toBe('AGENT_UNVERIFIED_IN_WORKSPACE');

    // Case E: Outbound POST 404 classifies as APP_NOT_FOUND_IN_WORKSPACE
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () =>
          JSON.stringify({
            detail:
              "App 'Conversatio-a7e64173-3c11' not found under the configured organization and workspace.",
          }),
      })
    );
    await expect(provider.initiateLiveCall(sampleContext)).rejects.toMatchObject({
      code: 'SARVAM_PROVIDER_ERROR',
      details: expect.objectContaining({
        upstreamStatus: 404,
        authCategory: 'APP_NOT_FOUND_IN_WORKSPACE',
      }),
    });
  });

  it('supports independent transcript vs recording consents, NOT_CONNECTED/ANSWERED lifecycles, UTC parsing, Analytics transcript merging, and unsupported language fallback errors', async () => {
    vi.resetModules();
    vi.stubEnv('TELEPHONY_ENABLED', 'true');
    vi.stubEnv('VOICE_PROVIDER_MODE', 'sarvam');
    vi.stubEnv('SARVAM_API_BASE_URL', 'https://apps.sarvam.ai');
    vi.stubEnv('SARVAM_API_KEY', 'sk_test_key_ext');
    vi.stubEnv('SARVAM_ORG_ID', 'org-1');
    vi.stubEnv('SARVAM_WORKSPACE_ID', 'ws-1');
    vi.stubEnv('SARVAM_AGENT_ID', 'agent-1');
    vi.stubEnv('SARVAM_AGENT_VERSION', '3');
    vi.stubEnv('SARVAM_CONNECTION_ID', 'conn-1');
    vi.stubEnv('SARVAM_PHONE_NUMBER', '+917965860596');
    vi.stubEnv('SARVAM_WEBHOOK_TOKEN', 'tok_ext_1234567890123456');
    vi.stubEnv('PUBLIC_WEBHOOK_BASE_URL', 'https://carevoice.onrender.com');

    const { SarvamVoiceProvider, parseSarvamUtcTimestamp } = await import(
      '../../src/adapters/voice/sarvamVoice.provider'
    );
    const {
      evaluateSarvamAgentOutcome,
      mapProviderRawStatusToLifecycle,
      mapSarvamAnalyticsTranscripts,
      cleanSarvamSentinel,
    } = await import('../../src/services/sarvamVoice.service');

    // Independent consent combinations
    const sampleWebhookPayload = {
      attempt_id: 'a_split',
      status: 'connected',
      duration: 19,
      language_name: 'Telugu',
      final_agent_variables: {
        medicine_taken: true,
        summary: 'Patient confirmed Metformin after breakfast.',
      },
      interaction_transcript: [
        { role: 'agent', en_text: 'Did you take Metformin?', indic_text: 'మెట్‌ఫార్మిన్ వేసుకున్నారా?' },
        { role: 'user', en_text: 'Yes.', indic_text: 'అవును వేసుకున్నాను.' },
      ],
    };

    const transcriptOnly = evaluateSarvamAgentOutcome(sampleWebhookPayload, 'Lakshmi', 'Metformin', {
      transcriptConsentGranted: true,
      recordingConsentGranted: false,
    });
    expect(transcriptOnly.turns).toHaveLength(2);
    expect(transcriptOnly.aiSummary).toContain('Patient confirmed Metformin');
    expect(transcriptOnly.safetyFlags).toContain('RECORDING_WITHHELD_NO_CONSENT');
    expect(transcriptOnly.actualLanguageUsed).toBe('te');

    const recordingOnly = evaluateSarvamAgentOutcome(sampleWebhookPayload, 'Lakshmi', 'Metformin', {
      transcriptConsentGranted: false,
      recordingConsentGranted: true,
    });
    expect(recordingOnly.turns).toEqual([]);
    expect(recordingOnly.aiSummary).not.toContain('Patient confirmed Metformin');
    expect(recordingOnly.safetyFlags).toContain('TRANSCRIPT_WITHHELD_NO_CONSENT');

    // Status mappings & sentinel cleanup
    expect(mapProviderRawStatusToLifecycle('answered')).toBe('ANSWERED');
    expect(mapProviderRawStatusToLifecycle('not_connected')).toBe('NOT_CONNECTED');
    expect(mapProviderRawStatusToLifecycle('dialing')).toBe('INITIATING');
    expect(cleanSarvamSentinel('NO_FAILURE_REASON')).toBeUndefined();
    expect(cleanSarvamSentinel('NO_END_REASON')).toBeUndefined();

    const notConn = evaluateSarvamAgentOutcome(
      {
        attempt_id: 'a_nc',
        connectivity_status: 'NOT_CONNECTED',
        failure_reason: 'NO_FAILURE_REASON',
      },
      'Lakshmi',
      'Metformin'
    );
    expect(notConn.callStatus).toBe('NOT_CONNECTED');
    expect(notConn.outcome).toBe('NOT_CONNECTED');
    expect(notConn.medicineConfirmed).toBe('UNCONFIRMED');

    // Naive Sarvam UTC timestamp parsing
    expect(parseSarvamUtcTimestamp('2026-10-07T05:12:08')?.toISOString()).toBe(
      '2026-10-07T05:12:08.000Z'
    );
    expect(parseSarvamUtcTimestamp('2026-10-07T05:12:08Z')?.toISOString()).toBe(
      '2026-10-07T05:12:08.000Z'
    );

    // Analytics transcript merging (original + translation + /transcripts/{id} turn metadata)
    const mergedTurns = mapSarvamAnalyticsTranscripts({
      originalTranscript: [
        { role: 'agent', content: 'నమస్కారం అమ్మ' },
        { role: 'user', content: 'నమస్కారం' },
      ],
      translateTranscript: [
        { role: 'agent', content: 'Hello mother' },
        { role: 'user', content: 'Hello' },
      ],
      messages: [
        { turn_id: 1, role: 'agent', content: 'నమస్కారం అమ్మ', language_name: 'Telugu' },
        { turn_id: 2, role: 'user', content: 'నమస్కారం', language_name: 'Telugu' },
      ],
      defaultLanguage: 'te',
    });
    expect(mergedTurns).toHaveLength(2);
    expect(mergedTurns[0]).toMatchObject({
      speaker: 'AI',
      text: 'నమస్కారం అమ్మ',
      translatedText: 'Hello mother',
      language: 'te',
      turnId: '1',
    });

    // Unsupported Sarvam language blocks buildOutboundPayload cleanly with 422 LANGUAGE_FALLBACK_REQUIRED
    const provider = new SarvamVoiceProvider();
    expect(() =>
      provider.buildOutboundPayload({
        ...sampleContext,
        languageCode: 'ur',
        languageBcp47: 'ur-IN',
      })
    ).toThrow(/not supported/i);
  });
});
