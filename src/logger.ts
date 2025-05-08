import { pino, Level } from 'pino';
import PinoPretty from 'pino-pretty';

const logLevelFromEnv = (): Level => {
  const level = process.env.LMNR_LOG_LEVEL;
  switch (level?.toLowerCase()) {
    case 'trace': return 'trace';
    case 'debug': return 'debug';
    case 'info': return 'info';
    case 'warn': return 'warn';
    case 'error': return 'error';
    case 'fatal': return 'fatal';
    default: return 'warn';
  }
}

const logger = pino(PinoPretty({
  colorize: true,
  minimumLevel: logLevelFromEnv(),
}));

export { logger };
