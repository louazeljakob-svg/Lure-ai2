"""
core/physics.py
---------------
Calculs physiques du leurre :
    - volume approximatif (ellipsoïde allongé)
    - densité = masse / volume
    - état de flottabilité (flottant / coulant / suspending)
    - masse cible pour atteindre une flottabilité donnée
    - centre de gravité recommandé

Unités : longueur en cm, masse en g, volume en cm³, densité en g/cm³.
L'eau douce a une densité de référence de 1.0 g/cm³
(1.025 pour l'eau salée, mais on reste en pêche en eau douce).
"""

import math

WATER_DENSITY = 1.0  # g/cm³ — eau douce

# Densités moyennes des matériaux (sec, avant vernis et quincaillerie)
MATERIAL_DENSITY = {
    "bois_cèdre": 0.38,
    "bois_balsa": 0.16,
    "résine": 1.10,
    "plastique": 0.95,
}


# ------------------------------------------------------------------------
# Volume
# ------------------------------------------------------------------------

def estimate_volume(length_cm: float, width_cm: float, height_cm: float) -> float:
    """
    Volume approximé d'un ellipsoïde : V = (4/3) * π * a * b * c
    où a, b, c sont les demi-axes.

    Cette approximation convient pour la grande majorité des leurres
    (corps fuselé). Pour un jig tête ronde + corps, ce serait différent,
    mais on reste volontairement simple en v1.
    """
    a = length_cm / 2.0
    b = width_cm / 2.0
    c = height_cm / 2.0
    return (4.0 / 3.0) * math.pi * a * b * c


# ------------------------------------------------------------------------
# Densité et flottabilité
# ------------------------------------------------------------------------

def compute_density(mass_g: float, volume_cm3: float) -> float:
    """Densité = masse / volume. Garde-fou contre la division par zéro."""
    if volume_cm3 <= 0:
        return 0.0
    return mass_g / volume_cm3


def determine_buoyancy_state(density_g_cm3: float, tolerance: float = 0.03) -> str:
    """
    Classification de flottabilité :
        - densité < 1 - tolérance : flottant
        - densité > 1 + tolérance : coulant
        - sinon                   : suspending (neutre)

    La tolérance de 3 % permet de capter les vrais "suspending",
    qui sont rares et précis.
    """
    if density_g_cm3 < WATER_DENSITY - tolerance:
        return "flottant"
    if density_g_cm3 > WATER_DENSITY + tolerance:
        return "coulant"
    return "suspending"


# ------------------------------------------------------------------------
# Masse cible
# ------------------------------------------------------------------------

def estimate_target_mass(volume_cm3: float, material: str, desired_buoyancy: str) -> float:
    """
    Estime la masse totale cible du leurre fini (corps + poids interne + quincaillerie)
    pour obtenir la flottabilité désirée.

    Principe :
        - On part de la masse du corps brut (volume × densité matériau)
        - Puis on ajoute (ou retire) de la masse pour atteindre la flottabilité voulue.

    Pour un flottant    : densité cible = 0.85 × WATER_DENSITY
    Pour un suspending  : densité cible = 1.00 × WATER_DENSITY
    Pour un coulant     : densité cible = 1.15 × WATER_DENSITY
    """
    target_density_map = {
        "flottant": 0.85,
        "suspending": 1.00,
        "coulant": 1.15,
    }
    target_d = target_density_map.get(desired_buoyancy, 1.00)
    target_mass = volume_cm3 * target_d
    return round(target_mass, 2)


def compute_body_mass(volume_cm3: float, material: str) -> float:
    """Masse du corps brut (avant ajout de poids interne et quincaillerie)."""
    d = MATERIAL_DENSITY.get(material, 0.50)
    return round(volume_cm3 * d, 2)


def compute_ballast_needed(target_mass_g: float, body_mass_g: float, hardware_mass_g: float = 2.0) -> float:
    """
    Poids à ajouter à l'intérieur du leurre (plomb, tungstène...)
    pour atteindre la masse cible.
        ballast = masse_cible - masse_corps - masse_quincaillerie

    Si le résultat est négatif, c'est que le corps seul est déjà trop lourd
    pour la flottabilité voulue → on retourne 0 et le module de simulation
    émettra un warning.
    """
    needed = target_mass_g - body_mass_g - hardware_mass_g
    return max(0.0, round(needed, 2))


# ------------------------------------------------------------------------
# Centre de gravité
# ------------------------------------------------------------------------

def recommend_cog_position(lure_type: str, desired_action: str) -> float:
    """
    Position recommandée du centre de gravité, en % de la longueur
    depuis le nez (0 = nez, 100 = queue).

    Règles :
        - crankbait / minnowbait classique : CG vers l'arrière (60-65 %)
          → nage tête haute, action de nage régulière
        - jerkbait                          : CG centré (45-55 %)
          → permet le "walk the dog" et la dérive latérale
        - lipless / vibration              : CG légèrement arrière (55-60 %)
        - glidebait                         : CG centré parfait (50 %)
        - popper / surface                 : CG à l'avant (35-40 %)
          → la tête reste basse, la queue remonte
        - jig                               : CG très à l'avant (20-30 %)
          → tête plombée classique
    """
    if lure_type == "jig":
        return 25.0
    if lure_type in ("popper", "wakebait"):
        return 38.0
    if lure_type == "glidebait":
        return 50.0
    if lure_type == "jerkbait":
        if desired_action == "erratique":
            return 48.0
        return 52.0
    if lure_type in ("lipless_crankbait", "chatterbait"):
        return 58.0
    # crankbait plongeant, minnowbait, défaut
    return 62.0


# ------------------------------------------------------------------------
# Orchestrateur appelé par recommendation.py
# ------------------------------------------------------------------------

def compute_physics(design_params: dict, req) -> dict:
    """
    Prend les paramètres issus du rules_engine + l'UserRequest
    et retourne tous les résultats physiques.
    """
    L = design_params["length_cm"]
    W = design_params["width_cm"]
    H = design_params["height_cm"]

    volume = estimate_volume(L, W, H)
    target_mass = estimate_target_mass(volume, req.material, req.desired_buoyancy)
    body_mass = compute_body_mass(volume, req.material)
    ballast = compute_ballast_needed(target_mass, body_mass)
    density = compute_density(target_mass, volume)
    buoyancy_state = determine_buoyancy_state(density)
    cog = recommend_cog_position(design_params["lure_type"], req.desired_action)

    return {
        "volume_cm3": round(volume, 2),
        "target_mass_g": target_mass,
        "body_mass_g": body_mass,
        "ballast_g": ballast,
        "density_g_cm3": round(density, 3),
        "buoyancy_state": buoyancy_state,
        "cog_position_pct": cog,
    }
