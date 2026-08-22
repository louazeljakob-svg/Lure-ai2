/**
 * Images de reference calees dans les plans du modele.
 *
 * Le flux reprend celui d'un modeleur : on insere une photo ou un croquis
 * cote, on le projette sur un plan, puis on le met a l'echelle reelle en
 * pointant deux reperes dont on connait la distance. Le modele se sculpte
 * ensuite par-dessus.
 *
 * Les images vivent en memoire du navigateur (data URL) et ne sont pas
 * serialisees dans le projet JSON : un croquis en base64 pese vite plus lourd
 * que tout le reste du fichier.
 */

/** Plan de projection de la reference. */
export type ReferencePlane = 'profile' | 'top' | 'front';

export const REFERENCE_PLANES: { id: ReferencePlane; label: string; hint: string }[] = [
  { id: 'profile', label: 'Profil', hint: 'Plan longueur x hauteur, vu de cote' },
  { id: 'top', label: 'Dessus', hint: 'Plan longueur x largeur, vu de dessus' },
  { id: 'front', label: 'Face', hint: 'Plan hauteur x largeur, vu de face' },
];

export interface CalibrationPoints {
  /** Deux points en coordonnees image normalisees (0 a 1). */
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Distance reelle entre ces deux points, en mm. */
  mm: number;
}

export interface ReferenceImage {
  id: string;
  name: string;
  /** Contenu de l'image, en data URL. */
  src: string;
  plane: ReferencePlane;
  /** Rapport hauteur / largeur du fichier d'origine. */
  aspect: number;
  /** Largeur reelle sur le plan, en mm. */
  widthMm: number;
  /** Hauteur reelle sur le plan, en mm. */
  heightMm: number;
  lockAspect: boolean;
  /** Decalage dans le plan, en mm. */
  offsetX: number;
  offsetY: number;
  /** Decalage perpendiculaire au plan, en mm. */
  depth: number;
  /** Rotation dans le plan, en degres. */
  angle: number;
  opacity: number;
  flipH: boolean;
  flipV: boolean;
  visible: boolean;
  calibration: CalibrationPoints | null;
}

/** Lit un fichier image et en deduit ses proportions. */
export async function readReferenceImage(file: File): Promise<ReferenceImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Ce fichier n est pas une image.');
  }
  if (file.size > 12_000_000) {
    throw new Error('Image trop lourde : restez sous 12 Mo.');
  }

  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Lecture de l image impossible.'));
    reader.readAsDataURL(file);
  });

  const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('Image illisible.'));
    image.src = src;
  });

  const aspect = size.height / Math.max(size.width, 1);
  // Largeur de depart arbitraire : la calibration la corrigera.
  const widthMm = 120;
  return {
    id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: file.name.replace(/\.[^.]+$/, '').slice(0, 40),
    src,
    plane: 'profile',
    aspect,
    widthMm,
    heightMm: widthMm * aspect,
    lockAspect: true,
    offsetX: 0,
    offsetY: 0,
    depth: 0,
    angle: 0,
    opacity: 0.4,
    flipH: false,
    flipV: false,
    visible: true,
    calibration: null,
  };
}

/**
 * Recalcule l'echelle depuis deux reperes et leur distance reelle.
 *
 * Les points sont en coordonnees image ; leur ecart doit valoir `mm` une fois
 * l'image posee a l'echelle. Avec le ratio verrouille, une seule inconnue
 * subsiste, la largeur.
 */
export function applyCalibration(
  image: ReferenceImage,
  calibration: CalibrationPoints,
): ReferenceImage {
  const du = calibration.bx - calibration.ax;
  const dv = calibration.by - calibration.ay;
  const ratio = image.lockAspect ? image.aspect : image.heightMm / Math.max(image.widthMm, 1e-6);
  const span = Math.hypot(du, dv * ratio);
  if (span < 1e-4 || calibration.mm <= 0) return { ...image, calibration };
  const widthMm = calibration.mm / span;
  return {
    ...image,
    calibration,
    widthMm,
    heightMm: image.lockAspect ? widthMm * image.aspect : image.heightMm,
  };
}
