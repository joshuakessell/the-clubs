const http = require('http');

async function test() {
  const deviceId = "device-12345";
  console.log("Logging in as Manager Club...");
  const loginBody = JSON.stringify({ staffLookup: "Manager Club", deviceId, pin: "123456" });
  
  const req = http.request(
    'http://localhost:5175/api/v1/auth/login-pin',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(loginBody)
      }
    },
    (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          console.error("Login failed!", res.statusCode, data);
          return;
        }
        const token = JSON.parse(data).sessionToken;
        console.log("Token:", token.substring(0, 10) + '...');
        
        console.log("\nSearching for 'chr'...");
        const searchReq = http.request(
          'http://localhost:5175/api/v1/customers/search?q=chr&limit=10',
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`
            }
          },
          (searchRes) => {
            let searchData = '';
            searchRes.on('data', chunk => searchData += chunk);
            searchRes.on('end', () => {
              console.log("Search Status:", searchRes.statusCode);
              console.log("Search Data:", searchData);
            });
          }
        );
        searchReq.end();
      });
    }
  );
  req.write(loginBody);
  req.end();
}
test();
