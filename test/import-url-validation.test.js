import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExport } from '../src/data/import-export.js';

test('an imported station with a non-http(s) stream URL is rejected', () => {
  const out = parseExport(JSON.stringify({ version: '2.0', listName: 'X', stations: [{ id: 's1', name: 'Bad', url: 'javascript:alert(1)' }] }));
  assert.equal(out.list.stations.length, 0);
});
