import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_DB_NAME = 'carevoice_test_real_voice_suite';
const TEST_API_KEY = 'sk_test_real_voice_calling_001';
const TEST_WEBHOOK_TOKEN = 'cv_wh_test_real_voice_high_entropy_token_2026';

describe('Real Outbound Voice Calling Lifecycle, Consent, Preflight & Safety Integration Tests (Mocked Sarvam HTTP)', () => {
  let app: ReturnType<typeof import('../../src/app').createApp>;
  let disconnectDatabase: typeof import('../../src/config/database').disconnectDatabase;
  let CallLog: typeof import('../../src/models/CallLog').CallLog;
  let Conversation: typeof import('../../src/models/Conversation').Conversation;
  let DoseInstance: typeof import('../../src/models/DoseInstance').DoseInstance;
  let FamilyMember: typeof import('../../src/models/FamilyMember').FamilyMember;
  let Medicine: typeof import('../../src/models/Medicine').Medicine;
  let Recording: typeof import('../../src/models/Recording').Recording;

  let adminToken = '';
  let caregiverToken = '';
  let viewerToken = '';
  let memberAllGrantedId = '';
  let memberNoCallConsentId = '';
  let memberNoRecordConsentId = '';
  let memberDisabledMedPrefId = '';
  let memberBadPhoneId = '';

  let doseGrantedId = '';
  let doseSecondGrantedId = '';
  let doseThirdGrantedId = '';
  let doseNoCallConsentId = '';
  let doseNoRecordConsentId = '';
  let doseDisabledMedPrefId = '';
  let doseBadPhoneId = '';

  beforeAll(async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('VOICE_PROVIDER_MODE', 'sarvam');
    vi.stubEnv('TELEPHONY_ENABLED', 'true');
    vi.stubEnv('SARVAM_API_BASE_URL', 'https://apps.sarvam.ai');
    vi.stubEnv('SARVAM_API_KEY', TEST_API_KEY);
    vi.stubEnv('SARVAM_ORG_ID', '019f94e8-30dd-71f1-8cc7-d6398bf00fb1');
    vi.stubEnv('SARVAM_WORKSPACE_ID', '019f94e8-30e1-79b6-9357-17bcb1f1e5bf');
    vi.stubEnv('SARVAM_AGENT_ID', 'Conversatio-a7e64173-3c11');
    vi.stubEnv('SARVAM_AGENT_VERSION', '3');
    vi.stubEnv('SARVAM_CONNECTION_ID', '50141c04-3e-a97582cf-bbd0');
    vi.stubEnv('SARVAM_PHONE_NUMBER', '+917965860596');
    vi.stubEnv('SARVAM_WEBHOOK_TOKEN', TEST_WEBHOOK_TOKEN);
    vi.stubEnv('PUBLIC_WEBHOOK_BASE_URL', 'https://carevoice-test.onrender.com');

    const dbMod = await import('../../src/config/database');
    const appMod = await import('../../src/app');
    const models = await Promise.all([
      import('../../src/models/User'),
      import('../../src/models/Family'),
      import('../../src/models/FamilyMember'),
      import('../../src/models/Consent'),
      import('../../src/models/Medicine'),
      import('../../src/models/MedicineSchedule'),
      import('../../src/models/DoseInstance'),
      import('../../src/models/CallSchedule'),
      import('../../src/models/CallLog'),
      import('../../src/models/Conversation'),
      import('../../src/models/Callback'),
      import('../../src/models/Notification'),
      import('../../src/models/Escalation'),
      import('../../src/models/AuditLog'),
      import('../../src/models/Recording'),
    ]);

    disconnectDatabase = dbMod.disconnectDatabase;
    app = appMod.createApp();
    FamilyMember = models[2].FamilyMember;
    Medicine = models[4].Medicine;
    DoseInstance = models[6].DoseInstance;
    CallLog = models[8].CallLog;
    Conversation = models[9].Conversation;
    Recording = models[14].Recording;

    await dbMod.connectDatabase(TEST_DB_NAME);
    await Promise.all([
      models[0].User.deleteMany({}),
      models[1].Family.deleteMany({}),
      FamilyMember.deleteMany({}),
      models[3].Consent.deleteMany({}),
      Medicine.deleteMany({}),
      models[5].MedicineSchedule.deleteMany({}),
      DoseInstance.deleteMany({}),
      models[7].CallSchedule.deleteMany({}),
      CallLog.deleteMany({}),
      Conversation.deleteMany({}),
      models[10].Callback.deleteMany({}),
      models[11].Notification.deleteMany({}),
      models[12].Escalation.deleteMany({}),
      models[13].AuditLog.deleteMany({}),
      Recording.deleteMany({}),
    ]);

    // Register Admin
    const regAdmin = await request(app).post('/api/auth/register').send({
      familyName: 'Rao Care Family',
      name: 'Admin Rao',
      email: 'admin.realcall.test@carevoice.local',
      password: 'StrongPassword123!',
      timezone: 'Asia/Kolkata',
    });
    expect(regAdmin.status).toBe(201);
    adminToken = regAdmin.body.data.token;

    // Create Caregiver & Viewer users
    await request(app)
      .post('/api/auth/caregivers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Caregiver Rao',
        email: 'caregiver.realcall.test@carevoice.local',
        password: 'StrongPassword123!',
        role: 'CAREGIVER',
      });
    const cgLogin = await request(app).post('/api/auth/login').send({
      email: 'caregiver.realcall.test@carevoice.local',
      password: 'StrongPassword123!',
    });
    caregiverToken = cgLogin.body.data.token;

    await request(app)
      .post('/api/auth/caregivers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Viewer Rao',
        email: 'viewer.realcall.test@carevoice.local',
        password: 'StrongPassword123!',
        role: 'VIEWER',
      });
    const vwLogin = await request(app).post('/api/auth/login').send({
      email: 'viewer.realcall.test@carevoice.local',
      password: 'StrongPassword123!',
    });
    viewerToken = vwLogin.body.data.token;

    const createMemberWithMedicine = async (opts: {
      fullName: string;
      phoneNumber: string;
      voiceConsent: string;
      recordConsent: string;
      transcriptConsent?: string;
      preferredLanguage?: string;
      allowMedicineReminders?: boolean;
      medicineName: string;
    }) => {
      const mRes = await request(app)
        .post('/api/family-members')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          fullName: opts.fullName,
          phoneNumber: opts.phoneNumber,
          preferredLanguage: opts.preferredLanguage ?? 'te',
          timezone: 'Asia/Kolkata',
          relationship: 'Mother',
          emergencyContact: {
            name: 'Admin Rao',
            phoneNumber: '+919876500099',
            relationship: 'Son',
          },
          voiceCallingConsentStatus: opts.voiceConsent,
          recordingConsentStatus: opts.recordConsent,
          transcriptConsentStatus: opts.transcriptConsent ?? 'PENDING',
          callingPreferences: {
            quietHoursStart: '02:00',
            quietHoursEnd: '02:05',
            maxRetries: 2,
            retryIntervalMinutes: 10,
            allowMealReminders: true,
            allowMedicineReminders: opts.allowMedicineReminders ?? true,
            allowConfirmationCalls: true,
            preferredVoiceGender: 'FEMALE',
          },
        });
      expect(mRes.status).toBe(201);
      const mId = mRes.body.data.id as string;

      const medRes = await request(app)
        .post('/api/medicines')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          familyMemberId: mId,
          name: opts.medicineName,
          dosage: '500mg',
          prescribedInstructions: 'Take after breakfast',
          foodInstruction: 'AFTER_FOOD',
          associatedMeal: 'BREAKFAST',
          startDate: new Date().toISOString(),
          frequency: 'THREE_TIMES_DAILY',
          scheduledTimes: [
            {
              slotLabel: 'Morning Slot',
              timeOfDay: '09:00',
              associatedMeal: 'BREAKFAST',
              foodInstruction: 'AFTER_FOOD',
              mealReminderOffsetMinutes: -15,
              medicineReminderOffsetMinutes: 0,
              confirmationOffsetMinutes: 20,
            },
            {
              slotLabel: 'Afternoon Slot',
              timeOfDay: '14:00',
              associatedMeal: 'LUNCH',
              foodInstruction: 'AFTER_FOOD',
              mealReminderOffsetMinutes: -15,
              medicineReminderOffsetMinutes: 0,
              confirmationOffsetMinutes: 20,
            },
            {
              slotLabel: 'Evening Slot',
              timeOfDay: '21:00',
              associatedMeal: 'DINNER',
              foodInstruction: 'AFTER_FOOD',
              mealReminderOffsetMinutes: -15,
              medicineReminderOffsetMinutes: 0,
              confirmationOffsetMinutes: 20,
            },
          ],
        });
      expect(medRes.status).toBe(201);
      const doses = await DoseInstance.find({ medicineId: medRes.body.data.id })
        .sort({ scheduledAt: 1 })
        .lean();
      expect(doses.length).toBeGreaterThanOrEqual(2);
      return { memberId: mId, doses: doses.map((d) => String(d._id)) };
    };

    const m1 = await createMemberWithMedicine({
      fullName: 'Lakshmi Rao',
      phoneNumber: '+919876543210',
      voiceConsent: 'GRANTED',
      recordConsent: 'GRANTED',
      transcriptConsent: 'GRANTED',
      medicineName: 'Metformin',
    });
    memberAllGrantedId = m1.memberId;
    doseGrantedId = m1.doses[0];
    doseSecondGrantedId = m1.doses[1];
    doseThirdGrantedId = m1.doses[2];

    const m2 = await createMemberWithMedicine({
      fullName: 'Sita Rao',
      phoneNumber: '+919876543211',
      voiceConsent: 'DENIED',
      recordConsent: 'DENIED',
      transcriptConsent: 'DENIED',
      medicineName: 'Amlodipine',
    });
    memberNoCallConsentId = m2.memberId;
    doseNoCallConsentId = m2.doses[0];

    const m3 = await createMemberWithMedicine({
      fullName: 'Radha Rao',
      phoneNumber: '+919876543212',
      voiceConsent: 'GRANTED',
      recordConsent: 'DENIED',
      transcriptConsent: 'DENIED',
      medicineName: 'Atorvastatin',
    });
    memberNoRecordConsentId = m3.memberId;
    doseNoRecordConsentId = m3.doses[0];

    const m4 = await createMemberWithMedicine({
      fullName: 'Gita Rao',
      phoneNumber: '+919876543213',
      voiceConsent: 'GRANTED',
      recordConsent: 'GRANTED',
      allowMedicineReminders: false,
      medicineName: 'Pantoprazole',
    });
    memberDisabledMedPrefId = m4.memberId;
    doseDisabledMedPrefId = m4.doses[0];

    // Create a member & force invalid non-E.164 stored phone to ensure pre-dial guard rejects invalid E.164
    const m5 = await createMemberWithMedicine({
      fullName: 'Invalid Phone Rao',
      phoneNumber: '+919876543214',
      voiceConsent: 'GRANTED',
      recordConsent: 'GRANTED',
      medicineName: 'Aspirin',
    });
    memberBadPhoneId = m5.memberId;
    doseBadPhoneId = m5.doses[0];
    await FamilyMember.updateOne(
      { _id: memberBadPhoneId },
      { $set: { phoneNumber: '9876543214' } }
    );
  }, 120000);

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await disconnectDatabase();
    vi.resetModules();
  });

  it('Scenario 1: blocks real test calls when TELEPHONY_ENABLED=false or credentials are missing without creating fake calls', async () => {
    const { env } = await import('../../src/config/env');
    const mutableEnv = env as {
      VOICE_PROVIDER_MODE: 'mock' | 'sarvam';
      TELEPHONY_ENABLED: boolean;
      SARVAM_API_KEY: string;
      NODE_ENV: 'development' | 'test' | 'production';
      ALLOW_DEV_DEMO_MODE: boolean;
    };

    const prevMode = mutableEnv.VOICE_PROVIDER_MODE;
    const prevEnabled = mutableEnv.TELEPHONY_ENABLED;
    const prevKey = mutableEnv.SARVAM_API_KEY;
    const prevNodeEnv = mutableEnv.NODE_ENV;
    const prevDemo = mutableEnv.ALLOW_DEV_DEMO_MODE;

    try {
      mutableEnv.VOICE_PROVIDER_MODE = 'mock';
      mutableEnv.TELEPHONY_ENABLED = false;
      mutableEnv.SARVAM_API_KEY = '';

      const preflightRes = await request(app)
        .get('/api/voice-calls/preflight')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(preflightRes.status).toBe(200);
      expect(preflightRes.body.data.liveCallingAllowed).toBe(false);
      expect(preflightRes.body.data.mockSimulationAllowed).toBe(true);

      const beforeCount = await CallLog.countDocuments({});
      const blockedRes = await request(app)
        .post('/api/voice-calls/real-test')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          familyMemberId: memberAllGrantedId,
          doseInstanceId: doseGrantedId,
          callType: 'MEDICINE_REMINDER',
          confirmedByAdmin: true,
          overrideQuietHours: true,
        });

      expect(blockedRes.status).toBe(503);
      expect(blockedRes.body.code).toBe('TELEPHONY_NOT_READY');
      const afterCount = await CallLog.countDocuments({});
      expect(afterCount).toBe(beforeCount);

      // Production locks out mock simulator when ALLOW_DEV_DEMO_MODE=false
      mutableEnv.NODE_ENV = 'production';
      mutableEnv.ALLOW_DEV_DEMO_MODE = false;
      const prodSim = await request(app)
        .post('/api/calls/simulate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ doseInstanceId: doseGrantedId, scenario: 'TAKEN' });
      expect(prodSim.status).toBe(403);
    } finally {
      mutableEnv.VOICE_PROVIDER_MODE = prevMode;
      mutableEnv.TELEPHONY_ENABLED = prevEnabled;
      mutableEnv.SARVAM_API_KEY = prevKey;
      mutableEnv.NODE_ENV = prevNodeEnv;
      mutableEnv.ALLOW_DEV_DEMO_MODE = prevDemo;
    }
  });

  it('Scenario 1b: blocks preflight and real-test calls cleanly with sanitized diagnostics when Sarvam returns HTTP 401', async () => {
    const authFailFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () =>
        JSON.stringify({
          error: {
            message: '(401) Unauthorized',
            type: 'unauthorized',
            code: 401,
            data: {
              details: 'Invalid API key format.',
            },
          },
        }),
    });
    vi.stubGlobal('fetch', authFailFetch);

    const preflight401 = await request(app)
      .get('/api/voice-calls/preflight?verifyDeployment=true')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(preflight401.status).toBe(200);
    expect(preflight401.body.data.liveCallingAllowed).toBe(false);
    expect(preflight401.body.data.deploymentCheck).toMatchObject({
      verified: false,
      status: 'error',
      upstreamStatus: 401,
      authCategory: 'INVALID_API_KEY_FORMAT',
      authHeader: 'X-API-Key',
      credentialsSharedWithOutbound: true,
    });
    expect(preflight401.body.data.deploymentCheck.upstreamDetail).toContain(
      'Invalid API key format.'
    );
    expect(JSON.stringify(preflight401.body)).not.toContain(TEST_API_KEY);
    expect(JSON.stringify(preflight401.body)).not.toContain(TEST_WEBHOOK_TOKEN);

    const beforeCount = await CallLog.countDocuments({});
    const blockedDial = await request(app)
      .post('/api/voice-calls/real-test')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        familyMemberId: memberAllGrantedId,
        doseInstanceId: doseGrantedId,
        callType: 'MEDICINE_REMINDER',
        confirmedByAdmin: true,
        overrideQuietHours: true,
      });

    expect(blockedDial.status).toBe(502);
    expect(blockedDial.body.code).toBe('SARVAM_DEPLOYMENT_NOT_READY');
    expect(blockedDial.body.message).toContain('Invalid API key format.');
    // Only preflight GET was called; POST /outbounds must NEVER fire when auth fails
    expect(authFailFetch).toHaveBeenCalledTimes(2);
    expect(
      authFailFetch.mock.calls.every(([, init]) => (init?.method || 'GET') === 'GET')
    ).toBe(true);
    expect(await CallLog.countDocuments({})).toBe(beforeCount);
  });

  it('Scenario 1c: keeps real calling locked on Sarvam 404 / unverified app_id, surfaces read-only discovery candidates, and never calls POST /outbounds', async () => {
    const discoveryFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/outbounds')) {
        throw new Error('POST /outbounds must NEVER be called when app_id is unverified!');
      }
      expect(init?.method || 'GET').toBe('GET');

      if (url.includes('/deployments?')) {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      if (url.includes('/campaigns?')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [{ campaign_id: 'camp_real_1', status: 'Paused' }] }),
        };
      }
      if (url.endsWith('/campaigns/camp_real_1')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            campaign_id: 'camp_real_1',
            app_config: {
              app_id: 'CareVoice-Verified-1234-5678',
              app_version: 3,
              connection_configs: [
                { connection_id: '50141c04-3e-a97582cf-bbd0', phone_numbers: ['+917965860596'] },
              ],
            },
          }),
        };
      }
      if (url.includes('/analytics/v1/') && url.includes('/interactions')) {
        return {
          ok: false,
          status: 404,
          text: async () =>
            JSON.stringify({
              detail:
                "App 'Conversatio-a7e64173-3c11' not found under the configured organization and workspace.",
            }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    });
    vi.stubGlobal('fetch', discoveryFetch);

    const preflightRes = await request(app)
      .get('/api/voice-calls/preflight?verifyDeployment=true')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(preflightRes.status).toBe(200);
    expect(preflightRes.body.data.liveCallingAllowed).toBe(false);
    expect(preflightRes.body.data.deploymentCheck).toMatchObject({
      verified: false,
      status: 'not_found',
      authCategory: 'APP_NOT_FOUND_IN_WORKSPACE',
      upstreamStatus: 404,
    });
    expect(preflightRes.body.data.deploymentCheck.workspaceDiscovery?.discoveredApps).toEqual([
      expect.objectContaining({
        appId: 'CareVoice-Verified-1234-5678',
        matchesConfiguredAppId: false,
        sources: ['campaign'],
        versions: [3],
      }),
    ]);

    const beforeCount = await CallLog.countDocuments({});
    const blockedRes = await request(app)
      .post('/api/voice-calls/real-test')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        familyMemberId: memberAllGrantedId,
        doseInstanceId: doseGrantedId,
        callType: 'MEDICINE_REMINDER',
        confirmedByAdmin: true,
        overrideQuietHours: true,
      });

    expect(blockedRes.status).toBe(502);
    expect(blockedRes.body.code).toBe('SARVAM_DEPLOYMENT_NOT_READY');
    expect(await CallLog.countDocuments({})).toBe(beforeCount);
    expect(
      discoveryFetch.mock.calls.every(([url, init]) => !String(url).includes('/outbounds') && (init?.method || 'GET') === 'GET')
    ).toBe(true);
  });

  it('Scenario 2, 3 & 4: blocks denied voice consent, invalid E.164, disabled calling preference, RBAC & missing Admin confirmation', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    // RBAC: Caregiver and Viewer cannot place real test calls
    const cgTry = await request(app)
      .post('/api/voice-calls/real-test')
      .set('Authorization', `Bearer ${caregiverToken}`)
      .send({
        familyMemberId: memberAllGrantedId,
        doseInstanceId: doseGrantedId,
        confirmedByAdmin: true,
        overrideQuietHours: true,
      });
    expect(cgTry.status).toBe(403);

    const vwTry = await request(app)
      .post('/api/voice-calls/real-test')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({
        familyMemberId: memberAllGrantedId,
        doseInstanceId: doseGrantedId,
        confirmedByAdmin: true,
        overrideQuietHours: true,
      });
    expect(vwTry.status).toBe(403);

    // Explicit Admin confirmation required
    const noConfirm = await request(app)
      .post('/api/voice-calls/real-test')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        familyMemberId: memberAllGrantedId,
        doseInstanceId: doseGrantedId,
        confirmedByAdmin: false,
      });
    expect(noConfirm.status).toBe(422);

    // Voice calling consent DENIED -> blocked (403)
    const deniedConsent = await request(app)
      .post('/api/voice-calls/real-test')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        familyMemberId: memberNoCallConsentId,
        doseInstanceId: doseNoCallConsentId,
        confirmedByAdmin: true,
        overrideQuietHours: true,
      });
    expect(deniedConsent.status).toBe(403);
    expect(deniedConsent.body.message).toMatch(/voice calling consent/i);

    // Invalid E.164 phone number -> rejected (422)
    const badPhone = await request(app)
      .post('/api/voice-calls/real-test')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        familyMemberId: memberBadPhoneId,
        doseInstanceId: doseBadPhoneId,
        confirmedByAdmin: true,
        overrideQuietHours: true,
      });
    expect(badPhone.status).toBe(422);

    // Calling preference disabled -> blocked (403)
    const disabledPref = await request(app)
      .post('/api/voice-calls/real-test')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        familyMemberId: memberDisabledMedPrefId,
        doseInstanceId: doseDisabledMedPrefId,
        callType: 'MEDICINE_REMINDER',
        confirmedByAdmin: true,
        overrideQuietHours: true,
      });
    expect(disabledPref.status).toBe(403);
    expect(disabledPref.body.message).toMatch(/calling preferences/i);

    // Sarvam HTTP API should never be touched for invalid/blocked calls
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Scenario 2b: allows calling when VOICE_CALLING=GRANTED & CALL_RECORDING=DENIED while strictly withholding transcript and audio', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            deployment_id: 'dep_live_1',
            app_id: 'Conversatio-a7e64173-3c11',
            app_version: 3,
            status: 'active',
            connection_configs: [
              { connection_id: '50141c04-3e-a97582cf-bbd0', phone_numbers: ['+917965860596'] },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            attempt_id: 'attempt_no_recording_consent_001',
            status: 'QUEUED',
          }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const dialRes = await request(app)
      .post('/api/voice-calls/real-test')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        familyMemberId: memberNoRecordConsentId,
        doseInstanceId: doseNoRecordConsentId,
        callType: 'MEDICINE_REMINDER',
        confirmedByAdmin: true,
        overrideQuietHours: true,
      });

    expect(dialRes.status).toBe(201);
    const callId = dialRes.body.data.callLog._id as string;
    expect(dialRes.body.data.callLog.recordingConsentGranted).toBe(false);
    expect(dialRes.body.data.callLog.recordingStatus).toBe('CONSENT_DENIED');

    // Connected webhook delivers transcript + recording_url, which MUST be withheld!
    const whRes = await request(app)
      .post(`/api/voice-agent/webhook/sarvam/${TEST_WEBHOOK_TOKEN}`)
      .send({
        attempt_id: 'attempt_no_recording_consent_001',
        status: 'connected',
        interaction_id: '20261112/int_no_rec_1',
        recording_url: 'https://sarvam.example/secret-audio.wav',
        duration: 25,
        final_agent_variables: {
          medicine_taken: true,
          summary: 'Private patient transcript summary that must not leak',
        },
        interaction_transcript: [
          { role: 'agent', en_text: 'Please take Atorvastatin.' },
          { role: 'user', en_text: 'Taken.' },
        ],
        webhook_config: {
          metadata: {
            patient_id: memberNoRecordConsentId,
            dose_id: doseNoRecordConsentId,
            call_log_id: callId,
          },
        },
      });
    expect(whRes.status).toBe(200);
    expect(whRes.body.data.callLog.recordingStatus).toBe('CONSENT_DENIED');
    expect(whRes.body.data.callLog.transcriptAvailable).toBe(false);
    expect(whRes.body.data.conversation.turns).toEqual([]);
    expect(whRes.body.data.conversation.aiSummary).not.toContain('Private patient transcript');

    const recFetch = await request(app)
      .get(`/api/calls/${callId}/recording`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(recFetch.status).toBe(403);
  });

  it('Scenario 5, 8, 9 & 10: initiates real test call, prevents duplicates, processes RINGING->IN_PROGRESS->CONNECTED, proxies recording, and isolates meal vs medicine confirmation', async () => {
    const mockFetch = vi
      .fn()
      // 1) GET /deployments
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            deployment_id: 'dep_live_1',
            app_id: 'Conversatio-a7e64173-3c11',
            app_version: 3,
            status: 'active',
            connection_configs: [
              { connection_id: '50141c04-3e-a97582cf-bbd0', phone_numbers: ['+917965860596'] },
            ],
          },
        ],
      })
      // 2) POST /outbounds
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            attempt_id: 'attempt_live_lifecycle_001',
            status: 'queued',
          }),
      });
    vi.stubGlobal('fetch', mockFetch);

    const dialRes = await request(app)
      .post('/api/voice-calls/real-test')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        familyMemberId: memberAllGrantedId,
        doseInstanceId: doseGrantedId,
        callType: 'MEDICINE_REMINDER',
        purpose: 'Verify real Sarvam Vobiz outbound calling',
        confirmedByAdmin: true,
        overrideQuietHours: true,
      });

    expect(dialRes.status).toBe(201);
    const callLogId = dialRes.body.data.callLog._id as string;
    expect(dialRes.body.data.callLog.isMock).toBe(false);
    expect(dialRes.body.data.callLog.isTestCall).toBe(true);
    expect(dialRes.body.data.callLog.mode).toBe('live');
    expect(dialRes.body.data.callLog.callStatus).toBe('QUEUED');
    expect(dialRes.body.data.callLog.outcome).toBe('PENDING'); // Never faked as COMPLETED!
    expect(dialRes.body.data.callLog.attemptId).toBe('attempt_live_lifecycle_001');
    expect(dialRes.body.data.providerResponse.httpStatus).toBe(200);

    // Dose must STILL be PENDING (never auto-taken on initiation!)
    const doseBeforeWebhook = await DoseInstance.findById(doseGrantedId).lean();
    expect(doseBeforeWebhook?.status).toBe('PENDING');

    // Scenario 9: Duplicate active call for same dose + callType blocked with 409 Conflict
    const dupRes = await request(app)
      .post('/api/voice-calls/real-test')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        familyMemberId: memberAllGrantedId,
        doseInstanceId: doseGrantedId,
        callType: 'MEDICINE_REMINDER',
        confirmedByAdmin: true,
        overrideQuietHours: true,
      });
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.message).toMatch(/Duplicate call prevented/i);
    // Outbound fetch still called only once (GET deployments + POST outbounds = 2 total)
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Scenario 8: Intermediate RINGING webhook
    const ringRes = await request(app)
      .post(`/api/voice-agent/webhook/sarvam/${TEST_WEBHOOK_TOKEN}`)
      .send({
        attempt_id: 'attempt_live_lifecycle_001',
        status: 'ringing',
        started_at: '2026-11-12T07:05:00.000Z',
      });
    expect(ringRes.status).toBe(200);
    expect(ringRes.body.data.callLog.callStatus).toBe('RINGING');
    expect(ringRes.body.data.callLog.outcome).toBe('PENDING');

    // Intermediate IN_PROGRESS webhook
    const inProgRes = await request(app)
      .post(`/api/voice-agent/webhook/sarvam/${TEST_WEBHOOK_TOKEN}`)
      .send({
        attempt_id: 'attempt_live_lifecycle_001',
        status: 'in_progress',
        interaction_id: '20261112/int_lifecycle_1',
      });
    expect(inProgRes.status).toBe(200);
    expect(inProgRes.body.data.callLog.callStatus).toBe('IN_PROGRESS');

    const statusPoll = await request(app)
      .get(`/api/voice-calls/${callLogId}/status`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(statusPoll.status).toBe(200);
    expect(statusPoll.body.data.callStatus).toBe('IN_PROGRESS');

    // Scenario 10: Terminal CONNECTED with meal_finished=true ONLY -> meal FINISHED, dose stays UNCONFIRMED
    const mealOnlyWh = await request(app)
      .post(`/api/voice-agent/webhook/sarvam/${TEST_WEBHOOK_TOKEN}`)
      .send({
        attempt_id: 'attempt_live_lifecycle_001',
        status: 'connected',
        interaction_id: '20261112/int_lifecycle_1',
        ended_at: '2026-11-12T07:05:32.000Z',
        duration: 32,
        final_agent_variables: {
          meal_finished: true,
        },
        interaction_transcript: [
          { role: 'agent', en_text: 'Did you eat breakfast?', indic_text: 'టిఫిన్ చేశారా?' },
          { role: 'user', en_text: 'Yes I ate.', indic_text: 'అవును తిన్నాను.' },
        ],
        webhook_config: {
          metadata: {
            patient_id: memberAllGrantedId,
            dose_id: doseGrantedId,
            call_log_id: callLogId,
          },
        },
      });
    expect(mealOnlyWh.status).toBe(200);
    expect(mealOnlyWh.body.data.callLog.callStatus).toBe('COMPLETED');
    expect(mealOnlyWh.body.data.callLog.outcome).toBe('ANSWERED');
    expect(mealOnlyWh.body.data.callLog.recordingStatus).toBe('AVAILABLE');
    expect(mealOnlyWh.body.data.callLog.transcriptAvailable).toBe(true);

    const doseAfterMealOnly = await DoseInstance.findById(doseGrantedId).lean();
    expect(doseAfterMealOnly?.mealStatus).toBe('FINISHED');
    expect(doseAfterMealOnly?.status).toBe('UNCONFIRMED');

    // Late out-of-order ringing webhook must NOT regress COMPLETED back to RINGING
    const lateRing = await request(app)
      .post(`/api/voice-agent/webhook/sarvam/${TEST_WEBHOOK_TOKEN}`)
      .send({
        attempt_id: 'attempt_live_lifecycle_001',
        event_id: 'late_ring_evt',
        status: 'ringing',
      });
    expect(lateRing.status).toBe(200);
    expect(lateRing.body.data.callLog.callStatus).toBe('COMPLETED');

    // Recording proxy fetches WAV from Sarvam Analytics API when recordingConsentGranted=true
    const audioFetchSpy = vi.fn().mockResolvedValueOnce(
      new Response(Uint8Array.from([82, 73, 70, 70, 1, 2, 3, 4]), {
        status: 200,
        headers: { 'content-type': 'audio/wav' },
      })
    );
    vi.stubGlobal('fetch', audioFetchSpy);

    const audioRes = await request(app)
      .get(`/api/calls/${callLogId}/recording`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(audioRes.status).toBe(200);
    expect(audioRes.headers['content-type']).toContain('audio/wav');
    expect(audioFetchSpy).toHaveBeenCalledTimes(1);
    expect(String(audioFetchSpy.mock.calls[0][0])).toContain(
      '/api/analytics/v1/019f94e8-30dd-71f1-8cc7-d6398bf00fb1/019f94e8-30e1-79b6-9357-17bcb1f1e5bf/Conversatio-a7e64173-3c11/recordings/20261112/int_lifecycle_1'
    );

    // Follow-up confirmation call explicitly reports medicine_taken=true -> marks TAKEN
    const verifiedDeploymentPayload = [
      {
        deployment_id: 'dep_live_1',
        app_id: 'Conversatio-a7e64173-3c11',
        app_version: 3,
        status: 'active',
        connection_configs: [
          { connection_id: '50141c04-3e-a97582cf-bbd0', phone_numbers: ['+917965860596'] },
        ],
      },
    ];
    const followUpFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => verifiedDeploymentPayload,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            attempt_id: 'attempt_live_confirm_002',
            status: 'INITIATING',
          }),
      });
    vi.stubGlobal('fetch', followUpFetch);

    const followUpDial = await request(app)
      .post('/api/voice-calls/real-test')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        familyMemberId: memberAllGrantedId,
        doseInstanceId: doseGrantedId,
        callType: 'CONFIRMATION_CALL',
        confirmedByAdmin: true,
        overrideQuietHours: true,
      });
    expect(followUpDial.status).toBe(201);

    const confirmWh = await request(app)
      .post(`/api/voice-agent/webhook/sarvam/${TEST_WEBHOOK_TOKEN}`)
      .send({
        attempt_id: 'attempt_live_confirm_002',
        status: 'completed',
        interaction_id: '20261112/int_confirm_2',
        duration: 18,
        final_agent_variables: {
          meal_finished: true,
          medicine_taken: true,
        },
        webhook_config: {
          metadata: {
            patient_id: memberAllGrantedId,
            dose_id: doseGrantedId,
            call_log_id: followUpDial.body.data.callLog._id,
          },
        },
      });
    expect(confirmWh.status).toBe(200);

    const doseAfterTaken = await DoseInstance.findById(doseGrantedId).lean();
    expect(doseAfterTaken?.status).toBe('PATIENT_REPORTED_TAKEN');
  }, 60000);

  it('Scenario 6 & 7: handles Sarvam outbound provider failure truthfully, NO_ANSWER webhook, and Admin manual cancel', async () => {
    const verifiedDeploymentPayload = [
      {
        deployment_id: 'dep_live_1',
        app_id: 'Conversatio-a7e64173-3c11',
        app_version: 3,
        status: 'active',
        connection_configs: [
          { connection_id: '50141c04-3e-a97582cf-bbd0', phone_numbers: ['+917965860596'] },
        ],
      },
    ];
    // Provider returns HTTP 422 error on POST /outbounds
    const failFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => verifiedDeploymentPayload,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        text: async () =>
          JSON.stringify({ detail: 'Invalid telephony trunk connection_id' }),
      });
    vi.stubGlobal('fetch', failFetch);

    const failRes = await request(app)
      .post('/api/voice-calls/real-test')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        familyMemberId: memberAllGrantedId,
        doseInstanceId: doseSecondGrantedId,
        callType: 'MEDICINE_REMINDER',
        confirmedByAdmin: true,
        overrideQuietHours: true,
      });

    expect(failRes.status).toBe(502);
    expect(failRes.body.code).toBe('SARVAM_PROVIDER_ERROR');
    expect(failRes.body.message).toContain('Invalid telephony trunk connection_id');
    const failedLogId = failRes.body.details?.callLogId as string;
    expect(failedLogId).toBeTruthy();

    const storedFailed = await CallLog.findById(failedLogId).lean();
    expect(storedFailed?.callStatus).toBe('FAILED');
    expect(storedFailed?.outcome).toBe('FAILED');
    expect(storedFailed?.failureReason).toContain('Invalid telephony trunk connection_id');

    // Scenario 7: Single NO_ANSWER on fresh dose keeps dose UNCONFIRMED (never assumed taken)
    const okFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => verifiedDeploymentPayload,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            attempt_id: 'attempt_no_answer_003',
            status: 'INITIATING',
          }),
      });
    vi.stubGlobal('fetch', okFetch);

    const dial2 = await request(app)
      .post('/api/voice-calls/real-test')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        familyMemberId: memberAllGrantedId,
        doseInstanceId: doseThirdGrantedId,
        callType: 'MEDICINE_REMINDER',
        confirmedByAdmin: true,
        overrideQuietHours: true,
      });
    expect(dial2.status).toBe(201);

    const naWebhook = await request(app)
      .post(`/api/voice-agent/webhook/sarvam/${TEST_WEBHOOK_TOKEN}`)
      .send({
        attempt_id: 'attempt_no_answer_003',
        status: 'no_answer',
        duration: 0,
      });
    expect(naWebhook.status).toBe(200);
    expect(naWebhook.body.data.callLog.callStatus).toBe('NO_ANSWER');
    expect(naWebhook.body.data.callLog.outcome).toBe('NO_ANSWER');

    const doseAfterNA = await DoseInstance.findById(doseThirdGrantedId).lean();
    expect(doseAfterNA?.status).toBe('UNCONFIRMED');

    // Admin cancel on an active call transitions lifecycle cleanly to CANCELLED
    const activeFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => verifiedDeploymentPayload })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            attempt_id: 'attempt_cancel_004',
            status: 'ringing',
          }),
      });
    vi.stubGlobal('fetch', activeFetch);

    const dial3 = await request(app)
      .post('/api/voice-calls/real-test')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        familyMemberId: memberAllGrantedId,
        doseInstanceId: doseSecondGrantedId,
        callType: 'CONFIRMATION_CALL',
        confirmedByAdmin: true,
        overrideQuietHours: true,
      });
    expect(dial3.status).toBe(201);
    const call3Id = dial3.body.data.callLog._id as string;

    const cancelRes = await request(app)
      .post(`/api/voice-calls/${call3Id}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Admin stopped test call' });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.callLog.callStatus).toBe('CANCELLED');
    expect(cancelRes.body.data.callLog.outcome).toBe('CANCELLED');
  });

  it('Scenario 11: reconciles missed webhooks & async Analytics transcripts via GET /attempts, GET /interactions, GET /transcripts, and honest HTTP 404 recording checks', async () => {
    const recMemberRes = await request(app)
      .post('/api/family-members')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Venkat Rao',
        phoneNumber: '+919876543250',
        preferredLanguage: 'te',
        timezone: 'Asia/Kolkata',
        relationship: 'Father',
        emergencyContact: { name: 'Admin Rao', phoneNumber: '+919876500099', relationship: 'Son' },
        voiceCallingConsentStatus: 'GRANTED',
        transcriptConsentStatus: 'GRANTED',
        recordingConsentStatus: 'GRANTED',
      });
    expect(recMemberRes.status).toBe(201);
    const recMemberId = recMemberRes.body.data.id as string;

    const recMedRes = await request(app)
      .post('/api/medicines')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        familyMemberId: recMemberId,
        name: 'Clopidogrel',
        dosage: '75mg',
        prescribedInstructions: 'Take after lunch',
        foodInstruction: 'AFTER_FOOD',
        associatedMeal: 'LUNCH',
        startDate: new Date().toISOString(),
        frequency: 'TWICE_DAILY',
        scheduledTimes: [
          {
            slotLabel: 'Lunch Slot',
            timeOfDay: '13:30',
            associatedMeal: 'LUNCH',
            foodInstruction: 'AFTER_FOOD',
            mealReminderOffsetMinutes: -15,
            medicineReminderOffsetMinutes: 0,
            confirmationOffsetMinutes: 20,
          },
          {
            slotLabel: 'Dinner Slot',
            timeOfDay: '20:30',
            associatedMeal: 'DINNER',
            foodInstruction: 'AFTER_FOOD',
            mealReminderOffsetMinutes: -15,
            medicineReminderOffsetMinutes: 0,
            confirmationOffsetMinutes: 20,
          },
        ],
      });
    expect(recMedRes.status).toBe(201);
    const recDoses = await DoseInstance.find({ medicineId: recMedRes.body.data.id }).lean();
    const doseA = String(recDoses[0]._id);
    const doseB = String(recDoses[1]._id);

    const verifiedDep = [
      {
        deployment_id: 'dep_live_1',
        app_id: 'Conversatio-a7e64173-3c11',
        app_version: 3,
        status: 'active',
        connection_configs: [
          { connection_id: '50141c04-3e-a97582cf-bbd0', phone_numbers: ['+917965860596'] },
        ],
      },
    ];

    // Part A: Missed webhook recovered as NOT_CONNECTED via GET /attempts
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => verifiedDep })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ attempt_id: 'attempt_reconcile_nc_01', status: 'INITIATING' }),
        })
    );

    const dialA = await request(app)
      .post('/api/voice-calls/real-test')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        familyMemberId: recMemberId,
        doseInstanceId: doseA,
        callType: 'MEDICINE_REMINDER',
        confirmedByAdmin: true,
        overrideQuietHours: true,
      });
    expect(dialA.status).toBe(201);
    const callAId = dialA.body.data.callLog._id as string;

    // Now reconcile with Sarvam GET /attempts returning NOT_CONNECTED + NO_FAILURE_REASON sentinel
    const analyticsFetchA = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/attempts')) {
        return new Response(
          JSON.stringify({
            attempts: [
              {
                attempt_id: 'attempt_reconcile_nc_01',
                connectivity_status: 'NOT_CONNECTED',
                failure_reason: 'NO_FAILURE_REASON',
                ended_by: 'NO_END_REASON',
                duration_in_seconds: 0,
                start_datetime: '2026-11-12T08:00:00',
                end_datetime: '2026-11-12T08:00:15',
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', analyticsFetchA);

    const recARes = await request(app)
      .post(`/api/voice-calls/${callAId}/reconcile`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(recARes.status).toBe(200);
    expect(recARes.body.data.callLog.callStatus).toBe('NOT_CONNECTED');
    expect(recARes.body.data.callLog.outcome).toBe('NOT_CONNECTED');
    expect(recARes.body.data.callLog.failureReason).toBeUndefined();

    // Part B: Webhook arrived connected WITHOUT transcript; reconciliation fetches Analytics transcripts & probes recording HTTP 404 honestly
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => verifiedDep })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ attempt_id: 'attempt_reconcile_tr_02', status: 'INITIATING' }),
        })
    );
    const dialB = await request(app)
      .post('/api/voice-calls/real-test')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        familyMemberId: recMemberId,
        doseInstanceId: doseB,
        callType: 'MEDICINE_REMINDER',
        confirmedByAdmin: true,
        overrideQuietHours: true,
      });
    expect(dialB.status).toBe(201);
    const callBId = dialB.body.data.callLog._id as string;

    const whB = await request(app)
      .post(`/api/voice-agent/webhook/sarvam/${TEST_WEBHOOK_TOKEN}`)
      .send({
        attempt_id: 'attempt_reconcile_tr_02',
        status: 'connected',
        interaction_id: 'int_async_tr_02',
        duration: 24,
        final_agent_variables: { medicine_taken: true },
      });
    expect(whB.status).toBe(200);
    expect(whB.body.data.callLog.transcriptStatus).toBe('PENDING');

    const analyticsFetchB = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/interactions')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                interaction_id: 'int_async_tr_02',
                language_name: 'Telugu',
                original_transcript: [
                  { role: 'agent', content: 'భోజనం తర్వాత మందు వేసుకున్నారా?' },
                  { role: 'user', content: 'అవును, వేసుకున్నాను.' },
                ],
                translate_transcript: [
                  { role: 'agent', content: 'Did you take medicine after food?' },
                  { role: 'user', content: 'Yes, I took it.' },
                ],
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('/transcripts/int_async_tr_02')) {
        return new Response(
          JSON.stringify({
            messages: [
              { turn_id: 1, role: 'agent', content: 'భోజనం తర్వాత మందు వేసుకున్నారా?', language_name: 'Telugu' },
              { turn_id: 2, role: 'user', content: 'అవును, వేసుకున్నాను.', language_name: 'Telugu' },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('/recordings/int_async_tr_02')) {
        return new Response(JSON.stringify({ detail: 'Not found' }), { status: 404 });
      }
      return new Response(JSON.stringify({ attempts: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', analyticsFetchB);

    const recBRes = await request(app)
      .post(`/api/voice-calls/${callBId}/reconcile`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(recBRes.status).toBe(200);
    expect(recBRes.body.data.callLog.transcriptAvailable).toBe(true);
    expect(recBRes.body.data.callLog.transcriptStatus).toBe('AVAILABLE');
    expect(recBRes.body.data.callLog.transcriptSource).toBe('ANALYTICS_API');
    expect(recBRes.body.data.callLog.actualLanguageUsed).toBe('te');
    expect(recBRes.body.data.callLog.languageStatus).toBe('MATCHED');
    expect(recBRes.body.data.callLog.recordingStatus).toBe('UNAVAILABLE');
    expect(recBRes.body.data.callLog.recordingNote).toContain('HTTP 404');
    expect(recBRes.body.data.conversation.turns).toHaveLength(2);
    expect(recBRes.body.data.conversation.turns[0].text).toBe('భోజనం తర్వాత మందు వేసుకున్నారా?');
    expect(recBRes.body.data.conversation.turns[0].translatedText).toBe('Did you take medicine after food?');
  }, 60000);

  it('Scenario 12: enforces full 3-way independent consent matrix and revocation retention policy', async () => {
    const verifiedDep = [
      {
        deployment_id: 'dep_live_1',
        app_id: 'Conversatio-a7e64173-3c11',
        app_version: 3,
        status: 'active',
        connection_configs: [
          { connection_id: '50141c04-3e-a97582cf-bbd0', phone_numbers: ['+917965860596'] },
        ],
      },
    ];

    // 1) VOICE_CALLING=GRANTED, CALL_TRANSCRIPT=GRANTED, CALL_RECORDING=DENIED
    const mTrOnly = await request(app)
      .post('/api/family-members')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Padmavathi Devi',
        phoneNumber: '+919876543251',
        preferredLanguage: 'te',
        timezone: 'Asia/Kolkata',
        relationship: 'Mother',
        emergencyContact: { name: 'Admin Rao', phoneNumber: '+919876500099', relationship: 'Son' },
        voiceCallingConsentStatus: 'GRANTED',
        transcriptConsentStatus: 'GRANTED',
        recordingConsentStatus: 'DENIED',
      });
    expect(mTrOnly.status).toBe(201);
    const mTrOnlyId = mTrOnly.body.data.id as string;

    const medTrOnly = await request(app)
      .post('/api/medicines')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        familyMemberId: mTrOnlyId,
        name: 'Glimepiride',
        dosage: '1mg',
        prescribedInstructions: 'Before breakfast',
        foodInstruction: 'BEFORE_FOOD',
        associatedMeal: 'BREAKFAST',
        startDate: new Date().toISOString(),
        frequency: 'ONCE_DAILY',
        scheduledTimes: [
          {
            slotLabel: 'Breakfast',
            timeOfDay: '08:00',
            associatedMeal: 'BREAKFAST',
            foodInstruction: 'BEFORE_FOOD',
            mealReminderOffsetMinutes: -15,
            medicineReminderOffsetMinutes: 0,
            confirmationOffsetMinutes: 20,
          },
        ],
      });
    const doseTrOnlyId = String((await DoseInstance.findOne({ medicineId: medTrOnly.body.data.id }).lean())?._id);

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => verifiedDep })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ attempt_id: 'attempt_tr_only_01', status: 'INITIATING' }),
        })
    );
    const dialTrOnly = await request(app)
      .post('/api/voice-calls/real-test')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        familyMemberId: mTrOnlyId,
        doseInstanceId: doseTrOnlyId,
        callType: 'MEDICINE_REMINDER',
        confirmedByAdmin: true,
        overrideQuietHours: true,
      });
    expect(dialTrOnly.status).toBe(201);
    const callTrOnlyId = dialTrOnly.body.data.callLog._id as string;

    const whTrOnly = await request(app)
      .post(`/api/voice-agent/webhook/sarvam/${TEST_WEBHOOK_TOKEN}`)
      .send({
        attempt_id: 'attempt_tr_only_01',
        status: 'connected',
        interaction_id: 'int_tr_only_01',
        duration: 21,
        final_agent_variables: { medicine_taken: true, summary: 'Transcript allowed while audio denied' },
        interaction_transcript: [
          { role: 'agent', en_text: 'Take Glimepiride?', indic_text: 'మందు వేసుకున్నారా?' },
          { role: 'user', en_text: 'Yes.', indic_text: 'అవును.' },
        ],
      });
    expect(whTrOnly.status).toBe(200);
    expect(whTrOnly.body.data.callLog.transcriptAvailable).toBe(true);
    expect(whTrOnly.body.data.callLog.transcriptStatus).toBe('AVAILABLE');
    expect(whTrOnly.body.data.callLog.recordingStatus).toBe('CONSENT_DENIED');
    expect(whTrOnly.body.data.conversation.turns).toHaveLength(2);
    expect(whTrOnly.body.data.recording).toBeNull();

    const recBlocked = await request(app)
      .get(`/api/calls/${callTrOnlyId}/recording`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(recBlocked.status).toBe(403);

    // Now test Revocation Retention Policy! Grant recording too on a fresh member, save call with transcript + recording, then revoke both
    const mRevoke = await request(app)
      .post('/api/family-members')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Kausalya Devi',
        phoneNumber: '+919876543252',
        preferredLanguage: 'te',
        timezone: 'Asia/Kolkata',
        relationship: 'Grandmother',
        emergencyContact: { name: 'Admin Rao', phoneNumber: '+919876500099', relationship: 'Grandson' },
        voiceCallingConsentStatus: 'GRANTED',
        transcriptConsentStatus: 'GRANTED',
        recordingConsentStatus: 'GRANTED',
      });
    const mRevokeId = mRevoke.body.data.id as string;
    const medRevoke = await request(app)
      .post('/api/medicines')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        familyMemberId: mRevokeId,
        name: 'Losartan',
        dosage: '25mg',
        prescribedInstructions: 'After breakfast',
        foodInstruction: 'AFTER_FOOD',
        associatedMeal: 'BREAKFAST',
        startDate: new Date().toISOString(),
        frequency: 'ONCE_DAILY',
        scheduledTimes: [
          {
            slotLabel: 'Breakfast',
            timeOfDay: '08:00',
            associatedMeal: 'BREAKFAST',
            foodInstruction: 'AFTER_FOOD',
            mealReminderOffsetMinutes: -15,
            medicineReminderOffsetMinutes: 0,
            confirmationOffsetMinutes: 20,
          },
        ],
      });
    const doseRevokeId = String((await DoseInstance.findOne({ medicineId: medRevoke.body.data.id }).lean())?._id);

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => verifiedDep })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ attempt_id: 'attempt_revoke_01', status: 'INITIATING' }),
        })
    );
    const dialRevoke = await request(app)
      .post('/api/voice-calls/real-test')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        familyMemberId: mRevokeId,
        doseInstanceId: doseRevokeId,
        callType: 'MEDICINE_REMINDER',
        confirmedByAdmin: true,
        overrideQuietHours: true,
      });
    const callRevokeId = dialRevoke.body.data.callLog._id as string;

    await request(app)
      .post(`/api/voice-agent/webhook/sarvam/${TEST_WEBHOOK_TOKEN}`)
      .send({
        attempt_id: 'attempt_revoke_01',
        status: 'connected',
        interaction_id: 'int_revoke_01',
        duration: 20,
        final_agent_variables: { medicine_taken: true, secret_note: 'Sensitive dialogue variable' },
        interaction_transcript: [
          { role: 'agent', en_text: 'Take Losartan?', indic_text: 'లొసార్టన్ వేసుకున్నారా?' },
          { role: 'user', en_text: 'Yes.', indic_text: 'అవును.' },
        ],
      });

    expect(await Recording.countDocuments({ callLogId: callRevokeId })).toBe(1);
    const convBeforeRevoke = await Conversation.findOne({ callLogId: callRevokeId }).lean();
    expect(convBeforeRevoke?.turns.length).toBe(2);

    // Revoke CALL_TRANSCRIPT (using alias TRANSCRIPT_CONSENT) -> purges stored turns & agent variables
    const revokeTrRes = await request(app)
      .patch(`/api/family-members/${mRevokeId}/consent`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ consentType: 'TRANSCRIPT_CONSENT', status: 'REVOKED', method: 'DASHBOARD' });
    expect(revokeTrRes.status).toBe(200);

    const convAfterRevoke = await Conversation.findOne({ callLogId: callRevokeId }).lean();
    expect(convAfterRevoke?.turns).toEqual([]);
    expect(convAfterRevoke?.finalAgentVariables).toBeUndefined();
    const callDetailAfterTrRevoke = await request(app)
      .get(`/api/calls/${callRevokeId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(callDetailAfterTrRevoke.body.data.callLog.transcriptAvailable).toBe(false);
    expect(callDetailAfterTrRevoke.body.data.callLog.transcriptStatus).toBe('CONSENT_DENIED');

    // Revoke CALL_RECORDING (using alias AUDIO_RECORDING_CONSENT) -> deletes Recording doc & blocks audio fetch
    const revokeRecRes = await request(app)
      .patch(`/api/family-members/${mRevokeId}/consent`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ consentType: 'AUDIO_RECORDING_CONSENT', status: 'REVOKED', method: 'DASHBOARD' });
    expect(revokeRecRes.status).toBe(200);
    expect(await Recording.countDocuments({ callLogId: callRevokeId })).toBe(0);

    const recAfterRevoke = await request(app)
      .get(`/api/calls/${callRevokeId}/recording`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(recAfterRevoke.status).toBe(403);
  }, 60000);

  it('Scenario 13: blocks unsupported language without silent Hindi fallback, allows explicit authorized fallback, and flags language mismatch', async () => {
    const verifiedDep = [
      {
        deployment_id: 'dep_live_1',
        app_id: 'Conversatio-a7e64173-3c11',
        app_version: 3,
        status: 'active',
        connection_configs: [
          { connection_id: '50141c04-3e-a97582cf-bbd0', phone_numbers: ['+917965860596'] },
        ],
      },
    ];

    const mUrRes = await request(app)
      .post('/api/family-members')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Farida Begum',
        phoneNumber: '+919876543253',
        preferredLanguage: 'ur',
        timezone: 'Asia/Kolkata',
        relationship: 'Mother',
        emergencyContact: { name: 'Admin Rao', phoneNumber: '+919876500099', relationship: 'Son' },
        voiceCallingConsentStatus: 'GRANTED',
        transcriptConsentStatus: 'GRANTED',
        recordingConsentStatus: 'GRANTED',
      });
    expect(mUrRes.status).toBe(201);
    const mUrId = mUrRes.body.data.id as string;

    const medUr = await request(app)
      .post('/api/medicines')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        familyMemberId: mUrId,
        name: 'Pantoprazole',
        dosage: '40mg',
        prescribedInstructions: 'Before breakfast',
        foodInstruction: 'BEFORE_FOOD',
        associatedMeal: 'BREAKFAST',
        startDate: new Date().toISOString(),
        frequency: 'TWICE_DAILY',
        scheduledTimes: [
          {
            slotLabel: 'Breakfast',
            timeOfDay: '08:00',
            associatedMeal: 'BREAKFAST',
            foodInstruction: 'BEFORE_FOOD',
            mealReminderOffsetMinutes: -15,
            medicineReminderOffsetMinutes: 0,
            confirmationOffsetMinutes: 20,
          },
          {
            slotLabel: 'Dinner',
            timeOfDay: '20:00',
            associatedMeal: 'DINNER',
            foodInstruction: 'BEFORE_FOOD',
            mealReminderOffsetMinutes: -15,
            medicineReminderOffsetMinutes: 0,
            confirmationOffsetMinutes: 20,
          },
        ],
      });
    const urDoses = await DoseInstance.find({ medicineId: medUr.body.data.id }).lean();
    const doseUrId = String(urDoses[0]._id);

    // 1) Dialing Urdu without fallback authorization returns 422 LANGUAGE_FALLBACK_REQUIRED without hitting POST /outbounds
    const noFbFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => verifiedDep,
    });
    vi.stubGlobal('fetch', noFbFetch);

    const blockedLang = await request(app)
      .post('/api/voice-calls/real-test')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        familyMemberId: mUrId,
        doseInstanceId: doseUrId,
        callType: 'MEDICINE_REMINDER',
        confirmedByAdmin: true,
        overrideQuietHours: true,
      });
    expect(blockedLang.status).toBe(422);
    expect(blockedLang.body.code).toBe('LANGUAGE_FALLBACK_REQUIRED');
    expect(blockedLang.body.details.requiresFallbackPermission).toBe(true);
    expect(Array.isArray(blockedLang.body.details.availableFallbackLanguages)).toBe(true);
    // Only preflight GET /deployments ran; POST /outbounds was NOT called
    expect(noFbFetch).toHaveBeenCalledTimes(1);

    // 2) Retry with explicit fallback authorization (English 'en', NOT silent Hindi) succeeds
    const fbFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => verifiedDep })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ attempt_id: 'attempt_fb_en_01', status: 'INITIATING' }),
      });
    vi.stubGlobal('fetch', fbFetch);

    const fbCall = await request(app)
      .post('/api/voice-calls/real-test')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        familyMemberId: mUrId,
        doseInstanceId: doseUrId,
        callType: 'MEDICINE_REMINDER',
        confirmedByAdmin: true,
        overrideQuietHours: true,
        allowLanguageFallback: true,
        fallbackLanguage: 'en',
      });
    expect(fbCall.status).toBe(201);
    expect(fbCall.body.data.callLog.requestedLanguage).toBe('ur');
    expect(fbCall.body.data.callLog.fallbackLanguage).toBe('en');
    expect(fbCall.body.data.callLog.language).toBe('en');
    expect(fbCall.body.data.callLog.languageStatus).toBe('FALLBACK_AUTHORIZED');

    // 3) Language mismatch detection: if Telugu ('te') call webhook reports Sarvam spoke 'Hindi', flag LANGUAGE_MISMATCH
    const mTeMismatch = await request(app)
      .post('/api/family-members')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Subba Rao',
        phoneNumber: '+919876543254',
        preferredLanguage: 'te',
        timezone: 'Asia/Kolkata',
        relationship: 'Father',
        emergencyContact: { name: 'Admin Rao', phoneNumber: '+919876500099', relationship: 'Son' },
        voiceCallingConsentStatus: 'GRANTED',
        transcriptConsentStatus: 'GRANTED',
        recordingConsentStatus: 'GRANTED',
      });
    const medMismatch = await request(app)
      .post('/api/medicines')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        familyMemberId: mTeMismatch.body.data.id,
        name: 'Aspirin',
        dosage: '75mg',
        prescribedInstructions: 'After dinner',
        foodInstruction: 'AFTER_FOOD',
        associatedMeal: 'DINNER',
        startDate: new Date().toISOString(),
        frequency: 'ONCE_DAILY',
        scheduledTimes: [
          {
            slotLabel: 'Dinner',
            timeOfDay: '20:00',
            associatedMeal: 'DINNER',
            foodInstruction: 'AFTER_FOOD',
            mealReminderOffsetMinutes: -15,
            medicineReminderOffsetMinutes: 0,
            confirmationOffsetMinutes: 20,
          },
        ],
      });
    const doseMismatchId = String((await DoseInstance.findOne({ medicineId: medMismatch.body.data.id }).lean())?._id);

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => verifiedDep })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ attempt_id: 'attempt_mismatch_hi_01', status: 'INITIATING' }),
        })
    );
    const dialMismatch = await request(app)
      .post('/api/voice-calls/real-test')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        familyMemberId: mTeMismatch.body.data.id,
        doseInstanceId: doseMismatchId,
        callType: 'MEDICINE_REMINDER',
        confirmedByAdmin: true,
        overrideQuietHours: true,
      });
    expect(dialMismatch.status).toBe(201);

    const mismatchWh = await request(app)
      .post(`/api/voice-agent/webhook/sarvam/${TEST_WEBHOOK_TOKEN}`)
      .send({
        attempt_id: 'attempt_mismatch_hi_01',
        status: 'connected',
        interaction_id: 'int_mismatch_hi_01',
        language_name: 'Hindi',
        duration: 15,
        final_agent_variables: { medicine_taken: true },
      });
    expect(mismatchWh.status).toBe(200);
    expect(mismatchWh.body.data.callLog.requestedLanguage).toBe('te');
    expect(mismatchWh.body.data.callLog.actualLanguageUsed).toBe('hi');
    expect(mismatchWh.body.data.callLog.languageStatus).toBe('LANGUAGE_MISMATCH');
  }, 60000);

  it('Scenario 16: unlocks supervised Instant Outbound test calls without requiring an Inbound Deployment or Bulk Campaign and reports 7 independent checks + CONNECTION_VERIFICATION_UNAVAILABLE', async () => {
    const instantMed = await request(app)
      .post('/api/medicines')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        familyMemberId: memberAllGrantedId,
        name: 'Vitamin D3',
        dosage: '1000IU',
        prescribedInstructions: 'After lunch',
        foodInstruction: 'AFTER_FOOD',
        associatedMeal: 'LUNCH',
        startDate: new Date().toISOString(),
        frequency: 'ONCE_DAILY',
        scheduledTimes: [
          {
            slotLabel: 'Lunch Slot',
            timeOfDay: '13:30',
            associatedMeal: 'LUNCH',
            foodInstruction: 'AFTER_FOOD',
            mealReminderOffsetMinutes: -15,
            medicineReminderOffsetMinutes: 0,
            confirmationOffsetMinutes: 20,
          },
        ],
      });
    expect(instantMed.status).toBe(201);
    const instantDoseId = String(
      (await DoseInstance.findOne({ medicineId: instantMed.body.data.id }).lean())?._id
    );

    const instantFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';
      if (url.includes('/outbounds') && method === 'POST') {
        return new Response(
          JSON.stringify({ attempt_id: 'attempt_instant_outbound_001', status: 'queued' }),
          { status: 200 }
        );
      }
      if (url.includes('/analytics/v1/') && url.includes('/interactions')) {
        return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', instantFetch);

    const preflightRes = await request(app)
      .get('/api/voice-calls/preflight?verifyDeployment=true')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(preflightRes.status).toBe(200);
    expect(preflightRes.body.data.liveCallingAllowed).toBe(true);
    expect(preflightRes.body.data.instantOutboundReady).toBe(true);
    expect(preflightRes.body.data.inboundDeploymentReady).toBe(false);
    expect(preflightRes.body.data.campaignReady).toBe(false);
    expect(preflightRes.body.data.connectionVerificationUnavailable).toBe(true);
    expect(preflightRes.body.data.deploymentCheck).toMatchObject({
      verified: false,
      instantOutboundReady: true,
      inboundDeploymentReady: false,
      campaignReady: false,
      connectionVerificationUnavailable: true,
      status: 'instant_outbound_ready',
      authCategory: 'CONNECTION_VERIFICATION_UNAVAILABLE',
    });
    expect(preflightRes.body.data.preflightChecks).toMatchObject({
      apiAuthentication: { status: 'VERIFIED', blocking: false },
      agentIdAndVersion: { status: 'UNVERIFIED', blocking: false },
      connectionIdValidity: { status: 'CONNECTION_VERIFICATION_UNAVAILABLE', blocking: false },
      callerNumberAvailability: { status: 'CONNECTION_VERIFICATION_UNAVAILABLE', blocking: false },
      outboundCapability: { status: 'CONNECTION_VERIFICATION_UNAVAILABLE', blocking: false },
      webhookReadiness: { status: 'READY', blocking: false },
      dynamicVariableCompatibility: { status: 'VERIFIED', blocking: false },
    });

    const dialRes = await request(app)
      .post('/api/voice-calls/real-test')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        familyMemberId: memberAllGrantedId,
        doseInstanceId: instantDoseId,
        callType: 'MEDICINE_REMINDER',
        confirmedByAdmin: true,
        overrideQuietHours: true,
      });
    expect(dialRes.status).toBe(201);
    expect(dialRes.body.data.providerResponse.attemptId).toBe('attempt_instant_outbound_001');
  }, 60000);
});

