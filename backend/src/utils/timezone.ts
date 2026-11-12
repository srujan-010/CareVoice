import { DateTime, IANAZone } from 'luxon';

export function isValidTimezone(tz: string): boolean {
  if (!tz || typeof tz !== 'string') return false;
  return IANAZone.isValidZone(tz);
}

export function getLocalDateString(date: Date, timezone: string): string {
  const zone = isValidTimezone(timezone) ? timezone : 'Asia/Kolkata';
  return DateTime.fromJSDate(date, { zone }).toISODate() ?? '';
}

export function getLocalDateRangeUtc(
  localDateStr: string,
  timezone: string
): { startUtc: Date; endUtc: Date } {
  const zone = isValidTimezone(timezone) ? timezone : 'Asia/Kolkata';
  const start = DateTime.fromISO(localDateStr, { zone }).startOf('day');
  const end = start.endOf('day');
  return {
    startUtc: start.toUTC().toJSDate(),
    endUtc: end.toUTC().toJSDate(),
  };
}

/**
 * Converts a local calendar date (YYYY-MM-DD) + HH:mm time in a specific IANA timezone
 * into an exact UTC Date, safely handling Daylight Saving Time gaps/overlaps via Luxon.
 */
export function localDateTimeToUtc(
  localDateStr: string,
  timeHHmm: string,
  timezone: string
): Date {
  const zone = isValidTimezone(timezone) ? timezone : 'Asia/Kolkata';
  const [hourStr, minuteStr] = timeHHmm.split(':');
  const hour = Number(hourStr ?? 0);
  const minute = Number(minuteStr ?? 0);

  const dt = DateTime.fromISO(localDateStr, { zone }).set({
    hour,
    minute,
    second: 0,
    millisecond: 0,
  });

  if (!dt.isValid) {
    throw new Error(`Invalid local date/time (${localDateStr} ${timeHHmm}) for timezone ${zone}`);
  }

  return dt.toUTC().toJSDate();
}

export function addMinutesUtc(date: Date, minutes: number): Date {
  return DateTime.fromJSDate(date).plus({ minutes }).toUTC().toJSDate();
}

export function isWithinQuietHours(
  targetUtc: Date,
  timezone: string,
  quietStartHHmm: string,
  quietEndHHmm: string
): boolean {
  const zone = isValidTimezone(timezone) ? timezone : 'Asia/Kolkata';
  const local = DateTime.fromJSDate(targetUtc, { zone });
  const currentMinutes = local.hour * 60 + local.minute;

  const [sh, sm] = quietStartHHmm.split(':').map(Number);
  const [eh, em] = quietEndHHmm.split(':').map(Number);
  const startMinutes = (sh || 0) * 60 + (sm || 0);
  const endMinutes = (eh || 0) * 60 + (em || 0);

  if (startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  // Wraps midnight (e.g., 22:00 to 06:30)
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

