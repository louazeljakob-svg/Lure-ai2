"""
core/simulation.py
------------------
Simulation approximative du comportement d'un leurre dans l'eau.

On ne fait PAS de CFD ici : ce sont des heuristiques physiques
basées sur des relations empiriques connues des fabricants de leurres
(et validées par des décennies d'artisanat halieutique).

Sorties :
    - profondeur de nage prévue (m)
    - stabilité (0 à 1)
    - intensité de l'action (0 à 1)
    - risque de roulement (0 à 1)
    - risque de déséquilibre (0 à 1)
    - notes textuelles
    - warnings
"""


# ------------------------------------------------------------------------
# Profondeur de nage
# ------------------------------------------------------------------------

def predict_swim_depth(lure_type: str, bib_angle_deg: float, length_cm: float, density: float) -> float:
    """
    Profondeur typique atteinte en traction normale.

    Logique :
        - sans bavette → proche de la surface sauf si coulant
        - plus l'angle est faible (vers l'horizontal descendant), plus ça plonge
        - plus la bavette est grande (liée à longueur totale), plus ça plonge
        - un leurre coulant sombre tout seul

    Valeurs issues de la littérature pratique (ex : un crankbait
    de 8 cm avec une longue bavette ~30° atteint typiquement 3-5 m).
    """
    if lure_type == "jig":
        return 10.0  # atteint n'importe quelle profondeur à la verticale
    if lure_type == "popper" or lure_type == "wakebait":
        return 0.1
    if lure_type == "lipless_crankbait":
        # Dépend de la densité : plus dense → plus profond en traction
        if density > 1.02:
            return 2.5
        return 1.2
    if lure_type == "chatterbait":
        return 1.5
    if lure_type == "glidebait":
        return 0.8

    # Crankbait / minnowbait / jerkbait avec bavette
    if bib_angle_deg <= 0:
        base = 0.3
    else:
        # Plus l'angle est petit (plus plongeant), plus ça descend
        # 80° → nage 0.5 m ; 30° → nage 5 m (approximativement linéaire inverse)
        base = max(0.3, (90.0 - bib_angle_deg) / 12.0)

    # Correction longueur : un gros leurre avec grosse bavette plonge plus
    size_factor = length_cm / 8.0  # 8 cm = référence

    # Suspending / coulant plongent un peu plus
    buoy_bonus = 0.0
    if density >= 1.0:
        buoy_bonus = 0.3

    return round(base * size_factor + buoy_bonus, 2)


# ------------------------------------------------------------------------
# Stabilité
# ------------------------------------------------------------------------

def assess_stability(cog_pct: float, lure_type: str) -> float:
    """
    Un leurre est stable quand son CG est cohérent avec son type.
    On définit une "zone idéale" par type et on pénalise l'écart.
    Score retourné : 0 (instable) à 1 (parfait).
    """
    ideal_map = {
        "jig": 25.0,
        "popper": 38.0,
        "wakebait": 40.0,
        "glidebait": 50.0,
        "jerkbait": 50.0,
        "lipless_crankbait": 58.0,
        "chatterbait": 55.0,
        "crankbait_plongeant": 62.0,
        "minnowbait": 60.0,
        "minnowbait_long": 62.0,
    }
    ideal = ideal_map.get(lure_type, 55.0)
    deviation = abs(cog_pct - ideal)
    # Un écart de 20 % = score 0, un écart nul = score 1
    score = max(0.0, 1.0 - (deviation / 20.0))
    return round(score, 3)


# ------------------------------------------------------------------------
# Intensité d'action
# ------------------------------------------------------------------------

def assess_action_intensity(lure_type: str, bib_angle_deg: float, desired_action: str) -> float:
    """
    Intensité (0-1) : à quel point le leurre "bouge" dans l'eau.
        - popper/jerkbait = action ponctuelle → faible en traction continue
        - crankbait à bavette très ouverte (angle haut) = action très ample
        - lipless / chatterbait = vibration constante forte
    """
    if lure_type in ("lipless_crankbait", "chatterbait"):
        return 0.95
    if lure_type == "crankbait_plongeant":
        # Plus la bavette est ouverte (angle ≈ 80°), plus l'action est forte
        return round(min(1.0, bib_angle_deg / 90.0 + 0.3), 3)
    if lure_type == "minnowbait" or lure_type == "minnowbait_long":
        return round(min(1.0, bib_angle_deg / 100.0 + 0.2), 3)
    if lure_type == "jerkbait":
        return 0.45  # action ponctuelle, pas continue
    if lure_type == "glidebait":
        return 0.50
    if lure_type == "popper":
        return 0.30
    if lure_type == "jig":
        return 0.20
    return 0.50


# ------------------------------------------------------------------------
# Risques (roulement, déséquilibre)
# ------------------------------------------------------------------------

def assess_roll_risk(cog_pct: float, width_cm: float, height_cm: float) -> float:
    """
    Un leurre roule (tonneau) quand :
        - son CG est mal latéralisé (on le suppose centré ici par défaut)
        - sa section est ronde (width ≈ height)
        - son CG est trop haut / mal placé longitudinalement

    En v1, on approxime avec le ratio largeur/hauteur :
        ratio ≈ 1.0 → section ronde → risque élevé
        ratio ≈ 0.5 ou 2.0 → aplati → peu de roulement
    """
    if height_cm == 0:
        return 1.0
    ratio = width_cm / height_cm
    # Score de "rondeur" : 1 si section ronde, 0 si très aplati
    roundness = 1.0 - abs(ratio - 1.0)
    roundness = max(0.0, min(1.0, roundness))

    # CG très arrière ou très avant augmente aussi le risque
    cog_penalty = 0.0
    if cog_pct < 30 or cog_pct > 70:
        cog_penalty = 0.2

    return round(min(1.0, roundness * 0.7 + cog_penalty), 3)


def assess_balance_risk(ballast_g: float, target_mass_g: float) -> float:
    """
    Un leurre est déséquilibré si le ballast interne représente
    une part trop élevée ou trop faible de la masse totale.
        - ballast = 0       → corps trop dense, pas de réglage possible
        - ballast > 70 %   → leurre creux ultra-plombé, fragile
    """
    if target_mass_g <= 0:
        return 1.0
    ratio = ballast_g / target_mass_g
    if ratio == 0 and target_mass_g > 0:
        return 0.6  # manque de ballast → action molle
    if ratio > 0.7:
        return 0.8
    if ratio > 0.5:
        return 0.4
    return 0.15


# ------------------------------------------------------------------------
# Warnings textuels
# ------------------------------------------------------------------------

def generate_warnings(physics_out: dict, sim_out: dict, req) -> list:
    """Listes d'alertes et corrections suggérées."""
    warnings = []

    # Ballast impossible (corps trop lourd)
    if physics_out["body_mass_g"] > physics_out["target_mass_g"] + 1:
        warnings.append(
            f"⚠ Le corps brut ({physics_out['body_mass_g']}g) est déjà plus lourd "
            f"que la masse cible ({physics_out['target_mass_g']}g). "
            f"Utilisez un matériau plus léger (ex: balsa) OU réduisez les dimensions."
        )

    # Pas assez profond
    if sim_out["predicted_depth_m"] < req.target_depth_m - 1.0:
        warnings.append(
            f"⚠ Profondeur prédite ({sim_out['predicted_depth_m']}m) inférieure "
            f"à la cible ({req.target_depth_m}m). Envisagez une bavette plus plongeante "
            f"(angle plus petit) ou un leurre plus dense."
        )

    # Trop profond
    if sim_out["predicted_depth_m"] > req.target_depth_m + 1.5:
        warnings.append(
            f"⚠ Profondeur prédite ({sim_out['predicted_depth_m']}m) supérieure "
            f"à la cible ({req.target_depth_m}m). Réduisez la bavette ou la densité."
        )

    # Stabilité faible
    if sim_out["stability_score"] < 0.5:
        warnings.append(
            "⚠ Stabilité faible : ajustez la position du centre de gravité."
        )

    # Risque de roulement
    if sim_out["roll_risk"] > 0.7:
        warnings.append(
            "⚠ Risque de roulement élevé : aplatissez la section ou abaissez le CG."
        )

    return warnings


# ------------------------------------------------------------------------
# Orchestrateur
# ------------------------------------------------------------------------

def simulate(physics_out: dict, rules_out: dict, req) -> dict:
    """
    Rassemble tous les résultats de simulation.
    Retour utilisable directement pour remplir un LureDesign.
    """
    depth = predict_swim_depth(
        lure_type=rules_out["lure_type"],
        bib_angle_deg=rules_out["bib_angle_deg"],
        length_cm=rules_out["length_cm"],
        density=physics_out["density_g_cm3"],
    )
    stab = assess_stability(physics_out["cog_position_pct"], rules_out["lure_type"])
    action = assess_action_intensity(
        rules_out["lure_type"], rules_out["bib_angle_deg"], req.desired_action
    )
    roll = assess_roll_risk(
        physics_out["cog_position_pct"], rules_out["width_cm"], rules_out["height_cm"]
    )
    balance = assess_balance_risk(physics_out["ballast_g"], physics_out["target_mass_g"])

    notes = (
        f"Nage prévue : ~{depth} m. "
        f"Action {int(action*100)}%, stabilité {int(stab*100)}%. "
        f"Roulement {int(roll*100)}%, déséquilibre {int(balance*100)}%."
    )

    out = {
        "predicted_depth_m": depth,
        "stability_score": stab,
        "action_intensity": action,
        "roll_risk": roll,
        "balance_risk": balance,
        "behavior_notes": notes,
    }
    out["warnings"] = generate_warnings(physics_out, out, req)
    return out
