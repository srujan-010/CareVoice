import { describe, expect, it } from 'vitest';
import {
  buildCallJobKey,
  computeDoseCallTimes,
  shouldGenerateDoseForDate,
} from '../../src/services/scheduleEngine.service';
import { isWithinQuietHours } from '../../src/utils/timezone';

describe('Schedule Engine Pure Logic', () => {
  it('generates daily schedules within effective date window and blocks expired ones', () => {
    const baseSchedule = {
      isActive: true,
      effectiveFrom: new Date('2026-11-10T00:00:00.000Z'),
      effectiveTo: new Date('2026-11-15T23:59:59.000Z'),
      frequency: 'THREE_TIMES_DAILY' as const,
      timezone: 'Asia/Kolkata',
    };

    expect(shouldGenerateDoseForDate(baseSchedule, '2026-11-09')).toBe(false);
    expect(shouldGenerateDoseForDate(baseSchedule, '2026-11-12')).toBe(true);
    expect(shouldGenerateDoseForDate(baseSchedule, '2026-11-16')).toBe(false);
    expect(shouldGenerateDoseForDate({ ...baseSchedule, isActive: false }, '2026-11-12')).toBe(
      false
    );
  });

  it('respects WEEKLY and ALTERNATE_DAYS frequencies accurately', () => {
    // 2026-11-12 is Thursday (weekday % 7 === 4)
    const weeklySchedule = {
      isActive: true,
      effectiveFrom: new Date('2026-11-01T00:00:00.000Z'),
      frequency: 'WEEKLY' as const,
      daysOfWeek: [4, 0], // Thu & Sun
      timezone: 'Asia/Kolkata',
    };
    expect(shouldGenerateDoseForDate(weeklySchedule, '2026-11-12')).toBe(true);
    expect(shouldGenerateDoseForDate(weeklySchedule, '2026-11-13')).toBe(false);

    const altSchedule = {
      isActive: true,
      effectiveFrom: new Date('2026-11-10T00:00:00.000Z'),
      frequency: 'ALTERNATE_DAYS' as const,
      timezone: 'Asia/Kolkata',
    };
    expect(shouldGenerateDoseForDate(altSchedule, '2026-11-10')).toBe(true);
    expect(shouldGenerateDoseForDate(altSchedule, '2026-11-11')).toBe(false);
    expect(shouldGenerateDoseForDate(altSchedule, '2026-11-12')).toBe(true);
  });

  it('computes separate meal, medicine, and confirmation call timestamps with DST support', () => {
    // 2026-03-08 is US Spring Forward DST transition day in America/New_York
    const dstSchedule = {
      timeOfDay: '08:00',
      timezone: 'America/New_York',
      foodInstruction: 'BEFORE_FOOD' as const,
      mealReminderOffsetMinutes: -15,
      medicineReminderOffsetMinutes: 0,
      confirmationOffsetMinutes: 25,
    };

    const times = computeDoseCallTimes(dstSchedule, '2026-03-08');
    // After 2:00 AM spring forward on 2026-03-08, New York is EDT (UTC-4), so 08:00 EDT == 12:00Z
    expect(times.scheduledAt.toISOString()).toBe('2026-03-08T12:00:00.000Z');
    expect(times.mealReminderAt?.toISOString()).toBe('2026-03-08T11:45:00.000Z');
    expect(times.medicineReminderAt.toISOString()).toBe('2026-03-08T12:00:00.000Z');
    expect(times.confirmationCallAt?.toISOString()).toBe('2026-03-08T12:25:00.000Z');
  });

  it('omits meal reminder when NO_FOOD_RESTRICTION or preference disabled', () => {
    const noFood = computeDoseCallTimes(
      {
        timeOfDay: '09:00',
        timezone: 'Asia/Kolkata',
        foodInstruction: 'NO_FOOD_RESTRICTION',
        mealReminderOffsetMinutes: -15,
        medicineReminderOffsetMinutes: 0,
        confirmationOffsetMinutes: 20,
      },
      '2026-11-12'
    );
    expect(noFood.mealReminderAt).toBeUndefined();
    expect(noFood.confirmationCallAt).toBeDefined();

    const prefOff = computeDoseCallTimes(
      {
        timeOfDay: '09:00',
        timezone: 'Asia/Kolkata',
        foodInstruction: 'BEFORE_FOOD',
        mealReminderOffsetMinutes: -15,
        medicineReminderOffsetMinutes: 0,
        confirmationOffsetMinutes: 20,
      },
      '2026-11-12',
      { allowMealReminders: false, allowConfirmationCalls: false }
    );
    expect(prefOff.mealReminderAt).toBeUndefined();
    expect(prefOff.confirmationCallAt).toBeUndefined();
  });

  it('generates deterministic unique job keys per dose, call type, and attempt', () => {
    const k1 = buildCallJobKey('dose123', 'MEAL_REMINDER', 1);
    const k2 = buildCallJobKey('dose123', 'MEDICINE_REMINDER', 1);
    const k3 = buildCallJobKey('dose123', 'CONFIRMATION_CALL', 1);
    expect(new Set([k1, k2, k3]).size).toBe(3);
  });

  it('evaluates midnight-wrapping quiet hours accurately in patient timezone', () => {
    // 23:00 IST == 17:30 UTC
    const nightUtc = new Date('2026-11-12T17:30:00.000Z');
    // 10:00 IST == 04:30 UTC
    const morningUtc = new Date('2026-11-12T04:30:00.000Z');

    expect(isWithinQuietHours(nightUtc, 'Asia/Kolkata', '22:00', '06:30')).toBe(true);
    expect(isWithinQuietHours(morningUtc, 'Asia/Kolkata', '22:00', '06:30')).toBe(false);
  });
});

