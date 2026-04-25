"""
models/lure_design.py
---------------------
Définit la structure de données centrale du projet : LureDesign.

V2 : ajout du support pour designs importés depuis CAO (SolidWorks),
    Mass Properties complets, et observations de wobbling.
"""

from dataclasses import dataclass, field, asdict
from typing import Optional, List, Dict
from datetime import datetime
import uuid


# ============================================================================
# Données utilisateur (entrée)
# ============================================================================

@dataclass
class UserRequest:
    """Paramètres de pêche fournis par l'utilisateur."""
    species: str
    season: str
    water_type: str
    water_clarity: str
    target_depth_m: float
    desired_action: str
    material: str
    max_length_cm: float
    desired_buoyancy: str
    manufacturing: str


# ============================================================================
# Mass Properties depuis SolidWorks (ou autre CAO)
# ============================================================================

@dataclass
class MassProperties:
    """
    Reproduit la fenêtre 'Mass Properties' de SolidWorks.

    Convention :
        - origine = nez du leurre (point le plus avant sur l'axe X)
        - axe X = longueur (nez vers queue)
        - axe Y = largeur (latéral)
        - axe Z = hauteur (vertical, vers le haut)
        - unités : cm, g, g·cm² pour l'inertie
    """
    # Masse et volume
    mass_g: float = 0.0
    volume_cm3: float = 0.0
    surface_area_cm2: float = 0.0
    density_g_cm3: float = 0.0

    # Centre de gravité
    cog_x_cm: float = 0.0
    cog_y_cm: float = 0.0
    cog_z_cm: float = 0.0

    # Tenseur d'inertie au CG (g·cm²)
    ixx: float = 0.0   # roulis (rotation autour de X)
    iyy: float = 0.0   # tangage (rotation autour de Y)
    izz: float = 0.0   # lacet (rotation autour de Z) — wobbling principal

    # Termes croisés
    ixy: float = 0.0
    ixz: float = 0.0
    iyz: float = 0.0


# ============================================================================
# LureDesign — conteneur principal
# ============================================================================

@dataclass
class LureDesign:
    """Conteneur d'un leurre. Peut être généré OU importé depuis CAO."""

    design_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    name: str = ""

    source: str = "generated"
    parent_id: Optional[str] = None
    stl_path: Optional[str] = None
    variant_label: str = "principal"

    user_request: Optional[UserRequest] = None

    lure_type: str = ""
    recommended_colors: List[str] = field(default_factory=list)
    bib_type: str = ""
    bib_angle_deg: float = 0.0
    hook_count: int = 2

    length_cm: float = 0.0
    width_cm: float = 0.0
    height_cm: float = 0.0
    volume_cm3: float = 0.0

    target_mass_g: float = 0.0
    density_g_cm3: float = 0.0
    buoyancy_state: str = ""
    cog_position_pct: float = 50.0
    mass_properties: Optional[MassProperties] = None

    predicted_depth_m: float = 0.0
    stability_score: float = 0.0
    action_intensity: float = 0.0
    roll_risk: float = 0.0
    balance_risk: float = 0.0
    behavior_notes: str = ""

    # Wobbling (V2)
    wobble_frequency_hz: float = 0.0
    wobble_amplitude_deg: float = 0.0
    wobble_damping: float = 0.0
    pitch_amplitude_deg: float = 0.0
    roll_amplitude_deg: float = 0.0

    score: float = 0.0
    score_breakdown: Dict[str, float] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)
    suggestions: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        if self.user_request is not None:
            d["user_request"] = asdict(self.user_request)
        if self.mass_properties is not None:
            d["mass_properties"] = asdict(self.mass_properties)
        return d

    def summary(self) -> str:
        return (
            f"[{self.design_id}] {self.lure_type} — "
            f"{self.length_cm:.1f}cm / {self.target_mass_g:.1f}g / "
            f"{self.buoyancy_state} / score={self.score:.1f}/100"
        )


# ============================================================================
# Résultat de test réel (V2 enrichie)
# ============================================================================

@dataclass
class TestResult:
    test_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    design_id: str = ""
    tested_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    actual_species_caught: str = ""
    actual_depth_m: float = 0.0
    actual_buoyancy: str = ""

    stability_observed: float = 0.0
    action_quality: float = 0.0
    catch_success: bool = False
    catches_count: int = 0

    # V2 : observations objectives sur le wobbling
    observed_wobble_freq_hz: Optional[float] = None
    observed_wobble_amp_deg: Optional[float] = None
    video_path: Optional[str] = None
    notes: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


# ============================================================================
# Suggestion d'optimisation (V2)
# ============================================================================

@dataclass
class OptimizationSuggestion:
    """Modification concrète à appliquer à un design existant."""
    suggestion_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    parent_design_id: str = ""

    title: str = ""
    description: str = ""
    priority: str = "moyenne"

    delta_cog_x_mm: float = 0.0
    delta_ballast_g: float = 0.0
    delta_bib_angle_deg: float = 0.0
    delta_length_mm: float = 0.0

    new_design_id: str = ""
    score_before: float = 0.0
    score_after: float = 0.0
    score_delta: float = 0.0
    expected_improvements: List[str] = field(default_factory=list)
    expected_tradeoffs: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)
