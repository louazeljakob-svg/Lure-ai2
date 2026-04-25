"""
core/recommendation.py
----------------------
Orchestrateur principal : assemble tous les modules pour produire
une recommandation complète à partir d'un dict d'entrée utilisateur.

C'est le POINT D'ENTRÉE côté logique métier.
L'interface (Streamlit ou CLI) ne fait qu'appeler `recommend()`.
"""

from typing import Dict, List, Tuple

from core import user_input
from core import rules_engine
from core import physics as physics_mod
from core import simulation as sim_mod
from core import optimizer
from core import learning
from core import hydrodynamics

from models.lure_design import LureDesign


def build_design_from_request(raw_input: dict) -> LureDesign:
    """
    Construit UN design principal (non-scoré encore) depuis un input brut.
    """
    req = user_input.build_user_request(raw_input)

    # 1. Règles expert
    rules_out = rules_engine.apply_rules(req)

    # 2. Physique
    physics_out = physics_mod.compute_physics(rules_out, req)

    # 3. Simulation
    sim_out = sim_mod.simulate(physics_out, rules_out, req)

    # 4. Construction du design
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

    # 5. Suggestions de correction (dérivées des warnings)
    design.suggestions = _derive_suggestions(design, physics_out)

    # 6. Hydrodynamique (V2) — wobbling, fréquence, amplitude
    hydrodynamics.apply_hydrodynamics(design)

    # 7. Corrections apprises (boucle d'apprentissage)
    learning.apply_learned_corrections(design)

    return design


def _derive_suggestions(design: LureDesign, physics_out: dict) -> List[str]:
    """Traduit les warnings en conseils actionnables."""
    sugg = []
    req = design.user_request

    if physics_out["ballast_g"] == 0 and req.desired_buoyancy != "flottant":
        sugg.append(
            "Passez à un matériau plus léger (ex: balsa) OU réduisez les dimensions "
            "pour pouvoir ajouter du ballast interne."
        )
    if design.predicted_depth_m < req.target_depth_m - 0.5:
        sugg.append(
            "Allongez la bavette (type 'longue' ou 'extra_longue') OU réduisez l'angle "
            "de bavette pour descendre plus profond."
        )
    if design.roll_risk > 0.6:
        sugg.append(
            "Aplatissez la section du corps (augmentez la hauteur OU réduisez la largeur) "
            "pour stabiliser."
        )
    if design.stability_score < 0.5:
        sugg.append(
            "Déplacez le centre de gravité de quelques % vers la position idéale "
            "de ce type de leurre."
        )
    if not sugg:
        sugg.append("Design équilibré — aucune correction majeure suggérée.")
    return sugg


def recommend(raw_input: dict, n_variants: int = 3) -> Dict:
    """
    Fonction principale : retourne le design principal + ses variantes,
    toutes scorées avec les poids appris.

    Retour :
        {
            "main":     LureDesign,      # design principal scoré
            "variants": [LureDesign, ...] # variantes scorées
        }
    """
    main_design = build_design_from_request(raw_input)

    # Utiliser les poids APPRIS pour le scoring
    weights = learning.get_learned_weights()

    optimizer.score_design(main_design, weights=weights)
    variants = optimizer.generate_variants(main_design, n=n_variants, weights=weights)

    # On applique aussi les corrections apprises aux variantes
    for v in variants:
        learning.apply_learned_corrections(v)
        optimizer.score_design(v, weights=weights)

    return {"main": main_design, "variants": variants}
