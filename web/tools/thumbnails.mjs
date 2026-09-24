/**
 * Generateur des vignettes de la bibliotheque — module AB.5.
 *
 *   node tools/thumbnails.mjs
 *
 * Rend chaque famille dans un Chromium sans tete (Playwright), avec la mise
 * en scene exacte des cartes de la galerie, et ecrit `src/lib/thumbnails.ts` :
 * image WebP, verdict de flottabilite, masse et densite de maillage mesures
 * sur le modele livre. La galerie n'a donc plus rien a calculer a
 * l'ouverture.
 *
 * Prerequis : Playwright et un Chromium (variable CHROMIUM_PATH, sinon le
 * navigateur par defaut de Playwright). Ce n'est pas une dependance de
 * l'application : seul le fichier genere est livre.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const root = new URL('..', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'sakuma-thumbs-'));
const require = createRequire(import.meta.url);

const entry = join(dir, 'entry.ts');
writeFileSync(
  entry,
  `
import { renderThumb } from '${root}src/components/ArchetypePreview';
import { SHAPE_PRESETS, clonePreset } from '${root}src/lib/presets';
import { DISPLAY_RESOLUTION, buildLure } from '${root}src/lib/geometry';
import { assemblyExport, assemblyPlans, buildAssembly } from '${root}src/lib/assembly';
import { computePhysics } from '${root}src/lib/physics';
import { createProfile } from '${root}src/lib/profile';

const count = (g) => (g.getIndex() ? g.getIndex().count : g.getAttribute('position').count) / 3;

window.generate = () =>
  SHAPE_PRESETS.map((preset) => {
    const params = clonePreset(preset.id);
    const profile = createProfile(params);
    const plans = assemblyPlans(profile, params);
    const geo = buildLure(params, DISPLAY_RESOLUTION, plans.billPlan?.root ?? null);
    const physics = computePhysics(params, geo, 'fresh');
    const shells = buildAssembly(profile, params, assemblyExport(params));
    const record = {
      id: preset.id,
      image: renderThumb(params, DISPLAY_RESOLUTION, 'image/webp', plans.billPlan?.root ?? null),
      buoyancy: physics.buoyancy,
      massG: Math.round(physics.totalMass * 10) / 10,
      bodyTriangles: count(geo.body),
      shellTriangles: count(shells.male) + count(shells.female),
    };
    geo.dispose();
    return record;
  });
`,
);

try {
  const bundle = join(dir, 'bundle.js');
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    outfile: bundle,
    logLevel: 'warning',
    nodePaths: [join(root, 'node_modules')],
  });
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body><script src="bundle.js"></script></body></html>');

  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs'));
  }
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.goto(`file://${join(dir, 'index.html')}`);
  const records = await page.evaluate(() => window.generate());
  await browser.close();

  const body = records
    .map(
      (r) =>
        `  ${r.id}: {\n    image: '${r.image}',\n    buoyancy: '${r.buoyancy}',\n    massG: ${r.massG},\n` +
        `    bodyTriangles: ${r.bodyTriangles},\n    shellTriangles: ${r.shellTriangles},\n  },`,
    )
    .join('\n');
  writeFileSync(
    join(root, 'src/lib/thumbnails.ts'),
    `/**
 * Vignettes et fiches verifiees de la bibliotheque — module AB.5.
 *
 * FICHIER GENERE par \`node tools/thumbnails.mjs\` : ne pas modifier a la main.
 * Il est regenere a chaque changement des modeles de la bibliotheque.
 */

export interface FamilyThumbnail {
  /** Image WebP en data URI. */
  image: string;
  /** Verdict et masse calcules sur le modele livre. */
  buoyancy: 'float' | 'suspend' | 'sink';
  massG: number;
  /** Triangles du corps et des deux coques a la resolution d'export. */
  bodyTriangles: number;
  shellTriangles: number;
}

export const THUMBNAILS: Record<string, FamilyThumbnail> = {
${body}
};
`,
  );
  for (const r of records) {
    console.log(`${r.id.padEnd(10)} ${Math.round(r.image.length / 1024)} Ko · ${r.buoyancy} · ${r.massG} g · corps ${r.bodyTriangles} tri · coques ${r.shellTriangles} tri`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
