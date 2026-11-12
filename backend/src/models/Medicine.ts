import mongoose, { Document, Schema, Types } from 'mongoose';
import {
  ASSOCIATED_MEALS,
  AssociatedMeal,
  FOOD_INSTRUCTIONS,
  FoodInstruction,
  MEDICINE_FREQUENCIES,
  MedicineFrequency,
} from '../constants/statuses';

export interface IScheduledTimeSlot {
  slotLabel: string;
  timeOfDay: string; // HH:mm
  associatedMeal: AssociatedMeal;
  customMealName?: string;
  foodInstruction: FoodInstruction;
  customFoodInstruction?: string;
  mealReminderOffsetMinutes: number | null;
  medicineReminderOffsetMinutes: number;
  confirmationOffsetMinutes: number | null;
  daysOfWeek?: number[]; // 0 (Sun) - 6 (Sat)
  intervalDays?: number;
}

export interface IMedicine extends Document {
  familyId: Types.ObjectId;
  familyMemberId: Types.ObjectId;
  name: string;
  dosage: string;
  prescribedInstructions: string;
  foodInstruction: FoodInstruction;
  customFoodInstruction?: string;
  associatedMeal: AssociatedMeal;
  customMealName?: string;
  startDate: Date;
  endDate?: Date;
  frequency: MedicineFrequency;
  scheduledTimes: IScheduledTimeSlot[];
  prescribingDoctor?: string;
  notes?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const scheduledTimeSlotSchema = new Schema<IScheduledTimeSlot>(
  {
    slotLabel: { type: String, required: true, trim: true, maxlength: 80 },
    timeOfDay: {
      type: String,
      required: true,
      match: [/^\d{2}:\d{2}$/, 'timeOfDay must be in HH:mm format'],
    },
    associatedMeal: { type: String, enum: ASSOCIATED_MEALS, required: true },
    customMealName: { type: String, trim: true, maxlength: 60 },
    foodInstruction: { type: String, enum: FOOD_INSTRUCTIONS, required: true },
    customFoodInstruction: { type: String, trim: true, maxlength: 200 },
    mealReminderOffsetMinutes: { type: Number, default: -15, min: -120, max: 60 },
    medicineReminderOffsetMinutes: { type: Number, default: 0, min: -60, max: 60 },
    confirmationOffsetMinutes: { type: Number, default: 20, min: 5, max: 180 },
    daysOfWeek: [{ type: Number, min: 0, max: 6 }],
    intervalDays: { type: Number, min: 1, max: 30 },
  },
  { _id: false }
);

const medicineSchema = new Schema<IMedicine>(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true, index: true },
    familyMemberId: {
      type: Schema.Types.ObjectId,
      ref: 'FamilyMember',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 150 },
    dosage: { type: String, required: true, trim: true, maxlength: 80 },
    prescribedInstructions: { type: String, required: true, trim: true, maxlength: 500 },
    foodInstruction: {
      type: String,
      enum: FOOD_INSTRUCTIONS,
      required: true,
      default: 'AFTER_FOOD',
    },
    customFoodInstruction: { type: String, trim: true, maxlength: 250 },
    associatedMeal: {
      type: String,
      enum: ASSOCIATED_MEALS,
      required: true,
      default: 'BREAKFAST',
    },
    customMealName: { type: String, trim: true, maxlength: 60 },
    startDate: { type: Date, required: true },
    endDate: { type: Date },
    frequency: { type: String, enum: MEDICINE_FREQUENCIES, required: true },
    scheduledTimes: {
      type: [scheduledTimeSlotSchema],
      validate: {
        validator: (arr: IScheduledTimeSlot[]) => Array.isArray(arr) && arr.length > 0,
        message: 'At least one scheduled time slot is required',
      },
    },
    prescribingDoctor: { type: String, trim: true, maxlength: 120 },
    notes: { type: String, trim: true, maxlength: 1000 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

medicineSchema.index({ familyId: 1, familyMemberId: 1, isActive: 1 });

export const Medicine = mongoose.model<IMedicine>('Medicine', medicineSchema);

