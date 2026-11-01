// tsc does not copy non-TS files; the migrator reads SQL from dist at runtime.
import { cpSync } from 'node:fs';

cpSync('src/database/migrations', 'dist/database/migrations', { recursive: true });
