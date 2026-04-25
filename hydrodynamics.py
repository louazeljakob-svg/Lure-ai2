"""
core/hydrodynamics.py
---------------------
Hydrodynamique simplifiée mais physiquement correcte pour prédire
le comportement d'un leurre dans l'eau.

Modèle :
    On traite le leurre comme un oscillateur amorti forcé par la traînée
    asymétrique de la bavette. Les équations sont des approximations
    des relations utilisées dans la conception de leurres
    (Crawford 2007, Patenaude & White 1989) :

        I·θ̈ + c·θ̇ + k·θ = F(t)

    où :
        I = moment d'inertie autour de l'axe de wobbling (Izz)
        c = coefficient d'amortissement (lié à la traînée et à la viscosité)
        k = raideur de redressement (couple de redressement / angle)
        F(t) = forçage périodique de la bavette

    On en tire la fréquence propre, l'amortissement et l'amplitude.

Limites :
    - Petits angles (linéarisé)
    - Pas de turbulence
    - Vitesse de traction supposée constante
    Pour une vraie CFD → openFOAM, hors scope.
"""

from __future__ import annotations
import math
from typing import Optional

from models.lure_design import LureDesign, MassProperties

# Constantes physiques
WATER_DENSITY_KG_M3 = 1000.0    # eau douce
WATER_VISCOSITY = 1.0e-3        # Pa·s à 20°C
GRAVITY = 9.81                  # m/s²

# Vitesse de traction typique en pêche (m/s)
DEFAULT_RETRIEVAL_SPEED = 1.0   # ~3.6 km/h, vitesse classique


# ============================================================================
# Coefficients hydrodynamiques de base
# ============================================================================

def estimate_drag_coefficient(lure_type: str, has_bib: bool) -> float:
    """
    Coefficient de traînée approximatif (Cd).
    Valeurs typiques :
        - corps fuselé seul : 0.10 - 0.20
        - leurre avec bavette ouverte : 0.40 - 0.80
        - lipless (vibrant) : 0.30 - 0.50
    """
    base = {
        "minnowbait": 0.15,
        "minnowbait_long": 0.15,
        "jerkbait": 0.18,
        "crankbait_plongeant": 0.50,
        "lipless_crankbait": 0.40,
        "chatterbait": 0.55,
        "popper": 0.30,
        "wakebait": 0.25,
        "glidebait": 0.20,
        "jig": 0.60,
        "custom_cad": 0.30,
    }.get(lure_type, 0.30)

    if has_bib:
        base += 0.20  # la bavette ajoute beaucoup de traînée
    return base


def estimate_lift_coefficient(bib_angle_deg: float, has_bib: bool) -> float:
    """
    Coefficient de portance de la bavette (Cl).
    Plus l'angle est ouvert (proche de 90° = horizontal), plus la portance est élevée
    mais plus elle est dirigée VERS LE BAS (ce qui fait plonger le leurre).
    """
    if not has_bib:
        return 0.0
    # Approximation linéaire : Cl_max ≈ 1.2 à 90°, Cl ≈ 0.4 à 30°
    return 0.4 + 0.8 * (bib_angle_deg / 90.0)


# ============================================================================
# Centre de poussée (point d'application des forces hydrodynamiques)
# ============================================================================

def estimate_center_of_pressure_pct(lure_type: str, has_bib: bool) -> float:
    """
    Position du centre de poussée hydrodynamique en % de la longueur depuis le nez.
    C'est la résultante des forces de pression sur tout le corps + bavette.

    Pour la stabilité en wobbling, le couple de redressement existe quand
    le centre de poussée est DERRIÈRE le centre de gravité (effet flèche).
    """
    if has_bib:
        # La bavette tire le centre de poussée vers l'avant
        return 35.0
    if lure_type == "lipless_crankbait":
        return 45.0
    if lure_type == "jig":
        return 60.0
    return 50.0


# ============================================================================
# Couple de redressement et raideur
# ============================================================================

def compute_restoring_stiffness(design: LureDesign, retrieval_speed: float = DEFAULT_RETRIEVAL_SPEED) -> float:
    """
    Raideur de redressement k (N·m / rad).

    Origine physique : quand le leurre s'incline d'un angle θ par rapport au flux,
    la composante latérale des forces hydrodynamiques génère un couple
    qui le ramène vers l'équilibre. Plus le bras de levier (CoG ↔ CoP) est grand,
    plus k est élevé → wobbling rapide et amorti.

    Approximation :
        k ≈ ½ ρ v² S L_arm Cl
    avec :
        S = surface de référence (corps en m²)
        L_arm = bras de levier CoG-CoP (m)
        Cl = portance latérale (≈ 1.0)
    """
    # Surface latérale approximative (m²)
    S_m2 = (design.length_cm * design.height_cm) / 1e4

    # Bras de levier (m)
    has_bib = design.bib_type not in ("aucune", "")
    cop_pct = estimate_center_of_pressure_pct(design.lure_type, has_bib)
    L_arm_m = abs(cop_pct - design.cog_position_pct) / 100.0 * (design.length_cm / 100.0)

    # Garde-fou : un bras nul donne une raideur nulle
    if L_arm_m < 1e-4:
        L_arm_m = 1e-4

    Cl = 1.0
    k = 0.5 * WATER_DENSITY_KG_M3 * (retrieval_speed ** 2) * S_m2 * L_arm_m * Cl
    return k


def compute_damping_coefficient(design: LureDesign, retrieval_speed: float = DEFAULT_RETRIEVAL_SPEED) -> float:
    """
    Coefficient d'amortissement c (N·m·s/rad).

    Origine physique : quand le leurre tourne, l'eau s'oppose à la rotation.
    On utilise une formule de traînée rotationnelle simplifiée.

        c ≈ Cd_rot · ρ · v · S · L²
    """
    has_bib = design.bib_type not in ("aucune", "")
    Cd = estimate_drag_coefficient(design.lure_type, has_bib)
    S_m2 = (design.length_cm * design.height_cm) / 1e4
    L_m = design.length_cm / 100.0

    c = Cd * WATER_DENSITY_KG_M3 * retrieval_speed * S_m2 * (L_m ** 2) * 0.1
    return c


# ============================================================================
# Wobbling : fréquence, amplitude, amortissement
# ============================================================================

def compute_wobble_inertia(design: LureDesign) -> float:
    """
    Moment d'inertie pour le wobbling principal (lacet, autour de Z) en kg·m².

    Si on a les Mass Properties (Izz mesuré dans SolidWorks), on l'utilise.
    Sinon on estime par formule cylindrique.
    """
    if design.mass_properties is not None and design.mass_properties.izz > 0:
        # Conversion g·cm² → kg·m² : ÷ 1000 / 10000 = ÷ 1e7
        return design.mass_properties.izz / 1e7

    # Approximation : cylindre d'axe X
    # Izz = (1/12) m (3r² + L²) ≈ (1/12) m L² pour leurre allongé
    m_kg = design.target_mass_g / 1000.0
    L_m = design.length_cm / 100.0
    return (1.0 / 12.0) * m_kg * (L_m ** 2)


def predict_wobble(design: LureDesign, retrieval_speed: float = DEFAULT_RETRIEVAL_SPEED) -> dict:
    """
    Prédit le comportement dynamique du wobbling.

    Modèle d'oscillateur amorti :
        ω₀ = √(k/I)              fréquence propre (rad/s)
        ζ = c / (2·√(I·k))      ratio d'amortissement (sans dimension)
        f = ω₀ / (2π)            fréquence en Hz
        A = forçage / (k - I·ω²) amplitude en régime forcé

    L'amplitude angulaire est estimée empiriquement à partir
    de l'asymétrie de la bavette et de la vitesse de traction.
    """
    I = compute_wobble_inertia(design)
    k = compute_restoring_stiffness(design, retrieval_speed)
    c = compute_damping_coefficient(design, retrieval_speed)

    if I <= 0 or k <= 0:
        return {
            "wobble_frequency_hz": 0.0,
            "wobble_amplitude_deg": 0.0,
            "wobble_damping": 0.0,
            "pitch_amplitude_deg": 0.0,
            "roll_amplitude_deg": 0.0,
            "natural_omega": 0.0,
            "warnings": ["Inertie ou raideur nulle : impossible de simuler le wobbling."],
        }

    # Fréquence propre
    omega_0 = math.sqrt(k / I)
    f_hz = omega_0 / (2.0 * math.pi)

    # Amortissement adimensionnel
    zeta = c / (2.0 * math.sqrt(I * k))

    # Amplitude (heuristique calibrée sur leurres réels)
    # Plus la bavette est ouverte et la vitesse élevée, plus l'amplitude est forte
    has_bib = design.bib_type not in ("aucune", "")
    bib_factor = (design.bib_angle_deg / 90.0) if has_bib else 0.3
    speed_factor = retrieval_speed / DEFAULT_RETRIEVAL_SPEED

    base_amp_deg = 25.0 * bib_factor * speed_factor
    # Amortissement réduit l'amplitude
    if zeta < 1.0:
        amp_factor = 1.0 / math.sqrt(1.0 + (2.0 * zeta) ** 2)
    else:
        amp_factor = 0.3  # surcritique : presque pas de wobbling
    wobble_amp = base_amp_deg * amp_factor

    # Pitch (tangage) : généralement ~30 % du wobbling principal
    pitch_amp = wobble_amp * 0.30
    # Roll (roulis) : dépend de la stabilité — un leurre instable roule
    roll_amp = wobble_amp * 0.15 * (1.0 + design.roll_risk)

    warnings = []
    if zeta > 1.5:
        warnings.append("Sur-amorti : action très molle, faible vibration.")
    if zeta < 0.05:
        warnings.append("Sous-amorti : risque de roulement parasite.")
    if f_hz > 8.0:
        warnings.append(f"Fréquence très élevée ({f_hz:.1f} Hz) — vérifier la masse.")
    if f_hz < 0.5:
        warnings.append(f"Fréquence très basse ({f_hz:.1f} Hz) — leurre paresseux.")

    return {
        "wobble_frequency_hz": round(f_hz, 2),
        "wobble_amplitude_deg": round(wobble_amp, 1),
        "wobble_damping": round(zeta, 3),
        "pitch_amplitude_deg": round(pitch_amp, 1),
        "roll_amplitude_deg": round(roll_amp, 1),
        "natural_omega": round(omega_0, 2),
        "warnings": warnings,
    }


def apply_hydrodynamics(design: LureDesign, retrieval_speed: float = DEFAULT_RETRIEVAL_SPEED) -> LureDesign:
    """Applique les calculs hydrodynamiques in-place et retourne le design."""
    wobble = predict_wobble(design, retrieval_speed)
    design.wobble_frequency_hz = wobble["wobble_frequency_hz"]
    design.wobble_amplitude_deg = wobble["wobble_amplitude_deg"]
    design.wobble_damping = wobble["wobble_damping"]
    design.pitch_amplitude_deg = wobble["pitch_amplitude_deg"]
    design.roll_amplitude_deg = wobble["roll_amplitude_deg"]
    if wobble.get("warnings"):
        design.warnings.extend(wobble["warnings"])
    return design
