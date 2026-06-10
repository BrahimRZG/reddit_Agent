/**
 * Credential storage for the Reddit Marketing Agent extension.
 * Spec 02: Worker Auth & Token Lifecycle.
 */

export const CREDENTIAL_KEYS = {
  INSTALL_ID: 'rma_install_id',
  INSTALL_TOKEN: 'rma_install_token',
} as const;

export interface InstallCredentials {
  installId: string;
  installToken: string;
}

export async function getCredentials(): Promise<InstallCredentials | null> {
  try {
    const result = await chrome.storage.local.get([
      CREDENTIAL_KEYS.INSTALL_ID,
      CREDENTIAL_KEYS.INSTALL_TOKEN,
    ]);
    const id = result[CREDENTIAL_KEYS.INSTALL_ID];
    const token = result[CREDENTIAL_KEYS.INSTALL_TOKEN];
    if (typeof id === 'string' && id.length > 0 && typeof token === 'string' && token.length > 0) {
      return { installId: id, installToken: token };
    }
    return null;
  } catch {
    return null;
  }
}

export async function setCredentials(credentials: { installId: string; token: string }): Promise<void> {
  const { installId, token } = credentials;
  if (typeof installId !== 'string' || installId.trim().length === 0) {
    throw new Error('installId must be a non-empty string.');
  }
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new Error('token must be a non-empty string.');
  }
  try {
    await chrome.storage.local.set({
      [CREDENTIAL_KEYS.INSTALL_ID]: installId.trim(),
      [CREDENTIAL_KEYS.INSTALL_TOKEN]: token.trim(),
    });
  } catch {
    throw new Error('Failed to store credentials.');
  }
}

export async function clearCredentials(): Promise<void> {
  await chrome.storage.local.remove([CREDENTIAL_KEYS.INSTALL_ID, CREDENTIAL_KEYS.INSTALL_TOKEN]);
}

export async function hasCredentials(): Promise<boolean> {
  const creds = await getCredentials();
  return creds !== null;
}
