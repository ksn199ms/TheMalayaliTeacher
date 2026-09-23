import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const exePath = path.join(projectRoot, 'bin', 'qdrant', 'qdrant.exe');
const storagePath = path.join(projectRoot, 'data', 'qdrant_storage');

async function isQdrantRunning() {
  try {
    const res = await fetch('http://localhost:6333/healthz');
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  if (await isQdrantRunning()) {
    console.log('[qdrant] Already running on http://localhost:6333');
    return;
  }

  if (!fs.existsSync(exePath)) {
    console.log('[qdrant] Executable not found. Running download first...');
    const { execSync } = await import('node:child_process');
    execSync('node scripts/download-qdrant.js', { stdio: 'inherit', cwd: projectRoot });
  }

  fs.mkdirSync(storagePath, { recursive: true });

  console.log('[qdrant] Starting Qdrant on http://localhost:6333 (storage: ./data/qdrant_storage)...');
  const qdrantProcess = spawn(exePath, [], {
    cwd: projectRoot,
    stdio: 'inherit',
    detached: true,
  });

  qdrantProcess.unref();

  // Poll until healthy
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isQdrantRunning()) {
      console.log('[qdrant] Successfully started and healthy on http://localhost:6333!');
      return;
    }
  }

  console.warn('[qdrant] Qdrant process spawned. Waiting a bit more for healthz...');
}

main().catch((err) => {
  console.error('[qdrant] Failed to start:', err);
  process.exit(1);
});
