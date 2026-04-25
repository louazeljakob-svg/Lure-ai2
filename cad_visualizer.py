"""
core/cad_visualizer.py
----------------------
Visualisation 3D du leurre + animations du wobbling.

Trois sorties :
    1. plot_3d_static(design, stl_data) : modèle 3D interactif (rotation souris)
    2. plot_wobble_animation_2d(design) : animation 2D vue dessus + côté
    3. plot_wobble_animation_3d(design, stl_data) : modèle 3D qui oscille

Utilise plotly (rendu Streamlit natif, pas d'installation lourde).
"""

from __future__ import annotations
import math
from typing import Optional, Dict, Any

import numpy as np
import plotly.graph_objects as go

from models.lure_design import LureDesign


# ============================================================================
# 1. Vue 3D statique du modèle (avec CG visible)
# ============================================================================

def plot_3d_static(design: LureDesign, stl_data: Optional[dict] = None) -> go.Figure:
    """
    Affiche le modèle 3D du leurre.
    Si stl_data fourni → vraie géométrie. Sinon → ellipsoïde approximatif.
    Le centre de gravité est marqué d'un point rouge.
    """
    fig = go.Figure()

    if stl_data is not None:
        # Maillage réel depuis le STL
        faces = stl_data["faces"]  # (M, 3, 3) en cm
        vertices = faces.reshape(-1, 3)
        n_tri = faces.shape[0]
        i_idx = np.arange(0, n_tri * 3, 3)
        j_idx = i_idx + 1
        k_idx = i_idx + 2

        fig.add_trace(go.Mesh3d(
            x=vertices[:, 0],
            y=vertices[:, 1],
            z=vertices[:, 2],
            i=i_idx, j=j_idx, k=k_idx,
            color="#c4a76a",
            opacity=0.85,
            name="Corps (STL)",
            flatshading=True,
        ))
    else:
        # Ellipsoïde approximatif
        L, W, H = design.length_cm, design.width_cm, design.height_cm
        if L == 0:
            L, W, H = 10, 2.5, 3.5
        u = np.linspace(0, 2 * np.pi, 30)
        v = np.linspace(0, np.pi, 20)
        x = (L / 2) * (1 + np.outer(np.cos(u), np.sin(v)))
        y = (W / 2) * np.outer(np.sin(u), np.sin(v))
        z = (H / 2) * np.outer(np.ones_like(u), np.cos(v))

        fig.add_trace(go.Surface(
            x=x, y=y, z=z,
            colorscale=[[0, "#c4a76a"], [1, "#8b6f3a"]],
            showscale=False,
            opacity=0.85,
            name="Corps (approx)",
        ))

    # Centre de gravité
    if design.mass_properties is not None:
        cg_x = design.mass_properties.cog_x_cm
        cg_y = design.mass_properties.cog_y_cm
        cg_z = design.mass_properties.cog_z_cm
    else:
        cg_x = design.length_cm * (design.cog_position_pct / 100.0)
        cg_y = 0.0
        cg_z = 0.0

    fig.add_trace(go.Scatter3d(
        x=[cg_x], y=[cg_y], z=[cg_z],
        mode="markers+text",
        marker=dict(size=8, color="red", symbol="diamond"),
        text=["CG"],
        textposition="top center",
        name="Centre de gravité",
    ))

    # Axe de wobbling (axe Z passant par le CG)
    z_range = max(design.height_cm, 4.0)
    fig.add_trace(go.Scatter3d(
        x=[cg_x, cg_x], y=[cg_y, cg_y],
        z=[cg_z - z_range, cg_z + z_range],
        mode="lines",
        line=dict(color="red", width=3, dash="dash"),
        name="Axe de wobbling (Z)",
    ))

    fig.update_layout(
        scene=dict(
            xaxis_title="Longueur (cm)",
            yaxis_title="Largeur (cm)",
            zaxis_title="Hauteur (cm)",
            aspectmode="data",
        ),
        title=f"Modèle 3D — {design.name or design.lure_type}",
        margin=dict(l=0, r=0, t=40, b=0),
        height=500,
    )
    return fig


# ============================================================================
# 2. Animation 2D du wobbling (vue dessus + vue côté)
# ============================================================================

def plot_wobble_animation_2d(design: LureDesign, n_frames: int = 30) -> go.Figure:
    """
    Animation 2D du wobbling :
        - Vue de dessus : oscillation latérale (yaw)
        - Vue de côté   : oscillation verticale (pitch)
    """
    L = max(design.length_cm, 5.0)
    W = max(design.width_cm, 1.5)
    H = max(design.height_cm, 2.0)
    f_hz = max(design.wobble_frequency_hz, 0.5)
    yaw_amp = math.radians(design.wobble_amplitude_deg or 10.0)
    pitch_amp = math.radians(design.pitch_amplitude_deg or 5.0)

    period_s = 1.0 / f_hz
    times = np.linspace(0, 2 * period_s, n_frames)

    # Coordonnées du contour de l'ellipse vue de dessus (points pour rotation)
    u = np.linspace(0, 2 * np.pi, 40)
    body_x = (L / 2) * np.cos(u) + (L / 2)  # nez à 0, queue à L
    body_y_top = (W / 2) * np.sin(u)
    body_z_side = (H / 2) * np.sin(u)

    cg_x = design.cog_position_pct / 100.0 * L

    frames = []
    for t in times:
        yaw = yaw_amp * math.sin(2 * math.pi * f_hz * t)
        pitch = pitch_amp * math.sin(2 * math.pi * f_hz * t + math.pi / 4)

        # Rotation autour du CG (vue dessus)
        dx = body_x - cg_x
        dy = body_y_top
        rx_top = dx * math.cos(yaw) - dy * math.sin(yaw) + cg_x
        ry_top = dx * math.sin(yaw) + dy * math.cos(yaw)

        # Rotation autour du CG (vue côté)
        dz = body_z_side
        rx_side = dx * math.cos(pitch) - dz * math.sin(pitch) + cg_x
        rz_side = dx * math.sin(pitch) + dz * math.cos(pitch)

        frames.append(go.Frame(data=[
            go.Scatter(x=rx_top, y=ry_top, fill="toself",
                       fillcolor="#c4a76a", line=dict(color="#6b4e16"), xaxis="x1", yaxis="y1"),
            go.Scatter(x=[cg_x], y=[0], mode="markers",
                       marker=dict(size=12, color="red", symbol="x"), xaxis="x1", yaxis="y1"),
            go.Scatter(x=rx_side, y=rz_side, fill="toself",
                       fillcolor="#c4a76a", line=dict(color="#6b4e16"), xaxis="x2", yaxis="y2"),
            go.Scatter(x=[cg_x], y=[0], mode="markers",
                       marker=dict(size=12, color="red", symbol="x"), xaxis="x2", yaxis="y2"),
        ]))

    # Frame initiale
    fig = go.Figure(
        data=[
            go.Scatter(x=body_x, y=body_y_top, fill="toself",
                       fillcolor="#c4a76a", line=dict(color="#6b4e16"),
                       xaxis="x1", yaxis="y1", name="Vue dessus"),
            go.Scatter(x=[cg_x], y=[0], mode="markers",
                       marker=dict(size=12, color="red", symbol="x"),
                       xaxis="x1", yaxis="y1", name="CG (dessus)"),
            go.Scatter(x=body_x, y=body_z_side, fill="toself",
                       fillcolor="#c4a76a", line=dict(color="#6b4e16"),
                       xaxis="x2", yaxis="y2", name="Vue côté"),
            go.Scatter(x=[cg_x], y=[0], mode="markers",
                       marker=dict(size=12, color="red", symbol="x"),
                       xaxis="x2", yaxis="y2", name="CG (côté)"),
        ],
        frames=frames,
    )

    margin = max(L, W, H) * 0.6
    fig.update_layout(
        title=f"Wobbling animé — {design.wobble_frequency_hz:.1f} Hz, "
              f"amplitude ±{design.wobble_amplitude_deg:.0f}°",
        xaxis=dict(domain=[0, 0.48], title="X (cm)", range=[-margin, L + margin], scaleanchor="y"),
        yaxis=dict(title="Y (cm)", range=[-margin, margin]),
        xaxis2=dict(domain=[0.52, 1], title="X (cm)", range=[-margin, L + margin], scaleanchor="y2", anchor="y2"),
        yaxis2=dict(title="Z (cm)", range=[-margin, margin], anchor="x2"),
        height=420,
        showlegend=False,
        annotations=[
            dict(x=0.24, y=1.05, xref="paper", yref="paper", showarrow=False,
                 text="<b>Vue dessus (yaw / lacet)</b>"),
            dict(x=0.76, y=1.05, xref="paper", yref="paper", showarrow=False,
                 text="<b>Vue côté (pitch / tangage)</b>"),
        ],
        updatemenus=[dict(
            type="buttons",
            showactive=False,
            x=0.05, y=-0.12,
            buttons=[
                dict(label="▶ Play", method="animate",
                     args=[None, {"frame": {"duration": 60, "redraw": True}, "fromcurrent": True}]),
                dict(label="⏸ Pause", method="animate",
                     args=[[None], {"frame": {"duration": 0}, "mode": "immediate"}]),
            ],
        )],
    )
    return fig


# ============================================================================
# 3. Animation 3D — modèle complet qui oscille
# ============================================================================

def plot_wobble_animation_3d(design: LureDesign, stl_data: Optional[dict] = None,
                              n_frames: int = 24) -> go.Figure:
    """
    Anime le modèle 3D en train de wobbler.
    Si stl_data fourni → maillage réel. Sinon → ellipsoïde.
    """
    L = max(design.length_cm, 5.0)
    W = max(design.width_cm, 1.5)
    H = max(design.height_cm, 2.0)
    f_hz = max(design.wobble_frequency_hz, 0.5)
    yaw_amp = math.radians(design.wobble_amplitude_deg or 10.0)
    pitch_amp = math.radians(design.pitch_amplitude_deg or 5.0)

    if design.mass_properties is not None:
        cg = np.array([design.mass_properties.cog_x_cm,
                       design.mass_properties.cog_y_cm,
                       design.mass_properties.cog_z_cm])
    else:
        cg = np.array([L * design.cog_position_pct / 100.0, 0.0, 0.0])

    # Préparer la géométrie de base
    if stl_data is not None:
        faces = stl_data["faces"]  # (M, 3, 3)
        n_tri = faces.shape[0]
        base_vertices = faces.reshape(-1, 3)
        i_idx = np.arange(0, n_tri * 3, 3)
        j_idx = i_idx + 1
        k_idx = i_idx + 2
    else:
        # Ellipsoïde discrétisé en triangles
        from scipy.spatial import ConvexHull
        u = np.linspace(0, 2 * np.pi, 20)
        v = np.linspace(0, np.pi, 12)
        uu, vv = np.meshgrid(u, v)
        x = (L / 2) * (1 + np.cos(uu) * np.sin(vv))
        y = (W / 2) * np.sin(uu) * np.sin(vv)
        z = (H / 2) * np.cos(vv)
        base_vertices = np.stack([x.flatten(), y.flatten(), z.flatten()], axis=1)
        try:
            hull = ConvexHull(base_vertices)
            i_idx = hull.simplices[:, 0]
            j_idx = hull.simplices[:, 1]
            k_idx = hull.simplices[:, 2]
        except Exception:
            # Fallback : pas de mesh, juste un nuage de points
            i_idx = np.arange(0, len(base_vertices) - 2, 1)
            j_idx = i_idx + 1
            k_idx = i_idx + 2

    period_s = 1.0 / f_hz
    times = np.linspace(0, 2 * period_s, n_frames)

    def rotate_yaw_pitch(verts: np.ndarray, yaw: float, pitch: float, center: np.ndarray) -> np.ndarray:
        """Rotation autour du CG : yaw autour de Z, puis pitch autour de Y."""
        v = verts - center
        cy, sy = math.cos(yaw), math.sin(yaw)
        cp, sp = math.cos(pitch), math.sin(pitch)
        # yaw autour Z
        x1 = v[:, 0] * cy - v[:, 1] * sy
        y1 = v[:, 0] * sy + v[:, 1] * cy
        z1 = v[:, 2]
        # pitch autour Y
        x2 = x1 * cp + z1 * sp
        y2 = y1
        z2 = -x1 * sp + z1 * cp
        return np.stack([x2, y2, z2], axis=1) + center

    frames = []
    for t in times:
        yaw = yaw_amp * math.sin(2 * math.pi * f_hz * t)
        pitch = pitch_amp * math.sin(2 * math.pi * f_hz * t + math.pi / 4)
        v_rot = rotate_yaw_pitch(base_vertices, yaw, pitch, cg)
        frames.append(go.Frame(data=[
            go.Mesh3d(
                x=v_rot[:, 0], y=v_rot[:, 1], z=v_rot[:, 2],
                i=i_idx, j=j_idx, k=k_idx,
                color="#c4a76a", opacity=0.9, flatshading=True,
            ),
            go.Scatter3d(x=[cg[0]], y=[cg[1]], z=[cg[2]],
                         mode="markers", marker=dict(size=6, color="red")),
        ]))

    fig = go.Figure(
        data=[
            go.Mesh3d(
                x=base_vertices[:, 0], y=base_vertices[:, 1], z=base_vertices[:, 2],
                i=i_idx, j=j_idx, k=k_idx,
                color="#c4a76a", opacity=0.9, flatshading=True,
                name="Corps",
            ),
            go.Scatter3d(x=[cg[0]], y=[cg[1]], z=[cg[2]],
                         mode="markers", marker=dict(size=6, color="red"), name="CG"),
        ],
        frames=frames,
    )

    fig.update_layout(
        title=f"Wobbling 3D — {f_hz:.1f} Hz, ±{math.degrees(yaw_amp):.0f}° yaw, "
              f"±{math.degrees(pitch_amp):.0f}° pitch",
        scene=dict(
            xaxis_title="X (cm)", yaxis_title="Y (cm)", zaxis_title="Z (cm)",
            aspectmode="data",
        ),
        height=500,
        margin=dict(l=0, r=0, t=40, b=0),
        updatemenus=[dict(
            type="buttons",
            showactive=False,
            x=0.05, y=0,
            buttons=[
                dict(label="▶ Play", method="animate",
                     args=[None, {"frame": {"duration": 80, "redraw": True}, "fromcurrent": True}]),
                dict(label="⏸ Pause", method="animate",
                     args=[[None], {"frame": {"duration": 0}, "mode": "immediate"}]),
            ],
        )],
    )
    return fig


# ============================================================================
# 4. Comparaison côte à côte (avant / après optimisation)
# ============================================================================

def plot_compare_two_wobbles(design_a: LureDesign, design_b: LureDesign,
                              label_a: str = "Original", label_b: str = "Optimisé") -> go.Figure:
    """
    Compare deux designs côte à côte (deux vues 2D du wobbling).
    Utile pour montrer l'effet d'une suggestion d'optimisation.
    """
    fig = go.Figure()

    for idx, (design, label, color) in enumerate([
        (design_a, label_a, "#c4a76a"),
        (design_b, label_b, "#5fb3a0"),
    ]):
        L = max(design.length_cm, 5.0)
        W = max(design.width_cm, 1.5)
        f_hz = max(design.wobble_frequency_hz, 0.5)
        yaw_amp_deg = design.wobble_amplitude_deg or 10.0

        # Pour la comparaison statique : on dessine 3 positions (gauche, centre, droite)
        u = np.linspace(0, 2 * np.pi, 40)
        body_x = (L / 2) * np.cos(u) + (L / 2)
        body_y = (W / 2) * np.sin(u)
        cg_x = design.cog_position_pct / 100.0 * L

        for sign, alpha in [(-1, 0.25), (0, 1.0), (1, 0.25)]:
            yaw = math.radians(yaw_amp_deg) * sign
            dx = body_x - cg_x
            dy = body_y
            rx = dx * math.cos(yaw) - dy * math.sin(yaw) + cg_x
            ry = dx * math.sin(yaw) + dy * math.cos(yaw)
            xaxis = "x1" if idx == 0 else "x2"
            yaxis = "y1" if idx == 0 else "y2"
            fig.add_trace(go.Scatter(
                x=rx, y=ry, fill="toself",
                fillcolor=color, line=dict(color="#333"),
                opacity=alpha, showlegend=False,
                xaxis=xaxis, yaxis=yaxis,
            ))

        # Annotation
        fig.add_annotation(
            x=0.24 if idx == 0 else 0.76,
            y=1.08, xref="paper", yref="paper", showarrow=False,
            text=f"<b>{label}</b><br>{f_hz:.1f} Hz, ±{yaw_amp_deg:.0f}°",
        )

    margin = max(design_a.length_cm, design_b.length_cm) * 0.4
    L_max = max(design_a.length_cm, design_b.length_cm)

    fig.update_layout(
        xaxis=dict(domain=[0, 0.48], range=[-margin, L_max + margin], scaleanchor="y"),
        yaxis=dict(range=[-margin, margin]),
        xaxis2=dict(domain=[0.52, 1], range=[-margin, L_max + margin], scaleanchor="y2", anchor="y2"),
        yaxis2=dict(range=[-margin, margin], anchor="x2"),
        height=380,
        title="Comparaison du wobbling (vue dessus, 3 positions)",
        margin=dict(t=80),
    )
    return fig
