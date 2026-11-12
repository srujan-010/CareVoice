export type UserRole = 'ADMIN' | 'CAREGIVER' | 'VIEWER';

export type ConsentStatus = 'GRANTED' | 'DENIED' | 'REVOKED' | 'PENDING';
export type ConsentType =
  | 'VOICE_CALLING'
  | 'CALL_TRANSCRIPT'
  | 'CALL_RECORDING'
  | 'WHATSAPP_ALERTS'
  | 'SMS_ALERTS';

export type LanguageStatus =
  | 'MATCHED'
  | 'LANGUAGE_UNAVAILABLE'
  | 'LANGUAGE_FALLBACK_REQUIRED'
  | 'FALLBACK_AUTHORIZED'
  | 'LANGUAGE_MISMATCH';

export type TranscriptStatus = 'PENDING' | 'AVAILABLE' | 'UNAVAILABLE' | 'CONSENT_DENIED';

export type DoseStatus =
  | 'PATIENT_REPORTED_TAKEN'
  | 'PATIENT_REPORTED_NOT_TAKEN'
  | 'UNCONFIRMED'
  | 'PENDING'
  | 'CALLBACK_REQUESTED'
  | 'ESCALATED';

export type MealStatus = 'PENDING' | 'REMINDED' | 'FINISHED' | 'NOT_FINISHED' | 'SKIPPED';

export type FoodInstruction =
  | 'BEFORE_FOOD'
  | 'AFTER_FOOD'
  | 'WITH_FOOD'
  | 'NO_FOOD_RESTRICTION'
  | 'CUSTOM';

export type AssociatedMeal = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'CUSTOM';

export type MedicineFrequency =
  | 'ONCE_DAILY'
  | 'TWICE_DAILY'
  | 'THREE_TIMES_DAILY'
  | 'FOUR_TIMES_DAILY'
  | 'WEEKLY'
  | 'ALTERNATE_DAYS'
  | 'CUSTOM';

export type CallType = 'MEAL_REMINDER' | 'MEDICINE_REMINDER' | 'CONFIRMATION_CALL' | 'CALLBACK';

export type CallLifecycleStatus =
  | 'QUEUED'
  | 'INITIATING'
  | 'RINGING'
  | 'ANSWERED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'NO_ANSWER'
  | 'BUSY'
  | 'REJECTED'
  | 'NOT_CONNECTED'
  | 'CANCELLED'
  | 'LANGUAGE_UNAVAILABLE'
  | 'LANGUAGE_FALLBACK_REQUIRED';

export type CallOutcome =
  | 'PENDING'
  | 'ANSWERED'
  | 'NO_ANSWER'
  | 'BUSY'
  | 'REJECTED'
  | 'FAILED'
  | 'NOT_CONNECTED'
  | 'COMPLETED'
  | 'CALLBACK_REQUESTED'
  | 'ESCALATED'
  | 'CANCELLED';

export type SarvamDiscoverySource =
  | 'deployment'
  | 'campaign'
  | 'experiment'
  | 'test_suite'
  | 'analytics';

export interface SarvamDiscoveredAppSummary {
  appId: string;
  matchesConfiguredAppId: boolean;
  sources: SarvamDiscoverySource[];
  versions: number[];
  statuses: string[];
  deploymentIds: string[];
  campaignIds: string[];
  connectionIds: string[];
  phoneNumbersMasked: string[];
  matchesVersion?: boolean;
  matchesConnectionId?: boolean;
  matchesPhoneNumber?: boolean;
}

export interface SarvamDiscoveredConnectionSummary {
  connectionId: string;
  matchesConfiguredConnectionId: boolean;
  phoneNumbersMasked: string[];
  matchesConfiguredPhone: boolean;
  source: 'deployment' | 'campaign';
}

export interface SarvamWorkspaceDiscoverySummary {
  orgId: string;
  workspaceId: string;
  configuredAgentId: string;
  configuredAgentVersion: number;
  configuredConnectionId: string;
  configuredPhoneMasked: string;
  analyticsAppCheckStatus?: number;
  analyticsAppCheckDetail?: string;
  endpointsChecked: string[];
  discoveredApps: SarvamDiscoveredAppSummary[];
  discoveredConnections: SarvamDiscoveredConnectionSummary[];
}

export interface VoiceCallPreflight {
  activeProvider: 'mock' | 'sarvam';
  configuredMode: 'mock' | 'sarvam';
  telephonyEnabled: boolean;
  telephonyReady: boolean;
  missingTelephonyFields: string[];
  webhookReady: boolean;
  missingWebhookFields: string[];
  webhookHttps: boolean;
  mockSimulationAllowed: boolean;
  liveCallingAllowed: boolean;
  agentVersion: number;
  callerIdMasked: string | null;
  deploymentCheck?: {
    verified: boolean;
    status:
      | 'active'
      | 'verified_campaign'
      | 'inactive'
      | 'mismatch'
      | 'not_found'
      | 'unverified'
      | 'error';
    authCategory?:
      | 'VERIFIED'
      | 'CONFIG_MISSING'
      | 'KEY_SYNTAX_ERROR'
      | 'INVALID_API_KEY_FORMAT'
      | 'UNAUTHORIZED_INVALID_OR_REVOKED_KEY'
      | 'INSUFFICIENT_PERMISSIONS'
      | 'WORKSPACE_OR_ORG_NOT_FOUND'
      | 'APP_NOT_FOUND_IN_WORKSPACE'
      | 'AGENT_UNVERIFIED_IN_WORKSPACE'
      | 'DEPLOYMENT_INACTIVE'
      | 'DEPLOYMENT_MISMATCH'
      | 'NETWORK_ERROR'
      | 'UPSTREAM_ERROR';
    matchedDeploymentId?: string;
    matchedAppVersion?: number;
    connectionVerified: boolean;
    phoneVerified: boolean;
    message: string;
    upstreamStatus?: number;
    upstreamDetail?: string;
    diagnosticHint?: string;
    authHeader?: 'X-API-Key';
    credentialsSharedWithOutbound?: boolean;
    workspaceDiscovery?: SarvamWorkspaceDiscoverySummary;
  } | null;
}

export type CallbackStatus =
  | 'REQUESTED'
  | 'CONFIRMED'
  | 'SCHEDULED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface AuthUser {
  id: string;
  familyId: string;
  name: string;
  email: string;
  role: UserRole;
  phone?: string;
}

export interface FamilyProfile {
  id: string;
  name: string;
  primaryContactName?: string;
  primaryContactEmail?: string;
  primaryContactPhone?: string;
  timezone: string;
  settings: {
    autoEscalationMinutes: number;
    maxCallbackRetries: number;
    allowDevDemoMode: boolean;
  };
}

export interface LanguageOption {
  code: string;
  name: string;
  nativeName: string;
  bcp47: string;
  sarvamSupported: boolean;
}

export interface FamilyMember {
  id: string;
  _id?: string;
  familyId: string;
  fullName: string;
  phoneNumber: string;
  age?: number;
  preferredLanguage: string;
  timezone: string;
  relationship: string;
  emergencyContact: {
    name: string;
    phoneNumber: string;
    relationship: string;
  };
  callingPreferences: {
    quietHoursStart: string;
    quietHoursEnd: string;
    maxRetries: number;
    retryIntervalMinutes: number;
    allowMealReminders: boolean;
    allowMedicineReminders?: boolean;
    allowConfirmationCalls: boolean;
    preferredVoiceGender: 'FEMALE' | 'MALE' | 'NEUTRAL';
  };
  recordingConsentStatus: ConsentStatus;
  transcriptConsentStatus?: ConsentStatus;
  voiceCallingConsentStatus: ConsentStatus;
  isActive: boolean;
  notes?: string;
  activeMedicineCount?: number;
  consents?: Array<{
    _id: string;
    consentType: ConsentType;
    status: ConsentStatus;
    method: string;
    consentVersion?: string;
    grantedAt?: string;
    revokedAt?: string;
    updatedAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardOverviewData {
  environment: {
    voiceMode: 'mock' | 'sarvam';
    telephonyReady: boolean;
    missingTelephonyConfig: string[];
    webhookReady?: boolean;
    missingWebhookConfig?: string[];
    devDemoModeAllowed: boolean;
    mockSimulationAllowed?: boolean;
  };
  statistics: {
    totalFamilyMembers: number;
    activeFamilyMembers: number;
    activeMedicines: number;
    callsScheduledToday: number;
    callsCompleted: number;
    medicinesReportedTaken: number;
    medicinesNotTaken: number;
    unconfirmedDoses: number;
    pendingCallbacks: number;
  };
  charts: {
    dailyAdherence: Array<{
      date: string;
      label: string;
      adherencePct: number;
      taken: number;
      notTaken: number;
      unconfirmed: number;
      pending: number;
    }>;
    weeklyCallingActivity: Array<{
      date: string;
      label: string;
      total: number;
      completed: number;
      missed: number;
      callbacks: number;
    }>;
    medicineConfirmationTrends: Array<{
      label: string;
      taken: number;
      notTaken: number;
      unconfirmed: number;
    }>;
    callOutcomeDistribution: Array<{
      outcome: string;
      count: number;
    }>;
  };
  sections: {
    todaysUpcomingCalls: Array<Record<string, unknown>>;
    recentCallHistory: Array<Record<string, unknown>>;
    familyMemberStatus: Array<{
      id: string;
      fullName: string;
      relationship: string;
      preferredLanguage: string;
      timezone: string;
      isActive: boolean;
      recordingConsentStatus: ConsentStatus;
      transcriptConsentStatus?: ConsentStatus;
      voiceCallingConsentStatus: ConsentStatus;
    }>;
    pendingEscalations: Array<Record<string, unknown>>;
    missedMedicineConfirmations: Array<Record<string, unknown>>;
  };
}

