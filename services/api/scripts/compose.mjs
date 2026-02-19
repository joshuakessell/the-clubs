#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, '..');

function run(cmd, args) {
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: apiRoot,
  });
  return res.status ?? 1;
}

function canRun(cmd, args) {
  const res = spawnSync(cmd, args, {
    stdio: 'ignore',
    cwd: apiRoot,
  });
  return (res.status ?? 1) === 0;
}

function getComposeRunner() {
  if (canRun('docker', ['compose', 'version'])) {
    return (args) => run('docker', ['compose', ...args]);
  }
  if (canRun('docker-compose', ['version'])) {
    return (args) => run('docker-compose', args);
  }
  return null;
}

const compose = getComposeRunner();
if (!compose) {
  console.error(
    "ERROR: Docker Compose not found. Install Docker Desktop (includes 'docker compose') or install 'docker-compose'."
  );
  process.exit(1);
}

const [command, ...rest] = process.argv.slice(2);
if (!command) {
  console.error('Usage: node scripts/compose.mjs <up|down|reset> [...args]');
  process.exit(1);
}

if (command === 'reset') {
  const downStatus = compose(['down', '-v']);
  if (downStatus !== 0) process.exit(downStatus);
  const upStatus = compose(['up', '-d']);
  process.exit(upStatus);
}

process.exit(compose([command, ...rest]));
