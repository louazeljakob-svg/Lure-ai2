"""
main.py
-------
Point d'entrée en ligne de commande (CLI).
Utile pour tester rapidement le moteur sans lancer Streamlit.

Usage :
    python main.py                       # démo avec la requête par défaut
    python main.py --retrain             # relance la boucle d'apprentissage
    python main.py --list                # affiche tous les designs sauvegardés
    python main.py --sketch <design_id>  # génère un PNG pour un design
"""

import sys
import argparse
import os

from core import recommendation, database, learning, sketch_generator, user_input
from models.lure_design import LureDesign


def cmd_demo():
    """Lance une démo complète avec un cas concret."""
    print("=" * 70)
    print("DÉMO — IA de conception de leurres de pêche")
    print("=" * 70)

    raw = user_input.default_request()
    print("\n📝 Requête utilisateur :")
    for k, v in raw.items():
        print(f"  - {k:22s} : {v}")

    result = recommendation.recommend(raw, n_variants=3)
    main: LureDesign = result["main"]
    variants = result["variants"]

    print("\n🎯 Design principal recommandé")
    print("-" * 70)
    print(f"  Type de leurre     : {main.lure_type}")
    print(f"  Couleurs           : {', '.join(main.recommended_colors)}")
    print(f"  Dimensions (LxHxP) : {main.length_cm:.1f} x {main.height_cm:.1f} x {main.width_cm:.1f} cm")
    print(f"  Volume estimé      : {main.volume_cm3:.1f} cm³")
    print(f"  Masse cible        : {main.target_mass_g:.1f} g")
    print(f"  Densité            : {main.density_g_cm3:.3f} g/cm³  →  {main.buoyancy_state}")
    print(f"  Centre de gravité  : {main.cog_position_pct:.0f}% depuis le nez")
    print(f"  Bavette            : {main.bib_type} @ {main.bib_angle_deg:.0f}°")
    print(f"  Hameçons           : {main.hook_count}")
    print(f"  Profondeur prédite : {main.predicted_depth_m:.2f} m")
    print(f"  Stabilité          : {main.stability_score:.2f}")
    print(f"  Intensité action   : {main.action_intensity:.2f}")
    print(f"  Risque roulement   : {main.roll_risk:.2f}")
    print(f"  Score global       : {main.score:.1f}/100")

    print("\n  Détail du score :")
    for k, v in main.score_breakdown.items():
        print(f"    {k:16s} : {v:5.2f}")

    if main.warnings:
        print("\n⚠  Avertissements :")
        for w in main.warnings:
            print(f"  - {w}")

    print("\n💡 Suggestions :")
    for s in main.suggestions:
        print(f"  - {s}")

    print("\n📊 Variantes générées :")
    print("-" * 70)
    for v in variants:
        print(f"  [{v.variant_label:38s}] score={v.score:5.1f}/100 — "
              f"{v.length_cm:.1f}cm, {v.target_mass_g:.1f}g, CG {v.cog_position_pct:.0f}%")

    # Sauvegarder le design principal
    database.save_design(main)
    for v in variants:
        database.save_design(v)
    print(f"\n💾 Design principal sauvegardé (ID: {main.design_id})")
    print(f"   + {len(variants)} variantes")

    # Générer le croquis
    os.makedirs("output", exist_ok=True)
    sketch_path = f"output/sketch_{main.design_id}.png"
    sketch_generator.draw_lure(main, save_path=sketch_path)
    print(f"✏  Croquis généré : {sketch_path}")

    print("\n" + "=" * 70)


def cmd_retrain():
    """Force le recalcul des paramètres appris."""
    print("🔁 Recalcul des paramètres d'apprentissage...")
    params = learning.retrain_from_tests(min_tests=3)
    print(params.get("report", "Aucun rapport."))


def cmd_list():
    """Liste les designs sauvegardés."""
    df = database.load_designs()
    if df.empty:
        print("Aucun design en base.")
        return
    cols = ["design_id", "lure_type", "species", "length_cm", "target_mass_g", "score", "variant_label"]
    cols = [c for c in cols if c in df.columns]
    print(df[cols].to_string(index=False))


def cmd_sketch(design_id: str):
    """Régénère un croquis pour un design existant."""
    payload = database.get_design(design_id)
    if not payload:
        print(f"Design introuvable : {design_id}")
        return
    # On recharge via le modèle
    from models.lure_design import UserRequest
    ur = payload.get("user_request") or {}
    payload_clean = {k: v for k, v in payload.items() if k != "user_request"}
    design = LureDesign(**payload_clean)
    design.user_request = UserRequest(**ur) if ur else None
    path = f"output/sketch_{design_id}.png"
    os.makedirs("output", exist_ok=True)
    sketch_generator.draw_lure(design, save_path=path)
    print(f"Croquis sauvegardé : {path}")


def main():
    parser = argparse.ArgumentParser(description="IA de conception de leurres de pêche")
    parser.add_argument("--retrain", action="store_true", help="Relance la boucle d'apprentissage")
    parser.add_argument("--list", action="store_true", help="Liste les designs sauvegardés")
    parser.add_argument("--sketch", type=str, help="Régénère un croquis pour un design_id")
    args = parser.parse_args()

    if args.retrain:
        cmd_retrain()
    elif args.list:
        cmd_list()
    elif args.sketch:
        cmd_sketch(args.sketch)
    else:
        cmd_demo()


if __name__ == "__main__":
    main()
