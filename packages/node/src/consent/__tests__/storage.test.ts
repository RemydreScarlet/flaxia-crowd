import { describe, it, expect, beforeEach } from 'vitest';
import { hasConsent, saveConsent } from '../storage';

describe('consent/storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should manage consent state correctly', () => {
    expect(hasConsent()).toBe(false);
    saveConsent();
    expect(hasConsent()).toBe(true);
  });
});
