import { Router } from 'express';
import { z } from 'zod';
import { CALL_TYPES } from '../constants/statuses';
import * as voiceCallController from '../controllers/voiceCall.controller';
import { authenticate, authorizeRoles } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate.middleware';

const router = Router();
router.use(authenticate);

const realTestCallSchema = z.object({
  familyMemberId: z.string().min(1, 'familyMemberId is required'),
  doseInstanceId: z.string().min(1, 'doseInstanceId is required'),
  callType: z.enum(CALL_TYPES).default('MEDICINE_REMINDER'),
  purpose: z.string().trim().min(3).max(200).optional(),
  confirmedByAdmin: z.literal(true, {
    errorMap: () => ({
      message: 'Explicit Admin confirmation (confirmedByAdmin: true) is required to place a real call',
    }),
  }),
  overrideQuietHours: z.boolean().optional(),
});

const cancelCallSchema = z.object({
  reason: z.string().trim().min(3).max(300).optional(),
});

router.get('/preflight', voiceCallController.getPreflight);

router.post(
  '/real-test',
  authorizeRoles('ADMIN'),
  validateBody(realTestCallSchema),
  voiceCallController.triggerRealTestCall
);

router.post(
  '/:id/cancel',
  authorizeRoles('ADMIN'),
  validateBody(cancelCallSchema),
  voiceCallController.cancelActiveCall
);

router.get('/:id/status', voiceCallController.getCallStatus);

export default router;
