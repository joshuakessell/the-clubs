import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const distDir = path.resolve(process.cwd(), 'dist');

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(fullPath);
      continue;
    }
    yield fullPath;
  }
}

const IMPORT_FROM_RE = /\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT_RE = /\bimport\s+['"](\.{1,2}\/[^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

function isOkRelativeSpecifier(spec) {
  // For Node ESM, relative specifiers must include an explicit extension.
  // We allow .js (expected), plus a couple standard runtime extensions.
  return /\.(?:js|json|node)(?:[?#].*)?$/.test(spec);
}

function findBadSpecifiers(sourceText) {
  /** @type {{ spec: string; index: number }[]} */
  const bad = [];

  for (const re of [IMPORT_FROM_RE, SIDE_EFFECT_IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(sourceText))) {
      const spec = match[1];
      if (!isOkRelativeSpecifier(spec)) bad.push({ spec, index: match.index });
    }
  }

  return bad;
}

async function main() {
  /** @type {{ file: string; spec: string }[]} */
  const failures = [];

  try {
    // Fail fast if dist/ doesn't exist (e.g. check run before build).
    await readdir(distDir);
  } catch {
    console.error(`[check:esm] dist/ not found at ${distDir}. Run build first.`);
    process.exit(1);
  }

  for await (const file of walk(distDir)) {
    if (!file.endsWith('.js')) continue;
    const text = await readFile(file, 'utf8');
    const bad = findBadSpecifiers(text);
    for (const { spec } of bad) failures.push({ file, spec });
  }

  if (failures.length > 0) {
    console.error(
      '[check:esm] Found extensionless relative import/export specifiers in dist output:'
    );
    for (const { file, spec } of failures) {
      console.error(`- ${path.relative(process.cwd(), file)}: "${spec}"`);
    }
    console.error(
      '[check:esm] Fix by adding explicit ".js" extensions to the corresponding TS relative imports/exports.'
    );
    process.exit(1);
  }

  console.log(
    '[check:esm] OK (all relative specifiers in dist/**/*.js include an explicit extension).'
  );
}

await main();
