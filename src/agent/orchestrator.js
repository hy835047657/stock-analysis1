// Orchestrator Agent: tweetFetcher -> viewClassifier -> positionTracker
//                                                   -> consensusAnalyzer
//                                                   -> backtest (lazy)
//                                                   -> riskAlert -> reporter
import 'dotenv/config';
import { logger } from '../common/index.js';
import { fetchAll }      from '../skills/tweetFetcher/index.js';
import { classifyAll }   from '../skills/viewClassifier/index.js';
import { updateLedger }  from '../skills/positionTracker/index.js';
import { analyze as runConsensus } from '../skills/consensusAnalyzer/index.js';
import { scoreAll }      from '../skills/backtest/index.js';
import { analyze as runRisk } from '../skills/riskAlert/index.js';
import { buildReport, pushLark, pushSlack } from './reporter.js';

export async function runOnce({ skipBacktest = false, push = true } = {}) {
  logger.info('=== Pipeline start ===');
  await fetchAll();
  await classifyAll();
  await updateLedger();
  await runConsensus();
  if (!skipBacktest) {
    try { await scoreAll(); }
    catch (e) { logger.warn(`backtest skipped: ${e.message}`); }
  }
  await runRisk();
  const { md, path: rpath, htmlPath } = await buildReport();
  if (push) {
    await pushLark(md, { htmlPath });
    await pushSlack(md);
  }
  logger.info(`=== Pipeline complete - report at ${rpath} - html at ${htmlPath} ===`);
}

// CLI
const args = process.argv.slice(2);
const flags = new Set(args);
if (flags.has('--schedule')) {
  logger.error('scheduled runs are disabled; use npm start or npm run ci:daily for a manual run');
  process.exit(1);
} else {
  // default: run-once
  runOnce({ skipBacktest: flags.has('--skip-backtest'), push: !flags.has('--no-push') })
    .catch(e => { logger.error({ err: e.message, stack: e.stack }, 'run failed'); process.exit(1); });
}
