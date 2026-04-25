"""
app.py — V2
-----------
Interface Streamlit complète :
    1. 🎯 Design          : génération depuis zéro (V1)
    2. 📐 Importer CAO    : upload STL + Mass Properties SolidWorks
    3. ⚡ Optimiser       : suggestions chiffrées sur un design existant
    4. 🌊 Wobbling 3D     : visualisation et animation
    5. 🧪 Tests réels     : enregistrement avec observations vidéo
    6. 📚 Historique
    7. 🤖 Apprentissage

Lancer : streamlit run app.py
"""

import os
import tempfile
import streamlit as st
import pandas as pd

from core import (
    recommendation, database, learning, sketch_generator, user_input,
    cad_import, cad_visualizer, optimization_engine, hydrodynamics
)
from models.lure_design import (
    TestResult, LureDesign, UserRequest, MassProperties
)


# ============================================================================
# Configuration
# ============================================================================

st.set_page_config(
    page_title="Lure AI — Conception de leurres",
    page_icon="🎣",
    layout="wide",
)

database.init_db()

# Dossier pour les STL uploadés
STL_DIR = os.path.join(database.DATA_DIR, "stl_files")
os.makedirs(STL_DIR, exist_ok=True)


# ============================================================================
# État de session
# ============================================================================

ss = st.session_state
ss.setdefault("last_result", None)         # résultat de "Générer"
ss.setdefault("last_sketch", None)
ss.setdefault("cad_design", None)          # design importé/saisi
ss.setdefault("cad_stl_data", None)        # données STL parsées
ss.setdefault("optimization_result", None) # résultat de l'optimiseur
ss.setdefault("compare_optimized_idx", None)


# ============================================================================
# Sidebar — formulaire principal de génération
# ============================================================================

st.sidebar.title("🎣 Lure AI")
st.sidebar.caption("Concepteur intelligent de leurres")

with st.sidebar.form("user_request_form"):
    st.subheader("Paramètres de pêche")

    species = st.selectbox("Espèce visée", user_input.VALID_SPECIES, index=1)
    season = st.selectbox("Saison", user_input.VALID_SEASONS, index=2)
    water_type = st.selectbox("Type d'eau", user_input.VALID_WATER_TYPES)
    water_clarity = st.selectbox("Clarté de l'eau", user_input.VALID_WATER_CLARITY, index=2)
    target_depth_m = st.slider("Profondeur cible (m)", 0.0, 15.0, 4.0, 0.5)
    desired_action = st.selectbox("Action voulue", user_input.VALID_ACTIONS, index=1)

    st.subheader("Fabrication")
    material = st.selectbox("Matériau", user_input.VALID_MATERIALS)
    max_length_cm = st.slider("Longueur max (cm)", 3.0, 25.0, 10.0, 0.5)
    desired_buoyancy = st.selectbox("Flottabilité désirée", user_input.VALID_BUOYANCY, index=2)
    manufacturing = st.selectbox("Méthode de fabrication", user_input.VALID_MANUFACTURING)

    submitted = st.form_submit_button("🎯 Générer le design", use_container_width=True)


def _build_user_request_dict():
    return {
        "species": species, "season": season, "water_type": water_type,
        "water_clarity": water_clarity, "target_depth_m": target_depth_m,
        "desired_action": desired_action, "material": material,
        "max_length_cm": max_length_cm, "desired_buoyancy": desired_buoyancy,
        "manufacturing": manufacturing,
    }


if submitted:
    try:
        result = recommendation.recommend(_build_user_request_dict(), n_variants=3)
        ss.last_result = result
        ss.last_sketch = sketch_generator.draw_lure(result["main"])
        st.sidebar.success("Design généré !")
    except ValueError as e:
        st.sidebar.error(f"Entrée invalide : {e}")


# ============================================================================
# Zone principale
# ============================================================================

st.title("Concepteur de leurres de pêche")

tabs = st.tabs([
    "🎯 Design",
    "📐 Importer CAO",
    "⚡ Optimiser",
    "🌊 Wobbling 3D",
    "🧪 Tests réels",
    "📚 Historique",
    "🤖 Apprentissage",
])
tab_design, tab_cad, tab_optim, tab_wobble, tab_test, tab_history, tab_learn = tabs


# ----------------------------------------------------------------------------
# Onglet 1 — Design (V1, inchangé fonctionnellement)
# ----------------------------------------------------------------------------

with tab_design:
    if ss.last_result is None:
        st.info("👈 Remplissez le formulaire à gauche puis cliquez sur **Générer le design**.")
    else:
        main: LureDesign = ss.last_result["main"]
        variants = ss.last_result["variants"]

        col1, col2 = st.columns([1.1, 1])

        with col1:
            st.subheader(f"Design principal — {main.lure_type.replace('_', ' ').title()}")
            st.metric("Score global", f"{main.score:.1f} / 100")
            if ss.last_sketch:
                st.image(ss.last_sketch, caption="Croquis 2D du leurre", use_container_width=True)

            if st.button("💾 Sauvegarder ce design et ses variantes", key="save_main"):
                database.save_design(main)
                for v in variants:
                    database.save_design(v)
                st.success(f"Design {main.design_id} + {len(variants)} variantes sauvegardés.")

        with col2:
            st.subheader("Caractéristiques")
            st.table(pd.DataFrame({
                "Paramètre": [
                    "ID", "Longueur (cm)", "Largeur (cm)", "Hauteur (cm)",
                    "Volume (cm³)", "Masse cible (g)", "Densité (g/cm³)",
                    "Flottabilité", "CG (% du nez)", "Bavette", "Angle bavette (°)",
                    "Hameçons", "Profondeur prédite (m)", "Stabilité",
                    "Wobbling fréq. (Hz)", "Wobbling ampl. (°)",
                ],
                "Valeur": [
                    main.design_id,
                    f"{main.length_cm:.2f}", f"{main.width_cm:.2f}", f"{main.height_cm:.2f}",
                    f"{main.volume_cm3:.1f}", f"{main.target_mass_g:.1f}", f"{main.density_g_cm3:.3f}",
                    main.buoyancy_state, f"{main.cog_position_pct:.0f}",
                    main.bib_type, f"{main.bib_angle_deg:.0f}", f"{main.hook_count}",
                    f"{main.predicted_depth_m:.2f}", f"{main.stability_score:.2f}",
                    f"{main.wobble_frequency_hz:.2f}", f"{main.wobble_amplitude_deg:.1f}",
                ],
            }))
            st.markdown("**Couleurs :** " + ", ".join(main.recommended_colors))

        if main.warnings:
            st.warning("**Avertissements :**\n\n" + "\n".join(f"- {w}" for w in main.warnings))

        st.subheader("Variantes alternatives")
        df_var = pd.DataFrame([
            {
                "Variante": v.variant_label, "ID": v.design_id,
                "Longueur": f"{v.length_cm:.1f}", "Masse": f"{v.target_mass_g:.1f}",
                "CG (%)": f"{v.cog_position_pct:.0f}",
                "Profondeur": f"{v.predicted_depth_m:.2f}",
                "Flottabilité": v.buoyancy_state, "Score": f"{v.score:.1f}",
            } for v in variants
        ])
        st.dataframe(df_var, use_container_width=True)


# ----------------------------------------------------------------------------
# Onglet 2 — Importer un design CAO (SolidWorks, etc.)
# ----------------------------------------------------------------------------

with tab_cad:
    st.subheader("📐 Importer un design existant depuis votre CAO")
    st.caption(
        "Workflow : modélisez votre leurre dans SolidWorks (ou autre), exportez en STL "
        "et copiez-collez le rapport Mass Properties. L'IA analysera votre design réel "
        "et proposera des optimisations chiffrées."
    )

    col_a, col_b = st.columns(2)

    with col_a:
        st.markdown("### 1. Géométrie")
        design_name = st.text_input("Nom du design", value="Mon prototype",
                                    help="Pour le retrouver dans l'historique.")
        stl_file = st.file_uploader(
            "Fichier STL (export depuis SolidWorks)",
            type=["stl"],
            help="Dans SolidWorks : Fichier → Enregistrer sous → STL. Préférer 'Binaire' et unités mm.",
        )

        if stl_file is not None and not cad_import.STL_AVAILABLE:
            st.error(
                "Le module 'numpy-stl' n'est pas installé dans cet environnement. "
                "Installez-le avec : `pip install numpy-stl`"
            )

        if stl_file is not None and cad_import.STL_AVAILABLE:
            try:
                # Sauvegarder temporairement
                stl_path = os.path.join(STL_DIR, stl_file.name)
                with open(stl_path, "wb") as f:
                    f.write(stl_file.read())
                stl_data = cad_import.read_stl(stl_path)
                ss.cad_stl_data = stl_data
                ss._stl_path = stl_path

                st.success(
                    f"✅ STL chargé : {stl_data['length_cm']:.2f} × "
                    f"{stl_data['width_cm']:.2f} × {stl_data['height_cm']:.2f} cm | "
                    f"Volume {stl_data['volume_cm3']:.1f} cm³"
                )
            except Exception as e:
                st.error(f"Erreur de lecture STL : {e}")

    with col_b:
        st.markdown("### 2. Mass Properties (depuis SolidWorks)")
        st.caption(
            "Dans SolidWorks : Évaluer → Propriétés de masse. "
            "Copiez-collez le rapport ci-dessous OU saisissez manuellement."
        )

        sw_text = st.text_area(
            "Coller le rapport SolidWorks ici",
            height=140,
            placeholder=(
                "Masse = 25.34 grammes\n"
                "Volume = 67.21 cm³\n"
                "Centre de masse:\n  X = 4.521\n  Y = -0.012\n  Z = -0.483\n"
                "Lxx = 12.34   Lyy = 56.78   Lzz = 89.01"
            ),
        )
        parsed = cad_import.parse_solidworks_text(sw_text) if sw_text.strip() else {}

    st.markdown("### 3. Vérifier / compléter les valeurs")

    cols = st.columns(4)
    mass_g = cols[0].number_input("Masse (g)", 0.0, 500.0, value=float(parsed.get("mass_g", 25.0)), step=0.1)
    volume_cm3 = cols[1].number_input(
        "Volume (cm³)", 0.0, 1000.0,
        value=float(parsed.get("volume_cm3", ss.cad_stl_data["volume_cm3"] if ss.cad_stl_data else 30.0)),
        step=0.1
    )
    surface = cols[2].number_input("Surface (cm²)", 0.0, 2000.0, value=float(parsed.get("surface_area_cm2", 0.0)), step=0.1)
    density = cols[3].number_input(
        "Densité (g/cm³)", 0.0, 20.0,
        value=float(parsed.get("density_g_cm3", mass_g / volume_cm3 if volume_cm3 > 0 else 0.5)),
        step=0.001, format="%.3f"
    )

    st.markdown("**Centre de gravité (cm depuis le nez)**")
    cols = st.columns(3)
    cog_x = cols[0].number_input("CG X (longueur)", -50.0, 50.0, value=float(parsed.get("cog_x_cm", 5.0)), step=0.01)
    cog_y = cols[1].number_input("CG Y (latéral)", -10.0, 10.0, value=float(parsed.get("cog_y_cm", 0.0)), step=0.01)
    cog_z = cols[2].number_input("CG Z (vertical)", -10.0, 10.0, value=float(parsed.get("cog_z_cm", 0.0)), step=0.01)

    st.markdown("**Moments d'inertie au CG (g·cm²)**")
    cols = st.columns(3)
    ixx = cols[0].number_input("Ixx (roulis)", 0.0, 1e6, value=float(parsed.get("ixx", 5.0)), step=0.1, format="%.2f")
    iyy = cols[1].number_input("Iyy (tangage)", 0.0, 1e6, value=float(parsed.get("iyy", 50.0)), step=0.1, format="%.2f")
    izz = cols[2].number_input("Izz (lacet/wobbling)", 0.0, 1e6, value=float(parsed.get("izz", 50.0)), step=0.1, format="%.2f")

    st.markdown("### 4. Caractéristiques du leurre")
    cols = st.columns(3)
    lure_type_cad = cols[0].selectbox(
        "Type", ["custom_cad", "minnowbait", "minnowbait_long", "jerkbait",
                 "crankbait_plongeant", "lipless_crankbait", "glidebait", "popper", "jig"]
    )
    bib_type_cad = cols[1].selectbox(
        "Bavette", ["aucune", "courte", "moyenne", "longue", "extra_longue"], index=2
    )
    bib_angle_cad = cols[2].slider("Angle bavette (°)", 0, 90, 60)

    st.markdown("### 5. Objectifs de pêche (pour scoring et optimisation)")
    use_request = st.checkbox(
        "Utiliser les paramètres de pêche du formulaire de gauche", value=True
    )

    if st.button("📥 Importer ce design", type="primary"):
        try:
            mass_props = MassProperties(
                mass_g=mass_g, volume_cm3=volume_cm3, surface_area_cm2=surface,
                density_g_cm3=density,
                cog_x_cm=cog_x, cog_y_cm=cog_y, cog_z_cm=cog_z,
                ixx=ixx, iyy=iyy, izz=izz,
            )
            req = None
            if use_request:
                try:
                    req = user_input.build_user_request(_build_user_request_dict())
                except ValueError:
                    req = None

            stl_path = ss.get("_stl_path") if ss.cad_stl_data is not None else None
            cad_design = cad_import.build_design_from_cad(
                name=design_name, stl_path=stl_path, mass_props=mass_props,
                lure_type=lure_type_cad, bib_type=bib_type_cad,
                bib_angle_deg=float(bib_angle_cad), hook_count=2, user_request=req,
            )

            # Simulation + hydrodynamique
            from core import simulation as sim_mod
            cad_design.stability_score = sim_mod.assess_stability(cad_design.cog_position_pct, cad_design.lure_type)
            cad_design.action_intensity = sim_mod.assess_action_intensity(
                cad_design.lure_type, cad_design.bib_angle_deg,
                req.desired_action if req else "wobble"
            )
            cad_design.roll_risk = sim_mod.assess_roll_risk(
                cad_design.cog_position_pct, cad_design.width_cm, cad_design.height_cm
            )
            cad_design.predicted_depth_m = sim_mod.predict_swim_depth(
                cad_design.lure_type, cad_design.bib_angle_deg,
                cad_design.length_cm, cad_design.density_g_cm3
            )
            hydrodynamics.apply_hydrodynamics(cad_design)
            learning.apply_learned_corrections(cad_design)

            # Scoring
            from core import optimizer as scoring
            scoring.score_design(cad_design, weights=learning.get_learned_weights())

            ss.cad_design = cad_design
            st.success(f"✅ Design importé. Score initial : {cad_design.score:.1f}/100")
        except Exception as e:
            st.error(f"Erreur : {e}")

    if ss.cad_design is not None:
        st.markdown("---")
        st.subheader("📊 Analyse du design importé")
        d = ss.cad_design
        col1, col2, col3, col4 = st.columns(4)
        col1.metric("Score", f"{d.score:.1f}/100")
        col2.metric("Densité", f"{d.density_g_cm3:.3f}", d.buoyancy_state)
        col3.metric("Profondeur", f"{d.predicted_depth_m:.2f} m")
        col4.metric("Wobbling", f"{d.wobble_frequency_hz:.2f} Hz", f"±{d.wobble_amplitude_deg:.0f}°")

        if d.warnings:
            st.warning("**Observations :**\n\n" + "\n".join(f"- {w}" for w in d.warnings))

        if st.button("💾 Sauvegarder ce design importé"):
            database.save_design(d)
            st.success(f"Design {d.design_id} sauvegardé.")


# ----------------------------------------------------------------------------
# Onglet 3 — Optimiser un design existant
# ----------------------------------------------------------------------------

with tab_optim:
    st.subheader("⚡ Suggestions d'optimisation")
    st.caption(
        "Sélectionnez un design existant. L'IA diagnostique les défauts par rapport "
        "aux objectifs et propose des modifications chiffrées (CG en mm, ballast en g, etc.)."
    )

    designs_df = database.load_designs()
    candidates = []
    if ss.cad_design is not None:
        candidates.append(("[en cours] " + (ss.cad_design.name or "CAO importé"), ss.cad_design))
    if ss.last_result is not None:
        candidates.append(("[en cours] " + ss.last_result["main"].lure_type, ss.last_result["main"]))

    db_options = []
    if not designs_df.empty:
        for _, r in designs_df.iterrows():
            label = f"{r['design_id']} — {r.get('name') or r['lure_type']} (score {r['score']:.0f})"
            db_options.append((label, r["design_id"]))

    if not candidates and not db_options:
        st.info("Aucun design disponible. Créez-en un ou importez un STL d'abord.")
    else:
        all_labels = [c[0] for c in candidates] + [d[0] for d in db_options]
        choice = st.selectbox("Design à optimiser", all_labels)

        target_design = None
        if choice in [c[0] for c in candidates]:
            target_design = next(c[1] for c in candidates if c[0] == choice)
        else:
            did = next(d[1] for d in db_options if d[0] == choice)
            payload = database.get_design(did)
            if payload:
                ur = payload.pop("user_request", None)
                mp = payload.pop("mass_properties", None)
                target_design = LureDesign(**{k: v for k, v in payload.items()
                                              if k in LureDesign.__dataclass_fields__})
                if ur:
                    target_design.user_request = UserRequest(**ur)
                if mp:
                    target_design.mass_properties = MassProperties(**mp)

        if target_design and st.button("🔍 Lancer l'analyse d'optimisation", type="primary"):
            with st.spinner("Diagnostic et génération des suggestions..."):
                result = optimization_engine.optimize_existing_design(target_design, max_suggestions=5)
                ss.optimization_result = (target_design, result)

        if ss.optimization_result is not None:
            base_design, opt_result = ss.optimization_result

            st.markdown("### 🩺 Diagnostic")
            if not opt_result["diagnosis"]:
                st.success("✅ Aucun défaut majeur détecté — le design est déjà bien équilibré !")
            else:
                for issue in opt_result["diagnosis"]:
                    sev = issue["severity"]
                    icon = "🔴" if sev > 0.7 else "🟠" if sev > 0.4 else "🟡"
                    st.write(f"{icon} **{issue['type']}** — {issue['description']}")

            st.markdown("### 💡 Suggestions d'amélioration (classées par gain)")
            if not opt_result["suggestions"]:
                st.info("Aucune suggestion : le design semble déjà optimal pour ces objectifs.")
            else:
                for i, (sugg, opt_design) in enumerate(zip(opt_result["suggestions"], opt_result["optimized_designs"])):
                    with st.expander(
                        f"#{i+1} — {sugg.title} | "
                        f"Score : {sugg.score_before:.1f} → {sugg.score_after:.1f} "
                        f"({sugg.score_delta:+.1f}) | Priorité : {sugg.priority}",
                        expanded=(i == 0),
                    ):
                        st.markdown(f"**Description :** {sugg.description}")

                        # Modifs chiffrées
                        modifs = []
                        if abs(sugg.delta_cog_x_mm) > 0.1:
                            modifs.append(f"Déplacer le CG de **{sugg.delta_cog_x_mm:+.1f} mm**")
                        if abs(sugg.delta_ballast_g) > 0.1:
                            modifs.append(f"Modifier le ballast de **{sugg.delta_ballast_g:+.1f} g**")
                        if abs(sugg.delta_bib_angle_deg) > 0.1:
                            modifs.append(f"Modifier l'angle de bavette de **{sugg.delta_bib_angle_deg:+.1f} °**")
                        if abs(sugg.delta_length_mm) > 0.1:
                            modifs.append(f"Modifier la longueur de **{sugg.delta_length_mm:+.1f} mm**")
                        if modifs:
                            st.markdown("**Modifications à appliquer dans votre CAO :**")
                            for m in modifs:
                                st.markdown(f"- {m}")

                        col_a, col_b = st.columns(2)
                        with col_a:
                            st.markdown("**✅ Améliorations attendues :**")
                            for imp in sugg.expected_improvements:
                                st.markdown(f"- {imp}")
                        with col_b:
                            st.markdown("**⚠ Compromis :**")
                            for tr in sugg.expected_tradeoffs:
                                st.markdown(f"- {tr}")

                        # Comparaison wobbling avant/après
                        try:
                            fig_cmp = cad_visualizer.plot_compare_two_wobbles(
                                base_design, opt_design,
                                label_a="Original", label_b="Optimisé"
                            )
                            st.plotly_chart(fig_cmp, use_container_width=True, key=f"cmp_{i}")
                        except Exception as e:
                            st.warning(f"Visualisation indisponible : {e}")

                        if st.button(f"💾 Sauvegarder cette variante optimisée", key=f"save_opt_{i}"):
                            database.save_design(opt_design)
                            st.success(f"Variante {opt_design.design_id} sauvegardée.")


# ----------------------------------------------------------------------------
# Onglet 4 — Visualisation 3D et animation wobbling
# ----------------------------------------------------------------------------

with tab_wobble:
    st.subheader("🌊 Visualisation 3D du wobbling")

    # Sélection de la source
    options = []
    if ss.cad_design is not None:
        options.append(("CAO importé : " + (ss.cad_design.name or ""), ss.cad_design, ss.cad_stl_data))
    if ss.last_result is not None:
        options.append(("Design généré : " + ss.last_result["main"].lure_type, ss.last_result["main"], None))

    if not options:
        st.info(
            "Importez un design CAO (onglet 📐) ou générez-en un (formulaire de gauche) "
            "pour voir son wobbling animé."
        )
    else:
        labels = [o[0] for o in options]
        choice = st.selectbox("Design à visualiser", labels)
        d, stl_data = next((o[1], o[2]) for o in options if o[0] == choice)

        col1, col2, col3, col4 = st.columns(4)
        col1.metric("Fréq. wobbling", f"{d.wobble_frequency_hz:.2f} Hz")
        col2.metric("Ampl. wobbling", f"±{d.wobble_amplitude_deg:.0f}°")
        col3.metric("Amortissement ζ", f"{d.wobble_damping:.3f}")
        col4.metric("Tangage", f"±{d.pitch_amplitude_deg:.0f}°")

        st.markdown("### 1. Modèle 3D statique (rotation à la souris)")
        try:
            fig3d = cad_visualizer.plot_3d_static(d, stl_data)
            st.plotly_chart(fig3d, use_container_width=True)
        except Exception as e:
            st.error(f"Erreur 3D statique : {e}")

        st.markdown("### 2. Animation 2D — vue dessus + vue côté")
        try:
            fig2d = cad_visualizer.plot_wobble_animation_2d(d)
            st.plotly_chart(fig2d, use_container_width=True)
        except Exception as e:
            st.error(f"Erreur animation 2D : {e}")

        st.markdown("### 3. Animation 3D — modèle qui oscille")
        st.caption("Cliquez sur ▶ Play sous le graphique. La rotation à la souris fonctionne aussi.")
        try:
            fig3da = cad_visualizer.plot_wobble_animation_3d(d, stl_data, n_frames=24)
            st.plotly_chart(fig3da, use_container_width=True)
        except Exception as e:
            st.error(f"Erreur animation 3D : {e}")


# ----------------------------------------------------------------------------
# Onglet 5 — Tests réels (V2 enrichie avec wobble observé)
# ----------------------------------------------------------------------------

with tab_test:
    st.subheader("🧪 Enregistrer un résultat de test réel")
    st.caption(
        "Après fabrication et test (terrain ou aquarium), saisissez vos observations. "
        "Si vous avez filmé le leurre, mesurez la fréquence et l'amplitude réelles "
        "du wobbling — l'IA s'en servira pour calibrer ses prédictions."
    )

    designs_df = database.load_designs()
    if designs_df.empty:
        st.info("Aucun design enregistré. Sauvegardez d'abord un design.")
    else:
        with st.form("test_result_form"):
            options = designs_df.apply(
                lambda r: f"{r['design_id']} — {r.get('name') or r['lure_type']} "
                          f"({r.get('species','')}, {r['length_cm']:.1f}cm)",
                axis=1,
            ).tolist()
            choice = st.selectbox("Design testé", options)
            design_id = choice.split(" — ")[0]

            col1, col2 = st.columns(2)
            with col1:
                actual_species = st.text_input("Espèce attrapée (vide si rien)", "")
                actual_depth = st.number_input("Profondeur de nage observée (m)", 0.0, 20.0, 3.0, 0.1)
                actual_buoyancy = st.selectbox("Flottabilité observée",
                                                ["flottant", "coulant", "suspending"], index=2)
                stab_obs = st.slider("Stabilité observée (0-10)", 0.0, 10.0, 7.0, 0.5)
            with col2:
                action_q = st.slider("Qualité de l'action (0-10)", 0.0, 10.0, 7.0, 0.5)
                catch = st.checkbox("Prise(s) réalisée(s) ?", value=False)
                catches = st.number_input("Nombre de prises", 0, 100, 0)

            st.markdown("**🎬 Observations vidéo (optionnel mais précieux pour l'IA)**")
            col3, col4 = st.columns(2)
            with col3:
                obs_freq = st.number_input(
                    "Fréquence wobbling observée (Hz)", 0.0, 15.0, 0.0, 0.1,
                    help="Comptez les oscillations sur 5 secondes ÷ 5"
                )
            with col4:
                obs_amp = st.number_input(
                    "Amplitude wobbling observée (°)", 0.0, 90.0, 0.0, 1.0,
                    help="Estimez l'angle d'oscillation crête à crête sur la vidéo"
                )
            video_path = st.text_input("Chemin vers la vidéo (facultatif)", "")
            notes = st.text_area("Notes libres", "")

            if st.form_submit_button("💾 Enregistrer le test"):
                result = TestResult(
                    design_id=design_id,
                    actual_species_caught=actual_species,
                    actual_depth_m=actual_depth,
                    actual_buoyancy=actual_buoyancy,
                    stability_observed=stab_obs,
                    action_quality=action_q,
                    catch_success=catch,
                    catches_count=catches,
                    observed_wobble_freq_hz=obs_freq if obs_freq > 0 else None,
                    observed_wobble_amp_deg=obs_amp if obs_amp > 0 else None,
                    video_path=video_path or None,
                    notes=notes,
                )
                database.save_test_result(result)
                st.success(f"Test enregistré (ID: {result.test_id}).")


# ----------------------------------------------------------------------------
# Onglet 6 — Historique
# ----------------------------------------------------------------------------

with tab_history:
    st.subheader("📚 Historique des designs")
    df = database.load_designs()
    if df.empty:
        st.info("Aucun design enregistré.")
    else:
        cols = ["design_id", "created_at", "name", "source", "lure_type",
                "species", "length_cm", "target_mass_g", "buoyancy_state",
                "predicted_depth_m", "wobble_frequency_hz", "score"]
        cols = [c for c in cols if c in df.columns]
        st.dataframe(df[cols], use_container_width=True)

    st.subheader("🧪 Historique des tests")
    tests_df = database.load_test_results()
    if tests_df.empty:
        st.info("Aucun test enregistré.")
    else:
        st.dataframe(tests_df, use_container_width=True)


# ----------------------------------------------------------------------------
# Onglet 7 — Boucle d'apprentissage
# ----------------------------------------------------------------------------

with tab_learn:
    st.subheader("🤖 Boucle d'apprentissage")
    st.markdown(
        """
        Chaque test enregistré ajuste **les paramètres internes** de l'IA :
        - **Biais de profondeur** : écart moyen profondeur prédite vs observée
        - **Calibration de la stabilité** : recalage des notes
        - **Calibration du wobbling** (V2) : fréquence et amplitude
        - **Poids du score** : critères qui prédisent le mieux le succès réel
        """
    )

    current = learning.load_learned_params()
    st.markdown("**Paramètres appris actuels :**")
    st.json(current)

    if st.button("🔁 Relancer l'apprentissage"):
        params = learning.retrain_from_tests(min_tests=3)
        st.code(params.get("report", "Aucun rapport."))
        st.rerun()
