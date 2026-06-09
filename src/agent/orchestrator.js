// Orchestrator Agent: tweetFetcher -> viewClassifier -> positionTracker
//                                                   -> consensusAnalyzer
//                                                   -> backtest (lazy)
//                                                   -> riskAlert -> reporter
import 'dotenv/config';
import cron from 'node-cron';
import { logger } from '../common/index.js';
import { fetchAll }      from '../skills/tweetFetcher/index.js';
import { classifyAll }   from '../skills/viewClassifier/index.js';
import { updateLedger }  from '../skills/positionTracker/index.js';
import { analyze as runConsensus } from '../skills/consensusAnalyzer/index.js';
import { scoreAll }      from '../skills/backtest/index.js';
import { analyze as runRisk } from '../skills/riskAlert/index.js';
import { buildReport, pushLark, pushSlack } from './reporter.js';

export async function runOnce({ skipBacktest = false } = {}) {
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
  await pushLark(md, { htmlPath });
  await pushSlack(md);
  logger.info(`=== Pipeline complete · report at ${rpath} · html at ${htmlPath} ===`);
}

function schedule() {
  const tz = process.env.TIMEZONE || 'Asia/Shanghai';
  const hour = Number(process.env.DAILY_REPORT_HOUR ?? 10);
  const minute = Number(process.env.DAILY_REPORT_MINUTE ?? 0);
  const expr = `${minute} ${hour} * * *`;
  cron.schedule(expr, () => {
    runOnce().catch(e => logger.error({ err: e.message }, 'scheduled run failed'));
  }, { timezone: tz });
  logger.info(`scheduler started: daily ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')} ${tz}`);
}

// CLI
const args = process.argv.slice(2);
const flags = new Set(args);
if (flags.has('--schedule')) {
  schedule();
} else {
  // default: run-once
  runOnce({ skipBacktest: flags.has('--skip-backtest') })
    .catch(e => { logger.error({ err: e.message, stack: e.stack }, 'run failed'); process.exit(1); });
}
