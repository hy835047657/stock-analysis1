// Common utilities shared across skills.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import pino from 'pino';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT = path.resolve(__dirname, '..', '..');
export const DATA = path.join(ROOT, 'data');
export const CFG  = path.join(ROOT, 'config', 'watchlist.yaml');

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'production' ? undefined : {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'HH:MM:ss' },
  },
});

let _cfgCache = null;
export function loadConfig() {
  if (_cfgCache) return _cfgCache;
  const txt = fsSync.readFileSync(CFG, 'utf8');
  _cfgCache = yaml.load(txt);
  return _cfgCache;
}

export function nowUtc() {
  return new Date();
}

export function hoursAgo(n) {
  return new Date(Date.now() - n * 3600 * 1000);
}

export function todayUtcStr() {
  return nowUtc().toISOString().slice(0, 10);
}

export function compactDateUtcStr() {
  return todayUtcStr().replace(/-/g, '');
}

export async function saveJson(filepath, data) {
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf8');
  return filepath;
}

export async function loadJson(filepath, defaultValue = null) {
  try {
    const txt = await fs.readFile(filepath, 'utf8');
    return JSON.parse(txt);
  } catch (e) {
    if (e.code === 'ENOENT') return defaultValue;
    throw e;
  }
}

export function extractCashtags(text, pattern = '\\$[A-Z]{2,6}') {
  if (!text) return [];
  const re = new RegExp(pattern, 'g');
  const set = new Set(text.match(re) || []);
  return [...set].sort();
}

export function classifyPostKind(t) {
  if (t.in_reply_to_screen_name) return 'REPLY';
  if (t.is_quote_status) return 'QUOTE';
  return 'POST';
}

export function tweetUrl(handle, tid) {
  return `https://x.com/${handle}/status/${tid}`;
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
