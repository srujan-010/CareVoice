import crypto from 'crypto';
import { getLanguageMeta } from '../../constants/languages';
import {
  IVoiceProvider,
  MockCallScenario,
  SimulatedTurn,
  VoiceCallContextPayload,
  VoiceCallExecutionResult,
} from './voiceProvider.interface';

const GREETINGS: Record<string, string> = {
  te: 'నమస్కారం',
  hi: 'नमस्ते',
  mr: 'नमस्कार',
  ta: 'வணக்கம்',
  kn: 'ನಮಸ್ಕಾರ',
  bn: 'নমস্কার',
  ml: 'നമസ്കാരം',
  gu: 'નમસ્તે',
  pa: 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ',
  or: 'ନମସ୍କାର',
  en: 'Hello',
};

/**
 * Generates a real valid 1-second gentle dual-tone chime PCM WAV buffer in memory
 * for development/testing audio player verification when recording consent is granted.
 */
function buildGentleChimeWavBase64(): string {
  const sampleRate = 8000;
  const numSamples = sampleRate * 1; // 1 second
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM
  buffer.writeUInt16LE(1, 20); // Linear PCM
  buffer.writeUInt16LE(1, 22); // Mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.exp(-3.2 * t);
    const freq = t < 0.45 ? 523.25 : 659.25; // C5 -> E5 gentle healthcare chime
    const sample = Math.round(Math.sin(2 * Math.PI * freq * t) * 7000 * envelope);
    buffer.writeInt16LE(sample, 44 + i * 2);
  }

  return buffer.toString('base64');
}

export class MockVoiceProvider implements IVoiceProvider {
  public readonly providerName = 'mock' as const;

  isConfigured(): boolean {
    return true;
  }

  getStatus() {
    return {
      provider: 'mock' as const,
      configured: true,
      telephonyEnabled: false,
      missingFields: [],
    };
  }

  async initiateLiveCall(): Promise<{
    accepted: boolean;
    providerCallId: string;
    rawStatus: string;
  }> {
    return {
      accepted: false,
      providerCallId: `mock-blocked-${crypto.randomUUID()}`,
      rawStatus: 'MOCK_PROVIDER_NO_LIVE_TELEPHONY',
    };
  }

  async simulateCall(
    context: VoiceCallContextPayload,
    scenario: MockCallScenario,
    options?: { delayMinutes?: number }
  ): Promise<VoiceCallExecutionResult> {
    const langMeta = getLanguageMeta(context.languageCode);
    const greeting = GREETINGS[langMeta.code] ?? 'Hello';
    const mealName = context.associatedMeal.toLowerCase();
    const providerCallId = `mock_${crypto.randomUUID().slice(0, 12)}`;
    const delayMinutes = Math.min(Math.max(options?.delayMinutes ?? 10, 5), 90);
    const recordingWavBase64 = context.recordingConsentGranted
      ? buildGentleChimeWavBase64()
      : undefined;

    if (scenario === 'NO_ANSWER' || scenario === 'BUSY' || scenario === 'REJECTED') {
      return {
        provider: 'mock',
        mode: 'mock',
        providerCallId,
        outcome: scenario,
        durationSeconds: 0,
        mealConfirmed: null,
        medicineConfirmed: 'UNCONFIRMED',
        turns: [],
        aiSummary: `[MOCK] Call to ${context.patientName} (${langMeta.name}) ended with ${scenario}. Medicine remains UNCONFIRMED.`,
        safetyFlags: ['DOSE_UNCONFIRMED'],
      };
    }

    if (scenario === 'MEAL_DELAY_CALLBACK') {
      const turns: SimulatedTurn[] = [
        {
          speaker: 'AI',
          text: `${greeting} ${context.patientName} garu! (${langMeta.name}) Have you finished your ${mealName}?`,
          translatedText: `Hello ${context.patientName}! Have you finished your ${mealName}?`,
          intent: 'ASK_MEAL_STATUS',
        },
        {
          speaker: 'PATIENT',
          text: `No, I will eat after ${delayMinutes} minutes.`,
          translatedText: `Patient is not done eating yet; plans to eat in ${delayMinutes} minutes.`,
          intent: 'MEAL_DELAY',
        },
        {
          speaker: 'AI',
          text: `No problem. Shall I call you again after ${delayMinutes} minutes?`,
          translatedText: `Offered callback in ${delayMinutes} minutes.`,
          intent: 'OFFER_CALLBACK',
        },
        {
          speaker: 'PATIENT',
          text: 'Yes, please call me then.',
          translatedText: 'Confirmed callback request.',
          intent: 'CONFIRM_CALLBACK',
        },
      ];

      return {
        provider: 'mock',
        mode: 'mock',
        providerCallId,
        outcome: 'CALLBACK_REQUESTED',
        durationSeconds: 32,
        mealConfirmed: false,
        medicineConfirmed: 'UNCONFIRMED',
        requestedCallbackDelayMinutes: delayMinutes,
        turns,
        aiSummary: `[MOCK] ${context.patientName} has not finished ${mealName} yet and confirmed a callback in ${delayMinutes} minutes. Medicine was NOT marked taken.`,
        safetyFlags: ['MEAL_NOT_FINISHED', 'CALLBACK_SCHEDULED'],
        recordingWavBase64,
      };
    }

    if (scenario === 'MEAL_ONLY_UNCONFIRMED') {
      const turns: SimulatedTurn[] = [
        {
          speaker: 'AI',
          text: `${greeting} ${context.patientName}! (${langMeta.name}) Have you finished your ${mealName}?`,
          translatedText: `Hello ${context.patientName}! Have you finished your ${mealName}?`,
          intent: 'ASK_MEAL_STATUS',
        },
        {
          speaker: 'PATIENT',
          text: `Yes, I finished my ${mealName}.`,
          translatedText: `Confirmed finishing ${mealName}.`,
          intent: 'MEAL_FINISHED',
        },
        {
          speaker: 'AI',
          text: `Wonderful. Have you taken ${context.medicineName} (${context.dosage})?`,
          translatedText: `Asked whether ${context.medicineName} (${context.dosage}) was taken.`,
          intent: 'ASK_MEDICINE_CONFIRMATION',
        },
        {
          speaker: 'PATIENT',
          text: '[Call disconnected before medicine confirmation]',
          intent: 'CALL_DROPPED',
        },
      ];

      return {
        provider: 'mock',
        mode: 'mock',
        providerCallId,
        outcome: 'ANSWERED',
        durationSeconds: 21,
        mealConfirmed: true,
        medicineConfirmed: 'UNCONFIRMED',
        turns,
        aiSummary: `[MOCK] ${context.patientName} confirmed finishing ${mealName}, but call ended before medicine confirmation. Medicine strictly remains UNCONFIRMED.`,
        safetyFlags: ['MEAL_CONFIRMED_ONLY', 'MEDICINE_UNCONFIRMED'],
        recordingWavBase64,
      };
    }

    if (scenario === 'FEELING_UNWELL') {
      const turns: SimulatedTurn[] = [
        {
          speaker: 'AI',
          text: `${greeting} ${context.patientName}! (${langMeta.name}) It is time to check on your ${context.medicineName} (${context.dosage}). How are you feeling?`,
          translatedText: `Greeted ${context.patientName} for ${context.medicineName} check.`,
          intent: 'GREETING_CHECK',
        },
        {
          speaker: 'PATIENT',
          text: 'I am feeling dizzy and unwell today. Please inform my son.',
          translatedText: 'Patient reported feeling dizzy/unwell and requested family assistance.',
          intent: 'PATIENT_UNWELL_HELP',
        },
        {
          speaker: 'AI',
          text: 'I understand. I am notifying your family right away so they can check on you. Please rest comfortably.',
          translatedText: 'Acknowledged discomfort and escalated to family contact without giving medical advice.',
          intent: 'ESCALATE_TO_FAMILY',
        },
      ];

      return {
        provider: 'mock',
        mode: 'mock',
        providerCallId,
        outcome: 'ESCALATED',
        durationSeconds: 29,
        mealConfirmed: null,
        medicineConfirmed: 'UNCONFIRMED',
        feelingUnwell: true,
        requestedHelp: true,
        turns,
        aiSummary: `[MOCK] URGENT: ${context.patientName} reported feeling dizzy/unwell and asked to inform family. Escalation & family alerts triggered.`,
        safetyFlags: ['PATIENT_FEELING_UNWELL', 'FAMILY_ESCALATION_TRIGGERED'],
        recordingWavBase64,
      };
    }

    if (scenario === 'NOT_TAKEN') {
      const turns: SimulatedTurn[] = [
        {
          speaker: 'AI',
          text: `${greeting} ${context.patientName}! (${langMeta.name}) Have you taken your ${context.medicineName} (${context.dosage})?`,
          translatedText: `Checked whether ${context.medicineName} (${context.dosage}) was taken.`,
          intent: 'ASK_MEDICINE_CONFIRMATION',
        },
        {
          speaker: 'PATIENT',
          text: 'No, I forgot to take it.',
          translatedText: 'Patient reported forgetting to take the dose.',
          intent: 'MEDICINE_NOT_TAKEN',
        },
        {
          speaker: 'AI',
          text: `Thank you for letting me know. Please follow your doctor's instructions for ${context.medicineName} (${context.foodInstruction.replace(/_/g, ' ').toLowerCase()}). I will inform your family caregiver.`,
          translatedText: 'Logged missed dose and notified caregiver without prescribing changes.',
          intent: 'REMIND_AND_LOG_NOT_TAKEN',
        },
      ];

      return {
        provider: 'mock',
        mode: 'mock',
        providerCallId,
        outcome: 'COMPLETED',
        durationSeconds: 26,
        mealConfirmed: true,
        medicineConfirmed: 'NOT_TAKEN',
        turns,
        aiSummary: `[MOCK] ${context.patientName} reported NOT taking ${context.medicineName} (${context.dosage}). Caregiver alert generated.`,
        safetyFlags: ['PATIENT_REPORTED_NOT_TAKEN'],
        recordingWavBase64,
      };
    }

    // Default: TAKEN
    const turns: SimulatedTurn[] = [
      {
        speaker: 'AI',
        text: `${greeting} ${context.patientName}! (${langMeta.name}) Have you finished your ${mealName}?`,
        translatedText: `Asked ${context.patientName} about ${mealName}.`,
        intent: 'ASK_MEAL_STATUS',
      },
      {
        speaker: 'PATIENT',
        text: `Yes, I finished my ${mealName}.`,
        translatedText: `Confirmed ${mealName} finished.`,
        intent: 'MEAL_FINISHED',
      },
      {
        speaker: 'AI',
        text: `Great! Have you taken your ${context.medicineName} (${context.dosage})?`,
        translatedText: `Asked for confirmation of ${context.medicineName} (${context.dosage}).`,
        intent: 'ASK_MEDICINE_CONFIRMATION',
      },
      {
        speaker: 'PATIENT',
        text: `Yes, I took my ${context.medicineName} just now.`,
        translatedText: `Explicitly confirmed taking ${context.medicineName}.`,
        intent: 'MEDICINE_TAKEN',
      },
      {
        speaker: 'AI',
        text: 'Thank you! Have a healthy day ahead.',
        translatedText: 'Closed reminder call politely.',
        intent: 'CLOSING',
      },
    ];

    return {
      provider: 'mock',
      mode: 'mock',
      providerCallId,
      outcome: 'COMPLETED',
      durationSeconds: 38,
      mealConfirmed: true,
      medicineConfirmed: 'TAKEN',
      turns,
      aiSummary: `[MOCK] ${context.patientName} confirmed finishing ${mealName} and explicitly reported taking ${context.medicineName} (${context.dosage}) in ${langMeta.name}.`,
      safetyFlags: ['EXPLICIT_DOSE_CONFIRMATION'],
      recordingWavBase64,
    };
  }
}

