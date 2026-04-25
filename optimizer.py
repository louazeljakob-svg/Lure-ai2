"""
core/optimizer.py
-----------------
Génère des variantes d'un même design et attribue un score à chacun.

Deux fonctions centrales :
    - score_design : évalue un design déjà construit (sur 100)
    - generate_variants : crée N variantes en perturbant les paramètres

La boucle d'apprentissage (voir learning.py) ajustera les coefficients
de scoring selon les résultats réels de tests sauvegardés.
"""

from copy import deepcopy
from typing import List

from models.lure_design import LureDesign
from core import physics as physics_mod
from core import simulation as sim_mod
from core import rules_engine


# ------------------------------------------------------------------------
# Coefficients de scoring (modifiables par la boucle d'apprentissage)
# ------------------------------------------------------------------------

# Ces poids somment à 100 par défaut.
DEFAULT_WEIGHTS = {
    "depth_match": 25.0,      # La profondeur prédite colle-t-elle à la cible ?
    "buoyancy_match": 20.0,   # L'état de flottabilité correspond ?
    "stability": 20.0,        # Stabilité simulée
    "action_match": 15.0,     # L'action correspond à ce qui a été demandé ?
    "species_fit": 10.0,      # Le type de leurre est adapté à l'espèce ?
    "risk_penalty": 10.0,     # Moins il y a de risques, mieux c'est
}


# ------------------------------------------------------------------------
# Sous-scores individuels
# ------------------------------------------------------------------------

def _score_depth_match(design: LureDesign) -> float:
    """1.0 si profondeur prédite = cible ; 0.0 si écart > 3 m."""
    req = design.user_request
    diff = abs(design.predicted_depth_m - req.target_depth_m)
    return max(0.0, 1.0 - (diff / 3.0))


def _score_buoyancy_match(design: LureDesign) -> float:
    """1.0 si l'état prédit correspond au désiré, 0.3 si proche, 0.0 sinon."""
    req = design.user_request
    if design.buoyancy_state == req.desired_buoyancy:
        return 1.0
    # Suspending est proche des deux autres
    if "suspending" in (design.buoyancy_state, req.desired_buoyancy):
        return 0.4
    return 0.0


def _score_action_match(design: LureDesign) -> float:
    """
    Correspondance entre l'action désirée et le type de leurre généré.
    Matrice expert : quels leurres conviennent à quelle action ?
    """
    req = design.user_request
    mapping = {
        "erratique":  {"jerkbait": 1.0, "glidebait": 0.8, "minnowbait": 0.5},
        "vibration":  {"lipless_crankbait": 1.0, "chatterbait": 0.95, "crankbait_plongeant": 0.6},
        "roll":       {"crankbait_plongeant": 0.9, "minnowbait": 0.85, "minnowbait_long": 0.85},
        "wobble":     {"crankbait_plongeant": 1.0, "minnowbait": 0.8, "minnowbait_long": 0.8},
        "surface":    {"popper": 1.0, "wakebait": 0.95, "frog": 1.0},
        "glide":      {"glidebait": 1.0, "jerkbait": 0.6},
    }
    compat = mapping.get(req.desired_action, {})
    return compat.get(design.lure_type, 0.3)


def _score_species_fit(design: LureDesign) -> float:
    """
    Compatibilité espèce ↔ type de leurre (règle expert).
    """
    req = design.user_request
    mapping = {
        "brochet":     {"minnowbait_long": 1.0, "jerkbait": 0.95, "glidebait": 1.0, "crankbait_plongeant": 0.7, "wakebait": 0.8},
        "maskinongé":  {"glidebait": 1.0, "minnowbait_long": 0.95, "jerkbait": 0.9},
        "doré":        {"jig": 1.0, "minnowbait": 0.85, "crankbait_plongeant": 0.9, "lipless_crankbait": 0.8},
        "achigan":     {"chatterbait": 1.0, "crankbait_plongeant": 0.9, "jerkbait": 0.9, "popper": 0.85, "jig": 0.8, "lipless_crankbait": 0.85},
        "truite":      {"minnowbait": 1.0, "crankbait_plongeant": 0.7},
        "perchaude":   {"jig": 1.0, "minnowbait": 0.8, "lipless_crankbait": 0.7},
    }
    compat = mapping.get(req.species, {})
    return compat.get(design.lure_type, 0.5)


def _score_risk_penalty(design: LureDesign) -> float:
    """Inverse des risques : 1 = aucun risque, 0 = max risque."""
    total_risk = (design.roll_risk + design.balance_risk) / 2.0
    return max(0.0, 1.0 - total_risk)


# ------------------------------------------------------------------------
# Scoring principal
# ------------------------------------------------------------------------

def score_design(design: LureDesign, weights: dict = None) -> LureDesign:
    """
    Calcule le score global (/100) et remplit score_breakdown.
    Modifie le design en place ET le retourne.
    """
    if weights is None:
        weights = DEFAULT_WEIGHTS

    subs = {
        "depth_match":    _score_depth_match(design),
        "buoyancy_match": _score_buoyancy_match(design),
        "stability":      design.stability_score,
        "action_match":   _score_action_match(design),
        "species_fit":    _score_species_fit(design),
        "risk_penalty":   _score_risk_penalty(design),
    }

    total = 0.0
    breakdown = {}
    for k, v in subs.items():
        weighted = v * weights.get(k, 0.0)
        breakdown[k] = round(weighted, 2)
        total += weighted

    design.score = round(total, 2)
    design.score_breakdown = breakdown
    return design


# ------------------------------------------------------------------------
# Génération de variantes
# ------------------------------------------------------------------------

# Recettes de perturbation : chaque variante est un delta appliqué au design.
VARIANT_RECIPES = [
    {
        "label": "variante_plus_court_plus_leger",
        "length_factor": 0.85,
        "ballast_factor": 0.85,
        "bib_angle_delta": 5,
        "cog_delta": -3,
    },
    {
        "label": "variante_plus_long_plus_lourd",
        "length_factor": 1.15,
        "ballast_factor": 1.15,
        "bib_angle_delta": -5,
        "cog_delta": 3,
    },
    {
        "label": "variante_plus_plongeant",
        "length_factor": 1.0,
        "ballast_factor": 1.10,
        "bib_angle_delta": -15,
        "cog_delta": 2,
    },
]


def _rebuild_design_from_params(req, rules_out: dict) -> LureDesign:
    """
    Re-construit un LureDesign complet à partir d'une demande utilisateur
    et d'un dict de paramètres de règles (possiblement perturbés).
    """
    physics_out = physics_mod.compute_physics(rules_out, req)
    sim_out = sim_mod.simulate(physics_out, rules_out, req)

    design = LureDesign(
        user_request=req,
        lure_type=rules_out["lure_type"],
        recommended_colors=rules_out["recommended_colors"],
        bib_type=rules_out["bib_type"],
        bib_angle_deg=rules_out["bib_angle_deg"],
        hook_count=rules_out["hook_count"],
        length_cm=rules_out["length_cm"],
        width_cm=rules_out["width_cm"],
        height_cm=rules_out["height_cm"],
        volume_cm3=physics_out["volume_cm3"],
        target_mass_g=physics_out["target_mass_g"],
        density_g_cm3=physics_out["density_g_cm3"],
        buoyancy_state=physics_out["buoyancy_state"],
        cog_position_pct=physics_out["cog_position_pct"],
        predicted_depth_m=sim_out["predicted_depth_m"],
        stability_score=sim_out["stability_score"],
        action_intensity=sim_out["action_intensity"],
        roll_risk=sim_out["roll_risk"],
        balance_risk=sim_out["balance_risk"],
        behavior_notes=sim_out["behavior_notes"],
        warnings=sim_out["warnings"],
    )
    return design


def generate_variants(base_design: LureDesign, n: int = 3, weights: dict = None) -> List[LureDesign]:
    """
    Génère n variantes du design de base en perturbant les paramètres.
    Chaque variante est re-simulée et re-scorée.
    """
    variants = []
    req = base_design.user_request

    for i, recipe in enumerate(VARIANT_RECIPES[:n]):
        # Partir des règles de base, les perturber
        rules_out = rules_engine.apply_rules(req)

        # Appliquer les deltas
        rules_out["length_cm"] = round(rules_out["length_cm"] * recipe["length_factor"], 2)
        rules_out["width_cm"] = rules_out["length_cm"] / 4.0
        rules_out["height_cm"] = rules_out["length_cm"] / 3.0
        rules_out["bib_angle_deg"] = max(15.0, min(85.0, rules_out["bib_angle_deg"] + recipe["bib_angle_delta"]))

        variant = _rebuild_design_from_params(req, rules_out)
        # Appliquer la perturbation sur le CG (après reconstruction)
        variant.cog_position_pct = max(15.0, min(80.0, variant.cog_position_pct + recipe["cog_delta"]))
        # Re-simuler stabilité avec le nouveau CG
        variant.stability_score = sim_mod.assess_stability(variant.cog_position_pct, variant.lure_type)

        variant.variant_label = recipe["label"]
        variant.parent_id = base_design.design_id

        score_design(variant, weights)
        variants.append(variant)

    return variants
