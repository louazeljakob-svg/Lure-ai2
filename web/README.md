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

Onze gabarits **entierement parametriques** : quatre profils releves sur des
references reelles — Stickbait 165, Irresistible, Ryoshi, Modele 1 (2.5 po) — et
sept generiques — Minnow, Popper, Crankbait, Jerkbait, Spoon, Swimbait, Topwater.

Chaque forme est un **point de depart, jamais une contrainte** : corps, bavette,
details de tete, quincaillerie, plan d'assemblage et livree se reglent
independamment et se melangent librement d'une forme a l'autre.

Chaque vignette est une silhouette SVG generee par le meme code de profil que le
modele 3D : la miniature correspond donc toujours a la piece qui sera imprimee.

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

#### Assemblage en deux coques

Le corps se genere en deux demi-coques imprimables, avec goujons d'alignement sur
la male et logements correspondants dans la femelle. **Aucun booleen CSG n'est
utilise** : les coques sont construites directement dans la parametrisation du
loft. Le choix est mesure, pas dogmatique — sur ce maillage, un booleen laisse
952 aretes non appariees sur 10 643, ce qui interdit un solide STEP et fragilise
le STL ; la construction directe en laisse **zero**, sur les onze formes, les deux
coques et toutes les variantes testees.

Le plan de joint contient toujours l'axe longitudinal, ce qui garantit que chaque
section est coupee en deux arcs — donc que les deux coques se referment. Son
orientation se regle de 0 degre (joint gauche / droite) a 90 degres (dos / ventre).

#### Points d'ancrage places a la main

Le placement des goupilles est manuel : on active le mode depuis le panneau
Assemblage, on clique sur le corps dans la vue 3D (lancer de rayon sur le
maillage), et chaque point engendre **automatiquement** son goujon sur la coque
male, son alesage en vis-a-vis exact sur la femelle, sa portee et sa rainure de
sortie. Les poignees se deplacent au glisser, se reglent finement au slider et
se suppriment. Nombre de points libre : nez, ventre, queue, ou davantage.

La position est stockee en coordonnees **parametriques** (position le long de
l'axe, hauteur dans le plan de joint), pas en (x, y, z) bruts : un ancrage suit
donc la forme quand on la retaille au slider.

Chaque ancrage porte sa propre taille de goupille, sa methode de logement, sa
direction de sortie et sa profondeur. Une portee qui deborderait de la coque ou
en chevaucherait une autre est **signalee en rouge** dans la vue et dans le
panneau, et n'est pas creusee : mieux vaut une coque pleine et fermee qu'une
coque trouee. Les portees elles-memes sont rendues en surbrillance, sans quoi
elles resteraient invisibles puisqu'elles sont creusees dans le plan de joint.

#### Goupille en 8 et logement

Catalogue de cinq tailles reelles (fil 0,6 a 2 mm), avec **selection
proportionnelle** a la longueur du leurre : 40-65 mm en XS 0,6, 65-90 mm en
XS 1,0, 90-140 mm en S, 140-180 mm en M, au-dela en L. La regle de robustesse
prime : un leurre destine aux eaux sales passe en L quelle que soit sa longueur,
parce que c'est la traction qui dimensionne. Le choix reste forcable a la main.

Deux methodes de logement, creusees dans le plan de joint, moitie par coque :

| Methode | Principe |
| --- | --- |
| **Alesage** | Trou cylindrique simple, jeu diametral reglable sur le cercle de la goupille (0,05 mm par defaut : boucle de 6,00 mm -> alesage de 6,05 mm). |
| **Canal** | Le creusement suit la silhouette reelle du fil et laisse en place la matiere interieure a la boucle — c'est elle qui retient la goupille. Offset radial reglable, 0,25 mm par defaut. |

#### Parametres de fabrication

Tous les jeux sont exposes dans l'interface, aucun n'est code en dur : jeu
goupille / alesage (methode A), offset de silhouette et supplement de profil
balaye (methode B), jeu d'emboitement goujon male / alesage femelle, jeu
d'insertion de la bavette. Ce sont des valeurs qui se mesurent sur une machine
et se reajustent.

#### Bavette imprimee ou polycarbonate

En mode **polycarbonate**, le corps recoit une fente d'insertion taillee dans le
plan de joint a l'angle de la bavette, et le gabarit plat s'exporte en DXF ou SVG
aux cotes reelles. Le meme contour sert a la piece imprimee, au gabarit et a la
fente : aucune derive possible entre les trois.

#### Controles de bavette

Position depuis le nez, epaisseur propre, profil de coupe (arrondi, droit,
losange), conge des aretes et vrille sur l'axe propre, en plus de l'angle, de
la longueur et de la largeur. Tout se repercute en temps reel sur la piece
imprimee, sur le gabarit de decoupe et sur la fente d'insertion.

#### Cage de sculpture

Une grille de points de controle superposee au corps. Un glisser vertical sur
une poignee tire ou creuse la peau localement, avec une retombee douce, par
dessus la forme pilotee par les sliders : de quoi rattraper un galbe de ventre
ou une transition tete / corps que les parametres seuls ne decrivent pas. Les
deplacements restent des nombres dans le projet, donc parametriques et
serialises comme le reste.

#### Images de reference

Import d'une photo ou d'un croquis cote, projete sur le plan profil, dessus ou
face, avec decalage, rotation, miroir horizontal et vertical, transparence
reglable et verrouillage du ratio. La **calibration par distance reelle**
recale l'echelle : on pointe deux reperes sur l'image et on saisit la distance
qui les separe en millimetres. Plusieurs references peuvent etre actives sur
des plans differents pour caler la forme sous plusieurs angles, et les
ancrages se posent ensuite en s'alignant dessus. Hors calibration, le plan
image est ignore par le lancer de rayon : le placement vise le leurre, pas
l'image. Les images vivent en memoire du navigateur et ne partent pas dans le
fichier de projet.

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
- **Trois pieces au choix** : assemble, coque male (goujons compris) ou coque
  femelle. La bavette et la caudale, plaques minces qui vivent dans le plan de
  joint, sont tranchees dans ce plan pour se repartir entre les deux coques
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

Les onze gabarits sortent sans erreur ni avertissement de coherence, et leurs
deux coques sont fermees : **zero arete non appariee** sur chacune.

Un leurre imprime est tres flottant : c'est le lest de plomb interne qui fait le
reglage, exactement comme en fabrication artisanale.
