"""
core/user_input.py
------------------
Validation et normalisation des entrées utilisateur.

Ce module n'impose pas d'interface : il reçoit un dict (qui peut venir
de Streamlit, du CLI, ou d'un test) et retourne un objet UserRequest
validé et normalisé (tout en minuscules, dans les bornes acceptables).

Avantage : on sépare clairement "comment on demande" (app.py, main.py)
et "comment on valide" (ici).
"""

from models.lure_design import UserRequest


# ------------------------------------------------------------------------
# Valeurs valides — servent de référence pour l'interface et la validation
# ------------------------------------------------------------------------

VALID_SPECIES = ["brochet", "doré", "achigan", "truite", "maskinongé", "perchaude"]
VALID_SEASONS = ["printemps", "été", "automne", "hiver"]
VALID_WATER_TYPES = ["lac", "rivière", "étang"]
VALID_WATER_CLARITY = ["claire", "moyenne", "trouble"]
VALID_ACTIONS = ["erratique", "vibration", "roll", "wobble", "surface", "glide"]
VALID_MATERIALS = ["bois_cèdre", "bois_balsa", "résine", "plastique"]
VALID_BUOYANCY = ["flottant", "coulant", "suspending"]
VALID_MANUFACTURING = ["main", "impression_3D", "moule"]


def _normalize(value: str) -> str:
    """Normalise une chaîne : strip + lower."""
    return str(value).strip().lower() if value is not None else ""


def _validate_choice(value: str, valid_list: list, field_name: str) -> str:
    """Vérifie qu'une valeur appartient à une liste autorisée."""
    v = _normalize(value)
    if v not in valid_list:
        raise ValueError(
            f"Valeur invalide pour '{field_name}': '{value}'. "
            f"Choix valides : {', '.join(valid_list)}"
        )
    return v


def _validate_positive(value: float, field_name: str, min_v: float = 0.1, max_v: float = 50.0) -> float:
    """Vérifie qu'une valeur numérique est positive et dans des bornes raisonnables."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"'{field_name}' doit être un nombre, reçu : {value!r}")
    if not (min_v <= v <= max_v):
        raise ValueError(f"'{field_name}' doit être entre {min_v} et {max_v}, reçu : {v}")
    return v


def build_user_request(raw: dict) -> UserRequest:
    """
    Construit un UserRequest validé depuis un dict brut.

    Paramètre :
        raw : dict contenant les clés d'entrée utilisateur.

    Retourne :
        UserRequest validé et normalisé.

    Lève :
        ValueError si une valeur est invalide.
    """
    return UserRequest(
        species=_validate_choice(raw.get("species"), VALID_SPECIES, "species"),
        season=_validate_choice(raw.get("season"), VALID_SEASONS, "season"),
        water_type=_validate_choice(raw.get("water_type"), VALID_WATER_TYPES, "water_type"),
        water_clarity=_validate_choice(raw.get("water_clarity"), VALID_WATER_CLARITY, "water_clarity"),
        target_depth_m=_validate_positive(raw.get("target_depth_m"), "target_depth_m", 0.0, 30.0),
        desired_action=_validate_choice(raw.get("desired_action"), VALID_ACTIONS, "desired_action"),
        material=_validate_choice(raw.get("material"), VALID_MATERIALS, "material"),
        max_length_cm=_validate_positive(raw.get("max_length_cm"), "max_length_cm", 2.0, 30.0),
        desired_buoyancy=_validate_choice(raw.get("desired_buoyancy"), VALID_BUOYANCY, "desired_buoyancy"),
        manufacturing=_validate_choice(raw.get("manufacturing"), VALID_MANUFACTURING, "manufacturing"),
    )


def default_request() -> dict:
    """Exemple par défaut, utile pour les tests et les démos."""
    return {
        "species": "doré",
        "season": "automne",
        "water_type": "lac",
        "water_clarity": "trouble",
        "target_depth_m": 4.0,
        "desired_action": "vibration",
        "material": "bois_cèdre",
        "max_length_cm": 10.0,
        "desired_buoyancy": "suspending",
        "manufacturing": "main",
    }
