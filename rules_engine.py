"""
core/rules_engine.py
--------------------
Moteur de règles expert pour la sélection du type de leurre, des couleurs,
du type de bavette, etc.

Principe : un ensemble de règles IF/THEN structurées, faciles à lire
et à faire évoluer. Chaque règle est documentée pour comprendre le
raisonnement halieutique derrière.

Les connaissances viennent de la littérature classique de la pêche
(pêche sportive au Québec : brochet, doré, achigan, etc.).
"""

from models.lure_design import UserRequest


# ------------------------------------------------------------------------
# 1. Sélection du TYPE de leurre
# ------------------------------------------------------------------------

def select_lure_type(req: UserRequest) -> str:
    """
    Choix du type de leurre selon la profondeur, l'action désirée et l'espèce.

    Ordre de priorité :
        1. Pêche de surface → popper / wakebait / frog
        2. Action erratique → jerkbait ou glidebait
        3. Action vibration → lipless crankbait ou chatterbait
        4. Profondeur > 3 m → crankbait plongeant ou jig
        5. Sinon → minnowbait classique
    """
    depth = req.target_depth_m
    action = req.desired_action
    species = req.species

    # Règle 1 : surface
    if depth <= 0.3 or action == "surface":
        if species == "brochet":
            return "wakebait"
        if species == "achigan":
            return "popper"
        return "popper"

    # Règle 2 : action erratique
    if action == "erratique":
        return "jerkbait"
    if action == "glide":
        return "glidebait"

    # Règle 3 : vibration forte
    if action == "vibration":
        if depth >= 2.5:
            return "lipless_crankbait"
        return "chatterbait"

    # Règle 4 : profond
    if depth >= 3.0:
        if species == "doré":
            return "jig"
        return "crankbait_plongeant"

    # Règle 5 : défaut
    if species == "brochet" or species == "maskinongé":
        return "minnowbait_long"
    return "minnowbait"


# ------------------------------------------------------------------------
# 2. Sélection des COULEURS
# ------------------------------------------------------------------------

def select_colors(req: UserRequest) -> list:
    """
    Règles couleurs :
        - eau trouble  → couleurs contrastées et vives
        - eau moyenne  → couleurs mixtes
        - eau claire   → couleurs naturelles
        - saison froide (hiver, début printemps) → couleurs discrètes
        - automne doré → orangé / cuivré (imite le frai)
    """
    clarity = req.water_clarity
    season = req.season
    species = req.species

    colors = []

    # Base selon clarté
    if clarity == "trouble":
        colors = ["chartreuse", "orange_fluo", "noir_rouge"]
    elif clarity == "moyenne":
        colors = ["perchaude", "argent_bleu", "blanc_rouge"]
    else:  # claire
        colors = ["naturel_ménomini", "argent_naturel", "ayu"]

    # Ajustement saisonnier
    if season == "automne" and species == "doré":
        colors.insert(0, "orange_cuivre_frai")
    if season == "hiver":
        # Poissons peu actifs → on retire les couleurs trop vives
        colors = [c for c in colors if "fluo" not in c]
        if not colors:
            colors = ["naturel_ménomini"]

    return colors[:3]


# ------------------------------------------------------------------------
# 3. Bavette (lip) — type et angle
# ------------------------------------------------------------------------

def select_bib(req: UserRequest, lure_type: str) -> dict:
    """
    La bavette détermine la profondeur de nage et l'action :
        - angle proche de 90° (horizontal) → nage peu profonde, action large
        - angle proche de 30-45°          → plongée profonde, action serrée
        - pas de bavette                   → popper, jig, jerk sans lip
    """
    # Pas de bavette
    if lure_type in ("popper", "jig", "lipless_crankbait", "chatterbait", "glidebait"):
        return {"type": "aucune", "angle_deg": 0.0}

    depth = req.target_depth_m

    if depth < 1.0:
        return {"type": "courte", "angle_deg": 80.0}
    if depth < 2.5:
        return {"type": "moyenne", "angle_deg": 60.0}
    if depth < 4.5:
        return {"type": "longue", "angle_deg": 45.0}
    # Très profond
    return {"type": "extra_longue", "angle_deg": 30.0}


# ------------------------------------------------------------------------
# 4. Nombre d'hameçons
# ------------------------------------------------------------------------

def select_hook_count(lure_type: str, length_cm: float) -> int:
    """
    - jig / popper court : 1
    - leurres 5-10 cm    : 2
    - leurres 10 cm+     : 3 (ou 2 pour glidebait)
    """
    if lure_type in ("jig", "chatterbait"):
        return 1
    if lure_type == "glidebait":
        return 2
    if length_cm >= 10.0:
        return 3
    return 2


# ------------------------------------------------------------------------
# 5. Dimensions de base selon espèce
# ------------------------------------------------------------------------

def suggest_base_dimensions(req: UserRequest) -> dict:
    """
    Suggère longueur, largeur, hauteur en fonction de l'espèce visée
    et de la longueur max autorisée.

    Les ratios sont des ordres de grandeur observés sur leurres réels.
    """
    species_length = {
        "brochet": 12.0,
        "maskinongé": 18.0,
        "doré": 9.0,
        "achigan": 8.0,
        "truite": 6.0,
        "perchaude": 5.0,
    }
    desired = species_length.get(req.species, 8.0)
    length = min(desired, req.max_length_cm)

    # Ratios corps : largeur = L/4, hauteur = L/3 (approximation minnow)
    width = length / 4.0
    height = length / 3.0

    return {"length_cm": length, "width_cm": width, "height_cm": height}


# ------------------------------------------------------------------------
# Fonction unique d'orchestration (appelée par recommendation.py)
# ------------------------------------------------------------------------

def apply_rules(req: UserRequest) -> dict:
    """
    Applique toutes les règles et retourne un dict structuré
    prêt à être injecté dans un LureDesign.
    """
    lure_type = select_lure_type(req)
    dims = suggest_base_dimensions(req)
    bib = select_bib(req, lure_type)
    hooks = select_hook_count(lure_type, dims["length_cm"])
    colors = select_colors(req)

    return {
        "lure_type": lure_type,
        "recommended_colors": colors,
        "bib_type": bib["type"],
        "bib_angle_deg": bib["angle_deg"],
        "hook_count": hooks,
        "length_cm": dims["length_cm"],
        "width_cm": dims["width_cm"],
        "height_cm": dims["height_cm"],
    }
