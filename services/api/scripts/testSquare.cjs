const { loadEnvFromDotEnvIfPresent } = require('../dist/env/loadEnv.js');
loadEnvFromDotEnvIfPresent();

async function run() {
  console.log('Testing Square Customer API connectivity using native fetch...');
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) {
    console.error('Failed to find SQUARE_ACCESS_TOKEN');
    return;
  }
  
  try {
    const url = 'https://connect.squareupsandbox.com/v2/customers';
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Square-Version': '2023-12-13'
      }
    });
    
    const data = await response.json();
    if (!response.ok) {
      console.error('Failed to connect to Square:');
      console.error(JSON.stringify(data, null, 2));
      return;
    }

    console.log('Connection successful!');
    console.log(`Found ${data.customers?.length ?? 0} customers in Sandbox.`);
    
    if (data.customers && data.customers.length > 0) {
      console.log('Sample Customer:');
      console.log(JSON.stringify(data.customers[0], null, 2));
    } else {
      console.log('No customers exist in the Sandbox yet. You can create them in the Developer Dashboard.');
    }
  } catch (error) {
    console.error('Network request failed:', error);
  }
}

run();
