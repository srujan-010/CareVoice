import { Router } from 'express';
import { z } from 'zod';
import * as authController from '../controllers/auth.controller';
import { USER_ROLES } from '../constants/statuses';
import { authenticate, authorizeRoles } from '../middleware/auth.middleware';
import { authRateLimiter } from '../middleware/rateLimit.middleware';
import { validateBody } from '../middleware/validate.middleware';

const router = Router();

const registerSchema = z.object({
  familyName: z.string().min(2).max(120),
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  phone: z.string().optional(),
  timezone: z.string().default('Asia/Kolkata'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const caregiverSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  role: z.enum(USER_ROLES).default('CAREGIVER'),
  phone: z.string().optional(),
});

const updateFamilySchema = z.object({
  name: z.string().min(2).max(120).optional(),
  primaryContactPhone: z.string().optional(),
  timezone: z.string().optional(),
  settings: z
    .object({
      autoEscalationMinutes: z.number().int().min(5).max(180).optional(),
      maxCallbackRetries: z.number().int().min(1).max(5).optional(),
    })
    .optional(),
});

router.post('/register', authRateLimiter, validateBody(registerSchema), authController.register);
router.post('/login', authRateLimiter, validateBody(loginSchema), authController.login);
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.me);
router.get('/caregivers', authenticate, authController.listCaregivers);
router.post(
  '/caregivers',
  authenticate,
  authorizeRoles('ADMIN'),
  validateBody(caregiverSchema),
  authController.addCaregiver
);
router.patch(
  '/family',
  authenticate,
  authorizeRoles('ADMIN'),
  validateBody(updateFamilySchema),
  authController.updateFamilySettings
);

export default router;

