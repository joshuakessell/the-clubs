import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { logger } from '../utils/logger';

export function RouteLogger() {
  const location = useLocation();

  useEffect(() => {
    logger.info(`[Router] Navigation -> ${location.pathname}${location.search}${location.hash}`);
  }, [location]);

  return null;
}
