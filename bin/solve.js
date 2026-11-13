#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { solve, stopWorkers } from '../src/index.js';

function readInput() {
  const args = process.argv.slice(2);
  const file = args.find((arg) => !arg.startsWith('--'));
  if (!file || file === '-') return readFileSync(0, 'utf8');
  return readFileSync(file, 'utf8');
}

const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith('--')));

let code = 0;
try {
  const payload = JSON.parse(readInput());
  let parallel;
  if (flags.has('--parallel')) parallel = true;
  if (flags.has('--sync')) parallel = false;
  const { solution, timings } = await solve(payload, { parallel });
  const total = timings.buildMs + timings.searchMs;
  process.stderr.write(
    `solved ${solution.length} challenges in ${total.toFixed(1)} ms `
    + `(build ${timings.buildMs.toFixed(1)}, search ${timings.searchMs.toFixed(1)}`
    + `${timings.parallel ? ', parallel' : ''})\n`,
  );
  process.stdout.write(`${JSON.stringify({ solution }, null, 2)}\n`);
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  code = 1;
} finally {
  await stopWorkers();
}
process.exit(code);
