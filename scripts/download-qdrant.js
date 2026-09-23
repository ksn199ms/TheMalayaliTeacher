import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const binDir = path.join(projectRoot, 'bin', 'qdrant');
const exePath = path.join(binDir, 'qdrant.exe');

async function ensureQdrant() {
  if (fs.existsSync(exePath)) {
    console.log(`[qdrant] Executable already present at ${exePath}`);
    return exePath;
  }

  console.log('[qdrant] Downloading official Qdrant binary for Windows (no Docker needed)...');
  fs.mkdirSync(binDir, { recursive: true });

  const zipPath = path.join(binDir, 'qdrant.zip');
  const downloadUrl = 'https://github.com/qdrant/qdrant/releases/download/v1.19.1/qdrant-x86_64-pc-windows-msvc.zip';

  const res = await fetch(downloadUrl);
  if (!res.ok) {
    throw new Error(`Failed to download Qdrant from ${downloadUrl}: ${res.statusText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(zipPath, Buffer.from(arrayBuffer));
  console.log(`[qdrant] Downloaded archive (${(arrayBuffer.byteLength / (1024 * 1024)).toFixed(1)} MB). Extracting...`);

  // Extract using PowerShell Expand-Archive
  execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${binDir}' -Force"`, {
    stdio: 'inherit',
  });

  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  if (fs.existsSync(exePath)) {
    console.log(`[qdrant] Qdrant binary successfully extracted to ${exePath}`);
  } else {
    throw new Error(`Expected qdrant.exe at ${exePath}, but not found after extraction.`);
  }

  return exePath;
}

ensureQdrant().catch((err) => {
  console.error('[qdrant] Setup error:', err.message);
  process.exit(1);
});
