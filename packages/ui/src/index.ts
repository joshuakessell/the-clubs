// Stores
export { useAuthStore } from './stores/authStore';
export { useSessionGuard } from './hooks/useSessionGuard';
export type { StaffSession } from './stores/authStore';

// Components
export { ErrorBoundary } from './components/ErrorBoundary';
export { LockScreen } from './components/LockScreen';
export { ChangePinScreen } from './components/ChangePinScreen';
export { PinInput } from './components/PinInput';
export { Numpad } from './components/Numpad';
export { Badge } from './components/Badge';
export { Button } from './components/Button';
export { Alert } from './components/Alert';
export { Spinner } from './components/Spinner';

// WebAuthn
export {
  isWebAuthnSupported,
  requestAuthenticationOptions,
  getCredential,
  authenticationCredentialToJSON,
  verifyAuthentication,
} from './webauthn/client';
