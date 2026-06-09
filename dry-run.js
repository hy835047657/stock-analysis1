// Dry run: skip tweetFetcher (no TwexAPI call), write empty raw files,
// then run the rest of the pipeline end-to-end to validate the framework.
import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  loadConfig, saveJson, DATA, todayUtcStr, logger,
} from './src/common/index.js';
import { classifyAll }  from './src/skills/viewClassifier/index.js';
import { updateLedger } from './src/skills/positionTracker/index.js';
import { analyze as runConsensus } from './src/skills/consensusAnalyzer/index.js';
import { analyze as runRisk }      from './src/skills/riskAlert/index.js';
import { buildReport }  from './src/agent/reporter.js';

async function stubEmptyRawFiles() {
  const cfg = loadConfig();
  const dateDir = path.join(DATA, 'raw', todayUtcStr());
  await fs.mkdir(dateDir, { recursive: true });
  const summary = {};
  for (const b of cfg.bloggers) {
    const outPath = path.join(dateDir, `${b.handle}.json`);
    await saveJson(outPath, []);   // empty tweet list
    summary[b.handle] = {
      count: 0, path: outPath, window_hours: 0, layer: b.layer, stubbed: true,
    };
  }
  await saveJson(path.join(dateDir, '_summary.json'), summary);
  logger.info(`stubbed ${cfg.bloggers.length} empty raw files at ${dateDir}`);
}

async function main() {
  logger.info('=== DRY RUN (empty data, no TwexAPI) ===');
  await stubEmptyRawFiles();
  await classifyAll();
  await updateLedger();
  await runConsensus();
  // skip backtest — needs yfinance network + ledger entries (ledger is empty anyway)
  await runRisk();
  const { md, path: rpath } = await buildReport();
  logger.info(`=== DRY RUN complete · report at ${rpath} ===`);
  logger.info(`report length: ${md.length} chars`);
}

main().catch(e => { logger.error({ err: e.message, stack: e.stack }, 'dry run failed'); process.exit(1); });
