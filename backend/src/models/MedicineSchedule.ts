import mongoose, { Document, Schema, Types } from 'mongoose';
import {
  ASSOCIATED_MEALS,
  AssociatedMeal,
  FOOD_INSTRUCTIONS,
  FoodInstruction,
  MEDICINE_FREQUENCIES,
  MedicineFrequency,
} from '../constants/statuses';

export interface IMedicineSchedule extends Document {
  familyId: Types.ObjectId;
  familyMemberId: Types.ObjectId;
  medicineId: Types.ObjectId;
  slotIndex: number;
  slotLabel: string;
  timeOfDay: string;
  associatedMeal: AssociatedMeal;
  customMealName?: string;
  foodInstruction: FoodInstruction;
  customFoodInstruction?: string;
  frequency: MedicineFrequency;
  mealReminderOffsetMinutes: number | null;
  medicineReminderOffsetMinutes: number;
  confirmationOffsetMinutes: number | null;
  daysOfWeek?: number[];
  intervalDays?: number;
  timezone: string;
  effectiveFrom: Date;
  effectiveTo?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const medicineScheduleSchema = new Schema<IMedicineSchedule>(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true, index: true },
    familyMemberId: {
      type: Schema.Types.ObjectId,
      ref: 'FamilyMember',
      required: true,
      index: true,
    },
    medicineId: { type: Schema.Types.ObjectId, ref: 'Medicine', required: true, index: true },
    slotIndex: { type: Number, required: true, min: 0 },
    slotLabel: { type: String, required: true, trim: true, maxlength: 80 },
    timeOfDay: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
    associatedMeal: { type: String, enum: ASSOCIATED_MEALS, required: true },
    customMealName: { type: String, trim: true },
    foodInstruction: { type: String, enum: FOOD_INSTRUCTIONS, required: true },
    customFoodInstruction: { type: String, trim: true },
    frequency: { type: String, enum: MEDICINE_FREQUENCIES, required: true },
    mealReminderOffsetMinutes: { type: Number, default: -15 },
    medicineReminderOffsetMinutes: { type: Number, default: 0 },
    confirmationOffsetMinutes: { type: Number, default: 20 },
    daysOfWeek: [{ type: Number, min: 0, max: 6 }],
    intervalDays: { type: Number, min: 1, max: 30 },
    timezone: { type: String, required: true, default: 'Asia/Kolkata' },
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

medicineScheduleSchema.index({ medicineId: 1, slotIndex: 1 }, { unique: true });
medicineScheduleSchema.index({ familyId: 1, isActive: 1 });

export const MedicineSchedule = mongoose.model<IMedicineSchedule>(
  'MedicineSchedule',
  medicineScheduleSchema
);

