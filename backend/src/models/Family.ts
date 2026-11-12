import mongoose, { Document, Schema } from 'mongoose';

export interface IFamilySettings {
  autoEscalationMinutes: number;
  maxCallbackRetries: number;
  allowDevDemoMode: boolean;
}

export interface IFamily extends Document {
  name: string;
  primaryContactName: string;
  primaryContactEmail: string;
  primaryContactPhone?: string;
  timezone: string;
  settings: IFamilySettings;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const familySchema = new Schema<IFamily>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    primaryContactName: { type: String, required: true, trim: true, maxlength: 120 },
    primaryContactEmail: { type: String, required: true, trim: true, lowercase: true },
    primaryContactPhone: { type: String, trim: true },
    timezone: { type: String, required: true, default: 'Asia/Kolkata' },
    settings: {
      autoEscalationMinutes: { type: Number, default: 30, min: 5, max: 180 },
      maxCallbackRetries: { type: Number, default: 3, min: 1, max: 5 },
      allowDevDemoMode: { type: Boolean, default: false },
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

familySchema.index({ primaryContactEmail: 1 });

export const Family = mongoose.model<IFamily>('Family', familySchema);

