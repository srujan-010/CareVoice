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
    ]);

    disconnectDatabase = dbMod.disconnectDatabase;
    app = appMod.createApp();
    FamilyMember = models[2].FamilyMember;
    Medicine = models[4].Medicine;
    DoseInstance = models[6].DoseInstance;
    CallLog = models[8].CallLog;
    Conversation = models[9].Conversation;

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
      allowMedicineReminders?: boolean;
      medicineName: string;
    }) => {
      const mRes = await request(app)
        .post('/api/family-members')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          fullName: opts.fullName,
          phoneNumber: opts.phoneNumber,
          preferredLanguage: 'te',
          timezone: 'Asia/Kolkata',
          relationship: 'Mother',
          emergencyContact: {
            name: 'Admin Rao',
            phoneNumber: '+919876500099',
            relationship: 'Son',
          },
          voiceCallingConsentStatus: opts.voiceConsent,
          recordingConsentStatus: opts.recordConsent,
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
          frequency: 'TWICE_DAILY',
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
      medicineName: 'Metformin',
    });
    memberAllGrantedId = m1.memberId;
    doseGrantedId = m1.doses[0];
    doseSecondGrantedId = m1.doses[1];

    const m2 = await createMemberWithMedicine({
      fullName: 'Sita Rao',
      phoneNumber: '+919876543211',
      voiceConsent: 'DENIED',
      recordConsent: 'DENIED',
      medicineName: 'Amlodipine',
    });
    memberNoCallConsentId = m2.memberId;
    doseNoCallConsentId = m2.doses[0];

    const m3 = await createMemberWithMedicine({
      fullName: 'Radha Rao',
      phoneNumber: '+919876543212',
      voiceConsent: 'GRANTED',
      recordConsent: 'DENIED',
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
  });

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
    const followUpFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [], // unlisted deployment allowed cleanly
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
  });

  it('Scenario 6 & 7: handles Sarvam outbound provider failure truthfully, NO_ANSWER webhook, and Admin manual cancel', async () => {
    // Provider returns HTTP 422 error on POST /outbounds
    const failFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
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

    // Scenario 7: Next dial succeeds -> webhook delivers no_answer -> dose stays UNCONFIRMED
    const okFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
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
        doseInstanceId: doseSecondGrantedId,
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

    const doseAfterNA = await DoseInstance.findById(doseSecondGrantedId).lean();
    expect(doseAfterNA?.status).toBe('UNCONFIRMED');

    // Admin cancel on an active call transitions lifecycle cleanly to CANCELLED
    const activeFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] })
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
});

