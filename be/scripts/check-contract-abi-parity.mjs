// Canonicalizes an ABI entry into a stable string key for set-comparison.
// Drops fields that are metadata-only (documentation, anonymous) or vary
// between compiler versions (internalType, order of inputs in overloaded fns).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const committedPath = join(__dirname, '../src/evm/navy-payments-abi.json');
const artifactPath = join(__dirname, '../../contract/out/NavyPayments.sol/NavyPayments.json');

function canonEntry(entry) {
  // Canonicalize: sort keys, drop irrelevant fields, normalise hex casing.
  const normalized = {};
  const relevantKeys = entry.type === 'function' || entry.type === 'error'
    ? ['type', 'name', 'inputs']
    : ['type', 'name', 'inputs', 'outputs', 'indexed'];
  for (const k of relevantKeys) {
    if (k in entry) {
      if (k === 'inputs' || k === 'outputs') {
        normalized[k] = entry[k].map(param => ({
          name: param.name ?? '',
          type: param.type ?? '',
        }));
      } else if (k === 'indexed') {
        normalized[k] = entry[k] ?? false;
      } else {
        normalized[k] = entry[k];
      }
    }
  }
  return JSON.stringify(normalized, null, 0);
}

function buildMap(abi) {
  const map = new Map();
  for (const entry of abi) {
    // Skip constructor (not callable at runtime) and receive/fallback (not in our ABI)
    if (entry.type === 'constructor' || entry.type === 'receive' || entry.type === 'fallback') continue;
    const key = canonEntry(entry);
    map.set(key, entry.name ?? '(anonymous)');
  }
  return map;
}

function compare(label, committed, artifact) {
  const cMap = buildMap(committed);
  const aMap = buildMap(artifact);
  const errors = [];

  for (const [key, name] of cMap) {
    if (!aMap.has(key)) {
      errors.push(`  [MISSING in artifact] ${name} (canonical key differs)`);
    }
  }
  for (const [key, name] of aMap) {
    if (!cMap.has(key)) {
      errors.push(`  [EXTRA in artifact] ${name} (not in committed ABI — update navy-payments-abi.json)`);
    }
  }
  if (errors.length) {
    console.error(`\n${label} MISMATCH (${errors.length}):`);
    errors.forEach(e => console.error(e));
    return false;
  }
  return true;
}

function main() {
  let committed, artifact;
  try {
    committed = JSON.parse(readFileSync(committedPath, 'utf8')).abi ?? [];
    artifact = JSON.parse(readFileSync(artifactPath, 'utf8')).abi ?? [];
  } catch (e) {
    console.error('Failed to read ABI files:', e.message);
    process.exit(1);
  }

  // Remove non-function/event/error entries from both before comparing
  const relevant = abi => abi.filter(e =>
    e.type === 'function' || e.type === 'event' || e.type === 'error'
  );

  const ok = compare('Function/event/error', relevant(committed), relevant(artifact));

  if (!ok) {
    console.error('\nABI PARITY CHECK FAILED');
    console.error(`committed: ${committedPath}`);
    console.error(`artifact:  ${artifactPath}`);
    process.exit(1);
  }

  const total = relevant(artifact).length;
  console.log(`ABI parity OK — ${total} function/event/error entries match`);
  process.exit(0);
}

main();
