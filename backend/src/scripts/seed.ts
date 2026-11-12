import { connectDatabase, disconnectDatabase } from '../config/database';
import { env } from '../config/env';
import { registerFamilyAccount } from '../services/auth.service';
import { createFamilyMember } from '../services/familyMember.service';
import { createMedicine } from '../services/medicine.service';
import { simulateCallForDose } from '../services/call.service';
import { logger } from '../utils/logger';
import { User } from '../models/User';
import { DoseInstance } from '../models/DoseInstance';

async function runSeed() {
  if (env.NODE_ENV === 'production') {
    throw new Error('Development seed script must never run in production');
  }

  await connectDatabase();

  const existing = await User.findOne({ email: 'demo.admin@carevoice.local' }).lean();
  if (existing) {
    logger.info('Development seed account already exists (demo.admin@carevoice.local)');
    await disconnectDatabase();
    return;
  }

  const account = await registerFamilyAccount({
    familyName: 'Rao Family (Dev Demo)',
    name: 'Karthik Rao',
    email: 'demo.admin@carevoice.local',
    password: 'CareVoiceDemo2026!',
    phone: '+919800011223',
    timezone: 'Asia/Kolkata',
  });

  const mother = await createFamilyMember(
    account.family.id,
    account.user.id,
    account.user.name,
    {
      fullName: 'Lakshmi Devi (Demo)',
      phoneNumber: '+919848012345',
      age: 68,
      preferredLanguage: 'te',
      timezone: 'Asia/Kolkata',
      relationship: 'Mother',
      emergencyContact: {
        name: 'Karthik Rao',
        phoneNumber: '+919800011223',
        relationship: 'Son',
      },
      recordingConsentStatus: 'GRANTED',
      voiceCallingConsentStatus: 'GRANTED',
    }
  );

  const father = await createFamilyMember(
    account.family.id,
    account.user.id,
    account.user.name,
    {
      fullName: 'Suresh Rao (Demo)',
      phoneNumber: '+919848054321',
      age: 72,
      preferredLanguage: 'hi',
      timezone: 'Asia/Kolkata',
      relationship: 'Father',
      emergencyContact: {
        name: 'Karthik Rao',
        phoneNumber: '+919800011223',
        relationship: 'Son',
      },
      recordingConsentStatus: 'GRANTED',
      voiceCallingConsentStatus: 'GRANTED',
    }
  );

  await createMedicine(account.family.id, account.user.id, {
    familyMemberId: mother.id,
    name: 'Metformin SR',
    dosage: '500mg',
    prescribedInstructions: 'Take before each main meal with water.',
    foodInstruction: 'BEFORE_FOOD',
    associatedMeal: 'BREAKFAST',
    startDate: new Date().toISOString(),
    frequency: 'THREE_TIMES_DAILY',
    prescribingDoctor: 'Dr. Meera Nair',
    scheduledTimes: [
      {
        slotLabel: 'Before Breakfast',
        timeOfDay: '07:30',
        associatedMeal: 'BREAKFAST',
        foodInstruction: 'BEFORE_FOOD',
        mealReminderOffsetMinutes: -15,
        medicineReminderOffsetMinutes: 0,
        confirmationOffsetMinutes: 20,
      },
      {
        slotLabel: 'Before Lunch',
        timeOfDay: '13:00',
        associatedMeal: 'LUNCH',
        foodInstruction: 'BEFORE_FOOD',
        mealReminderOffsetMinutes: -15,
        medicineReminderOffsetMinutes: 0,
        confirmationOffsetMinutes: 20,
      },
      {
        slotLabel: 'Before Dinner',
        timeOfDay: '19:30',
        associatedMeal: 'DINNER',
        foodInstruction: 'BEFORE_FOOD',
        mealReminderOffsetMinutes: -15,
        medicineReminderOffsetMinutes: 0,
        confirmationOffsetMinutes: 20,
      },
    ],
  });

  await createMedicine(account.family.id, account.user.id, {
    familyMemberId: father.id,
    name: 'Amlodipine',
    dosage: '5mg',
    prescribedInstructions: 'Take once daily after breakfast.',
    foodInstruction: 'AFTER_FOOD',
    associatedMeal: 'BREAKFAST',
    startDate: new Date().toISOString(),
    frequency: 'ONCE_DAILY',
    prescribingDoctor: 'Dr. Arvind Patel',
    scheduledTimes: [
      {
        slotLabel: 'After Breakfast',
        timeOfDay: '08:30',
        associatedMeal: 'BREAKFAST',
        foodInstruction: 'AFTER_FOOD',
        mealReminderOffsetMinutes: -15,
        medicineReminderOffsetMinutes: 0,
        confirmationOffsetMinutes: 20,
      },
    ],
  });

  const doses = await DoseInstance.find({ familyId: account.family.id }).limit(2).lean();
  if (doses[0]) {
    await simulateCallForDose({
      familyId: account.family.id,
      actorUserId: account.user.id,
      doseInstanceId: String(doses[0]._id),
      scenario: 'TAKEN',
    });
  }
  if (doses[1]) {
    await simulateCallForDose({
      familyId: account.family.id,
      actorUserId: account.user.id,
      doseInstanceId: String(doses[1]._id),
      scenario: 'MEAL_DELAY_CALLBACK',
      delayMinutes: 10,
    });
  }

  logger.info('Development seed completed: demo.admin@carevoice.local / CareVoiceDemo2026!');
  await disconnectDatabase();
}

runSeed().catch((err) => {
  logger.error('Seed error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});

