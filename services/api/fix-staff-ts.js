const fs = require('fs');
const path = require('path');

const targetDirs = [
  path.join(__dirname, 'src/routes/checkin'),
  path.join(__dirname, 'src/routes/checkout')
];

function processDir(dir) {
  if (!fs.existsSync(dir)) return;
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    if (fs.statSync(fullPath).isDirectory()) {
      processDir(fullPath);
    } else if (fullPath.endsWith('.ts')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      
      // Look for request.staff.something and replace with request.staff!.something
      // Note: Do not replace if it already has '!'
      const regex = /request\.staff\.(staffId|name|role)/g;
      
      let newContent = content.replace(regex, 'request.staff!.$1');
      if (content !== newContent) {
        fs.writeFileSync(fullPath, newContent, 'utf8');
        console.log(`Added non-null assertions to ${fullPath}`);
      }
    }
  }
}

targetDirs.forEach(processDir);
