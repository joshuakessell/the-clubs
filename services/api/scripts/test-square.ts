import { createSquareOrder } from '../src/services/squareSyncService';

async function run() {
  try {
    const res = await createSquareOrder({
      squareCustomerId: null,
      lineItems: [
        { name: 'Test Item', amountCents: 1500, note: 'Test Note' }
      ]
    });
    console.log('Success:', res);
  } catch (err: any) {
    console.error('Crash Detected:', err.message);
  }
}

run();
