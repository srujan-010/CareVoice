import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TEST_DB_NAME = 'carevoice_test_sarvam_suite';
const TEST_API_KEY = 'sk_test_sarvam_integration_key_001';
const TEST_WEBHOOK_TOKEN = 'cv_wh_test_high_entropy_route_token_2026_secure';

describe('Sarvam Instant Outbound & Webhook End-to-End Integration Tests (Mocked HTTP)', () => {
  let app: ReturnType<typeof import('../../src/app').createApp>;
  let disconnectDatabase: typeof import('../../src/config/database').disconnectDatabase;
  let CallLog: typeof import('../../src/models/CallLog').CallLog;
  let CallSchedule: typeof import('../../src/models/CallSchedule').CallSchedule;
  let Callback: typeof import('../../src/models/Callback').Callback;
  let Conversation: typeof import('../../src/models/Conversation').Conversation;
  let DoseInstance: typeof import('../../src/models/DoseInstance').DoseInstance;
  let Escalation: typeof import('../../src/models/Escalation').Escalation;
  let AuditLog: typeof import('../../src/models/AuditLog').AuditLog;
  let executeScheduledCallJob: typeof import('../../src/services/call.service').executeScheduledCallJob;

  let authToken = '';
  let memberId = '';
  let medicineId = '';
  let doseIds: string[] = [];

  beforeAll(async () => {
    vi.resetModules();
    // Enable Sarvam config inside isolated test module scope using mocked HTTP only (no real telephony)
    vi.stubEnv('VOICE_PROVIDER_MODE', 'sarvam');
    vi.stubEnv('TELEPHONY_ENABLED', 'true');
    vi.stubEnv('SARVAM_API_BASE_URL', 'https://apps.sarvam.ai');
    vi.stubEnv('SARVAM_API_KEY', TEST_API_KEY);
    vi.stubEnv('SARVAM_ORG_ID', '019f94e8-30dd-71f1-8cc7-d6398bf00fb1');
    vi.stubEnv('SARVAM_WORKSPACE_ID', '019f94e8-30e1-79b6-9357-17bcb1f1e5bf');
    vi.stubEnv('SARVAM_AGENT_ID', 'Conversatio-a7e64173-3c11');
    vi.stubEnv('SARVAM_AGENT_VERSION', '1');
    vi.stubEnv('SARVAM_CONNECTION_ID', '50141c04-3e-a97582cf-bbd0');
    vi.stubEnv('SARVAM_PHONE_NUMBER', '+917965860596');
    vi.stubEnv('SARVAM_WEBHOOK_TOKEN', TEST_WEBHOOK_TOKEN);
    vi.stubEnv('PUBLIC_WEBHOOK_BASE_URL', 'https://carevoice-test.example');

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
    const callSvc = await import('../../src/services/call.service');

    disconnectDatabase = dbMod.disconnectDatabase;
    app = appMod.createApp();
    CallLog = models[8].CallLog;
    CallSchedule = models[7].CallSchedule;
    Callback = models[10].Callback;
    Conversation = models[9].Conversation;
    DoseInstance = models[6].DoseInstance;
    Escalation = models[12].Escalation;
    AuditLog = models[13].AuditLog;
    executeScheduledCallJob = callSvc.executeScheduledCallJob;

    await dbMod.connectDatabase(TEST_DB_NAME);
    await Promise.all([
      models[0].User.deleteMany({}),
      models[1].Family.deleteMany({}),
      models[2].FamilyMember.deleteMany({}),
      models[3].Consent.deleteMany({}),
      models[4].Medicine.deleteMany({}),
      models[5].MedicineSchedule.deleteMany({}),
      DoseInstance.deleteMany({}),
      CallSchedule.deleteMany({}),
      CallLog.deleteMany({}),
      Conversation.deleteMany({}),
      models[10].Callback.deleteMany({}),
      models[11].Notification.deleteMany({}),
      Escalation.deleteMany({}),
      AuditLog.deleteMany({}),
    ]);

    const regRes = await request(app).post('/api/auth/register').send({
      familyName: 'Reddy Care Family',
      name: 'Vikram Reddy',
      email: 'vikram.sarvam.test@carevoice.local',
      password: 'StrongPassword123!',
      timezone: 'Asia/Kolkata',
    });
    expect(regRes.status).toBe(201);
    authToken = regRes.body.data.token;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    if (mongoose.connection.readyState === 1) {
      await Promise.all([
        CallSchedule.deleteMany({}),
        CallLog.deleteMany({}),
        Callback.deleteMany({}),
        Conversation.deleteMany({}),
        DoseInstance.deleteMany({}),
        Escalation.deleteMany({}),
        AuditLog.deleteMany({}),
      ]);
    }
    await disconnectDatabase();
    vi.resetModules();
  });

  it('rejects non-E.164 patient phone numbers and dispatches mocked Sarvam outbound call storing attempt_id', async () => {
    const invalidPhone = await request(app)
      .post('/api/family-members')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        fullName: 'Padma Reddy',
        phoneNumber: '9876500010',
        preferredLanguage: 'te',
        timezone: 'Asia/Kolkata',
        relationship: 'Mother',
        emergencyContact: {
          name: 'Vikram Reddy',
          phoneNumber: '+919876500011',
          relationship: 'Son',
        },
      });
    expect(invalidPhone.status).toBe(422);

    const memberRes = await request(app)
      .post('/api/family-members')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        fullName: 'Padma Reddy',
        phoneNumber: '+919876500010',
        preferredLanguage: 'te',
        timezone: 'Asia/Kolkata',
        relationship: 'Mother',
        emergencyContact: {
          name: 'Vikram Reddy',
          phoneNumber: '+919876500011',
          relationship: 'Son',
        },
        recordingConsentStatus: 'GRANTED',
        voiceCallingConsentStatus: 'GRANTED',
      });
    expect(memberRes.status).toBe(201);
    memberId = memberRes.body.data.id;

    const medRes = await request(app)
      .post('/api/medicines')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        familyMemberId: memberId,
        name: 'Telmisartan',
        dosage: '40mg',
        prescribedInstructions: 'Take morning & night after food',
        foodInstruction: 'AFTER_FOOD',
        associatedMeal: 'BREAKFAST',
        startDate: new Date().toISOString(),
        frequency: 'TWICE_DAILY',
        scheduledTimes: [
          {
            slotLabel: 'After Breakfast',
            timeOfDay: '08:30',
            associatedMeal: 'BREAKFAST',
            foodInstruction: 'AFTER_FOOD',
            mealReminderOffsetMinutes: -15,
            medicineReminderOffsetMinutes: 0,
            confirmationOffsetMinutes: 20,
          },
          {
            slotLabel: 'After Dinner',
            timeOfDay: '20:30',
            associatedMeal: 'DINNER',
            foodInstruction: 'AFTER_FOOD',
            mealReminderOffsetMinutes: -15,
            medicineReminderOffsetMinutes: 0,
            confirmationOffsetMinutes: 20,
          },
        ],
      });
    expect(medRes.status).toBe(201);
    medicineId = medRes.body.data.id;

    const doses = await DoseInstance.find({ medicineId }).sort({ scheduledAt: 1 }).lean();
    expect(doses.length).toBeGreaterThanOrEqual(2);
    doseIds = doses.map((d) => String(d._id));

    // Create a scheduled call job outside quiet hours (simulate midday UTC dispatch by overriding callingPreferences or type CALLBACK)
    const job = await CallSchedule.create({
      familyId: doses[0].familyId,
      familyMemberId: memberId,
      medicineId,
      doseInstanceId: doseIds[0],
      callType: 'CALLBACK',
      scheduledFor: new Date(),
      status: 'QUEUED',
      jobKey: `test-sarvam-dispatch-${Date.now()}`,
      attemptNumber: 1,
      maxAttempts: 3,
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        attempt_id: 'sarvam_attempt_live_001',
        status: 'QUEUED',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await executeScheduledCallJob(String(job._id));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [endpointUrl, reqInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(endpointUrl).toBe(
      'https://apps.sarvam.ai/api/outbounds/v1/orgs/019f94e8-30dd-71f1-8cc7-d6398bf00fb1/workspaces/019f94e8-30e1-79b6-9357-17bcb1f1e5bf/outbounds'
    );
    expect((reqInit.headers as Record<string, string>)['X-API-Key']).toBe(TEST_API_KEY);

    const reqPayload = JSON.parse(String(reqInit.body));
    expect(reqPayload.app_config.app_id).toBe('Conversatio-a7e64173-3c11');
    expect(reqPayload.app_config.app_version).toBe(1);
    expect(reqPayload.app_config.connection_config).toEqual({
      connection_id: '50141c04-3e-a97582cf-bbd0',
      agent_phone_number: '+917965860596',
    });
    expect(reqPayload.user_config.user_phone_number).toBe('+919876500010');
    expect(reqPayload.webhook_config.url).toBe(
      `https://carevoice-test.example/api/voice-agent/webhook/sarvam/${TEST_WEBHOOK_TOKEN}`
    );
    expect(reqPayload.webhook_config.metadata).toMatchObject({
      patient_id: memberId,
      dose_id: doseIds[0],
    });

    const storedLog = await CallLog.findOne({ attemptId: 'sarvam_attempt_live_001' }).lean();
    expect(storedLog).toBeTruthy();
    expect(storedLog?.providerCallId).toBe('sarvam_attempt_live_001');
    expect(String(storedLog?.familyMemberId)).toBe(memberId);
    expect(String(storedLog?.doseInstanceId)).toBe(doseIds[0]);
  });

  it('enforces high-entropy route token authentication & metadata correlation, handles connected safely & is idempotent', async () => {
    const callLog = await CallLog.findOne({ attemptId: 'sarvam_attempt_live_001' }).lean();
    expect(callLog).toBeTruthy();

    // 1. Unauthenticated / invalid route token rejected
    const noAuth = await request(app)
      .post('/api/voice-agent/webhook/sarvam')
      .send({ attempt_id: 'sarvam_attempt_live_001', status: 'connected' });
    expect(noAuth.status).toBe(401);

    const wrongToken = await request(app)
      .post('/api/voice-agent/webhook/sarvam/invalid_wrong_token_000000000000')
      .send({ attempt_id: 'sarvam_attempt_live_001', status: 'connected' });
    expect(wrongToken.status).toBe(401);

    // 2. Metadata patient_id mismatch rejected
    const mismatchRes = await request(app)
      .post(`/api/voice-agent/webhook/sarvam/${TEST_WEBHOOK_TOKEN}`)
      .send({
        attempt_id: 'sarvam_attempt_live_001',
        status: 'connected',
        webhook_config: {
          metadata: {
            patient_id: '000000000000000000000001',
            dose_id: doseIds[0],
          },
        },
      });
    expect(mismatchRes.status).toBe(403);

    // 3. Connected webhook with meal_finished=true ONLY (no medicine_taken) -> NEVER marks taken
    const connectedMealOnlyPayload = {
      attempt_id: 'sarvam_attempt_live_001',
      status: 'connected',
      interaction_id: '20261112/int_meal_only_1',
      duration: 28,
      channel_info: { telephony_provider: 'sarvam_sip' },
      final_agent_variables: {
        meal_finished: true,
      },
      webhook_config: {
        url: `https://carevoice-test.example/api/voice-agent/webhook/sarvam/${TEST_WEBHOOK_TOKEN}`,
        metadata: {
          patient_id: memberId,
          dose_id: doseIds[0],
          call_log_id: String(callLog?._id),
        },
      },
      interaction_transcript: [
        { role: 'agent', en_text: 'Have you eaten breakfast?', indic_text: 'మీరు టిఫిన్ తిన్నారా?' },
        { role: 'user', en_text: 'Yes, I just ate.', indic_text: 'అవును, ఇప్పుడే తిన్నాను.' },
      ],
    };

    const res1 = await request(app)
      .post(`/api/voice-agent/webhook/sarvam/${TEST_WEBHOOK_TOKEN}`)
      .send(connectedMealOnlyPayload);
    expect(res1.status).toBe(200);
    expect(res1.body.idempotent).toBe(false);
    expect(res1.body.correlated).toMatchObject({
      attemptId: 'sarvam_attempt_live_001',
      patientId: memberId,
      doseId: doseIds[0],
    });

    const updatedDose1 = await DoseInstance.findById(doseIds[0]).lean();
    expect(updatedDose1?.mealStatus).toBe('FINISHED');
    expect(updatedDose1?.status).toBe('UNCONFIRMED'); // Strictly NEVER auto-marked TAKEN!

    const conv = await Conversation.findOne({ callLogId: callLog?._id }).lean();
    expect(conv?.interactionId).toBe('20261112/int_meal_only_1');
    expect(conv?.finalAgentVariables).toEqual({ meal_finished: true });
    expect(conv?.turns.length).toBe(2);
    expect(conv?.turns[0].text).toBe('మీరు టిఫిన్ తిన్నారా?');
    expect(conv?.turns[0].translatedText).toBe('Have you eaten breakfast?');

    // 4. Duplicate webhook replay is idempotent and does not write duplicate AuditLogs
    const auditBefore = await AuditLog.countDocuments({
      resourceId: String(callLog?._id),
      action: 'SARVAM_WEBHOOK_PROCESSED',
    });
    const resReplay = await request(app)
      .post(`/api/voice-agent/webhook/sarvam/${TEST_WEBHOOK_TOKEN}`)
      .send(connectedMealOnlyPayload);
    expect(resReplay.status).toBe(200);
    expect(resReplay.body.idempotent).toBe(true);
    const auditAfter = await AuditLog.countDocuments({
      resourceId: String(callLog?._id),
      action: 'SARVAM_WEBHOOK_PROCESSED',
    });
    expect(auditAfter).toBe(auditBefore);

    // 5. Connected webhook with explicit medicine_taken=true confirms dose intake
    const followUpLog = await CallLog.create({
      familyId: callLog?.familyId,
      familyMemberId: memberId,
      medicineId,
      doseInstanceId: doseIds[0],
      provider: 'sarvam',
      attemptId: 'sarvam_attempt_live_002',
      providerCallId: 'sarvam_attempt_live_002',
      mode: 'live',
      callType: 'CONFIRMATION_CALL',
      phoneNumber: '+919876500010',
      language: 'te',
      scheduledAt: new Date(),
      outcome: 'NO_ANSWER',
      recordingStatus: 'UNAVAILABLE',
    });

    const takenRes = await request(app)
      .post(`/api/voice-agent/webhook/sarvam/${TEST_WEBHOOK_TOKEN}`)
      .send({
        attempt_id: 'sarvam_attempt_live_002',
        status: 'connected',
        interaction_id: '20261112/int_taken_2',
        duration: 35,
        final_agent_variables: {
          meal_finished: true,
          medicine_taken: true,
        },
        webhook_config: {
          metadata: {
            patient_id: memberId,
            dose_id: doseIds[0],
            call_log_id: String(followUpLog._id),
          },
        },
        interaction_transcript: [
          { role: 'agent', en_text: 'Did you take Telmisartan?' },
          { role: 'user', en_text: 'Yes, I took it just now.' },
        ],
      });
    expect(takenRes.status).toBe(200);
    const doseAfterTaken = await DoseInstance.findById(doseIds[0]).lean();
    expect(doseAfterTaken?.status).toBe('PATIENT_REPORTED_TAKEN');
  });

  it('handles no_answer, busy, and failed webhooks while keeping dose UNCONFIRMED and escalating repeated misses', async () => {
    const sampleDose = await DoseInstance.findById(doseIds[1]).lean();
    expect(sampleDose).toBeTruthy();

    const makeLiveCallLog = async (attemptId: string) =>
      CallLog.create({
        familyId: sampleDose?.familyId,
        familyMemberId: memberId,
        medicineId,
        doseInstanceId: doseIds[1],
        provider: 'sarvam',
        attemptId,
        providerCallId: attemptId,
        mode: 'live',
        callType: 'MEDICINE_REMINDER',
        phoneNumber: '+919876500010',
        language: 'te',
        scheduledAt: new Date(),
        outcome: 'NO_ANSWER',
        recordingStatus: 'UNAVAILABLE',
      });

    await makeLiveCallLog('attempt_na_1');
    await makeLiveCallLog('attempt_busy_2');
    await makeLiveCallLog('attempt_failed_3');

    const naRes = await request(app)
      .post(`/api/voice-agent/webhook/sarvam/${TEST_WEBHOOK_TOKEN}`)
      .send({
        attempt_id: 'attempt_na_1',
        status: 'no_answer',
        duration: null,
        interaction_id: null,
        final_agent_variables: null,
        webhook_config: { metadata: { patient_id: memberId, dose_id: doseIds[1] } },
      });
    expect(naRes.status).toBe(200);
    expect(naRes.body.data.callLog.outcome).toBe('NO_ANSWER');
    expect(naRes.body.data.callLog.sarvamStatus).toBe('no_answer');

    const busyRes = await request(app)
      .post(`/api/voice-agent/webhook/sarvam/${TEST_WEBHOOK_TOKEN}`)
      .send({
        attempt_id: 'attempt_busy_2',
        status: 'busy',
        duration: null,
        interaction_id: null,
        final_agent_variables: null,
        webhook_config: { metadata: { patient_id: memberId, dose_id: doseIds[1] } },
      });
    expect(busyRes.status).toBe(200);
    expect(busyRes.body.data.callLog.outcome).toBe('BUSY');
    expect(busyRes.body.data.callLog.sarvamStatus).toBe('busy');

    const failRes = await request(app)
      .post(`/api/voice-agent/webhook/sarvam/${TEST_WEBHOOK_TOKEN}`)
      .send({
        attempt_id: 'attempt_failed_3',
        status: 'failed',
        duration: null,
        failure_reason: 'SIP carrier 480 Temporarily Unavailable',
        final_agent_variables: null,
        webhook_config: { metadata: { patient_id: memberId, dose_id: doseIds[1] } },
      });
    expect(failRes.status).toBe(200);
    expect(failRes.body.data.callLog.outcome).toBe('FAILED');
    expect(failRes.body.data.callLog.sarvamStatus).toBe('failed');
    expect(failRes.body.data.callLog.failureReason).toBe('SIP carrier 480 Temporarily Unavailable');

    const doseAfterMisses = await DoseInstance.findById(doseIds[1]).lean();
    expect(doseAfterMisses?.status).not.toBe('PATIENT_REPORTED_TAKEN');
    expect(['UNCONFIRMED', 'ESCALATED']).toContain(doseAfterMisses?.status);

    const escalations = await Escalation.find({
      doseInstanceId: doseIds[1],
      reason: 'REPEATED_NO_ANSWER',
    }).lean();
    expect(escalations.length).toBeGreaterThanOrEqual(1);
  });

  it('serves /api/health and /api/healthz readiness probes and schedules real callback jobs on webhook delay request', async () => {
    const [healthRes, healthzRes] = await Promise.all([
      request(app).get('/api/health'),
      request(app).get('/api/healthz'),
    ]);
    expect(healthRes.status).toBe(200);
    expect(healthRes.body.data.database.connected).toBe(true);
    expect(healthzRes.status).toBe(200);
    expect(healthzRes.body.success).toBe(true);
    expect(healthzRes.body.database.connected).toBe(true);

    const sampleDose = await DoseInstance.findById(doseIds[1]).lean();
    await CallLog.create({
      familyId: sampleDose?.familyId,
      familyMemberId: memberId,
      medicineId,
      doseInstanceId: doseIds[1],
      provider: 'sarvam',
      attemptId: 'attempt_cb_req_4',
      providerCallId: 'attempt_cb_req_4',
      mode: 'live',
      callType: 'MEDICINE_REMINDER',
      phoneNumber: '+919876500010',
      language: 'te',
      scheduledAt: new Date(),
      outcome: 'NO_ANSWER',
      recordingStatus: 'UNAVAILABLE',
    });

    const cbWebhook = await request(app)
      .post(`/api/voice-agent/webhook/sarvam/${TEST_WEBHOOK_TOKEN}`)
      .send({
        attempt_id: 'attempt_cb_req_4',
        status: 'connected',
        interaction_id: '20261112/int_cb_4',
        duration: 19,
        final_agent_variables: {
          meal_finished: false,
          callback_requested: true,
          callback_delay_minutes: 12,
        },
        webhook_config: { metadata: { patient_id: memberId, dose_id: doseIds[1] } },
      });
    expect(cbWebhook.status).toBe(200);
    expect(cbWebhook.body.data.callLog.outcome).toBe('CALLBACK_REQUESTED');

    const doseAfterCb = await DoseInstance.findById(doseIds[1]).lean();
    expect(doseAfterCb?.status).toBe('CALLBACK_REQUESTED');
    expect(doseAfterCb?.mealStatus).toBe('NOT_FINISHED');

    const queuedCbJob = await CallSchedule.findOne({
      doseInstanceId: doseIds[1],
      callType: 'CALLBACK',
      status: 'QUEUED',
    }).lean();
    expect(queuedCbJob).toBeTruthy();
  });
});
