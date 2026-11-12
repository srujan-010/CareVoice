import { describe, expect, it } from 'vitest';
import { sanitizePublicVoiceText } from '../../src/utils/whiteLabel';

describe('sanitizePublicVoiceText', () => {
  it('removes third-party provider names, URLs, and sandbox terminology from user-facing text', () => {
    const raw =
      'Sarvam Vobiz outbound API at https://apps.sarvam.ai/api/outbounds/v1 returned an error while checking Mock Sandbox mode.';
    const sanitized = sanitizePublicVoiceText(raw);

    expect(sanitized).not.toMatch(/sarvam/i);
    expect(sanitized).not.toMatch(/vobiz/i);
    expect(sanitized).not.toMatch(/apps\.sarvam\.ai/i);
    expect(sanitized).not.toMatch(/mock sandbox/i);
    expect(sanitized).toContain('CareVoice');
    expect(sanitized).toContain('Test Environment');
  });

  it('white-labels Sarvam Instant Outbound and internal env variable names', () => {
    const raw =
      'SARVAM_CONNECTION_ID or SARVAM_AGENT_VERSION is invalid for Sarvam Instant Outbound.';
    const sanitized = sanitizePublicVoiceText(raw);

    expect(sanitized).not.toMatch(/sarvam/i);
    expect(sanitized).not.toMatch(/instant outbound/i);
    expect(sanitized).toContain('configured calling connection');
    expect(sanitized).toContain('configured assistant version');
  });
});

