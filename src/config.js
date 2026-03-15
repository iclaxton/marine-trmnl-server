/**
 * Config loader — reads config.yaml, resolves ${ENV_VAR} substitutions,
 * and exposes a validated, parsed config object.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, '../config.yaml');

/**
 * Recursively walk a parsed YAML object and replace
 * "${VAR_NAME}" strings with process.env values.
 */
function interpolateEnv(value) {
  if (typeof value === 'string') {
    return value.replace(/\$\{([^}]+)\}/g, (_, expr) => {
      const sepIdx = expr.indexOf(':-');
      const name = sepIdx === -1 ? expr : expr.slice(0, sepIdx);
      const fallback = sepIdx === -1 ? undefined : expr.slice(sepIdx + 2);
      const envVal = process.env[name];
      if (envVal === undefined && fallback === undefined) {
        throw new Error(`Config references undefined env variable: ${name}`);
      }
      return envVal !== undefined ? envVal : fallback;
    });
  }
  if (Array.isArray(value)) return value.map(interpolateEnv);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, interpolateEnv(v)])
    );
  }
  return value;
}

function loadConfig() {
  const raw = readFileSync(CONFIG_PATH, 'utf8');
  const parsed = yaml.load(raw);
  return interpolateEnv(parsed);
}

export const config = loadConfig();

// server.port must be a number (env vars are always strings after interpolation)
if (config.server?.port !== undefined) {
  config.server.port = parseInt(config.server.port, 10);
}

// Convenience accessors
export const byosConfig    = config.byos;
export const displayConfig = config.display;
export const influxConfig  = config.influxdb;
export const metricsConfig = config.metrics;
export const serverConfig  = config.server;
export const vesselConfig  = config.vessel;
