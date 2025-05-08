import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Get the current directory name, handling different environments
 */
export const getDirname = () => {
  if (typeof __dirname !== 'undefined') {
    return __dirname;
  }

  if (typeof import.meta?.url !== 'undefined') {
    return path.dirname(fileURLToPath(import.meta.url));
  }

  return process.cwd();
};
