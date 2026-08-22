# 🎣 SAKUMA — editeur de leurres de peche imprimables en 3D

Application web qui permet de dessiner un leurre imprimable **sans aucune competence
CAO** : on part d'une forme de base, on la modele au slider, on la leste, et la
physique (flottabilite, assiette, action de nage) se recalcule en direct. Quand le
dessin convient, on exporte le STL a l'echelle 1:1.

**React 19 · TypeScript · React Three Fiber (Three.js) · Vite**

---

## Demarrer

```bash
cd web
npm install
npm run dev        # http://localhost:5173
```

Autres scripts : `npm run build` (bundle de production), `npm run preview`,
`npm run typecheck`.

### Fichier HTML unique

```bash
npm run build:single
```

Produit trois fichiers :

| Fichier | Usage |
| --- | --- |
| `dist-single/sakuma.html` | Page complete et autonome (~1,2 Mo) : React, Three.js et toute l'application sont integres. Ouvrable par double-clic, sans serveur ni installation. |
| `dist-single/sakuma-artifact.html` | Contenu seul, pour une publication en artefact claude.ai (l'hote fournit l'enveloppe du document). |
| `docs/index.html` | Copie versionnee servie par GitHub Pages. |

### Lien public (GitHub Pages)

`docs/index.html` est la meme page, versionnee dans le depot pour etre servie
telle quelle. Une fois Pages active (Settings -> Pages -> branche
`claude/sakuma-lure-3d-editor-g9griq`, dossier `/docs`), l'application est
accessible a **toute personne disposant du lien**, sans compte ni installation :

```
https://louazeljakob-svg.github.io/Lure-ai2/
```

Le fichier etant autonome, il fonctionne aussi bien depuis n'importe quel autre
hebergement statique, ou simplement envoye par mail.

Aucune requete reseau hors Google Fonts, qui disposent d'une pile de repli.
Le bundle est emis en ASCII pur (`esbuild.charset`), de sorte que les accents
s'affichent correctement sans dependre d'une declaration de charset de l'hote.

---

## Ce que fait l'application

### 1. Galerie de formes

Sept gabarits **entierement parametriques** — Minnow, Popper, Crankbait, Jerkbait,
Spoon, Swimbait, Topwater. Chaque vignette est une silhouette SVG generee par le
meme code de profil que le modele 3D : la miniature correspond donc toujours a la
piece qui sera imprimee.

### 2. Editeur en trois panneaux

| Panneau | Contenu |
| --- | --- |
| Gauche | Longueur, largeur, epaisseur, position du ventre, courbures dorsale et ventrale, finesse du nez, creux de bouche, effilement arriere, profil de section, **branchies et yeux**, angle / longueur / largeur de bavette, forme et taille de la queue |
| Centre | Viewport 3D (orbite, zoom, pan), grille d'atelier au centimetre, eclairage studio, reperes CG / centre de poussee, vue rayons X, vue flottaison |
| Droite | Matiere & finition, **agrafes**, **bibliotheque de livrees**, simulation physique, projets de la session — plus le bloc d'export toujours accessible |

Le maillage est **regenere a chaque mouvement de slider** : aucun modele 3D
prefabrique n'est charge.

#### Details de tete

Branchies et yeux ne sont pas des pieces rapportees : ils **deplacent les
sommets du corps lui-meme** dans l'espace des parametres du loft. Le maillage
reste donc ferme et imprimable. La ligne d'ouie se bombe vers l'arriere a
mi-flanc comme un vrai opercule ; l'oeil combine une cuvette annulaire et un
iris bombe (relief positif) ou une calotte entierement bombee (relief negatif).
Le relief demande est respecte a mieux de 2 % sur le maillage. Ces reglages ne
s'appliquent pas a la cuiller, qui n'a pas de tete distincte.

#### Bavette

L'angle est mesure **depuis l'axe du corps** : 0 degre place la bavette dans le
prolongement du nez (plongee maximale), 90 degres la dresse perpendiculairement
(nage de sub-surface). Elle projette toujours vers l'avant, comme une vraie
levre de plongee.

#### Agrafes

Une agrafe optionnelle (fil 1,2 mm / 16 mm ou 1,6 mm / 17,5 mm) est generee
comme un vrai fil plie : une courbe decrit l'axe du fil, un tube de la section
du fil est balaye le long de cette courbe, et la masse d'acier se deduit de la
longueur developpee (0,37 g et 0,72 g). Elle entre dans la masse totale et dans
le centre de gravite, mais **jamais dans les fichiers d'impression**.

### 3. Simulation physique

Le volume et le centre de poussee sont **integres directement sur le maillage**
(somme des tetraedres signes), pas approches par un ellipsoide : le resultat suit
donc fidelement chaque reglage.

- **Badge Flotte / Suspend / Coule** a partir du rapport masse / poussee
  (tolerance de 3 % pour le suspending)
- **Masse totale** = corps imprime (volume x densite matiere x taux de matiere
  reellement deposee) + lests de plomb + quincaillerie
- **Assiette de nage** deduite du decalage longitudinal CG / centre de poussee
- **Stabilite en roulis** via le bras de levier vertical entre les deux centres
- **Action estimee** (serree / large / roulante) selon la bavette, la corpulence,
  la caudale et la stabilite
- **Alertes de coherence** : centre de gravite trop haut ou trop avance, lest qui
  ne rentre pas dans la section, lestage dominant, bavette surdimensionnee,
  etancheite d'une coque creuse, encombrement d'impression…
- **Ligne de flottaison** resolue par dichotomie sur le volume immerge

Hypotheses : leurre etanche, eau au repos, petits angles. Ce n'est pas de la CFD —
les valeurs sont des estimations de conception, pas des mesures.

### 3 bis. Livree

Cinq zones colorables (tete, dos, flancs, ventre, queue) avec fondu reglable,
motifs generes au canvas (rayures, points, ecailles, camouflage deterministe,
degrade longitudinal), oeil peint et cinq finitions dont un rendu
**holographique** obtenu par irisation de film mince. Les livrees peuvent etre
enregistrees dans une bibliotheque qui voyage avec le projet JSON.

### 4. Export & sauvegarde — 100 % navigateur

- **Exporter STL** : binaire, echelle 1:1 en millimetres, piece posee sur le
  plateau et centree, longueur sur X (convention des trancheurs)
- **Exporter STEP** (ISO 10303-21, schema AP214) : B-rep facette a topologie
  complete — chaque triangle devient une ADVANCED_FACE plane, bornee par une
  EDGE_LOOP dont les aretes sont partagees entre faces voisines. C'est cette
  topologie partagee qui fait un solide mesurable en CAO plutot qu'une soupe de
  triangles. La geometrie est regeneree a resolution reduite pour l'occasion
  (~4 700 faces, ~3 Mo) ; les faces restent planes, ce n'est pas une surface
  analytique
- **Deux chemins de remise de fichier**, choisis automatiquement : telechargement
  navigateur natif quand la page tourne en local, capacite `downloads` de l'hote
  quand elle est publiee en artefact (le bac a sable y neutralise les liens
  `download`). La liste d'extensions de l'hote ne couvrant pas `.stl`, le STL y
  est repropose en `.stl.txt` avec la consigne de renommage
- **Sauvegarder le projet (JSON)** : tous les parametres serialises
- **Recharger un projet** : input file classique ; tout fichier importe est
  revalide champ par champ avant d'atteindre le generateur
- **Apercu imprimable** : cotes reelles en mm et poids d'impression estime

Aucun backend, aucune base de donnees, aucun compte : tout vit en memoire dans
l'onglet, et la persistance passe par les fichiers telecharges.

### 5. Projets de session

Liste des creations avec vignette, renommage, duplication, suppression et export
JSON individuel.

---

## Accessibilite & responsive

- Focus clavier visible partout (contour rouge), lien d'evitement, libelles et
  regions live sur les valeurs calculees
- Camera pilotable au clavier via les boutons de vue (3/4, profil, dessus, face,
  recadrer) — pas de capture des fleches, qui restent aux sliders
- `prefers-reduced-motion` respecte : transitions neutralisees et amortissement
  de l'orbite desactive
- Trois colonnes sur poste fixe, empilement avec barre d'onglets sur tablette et
  telephone (utilisable en atelier)

---

## Architecture

```
web/src/
├── App.tsx                      # etat global, routage galerie / editeur
├── components/
│   ├── ShapeGallery.tsx         # ecran d'accueil
│   ├── ShapeEditor.tsx          # panneau gauche
│   ├── Viewport3D.tsx           # scene R3F, reperes, flottaison
│   ├── MaterialPanel.tsx        # matiere, lests, livree
│   ├── PhysicsSimulator.tsx     # badges, assiette, alertes
│   ├── ExportManager.tsx        # STL / JSON / apercu imprimable
│   ├── ProjectsPanel.tsx        # projets de la session
│   ├── LureSilhouette.tsx       # silhouette SVG procedurale
│   └── ui.tsx                   # sliders, segments, interrupteurs
├── lib/
│   ├── profile.ts               # profil parametrique partage 2D / 3D
│   ├── geometry.ts              # loft du corps, bavette, caudale, lests
│   ├── physics.ts               # volumes, CG, flottabilite, alertes
│   ├── materials.ts             # densites PLA / LW-PLA / resine / TPU
│   ├── paint.ts                 # texture de livree generee au canvas
│   ├── presets.ts               # 7 gabarits + bornes des reglages
│   ├── exporters.ts             # STL binaire, JSON, telechargements
│   ├── validation.ts            # nettoyage des projets importes
│   └── hooks.ts                 # prefers-reduced-motion, media queries
├── types/lure.ts
└── styles/global.css            # identite rouge Sakuma / blanc / noir

web/tools/
└── build-single.mjs             # assemblage du fichier HTML autonome
```

---

## Reperes de conception

Les sept gabarits sont calibres pour tomber sur des valeurs realistes :

| Gabarit | Cotes (mm) | Volume | Masse | Etat | Action |
| --- | --- | --- | --- | --- | --- |
| Minnow | 110 x 30 x 15 | 16,1 cm3 | 14,2 g | Flotte (0,88) | serree |
| Popper | 82 x 27 x 20 | 21,1 cm3 | 14,0 g | Flotte (0,66) | large |
| Crankbait | 62 x 45 x 20 | 18,8 cm3 | 14,6 g | Flotte (0,78) | large |
| Jerkbait | 120 x 26 x 13 | 15,2 cm3 | 15,2 g | Suspend (1,00) | serree |
| Spoon | 72 x 8 x 26 | 6,6 cm3 | 10,2 g | Coule (1,54) | roulante |
| Swimbait | 135 x 46 x 24 | 59,2 cm3 | 60,0 g | Suspend (1,01) | large |
| Topwater | 104 x 21 x 18 | 19,7 cm3 | 16,7 g | Flotte (0,85) | large |

Un leurre imprime est tres flottant : c'est le lest de plomb interne qui fait le
reglage, exactement comme en fabrication artisanale.
