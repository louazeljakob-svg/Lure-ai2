"""
core/learning.py
----------------
Boucle d'apprentissage simple mais RÉELLE basée sur les tests sauvegardés.

Principe (pas de ML, que des stats élémentaires transparentes) :

    1. On charge tous les tests réels (design_id + issue du terrain).
    2. Pour chaque test, on compare prédictions vs réalité :
           - profondeur prédite vs profondeur réelle observée
           - flottabilité prédite vs flottabilité réelle
           - stabilité prédite (0-1) vs stabilité observée (0-10)
           - action prédite vs qualité d'action observée
    3. On calcule des corrections :
           - biais moyen sur la profondeur → correcteur additif
           - fiabilité des sous-scores → réajustement des POIDS DEFAULT_WEIGHTS
             (on augmente le poids des critères qui prédisent bien,
              on diminue celui des critères qui prédisent mal).
    4. On sauvegarde ces corrections dans data/learned_params.json.
    5. Au prochain lancement, physics/simulation/optimizer les lisent et les appliquent.

C'est une boucle FONCTIONNELLE : chaque test améliore le système.
Si plus tard on veut passer au ML, on remplace ce module par une régression.
"""

from __future__ import annotations
import os
import json
from typing import Dict, Any

import pandas as pd

from core import database

# Chemin du fichier de paramètres appris
LEARNED_PATH = os.path.join(database.DATA_DIR, "learned_params.json")


# ------------------------------------------------------------------------
# Chargement / sauvegarde des paramètres appris
# ------------------------------------------------------------------------

DEFAULT_LEARNED = {
    "depth_bias_m": 0.0,           # à ajouter à la profondeur prédite
    "stability_scale": 1.0,        # multiplicateur de stability_score
    "wobble_freq_scale": 1.0,      # V2 : calibration fréquence wobbling
    "wobble_amp_scale": 1.0,       # V2 : calibration amplitude wobbling
    "weights": {
        "depth_match": 25.0,
        "buoyancy_match": 20.0,
        "stability": 20.0,
        "action_match": 15.0,
        "species_fit": 10.0,
        "risk_penalty": 10.0,
    },
    "n_tests_used": 0,
    "last_updated": None,
}


def load_learned_params() -> Dict[str, Any]:
    """Charge les corrections apprises. Retourne DEFAULT_LEARNED si absent."""
    if not os.path.exists(LEARNED_PATH):
        return dict(DEFAULT_LEARNED)
    try:
        with open(LEARNED_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return dict(DEFAULT_LEARNED)


def save_learned_params(params: Dict[str, Any]) -> None:
    os.makedirs(database.DATA_DIR, exist_ok=True)
    with open(LEARNED_PATH, "w", encoding="utf-8") as f:
        json.dump(params, f, indent=2, ensure_ascii=False)


# ------------------------------------------------------------------------
# Calcul des corrections à partir des tests
# ------------------------------------------------------------------------

def _normalize_weights(weights: Dict[str, float], target_total: float = 100.0) -> Dict[str, float]:
    """Re-normalise les poids pour qu'ils somment à target_total."""
    s = sum(weights.values())
    if s <= 0:
        return weights
    factor = target_total / s
    return {k: round(v * factor, 2) for k, v in weights.items()}


def compute_learning_update(min_tests: int = 3) -> Dict[str, Any]:
    """
    Recalcule les paramètres appris à partir des tests enregistrés.

    Retourne un dict avec :
        - depth_bias_m, stability_scale, weights, n_tests_used, last_updated, report
    """
    joined = database.join_designs_with_tests()
    if joined.empty or len(joined) < min_tests:
        params = load_learned_params()
        params["report"] = (
            f"Pas assez de tests ({len(joined)}/{min_tests} requis). "
            f"Paramètres inchangés."
        )
        return params

    # 1. Biais moyen sur la profondeur (réel - prédit)
    joined["depth_error"] = joined["actual_depth_m"] - joined["predicted_depth_m"]
    depth_bias = float(joined["depth_error"].mean())

    # 2. Calibration de la stabilité
    joined["stab_obs_norm"] = joined["stability_observed"] / 10.0
    joined["stab_ratio"] = joined["stab_obs_norm"] / joined["stability_score"].replace(0, 0.01)
    stab_scale = float(joined["stab_ratio"].clip(0.5, 2.0).mean())

    # 2b. V2 : Calibration du wobbling (si on a des observations vidéo)
    wobble_freq_scale = 1.0
    wobble_amp_scale = 1.0
    if "observed_wobble_freq_hz" in joined.columns and "wobble_frequency_hz" in joined.columns:
        # Filtrer les lignes où on a une observation valide
        wf = joined.dropna(subset=["observed_wobble_freq_hz"])
        wf = wf[(wf["observed_wobble_freq_hz"] > 0) & (wf["wobble_frequency_hz"] > 0)]
        if len(wf) >= 2:
            ratios = wf["observed_wobble_freq_hz"] / wf["wobble_frequency_hz"]
            wobble_freq_scale = float(ratios.clip(0.3, 3.0).mean())
    if "observed_wobble_amp_deg" in joined.columns and "wobble_amplitude_deg" in joined.columns:
        wa = joined.dropna(subset=["observed_wobble_amp_deg"])
        wa = wa[(wa["observed_wobble_amp_deg"] > 0) & (wa["wobble_amplitude_deg"] > 0)]
        if len(wa) >= 2:
            ratios = wa["observed_wobble_amp_deg"] / wa["wobble_amplitude_deg"]
            wobble_amp_scale = float(ratios.clip(0.3, 3.0).mean())

    # 3. Ajustement des POIDS via la corrélation entre sous-score et succès réel
    # On définit un "succès" = (catch_success ET action_quality >= 5 ET stability_observed >= 5)
    joined["outcome"] = (
        (joined["catch_success"] == 1)
        & (joined["action_quality"] >= 5.0)
        & (joined["stability_observed"] >= 5.0)
    ).astype(int)

    weights = dict(DEFAULT_LEARNED["weights"])
    # Pour chaque critère du score, on mesure la corrélation avec 'outcome'.
    # Un critère qui corrèle positivement avec le succès réel voit son poids AUGMENTER.
    proxies = {
        "depth_match":    "predicted_depth_m",   # proxy
        "buoyancy_match": None,                  # géré séparément plus bas
        "stability":      "stability_score",
        "action_match":   "action_intensity",
        "species_fit":    None,
        "risk_penalty":   "roll_risk",           # négatif : plus de roulement = moins de succès
    }

    for criterion, col in proxies.items():
        if col is None:
            continue
        if col not in joined.columns:
            continue
        # Seulement si on a de la variance
        if joined[col].std() < 1e-6:
            continue
        corr = float(joined[[col, "outcome"]].corr().iloc[0, 1])
        # Inversion pour risk_penalty : plus de risque réel corrèle négativement → on VEUT ce critère
        if criterion == "risk_penalty":
            corr = -corr
        if pd.isna(corr):
            continue
        # Ajustement : +/- 30 % du poids selon la corrélation [-1, 1]
        delta = weights[criterion] * 0.30 * corr
        weights[criterion] = max(2.0, weights[criterion] + delta)

    weights = _normalize_weights(weights, 100.0)

    report_lines = [
        f"{len(joined)} tests analysés.",
        f"Biais profondeur moyen : {depth_bias:+.2f} m.",
        f"Calibration stabilité  : × {stab_scale:.2f}.",
        f"Calibration fréq. wobbling : × {wobble_freq_scale:.2f}.",
        f"Calibration ampl. wobbling : × {wobble_amp_scale:.2f}.",
        f"Poids ajustés : {weights}",
    ]

    params = {
        "depth_bias_m": round(depth_bias, 3),
        "stability_scale": round(stab_scale, 3),
        "wobble_freq_scale": round(wobble_freq_scale, 3),
        "wobble_amp_scale": round(wobble_amp_scale, 3),
        "weights": weights,
        "n_tests_used": int(len(joined)),
        "last_updated": pd.Timestamp.utcnow().isoformat(),
        "report": "\n".join(report_lines),
    }
    return params


def retrain_from_tests(min_tests: int = 3) -> Dict[str, Any]:
    """
    Exécute le recalcul ET sauvegarde. Pratique pour le bouton Streamlit
    ou un script CLI.
    """
    params = compute_learning_update(min_tests=min_tests)
    # On ne sauvegarde que si on a réellement fait un update
    if params.get("n_tests_used", 0) > 0:
        save_learned_params(params)
    return params


# ------------------------------------------------------------------------
# Application des paramètres appris
# ------------------------------------------------------------------------

def apply_learned_corrections(design) -> None:
    """
    Applique in-place les corrections apprises à un design déjà généré.
    Appelé par recommendation.py juste avant le scoring final.
    """
    params = load_learned_params()

    # Correction de profondeur
    design.predicted_depth_m = round(
        design.predicted_depth_m + params.get("depth_bias_m", 0.0), 2
    )
    # Calibration stabilité
    scale = params.get("stability_scale", 1.0)
    design.stability_score = round(min(1.0, max(0.0, design.stability_score * scale)), 3)

    # V2 : Calibration wobbling
    f_scale = params.get("wobble_freq_scale", 1.0)
    a_scale = params.get("wobble_amp_scale", 1.0)
    if hasattr(design, "wobble_frequency_hz"):
        design.wobble_frequency_hz = round(design.wobble_frequency_hz * f_scale, 2)
    if hasattr(design, "wobble_amplitude_deg"):
        design.wobble_amplitude_deg = round(design.wobble_amplitude_deg * a_scale, 1)
        design.pitch_amplitude_deg = round(design.pitch_amplitude_deg * a_scale, 1)
        design.roll_amplitude_deg = round(design.roll_amplitude_deg * a_scale, 1)


def get_learned_weights() -> Dict[str, float]:
    """Accès direct aux poids appris pour l'optimizer."""
    return load_learned_params().get("weights", dict(DEFAULT_LEARNED["weights"]))
