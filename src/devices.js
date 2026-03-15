/**
 * devices.js — simple file-backed device registry.
 *
 * BYOS devices identify themselves via the `ID` HTTP header (MAC address).
 * On first contact (/api/setup) we create a record, generate a stable
 * friendly_id and api_key, and persist to data/devices.json.
 *
 * This is intentionally simple for a single-vessel use case.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = resolve(__dirname, '../data');

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create an independent device store backed by a JSON file in `storeDir`.
 * Use this in tests to point at a temp directory.
 *
 * @param {string} storeDir  — directory that will contain devices.json
 * @param {string} [vesselPrefix='HEBE'] — prefix for auto-generated friendly IDs
 * @returns {{ getOrCreate, get, updateTelemetry, list }}
 */
export function createDeviceStore(storeDir, vesselPrefix = 'HEBE') {
  const storePath = join(storeDir, 'devices.json');

  function load() {
    if (!existsSync(storePath)) return {};
    try {
      return JSON.parse(readFileSync(storePath, 'utf8'));
    } catch {
      return {};
    }
  }

  function save(store) {
    mkdirSync(storeDir, { recursive: true });
    writeFileSync(storePath, JSON.stringify(store, null, 2));
  }

  return {
    /**
     * Store hardware capabilities reported by the device firmware headers.
     * Called on every /api/setup and /api/display request.
     *
     * @param {string} macAddress
     * @param {{ bitDepth?: number, width?: number, height?: number, userAgent?: string }} capabilities
     */
    updateCapabilities(macAddress, capabilities) {
      const store = load();
      if (!store[macAddress]) return;
      store[macAddress].capabilities = {
        ...store[macAddress].capabilities,
        ...Object.fromEntries(
          Object.entries(capabilities).filter(([, v]) => v !== null && v !== undefined)
        ),
      };
      save(store);
    },

    /**
     * Get an existing device record or create a new one for the given MAC.
     * @param {string} macAddress
     * @returns {{ mac, friendlyId, apiKey, createdAt }}
     */
    getOrCreate(macAddress) {
      const store = load();
      if (!store[macAddress]) {
        const count = Object.keys(store).length + 1;
        store[macAddress] = {
          mac:        macAddress,
          friendlyId: `${vesselPrefix}${String(count).padStart(2, '0')}`,
          apiKey:     randomBytes(16).toString('hex'),
          createdAt:  new Date().toISOString(),
        };
        save(store);
      }
      return store[macAddress];
    },

    /**
     * Look up a device by MAC address. Returns null if not found.
     * @param {string} macAddress
     * @returns {{ mac, friendlyId, apiKey, createdAt } | null}
     */
    get(macAddress) {
      return load()[macAddress] ?? null;
    },

    /**
     * Record the latest telemetry received from a device.
     * @param {string} macAddress
     * @param {object} telemetry
     */
    updateTelemetry(macAddress, telemetry) {
      const store = load();
      if (!store[macAddress]) return;
      store[macAddress].lastSeen      = new Date().toISOString();
      store[macAddress].lastTelemetry = {
        battery:  telemetry.battery  ?? null,
        wifi:     telemetry.wifi     ?? null,
        firmware: telemetry.firmware ?? null,
        ...telemetry,
      };
      save(store);
    },

    /**
     * List all registered devices.
     * @returns {object[]}
     */
    list() {
      return Object.values(load());
    },
  };
}

// ─── Production singleton (uses project's data/ directory) ───────────────────

const _defaultStore = createDeviceStore(DATA_DIR);

export const getOrCreate        = (mac)            => _defaultStore.getOrCreate(mac);
export const get                = (mac)            => _defaultStore.get(mac);
export const updateTelemetry    = (mac, telemetry)  => _defaultStore.updateTelemetry(mac, telemetry);
export const updateCapabilities = (mac, caps)       => _defaultStore.updateCapabilities(mac, caps);
export const list               = ()               => _defaultStore.list();
