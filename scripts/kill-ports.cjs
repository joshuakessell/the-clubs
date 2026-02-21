#!/usr/bin/env node

/**
 * Script to kill processes running on development ports
 * Ports: 3000 (API), 5173 (customer-kiosk), 5175 (employee-kiosk), 5176 (office-dashboard)
 */

const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);
const isWindows = process.platform === 'win32';

const PORTS = [3000, 5173, 5175, 5176];
const POSTGRES_PORT = 5432;

async function killPortWindows(port) {
  try {
    // Find process using the port
    const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
    const lines = stdout.trim().split('\n');

    const pids = new Set();
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 5) {
        const pid = parts[parts.length - 1];
        if (pid && !isNaN(pid)) {
          pids.add(pid);
        }
      }
    }

    // Kill each process
    for (const pid of pids) {
      try {
        await execAsync(`taskkill /PID ${pid} /F`);
        console.log(`✓ Killed process ${pid} on port ${port}`);
      } catch (err) {
        // Process might already be dead, ignore
        if (!err.message.includes('not found')) {
          console.warn(`⚠ Could not kill process ${pid} on port ${port}: ${err.message}`);
        }
      }
    }

    if (pids.size === 0) {
      console.log(`✓ Port ${port} is already free`);
    }
  } catch (err) {
    // No process found on this port
    if (err.message.includes('findstr')) {
      console.log(`✓ Port ${port} is already free`);
    } else {
      console.warn(`⚠ Error checking port ${port}: ${err.message}`);
    }
  }
}

async function killPortUnix(port) {
  try {
    // Find process using the port
    const { stdout } = await execAsync(`lsof -ti:${port}`);
    const pids = stdout.trim().split('\n').filter(Boolean);

    // Kill each process
    for (const pid of pids) {
      try {
        await execAsync(`kill -9 ${pid}`);
        console.log(`✓ Killed process ${pid} on port ${port}`);
      } catch (err) {
        console.warn(`⚠ Could not kill process ${pid} on port ${port}: ${err.message}`);
      }
    }

    if (pids.length === 0) {
      console.log(`✓ Port ${port} is already free`);
    }
  } catch (err) {
    // No process found on this port
    if (err.code === 1 || err.message.includes('lsof')) {
      console.log(`✓ Port ${port} is already free`);
    } else {
      console.warn(`⚠ Error checking port ${port}: ${err.message}`);
    }
  }
}

async function checkPostgres() {
  try {
    if (isWindows) {
      const { stdout } = await execAsync(`netstat -ano | findstr :${POSTGRES_PORT}`);
      if (stdout.trim()) {
        console.log(`✓ PostgreSQL is running on port ${POSTGRES_PORT}`);
        return true;
      }
    } else {
      const { stdout } = await execAsync(`lsof -ti:${POSTGRES_PORT}`);
      if (stdout.trim()) {
        console.log(`✓ PostgreSQL is running on port ${POSTGRES_PORT}`);
        return true;
      }
    }
  } catch (err) {
    // Port is not in use
  }

  console.log(`\n⚠ PostgreSQL is not running on port ${POSTGRES_PORT}`);
  console.log('   Run: pnpm db:start\n');
  return false;
}

async function main() {
  console.log('Checking and closing development ports...\n');

  for (const port of PORTS) {
    if (isWindows) {
      await killPortWindows(port);
    } else {
      await killPortUnix(port);
    }
  }

  console.log('\n✓ All ports checked');
  console.log('\nChecking PostgreSQL status...');
  await checkPostgres();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
