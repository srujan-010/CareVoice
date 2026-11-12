import { Router } from 'express';
import { z } from 'zod';
import {
  CALL_OUTCOMES,
  ESCALATION_REASONS,
  ESCALATION_SEVERITIES,
  MEDICINE_CONFIRMATION_VALUES,
} from '../constants/statuses';
import * as voiceAgentController from '../controllers/voiceAgent.controller';
import * as voiceWebhookController from '../controllers/voiceWebhook.controller';
import { voiceWebhookRateLimiter } from '../middleware/rateLimit.middleware';
import { validateBody } from '../middleware/validate.middleware';
import {
  authenticateVoiceAgent,
  verifySarvamWebhookAuth,
} from '../middleware/webhookAuth.middleware';

const router = Router();

const SARVAM_WEBHOOK_ACCEPTED_STATUSES = [
  'queued',
  'initiating',
  'initiated',
  'dialing',
  'ringing',
  'ring',
  'answered',
  'in_progress',
  'ongoing',
  'connected',
  'completed',
  'succeeded',
  'no_answer',
  'no-answer',
  'unanswered',
  'busy',
  'failed',
  'error',
  'rejected',
  'declined',
  'not_connected',
  'not-connected',
  'unreachable',
  'cancelled',
  'canceled',
] as const;

const normalizedSarvamStatusSchema = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .refine(
    (v): v is (typeof SARVAM_WEBHOOK_ACCEPTED_STATUSES)[number] =>
      (SARVAM_WEBHOOK_ACCEPTED_STATUSES as readonly string[]).includes(v),
    { message: 'Unsupported Sarvam webhook status value' }
  );

const sarvamWebhookSchema = z
  .object({
    attempt_id: z.string().min(1),
    status: normalizedSarvamStatusSchema.optional(),
    connectivity_status: normalizedSarvamStatusSchema.optional(),
    event_type: z.string().nullable().optional(),
    event_id: z.string().nullable().optional(),
    started_at: z.string().nullable().optional(),
    answered_at: z.string().nullable().optional(),
    ended_at: z.string().nullable().optional(),
    ended_by: z.string().nullable().optional(),
    recording_url: z.string().url().nullable().optional(),
    channel_info: z.record(z.unknown()).nullable().optional(),
    duration: z.number().min(0).nullable().optional(),
    interaction_id: z.string().nullable().optional(),
    failure_reason: z.string().nullable().optional(),
    language_name: z.string().nullable().optional(),
    final_agent_variables: z.record(z.unknown()).nullable().optional(),
    webhook_config: z
      .object({
        url: z.string().optional(),
        metadata: z.record(z.unknown()).nullable().optional(),
      })
      .nullable()
      .optional(),
    interaction_transcript: z.array(z.record(z.unknown())).nullable().optional(),
  })
  .passthrough()
  .refine((data) => Boolean(data.status || data.connectivity_status), {
    message: 'Sarvam webhook payload must include status or connectivity_status',
  });

const doseScheduleContextSchema = z.object({
  familyMemberId: z.string().min(1),
  doseInstanceId: z.string().min(1),
  callLogId: z.string().optional(),
  callScheduleId: z.string().optional(),
});

const requestCallbackSchema = z.object({
  familyMemberId: z.string().min(1),
  doseInstanceId: z.string().min(1),
  sourceCallLogId: z.string().optional(),
  delayMinutes: z.number().int().min(1).max(120),
  reason: z.string().min(2).max(300),
  patientConfirmed: z.boolean().optional(),
});

const callEventSchema = z.object({
  callLogId: z.string().min(1),
  outcome: z.enum(CALL_OUTCOMES),
  durationSeconds: z.number().int().min(0).optional(),
  mealConfirmed: z.boolean().nullable().optional(),
  medicineConfirmed: z.enum(MEDICINE_CONFIRMATION_VALUES).optional(),
  feelingUnwell: z.boolean().optional(),
  requestedHelp: z.boolean().optional(),
  turns: z
    .array(
      z.object({
        speaker: z.enum(['AI', 'PATIENT']),
        text: z.string().min(1),
        translatedText: z.string().optional(),
        intent: z.string().optional(),
      })
    )
    .optional(),
  aiSummary: z.string().max(1500).optional(),
});

const escalationSchema = z.object({
  familyMemberId: z.string().min(1),
  doseInstanceId: z.string().optional(),
  callLogId: z.string().optional(),
  reason: z.enum(ESCALATION_REASONS),
  severity: z.enum(ESCALATION_SEVERITIES).optional(),
  description: z.string().min(3).max(1000),
});

router.get('/status', authenticateVoiceAgent, voiceAgentController.getStatus);

router.post(
  '/get-dose-schedule',
  voiceWebhookRateLimiter,
  authenticateVoiceAgent,
  validateBody(doseScheduleContextSchema),
  voiceAgentController.getDoseSchedule
);

router.post(
  '/request-callback',
  voiceWebhookRateLimiter,
  authenticateVoiceAgent,
  validateBody(requestCallbackSchema),
  voiceAgentController.requestCallback
);

router.post(
  '/call-events',
  voiceWebhookRateLimiter,
  authenticateVoiceAgent,
  validateBody(callEventSchema),
  voiceAgentController.postCallEvents
);

router.post(
  '/escalations',
  voiceWebhookRateLimiter,
  authenticateVoiceAgent,
  validateBody(escalationSchema),
  voiceAgentController.createEscalation
);

// Authenticated Sarvam Instant Outbound Webhook Endpoints
// Prefer high-entropy route token: /api/voice-agent/webhook/sarvam/:webhookToken
router.post(
  '/webhook/sarvam/:webhookToken',
  voiceWebhookRateLimiter,
  verifySarvamWebhookAuth,
  validateBody(sarvamWebhookSchema),
  voiceWebhookController.handleSarvamWebhook
);

router.post(
  '/webhook/sarvam',
  voiceWebhookRateLimiter,
  verifySarvamWebhookAuth,
  validateBody(sarvamWebhookSchema),
  voiceWebhookController.handleSarvamWebhook
);

export default router;

