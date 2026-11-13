import { describe, expect, it } from 'vitest';
import { isAllowedOrigin } from '../../src/app';

describe('CORS Origin Validation', () => {
  const configured = 'http://localhost:3000,https://carevoice.health';

  it('allows non-browser, server-to-server, and same-origin requests (undefined origin)', () => {
    expect(isAllowedOrigin(undefined, configured)).toBe(true);
    expect(isAllowedOrigin('', configured)).toBe(true);
  });

  it('allows exact matches from configured FRONTEND_URL', () => {
    expect(isAllowedOrigin('http://localhost:3000', configured)).toBe(true);
    expect(isAllowedOrigin('http://localhost:3000/', configured)).toBe(true);
    expect(isAllowedOrigin('https://carevoice.health', configured)).toBe(true);
    expect(isAllowedOrigin('https://carevoice.health/', configured)).toBe(true);
  });

  it('allows wildcard * configured in FRONTEND_URL', () => {
    expect(isAllowedOrigin('https://any-domain.com', '*')).toBe(true);
    expect(isAllowedOrigin('https://any-domain.com', 'http://localhost:3000,*')).toBe(true);
  });

  it('automatically allows any Vercel deployment origin (production, branch, preview)', () => {
    expect(isAllowedOrigin('https://carevoice.vercel.app', configured)).toBe(true);
    expect(isAllowedOrigin('https://carevoice-v2h2.vercel.app', configured)).toBe(true);
    expect(isAllowedOrigin('https://carevoice-git-main-srujan.vercel.app', configured)).toBe(true);
    expect(isAllowedOrigin('https://preview-1234.vercel.app', configured)).toBe(true);
  });

  it('automatically allows any local development origin on any port', () => {
    expect(isAllowedOrigin('http://localhost:3000', configured)).toBe(true);
    expect(isAllowedOrigin('http://localhost:3001', configured)).toBe(true);
    expect(isAllowedOrigin('http://localhost:4000', configured)).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:3000', configured)).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:3001', configured)).toBe(true);
  });

  it('rejects unauthorized third-party origins', () => {
    expect(isAllowedOrigin('https://evil-attacker.com', configured)).toBe(false);
    expect(isAllowedOrigin('https://phishing-carevoice.com', configured)).toBe(false);
    expect(isAllowedOrigin('https://notvercel.app.evil.com', configured)).toBe(false);
    expect(isAllowedOrigin('http://localhost.evil.com', configured)).toBe(false);
  });
});

