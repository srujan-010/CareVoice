import {
  CallLifecycleStatus,
  CallOutcome,
  CallType,
  MedicineConfirmationValue,
} from '../../constants/statuses';
import { SarvamCallConnectivityStatus } from '../../models/CallLog';

export type MockCallScenario =
  | 'TAKEN'
  | 'NOT_TAKEN'
  | 'MEAL_DELAY_CALLBACK'
  | 'MEAL_ONLY_UNCONFIRMED'
  | 'NO_ANSWER'
  | 'BUSY'
  | 'REJECTED'
  | 'FEELING_UNWELL';

export interface VoiceCallContextPayload {
  callLogId: string;
  familyId: string;
  familyMemberId: string;
  patientName: string;
  phoneNumber: string;
  languageCode: string;
  languageBcp47: string;
  voiceGender: 'FEMALE' | 'MALE' | 'NEUTRAL';
  recordingConsentGranted: boolean;
  medicineId: string;
  medicineName: string;
  dosage: string;
  foodInstruction: string;
  associatedMeal: string;
  prescribedInstructions: string;
  doseInstanceId: string;
  callType: CallType;
  callPurpose?: string;
  isTestCall?: boolean;
  scheduledAtIso: string;
  safetyDirectives: string[];
}

export interface SimulatedTurn {
  speaker: 'AI' | 'PATIENT';
  text: string;
  translatedText?: string;
  intent?: string;
}

export interface VoiceCallExecutionResult {
  provider: 'mock' | 'sarvam';
  mode: 'mock' | 'live';
  callStatus?: CallLifecycleStatus;
  providerCallId: string;
  attemptId?: string;
  interactionId?: string;
  sarvamStatus?: SarvamCallConnectivityStatus;
  failureReason?: string;
  channelInfo?: Record<string, unknown>;
  finalAgentVariables?: Record<string, unknown>;
  recordingUrl?: string;
  transcriptConsentGranted?: boolean;
  outcome: CallOutcome;
  durationSeconds: number;
  mealConfirmed: boolean | null;
  medicineConfirmed: MedicineConfirmationValue;
  requestedCallbackDelayMinutes?: number;
  feelingUnwell?: boolean;
  requestedHelp?: boolean;
  turns: SimulatedTurn[];
  aiSummary: string;
  safetyFlags: string[];
  recordingWavBase64?: string;
}

export interface IVoiceProvider {
  readonly providerName: 'mock' | 'sarvam';
  isConfigured(): boolean;
  getStatus(): {
    provider: 'mock' | 'sarvam';
    configured: boolean;
    telephonyEnabled: boolean;
    missingFields: string[];
  };
  initiateLiveCall(context: VoiceCallContextPayload): Promise<{
    accepted: boolean;
    attemptId?: string;
    providerCallId: string;
    rawStatus: string;
    httpStatus?: number;
  }>;
  simulateCall(
    context: VoiceCallContextPayload,
    scenario: MockCallScenario,
    options?: { delayMinutes?: number }
  ): Promise<VoiceCallExecutionResult>;
}

