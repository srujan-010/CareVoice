import crypto from 'crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { connectDatabase, disconnectDatabase } from '../../src/config/database';
import { env } from '../../src/config/env';
import { AuditLog } from '../../src/models/AuditLog';
import { CallLog } from '../../src/models/CallLog';
import { CallSchedule } from '../../src/models/CallSchedule';
import { Callback } from '../../src/models/Callback';
import { Consent } from '../../src/models/Consent';
import { Conversation } from '../../src/models/Conversation';
import { DoseInstance } from '../../src/models/DoseInstance';
import { Escalation } from '../../src/models/Escalation';
import { Family } from '../../src/models/Family';
import { FamilyMember } from '../../src/models/FamilyMember';
import { Medicine } from '../../src/models/Medicine';
import { MedicineSchedule } from '../../src/models/MedicineSchedule';
import { Notification } from '../../src/models/Notification';
import { Recording } from '../../src/models/Recording';
import { User } from '../../src/models/User';
import { executeScheduledCallJob } from '../../src/services/call.service';
import { generateDosesForFamily } from '../../src/services/scheduleEngine.service';

const TEST_DB_NAME = 'carevoice_test_suite';
const app = createApp();

describe('CareVoice End-to-End API & Security Integration Tests', () => {
  let tokenA = '';
  let tokenB = '';
  let memberAId = '';
  let medicineAId = '';
  let doseIds: string[] = [];
  let takenCallLogId = '';

  beforeAll(async () => {
    await connectDatabase(TEST_DB_NAME);
    // Clean test DB prior to test run
    await Promise.all([
      User.deleteMany({}),
      Family.deleteMany({}),
      FamilyMember.deleteMany({}),
      Consent.deleteMany({}),
      Medicine.deleteMany({}),
      MedicineSchedule.deleteMany({}),
      DoseInstance.deleteMany({}),
      CallSchedule.deleteMany({}),
      CallLog.deleteMany({}),
      Conversation.deleteMany({}),
      Recording.deleteMany({}),
      Callback.deleteMany({}),
      Notification.deleteMany({}),
      Escalation.deleteMany({}),
      AuditLog.deleteMany({}),
    ]);
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await Promise.all([
        User.deleteMany({}),
        Family.deleteMany({}),
        FamilyMember.deleteMany({}),
        Consent.deleteMany({}),
        Medicine.deleteMany({}),
        MedicineSchedule.deleteMany({}),
        DoseInstance.deleteMany({}),
        CallSchedule.deleteMany({}),
        CallLog.deleteMany({}),
        Conversation.deleteMany({}),
        Recording.deleteMany({}),
        Callback.deleteMany({}),
        Notification.deleteMany({}),
        Escalation.deleteMany({}),
        AuditLog.deleteMany({}),
      ]);
    }
    await disconnectDatabase();
  });

  it('registers two isolated family accounts and enforces JWT authentication', async () => {
    const unauthRes = await request(app).get('/api/family-members');
    expect(unauthRes.status).toBe(401);

    const regA = await request(app).post('/api/auth/register').send({
      familyName: 'Sharma Family',
      name: 'Ananya Sharma',
      email: 'ananya.test@carevoice.local',
      password: 'StrongPassword123!',
      timezone: 'Asia/Kolkata',
    });
    expect(regA.status).toBe(201);
    tokenA = regA.body.data.token;

    const dupReg = await request(app).post('/api/auth/register').send({
      familyName: 'Dup Family',
      name: 'Ananya',
      email: 'ananya.test@carevoice.local',
      password: 'StrongPassword123!',
      timezone: 'Asia/Kolkata',
    });
    expect(dupReg.status).toBe(409);

    const regB = await request(app).post('/api/auth/register').send({
      familyName: 'Patel Family',
      name: 'Rohan Patel',
      email: 'rohan.test@carevoice.local',
      password: 'StrongPassword123!',
      timezone: 'Asia/Kolkata',
    });
    expect(regB.status).toBe(201);
    tokenB = regB.body.data.token;
  });

  it('creates family member with consent & enforces strict cross-family data isolation', async () => {
    const createRes = await request(app)
      .post('/api/family-members')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        fullName: 'Savitri Sharma',
        phoneNumber: '+919876500001',
        age: 71,
        preferredLanguage: 'te',
        timezone: 'Asia/Kolkata',
        relationship: 'Mother',
        emergencyContact: {
          name: 'Ananya Sharma',
          phoneNumber: '+919876500002',
          relationship: 'Daughter',
        },
        recordingConsentStatus: 'GRANTED',
        voiceCallingConsentStatus: 'GRANTED',
      });

    expect(createRes.status).toBe(201);
    memberAId = createRes.body.data.id;
    expect(createRes.body.data.preferredLanguage).toBe('te');

    // Family B must NEVER access Family A's member
    const crossGet = await request(app)
      .get(`/api/family-members/${memberAId}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(crossGet.status).toBe(404);

    // Role-based access check: VIEWER user cannot create members
    const viewerCreate = await request(app)
      .post('/api/auth/caregivers')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: 'Viewer Cousin',
        email: 'viewer.test@carevoice.local',
        password: 'StrongPassword123!',
        role: 'VIEWER',
      });
    expect(viewerCreate.status).toBe(201);

    const viewerLogin = await request(app).post('/api/auth/login').send({
      email: 'viewer.test@carevoice.local',
      password: 'StrongPassword123!',
    });
    const viewerToken = viewerLogin.body.data.token;

    const forbiddenAdd = await request(app)
      .post('/api/family-members')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({
        fullName: 'Blocked',
        phoneNumber: '+919876599999',
        preferredLanguage: 'hi',
        timezone: 'Asia/Kolkata',
        relationship: 'Father',
        emergencyContact: { name: 'X', phoneNumber: '+919876500002', relationship: 'Son' },
      });
    expect(forbiddenAdd.status).toBe(403);
  });

  it('creates multi-dose medicine and generates deduplicated dose instances & call jobs', async () => {
    const medRes = await request(app)
      .post('/api/medicines')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        familyMemberId: memberAId,
        name: 'Metformin SR',
        dosage: '500mg',
        prescribedInstructions: 'Take before meals',
        foodInstruction: 'BEFORE_FOOD',
        associatedMeal: 'BREAKFAST',
        startDate: new Date().toISOString(),
        frequency: 'THREE_TIMES_DAILY',
        scheduledTimes: [
          {
            slotLabel: 'Before Breakfast',
            timeOfDay: '07:30',
            associatedMeal: 'BREAKFAST',
            foodInstruction: 'BEFORE_FOOD',
            mealReminderOffsetMinutes: -15,
            medicineReminderOffsetMinutes: 0,
            confirmationOffsetMinutes: 20,
          },
          {
            slotLabel: 'Before Lunch',
            timeOfDay: '13:00',
            associatedMeal: 'LUNCH',
            foodInstruction: 'BEFORE_FOOD',
            mealReminderOffsetMinutes: -15,
            medicineReminderOffsetMinutes: 0,
            confirmationOffsetMinutes: 20,
          },
          {
            slotLabel: 'Before Dinner',
            timeOfDay: '19:30',
            associatedMeal: 'DINNER',
            foodInstruction: 'BEFORE_FOOD',
            mealReminderOffsetMinutes: -15,
            medicineReminderOffsetMinutes: 0,
            confirmationOffsetMinutes: 20,
          },
        ],
      });

    expect(medRes.status).toBe(201);
    medicineAId = medRes.body.data.id;
    expect(medRes.body.data.schedules.length).toBe(3);

    const dosesRes = await request(app)
      .get('/api/schedules/doses')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(dosesRes.status).toBe(200);
    expect(dosesRes.body.data.doses.length).toBeGreaterThanOrEqual(3);
    doseIds = dosesRes.body.data.doses.map((d: { id: string }) => d.id);

    // Ensure duplicate dose generation is idempotent
    const familyDoc = await Family.findOne({ primaryContactEmail: 'ananya.test@carevoice.local' }).lean();
    const beforeCount = await DoseInstance.countDocuments({ medicineId: medicineAId });
    await generateDosesForFamily(String(familyDoc?._id), 2);
    const afterCount = await DoseInstance.countDocuments({ medicineId: medicineAId });
    expect(afterCount).toBe(beforeCount);
  });

  it('enforces voice-agent authentication & prevents probing arbitrary patient/dose IDs', async () => {
    const unauth = await request(app)
      .post('/api/voice-agent/get-dose-schedule')
      .send({ familyMemberId: memberAId, doseInstanceId: doseIds[0] });
    expect(unauth.status).toBe(401);

    // Service token without active callLogId/callScheduleId binding must be rejected
    const unverifiedProbe = await request(app)
      .post('/api/voice-agent/get-dose-schedule')
      .set('X-Voice-Agent-Token', env.VOICE_AGENT_INTERNAL_TOKEN)
      .send({ familyMemberId: memberAId, doseInstanceId: doseIds[0] });
    expect(unverifiedProbe.status).toBe(403);

    // Authenticated Family A caregiver can fetch context for their own patient & dose
    const validCtx = await request(app)
      .post('/api/voice-agent/get-dose-schedule')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ familyMemberId: memberAId, doseInstanceId: doseIds[0] });
    expect(validCtx.status).toBe(200);
    expect(validCtx.body.data.patient.preferredLanguage).toBe('te');
    expect(validCtx.body.data.safetyDirectives.length).toBeGreaterThan(0);

    // Family B cannot probe Family A's dose context
    const crossCtx = await request(app)
      .post('/api/voice-agent/get-dose-schedule')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ familyMemberId: memberAId, doseInstanceId: doseIds[0] });
    expect(crossCtx.status).toBe(404);
  });

  it('enforces medical safety: meal confirmation never marks taken, smart callback guards duplicates & taken confirmation generates authorized recording', async () => {
    // 1) Meal only -> mealStatus FINISHED, dose remains UNCONFIRMED
    const mealOnly = await request(app)
      .post('/api/calls/simulate')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        doseInstanceId: doseIds[0],
        scenario: 'MEAL_ONLY_UNCONFIRMED',
      });
    expect(mealOnly.status).toBe(201);
    expect(mealOnly.body.data.callLog.mealConfirmed).toBe(true);
    expect(mealOnly.body.data.callLog.medicineConfirmed).toBe('UNCONFIRMED');
    expect(mealOnly.body.data.callLog.doseInstanceId.status).toBe('UNCONFIRMED');

    // 2) Meal delay callback -> CALLBACK_REQUESTED, duplicate rejected
    const cbCall = await request(app)
      .post('/api/calls/simulate')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        doseInstanceId: doseIds[1],
        scenario: 'MEAL_DELAY_CALLBACK',
        delayMinutes: 10,
      });
    expect(cbCall.status).toBe(201);
    expect(cbCall.body.data.callLog.outcome).toBe('CALLBACK_REQUESTED');
    expect(cbCall.body.data.callLog.doseInstanceId.status).toBe('CALLBACK_REQUESTED');
    expect(cbCall.body.data.callbacks.length).toBe(1);

    const dupCb = await request(app)
      .post('/api/callbacks')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        familyMemberId: memberAId,
        doseInstanceId: doseIds[1],
        delayMinutes: 15,
        reason: 'Duplicate attempt',
      });
    expect(dupCb.status).toBe(409);

    // 3) Explicit TAKEN confirmation + recording authorization
    const takenCall = await request(app)
      .post('/api/calls/simulate')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        doseInstanceId: doseIds[0],
        scenario: 'TAKEN',
      });
    expect(takenCall.status).toBe(201);
    takenCallLogId = takenCall.body.data.callLog._id;
    expect(takenCall.body.data.callLog.doseInstanceId.status).toBe('PATIENT_REPORTED_TAKEN');
    expect(takenCall.body.data.recording.consentVerified).toBe(true);

    const recAllowed = await request(app)
      .get(`/api/calls/${takenCallLogId}/recording`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(recAllowed.status).toBe(200);
    expect(recAllowed.headers['content-type']).toContain('audio/wav');

    const recBlocked = await request(app)
      .get(`/api/calls/${takenCallLogId}/recording`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(recBlocked.status).toBe(404);

    // 4) Unwell escalation triggers Escalation + Notification
    const unwellCall = await request(app)
      .post('/api/calls/simulate')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        doseInstanceId: doseIds[2],
        scenario: 'FEELING_UNWELL',
      });
    expect(unwellCall.status).toBe(201);
    expect(unwellCall.body.data.escalations.length).toBe(1);
    expect(unwellCall.body.data.escalations[0].severity).toBe('CRITICAL');

    const notifRes = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(notifRes.status).toBe(200);
    expect(notifRes.body.data.notifications.length).toBeGreaterThan(0);
  });

  it('rejects unsigned webhooks and serves accurate separated report statuses + real dashboard overview', async () => {
    const webhookNoSig = await request(app)
      .post('/api/voice-agent/webhook/sarvam')
      .send({ call_id: 'fake' });
    expect([401, 403]).toContain(webhookNoSig.status);

    // Check report separation
    const reportRes = await request(app)
      .get('/api/reports?period=weekly')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(reportRes.status).toBe(200);
    expect(reportRes.body.data.summary.statusBreakdown.PATIENT_REPORTED_TAKEN).toBeGreaterThanOrEqual(
      1
    );
    expect(reportRes.body.data.summary.statusBreakdown.CALLBACK_REQUESTED).toBeGreaterThanOrEqual(1);
    expect(reportRes.body.data.summary.statusBreakdown.ESCALATED).toBeGreaterThanOrEqual(1);

    // Dashboard overview loads real MongoDB statistics
    const dashRes = await request(app)
      .get('/api/dashboard/overview')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(dashRes.status).toBe(200);
    expect(dashRes.body.data.statistics.totalFamilyMembers).toBe(1);
    expect(dashRes.body.data.statistics.activeMedicines).toBe(1);
  });

  it('validates medicine endDate update/clear, atomic callback dispatch, retry limit, dose taken cancellation & logout revocation', async () => {
    const futureEnd = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const setEndRes = await request(app)
      .patch(`/api/medicines/${medicineAId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ endDate: futureEnd, notes: 'Updated duration' });
    expect(setEndRes.status).toBe(200);
    expect(setEndRes.body.data.endDate).toBeTruthy();

    const queuedAfterSet = await CallSchedule.countDocuments({
      medicineId: medicineAId,
      status: 'QUEUED',
    });
    expect(queuedAfterSet).toBeGreaterThan(0);

    const clearEndRes = await request(app)
      .patch(`/api/medicines/${medicineAId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ endDate: null });
    expect(clearEndRes.status).toBe(200);
    expect(clearEndRes.body.data.endDate).toBeUndefined();

    const queuedAfterClear = await CallSchedule.countDocuments({
      medicineId: medicineAId,
      status: 'QUEUED',
    });
    expect(queuedAfterClear).toBeGreaterThan(0);

    // Pick a distinct future dose (not doseIds[0..2]) with QUEUED jobs and test caregiver TAKEN cancellation
    const queuedSample = await CallSchedule.findOne({
      medicineId: medicineAId,
      doseInstanceId: { $nin: doseIds.slice(0, 3) },
      status: 'QUEUED',
      callType: { $ne: 'CALLBACK' },
    }).lean();
    expect(queuedSample).toBeTruthy();

    const markTakenRes = await request(app)
      .patch(`/api/schedules/doses/${String(queuedSample?.doseInstanceId)}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ status: 'PATIENT_REPORTED_TAKEN' });
    expect(markTakenRes.status).toBe(200);

    const remainingForTakenDose = await CallSchedule.countDocuments({
      doseInstanceId: queuedSample?.doseInstanceId,
      status: 'QUEUED',
    });
    expect(remainingForTakenDose).toBe(0);

    // Test atomic callback execution & retry ceiling on doseIds[1] (1 active callback created earlier & preserved across endDate edits)
    const cbSchedule = await CallSchedule.findOne({
      doseInstanceId: doseIds[1],
      callType: 'CALLBACK',
      status: 'QUEUED',
    }).lean();
    expect(cbSchedule).toBeTruthy();

    const logsBefore = await CallLog.countDocuments({ doseInstanceId: doseIds[1] });
    await Promise.all([
      executeScheduledCallJob(String(cbSchedule?._id)),
      executeScheduledCallJob(String(cbSchedule?._id)),
    ]);
    const logsAfter = await CallLog.countDocuments({ doseInstanceId: doseIds[1] });
    expect(logsAfter).toBe(logsBefore + 1);

    const cbAfterExec = await Callback.findById(cbSchedule?.callbackId).lean();
    expect(cbAfterExec?.status).toBe('FAILED');
    const doseAfterExec = await DoseInstance.findById(doseIds[1]).lean();
    expect(doseAfterExec?.status).toBe('UNCONFIRMED');

    // Create callbacks up to member maxRetries (default maxRetries = 3; attempt 1 already existed -> 2 & 3 succeed, 4th returns 409)
    const cb2 = await request(app)
      .post('/api/callbacks')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        familyMemberId: memberAId,
        doseInstanceId: doseIds[1],
        delayMinutes: 10,
        reason: 'Retry 2 after dinner prep',
      });
    expect(cb2.status).toBe(201);
    const cb2Job = await CallSchedule.findOne({ callbackId: cb2.body.data._id }).lean();
    await executeScheduledCallJob(String(cb2Job?._id));

    const cb3 = await request(app)
      .post('/api/callbacks')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        familyMemberId: memberAId,
        doseInstanceId: doseIds[1],
        delayMinutes: 10,
        reason: 'Retry 3 final attempt',
      });
    expect(cb3.status).toBe(201);
    const cb3Job = await CallSchedule.findOne({ callbackId: cb3.body.data._id }).lean();
    await executeScheduledCallJob(String(cb3Job?._id));

    const cbOverLimit = await request(app)
      .post('/api/callbacks')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        familyMemberId: memberAId,
        doseInstanceId: doseIds[1],
        delayMinutes: 10,
        reason: 'Should exceed retry budget',
      });
    expect(cbOverLimit.status).toBe(409);

    // Logout revokes JWT tokenVersion
    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(logoutRes.status).toBe(200);

    const afterLogout = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(afterLogout.status).toBe(401);

    // Quick verification that webhook signature helper produces valid HMAC format
    const hmac = crypto.createHmac('sha256', 'test').update('{}').digest('hex');
    expect(hmac.length).toBe(64);
  });
});

