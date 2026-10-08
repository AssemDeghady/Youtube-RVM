import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { resolve } from 'path';

const rootDir = process.cwd();
const distDir = resolve(rootDir, 'dist');
const releaseDir = resolve(rootDir, 'release');
const zipFile = resolve(releaseDir, 'ShortLinker-v1.0.0.zip');

if (!existsSync(distDir)) {
  console.error('[Package] Error: dist/ directory does not exist. Run build first.');
  process.exit(1);
}

if (!existsSync(releaseDir)) {
  mkdirSync(releaseDir, { recursive: true });
}

if (existsSync(zipFile)) {
  rmSync(zipFile, { force: true });
}

console.log('[Package] Creating Chrome Web Store distribution package...');

try {
  if (process.platform === 'win32') {
    // Windows PowerShell Compress-Archive
    execSync(`powershell -NoProfile -Command "Compress-Archive -Path 'dist/*' -DestinationPath 'release/ShortLinker-v1.0.0.zip' -Force"`, {
      stdio: 'inherit',
      cwd: rootDir
    });
  } else {
    // Unix / macOS zip or tar
    try {
      execSync(`cd dist && zip -r "${zipFile}" .`, { stdio: 'inherit' });
    } catch {
      execSync(`cd dist && tar -a -cf "${zipFile}" *`, { stdio: 'inherit' });
    }
  }

  console.log(`[Package] Successfully created release bundle at: ${zipFile}`);
} catch (err) {
  console.error('[Package] Packaging failed:', err);
  process.exit(1);
}
