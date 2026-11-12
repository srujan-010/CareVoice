import { Router } from 'express';
import { getDatabaseHealth } from '../config/database';
import { getSarvamWebhookReadiness, isTelephonyReady } from '../config/env';
import { SUPPORTED_LANGUAGES } from '../constants/languages';
import { getQueueStatus } from '../queues/queueManager';
import authRoutes from './auth.routes';
import callRoutes from './call.routes';
import callbackRoutes from './callback.routes';
import dashboardRoutes from './dashboard.routes';
import escalationRoutes from './escalation.routes';
import familyMemberRoutes from './familyMember.routes';
import medicineRoutes from './medicine.routes';
import notificationRoutes from './notification.routes';
import reportRoutes from './report.routes';
import scheduleRoutes from './schedule.routes';
import voiceAgentRoutes from './voiceAgent.routes';

const router = Router();

router.get('/health', (_req, res) => {
  const db = getDatabaseHealth();
  const telephony = isTelephonyReady();
  const webhook = getSarvamWebhookReadiness();
  const queue = getQueueStatus();
  const info = {
    service: 'CareVoice Backend API',
    timestamp: new Date().toISOString(),
    database: db,
    queue,
    telephony: {
      mode: telephony.mode,
      ready: telephony.ready,
      missingFields: telephony.missingFields,
      webhookReady: webhook.ready,
      missingWebhookFields: webhook.missingFields,
    },
  };
  res.json({
    success: true,
    data: info,
    ...info,
  });
});

router.get('/healthz', (_req, res) => {
  const db = getDatabaseHealth();
  const telephony = isTelephonyReady();
  const webhook = getSarvamWebhookReadiness();
  const queue = getQueueStatus();
  const statusCode = db.connected ? 200 : 503;

  res.status(statusCode).json({
    success: db.connected,
    service: 'CareVoice Backend API',
    timestamp: new Date().toISOString(),
    database: db,
    queue,
    telephony: {
      mode: telephony.mode,
      ready: telephony.ready,
      webhookReady: webhook.ready,
    },
  });
});

router.get('/languages', (_req, res) => {
  res.json({
    success: true,
    data: SUPPORTED_LANGUAGES,
  });
});

router.use('/auth', authRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/family-members', familyMemberRoutes);
router.use('/medicines', medicineRoutes);
router.use('/schedules', scheduleRoutes);
router.use('/calls', callRoutes);
router.use('/callbacks', callbackRoutes);
router.use('/escalations', escalationRoutes);
router.use('/notifications', notificationRoutes);
router.use('/reports', reportRoutes);
router.use('/voice-agent', voiceAgentRoutes);

export default router;
