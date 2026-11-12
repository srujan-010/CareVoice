import { Router } from 'express';
import { z } from 'zod';
import { CALL_TYPES } from '../constants/statuses';
import * as callController from '../controllers/call.controller';
import { authenticate, authorizeRoles } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate.middleware';

const router = Router();
router.use(authenticate);

const simulateSchema = z.object({
  doseInstanceId: z.string().min(1),
  callType: z.enum(CALL_TYPES).optional(),
  scenario: z.enum([
    'TAKEN',
    'NOT_TAKEN',
    'MEAL_DELAY_CALLBACK',
    'MEAL_ONLY_UNCONFIRMED',
    'NO_ANSWER',
    'BUSY',
    'REJECTED',
    'FEELING_UNWELL',
  ]),
  delayMinutes: z.number().int().min(1).max(90).optional(),
});

router.get('/', callController.listCalls);
router.post(
  '/simulate',
  authorizeRoles('ADMIN', 'CAREGIVER'),
  validateBody(simulateSchema),
  callController.simulateCall
);
router.get('/:id', callController.getCallDetail);
router.get('/:id/recording', callController.streamRecording);

export default router;

