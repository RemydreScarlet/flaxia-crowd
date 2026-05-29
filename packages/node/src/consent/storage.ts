const STORAGE_KEY = 'flaxia_consent_granted';
const STORAGE_EXPIRY_KEY = 'flaxia_consent_expiry';
const CONSENT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30日

export const hasConsent = (): boolean => {
  const granted = localStorage.getItem(STORAGE_KEY) === 'true';
  if (!granted) return false;

  const expiry = localStorage.getItem(STORAGE_EXPIRY_KEY);
  if (expiry) {
    const expiryMs = parseInt(expiry, 10);
    if (Date.now() > expiryMs) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_EXPIRY_KEY);
      return false;
    }
  }

  return true;
};

export const saveConsent = (): void => {
  localStorage.setItem(STORAGE_KEY, 'true');
  localStorage.setItem(STORAGE_EXPIRY_KEY, String(Date.now() + CONSENT_TTL_MS));
};
