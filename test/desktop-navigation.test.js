import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const realRequire = createRequire(import.meta.url);
const { isAllowedExternalUrl } = realRequire('../desktop/url-validation.js');

test('isAllowedExternalUrl matches the shared validator contract', () => {
  assert.equal(isAllowedExternalUrl('https://example.com'), true);
  assert.equal(isAllowedExternalUrl('custom-protocol:payload'), false);
  assert.equal(isAllowedExternalUrl('file:///x'), false);
});

test('will-navigate rejects a non-http(s) scheme before it reaches shell.openExternal', async () => {
  const opened = [];
  const handlers = {};
  class FakeWebContents {
    on(name, fn) { (handlers[name] ??= []).push(fn); }
    setWindowOpenHandler(fn) { handlers.windowOpen = fn; }
    send() {}
    openDevTools() {}
  }
  class FakeWindow {
    constructor() { this.webContents = new FakeWebContents(); }
    loadURL() {}
    once() {}
    on() {}
    show() {}
    close() {}
    hide() {}
    setMinimumSize() {}
    setResizable() {}
    setAlwaysOnTop() {}
    setBounds() {}
    getBounds() { return { width: 380, height: 760, x: 0, y: 0 }; }
    getMinimumSize() { return [380, 480]; }
    isAlwaysOnTop() { return false; }
  }
  const electron = {
    app: { whenReady: () => Promise.resolve(), on() {}, getLoginItemSettings: () => ({ openAtLogin: false }), setLoginItemSettings() {}, getVersion: () => '1.0.0' },
    BrowserWindow: FakeWindow,
    shell: { openExternal: (url) => { opened.push(url); return Promise.resolve(); } },
    Tray: class {}, Menu: { buildFromTemplate: () => ({ popup() {} }) },
    nativeImage: { createFromDataURL: () => ({ resize: () => ({}) }) },
    ipcMain: { handle() {} }, dialog: {}, screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
  };
  const fakeRequire = (id) => id === 'electron' ? electron
    : id === './tray' ? { createTray() {}, updateTrayIcon() {}, updateTrayMenu() {}, destroyTray() {} }
    : id === './url-validation' ? realRequire('../desktop/url-validation.js')
    : realRequire(id);
  const src = readFileSync(new URL('../desktop/main.js', import.meta.url), 'utf8');
  const fn = new vm.Script(`(function (require, module, exports, __dirname, process) { ${src}\n})`).runInThisContext();
  fn(fakeRequire, { exports: {} }, {}, 'desktop', { platform: 'win32', env: {} });
  await Promise.resolve();
  const willNav = handlers['will-navigate']?.[0];
  assert.ok(willNav, 'will-navigate handler registered');
  const e = { preventDefault: () => { e.prevented = true; } };
  willNav(e, 'custom-protocol:payload');
  assert.equal(opened.length, 0, 'non-http(s) scheme must not reach the shell');
  assert.equal(e.prevented, true);
  willNav(e, 'https://example.com');
  assert.deepEqual(opened, ['https://example.com']);
});
