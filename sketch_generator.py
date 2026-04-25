"""
core/sketch_generator.py
------------------------
Génération d'un croquis 2D simple du leurre avec matplotlib.

On trace :
    - le corps du leurre (ellipse)
    - la bavette (polygone incliné)
    - l'œillet de traction (point)
    - les hameçons (triangles simples)
    - la position des poids (cercles gris remplis)
    - le centre de gravité (cible rouge)
    - une légende et les cotes principales
"""

from __future__ import annotations
import io
import matplotlib
matplotlib.use("Agg")  # backend sans écran, indispensable côté serveur / Streamlit
import matplotlib.pyplot as plt
from matplotlib.patches import Ellipse, Polygon, Circle
import math

from models.lure_design import LureDesign


def draw_lure(design: LureDesign, save_path: str | None = None) -> bytes:
    """
    Dessine le leurre et retourne les bytes PNG.
    Si save_path est fourni, sauvegarde aussi sur disque.
    """
    L = design.length_cm
    W = design.width_cm
    H = design.height_cm

    fig, ax = plt.subplots(figsize=(9, 4.5))

    # --- 1. Corps du leurre (ellipse vue de côté) -----------------------
    body = Ellipse(
        xy=(L / 2.0, 0),
        width=L,
        height=H,
        facecolor="#e8d9b0",
        edgecolor="#6b4e16",
        linewidth=1.8,
    )
    ax.add_patch(body)

    # --- 2. Bavette (lip) -----------------------------------------------
    # La bavette sort du bas-avant du corps, inclinée selon bib_angle_deg.
    if design.bib_type != "aucune":
        angle_rad = math.radians(design.bib_angle_deg)
        lip_length = {
            "courte": L * 0.25,
            "moyenne": L * 0.4,
            "longue": L * 0.55,
            "extra_longue": L * 0.75,
        }.get(design.bib_type, L * 0.4)
        lip_width = W * 0.9

        # Origine : nez-bas du corps
        x0, y0 = 0.0, -H * 0.3
        # Direction de la bavette : vers l'avant-bas
        dx = -math.sin(angle_rad) * lip_length
        dy = -math.cos(angle_rad) * lip_length
        x1, y1 = x0 + dx, y0 + dy

        # Polygone trapézoïdal
        perp_x = -dy / lip_length * (lip_width / 2)
        perp_y = dx / lip_length * (lip_width / 2)
        lip_poly = [
            (x0 - perp_x * 0.2, y0 - perp_y * 0.2),
            (x0 + perp_x * 0.2, y0 + perp_y * 0.2),
            (x1 + perp_x, y1 + perp_y),
            (x1 - perp_x, y1 - perp_y),
        ]
        lip = Polygon(lip_poly, facecolor="#b0c7d6", edgecolor="#2f5266", linewidth=1.5, alpha=0.85)
        ax.add_patch(lip)

        # --- Œillet de traction (au bout de la bavette) -----------------
        ax.plot(x1, y1, "o", color="silver", markersize=9, markeredgecolor="black")
        ax.annotate("œillet", xy=(x1, y1), xytext=(x1 - 0.5, y1 - 0.6), fontsize=8, color="black")
    else:
        # Œillet directement sur le nez
        ax.plot(0, 0, "o", color="silver", markersize=9, markeredgecolor="black")
        ax.annotate("œillet", xy=(0, 0), xytext=(-0.8, 0.4), fontsize=8)

    # --- 3. Hameçons ----------------------------------------------------
    # Répartis sous le corps selon le nombre
    n = design.hook_count
    for i in range(n):
        # Position x : répartie de ~20 % à ~95 % de la longueur
        if n == 1:
            x = L * 0.5
        else:
            x = L * (0.25 + 0.7 * i / (n - 1))
        y = -H / 2.0
        # Tige
        ax.plot([x, x], [y, y - H * 0.7], color="#444", linewidth=1.6)
        # Triangle (hameçon stylisé)
        tri = Polygon(
            [(x - W * 0.25, y - H * 0.7), (x + W * 0.25, y - H * 0.7), (x, y - H * 1.15)],
            facecolor="#222", edgecolor="#000",
        )
        ax.add_patch(tri)

    # --- 4. Position du ballast (poids internes) ------------------------
    # On pose un ou deux plombs symboliques près du CG
    cog_x = L * (design.cog_position_pct / 100.0)
    ballast_y = -H * 0.15
    ax.add_patch(Circle((cog_x - 0.2, ballast_y), radius=H * 0.12, color="#555"))
    ax.add_patch(Circle((cog_x + 0.2, ballast_y), radius=H * 0.12, color="#555"))

    # --- 5. Centre de gravité (marqueur cible) --------------------------
    ax.plot(cog_x, 0, marker="+", color="red", markersize=20, markeredgewidth=2.5)
    ax.add_patch(Circle((cog_x, 0), radius=H * 0.08, fill=False, edgecolor="red", linewidth=1.5))
    ax.annotate(
        f"CG ({design.cog_position_pct:.0f}%)",
        xy=(cog_x, 0),
        xytext=(cog_x - 0.5, H * 0.8),
        fontsize=9, color="red", fontweight="bold",
    )

    # --- 6. Cotes et titre ----------------------------------------------
    # Ligne de longueur
    ax.annotate("", xy=(0, H * 1.3), xytext=(L, H * 1.3),
                arrowprops=dict(arrowstyle="<->", color="gray"))
    ax.text(L / 2, H * 1.5, f"L = {L:.1f} cm", ha="center", fontsize=9, color="gray")

    title = (
        f"{design.lure_type.replace('_', ' ').title()} — "
        f"{design.target_mass_g:.1f} g — {design.buoyancy_state} — score {design.score:.0f}/100"
    )
    ax.set_title(title, fontsize=11, pad=15)

    # --- 7. Mise en page -----------------------------------------------
    margin_x = L * 0.25
    margin_y = H * 2.0
    ax.set_xlim(-margin_x, L + margin_x)
    ax.set_ylim(-H * 2.5, H * 2.5)
    ax.set_aspect("equal")
    ax.axis("off")

    # --- 8. Export ------------------------------------------------------
    buf = io.BytesIO()
    plt.savefig(buf, format="png", dpi=120, bbox_inches="tight")
    plt.close(fig)
    data = buf.getvalue()

    if save_path:
        with open(save_path, "wb") as f:
            f.write(data)

    return data
