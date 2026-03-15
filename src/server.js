/**
 * server.js — entry point for the Marine TRMNL BYOS server.
 *
 * Wires together all the real dependencies and starts listening.
 * Actual route logic lives in src/app.js (injectable, testable).
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './app.js';
import { fetchAllMetrics } from './influx.js';
import { renderDashboard, renderSetupScreen } from './renderer.js';
import { screenshotHtml } from './screenshot.js';
import { toDisplayImage, displayExtension, checkImageMagick } from './converter.js';
import * as devices from './devices.js';
import { byosConfig, serverConfig, displayConfig, vesselConfig } from './config.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const screensDir = resolve(__dirname, '..', byosConfig?.screensDir ?? './screens');
const ext        = displayExtension(displayConfig.bitDepth ?? 1);

const { fastify, initialize } = createApp({
  deps: {
    fetchAllMetrics,
    renderDashboard,
    renderSetupScreen,
    screenshotHtml,
    toDisplayImage,
    displayExtension,
    checkImageMagick,
    devices,
  },
  paths: {
    screensDir,
    DASHBOARD_RAW:     resolve(screensDir, 'dashboard_raw.png'),
    DASHBOARD_DISPLAY: resolve(screensDir, `dashboard${ext}`),
    SETUP_RAW:         resolve(screensDir, 'setup_raw.png'),
    SETUP_DISPLAY:     resolve(screensDir, `setup${ext}`),
  },
  cfg: { byosConfig, serverConfig, displayConfig, vesselConfig },
});

async function start() {
  try {
    await initialize();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  try {
    await fastify.listen({ port: serverConfig.port, host: serverConfig.host });
    const local = `http://localhost:${serverConfig.port}`;
    fastify.log.info(`Server:          ${local}`);
    fastify.log.info(`BYOS display:    ${local}/api/display`);
    fastify.log.info(`Browser preview: ${local}/preview`);
    fastify.log.info(`Refresh:         every ${displayConfig.refreshIntervalSeconds}s`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();

