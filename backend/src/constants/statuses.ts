export const USER_ROLES = ['ADMIN', 'CAREGIVER', 'VIEWER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const DOSE_STATUSES = [
  'PATIENT_REPORTED_TAKEN',
  'PATIENT_REPORTED_NOT_TAKEN',
  'UNCONFIRMED',
  'PENDING',
  'CALLBACK_REQUESTED',
  'ESCALATED',
] as const;
export type DoseStatus = (typeof DOSE_STATUSES)[number];

export const MEAL_STATUSES = [
  'PENDING',
  'REMINDED',
  'FINISHED',
  'NOT_FINISHED',
  'SKIPPED',
] as const;
export type MealStatus = (typeof MEAL_STATUSES)[number];

export const FOOD_INSTRUCTIONS = [
  'BEFORE_FOOD',
  'AFTER_FOOD',
  'WITH_FOOD',
  'NO_FOOD_RESTRICTION',
  'CUSTOM',
] as const;
export type FoodInstruction = (typeof FOOD_INSTRUCTIONS)[number];

export const ASSOCIATED_MEALS = ['BREAKFAST', 'LUNCH', 'DINNER', 'CUSTOM'] as const;
export type AssociatedMeal = (typeof ASSOCIATED_MEALS)[number];

export const MEDICINE_FREQUENCIES = [
  'ONCE_DAILY',
  'TWICE_DAILY',
  'THREE_TIMES_DAILY',
  'FOUR_TIMES_DAILY',
  'WEEKLY',
  'ALTERNATE_DAYS',
  'CUSTOM',
] as const;
export type MedicineFrequency = (typeof MEDICINE_FREQUENCIES)[number];

export const CALL_TYPES = [
  'MEAL_REMINDER',
  'MEDICINE_REMINDER',
  'CONFIRMATION_CALL',
  'CALLBACK',
] as const;
export type CallType = (typeof CALL_TYPES)[number];

export const CALL_SCHEDULE_STATUSES = [
  'QUEUED',
  'DISPATCHED',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
  'SKIPPED',
] as const;
export type CallScheduleStatus = (typeof CALL_SCHEDULE_STATUSES)[number];

export const CALL_LIFECYCLE_STATUSES = [
  'QUEUED',
  'INITIATING',
  'RINGING',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
  'NO_ANSWER',
  'BUSY',
  'REJECTED',
  'CANCELLED',
] as const;
export type CallLifecycleStatus = (typeof CALL_LIFECYCLE_STATUSES)[number];

export const CALL_OUTCOMES = [
  'PENDING',
  'ANSWERED',
  'NO_ANSWER',
  'BUSY',
  'REJECTED',
  'FAILED',
  'COMPLETED',
  'CALLBACK_REQUESTED',
  'ESCALATED',
  'CANCELLED',
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const RECORDING_STATUSES = [
  'AVAILABLE',
  'UNAVAILABLE',
  'CONSENT_DENIED',
  'PROCESSING',
] as const;
export type RecordingStatus = (typeof RECORDING_STATUSES)[number];

export const MEDICINE_CONFIRMATION_VALUES = [
  'TAKEN',
  'NOT_TAKEN',
  'UNCONFIRMED',
] as const;
export type MedicineConfirmationValue = (typeof MEDICINE_CONFIRMATION_VALUES)[number];

export const CALLBACK_STATUSES = [
  'REQUESTED',
  'CONFIRMED',
  'SCHEDULED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
export type CallbackStatus = (typeof CALLBACK_STATUSES)[number];

export const CONSENT_TYPES = [
  'VOICE_CALLING',
  'CALL_RECORDING',
  'WHATSAPP_ALERTS',
  'SMS_ALERTS',
] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export const CONSENT_STATUSES = ['GRANTED', 'DENIED', 'REVOKED', 'PENDING'] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ['IN_APP', 'WHATSAPP', 'SMS'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_TRIGGERS = [
  'REPEATED_NO_ANSWER',
  'UNCONFIRMED_MEDICINE',
  'FORGOT_MEDICINE',
  'HELP_REQUESTED',
  'FEELING_UNWELL',
  'EMERGENCY_ESCALATION',
] as const;
export type NotificationTrigger = (typeof NOTIFICATION_TRIGGERS)[number];

export const NOTIFICATION_STATUSES = [
  'PENDING',
  'SENT',
  'DELIVERED',
  'SKIPPED_NO_CONFIG',
  'SKIPPED_NO_CONSENT',
  'FAILED',
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const ESCALATION_REASONS = [
  'REPEATED_NO_ANSWER',
  'MEDICINE_UNCONFIRMED',
  'PATIENT_FORGOT',
  'PATIENT_REQUESTED_HELP',
  'PATIENT_FEELING_UNWELL',
  'EMERGENCY',
] as const;
export type EscalationReason = (typeof ESCALATION_REASONS)[number];

export const ESCALATION_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type EscalationSeverity = (typeof ESCALATION_SEVERITIES)[number];

export const ESCALATION_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED'] as const;
export type EscalationStatus = (typeof ESCALATION_STATUSES)[number];

