async function run() {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const env = process.env.SQUARE_ENVIRONMENT || 'sandbox';
  const baseUrl = env === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';

  try {
    const res = await fetch(`${baseUrl}/v2/locations`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Square-Version': '2023-12-13'
      }
    });
    console.log('Status:', res.status);
    const data = await res.json();
    console.log('Locations:', JSON.stringify(data, null, 2));
  } catch (err: any) {
    console.error('Crash Detected:', err.message);
  }
}

run();
