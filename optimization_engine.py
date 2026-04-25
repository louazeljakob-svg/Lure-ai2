"""
core/optimization_engine.py
---------------------------
Optimiseur d'AMÉLIORATION : prend un design existant (généré ou importé CAO)
et propose des modifications concrètes pour atteindre les objectifs.

Différent de optimizer.py (V1) : ici on ne génère pas de variantes aléatoires,
on identifie les DÉFAUTS du design actuel par rapport aux objectifs et on
propose des corrections CIBLÉES, chiffrées et explicables.

Sortie : liste d'OptimizationSuggestion classées par priorité.
"""

from __future__ import annotations
from copy import deepcopy
from typing import List

from models.lure_design import LureDesign, OptimizationSuggestion, UserRequest
from core import hydrodynamics, optimizer as scoring


# ============================================================================
# Détection de défauts
# ============================================================================

def diagnose(design: LureDesign) -> List[dict]:
    """
    Identifie les écarts entre le design actuel et les objectifs.
    Retourne une liste de "problèmes" avec leur sévérité.
    """
    issues = []
    req = design.user_request
    if req is None:
        return issues

    # 1. Profondeur cible
    depth_diff = design.predicted_depth_m - req.target_depth_m
    if abs(depth_diff) > 0.5:
        issues.append({
            "type": "depth_mismatch",
            "severity": min(1.0, abs(depth_diff) / 3.0),
            "value": depth_diff,
            "description": (
                f"Profondeur prédite ({design.predicted_depth_m:.1f}m) vs "
                f"cible ({req.target_depth_m:.1f}m), écart {depth_diff:+.1f}m"
            ),
        })

    # 2. Flottabilité
    if design.buoyancy_state != req.desired_buoyancy:
        issues.append({
            "type": "buoyancy_mismatch",
            "severity": 0.7,
            "value": (design.buoyancy_state, req.desired_buoyancy),
            "description": (
                f"Flottabilité actuelle '{design.buoyancy_state}' ≠ désirée '{req.desired_buoyancy}'"
            ),
        })

    # 3. Stabilité faible
    if design.stability_score < 0.6:
        issues.append({
            "type": "low_stability",
            "severity": 1.0 - design.stability_score,
            "value": design.stability_score,
            "description": f"Stabilité faible ({design.stability_score:.2f}/1.0)",
        })

    # 4. Risque de roulement
    if design.roll_risk > 0.6:
        issues.append({
            "type": "high_roll_risk",
            "severity": design.roll_risk,
            "value": design.roll_risk,
            "description": f"Risque de roulement élevé ({design.roll_risk:.2f})",
        })

    # 5. Wobbling hors cible
    if design.wobble_frequency_hz > 0:
        if design.wobble_frequency_hz > 6.0:
            issues.append({
                "type": "wobble_too_fast",
                "severity": 0.5,
                "value": design.wobble_frequency_hz,
                "description": f"Wobbling trop rapide ({design.wobble_frequency_hz:.1f} Hz) — peu naturel",
            })
        elif design.wobble_frequency_hz < 1.0:
            issues.append({
                "type": "wobble_too_slow",
                "severity": 0.4,
                "value": design.wobble_frequency_hz,
                "description": f"Wobbling trop lent ({design.wobble_frequency_hz:.1f} Hz) — leurre paresseux",
            })

    # 6. Amortissement extrême
    if design.wobble_damping > 1.2:
        issues.append({
            "type": "overdamped",
            "severity": 0.5,
            "value": design.wobble_damping,
            "description": f"Trop amorti (ζ={design.wobble_damping:.2f}) — action molle",
        })

    return sorted(issues, key=lambda x: x["severity"], reverse=True)


# ============================================================================
# Génération de modifications (recettes ciblées par défaut)
# ============================================================================

def _apply_modification(design: LureDesign, mod: dict) -> LureDesign:
    """Applique une modification chiffrée et recalcule physique + hydro."""
    new_design = deepcopy(design)
    new_design.parent_id = design.design_id
    new_design.source = "optimized_from"

    import uuid
    new_design.design_id = str(uuid.uuid4())[:8]

    # CG en %
    if abs(mod.get("delta_cog_x_mm", 0)) > 0:
        delta_pct = (mod["delta_cog_x_mm"] / 10.0) / new_design.length_cm * 100.0
        new_design.cog_position_pct = max(15.0, min(85.0, new_design.cog_position_pct + delta_pct))
        # Mettre à jour aussi MassProperties si présent
        if new_design.mass_properties is not None:
            new_design.mass_properties.cog_x_cm += mod["delta_cog_x_mm"] / 10.0

    # Bavette
    if abs(mod.get("delta_bib_angle_deg", 0)) > 0:
        new_design.bib_angle_deg = max(15.0, min(85.0, new_design.bib_angle_deg + mod["delta_bib_angle_deg"]))

    # Ballast → modifie la masse cible
    if abs(mod.get("delta_ballast_g", 0)) > 0:
        new_design.target_mass_g = max(0.5, new_design.target_mass_g + mod["delta_ballast_g"])
        if new_design.volume_cm3 > 0:
            new_design.density_g_cm3 = round(new_design.target_mass_g / new_design.volume_cm3, 3)
            from core import physics as physics_mod
            new_design.buoyancy_state = physics_mod.determine_buoyancy_state(new_design.density_g_cm3)
        if new_design.mass_properties is not None:
            new_design.mass_properties.mass_g = new_design.target_mass_g

    # Longueur (ajout ou réduction simple)
    if abs(mod.get("delta_length_mm", 0)) > 0:
        new_design.length_cm = max(2.0, new_design.length_cm + mod["delta_length_mm"] / 10.0)
        new_design.width_cm = new_design.length_cm / 4.0
        new_design.height_cm = new_design.length_cm / 3.0
        from core import physics as physics_mod
        new_design.volume_cm3 = physics_mod.estimate_volume(
            new_design.length_cm, new_design.width_cm, new_design.height_cm
        )

    # Re-simulations
    from core import simulation as sim_mod
    new_design.stability_score = sim_mod.assess_stability(
        new_design.cog_position_pct, new_design.lure_type
    )
    new_design.action_intensity = sim_mod.assess_action_intensity(
        new_design.lure_type, new_design.bib_angle_deg, new_design.user_request.desired_action if new_design.user_request else "wobble"
    )
    new_design.roll_risk = sim_mod.assess_roll_risk(
        new_design.cog_position_pct, new_design.width_cm, new_design.height_cm
    )
    new_design.predicted_depth_m = sim_mod.predict_swim_depth(
        new_design.lure_type, new_design.bib_angle_deg, new_design.length_cm, new_design.density_g_cm3
    )

    # Hydrodynamique (wobbling)
    hydrodynamics.apply_hydrodynamics(new_design)

    return new_design


def _build_suggestion_from_mod(
    parent: LureDesign,
    new_design: LureDesign,
    mod: dict,
    title: str,
    description: str,
    priority: str,
    improvements: List[str],
    tradeoffs: List[str],
) -> OptimizationSuggestion:
    """Crée un OptimizationSuggestion structuré."""
    return OptimizationSuggestion(
        parent_design_id=parent.design_id,
        title=title,
        description=description,
        priority=priority,
        delta_cog_x_mm=mod.get("delta_cog_x_mm", 0.0),
        delta_ballast_g=mod.get("delta_ballast_g", 0.0),
        delta_bib_angle_deg=mod.get("delta_bib_angle_deg", 0.0),
        delta_length_mm=mod.get("delta_length_mm", 0.0),
        new_design_id=new_design.design_id,
        score_before=parent.score,
        score_after=new_design.score,
        score_delta=round(new_design.score - parent.score, 2),
        expected_improvements=improvements,
        expected_tradeoffs=tradeoffs,
    )


# ============================================================================
# Orchestrateur principal
# ============================================================================

def optimize_existing_design(design: LureDesign, max_suggestions: int = 5) -> dict:
    """
    Génère un ensemble de suggestions d'amélioration ciblées
    pour un design existant.

    Retour :
        {
            "diagnosis": [...],          # liste des défauts identifiés
            "suggestions": [...],        # OptimizationSuggestion classées par priorité
            "optimized_designs": [...],  # designs modifiés correspondants
        }
    """
    # 1. Diagnostic
    issues = diagnose(design)

    # Score actuel pour référence
    from core import learning
    weights = learning.get_learned_weights()
    scoring.score_design(design, weights=weights)

    # 2. Construire des modifications correctives par type de problème
    candidate_mods = []

    for issue in issues:
        t = issue["type"]

        if t == "depth_mismatch":
            # Trop peu profond → bavette plus plongeante (angle plus petit) + ballast
            if issue["value"] < 0:  # pas assez profond
                candidate_mods.append({
                    "title": "Augmenter la profondeur de nage",
                    "description": (
                        "Réduire l'angle de bavette pour la rendre plus plongeante "
                        "et ajouter un peu de ballast pour densifier le leurre."
                    ),
                    "priority": "haute" if abs(issue["value"]) > 1.5 else "moyenne",
                    "mod": {"delta_bib_angle_deg": -15, "delta_ballast_g": 2.5},
                    "improvements": [f"Profondeur de nage augmentée d'environ {abs(issue['value'])*0.6:.1f} m"],
                    "tradeoffs": ["Légère perte de flottabilité", "Action de nage légèrement différente"],
                })
            else:  # trop profond
                candidate_mods.append({
                    "title": "Réduire la profondeur de nage",
                    "description": "Augmenter l'angle de bavette (plus horizontale) et alléger le leurre.",
                    "priority": "moyenne",
                    "mod": {"delta_bib_angle_deg": +15, "delta_ballast_g": -2.0},
                    "improvements": [f"Profondeur réduite d'environ {issue['value']*0.6:.1f} m"],
                    "tradeoffs": ["Action légèrement plus ample"],
                })

        elif t == "buoyancy_mismatch":
            current, desired = issue["value"]
            if desired == "flottant" and current != "flottant":
                candidate_mods.append({
                    "title": "Rendre le leurre flottant",
                    "description": "Réduire significativement la masse interne (ballast).",
                    "priority": "haute",
                    "mod": {"delta_ballast_g": -4.0},
                    "improvements": ["Le leurre flotte au repos", "Récupération en pause possible"],
                    "tradeoffs": ["Profondeur de nage légèrement réduite"],
                })
            elif desired == "coulant" and current != "coulant":
                candidate_mods.append({
                    "title": "Rendre le leurre coulant",
                    "description": "Ajouter du ballast (plomb ou tungstène).",
                    "priority": "haute",
                    "mod": {"delta_ballast_g": +5.0},
                    "improvements": ["Le leurre coule au repos", "Permet la pêche en lent profond"],
                    "tradeoffs": ["Plus difficile à animer en surface"],
                })
            elif desired == "suspending":
                # On vise une densité ≈ 1
                if current == "flottant":
                    candidate_mods.append({
                        "title": "Convertir en suspending",
                        "description": "Ajouter ~2-3 g de ballast pour atteindre la densité neutre.",
                        "priority": "haute",
                        "mod": {"delta_ballast_g": +2.5},
                        "improvements": ["Le leurre reste à profondeur en pause"],
                        "tradeoffs": ["Réglage précis requis (test en eau froide vs chaude)"],
                    })
                else:
                    candidate_mods.append({
                        "title": "Convertir en suspending",
                        "description": "Réduire le ballast pour atteindre la densité neutre.",
                        "priority": "haute",
                        "mod": {"delta_ballast_g": -2.0},
                        "improvements": ["Le leurre reste à profondeur en pause"],
                        "tradeoffs": ["Réglage précis requis"],
                    })

        elif t == "low_stability":
            # Déplacer le CG vers la position idéale
            ideal_cog = 60.0  # par défaut crankbait/minnow
            if design.lure_type == "jig":
                ideal_cog = 25.0
            elif design.lure_type == "popper":
                ideal_cog = 38.0
            elif design.lure_type == "glidebait":
                ideal_cog = 50.0
            current_cog_mm = design.cog_position_pct / 100.0 * design.length_cm * 10.0
            target_cog_mm = ideal_cog / 100.0 * design.length_cm * 10.0
            delta_mm = round(target_cog_mm - current_cog_mm, 1)
            if abs(delta_mm) > 1.0:
                direction = "vers l'arrière" if delta_mm > 0 else "vers le nez"
                candidate_mods.append({
                    "title": f"Déplacer le CG de {abs(delta_mm):.1f} mm {direction}",
                    "description": (
                        f"Le CG idéal pour ce type de leurre est à {ideal_cog:.0f}% de la longueur. "
                        f"Actuellement à {design.cog_position_pct:.0f}%."
                    ),
                    "priority": "haute",
                    "mod": {"delta_cog_x_mm": delta_mm},
                    "improvements": ["Stabilité accrue", "Tenue de cap améliorée"],
                    "tradeoffs": ["Modification interne du ballast nécessaire"],
                })

        elif t == "high_roll_risk":
            candidate_mods.append({
                "title": "Réduire le risque de roulement",
                "description": (
                    "Reculer légèrement le CG et l'abaisser. "
                    "Idéalement aussi aplatir la section (côté CAO)."
                ),
                "priority": "moyenne",
                "mod": {"delta_cog_x_mm": +3.0, "delta_ballast_g": +1.0},
                "improvements": ["Moins de roulement parasite", "Action plus régulière"],
                "tradeoffs": ["Légère hausse de la profondeur de nage"],
            })

        elif t == "wobble_too_fast":
            candidate_mods.append({
                "title": "Ralentir le wobbling",
                "description": (
                    "Augmenter la masse pour augmenter l'inertie (donc baisser la fréquence propre). "
                    "Alternative côté CAO : allonger le leurre."
                ),
                "priority": "moyenne",
                "mod": {"delta_ballast_g": +3.0},
                "improvements": ["Wobbling plus naturel et ample"],
                "tradeoffs": ["Profondeur légèrement augmentée"],
            })

        elif t == "wobble_too_slow":
            candidate_mods.append({
                "title": "Accélérer le wobbling",
                "description": "Réduire la masse OU augmenter l'angle de bavette.",
                "priority": "moyenne",
                "mod": {"delta_bib_angle_deg": +10, "delta_ballast_g": -1.5},
                "improvements": ["Action plus vivante", "Meilleure attraction"],
                "tradeoffs": ["Profondeur de nage réduite"],
            })

        elif t == "overdamped":
            candidate_mods.append({
                "title": "Réduire l'amortissement",
                "description": (
                    "L'amortissement est trop fort : action molle. "
                    "Réduire la traînée en diminuant l'angle de bavette ou alléger."
                ),
                "priority": "basse",
                "mod": {"delta_bib_angle_deg": -8, "delta_ballast_g": -1.0},
                "improvements": ["Vibration plus marquée"],
                "tradeoffs": ["Profondeur légèrement modifiée"],
            })

    # 3. Appliquer chaque modification → suggestion + nouveau design
    suggestions = []
    optimized_designs = []
    seen_keys = set()

    for cand in candidate_mods:
        # Éviter les doublons par signature
        key = (round(cand["mod"].get("delta_cog_x_mm", 0), 1),
               round(cand["mod"].get("delta_ballast_g", 0), 1),
               round(cand["mod"].get("delta_bib_angle_deg", 0), 1))
        if key in seen_keys:
            continue
        seen_keys.add(key)

        new_design = _apply_modification(design, cand["mod"])
        new_design.name = f"{design.name or 'Design'} — {cand['title']}"
        scoring.score_design(new_design, weights=weights)

        sugg = _build_suggestion_from_mod(
            parent=design,
            new_design=new_design,
            mod=cand["mod"],
            title=cand["title"],
            description=cand["description"],
            priority=cand["priority"],
            improvements=cand["improvements"],
            tradeoffs=cand["tradeoffs"],
        )
        suggestions.append(sugg)
        optimized_designs.append(new_design)

    # 4. Trier par delta de score décroissant et limiter
    paired = sorted(
        zip(suggestions, optimized_designs),
        key=lambda x: x[0].score_delta,
        reverse=True,
    )[:max_suggestions]

    if paired:
        suggestions, optimized_designs = zip(*paired)
        suggestions = list(suggestions)
        optimized_designs = list(optimized_designs)
    else:
        suggestions, optimized_designs = [], []

    return {
        "diagnosis": issues,
        "suggestions": suggestions,
        "optimized_designs": optimized_designs,
    }
