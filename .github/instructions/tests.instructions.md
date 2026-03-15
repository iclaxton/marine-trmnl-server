---
name: 'Test Standards'
description: 'Conventions for writing tests in this project'
applyTo: 'test/**/*.test.js'
---

# Test Standards

## Framework
Use `node:test` built-in only. Never import Jest, Mocha, Vitest, Sinon, or any third-party test library.

```js
import { test, describe, before, after, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
```

Run all tests with:
```
npm test
# or
node --test test/**/*.test.js
```

## Unit Tests (`test/unit/`)
- Import the module under test directly from `../../src/`
- No filesystem, network, or external service access
- Use simple function inputs and assert return values

```js
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { converters } from '../../src/utils.js';

describe('mps_to_kts', () => {
  test('converts metres/second to knots', () => {
    assert.ok(Math.abs(converters.mps_to_kts(1) - 1.94384) < 0.00001);
  });
});
```

## Integration Tests (`test/integration/`)
- Always instantiate `createApp()` with injected mock deps — never start a real server on a port
- Use `fastify.inject()` for all HTTP calls

```js
import { createApp } from '../../src/app.js';

const mockDeps = {
  fetchAllMetrics: async () => ({}),
  renderDashboard: async () => '<html></html>',
  renderSetupScreen: async () => '<html></html>',
  screenshotHtml: async () => {},
  toDisplayImage: async () => {},
  displayExtension: () => 'bmp',
  checkImageMagick: async () => {},
  devices: {
    getOrCreate: (mac) => ({ mac, friendly_id: 'TEST', api_key: 'key' }),
    get: () => null,
    updateTelemetry: () => {},
    updateCapabilities: () => {},
    list: () => [],
  },
};

const { fastify } = createApp({
  deps: mockDeps,
  paths: { screensDir: tmpDir, DASHBOARD_RAW: '…', DASHBOARD_DISPLAY: '…', SETUP_RAW: '…', SETUP_DISPLAY: '…' },
  cfg: { byosConfig: { baseUrl: 'http://localhost:3001' }, serverConfig: {}, displayConfig: { bitDepth: 1, refreshIntervalSeconds: 900 }, vesselConfig: { name: 'TEST' } },
  initialState: { dashboardReady: true },
});
```

## Temporary Files
- Create temp dirs with `mkdtempSync(join(tmpdir(), 'prefix-'))`
- Always clean up in `after(() => rmSync(tmpDir, { recursive: true, force: true }))`

## Assertions
- Prefer `assert.strictEqual`, `assert.deepStrictEqual`, `assert.ok`, `assert.rejects`
- Use `assert.match(string, /regex/)` for partial string checks
- Do not use `assert.equal` (loose equality)
