// The featured collections row offers a compact cloud entry point next to
// "Discover more collections". It must open Discover already in cloud mode,
// not land on the small list view and require a second click.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panel = readFileSync(new URL('../src/ui/stations-panel.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles/stations.css', import.meta.url), 'utf8');

test('the featured row has a cloud button beside Discover more', () => {
  assert.match(panel, /data-action="discover-cloud"/);
  assert.match(panel, /aria-label="Open collection cloud"/);
  assert.match(panel, /stations-icon-btn stations-cloud-btn/);
  assert.match(panel, /class="stations-featured-actions"/);
});

test('the cloud entry uses a node-edge graph icon, not a cloud', () => {
  assert.match(panel, /function graphIcon\(\)/);
  assert.match(panel, /\$\{graphIcon\(\)\}/);
  assert.doesNotMatch(panel, /function cloudIcon\(\)/);
  assert.match(panel, /<circle cx="12" cy="6\.8" r="2\.1"/);
});

test('the cloud button opens Discover in cloud mode', () => {
  assert.match(panel, /openDiscover\(\{ view: 'cloud' \}\)/);
  assert.match(panel, /async function openDiscover\(\{ view = 'small' \} = \{\}\)/);
  assert.match(panel, /state\.discoverView = view/);
});

test('the cloud button keeps the compact pill styling', () => {
  assert.match(css, /\.stations-featured-actions \.stations-cloud-btn/);
  assert.match(css, /\.stations-featured-actions \.stations-cloud-btn svg/);
});
