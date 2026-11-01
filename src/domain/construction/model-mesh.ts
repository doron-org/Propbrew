import { BufferGeometry, Float32BufferAttribute, Matrix4, Quaternion } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { detectModelFormat, MODEL_MAX_CANDIDATES, MODEL_MAX_COMPONENTS, type ModelComponent, type Point3 } from './model-clashes';

/** Review meshes are bounded so a single uploaded file cannot monopolise the server. */
export const MODEL_REVIEW_MAX_TRIANGLES = 100_000;
export type MeshElement = ModelComponent & { positions: number[]; triangleCount: number };
export type SurfaceContact = { a: ModelComponent; b: ModelComponent; point: Point3; clearanceMm: number; intersects: boolean };
export type RevisionChange = { id: string; name: string; kind: 'added' | 'removed' | 'geometry_changed'; beforeTriangles?: number; afterTriangles?: number; movementMm?: number };

const finite = (numbers: readonly number[]) => numbers.every(Number.isFinite);
function bounds(positions: number[]): { min: Point3; max: Point3 } {
  const min: Point3 = [Infinity, Infinity, Infinity], max: Point3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis], positions[i + axis]); max[axis] = Math.max(max[axis], positions[i + axis]);
  }
  return { min, max };
}
function element(id: string, name: string, positions: number[]): MeshElement {
  if (!positions.length || positions.length % 9 || !finite(positions)) throw new Error('The model contains invalid triangle geometry.');
  return { id, name, ...bounds(positions), positions, triangleCount: positions.length / 9 };
}
function validateTotal(elements: MeshElement[]): MeshElement[] {
  if (!elements.length || elements.length > MODEL_MAX_COMPONENTS) throw new Error('The model must contain 1 to 2,000 geometric elements.');
  if (elements.reduce((sum, row) => sum + row.triangleCount, 0) > MODEL_REVIEW_MAX_TRIANGLES)
    throw new Error('Interactive review supports 100,000 triangles. Export a floor or work package and try again.');
  return elements;
}

function parseObj(bytes: Uint8Array): MeshElement[] {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const vertices: Point3[] = [], groups = new Map<string, number[]>();
  let current = 'Model', triangles = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('o ') || line.startsWith('g ')) { current = line.slice(2).trim().slice(0, 120) || `Element ${groups.size + 1}`; continue; }
    if (line.startsWith('v ')) {
      const values = line.slice(2).trim().split(/\s+/).slice(0, 3).map(Number);
      if (values.length !== 3 || !finite(values)) throw new Error('OBJ has invalid vertex coordinates.');
      vertices.push(values as Point3);
      if (vertices.length > 750_000) throw new Error('OBJ has too many vertices.');
    }
    if (!line.startsWith('f ')) continue;
    const face = line.slice(2).trim().split(/\s+/).map((token) => {
      const raw = Number(token.split('/')[0]), index = raw > 0 ? raw - 1 : vertices.length + raw;
      if (!Number.isInteger(raw) || !raw || index < 0 || index >= vertices.length) throw new Error('OBJ face references a missing vertex.');
      return vertices[index];
    });
    if (face.length < 3 || face.length > 256) throw new Error('OBJ face has an unsupported vertex count.');
    const positions = groups.get(current) ?? []; groups.set(current, positions);
    for (let i = 1; i < face.length - 1; i++) {
      positions.push(...face[0], ...face[i], ...face[i + 1]);
      if (++triangles > MODEL_REVIEW_MAX_TRIANGLES) throw new Error('Interactive review supports 100,000 triangles. Export a floor or work package.');
    }
  }
  return validateTotal([...groups].filter(([, values]) => values.length).map(([name, positions], index) => element(`${name}#${index + 1}`, name, positions)));
}

type Glb = {
  buffers?: { byteLength: number; uri?: string }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; sparse?: unknown }[];
  meshes?: { name?: string; extras?: Record<string, unknown>; primitives: { mode?: number; attributes: { POSITION?: number }; indices?: number }[] }[];
  nodes?: { name?: string; extras?: Record<string, unknown>; mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  scenes?: { nodes?: number[] }[]; scene?: number;
};
function matrixFor(node: NonNullable<Glb['nodes']>[number]): Matrix4 {
  if (node.matrix) {
    if (node.matrix.length !== 16 || !finite(node.matrix)) throw new Error('GLB has an invalid transform.');
    return new Matrix4().fromArray(node.matrix);
  }
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = node.scale ?? [1, 1, 1], [tx, ty, tz] = node.translation ?? [0, 0, 0];
  if (![x, y, z, w, sx, sy, sz, tx, ty, tz].every(Number.isFinite)) throw new Error('GLB has an invalid transform.');
  const q = new Matrix4().makeRotationFromQuaternion(new Quaternion(x, y, z, w));
  return new Matrix4().makeTranslation(tx, ty, tz).multiply(q).multiply(new Matrix4().makeScale(sx, sy, sz));
}
function parseGlb(bytes: Uint8Array): MeshElement[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length) throw new Error('Choose a valid GLB 2.0 file.');
  let json: Glb | undefined, bin: Uint8Array | undefined;
  for (let at = 12; at + 8 <= bytes.length;) {
    const size = view.getUint32(at, true), type = view.getUint32(at + 4, true); at += 8;
    if (size > bytes.length - at) throw new Error('GLB chunk is incomplete.');
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(bytes.subarray(at, at + size))) as Glb;
    if (type === 0x004e4942) bin = bytes.subarray(at, at + size);
    at += size;
  }
  if (!json || !bin || json.buffers?.length !== 1 || json.buffers[0].uri || json.buffers[0].byteLength > bin.length) throw new Error('GLB must contain embedded geometry.');
  const model = json, binary = bin, meshes = model.meshes ?? [], nodes = model.nodes ?? [], output: MeshElement[] = [];
  let totalTriangles = 0;
  const data = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  function accessor(index: number, type: string, components: readonly number[]) {
    const item = model.accessors?.[index], source = item && model.bufferViews?.[item.bufferView ?? -1];
    if (!item || !source || item.type !== type || !components.includes(item.componentType) || item.sparse || source.buffer !== 0 || item.count < 1 || item.count > 750_000) throw new Error('GLB has unsupported geometry accessors.');
    const width = item.componentType === 5126 || item.componentType === 5125 ? 4 : item.componentType === 5123 ? 2 : 1;
    const itemSize = width * (type === 'VEC3' ? 3 : 1), stride = source.byteStride ?? itemSize;
    const start = (source.byteOffset ?? 0) + (item.byteOffset ?? 0), end = start + (item.count - 1) * stride + itemSize;
    if (stride < itemSize || start < 0 || end > (source.byteOffset ?? 0) + source.byteLength || end > binary.length) throw new Error('GLB geometry is incomplete.');
    return { item, start, stride };
  }
  function visit(index: number, parent: Matrix4, ancestors: Set<number>) {
    const node = nodes[index]; if (!node || ancestors.has(index)) throw new Error('GLB scene graph is invalid.');
    const world = parent.clone().multiply(matrixFor(node)), stack = new Set(ancestors).add(index);
    if (node.mesh !== undefined) {
      const mesh = meshes[node.mesh]; if (!mesh) throw new Error('GLB mesh is missing.');
      for (let p = 0; p < mesh.primitives.length; p++) {
        const primitive = mesh.primitives[p];
        if (primitive.mode !== undefined && primitive.mode !== 4) throw new Error('Interactive review needs triangle mesh primitives.');
        const positions = accessor(primitive.attributes.POSITION ?? -1, 'VEC3', [5126]);
        const vertices: Point3[] = [];
        for (let i = 0; i < positions.item.count; i++) {
          const at = positions.start + i * positions.stride, xyz: Point3 = [data.getFloat32(at, true), data.getFloat32(at + 4, true), data.getFloat32(at + 8, true)];
          if (!finite(xyz)) throw new Error('GLB contains invalid coordinates.');
          const [x, y, z] = xyz, e = world.elements;
          vertices.push([e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]]);
        }
        const indices = primitive.indices === undefined ? vertices.map((_, i) => i) : (() => {
          const source = accessor(primitive.indices!, 'SCALAR', [5121, 5123, 5125]), values: number[] = [];
          for (let i = 0; i < source.item.count; i++) { const at = source.start + i * source.stride;
            values.push(source.item.componentType === 5125 ? data.getUint32(at, true) : source.item.componentType === 5123 ? data.getUint16(at, true) : data.getUint8(at)); }
          return values;
        })();
        if (indices.length % 3) throw new Error('GLB triangle index count is invalid.');
        totalTriangles += indices.length / 3;
        if (totalTriangles > MODEL_REVIEW_MAX_TRIANGLES) throw new Error('Interactive review supports 100,000 triangles. Export a floor or work package.');
        const flat: number[] = [];
        for (const i of indices) { if (!vertices[i]) throw new Error('GLB triangle references a missing vertex.'); flat.push(...vertices[i]); }
        const rawId = node.extras?.ifcGuid ?? node.extras?.GlobalId ?? mesh.extras?.ifcGuid;
        const guid = typeof rawId === 'string' && rawId.trim() ? rawId.trim().slice(0, 64) : `node-${index}`;
        output.push(element(`${guid}:${p}`, (node.name || mesh.name || `Element ${index + 1}`).slice(0, 120), flat));
        if (output.length > MODEL_MAX_COMPONENTS) throw new Error('Interactive review model limit reached. Export a floor or work package.');
      }
    }
    for (const child of node.children ?? []) visit(child, world, stack);
  }
  const roots = model.scenes?.[model.scene ?? 0]?.nodes ?? nodes.map((_, i) => i).filter((i) => !nodes.some((node) => node.children?.includes(i)));
  for (const root of roots) visit(root, new Matrix4(), new Set());
  return validateTotal(output);
}
export function parseModelMesh(bytes: Uint8Array, name: string): MeshElement[] {
  const format = detectModelFormat(bytes, name);
  if (format === 'obj') return parseObj(bytes);
  if (format === 'glb') return parseGlb(bytes);
  throw new Error('Choose an OBJ or embedded GLB model. IFC geometry uses the IFC reader.');
}

function mayTouch(a: ModelComponent, b: ModelComponent, threshold: number) {
  return [0, 1, 2].every((axis) => a.min[axis] <= b.max[axis] + threshold && b.min[axis] <= a.max[axis] + threshold);
}
function geometry(row: MeshElement) {
  const result = new BufferGeometry(); result.setAttribute('position', new Float32BufferAttribute(row.positions, 3));
  return result;
}
/** Triangle surfaces are checked after envelope broad phase. Enclosed solids
 * without touching surfaces still need an engineering volume review. */
export function compareMeshSurfaces(a: readonly MeshElement[], b: readonly MeshElement[], toleranceMm = 5): SurfaceContact[] {
  if (!Number.isInteger(toleranceMm) || toleranceMm < 0 || toleranceMm > 1000) throw new Error('Choose a tolerance from 0 to 1,000 mm.');
  const threshold = toleranceMm / 1000, identity = new Matrix4(), candidates: SurfaceContact[] = [];
  const right = b.map((item) => { const mesh = geometry(item);
    (mesh as BufferGeometry & { boundsTree?: MeshBVH }).boundsTree = new MeshBVH(mesh);
    return { item, mesh }; });
  try {
    for (const left of a) {
      const leftGeometry = geometry(left), bvh = new MeshBVH(leftGeometry);
      try {
        for (const row of right) {
          if (!mayTouch(left, row.item, threshold)) continue;
          const intersects = Boolean(bvh.intersectsGeometry(row.mesh, identity));
          const nearest = bvh.closestPointToGeometry(row.mesh, identity, undefined, undefined, 0, Math.max(threshold, 0.000001));
          if (!intersects && (!nearest || (nearest.distance ?? Infinity) > threshold)) continue;
          const p = nearest?.point;
          const point: Point3 = p ? [p.x, p.y, p.z] : [(left.min[0] + left.max[0]) / 2, (left.min[1] + left.max[1]) / 2, (left.min[2] + left.max[2]) / 2];
          candidates.push({ a: left, b: row.item, point, intersects, clearanceMm: intersects ? 0 : Math.round((nearest?.distance ?? 0) * 1000) });
          if (candidates.length > MODEL_MAX_CANDIDATES) throw new Error('More than 100 surface contacts. Narrow the models by floor or work package.');
        }
      } finally { leftGeometry.dispose(); }
    }
  } finally { right.forEach((row) => row.mesh.dispose()); }
  return candidates;
}

function triangleSignature(row: MeshElement, toleranceMm: number) {
  const step = Math.max(toleranceMm / 1000, 0.000001);
  const triangles: string[] = [];
  for (let i = 0; i < row.positions.length; i += 9) {
    const corners: string[] = [];
    for (let v = 0; v < 3; v++) corners.push(row.positions.slice(i + v * 3, i + v * 3 + 3).map((n) => Math.round(n / step)).join(','));
    triangles.push(corners.sort().join('|'));
  }
  return triangles.sort().join(';');
}
export function compareModelRevisions(before: readonly MeshElement[], after: readonly MeshElement[], toleranceMm = 2): RevisionChange[] {
  if (!Number.isInteger(toleranceMm) || toleranceMm < 0 || toleranceMm > 1000) throw new Error('Choose a tolerance from 0 to 1,000 mm.');
  const old = new Map(before.map((row) => [row.id, row])), next = new Map(after.map((row) => [row.id, row]));
  const result: RevisionChange[] = [];
  for (const [id, row] of old) {
    const current = next.get(id);
    if (!current) { result.push({ id, name: row.name, kind: 'removed', beforeTriangles: row.triangleCount }); continue; }
    if (triangleSignature(row, toleranceMm) !== triangleSignature(current, toleranceMm)) {
      const movement = Math.hypot(...row.min.map((value, axis) => current.min[axis] - value));
      result.push({ id, name: current.name, kind: 'geometry_changed', beforeTriangles: row.triangleCount, afterTriangles: current.triangleCount, movementMm: Math.round(movement * 1000) });
    }
  }
  for (const [id, row] of next) if (!old.has(id)) result.push({ id, name: row.name, kind: 'added', afterTriangles: row.triangleCount });
  return result;
}
