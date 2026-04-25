# 🎣 Lure AI — IA de conception et d'optimisation de leurres de pêche

Application Python qui conçoit, **importe depuis CAO**, analyse, simule, **visualise en 3D**,
optimise et améliore des leurres de pêche.

**Version 2 — Import SolidWorks + Hydrodynamique + Wobbling 3D + Boucle d'apprentissage**

---

## ✨ Nouveautés V2

- 📐 **Import STL + Mass Properties SolidWorks** : optimisez votre design réel
- 🌊 **Hydrodynamique correcte du wobbling** : oscillateur amorti basé sur le tenseur d'inertie
- 🎨 **Visualisation 3D interactive** (plotly) : modèle statique + animations 2D/3D
- ⚡ **Optimiseur ciblé** : suggestions chiffrées (ex: "déplacer le CG de +5 mm")
- 📊 **Comparaison avant/après** côte à côte
- 🤖 **Boucle d'apprentissage enrichie** : calibration de la fréquence et amplitude du wobbling depuis les observations vidéo

---

## 🧱 Architecture

```
lure_ai/
├── app.py                          # Interface Streamlit (7 onglets)
├── main.py                         # Point d'entrée CLI
├── data/                           # Persistance (créée automatiquement)
│   ├── lure_ai.db                  # SQLite
│   ├── lure_database.csv           # Export CSV
│   ├── test_results.csv
│   ├── learned_params.json         # Paramètres appris
│   └── stl_files/                  # STL uploadés
├── core/
│   ├── user_input.py               # Validation des entrées
│   ├── rules_engine.py             # Moteur de règles expert
│   ├── physics.py                  # Calculs physiques de base
│   ├── simulation.py               # Comportement dans l'eau
│   ├── hydrodynamics.py            # ⭐ V2 : Wobbling, oscillateur amorti
│   ├── cad_import.py               # ⭐ V2 : Import STL + Mass Properties
│   ├── cad_visualizer.py           # ⭐ V2 : Visualisation 3D plotly
│   ├── optimization_engine.py      # ⭐ V2 : Suggestions ciblées
│   ├── optimizer.py                # Scoring + variantes (V1)
│   ├── sketch_generator.py         # Croquis 2D matplotlib
│   ├── database.py                 # SQLite + CSV
│   ├── learning.py                 # Boucle d'apprentissage
│   └── recommendation.py           # Orchestrateur
├── models/
│   └── lure_design.py              # LureDesign, MassProperties, OptimizationSuggestion
├── requirements.txt
└── README.md
```

---

## 📦 Installation

### 1. Prérequis : Python 3.9+

### 2. Installer les dépendances

```bash
cd lure_ai
python -m venv venv
source venv/bin/activate          # Windows : venv\Scripts\activate
pip install -r requirements.txt
```

Dépendances installées :
- `streamlit` : interface web
- `pandas` : données tabulaires
- `matplotlib` : croquis 2D
- `plotly` : visualisations 3D et animations
- `scipy` : équations physiques
- `numpy-stl` : lecture des fichiers STL SolidWorks

---

## ▶️ Lancer le projet

### A. Interface graphique (recommandée)

```bash
streamlit run app.py
```

Ouvre `http://localhost:8501`. **7 onglets** :

| Onglet | Usage |
|---|---|
| 🎯 Design | Génération depuis zéro à partir de paramètres de pêche |
| 📐 Importer CAO | Upload STL + saisie Mass Properties SolidWorks |
| ⚡ Optimiser | Diagnostic + suggestions chiffrées sur un design existant |
| 🌊 Wobbling 3D | Modèle 3D + animations 2D/3D du wobbling |
| 🧪 Tests réels | Saisie observations terrain (avec mesures vidéo) |
| 📚 Historique | Tous les designs et tests sauvegardés |
| 🤖 Apprentissage | Recalcul des paramètres appris |

### B. Mode CLI

```bash
python main.py                    # démo complète
python main.py --list             # liste les designs en base
python main.py --retrain          # recalcule les paramètres appris
python main.py --sketch <id>      # régénère un croquis 2D
```

---

## 🧭 Workflow recommandé pour une vraie optimisation

```
1. Modéliser le leurre dans SolidWorks
2. Évaluer → Mass Properties → Copier le rapport texte
3. Fichier → Enregistrer sous → STL (binaire, mm)
4. Dans Lure AI :
   → Onglet 📐 Importer CAO
   → Upload du STL
   → Coller le rapport SolidWorks (parsing automatique)
   → Définir les objectifs (espèce, profondeur cible, etc.)
   → Bouton "📥 Importer ce design"
5. Onglet ⚡ Optimiser
   → Lancer l'analyse
   → Lire les suggestions classées par gain de score
   → Chaque suggestion : modifications chiffrées + comparaison wobbling avant/après
6. Onglet 🌊 Wobbling 3D
   → Voir le modèle 3D oscillateur en animation
7. Appliquer la modification dans SolidWorks (ex: déplacer le CG de +5 mm)
8. Refabriquer le prototype
9. Tester en eau (filmer la nage)
10. Mesurer la fréquence et l'amplitude du wobbling sur la vidéo
11. Onglet 🧪 Tests réels → enregistrer les observations
12. Onglet 🤖 Apprentissage → bouton "Relancer l'apprentissage"
    → l'IA recalibre ses prédictions pour les prochains designs
```

---

## 📐 Format des Mass Properties

Le module `cad_import.py` accepte un copier-coller direct du rapport SolidWorks.
Format type :

```
Masse = 25.34 grammes
Volume = 67.21 cm³
Surface = 92.15 cm²
Densité = 0.377 g/cm³

Centre de masse : ( cm )
    X = 4.521
    Y = -0.012
    Z = -0.483

Moments d'inertie : ( g·cm² )
Pris au centre de gravité, aligné avec le système de coordonnées de la pièce :
    Lxx = 12.345    Lxy = 0.001    Lxz = -0.045
    Lyx = 0.001     Lyy = 78.901   Lyz = 0.012
    Lzx = -0.045    Lzy = 0.012    Lzz = 80.123
```

Convention :
- Origine = nez du leurre
- X = longueur (nez vers queue)
- Y = largeur (latéral)
- Z = hauteur (vertical)
- L'axe **Z** est l'axe principal du wobbling (lacet)

---

## 🌊 Modèle hydrodynamique du wobbling

Le wobbling est modélisé comme un **oscillateur amorti forcé** :

```
I·θ̈ + c·θ̇ + k·θ = F(t)
```

avec :
- **I** = moment d'inertie autour de Z (Izz depuis SolidWorks ou estimé)
- **k** = raideur de redressement (force latérale × bras de levier CoG↔CoP)
- **c** = amortissement hydrodynamique (Cd · ρ · v · S · L²)
- **F(t)** = forçage périodique de la bavette

On en tire :
- **Fréquence propre** : `f = √(k/I) / 2π` (Hz)
- **Amortissement** : `ζ = c / (2√(Ik))` (sans dimension)
- **Amplitude** : amplifiée par bib_angle, vitesse, atténuée par ζ

Limites :
- Linéarisé (petits angles)
- Pas de turbulence, pas de cavitation
- Vitesse de traction supposée constante (1 m/s par défaut)

Pour une vraie CFD → OpenFOAM, hors scope.

---

## 🤖 Boucle d'apprentissage (V2)

Stockée dans `data/learned_params.json` :

```json
{
  "depth_bias_m": 0.75,            // correcteur additif sur la profondeur
  "stability_scale": 0.85,         // calibration des notes de stabilité
  "wobble_freq_scale": 1.12,       // V2 : fréquence prédite × 1.12
  "wobble_amp_scale": 0.93,        // V2 : amplitude prédite × 0.93
  "weights": { ... },              // poids du score ajustés par corrélation
  "n_tests_used": 4
}
```

À chaque test enregistré avec **observation vidéo du wobbling**, l'IA recalcule
ces facteurs pour mieux prédire les prochains designs.

**Minimum pour déclencher l'apprentissage : 3 tests.**

---

## 🚀 Pistes d'amélioration

- **V3 — Analyse vidéo automatique** (OpenCV) : détecter automatiquement la fréquence
  et l'amplitude du wobbling sur la vidéo, sans saisie manuelle
- **V3 — Export modifications STL** : appliquer directement les suggestions au STL
  (déplacement du CG par décalage du ballast interne)
- **V4 — ML supervisé** : remplacer les règles par une régression boostée (XGBoost)
  une fois 50+ tests enregistrés
- **V4 — Optimisation génétique** : algorithme évolutionnaire pour explorer
  l'espace de paramètres de manière plus large

---

## 📄 Licence

Libre d'utilisation. Bon montage et bonne pêche ! 🎣
