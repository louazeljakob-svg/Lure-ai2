/**
 * Ecriture de fichiers STEP (ISO 10303-21, schema AP214).
 *
 * Le maillage procedural est converti en B-rep facette : chaque triangle
 * devient une ADVANCED_FACE portee par un PLAN, bornee par une EDGE_LOOP dont
 * les aretes sont PARTAGEES entre faces voisines. C'est cette topologie
 * partagee qui fait la difference entre une soupe de triangles et un solide
 * que les logiciels de CAO acceptent de mesurer, sectionner et usiner.
 *
 * Ce n'est pas une surface analytique : les faces restent planes. Le solide
 * est donc facette, a la resolution d'export choisie.
 */

import * as THREE from 'three';

/** Tolerance de soudure des sommets, en millimetres. */
const WELD = 1e-4;

class StepWriter {
  private readonly lines: string[] = [];
  private id = 0;

  /** Ajoute une entite et retourne sa reference (`#42`). */
  add(body: string): string {
    this.id += 1;
    this.lines.push(`#${this.id}=${body};`);
    return `#${this.id}`;
  }

  get count(): number {
    return this.id;
  }

  join(): string {
    return this.lines.join('\n');
  }
}

/** Un reel STEP doit toujours porter un point decimal. */
function real(value: number): string {
  if (!Number.isFinite(value)) return '0.';
  const fixed = value.toFixed(6);
  const trimmed = fixed.replace(/0+$/, '');
  return trimmed.endsWith('.') ? trimmed : trimmed;
}

const point3 = (x: number, y: number, z: number) =>
  `CARTESIAN_POINT('',(${real(x)},${real(y)},${real(z)}))`;

const direction3 = (x: number, y: number, z: number) =>
  `DIRECTION('',(${real(x)},${real(y)},${real(z)}))`;

interface WeldedMesh {
  positions: number[];
  triangles: [number, number, number][];
}

/** Fusionne les sommets coincidents : c'est ce qui rend la topologie fermee. */
function weld(geometry: THREE.BufferGeometry): WeldedMesh {
  const attribute = geometry.getAttribute('position') as THREE.BufferAttribute;
  const index = geometry.getIndex();
  const count = index ? index.count : attribute.count;

  const positions: number[] = [];
  const lookup = new Map<string, number>();

  const resolve = (i: number): number => {
    const x = attribute.getX(i);
    const y = attribute.getY(i);
    const z = attribute.getZ(i);
    const key = `${Math.round(x / WELD)},${Math.round(y / WELD)},${Math.round(z / WELD)}`;
    const existing = lookup.get(key);
    if (existing !== undefined) return existing;
    const id = positions.length / 3;
    positions.push(x, y, z);
    lookup.set(key, id);
    return id;
  };

  const triangles: [number, number, number][] = [];
  for (let i = 0; i < count; i += 3) {
    const a = resolve(index ? index.getX(i) : i);
    const b = resolve(index ? index.getX(i + 1) : i + 1);
    const c = resolve(index ? index.getX(i + 2) : i + 2);
    // Un triangle degenere apres soudure ne porte aucune surface.
    if (a === b || b === c || a === c) continue;
    triangles.push([a, b, c]);
  }

  return { positions, triangles };
}

interface ShellResult {
  ref: string;
  closed: boolean;
  faces: number;
}

/** Emet une piece complete et retourne la representation de son enveloppe. */
function writeShell(writer: StepWriter, geometry: THREE.BufferGeometry): ShellResult | null {
  const mesh = weld(geometry);
  if (mesh.triangles.length === 0) return null;

  const vertexCount = mesh.positions.length / 3;
  const pointRefs: string[] = new Array(vertexCount);
  const vertexRefs: string[] = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    pointRefs[i] = writer.add(
      point3(mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]),
    );
    vertexRefs[i] = writer.add(`VERTEX_POINT('',${pointRefs[i]})`);
  }

  // Arete partagee : memorisee dans le sens ou elle a ete rencontree la
  // premiere fois, les faces voisines la reutilisent en sens inverse.
  interface EdgeRecord {
    ref: string;
    from: number;
    uses: number;
  }
  const edges = new Map<string, EdgeRecord>();

  const edgeFor = (from: number, to: number): EdgeRecord => {
    const key = from < to ? `${from}_${to}` : `${to}_${from}`;
    const existing = edges.get(key);
    if (existing) {
      existing.uses += 1;
      return existing;
    }
    const ax = mesh.positions[from * 3];
    const ay = mesh.positions[from * 3 + 1];
    const az = mesh.positions[from * 3 + 2];
    const dx = mesh.positions[to * 3] - ax;
    const dy = mesh.positions[to * 3 + 1] - ay;
    const dz = mesh.positions[to * 3 + 2] - az;
    const length = Math.hypot(dx, dy, dz) || 1;
    const dir = writer.add(direction3(dx / length, dy / length, dz / length));
    const vector = writer.add(`VECTOR('',${dir},${real(length)})`);
    const line = writer.add(`LINE('',${pointRefs[from]},${vector})`);
    const ref = writer.add(
      `EDGE_CURVE('',${vertexRefs[from]},${vertexRefs[to]},${line},.T.)`,
    );
    const record: EdgeRecord = { ref, from, uses: 1 };
    edges.set(key, record);
    return record;
  };

  const faceRefs: string[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (const [i0, i1, i2] of mesh.triangles) {
    a.fromArray(mesh.positions, i0 * 3);
    b.fromArray(mesh.positions, i1 * 3);
    c.fromArray(mesh.positions, i2 * 3);
    edge1.subVectors(b, a);
    edge2.subVectors(c, a);
    normal.crossVectors(edge1, edge2);
    const area = normal.length();
    if (area < 1e-12) continue; // triangle sans surface : ignore
    normal.divideScalar(area);

    const oriented: string[] = [];
    const corners: [number, number][] = [
      [i0, i1],
      [i1, i2],
      [i2, i0],
    ];
    for (const [from, to] of corners) {
      const record = edgeFor(from, to);
      // `.T.` si la face parcourt l'arete dans le sens ou elle est stockee.
      const sense = record.from === from ? '.T.' : '.F.';
      oriented.push(writer.add(`ORIENTED_EDGE('',*,*,${record.ref},${sense})`));
    }

    const loop = writer.add(`EDGE_LOOP('',(${oriented.join(',')}))`);
    const bound = writer.add(`FACE_OUTER_BOUND('',${loop},.T.)`);
    const refDir = edge1.clone().normalize();
    const axis = writer.add(
      `AXIS2_PLACEMENT_3D('',${pointRefs[i0]},${writer.add(
        direction3(normal.x, normal.y, normal.z),
      )},${writer.add(direction3(refDir.x, refDir.y, refDir.z))})`,
    );
    const plane = writer.add(`PLANE('',${axis})`);
    faceRefs.push(writer.add(`ADVANCED_FACE('',(${bound}),${plane},.T.)`));
  }

  if (faceRefs.length === 0) return null;

  // Une enveloppe n'est fermee que si chaque arete est partagee par
  // exactement deux faces. Sinon on emet honnetement une surface ouverte
  // plutot qu'un solide invalide.
  let closed = true;
  for (const record of edges.values()) {
    if (record.uses !== 2) {
      closed = false;
      break;
    }
  }

  const faceList = faceRefs.join(',');
  if (closed) {
    const shell = writer.add(`CLOSED_SHELL('',(${faceList}))`);
    return { ref: writer.add(`MANIFOLD_SOLID_BREP('',${shell})`), closed, faces: faceRefs.length };
  }
  const shell = writer.add(`OPEN_SHELL('',(${faceList}))`);
  return {
    ref: writer.add(`SHELL_BASED_SURFACE_MODEL('',(${shell}))`),
    closed,
    faces: faceRefs.length,
  };
}

export interface StepFile {
  text: string;
  faces: number;
  entities: number;
  /** Vrai si toutes les pieces sont sorties en solides fermes. */
  solid: boolean;
}

export function buildStepFile(parts: THREE.BufferGeometry[], name: string): StepFile {
  const writer = new StepWriter();

  const origin = writer.add(point3(0, 0, 0));
  const axisZ = writer.add(direction3(0, 0, 1));
  const axisX = writer.add(direction3(1, 0, 0));
  const placement = writer.add(`AXIS2_PLACEMENT_3D('',${origin},${axisZ},${axisX})`);

  const shells: ShellResult[] = [];
  for (const part of parts) {
    const shell = writeShell(writer, part);
    if (shell) shells.push(shell);
  }

  const lengthUnit = writer.add(
    "( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )",
  );
  const angleUnit = writer.add(
    "( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )",
  );
  const solidAngleUnit = writer.add(
    "( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )",
  );
  const uncertainty = writer.add(
    `UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-05),${lengthUnit},'distance_accuracy_value','confusion accuracy')`,
  );
  const context = writer.add(
    `( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${uncertainty})) GLOBAL_UNIT_ASSIGNED_CONTEXT((${lengthUnit},${angleUnit},${solidAngleUnit})) REPRESENTATION_CONTEXT('Context','3D') )`,
  );

  const items = [placement, ...shells.map((shell) => shell.ref)].join(',');
  const representation = writer.add(
    `ADVANCED_BREP_SHAPE_REPRESENTATION('${name}',(${items}),${context})`,
  );

  const applicationContext = writer.add(
    "APPLICATION_CONTEXT('automotive design')",
  );
  writer.add(
    `APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2010,${applicationContext})`,
  );
  const product = writer.add(
    `PRODUCT('${name}','${name}','',(${writer.add(
      `PRODUCT_CONTEXT('',${applicationContext},'mechanical')`,
    )}))`,
  );
  const formation = writer.add(
    `PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',${product},.NOT_KNOWN.)`,
  );
  const definition = writer.add(
    `PRODUCT_DEFINITION('design','',${formation},${writer.add(
      `PRODUCT_DEFINITION_CONTEXT('part definition',${applicationContext},'design')`,
    )})`,
  );
  const shape = writer.add(`PRODUCT_DEFINITION_SHAPE('','',${definition})`);
  writer.add(`SHAPE_DEFINITION_REPRESENTATION(${shape},${representation})`);

  const stamp = new Date().toISOString().replace(/\.\d+Z$/, '');
  const text = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('Corps de leurre genere par SAKUMA'),'2;1');`,
    `FILE_NAME('${name}.step','${stamp}',('SAKUMA'),(''),'SAKUMA - editeur de leurres 3D','',''); `.trim(),
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    'ENDSEC;',
    'DATA;',
    writer.join(),
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');

  return {
    text,
    faces: shells.reduce((sum, shell) => sum + shell.faces, 0),
    entities: writer.count,
    solid: shells.every((shell) => shell.closed),
  };
}
