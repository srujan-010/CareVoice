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
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(
      'https://apps.sarvam.ai/api/outbounds/v1/orgs/org-uuid-123/workspaces/ws-uuid-456/outbounds'
    );
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe(secretApiKey);

    const parsedBody = JSON.parse(String(init.body));
    expect(parsedBody).toEqual({
      app_config: {
        app_id: 'agent-id-789',
        app_version: 2,
        connection_config: {
          connection_id: 'conn-id-abc',
          agent_phone_number: '+918012345678',
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
        },
      },
    });

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
  });
});
