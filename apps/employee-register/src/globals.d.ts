/**
 * Global type augmentation for the `__authToken` property
 * set on `window` / `globalThis` by the App component on login.
 */
declare global {
  // eslint-disable-next-line no-var
  var __authToken: string | null | undefined;
}

export {};
