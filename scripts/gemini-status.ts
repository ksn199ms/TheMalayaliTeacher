import 'dotenv/config';
import { geminiRequestManager } from '../src/ai/GeminiRequestManager.js';
import { config } from '../src/config/env.js';

async function main() {
  const status = geminiRequestManager.getStatus();

  console.log('\n========================================');
  console.log('🤖 GEMINI QUOTA & SERVICE STATUS');
  console.log('========================================');
  console.log(`Model:                     ${config.GEMINI_MODEL}`);
  console.log(`Circuit Breaker State:     ${status.circuitState}`);
  console.log(`Active Concurrency:        ${status.concurrency.active} / ${status.concurrency.max}`);
  console.log(`Queued Requests:           ${status.concurrency.queued}`);
  console.log('----------------------------------------');
  console.log('OBSERVED TODAY:');
  console.log(`Total Requests:            ${status.observedToday.totalRequests}`);
  console.log(`Successful:                ${status.observedToday.successfulRequests}`);
  console.log(`Failed:                    ${status.observedToday.failedRequests}`);
  console.log(`Retries:                   ${status.observedToday.retriesCount}`);
  console.log('----------------------------------------');
  console.log(`Daily Reset Estimate:      ${status.estimatedResetTime}`);
  if (status.openReason) {
    console.log(`Circuit Open Reason:       ${status.openReason}`);
  }
  console.log('========================================\n');
}

main().catch(console.error);
