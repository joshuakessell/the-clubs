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
      
      const regex1 = /^\s*if\s*\(!request\.staff\)\s*return\s*reply\.status\(401\)\.send\(\{.*?\}\);[\r\n]+/gm;
      const regex2 = /^\s*if\s*\(!request\.staff\)\s*\{\s*return\s*reply\.status\(401\)\.send\(\{.*?\}\);\s*\}[\r\n]+/gm;
      
      let newContent = content.replace(regex1, '').replace(regex2, '');
      if (content !== newContent) {
        fs.writeFileSync(fullPath, newContent, 'utf8');
        console.log(`Stripped from ${fullPath}`);
      }
    }
  }
}

targetDirs.forEach(processDir);
