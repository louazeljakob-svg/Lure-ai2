"""
core/cad_import.py
------------------
Import d'un design existant depuis un CAO (SolidWorks, Fusion 360, Catia, etc.).

Deux voies d'import :
    1. Fichier STL → extraction automatique de la géométrie
       (volume, dimensions, surface, centre géométrique)
    2. Saisie manuelle des Mass Properties depuis le rapport SolidWorks
       (masse, CG, tenseur d'inertie complet)

Le résultat est un LureDesign avec source="cad_import", prêt à être
analysé, simulé et optimisé par les autres modules.

Dépendance optionnelle : numpy-stl (pip install numpy-stl)
Si absent, seule la saisie manuelle est disponible.
"""

from __future__ import annotations
import os
from typing import Optional

import numpy as np

from models.lure_design import LureDesign, MassProperties, UserRequest

# Import optionnel — l'app doit pouvoir tourner sans STL
try:
    from stl import mesh as stl_mesh
    STL_AVAILABLE = True
except ImportError:
    STL_AVAILABLE = False


# ============================================================================
# Lecture STL
# ============================================================================

def read_stl(file_path: str) -> dict:
    """
    Lit un fichier STL et retourne ses propriétés géométriques.

    Retourne :
        {
            "vertices": np.ndarray (N, 3),    # tous les sommets
            "faces": np.ndarray (M, 3, 3),    # triangles
            "volume_cm3": float,
            "surface_cm2": float,
            "bbox_min": np.ndarray (3,),       # coin min de la boîte englobante
            "bbox_max": np.ndarray (3,),
            "length_cm": float,                # X
            "width_cm": float,                 # Y
            "height_cm": float,                # Z
            "centroid": np.ndarray (3,),       # centre géométrique
        }

    ⚠ Hypothèse : le STL est en millimètres (standard SolidWorks).
       Conversion automatique vers cm.
    """
    if not STL_AVAILABLE:
        raise ImportError(
            "Le module 'numpy-stl' n'est pas installé. "
            "Installez-le avec : pip install numpy-stl"
        )
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Fichier STL introuvable : {file_path}")

    m = stl_mesh.Mesh.from_file(file_path)

    # Volume signé (algorithme du tétraèdre) — en mm³ → cm³
    volume_mm3, _, _ = m.get_mass_properties()
    volume_cm3 = abs(volume_mm3) / 1000.0

    # Surface : somme des aires des triangles
    surface_mm2 = float(np.sum(m.areas))
    surface_cm2 = surface_mm2 / 100.0

    # Boîte englobante (en mm puis cm)
    all_points = m.vectors.reshape(-1, 3)  # (3M, 3)
    bbox_min = all_points.min(axis=0) / 10.0
    bbox_max = all_points.max(axis=0) / 10.0
    dims_cm = bbox_max - bbox_min

    # Centre géométrique (moyenne des sommets — approximation)
    centroid = all_points.mean(axis=0) / 10.0

    return {
        "vertices": all_points / 10.0,
        "faces": m.vectors / 10.0,
        "volume_cm3": round(volume_cm3, 3),
        "surface_cm2": round(surface_cm2, 3),
        "bbox_min": bbox_min,
        "bbox_max": bbox_max,
        "length_cm": round(float(dims_cm[0]), 3),
        "width_cm": round(float(dims_cm[1]), 3),
        "height_cm": round(float(dims_cm[2]), 3),
        "centroid": centroid,
    }


# ============================================================================
# Construction d'un LureDesign depuis CAO
# ============================================================================

def build_design_from_cad(
    name: str,
    stl_path: Optional[str] = None,
    mass_props: Optional[MassProperties] = None,
    lure_type: str = "custom_cad",
    bib_type: str = "moyenne",
    bib_angle_deg: float = 60.0,
    hook_count: int = 2,
    user_request: Optional[UserRequest] = None,
) -> LureDesign:
    """
    Construit un LureDesign à partir d'un import CAO.

    Au moins UNE des deux sources doit être fournie :
        - stl_path : pour la géométrie automatique
        - mass_props : pour les propriétés de masse précises

    Idéalement les DEUX, pour avoir géométrie réelle + masse mesurée.
    """
    if stl_path is None and mass_props is None:
        raise ValueError("Fournir au moins un STL ou des Mass Properties.")

    design = LureDesign(
        name=name or "Design CAO",
        source="cad_import",
        stl_path=stl_path,
        lure_type=lure_type,
        bib_type=bib_type,
        bib_angle_deg=bib_angle_deg,
        hook_count=hook_count,
        user_request=user_request,
    )

    # 1. Géométrie depuis STL si disponible
    if stl_path is not None:
        geo = read_stl(stl_path)
        design.length_cm = geo["length_cm"]
        design.width_cm = geo["width_cm"]
        design.height_cm = geo["height_cm"]
        design.volume_cm3 = geo["volume_cm3"]

    # 2. Mass Properties (priorité si fournis — données réelles)
    if mass_props is not None:
        design.mass_properties = mass_props
        design.target_mass_g = mass_props.mass_g

        # Recalcule la densité réelle
        if design.volume_cm3 > 0:
            design.density_g_cm3 = round(mass_props.mass_g / design.volume_cm3, 3)
        elif mass_props.volume_cm3 > 0:
            design.volume_cm3 = mass_props.volume_cm3
            design.density_g_cm3 = round(mass_props.mass_g / mass_props.volume_cm3, 3)

        # Position du CG en %  de la longueur (pour compatibilité avec V1)
        if design.length_cm > 0:
            design.cog_position_pct = round(
                (mass_props.cog_x_cm / design.length_cm) * 100.0, 1
            )

        # État de flottabilité
        from core import physics as physics_mod
        design.buoyancy_state = physics_mod.determine_buoyancy_state(design.density_g_cm3)

    # 3. Si on n'a que le STL (pas de Mass Properties), on estime la masse
    elif stl_path is not None:
        # Estimation grossière en supposant cèdre par défaut
        from core import physics as physics_mod
        material_default = "bois_cèdre"
        design.target_mass_g = physics_mod.compute_body_mass(design.volume_cm3, material_default)
        design.density_g_cm3 = 0.38  # densité du cèdre
        design.buoyancy_state = "flottant"
        design.cog_position_pct = 50.0
        design.warnings.append(
            "⚠ Pas de Mass Properties fournis : masse et CG estimés (cèdre par défaut). "
            "Pour une analyse précise, saisissez les Mass Properties depuis SolidWorks."
        )

    return design


# ============================================================================
# Saisie manuelle assistée
# ============================================================================

def parse_solidworks_text(raw_text: str) -> dict:
    """
    Parser pour le rapport texte de SolidWorks (Mass Properties).
    L'utilisateur peut copier-coller le rapport tel quel et on extrait les valeurs.

    Supporte les sorties FR et EN. Retourne un dict avec les valeurs trouvées
    (en cm, g, g·cm²). Retourne {} si aucune valeur reconnue.

    Exemple d'entrée typique :
        Masse = 25.34 grammes
        Volume = 67.21 centimètres cubes
        Centre de masse: ( centimètres )
            X = 4.521
            Y = -0.012
            Z = -0.483
        Moments d'inertie: ( grammes * centimètres carrés )
        Pris au centre de gravité ...
            Lxx = 12.345    Lxy = 0.001    Lxz = -0.045
            ...
    """
    import re

    result = {}
    text = raw_text.replace(",", ".")  # robustesse FR (virgules décimales)

    patterns = {
        "mass_g": r"(?:masse|mass)\s*=\s*([-+]?\d*\.?\d+)\s*(?:grammes?|grams?|g)",
        "volume_cm3": r"(?:volume)\s*=\s*([-+]?\d*\.?\d+)\s*(?:centim[èe]tres?\s*cubes?|cm\^?3|cubic\s*cent)",
        "surface_area_cm2": r"(?:surface|surface\s*area)\s*=\s*([-+]?\d*\.?\d+)\s*(?:centim[èe]tres?\s*carr[ée]s?|cm\^?2|square)",
        "density_g_cm3": r"(?:densit[ée]|density)\s*=\s*([-+]?\d*\.?\d+)",
        "cog_x_cm": r"X\s*=\s*([-+]?\d*\.?\d+)",
        "cog_y_cm": r"Y\s*=\s*([-+]?\d*\.?\d+)",
        "cog_z_cm": r"Z\s*=\s*([-+]?\d*\.?\d+)",
        "ixx": r"L?xx\s*=\s*([-+]?\d*\.?\d+)",
        "iyy": r"L?yy\s*=\s*([-+]?\d*\.?\d+)",
        "izz": r"L?zz\s*=\s*([-+]?\d*\.?\d+)",
    }

    for key, pat in patterns.items():
        m = re.search(pat, text, flags=re.IGNORECASE)
        if m:
            try:
                result[key] = float(m.group(1))
            except ValueError:
                pass

    return result


def build_mass_properties(form_data: dict) -> MassProperties:
    """Construit un MassProperties depuis un dict de formulaire."""
    return MassProperties(
        mass_g=float(form_data.get("mass_g", 0.0)),
        volume_cm3=float(form_data.get("volume_cm3", 0.0)),
        surface_area_cm2=float(form_data.get("surface_area_cm2", 0.0)),
        density_g_cm3=float(form_data.get("density_g_cm3", 0.0)),
        cog_x_cm=float(form_data.get("cog_x_cm", 0.0)),
        cog_y_cm=float(form_data.get("cog_y_cm", 0.0)),
        cog_z_cm=float(form_data.get("cog_z_cm", 0.0)),
        ixx=float(form_data.get("ixx", 0.0)),
        iyy=float(form_data.get("iyy", 0.0)),
        izz=float(form_data.get("izz", 0.0)),
        ixy=float(form_data.get("ixy", 0.0)),
        ixz=float(form_data.get("ixz", 0.0)),
        iyz=float(form_data.get("iyz", 0.0)),
    )
