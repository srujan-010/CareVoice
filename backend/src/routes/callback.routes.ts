import { Router } from 'express';
import { z } from 'zod';
import * as callbackController from '../controllers/callback.controller';
import { authenticate, authorizeRoles } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate.middleware';

const router = Router();
router.use(authenticate);

const createCallbackSchema = z.object({
  familyMemberId: z.string().min(1),
  doseInstanceId: z.string().min(1),
  sourceCallLogId: z.string().optional(),
  delayMinutes: z.number().int().min(1).max(120),
  reason: z.string().min(2).max(300),
  patientConfirmed: z.boolean().optional(),
});

router.get('/', callbackController.listCallbacks);
router.post(
  '/',
  authorizeRoles('ADMIN', 'CAREGIVER'),
  validateBody(createCallbackSchema),
  callbackController.createCallback
);
router.post(
  '/:id/cancel',
  authorizeRoles('ADMIN', 'CAREGIVER'),
  callbackController.cancelCallback
);

export default router;

