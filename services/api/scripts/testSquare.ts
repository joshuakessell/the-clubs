import { loadEnvFromDotEnvIfPresent } from '../src/env/loadEnv';
loadEnvFromDotEnvIfPresent();
import { getSquareClient } from '../src/integrations/square/squareClient';

async function run() {
  console.log('Testing Square Customer API connectivity...');
  try {
    const client = getSquareClient();
    console.log('Client initialized for environment:', process.env.SQUARE_ENVIRONMENT);
    
    const response = await client.customersApi.listCustomers();
    console.log('Connection successful!');
    console.log(`Found ${response.result.customers?.length ?? 0} customers in Sandbox.`);
    
    if (response.result.customers && response.result.customers.length > 0) {
      console.log('Sample Customer:');
      console.log(JSON.stringify(response.result.customers[0], null, 2));
    } else {
      console.log('No customers exist in the Sandbox yet. You can create them in the Developer Dashboard.');
    }
  } catch (error: any) {
    console.error('Failed to connect to Square:');
    if (error.errors) {
      console.error(error.errors);
    } else {
      console.error(error);
    }
  }
}

run();
