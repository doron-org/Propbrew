import { describe, expect, it } from 'vitest';
import { compareMeshSurfaces, compareModelRevisions, parseModelMesh, type MeshElement } from '@/domain/construction/model-mesh';

const obj = (label: string, points: number[][]) => new TextEncoder().encode(`o ${label}\n${points.map((p) => `v ${p.join(' ')}`).join('\n')}\nf 1 2 3\n`);
const mesh = (id: string, values: number[]): MeshElement => ({ id, name: id, min: [Math.min(values[0], values[3], values[6]), Math.min(values[1], values[4], values[7]), Math.min(values[2], values[5], values[8])],
  max: [Math.max(values[0], values[3], values[6]), Math.max(values[1], values[4], values[7]), Math.max(values[2], values[5], values[8])], positions: values, triangleCount: 1 });
function glb() {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const json = JSON.stringify({ asset: { version: '2.0' }, buffers: [{ byteLength: positions.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ name: 'Duct', extras: { ifcGuid: 'duct-guid' }, mesh: 0, translation: [2, 3, 4] }], scenes: [{ nodes: [0] }], scene: 0 });
  const encoded = new TextEncoder().encode(json), padded = Math.ceil(encoded.length / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + padded + 8 + positions.byteLength), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, padded, true); view.setUint32(16, 0x4e4f534a, true); bytes.set(encoded, 20); bytes.fill(32, 20 + encoded.length, 20 + padded);
  const at = 20 + padded; view.setUint32(at, positions.byteLength, true); view.setUint32(at + 4, 0x004e4942, true);
  bytes.set(new Uint8Array(positions.buffer), at + 8); return bytes;
}

describe('Construction triangle review', () => {
  it('keeps element IDs and triangle vertices from OBJ files', () => {
    const row = parseModelMesh(obj('Beam-42', [[0, 0, 0], [1, 0, 0], [0, 1, 0]]), 'structure.obj');
    expect(row).toMatchObject([{ id: 'Beam-42#1', triangleCount: 1, min: [0, 0, 0], max: [1, 1, 0] }]);
    expect(row[0].positions).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });
  it('applies embedded GLB node transforms and keeps exported IFC IDs', () => {
    const rows = parseModelMesh(glb(), 'model.glb');
    expect(rows).toMatchObject([{ id: 'duct-guid:0', name: 'Duct', triangleCount: 1, min: [2, 3, 4], max: [3, 4, 4] }]);
    expect(rows[0].positions).toEqual([2, 3, 4, 3, 3, 4, 2, 4, 4]);
  });
  it('rejects overlapping envelopes when triangle surfaces do not meet', () => {
    const a = mesh('beam', [0, 0, 0, 1, 0, 1, 0, 1, 1]);
    const b = mesh('duct', [0.6, 0.6, 0.1, 1.6, 0.6, 0.1, 0.6, 1.6, 0.1]);
    expect(compareMeshSurfaces([a], [b], 5)).toEqual([]);
  });
  it('distinguishes surface intersection from a near-miss inside tolerance', () => {
    const a = mesh('slab', [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const intersecting = mesh('pipe', [0.3, 0.3, -1, 0.3, 0.3, 1, 0.7, 0.3, 0]);
    const near = mesh('duct', [0, 0, 0.003, 1, 0, 0.003, 0, 1, 0.003]);
    expect(compareMeshSurfaces([a], [intersecting], 0)[0]).toMatchObject({ intersects: true, clearanceMm: 0 });
    expect(compareMeshSurfaces([a], [near], 5)[0]).toMatchObject({ intersects: false, clearanceMm: 3 });
    expect(compareMeshSurfaces([a], [near], 2)).toEqual([]);
  });
  it('detects added, removed and altered triangles even when a bounding box stays the same', () => {
    const old = mesh('A', [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const changed = mesh('A', [0, 0, 0, 1, 0, 0, 0.1, 1, 0]);
    expect(compareModelRevisions([old, mesh('removed', old.positions)], [changed, mesh('added', old.positions)], 2)
      .map((row) => [row.id, row.kind])).toEqual([['A', 'geometry_changed'], ['removed', 'removed'], ['added', 'added']]);
  });
});
