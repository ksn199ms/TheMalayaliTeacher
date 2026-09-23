import { App } from './app.js';
import { logger } from './utils/logger.js';

const app = new App();

async function main() {
  try {
    await app.start();

    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}. Shutting down gracefully...`);
      await app.stop();
      process.exit(0);
    };

    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error: any) {
    logger.error({ error: error.message, stack: error.stack }, 'Fatal application startup error.');
    process.exit(1);
  }
}

main();

