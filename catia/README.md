# Macros CATIA V5 : raccords NEMA sur disjoncteur

Ce dossier contient des macros CATScript pour CATIA V5 en français (environnement SmarTeam, atelier Assembly Design).
Elles servent à poser automatiquement les raccords (ex. `234D`) sur les plages NEMA d'un disjoncteur.

Les macros travaillent **seulement dans le CATProduct**. Elles ne modifient jamais les CATPart et elles ne sauvegardent jamais rien.

| Fichier | Rôle | État |
|---|---|---|
| `Inspecter_Contraintes.CATScript` | Relevé en lecture seule : publications, contraintes, géométrie, trous occupés | Livré, à tester |
| `Placer_Raccords_NEMA.CATScript` | Macro principale : pose les raccords et crée les contraintes | À venir, après le résultat de l'inspection |

---

## 1. Récupérer les fichiers

Les fichiers `.CATScript` sont enregistrés en **Windows-1252** avec des fins de ligne Windows (CRLF). C'est l'encodage que CATIA lit correctement sur un poste Windows en français.

- Sur GitHub, ouvrez le fichier puis cliquez sur **Download raw file**.
- Si vous faites un copier-coller dans le Bloc-notes, enregistrez en **ANSI** et non en UTF-8.
- Si les accents des messages s'affichent mal (par ex. `Ã©` au lieu de `é`), c'est un problème d'encodage du fichier. La macro fonctionne quand même.

Placez les macros dans un dossier à vous, par exemple `C:\CATIA_Macros\`.

## 2. Lancer une macro

### Par le menu

1. Ouvrez le CATProduct dans CATIA.
2. **Outils > Macro > Macros...** (raccourci `Alt + F8`).
3. La première fois seulement, cliquez sur **Bibliothèques de macros...**. Choisissez le type **Répertoires**, puis **Ajouter une bibliothèque existante...**, puis sélectionnez le dossier `C:\CATIA_Macros\`. Fermez.
4. Sélectionnez la macro dans la liste, puis cliquez sur **Exécuter**.

### Par une icône dans une barre d'outils

1. **Outils > Personnaliser...**, onglet **Commandes**.
2. Dans la liste des catégories, choisissez **Macros**.
3. Glissez la macro vers une barre d'outils.
4. Le bouton **Afficher les propriétés...** permet de choisir une icône.

## 3. Ordre d'utilisation

1. **Inspection du modèle d'exemple**, celui avec les raccords `234-610.1` à `234-610.6` posés à la main.
   Elle donne les contraintes exactes (`Fixe.1`, `Coïncidence.xx`) et les trous réellement occupés.
2. **Inspection de l'assemblage à équiper**, avec le disjoncteur et la première instance `234D.1` déjà insérée.
   Elle vérifie les noms des publications et le format des References, et elle calcule les poses possibles du `234D` sur une plage.
3. **Renvoyez-moi les deux fichiers journaux** (`Inspection_Contraintes_....txt`, sur le Bureau).
4. Je remplis `TABLE_AXES` et les autres paramètres de la macro principale à partir de ces journaux.
5. Lancement de `Placer_Raccords_NEMA.CATScript` sur l'assemblage à équiper, puis vérification (section 6).

## 4. `Inspecter_Contraintes.CATScript`

### Ce qu'elle écrit dans le journal

Le fichier `.txt` est horodaté et créé sur le Bureau. S'il n'y a pas de Bureau accessible, il va dans le dossier temporaire de Windows. À la fin, la macro propose de l'ouvrir dans le Bloc-notes.

| Section | Contenu |
|---|---|
| 0 | Document actif, `Name` et `PartNumber` du produit racine, version de CATIA |
| 1 | Valeurs des énumérations vues par CATIA (`catCstTypeOn`, `catCstOrientOpposite`, `DESIGN_MODE`...), pour confirmer les valeurs numériques |
| 1b | Passage en mode Conception (charge les pièces pour lire les publications) |
| 2 | Arbre des instances : nom, PartNumber, document, position (12 composantes), liste des publications |
| 2b | Instances reconnues : le disjoncteur (il a `Face NEMA 1`) et les raccords (ils ont `Face NEMA.1`) |
| 3 | Toutes les contraintes du produit racine : nom, type, orientation, mode, statut, `DisplayName` de chaque élément |
| 4 | Synthèse par raccord : quelle face et quels trous sont contraints, et si la correspondance est la même pour tous |
| 5 | Géométrie mesurée de chaque publication NEMA, et test des formats de nom pour `CreateReferenceFromName` |
| 6a | Motif des trous de chaque plage et du raccord : coordonnées dans le plan de la face, entraxes |
| 6b | Toutes les poses géométriquement possibles du raccord sur une plage, avec la valeur de `TABLE_AXES` correspondante |
| 6c | Pour chaque raccord déjà posé : trou occupé par chacun de ses 4 axes (même ceux qui ne sont pas contraints), sens des normales, côté du `Point CABLE.1` |
| 7 | Résumé à me renvoyer |

### Paramètres (en haut du fichier)

| Constante | Défaut | Rôle |
|---|---|---|
| `MESURER_GEOMETRIE` | `True` | Sections 5 et 6. Mettre `False` pour un relevé rapide sans mesures. |
| `PASSER_EN_MODE_CONCEPTION` | `True` | Charge les pièces pour pouvoir lire leurs publications. Aucune donnée n'est modifiée. |
| `OUVRIR_JOURNAL_A_LA_FIN` | `True` | Propose d'ouvrir le journal à la fin. |
| `PROFONDEUR_MAX` | `4` | Profondeur maximale de l'arbre parcouru. |
| `INDICE_MAX` | `12` | Plus grand numéro testé pour les faces et les trous (20 au plus). |
| `TOLERANCE_MM` | `0.5` | Écart maximal (mm) pour dire que deux axes coïncident. |
| `TOLERANCE_ANGLE_DEG` | `1` | Écart angulaire maximal pour dire que deux axes sont parallèles. |
| `PUB_FACE_DISJ`, `PUB_AXE_DISJ`, `PUB_FACE_RAC`, `PUB_AXE_RAC`, `PUB_CABLE_RAC` | | Noms des publications, à changer si la convention change. |

### Ce qu'elle ne fait pas

Elle ne déplace rien, ne crée aucune contrainte, ne modifie aucune pièce et ne sauvegarde rien. Vous pouvez fermer le produit sans enregistrer après l'inspection.

## 5. `Placer_Raccords_NEMA.CATScript` (à venir)

Elle sera écrite une fois les journaux d'inspection reçus. Ses paramètres prévus sont `TABLE_AXES`, `MODE_CONTRAINTES` (`EXEMPLE` ou `COMPLET`), `ORIENTATION_FACE`, la rotation de 180° et `IGNORER_FACES_DEJA_EQUIPEES`.

## 6. Vérifications après la macro principale

- [ ] Aucune contrainte en rouge ou en jaune dans l'arbre (faire une mise à jour avec `Ctrl + U` si besoin).
- [ ] Chaque raccord est du bon côté de sa plage : il est appuyé contre la plage, pas à l'intérieur du disjoncteur.
- [ ] Le `Point CABLE.1` de chaque raccord est orienté vers l'extérieur du disjoncteur.
- [ ] Il y a un raccord par plage, sans doublon si la macro a été relancée.
- [ ] Contrôle optionnel : relancer `Inspecter_Contraintes.CATScript`. La section 6c montre les trous occupés et le côté du `Point CABLE.1`.
- [ ] Si tout est bon, enregistrer le CATProduct vous-même.

## 7. En cas de problème

- **« Le document actif doit être un assemblage »** : la fenêtre active doit être celle du CATProduct, pas celle d'une pièce.
- **« Publications : ILLISIBLES »** : la pièce est sans doute en mode Visualisation. Laissez `PASSER_EN_MODE_CONCEPTION = True`, ou faites clic droit sur le produit racine > **Représentations > Mode Conception**.
- **« NON MESURABLE » partout en section 5** : aucun format de nom n'a fonctionné. Envoyez-moi le journal, les lignes `essai F1/F2/F3` montrent ce que CATIA a répondu.
- **Erreur imprévue** : la macro écrit `!! ERREUR` dans le journal et passe à la suite. Envoyez-moi le journal complet.

## 8. Pour le développement

`outils/vblint.py` est un petit vérificateur que j'utilise avant chaque livraison, puisque je ne peux pas lancer CATIA. Il contrôle l'équilibre des blocs, les variables non déclarées et le nombre d'arguments des appels. Il ne remplace pas un essai dans CATIA.

```
python outils/vblint.py Inspecter_Contraintes.CATScript
```
