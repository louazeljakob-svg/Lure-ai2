/**
 * Lanceur du test de bout en bout : `npm test`.
 *
 * Le test est ecrit en TypeScript contre les modules de l'application ; il
 * est empaquete a la volee par esbuild (deja present avec Vite), puis
 * execute dans Node. Aucun navigateur n'est necessaire : la geometrie, la
 * physique et les exports sont du calcul pur.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'sakuma-e2e-'));
const out = join(dir, 'run.mjs');
try {
  await build({
    entryPoints: [new URL('./e2e/run.ts', import.meta.url).pathname],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: out,
    logLevel: 'warning',
  });
  const started = Date.now();
  const { run } = await import(pathToFileURL(out).href);
  const report = run();
  for (const line of report.lines) console.log(line);
  if (report.failures.length > 0) {
    console.log(`\n${report.failures.length} echec(s) :`);
    for (const failure of report.failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`\nZero echec — ${((Date.now() - started) / 1000).toFixed(1)} s.`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
