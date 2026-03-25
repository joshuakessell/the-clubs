import { createSquareCustomer } from '../src/services/squareSyncService';

async function run() {
  try {
    console.log('Attempting to create Square Customer...');
    const id = await createSquareCustomer({
      firstName: 'Test',
      lastName: 'Customer',
      dob: '1990-01-01'
    });
    console.log('Result ID:', id);
  } catch (err: any) {
    console.error('Crash Detected:', err.message);
  }
}

run();
