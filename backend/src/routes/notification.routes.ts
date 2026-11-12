import { Router } from 'express';
import * as notificationController from '../controllers/notification.controller';
import { authenticate, authorizeRoles } from '../middleware/auth.middleware';

const router = Router();
router.use(authenticate);

router.get('/', notificationController.listNotifications);
router.patch(
  '/:id/read',
  authorizeRoles('ADMIN', 'CAREGIVER'),
  notificationController.markRead
);
router.post(
  '/read-all',
  authorizeRoles('ADMIN', 'CAREGIVER'),
  notificationController.markAllRead
);

export default router;

