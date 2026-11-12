import mongoose, { Document, Schema, Types } from 'mongoose';
import {
  ASSOCIATED_MEALS,
  AssociatedMeal,
  DOSE_STATUSES,
  DoseStatus,
  FOOD_INSTRUCTIONS,
  FoodInstruction,
  MEAL_STATUSES,
  MealStatus,
} from '../constants/statuses';

export interface IDoseInstance extends Document {
  familyId: Types.ObjectId;
  familyMemberId: Types.ObjectId;
  medicineId: Types.ObjectId;
  medicineScheduleId: Types.ObjectId;
  scheduledDateLocal: string; // YYYY-MM-DD in patient timezone
  slotIndex: number;
  slotLabel: string;
  scheduledAt: Date;
  mealReminderAt?: Date;
  medicineReminderAt: Date;
  confirmationCallAt?: Date;
  timezone: string;
  associatedMeal: AssociatedMeal;
  customMealName?: string;
  foodInstruction: FoodInstruction;
  customFoodInstruction?: string;
  mealStatus: MealStatus;
  status: DoseStatus;
  confirmedAt?: Date;
  confirmedByCallId?: Types.ObjectId;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const doseInstanceSchema = new Schema<IDoseInstance>(
  {
    familyId: { type: Schema.Types.ObjectId, ref: 'Family', required: true, index: true },
    familyMemberId: {
      type: Schema.Types.ObjectId,
      ref: 'FamilyMember',
      required: true,
      index: true,
    },
    medicineId: { type: Schema.Types.ObjectId, ref: 'Medicine', required: true, index: true },
    medicineScheduleId: {
      type: Schema.Types.ObjectId,
      ref: 'MedicineSchedule',
      required: true,
    },
    scheduledDateLocal: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    slotIndex: { type: Number, required: true, min: 0 },
    slotLabel: { type: String, required: true, trim: true },
    scheduledAt: { type: Date, required: true, index: true },
    mealReminderAt: { type: Date },
    medicineReminderAt: { type: Date, required: true },
    confirmationCallAt: { type: Date },
    timezone: { type: String, required: true },
    associatedMeal: { type: String, enum: ASSOCIATED_MEALS, required: true },
    customMealName: { type: String, trim: true },
    foodInstruction: { type: String, enum: FOOD_INSTRUCTIONS, required: true },
    customFoodInstruction: { type: String, trim: true },
    mealStatus: { type: String, enum: MEAL_STATUSES, default: 'PENDING', required: true },
    status: { type: String, enum: DOSE_STATUSES, default: 'PENDING', required: true },
    confirmedAt: { type: Date },
    confirmedByCallId: { type: Schema.Types.ObjectId, ref: 'CallLog' },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

doseInstanceSchema.index({ medicineScheduleId: 1, scheduledDateLocal: 1 }, { unique: true });
doseInstanceSchema.index({ familyId: 1, scheduledAt: -1, status: 1 });
doseInstanceSchema.index({ familyMemberId: 1, scheduledDateLocal: 1 });

export const DoseInstance = mongoose.model<IDoseInstance>('DoseInstance', doseInstanceSchema);

