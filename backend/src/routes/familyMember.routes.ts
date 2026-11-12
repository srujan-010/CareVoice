import { Router } from 'express';
import { z } from 'zod';
import { LANGUAGE_CODES } from '../constants/languages';
import { CONSENT_STATUSES, CONSENT_TYPES, normalizeConsentTypeInput } from '../constants/statuses';
import * as familyMemberController from '../controllers/familyMember.controller';
import { authenticate, authorizeRoles } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate.middleware';
import { isValidE164PhoneNumber } from '../utils/phone';

const router = Router();
router.use(authenticate);

const e164PhoneSchema = z
  .string()
  .min(8)
  .max(20)
  .refine(
    (val) => {
      const trimmed = val.trim();
      if (!trimmed.startsWith('+')) return false;
      const compact = `+${trimmed.slice(1).replace(/[\s()-]/g, '')}`;
      return isValidE164PhoneNumber(compact);
    },
    {
      message:
        "Phone number must be in E.164 format starting with '+' and country code (e.g., +919876543210)",
    }
  );

const emergencyContactSchema = z.object({
  name: z.string().min(2).max(120),
  phoneNumber: e164PhoneSchema,
  relationship: z.string().min(2).max(60),
});

const callingPreferencesSchema = z.object({
  quietHoursStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  quietHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  maxRetries: z.number().int().min(0).max(5).optional(),
  retryIntervalMinutes: z.number().int().min(5).max(60).optional(),
  allowMealReminders: z.boolean().optional(),
  allowMedicineReminders: z.boolean().optional(),
  allowConfirmationCalls: z.boolean().optional(),
  preferredVoiceGender: z.enum(['FEMALE', 'MALE', 'NEUTRAL']).optional(),
});

const createMemberSchema = z.object({
  fullName: z.string().min(2).max(120),
  phoneNumber: e164PhoneSchema,
  age: z.number().int().min(0).max(130).optional(),
  preferredLanguage: z.enum(LANGUAGE_CODES as [string, ...string[]]).default('en'),
  timezone: z.string().default('Asia/Kolkata'),
  relationship: z.string().min(2).max(60),
  emergencyContact: emergencyContactSchema,
  callingPreferences: callingPreferencesSchema.optional(),
  recordingConsentStatus: z.enum(CONSENT_STATUSES).optional(),
  transcriptConsentStatus: z.enum(CONSENT_STATUSES).optional(),
  voiceCallingConsentStatus: z.enum(CONSENT_STATUSES).optional(),
  isActive: z.boolean().optional(),
  notes: z.string().max(1000).optional(),
});

const updateMemberSchema = createMemberSchema.partial();

const consentSchema = z.object({
  consentType: z
    .string()
    .transform((val, ctx) => {
      const normalized = normalizeConsentTypeInput(val);
      if (!normalized || !CONSENT_TYPES.includes(normalized)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unsupported consentType. Accepted values: ${CONSENT_TYPES.join(', ')}`,
        });
        return z.NEVER;
      }
      return normalized;
    }),
  status: z.enum(CONSENT_STATUSES),
  method: z.enum(['DASHBOARD', 'VERBAL_CALL', 'WRITTEN']).optional(),
  consentVersion: z.string().max(32).optional(),
  notes: z.string().max(500).optional(),
});

const statusToggleSchema = z.object({
  isActive: z.boolean(),
});

router.get('/', familyMemberController.listMembers);
router.post(
  '/',
  authorizeRoles('ADMIN', 'CAREGIVER'),
  validateBody(createMemberSchema),
  familyMemberController.createMember
);
router.get('/:id', familyMemberController.getMember);
router.get('/:id/profile', familyMemberController.getMemberProfile);
router.patch(
  '/:id',
  authorizeRoles('ADMIN', 'CAREGIVER'),
  validateBody(updateMemberSchema),
  familyMemberController.updateMember
);
router.patch(
  '/:id/consent',
  authorizeRoles('ADMIN', 'CAREGIVER'),
  validateBody(consentSchema),
  familyMemberController.updateConsent
);
router.patch(
  '/:id/status',
  authorizeRoles('ADMIN', 'CAREGIVER'),
  validateBody(statusToggleSchema),
  familyMemberController.toggleMemberStatus
);
router.delete('/:id', authorizeRoles('ADMIN'), familyMemberController.deleteMember);

export default router;

