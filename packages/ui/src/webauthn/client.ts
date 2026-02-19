/**
 * Canonical WebAuthn client utilities (passkeys).
 *
 * Shared across apps to ensure consistent:
 * - base64url <-> ArrayBuffer conversions
 * - request/verify payload shapes
 * - error handling patterns
 */

const DEFAULT_API_BASE = '/api';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getErrorMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const err = value['error'];
  const msg = value['message'];
  if (typeof err === 'string' && err.trim()) return err;
  if (typeof msg === 'string' && msg.trim()) return msg;
  return undefined;
}

export interface RegistrationOptions {
  rp: { name: string; id: string };
  user: { id: string; name: string; displayName: string };
  challenge: string;
  pubKeyCredParams: PublicKeyCredentialParameters[];
  timeout: number;
  attestation: AttestationConveyancePreference;
  excludeCredentials?: Array<{
    id: string;
    type: 'public-key';
    transports?: AuthenticatorTransport[];
  }>;
  authenticatorSelection?: {
    authenticatorAttachment?: AuthenticatorAttachment;
    userVerification: UserVerificationRequirement;
  };
}

export interface AuthenticationOptions {
  challenge: string;
  timeout: number;
  rpId: string;
  allowCredentials?: Array<{
    id: string;
    type: 'public-key';
    transports?: AuthenticatorTransport[];
  }>;
  userVerification: UserVerificationRequirement;
}

export type RegistrationCredentialJSON = ReturnType<typeof credentialToJSON>;
export type AuthenticationCredentialJSON = ReturnType<typeof authenticationCredentialToJSON>;

export type VerifyAuthenticationResult = {
  verified: boolean;
  staffId: string;
  name: string;
  role: string;
  sessionToken: string;
};

export type VerifyRegistrationResult = { verified: boolean; credentialId: string };

export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.credentials !== 'undefined' &&
    typeof navigator.credentials.create !== 'undefined' &&
    typeof navigator.credentials.get !== 'undefined'
  );
}

export async function requestRegistrationOptions(
  staffId: string,
  deviceId: string,
  apiBase: string = DEFAULT_API_BASE
): Promise<RegistrationOptions> {
  const response = await fetch(`${apiBase}/v1/auth/webauthn/registration/options`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ staffId, deviceId }),
  });

  if (!response.ok) {
    const errorPayload: unknown = await response.json().catch(() => null);
    throw new Error(getErrorMessage(errorPayload) || 'Failed to get registration options');
  }

  const data: unknown = await response.json();
  return data as RegistrationOptions;
}

export async function requestAuthenticationOptions(
  staffLookup: string,
  deviceId: string,
  apiBase: string = DEFAULT_API_BASE
): Promise<AuthenticationOptions> {
  const response = await fetch(`${apiBase}/v1/auth/webauthn/authentication/options`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ staffLookup, deviceId }),
  });

  if (!response.ok) {
    const errorPayload: unknown = await response.json().catch(() => null);
    throw new Error(getErrorMessage(errorPayload) || 'Failed to get authentication options');
  }

  const data: unknown = await response.json();
  return data as AuthenticationOptions;
}

export async function createCredential(options: RegistrationOptions): Promise<PublicKeyCredential> {
  const challengeBuffer = base64UrlToUint8Array(options.challenge);
  const userIdBuffer = base64UrlToUint8Array(options.user.id);

  const excludeCredentials: PublicKeyCredentialDescriptor[] | undefined =
    options.excludeCredentials?.map((cred) => ({
      ...cred,
      // WebAuthn types are strict about ArrayBuffer (not ArrayBufferLike).
      id: toArrayBuffer(base64UrlToUint8Array(cred.id)),
    }));

  const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
    // WebAuthn types are strict about ArrayBuffer (not ArrayBufferLike).
    challenge: toArrayBuffer(challengeBuffer),
    rp: options.rp,
    user: {
      // WebAuthn types are strict about ArrayBuffer (not ArrayBufferLike).
      id: toArrayBuffer(userIdBuffer),
      name: options.user.name,
      displayName: options.user.displayName,
    },
    pubKeyCredParams: options.pubKeyCredParams,
    timeout: options.timeout,
    attestation: options.attestation,
    excludeCredentials,
    authenticatorSelection: options.authenticatorSelection,
  };

  const credential = (await navigator.credentials.create({
    publicKey: publicKeyCredentialCreationOptions,
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error('Failed to create credential');
  }

  return credential;
}

export async function getCredential(options: AuthenticationOptions): Promise<PublicKeyCredential> {
  const challengeBuffer = base64UrlToUint8Array(options.challenge);
  const allowCredentials: PublicKeyCredentialDescriptor[] | undefined =
    options.allowCredentials?.map((cred) => ({
      ...cred,
      // WebAuthn types are strict about ArrayBuffer (not ArrayBufferLike).
      id: toArrayBuffer(base64UrlToUint8Array(cred.id)),
    }));

  const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
    // WebAuthn types are strict about ArrayBuffer (not ArrayBufferLike).
    challenge: toArrayBuffer(challengeBuffer),
    timeout: options.timeout,
    rpId: options.rpId,
    allowCredentials,
    userVerification: options.userVerification,
  };

  const credential = (await navigator.credentials.get({
    publicKey: publicKeyCredentialRequestOptions,
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error('Failed to get credential');
  }

  return credential;
}

export function credentialToJSON(credential: PublicKeyCredential): {
  id: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    attestationObject: string;
  };
  type: string;
} {
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: arrayBufferToBase64URL(credential.rawId),
    response: {
      clientDataJSON: arrayBufferToBase64URL(response.clientDataJSON),
      attestationObject: arrayBufferToBase64URL(response.attestationObject),
    },
    type: credential.type,
  };
}

export function authenticationCredentialToJSON(credential: PublicKeyCredential): {
  id: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle: string | null;
  };
  type: string;
} {
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: arrayBufferToBase64URL(credential.rawId),
    response: {
      clientDataJSON: arrayBufferToBase64URL(response.clientDataJSON),
      authenticatorData: arrayBufferToBase64URL(response.authenticatorData),
      signature: arrayBufferToBase64URL(response.signature),
      userHandle: response.userHandle ? arrayBufferToBase64URL(response.userHandle) : null,
    },
    type: credential.type,
  };
}

export async function verifyRegistration(
  staffId: string,
  deviceId: string,
  credentialResponse: RegistrationCredentialJSON,
  apiBase: string = DEFAULT_API_BASE
): Promise<VerifyRegistrationResult> {
  const response = await fetch(`${apiBase}/v1/auth/webauthn/registration/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ staffId, deviceId, credentialResponse }),
  });

  if (!response.ok) {
    const errorPayload: unknown = await response.json().catch(() => null);
    throw new Error(getErrorMessage(errorPayload) || 'Registration verification failed');
  }

  const data: unknown = await response.json();
  return data as VerifyRegistrationResult;
}

export async function verifyAuthentication(
  deviceId: string,
  credentialResponse: AuthenticationCredentialJSON,
  apiBase: string = DEFAULT_API_BASE
): Promise<VerifyAuthenticationResult> {
  const response = await fetch(`${apiBase}/v1/auth/webauthn/authentication/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, credentialResponse }),
  });

  if (!response.ok) {
    const errorPayload: unknown = await response.json().catch(() => null);
    throw new Error(getErrorMessage(errorPayload) || 'Authentication verification failed');
  }

  const data: unknown = await response.json();
  return data as VerifyAuthenticationResult;
}

export async function requestReauthAuthenticationOptions(
  sessionToken: string,
  deviceId: string,
  apiBase: string = DEFAULT_API_BASE
): Promise<AuthenticationOptions> {
  const response = await fetch(`${apiBase}/v1/auth/reauth/webauthn/options`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
      'x-device-id': deviceId,
    },
  });

  if (!response.ok) {
    const errorPayload: unknown = await response.json().catch(() => null);
    throw new Error(getErrorMessage(errorPayload) || 'Failed to get WebAuthn options');
  }

  const data: unknown = await response.json();
  return data as AuthenticationOptions;
}

export async function verifyReauthAuthentication(
  sessionToken: string,
  deviceId: string,
  credentialResponse: AuthenticationCredentialJSON,
  apiBase: string = DEFAULT_API_BASE
): Promise<{ success: boolean; reauthOkUntil: string }> {
  const response = await fetch(`${apiBase}/v1/auth/reauth/webauthn/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({
      credentialResponse,
      deviceId,
    }),
  });

  if (!response.ok) {
    const errorPayload: unknown = await response.json().catch(() => null);
    throw new Error(getErrorMessage(errorPayload) || 'WebAuthn verification failed');
  }

  const data: unknown = await response.json();
  return data as { success: boolean; reauthOkUntil: string };
}

function base64UrlToUint8Array(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * WebAuthn TS DOM types expect ArrayBuffer (not ArrayBufferLike / SharedArrayBuffer),
 * so we defensively copy bytes into a fresh ArrayBuffer.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return ab;
}

function arrayBufferToBase64URL(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
