import { logger } from './logger';

export function setupFetchInterceptor() {
  const originalFetch = window.fetch;

  window.fetch = async function (...args) {
    const startTime = performance.now();
    const resource = args[0];
    const config = args[1];

    let method = 'GET';
    let url = '';

    if (typeof resource === 'string') {
      url = resource;
    } else if (resource instanceof Request) {
      url = resource.url;
      method = resource.method;
    }

    if (config && config.method) {
      method = config.method;
    }

    try {
      const response = await originalFetch.apply(this, args);
      const duration = Math.round(performance.now() - startTime);

      // Only log API requests, omit local static asset fetches
      if (url.includes('/api/')) {
        if (response.ok) {
           logger.info(`[API] <= ${method} ${response.status} ${url} +${duration}ms`);
        } else {
           logger.warn(`[API] <= ${method} ${response.status} ${url} +${duration}ms`);
        }
      }

      return response;
    } catch (error: any) {
      const duration = Math.round(performance.now() - startTime);
      if (url.includes('/api/')) {
        logger.error(`[API] <= ${method} ERROR ${url} +${duration}ms`, error.message || error);
      }
      throw error;
    }
  };
}
