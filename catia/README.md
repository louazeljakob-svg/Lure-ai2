# Macros CATIA V5 : raccords NEMA sur disjoncteur

Ces macros servent à poser automatiquement les raccords (ex. `234D`) sur les plages NEMA d'un disjoncteur. Elles sont faites pour CATIA V5 en français, en environnement SmarTeam, dans l'atelier Assembly Design.

Elles travaillent **seulement dans le CATProduct** : instances, positions et contraintes. Elles ne modifient jamais les CATPart et elles ne sauvegardent jamais rien.

| Fichier | Rôle |
|---|---|
| `vba/modPlacementNEMA.bas` | Outil de placement : tout le calcul (détection, mesures, prépositionnement, contraintes) |
| `vba/frmPlacementNEMA.frm` | Fenêtre de l'outil de placement (boutons Création, Face suivante, Axes suivants) |
| `Inspecter_Contraintes.CATScript` | Relevé en lecture seule : publications, contraintes, géométrie, trous occupés |
| `outils/vblint.py` | Vérificateur de syntaxe utilisé pendant le développement |

---

## 1. Récupérer les fichiers

Les fichiers `.bas`, `.frm` et `.CATScript` sont enregistrés en **Windows-1252** avec des fins de ligne Windows (CRLF). C'est ce que CATIA et l'éditeur VBA lisent correctement sur un poste Windows en français.

- Sur GitHub, ouvrez chaque fichier puis cliquez sur **Download raw file**.
- Si vous faites un copier-coller dans le Bloc-notes, enregistrez en **ANSI** et non en UTF-8.
- Si les accents s'affichent mal (par ex. `Ã©` au lieu de `é`), c'est un problème d'encodage du fichier.

Placez les fichiers dans un dossier à vous, par exemple `C:\CATIA_Macros\`.

## 2. Installer l'outil de placement (projet CATVBA)

La fenêtre est un UserForm VBA, comme l'outil « Instanciation NEMA ». Il faut donc un projet `.catvba`. Cette installation se fait une seule fois.

1. Dans CATIA : **Outils > Macro > Macros...** (`Alt + F8`), puis **Bibliothèques de macros...**.
2. Type de bibliothèque : **Projets VBA**. Cliquez sur **Créer une bibliothèque...** et enregistrez par exemple `C:\CATIA_Macros\PlacementNEMA.catvba`. Fermez.
3. Ouvrez l'éditeur : **Outils > Macro > Éditeur Visual Basic** (`Alt + F11`).
4. Sélectionnez le projet `PlacementNEMA` à gauche, puis **Fichier > Importer un fichier...** :
   - importez `modPlacementNEMA.bas` ;
   - importez `frmPlacementNEMA.frm`.
5. **Débogage > Compiler** : il ne doit y avoir aucune erreur.
6. Enregistrez (`Ctrl + S`) et fermez l'éditeur.

**Si l'import du `.frm` échoue** (message sur un fichier `.frx` manquant) :

1. **Insertion > UserForm**.
2. Dans la fenêtre Propriétés, mettez `(Name)` à `frmPlacementNEMA`.
3. Faites clic droit sur le UserForm > **Code**.
4. Ouvrez `frmPlacementNEMA.frm` dans le Bloc-notes et copiez tout depuis la ligne `'====...` qui suit les lignes `Attribute`, jusqu'à la fin. Collez dans la fenêtre de code.

Tous les boutons et champs sont créés par le code à l'ouverture. Il n'y a rien à dessiner.

## 3. Lancer une macro

### Par le menu

1. Ouvrez le CATProduct dans CATIA.
2. **Outils > Macro > Macros...** (`Alt + F8`).
3. Choisissez la bibliothèque :
   - pour l'outil de placement : `PlacementNEMA.catvba`, macro `CATMain` ;
   - pour l'inspection : le dossier `C:\CATIA_Macros\`, à ajouter une fois avec le type **Répertoires**, macro `Inspecter_Contraintes.CATScript`.
4. Cliquez sur **Exécuter**.

### Par une icône dans une barre d'outils

1. **Outils > Personnaliser...**, onglet **Commandes**.
2. Dans la liste des catégories, choisissez **Macros**.
3. Glissez la macro vers une barre d'outils.
4. Le bouton **Afficher les propriétés...** permet de choisir une icône.

## 4. Utiliser la fenêtre « Placement raccords NEMA »

À l'ouverture, l'outil cherche tout seul :

- le **disjoncteur** : l'instance qui publie `Face NEMA 1` ;
- le **raccord modèle** : l'instance qui publie `Face NEMA.1` et `Point CABLE.1` (ex. `234D.1`).

Les deux champs du haut montrent ce qui a été trouvé, avec le nombre d'axes du raccord et le nombre de faces NEMA du disjoncteur.

| Contrôle | Action |
|---|---|
| **Analyser raccord sélectionné** | La fenêtre se cache. Cliquez le raccord dans l'arbre ou la vue 3D. À utiliser si la détection automatique n'a rien trouvé ou a trouvé plusieurs références. |
| **Analyser disjoncteur sélectionné** | Même chose pour le disjoncteur. |
| **Contraintes** | « Face + tous les axes du raccord » (par défaut) ou « Face + axes de l'exemple ». |
| **Orientation face** | Automatique (par défaut), Sens opposé ou Même sens. |
| **Ignorer les faces déjà équipées** | Une face déjà citée par une contrainte ne reçoit pas de nouveau raccord. |
| **Table des axes** | Vide = correspondance directe (`Axe NEMA.1` → `Axe NEMA n.1`, etc.). Sinon, une liste comme `3,4,5,6`. |
| **Rotation 180°** | Inverse la table (1,2,3,4 devient 4,3,2,1) : le raccord tourne d'un demi-tour sur sa plage. |
| **Création** | Pose **d'un seul coup** un raccord sur chaque Face NEMA libre. |
| **Face suivante** | Déplace le raccord courant (le dernier posé) sur la face libre suivante. Si toutes les faces sont équipées, le raccord de la face suivante devient le raccord courant. |
| **Axes suivants** | Repose le raccord courant sur la même face avec l'appariement de trous suivant (décalé ou tourné, jamais retourné). |
| **Fermer** | Ferme la fenêtre. Si la macro a ajouté une contrainte Fixe, elle demande s'il faut la supprimer. |

Si aucun raccord courant n'existe (fenêtre rouverte plus tard), **Face suivante** et **Axes suivants** demandent de cliquer sur le raccord à corriger.

### Ce que fait « Création », face par face

1. **Contrainte Fixe** : si le disjoncteur n'est pas fixé, la macro ajoute une contrainte Fixe par protection. Quand tous les raccords sont posés, elle demande s'il faut la supprimer. Si vous répondez Non, la question revient à la fermeture de la fenêtre.
2. **Instance** : les instances libres du raccord (ex. `234D.1`, sans contrainte) sont réutilisées d'abord. Ensuite, la macro crée de nouvelles instances de la même référence : `234D.2`, `234D.3`... Seul le **nom d'instance** est fixé. Le PartNumber (pièce de catalogue) ne change pas.
3. **Prépositionnement** : la macro mesure la face et les trous de la plage, puis la face et les axes du raccord. Elle calcule le déplacement qui amène chaque `Axe NEMA.k` sur son trou, puis l'applique avec `Move.Apply`. Si l'écart reste trop grand, elle utilise `Position.SetComponents` à la place.
4. **Contraintes** : 1 coïncidence `Face NEMA.1` ↔ `Face NEMA n`, puis 1 coïncidence par axe du raccord : `Axe NEMA.k` ↔ `Axe NEMA n.k`. Un raccord à 4 trous reçoit donc 5 contraintes. Le nombre de raccords posés est égal au nombre de `Face NEMA n` du disjoncteur.
5. **Mise à jour et contrôle** : la macro met à jour le produit et vérifie que chaque axe est sur son trou (écart inférieur à 0,2 mm). En orientation automatique, si le raccord s'est retourné, elle inverse l'orientation de la face et refait la mise à jour.

À la fin, la fenêtre affiche le bilan : raccords posés, contraintes créées, contraintes en erreur, faces déjà équipées, échecs.

### Journal

Chaque session écrit un journal horodaté sur le Bureau : `Placer_Raccords_NEMA_AAAA-MM-JJ_HHhMMmSSs.txt`. Il contient chaque étape, chaque Reference créée, chaque contrainte et chaque erreur. Son chemin est affiché en bas de la fenêtre. En cas de problème, c'est ce fichier qu'il faut m'envoyer.

## 5. Paramètres (en haut de `modPlacementNEMA.bas`)

Les cinq premiers sont les valeurs par défaut des options de la fenêtre.

| Constante | Défaut | Rôle |
|---|---|---|
| `TABLE_AXES` | `""` | k-ième valeur = trou `j` de la plage (`Axe NEMA n.j`) qui reçoit `Axe NEMA.k`. Vide = correspondance directe, comme sur le dessin. |
| `MODE_CONTRAINTES` | `"COMPLET"` | `COMPLET` : face + tous les axes du raccord. `EXEMPLE` : face + les axes de `AXES_MODE_EXEMPLE`. |
| `AXES_MODE_EXEMPLE` | `"1,2"` | Axes contraints en mode `EXEMPLE`. |
| `ORIENTATION_FACE` | `"AUTO"` | `AUTO`, `OPPOSE` (`catCstOrientOpposite`) ou `MEME` (`catCstOrientSame`). |
| `ROTATION_180` | `False` | Inverse la table des axes (demi-tour du raccord). |
| `IGNORER_FACES_DEJA_EQUIPEES` | `True` | Permet de relancer sans doublon. |
| `PREPOSITIONNER` | `True` | Déplacer le raccord avant de contraindre. |
| `PASSER_EN_MODE_CONCEPTION` | `True` | Charge les pièces pour lire les publications et mesurer. |
| `TOLERANCE_MM` | `0.2` | Écart maximal accepté au contrôle final. |
| `PUB_...` | | Noms des publications, à changer si la convention change. |

**Mode COMPLET et surcontrainte** : des axes parallèles coïncidents sont redondants entre eux. CATIA peut donc afficher une contrainte en jaune ou en rouge même si la position est bonne. Dans ce cas, choisissez « Face + axes de l'exemple » dans la fenêtre et relancez sur les faces concernées.

## 6. `Inspecter_Contraintes.CATScript` (relevé en lecture seule)

C'est utile pour vérifier un assemblage avant ou après le placement, ou pour me donner des informations si l'outil de placement échoue. Le fichier `.txt` est horodaté et créé sur le Bureau. À la fin, la macro propose de l'ouvrir dans le Bloc-notes.

| Section | Contenu |
|---|---|
| 0 | Document actif, `Name` et `PartNumber` du produit racine, version de CATIA |
| 1 | Valeurs des énumérations vues par CATIA (`catCstTypeOn`, `catCstOrientOpposite`, `DESIGN_MODE`...), pour confirmer les valeurs numériques utilisées par l'outil de placement |
| 1b | Passage en mode Conception |
| 2 | Arbre des instances : nom, PartNumber, document, position (12 composantes), liste des publications |
| 2b | Instances reconnues : le disjoncteur (`Face NEMA 1`) et les raccords (`Face NEMA.1`) |
| 3 | Toutes les contraintes du produit racine : nom, type, orientation, mode, statut, `DisplayName` de chaque élément |
| 4 | Synthèse par raccord : quelle face et quels trous sont contraints |
| 5 | Géométrie mesurée de chaque publication NEMA, et test des formats de nom pour `CreateReferenceFromName` |
| 6a | Motif des trous de chaque plage et du raccord : coordonnées, entraxes |
| 6b | Toutes les poses géométriquement possibles du raccord sur une plage, avec la table correspondante |
| 6c | Pour chaque raccord déjà posé : trou occupé par chacun de ses axes, sens des normales, côté du `Point CABLE.1` |
| 7 | Résumé |

Ses paramètres (`MESURER_GEOMETRIE`, `PASSER_EN_MODE_CONCEPTION`, `TOLERANCE_MM`...) sont en haut du fichier. Elle ne déplace rien, ne crée aucune contrainte et ne sauvegarde rien.

## 7. Vérifications après le placement

- [ ] Aucune contrainte en rouge ou en jaune dans l'arbre (faire une mise à jour avec `Ctrl + U` si besoin).
- [ ] Chaque raccord est du bon côté de sa plage : il est appuyé contre la plage, pas à l'intérieur du disjoncteur.
- [ ] Le `Point CABLE.1` de chaque raccord est orienté vers l'extérieur du disjoncteur.
- [ ] Il y a un raccord par plage, sans doublon si l'outil a été relancé.
- [ ] Les nouvelles instances ont le bon nom (`234D.2`...) et le même PartNumber que `234D.1`.
- [ ] La contrainte Fixe ajoutée par l'outil est supprimée, si vous ne voulez pas la garder.
- [ ] Contrôle optionnel : lancer `Inspecter_Contraintes.CATScript`. La section 6c montre les trous occupés et le côté du `Point CABLE.1`.
- [ ] Si tout est bon, enregistrer le CATProduct vous-même.

Si un raccord est mal posé : sélectionnez-le avec **Face suivante** (qui fait défiler les raccords quand toutes les faces sont équipées), puis utilisez **Axes suivants** jusqu'à la bonne position.

## 8. En cas de problème

- **Erreur de compilation à l'import** : notez la ligne surlignée en jaune et le message, puis envoyez-les-moi.
- **« Le document actif doit être un CATProduct »** : la fenêtre active doit être celle du CATProduct, pas celle d'une pièce.
- **« Reference impossible »** : aucun format de nom n'a marché. Le journal montre les essais (`échec F1`, `F2`, `F3`) et la réponse de CATIA.
- **« Contrainte Fixe impossible »** : le placement continue, mais sans protection. Fixez le disjoncteur à la main si besoin, puis relancez.
- **Écart après mise à jour** : le raccord est contraint mais pas exactement sur ses trous. Essayez **Axes suivants**, ou changez l'orientation de la face, puis envoyez-moi le journal si le problème reste.
- **Publications illisibles** : la pièce est sans doute en mode Visualisation. Laissez `PASSER_EN_MODE_CONCEPTION = True`, ou faites clic droit sur le produit racine > **Représentations > Mode Conception**.

## 9. Pour le développement

Je ne peux pas lancer CATIA. Avant chaque livraison, je passe donc `outils/vblint.py` sur les fichiers. Il contrôle :

- l'équilibre des blocs ;
- les variables non déclarées et les déclarations en double ;
- le nombre d'arguments des appels.

Les calculs géométriques (appariements, matrice de placement) sont aussi testés à part. Ces contrôles ne remplacent pas un essai dans CATIA.

```
python outils/vblint.py Inspecter_Contraintes.CATScript
python outils/vblint.py vba/modPlacementNEMA.bas vba/frmPlacementNEMA.frm
```
