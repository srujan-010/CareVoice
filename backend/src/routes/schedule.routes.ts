import { Router } from 'express';
import { z } from 'zod';
import { DOSE_STATUSES, MEAL_STATUSES } from '../constants/statuses';
import * as scheduleController from '../controllers/schedule.controller';
import { authenticate, authorizeRoles } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate.middleware';

const router = Router();
router.use(authenticate);

const generateSchema = z.object({
  horizonDays: z.number().int().min(0).max(7).optional(),
});

const updateDoseSchema = z.object({
  status: z.enum(DOSE_STATUSES).optional(),
  mealStatus: z.enum(MEAL_STATUSES).optional(),
  notes: z.string().max(500).optional(),
});

router.get('/doses', scheduleController.listDoses);
router.post(
  '/generate',
  authorizeRoles('ADMIN', 'CAREGIVER'),
  validateBody(generateSchema),
  scheduleController.generateDoses
);
router.patch(
  '/doses/:id',
  authorizeRoles('ADMIN', 'CAREGIVER'),
  validateBody(updateDoseSchema),
  scheduleController.updateDose
);

export default router;

