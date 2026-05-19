const STORAGE_KEY = 'flaxia_consent_granted';

export const hasConsent = (): boolean => {
  return localStorage.getItem(STORAGE_KEY) === 'true';
};

export const saveConsent = (): void => {
  localStorage.setItem(STORAGE_KEY, 'true');
};
