"""
core/database.py
----------------
Persistance des designs et des résultats de test.

Double stockage :
    - SQLite (source de vérité, requêtable)
    - CSV (exports humain-lisibles dans data/)

Deux tables :
    - designs       : un design par ligne
    - test_results  : un test réel par ligne (lié à un design_id)
"""

import os
import sqlite3
import json
from typing import List, Optional
from dataclasses import asdict

import pandas as pd

from models.lure_design import LureDesign, UserRequest, TestResult


DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
DB_PATH = os.path.join(DATA_DIR, "lure_ai.db")
DESIGNS_CSV = os.path.join(DATA_DIR, "lure_database.csv")
TESTS_CSV = os.path.join(DATA_DIR, "test_results.csv")


# ------------------------------------------------------------------------
# Initialisation
# ------------------------------------------------------------------------

def _connect() -> sqlite3.Connection:
    os.makedirs(DATA_DIR, exist_ok=True)
    return sqlite3.connect(DB_PATH)


def init_db() -> None:
    """Crée les tables si elles n'existent pas."""
    conn = _connect()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS designs (
            design_id       TEXT PRIMARY KEY,
            created_at      TEXT,
            name            TEXT,
            source          TEXT,
            stl_path        TEXT,
            parent_id       TEXT,
            variant_label   TEXT,
            lure_type       TEXT,
            species         TEXT,
            season          TEXT,
            water_type      TEXT,
            water_clarity   TEXT,
            target_depth_m  REAL,
            desired_action  TEXT,
            material        TEXT,
            desired_buoyancy TEXT,
            length_cm       REAL,
            width_cm        REAL,
            height_cm       REAL,
            volume_cm3      REAL,
            target_mass_g   REAL,
            density_g_cm3   REAL,
            buoyancy_state  TEXT,
            cog_position_pct REAL,
            bib_type        TEXT,
            bib_angle_deg   REAL,
            hook_count      INTEGER,
            predicted_depth_m REAL,
            stability_score REAL,
            action_intensity REAL,
            roll_risk       REAL,
            balance_risk    REAL,
            wobble_frequency_hz REAL,
            wobble_amplitude_deg REAL,
            wobble_damping  REAL,
            pitch_amplitude_deg REAL,
            roll_amplitude_deg REAL,
            score           REAL,
            payload_json    TEXT
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS test_results (
            test_id              TEXT PRIMARY KEY,
            design_id            TEXT,
            tested_at            TEXT,
            actual_species_caught TEXT,
            actual_depth_m       REAL,
            actual_buoyancy      TEXT,
            stability_observed   REAL,
            action_quality       REAL,
            catch_success        INTEGER,
            catches_count        INTEGER,
            observed_wobble_freq_hz REAL,
            observed_wobble_amp_deg REAL,
            video_path           TEXT,
            notes                TEXT,
            FOREIGN KEY (design_id) REFERENCES designs (design_id)
        )
        """
    )
    conn.commit()
    conn.close()


# ------------------------------------------------------------------------
# Designs
# ------------------------------------------------------------------------

def save_design(design: LureDesign) -> None:
    """Enregistre (ou remplace) un design dans SQLite, puis met à jour le CSV."""
    init_db()
    conn = _connect()
    cur = conn.cursor()
    req: UserRequest = design.user_request
    cur.execute(
        """
        INSERT OR REPLACE INTO designs VALUES (
            :design_id, :created_at, :name, :source, :stl_path, :parent_id, :variant_label, :lure_type,
            :species, :season, :water_type, :water_clarity, :target_depth_m,
            :desired_action, :material, :desired_buoyancy,
            :length_cm, :width_cm, :height_cm, :volume_cm3,
            :target_mass_g, :density_g_cm3, :buoyancy_state, :cog_position_pct,
            :bib_type, :bib_angle_deg, :hook_count,
            :predicted_depth_m, :stability_score, :action_intensity,
            :roll_risk, :balance_risk,
            :wobble_frequency_hz, :wobble_amplitude_deg, :wobble_damping,
            :pitch_amplitude_deg, :roll_amplitude_deg,
            :score, :payload_json
        )
        """,
        {
            "design_id": design.design_id,
            "created_at": design.created_at,
            "name": design.name,
            "source": design.source,
            "stl_path": design.stl_path,
            "parent_id": design.parent_id,
            "variant_label": design.variant_label,
            "lure_type": design.lure_type,
            "species": req.species if req else "",
            "season": req.season if req else "",
            "water_type": req.water_type if req else "",
            "water_clarity": req.water_clarity if req else "",
            "target_depth_m": req.target_depth_m if req else 0.0,
            "desired_action": req.desired_action if req else "",
            "material": req.material if req else "",
            "desired_buoyancy": req.desired_buoyancy if req else "",
            "length_cm": design.length_cm,
            "width_cm": design.width_cm,
            "height_cm": design.height_cm,
            "volume_cm3": design.volume_cm3,
            "target_mass_g": design.target_mass_g,
            "density_g_cm3": design.density_g_cm3,
            "buoyancy_state": design.buoyancy_state,
            "cog_position_pct": design.cog_position_pct,
            "bib_type": design.bib_type,
            "bib_angle_deg": design.bib_angle_deg,
            "hook_count": design.hook_count,
            "predicted_depth_m": design.predicted_depth_m,
            "stability_score": design.stability_score,
            "action_intensity": design.action_intensity,
            "roll_risk": design.roll_risk,
            "balance_risk": design.balance_risk,
            "wobble_frequency_hz": getattr(design, "wobble_frequency_hz", 0.0),
            "wobble_amplitude_deg": getattr(design, "wobble_amplitude_deg", 0.0),
            "wobble_damping": getattr(design, "wobble_damping", 0.0),
            "pitch_amplitude_deg": getattr(design, "pitch_amplitude_deg", 0.0),
            "roll_amplitude_deg": getattr(design, "roll_amplitude_deg", 0.0),
            "score": design.score,
            "payload_json": json.dumps(design.to_dict(), default=str),
        },
    )
    conn.commit()
    conn.close()
    _export_designs_csv()


def load_designs() -> pd.DataFrame:
    """Retourne tous les designs sous forme de DataFrame."""
    init_db()
    conn = _connect()
    df = pd.read_sql_query("SELECT * FROM designs ORDER BY created_at DESC", conn)
    conn.close()
    return df


def get_design(design_id: str) -> Optional[dict]:
    """Récupère un design complet par son ID."""
    init_db()
    conn = _connect()
    cur = conn.cursor()
    cur.execute("SELECT payload_json FROM designs WHERE design_id = ?", (design_id,))
    row = cur.fetchone()
    conn.close()
    if not row:
        return None
    return json.loads(row[0])


def _export_designs_csv() -> None:
    """Écrit un CSV lisible (sans la colonne payload_json, trop verbeuse)."""
    df = load_designs()
    if "payload_json" in df.columns:
        df = df.drop(columns=["payload_json"])
    df.to_csv(DESIGNS_CSV, index=False, encoding="utf-8")


# ------------------------------------------------------------------------
# Tests réels
# ------------------------------------------------------------------------

def save_test_result(result: TestResult) -> None:
    """Enregistre un test réel."""
    init_db()
    conn = _connect()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT OR REPLACE INTO test_results VALUES (
            :test_id, :design_id, :tested_at, :actual_species_caught,
            :actual_depth_m, :actual_buoyancy, :stability_observed,
            :action_quality, :catch_success, :catches_count,
            :observed_wobble_freq_hz, :observed_wobble_amp_deg, :video_path,
            :notes
        )
        """,
        {
            "test_id": result.test_id,
            "design_id": result.design_id,
            "tested_at": result.tested_at,
            "actual_species_caught": result.actual_species_caught,
            "actual_depth_m": result.actual_depth_m,
            "actual_buoyancy": result.actual_buoyancy,
            "stability_observed": result.stability_observed,
            "action_quality": result.action_quality,
            "catch_success": int(result.catch_success),
            "catches_count": result.catches_count,
            "observed_wobble_freq_hz": result.observed_wobble_freq_hz,
            "observed_wobble_amp_deg": result.observed_wobble_amp_deg,
            "video_path": result.video_path,
            "notes": result.notes,
        },
    )
    conn.commit()
    conn.close()
    _export_tests_csv()


def load_test_results() -> pd.DataFrame:
    init_db()
    conn = _connect()
    df = pd.read_sql_query("SELECT * FROM test_results ORDER BY tested_at DESC", conn)
    conn.close()
    return df


def _export_tests_csv() -> None:
    df = load_test_results()
    df.to_csv(TESTS_CSV, index=False, encoding="utf-8")


# ------------------------------------------------------------------------
# Comparaison design ↔ test
# ------------------------------------------------------------------------

def join_designs_with_tests() -> pd.DataFrame:
    """
    Jointure design × test : chaque ligne = un design testé au moins une fois.
    Utilisé par le module d'apprentissage (learning.py).
    """
    designs = load_designs()
    tests = load_test_results()
    if designs.empty or tests.empty:
        return pd.DataFrame()
    return tests.merge(designs, on="design_id", suffixes=("_test", "_design"))
