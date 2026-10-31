import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = fileURLToPath(new URL('../desktop/', import.meta.url));

// The packaged app.asar is assembled from `build.files` in desktop/package.json.
// Anything a bundled script requires at runtime must therefore be matched by one
// of those patterns — a module that exists in the repo but is left out of the
// allowlist makes the installed app crash on launch with
// "Cannot find module './…'" before a single window opens.
const pkg = JSON.parse(readFileSync(join(desktopDir, 'package.json'), 'utf8'));
const patterns = pkg.build?.files ?? [];
const entry = pkg.main ?? 'main.js';

/** Minimal glob matcher: supports `*` (within one segment) and `**` (any depth). */
function matchesPattern(file, pattern) {
  const re = new RegExp(`^${pattern
    .split('**')
    .map((part) => part
      .split('*')
      .map((p) => p.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
      .join('[^/]*'))
    .join('.*')}$`);
  return re.test(file);
}

function isPackaged(file) {
  return patterns.some((p) => matchesPattern(file, p));
}

/** Every `require('./x')` / `require('../x')` specifier used by a script. */
function relativeRequires(file) {
  const src = readFileSync(file, 'utf8');
  return [...src.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)].map((m) => m[1]);
}

/** Resolve `./x` the way Node does for these CommonJS scripts. */
function resolveRequire(fromFile, spec) {
  const base = join(fromFile, '..', spec);
  return [base, `${base}.js`, join(base, 'index.js')].find((c) => existsSync(c));
}

test('desktop build.files ships the entry point and its dependencies', () => {
  assert.ok(patterns.length > 0, 'desktop/package.json declares build.files');
  assert.ok(isPackaged(entry), `${entry} matches a build.files pattern`);

  const seen = new Set();
  const queue = [join(desktopDir, entry)];
  const missing = [];

  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!isPackaged(relative(desktopDir, file))) {
      missing.push(relative(desktopDir, file));
      continue;
    }
    for (const spec of relativeRequires(file)) {
      const resolved = resolveRequire(file, spec);
      assert.ok(resolved, `${spec} required by ${relative(desktopDir, file)} exists in the repo`);
      queue.push(resolved.endsWith('.js') ? resolved : `${resolved}.js`);
    }
  }

  assert.deepEqual(missing, [], 'every module reachable from main.js is packaged');
});
