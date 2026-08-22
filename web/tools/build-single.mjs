/**
 * Assemble le build Vite en UN seul fichier HTML autonome.
 *
 * Trois sorties :
 *   dist-single/sakuma.html          page complete, ouvrable par double-clic
 *   dist-single/sakuma-artifact.html contenu seul, pour la publication en artefact
 *     (l hote fournit deja doctype / html / head / body)
 *   ../docs/index.html               meme page, versionnee pour GitHub Pages
 *     (Pages sert le dossier docs/ : le lien public est alors ouvrable par
 *      n importe qui, sans compte ni installation)
 *
 * Aucune requete reseau hors Google Fonts : le JS et le CSS sont integres.
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const out = join(root, 'dist-single');
const pages = join(root, '..', 'docs');

const FONTS =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?' +
  'family=Barlow+Condensed:wght@500;600;700&amp;family=Inter:wght@400;500;600;700&amp;display=swap">';

const TITLE = 'SAKUMA';
const DESCRIPTION =
  'SAKUMA &#8212; concevez des leurres de peche imprimables en 3D, sans competences CAO.';

/** Neutralise toute sequence qui refermerait prematurement la balise script. */
const guard = (code) => code.replace(/<\/script/gi, '<\\/script');

const assertAscii = (label, text) => {
  const match = /[^\x00-\x7F]/.exec(text);
  if (match) {
    const at = match.index;
    throw new Error(
      `${label} contient un caractere non-ASCII (U+${match[0]
        .codePointAt(0)
        .toString(16)
        .toUpperCase()
        .padStart(4, '0')}) a l offset ${at} : ` +
        `le fichier serait dependant d une declaration de charset. Contexte : ` +
        JSON.stringify(text.slice(Math.max(0, at - 40), at + 40)),
    );
  }
};

const assets = await readdir(join(dist, 'assets'));
const jsFile = assets.find((f) => f.endsWith('.js'));
const cssFile = assets.find((f) => f.endsWith('.css'));
if (!jsFile || !cssFile) throw new Error('Build Vite introuvable : lancez `npm run build` d abord.');

const js = await readFile(join(dist, 'assets', jsFile), 'utf8');
const css = await readFile(join(dist, 'assets', cssFile), 'utf8');

assertAscii('Le bundle JS', js);
assertAscii('La feuille de style', css);

const body =
  `<style>${css}</style>` +
  `<div id="root"></div>` +
  `<script type="module">${guard(js)}</script>`;

await mkdir(out, { recursive: true });

// 1. Page autonome : ouvrable directement depuis le disque.
await writeFile(
  join(out, 'sakuma.html'),
  `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#E30613">
<meta name="description" content="${DESCRIPTION}">
<title>${TITLE}</title>
${FONTS}
</head>
<body>
${body}
</body>
</html>
`,
  'utf8',
);

// 2. Contenu seul : l hote de l artefact fournit l enveloppe du document.
await writeFile(join(out, 'sakuma-artifact.html'), `<title>${TITLE}</title>\n${FONTS}\n${body}\n`, 'utf8');

// 3. Copie servie par GitHub Pages, versionnee dans le depot.
const standalone = await readFile(join(out, 'sakuma.html'), 'utf8');
await mkdir(pages, { recursive: true });
await writeFile(join(pages, 'index.html'), standalone, 'utf8');
// Empeche Jekyll de retraiter la page.
await writeFile(join(pages, '.nojekyll'), '', 'utf8');

const kb = (n) => `${(n / 1024).toFixed(0)} ko`;
console.log(`dist-single/sakuma.html          ${kb(Buffer.byteLength(body) + 600)}`);
console.log(`dist-single/sakuma-artifact.html ${kb(Buffer.byteLength(body) + 300)}`);
console.log(`docs/index.html                  ${kb(Buffer.byteLength(standalone))} (GitHub Pages)`);
