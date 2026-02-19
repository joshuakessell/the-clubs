#!/usr/bin/env node
/**
 * Cross-platform database setup script.
 * Detects the platform and runs the appropriate setup script.
 */

import { execSync } from 'child_process';
import { platform } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const scriptsDir = join(__dirname, '..', 'scripts');

const osPlatform = platform();

if (osPlatform === 'win32') {
  // Windows - use PowerShell script
  console.log('Detected Windows, using PowerShell script...');
  try {
    execSync(`powershell -ExecutionPolicy Bypass -File "${join(scriptsDir, 'setup-db.ps1')}"`, {
      stdio: 'inherit',
      cwd: join(__dirname, '..'),
    });
  } catch (error) {
    console.error('Failed to run PowerShell script:', error);
    process.exit(1);
  }
} else {
  // Unix-like - use bash script
  console.log('Detected Unix-like system, using bash script...');
  try {
    execSync(`bash "${join(scriptsDir, 'setup-db.sh')}"`, {
      stdio: 'inherit',
      cwd: join(__dirname, '..'),
    });
  } catch (error) {
    console.error('Failed to run bash script:', error);
    process.exit(1);
  }
}
