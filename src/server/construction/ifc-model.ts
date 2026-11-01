import 'server-only';
import { IfcAPI } from 'web-ifc';
import { detectModelFormat, MODEL_MAX_COMPONENTS, type ModelComponent, type Point3 } from '@/domain/construction/model-clashes';
import { MODEL_REVIEW_MAX_TRIANGLES, type MeshElement } from '@/domain/construction/model-mesh';

/** Convert native IFC geometry to the same metre-based review envelopes used for OBJ/GLB.
 * Express IDs and GlobalIds remain attached to candidates for BCF exchange. */
export async function parseIfcModel(bytes: Uint8Array): Promise<ModelComponent[]> {
  if (detectModelFormat(bytes, 'model.ifc') !== 'ifc') throw new Error('Choose a valid IFC STEP file of at most 12 MB.');
  const api = new IfcAPI();
  await api.Init(undefined, true);
  let modelId: number | undefined;
  try {
    modelId = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: false });
    const result: ModelComponent[] = [];
    let verticesSeen = 0;
    api.StreamAllMeshes(modelId, (mesh) => {
      if (result.length >= MODEL_MAX_COMPONENTS) throw new Error('IFC has more than 2,000 geometric components. Split it by floor or package.');
      const line = api.GetLine(modelId!, mesh.expressID);
      const guid = typeof line?.GlobalId?.value === 'string' ? line.GlobalId.value : `express-${mesh.expressID}`;
      const label = typeof line?.Name?.value === 'string' && line.Name.value.trim() ? line.Name.value.trim() : guid;
      const min: Point3 = [Infinity, Infinity, Infinity], max: Point3 = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < mesh.geometries.size(); i++) {
        const placed = mesh.geometries.get(i);
        const geometry = api.GetGeometry(modelId!, placed.geometryExpressID);
        try {
          const data = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
          if (data.length % 6 !== 0 || data.length === 0) continue;
          verticesSeen += data.length / 6;
          if (verticesSeen > 750_000) throw new Error('IFC has too many vertices. Split it by floor or package.');
          const m = placed.flatTransformation;
          if (m.length !== 16 || !m.every(Number.isFinite)) throw new Error('IFC has an invalid placement matrix.');
          for (let at = 0; at < data.length; at += 6) {
            const x = data[at], y = data[at + 1], z = data[at + 2];
            const point: Point3 = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
            if (!point.every(Number.isFinite)) throw new Error('IFC contains invalid geometry.');
            for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], point[axis]); max[axis] = Math.max(max[axis], point[axis]); }
          }
        } finally { geometry.delete(); }
      }
      if (Number.isFinite(min[0])) result.push({ id: guid.slice(0, 64), name: label.slice(0, 120), min, max });
    }, true);
    if (!result.length) throw new Error('IFC has no readable geometric elements.');
    return result;
  } finally { if (modelId !== undefined) api.CloseModel(modelId); api.Dispose(); }
}

/** Native IFC triangle extraction for the interactive viewer and narrow-phase
 * coordination checks. The same GlobalId is used by BCF and the model register. */
export async function parseIfcMesh(bytes: Uint8Array): Promise<MeshElement[]> {
  if (detectModelFormat(bytes, 'model.ifc') !== 'ifc') throw new Error('Choose a valid IFC STEP file of at most 12 MB.');
  const api = new IfcAPI(); await api.Init(undefined, true);
  let modelId: number | undefined;
  try {
    modelId = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: false });
    const result: MeshElement[] = []; let total = 0;
    api.StreamAllMeshes(modelId, (mesh) => {
      if (result.length >= MODEL_MAX_COMPONENTS) throw new Error('IFC has more than 2,000 geometric elements. Export a floor or work package.');
      const line = api.GetLine(modelId!, mesh.expressID);
      const guid = typeof line?.GlobalId?.value === 'string' ? line.GlobalId.value.slice(0, 64) : `express-${mesh.expressID}`;
      const label = typeof line?.Name?.value === 'string' && line.Name.value.trim() ? line.Name.value.trim().slice(0, 120) : guid;
      const positions: number[] = [], min: Point3 = [Infinity, Infinity, Infinity], max: Point3 = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < mesh.geometries.size(); i++) {
        const placed = mesh.geometries.get(i), geometry = api.GetGeometry(modelId!, placed.geometryExpressID);
        try {
          const vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
          const indices = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
          const m = placed.flatTransformation;
          if (vertices.length % 6 || indices.length % 3 || m.length !== 16 || !m.every(Number.isFinite)) throw new Error('IFC geometry or placement is invalid.');
          total += indices.length / 3;
          if (total > MODEL_REVIEW_MAX_TRIANGLES) throw new Error('Interactive review supports 100,000 triangles. Export a floor or work package.');
          for (const index of indices) {
            const at = index * 6;
            if (at + 2 >= vertices.length) throw new Error('IFC triangle references a missing vertex.');
            const x = vertices[at], y = vertices[at + 1], z = vertices[at + 2];
            const point: Point3 = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
            if (!point.every(Number.isFinite)) throw new Error('IFC contains invalid coordinates.');
            positions.push(...point);
            for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], point[axis]); max[axis] = Math.max(max[axis], point[axis]); }
          }
        } finally { geometry.delete(); }
      }
      if (positions.length) result.push({ id: guid, name: label, min, max, positions, triangleCount: positions.length / 9 });
    }, true);
    if (!result.length) throw new Error('IFC has no readable triangle geometry.');
    return result;
  } finally { if (modelId !== undefined) api.CloseModel(modelId); api.Dispose(); }
}
