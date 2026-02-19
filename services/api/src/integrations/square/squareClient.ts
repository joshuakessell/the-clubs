import { Client, Environment } from 'square';

let squareClient: Client | null = null;

function resolveEnvironment(): Environment {
  const raw = process.env.SQUARE_ENVIRONMENT?.toLowerCase();
  if (raw === 'sandbox') return Environment.Sandbox;
  return Environment.Production;
}

export function getSquareLocationId(): string {
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!locationId) {
    throw new Error('Missing SQUARE_LOCATION_ID');
  }
  return locationId;
}

export function getSquareClient(): Client {
  if (squareClient) return squareClient;

  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('Missing SQUARE_ACCESS_TOKEN');
  }

  squareClient = new Client({
    accessToken,
    environment: resolveEnvironment(),
  });

  return squareClient;
}
