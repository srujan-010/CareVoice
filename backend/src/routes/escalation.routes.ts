import { Router } from 'express';
import { z } from 'zod';
import { ESCALATION_STATUSES } from '../constants/statuses';
import * as escalationController from '../controllers/escalation.controller';
import { authenticate, authorizeRoles } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate.middleware';

const router = Router();
router.use(authenticate);

const updateEscalationSchema = z.object({
  status: z.enum(ESCALATION_STATUSES),
  resolutionNotes: z.string().max(1000).optional(),
});

router.get('/', escalationController.listEscalations);
router.patch(
  '/:id',
  authorizeRoles('ADMIN', 'CAREGIVER'),
  validateBody(updateEscalationSchema),
  escalationController.updateEscalation
);

export default router;

