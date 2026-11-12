import { Router } from 'express';
import { z } from 'zod';
import { LANGUAGE_CODES, tryGetSupportedLanguage } from '../constants/languages';
import { CONSENT_STATUSES, CONSENT_TYPES, normalizeConsentTypeInput } from '../constants/statuses';
import * as familyMemberController from '../controllers/familyMember.controller';
import { authenticate, authorizeRoles } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate.middleware';
import { isValidE164PhoneNumber } from '../utils/phone';

const router = Router();
router.use(authenticate);

const E164_MESSAGE =
  "Phone number must be in E.164 format starting with '+' and country code (e.g., +919876543210)";

const e164PhoneSchema = z
  .string()
  .trim()
  .min(8, E164_MESSAGE)
  .max(32, E164_MESSAGE)
  .transform((val, ctx) => {
    if (!val.startsWith('+')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: E164_MESSAGE,
      });
      return z.NEVER;
    }
    const compact = `+${val.slice(1).replace(/[\s().-]/g, '')}`;
    if (!isValidE164PhoneNumber(compact)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: E164_MESSAGE,
      });
      return z.NEVER;
    }
    return compact;
  });

const preferredLanguageSchema = z
  .string()
  .trim()
  .transform((val, ctx) => {
    const matched = tryGetSupportedLanguage(val);
    if (matched) {
      return matched.code;
    }
    if (LANGUAGE_CODES.includes(val)) {
      return val;
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Unsupported preferredLanguage "${val}". Supported codes: ${LANGUAGE_CODES.join(', ')}`,
    });
    return z.NEVER;
  });

const emergencyContactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phoneNumber: e164PhoneSchema,
  relationship: z.string().trim().min(2).max(60),
});

const callingPreferencesSchema = z.object({
  quietHoursStart: z.string().trim().regex(/^\d{2}:\d{2}$/).optional(),
  quietHoursEnd: z.string().trim().regex(/^\d{2}:\d{2}$/).optional(),
  maxRetries: z.number().int().min(0).max(5).optional(),
  retryIntervalMinutes: z.number().int().min(5).max(60).optional(),
  allowMealReminders: z.boolean().optional(),
  allowMedicineReminders: z.boolean().optional(),
  allowConfirmationCalls: z.boolean().optional(),
  preferredVoiceGender: z.enum(['FEMALE', 'MALE', 'NEUTRAL']).optional(),
});

const createMemberSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phoneNumber: e164PhoneSchema,
  age: z.number().int().min(0).max(130).optional(),
  preferredLanguage: preferredLanguageSchema.default('en'),
  timezone: z.string().trim().min(1).default('Asia/Kolkata'),
  relationship: z.string().trim().min(2).max(60),
  emergencyContact: emergencyContactSchema,
  callingPreferences: callingPreferencesSchema.optional(),
  recordingConsentStatus: z.enum(CONSENT_STATUSES).optional(),
  transcriptConsentStatus: z.enum(CONSENT_STATUSES).optional(),
  voiceCallingConsentStatus: z.enum(CONSENT_STATUSES).optional(),
  isActive: z.boolean().optional(),
  notes: z.string().trim().max(1000).optional(),
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

