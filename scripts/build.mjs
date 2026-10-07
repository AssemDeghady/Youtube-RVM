import { build } from 'vite';
import { resolve } from 'path';

const isWatch = process.argv.includes('--watch');

async function runBuild() {
  console.log('[Build] Building ShortLinker POC Chrome Extension...');

  // 1. Build Isolated-World Content Script
  await build({
    configFile: false,
    publicDir: 'public',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true,
      watch: isWatch ? {} : null,
      rollupOptions: {
        input: resolve(process.cwd(), 'src/content/index.ts'),
        output: {
          entryFileNames: 'content.js',
          format: 'iife',
          name: 'ShortLinkerPOC'
        }
      }
    }
  });

  // 2. Build MAIN-World Interceptor Script
  await build({
    configFile: false,
    publicDir: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      sourcemap: true,
      watch: isWatch ? {} : null,
      rollupOptions: {
        input: resolve(process.cwd(), 'src/interceptor/index.ts'),
        output: {
          entryFileNames: 'interceptor.js',
          format: 'iife',
          name: 'ShortLinkerInterceptor'
        }
      }
    }
  });

  console.log('[Build] Completed successfully.');
}

runBuild().catch((err) => {
  console.error('[Build] Failed:', err);
  process.exit(1);
});
