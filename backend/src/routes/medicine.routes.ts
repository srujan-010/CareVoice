import { Router } from 'express';
import { z } from 'zod';
import {
  ASSOCIATED_MEALS,
  FOOD_INSTRUCTIONS,
  MEDICINE_FREQUENCIES,
} from '../constants/statuses';
import * as medicineController from '../controllers/medicine.controller';
import { authenticate, authorizeRoles } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate.middleware';

const router = Router();
router.use(authenticate);

const slotSchema = z.object({
  slotLabel: z.string().min(1).max(80),
  timeOfDay: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:mm format'),
  associatedMeal: z.enum(ASSOCIATED_MEALS),
  customMealName: z.string().max(60).optional(),
  foodInstruction: z.enum(FOOD_INSTRUCTIONS),
  customFoodInstruction: z.string().max(200).optional(),
  mealReminderOffsetMinutes: z.number().int().min(-120).max(60).nullable(),
  medicineReminderOffsetMinutes: z.number().int().min(-60).max(60).default(0),
  confirmationOffsetMinutes: z.number().int().min(5).max(180).nullable(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  intervalDays: z.number().int().min(1).max(30).optional(),
});

const createMedicineSchema = z.object({
  familyMemberId: z.string().min(1),
  name: z.string().min(1).max(150),
  dosage: z.string().min(1).max(80),
  prescribedInstructions: z.string().min(1).max(500),
  foodInstruction: z.enum(FOOD_INSTRUCTIONS),
  customFoodInstruction: z.string().max(250).optional(),
  associatedMeal: z.enum(ASSOCIATED_MEALS),
  customMealName: z.string().max(60).optional(),
  startDate: z.string().min(1),
  endDate: z.string().optional(),
  frequency: z.enum(MEDICINE_FREQUENCIES),
  scheduledTimes: z.array(slotSchema).min(1),
  prescribingDoctor: z.string().max(120).optional(),
  notes: z.string().max(1000).optional(),
  isActive: z.boolean().optional(),
});

const updateMedicineSchema = createMedicineSchema
  .extend({
    endDate: z.string().nullable().optional(),
  })
  .partial();

router.get('/', medicineController.listMedicines);
router.get('/:id', medicineController.getMedicine);
router.post(
  '/',
  authorizeRoles('ADMIN', 'CAREGIVER'),
  validateBody(createMedicineSchema),
  medicineController.createMedicine
);
router.patch(
  '/:id',
  authorizeRoles('ADMIN', 'CAREGIVER'),
  validateBody(updateMedicineSchema),
  medicineController.updateMedicine
);
router.delete('/:id', authorizeRoles('ADMIN'), medicineController.deleteMedicine);

export default router;

