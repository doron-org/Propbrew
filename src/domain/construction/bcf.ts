import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser';

export type BcfComment = { guid: string; dateISO: string; author: string; text?: string; viewpointGuid?: string;
  modifiedAtISO?: string; modifiedAuthor?: string };
export type BcfSnapshot = { fileName: string; mediaType: 'image/png' | 'image/jpeg'; base64: string };
export type BcfViewpoint = { guid: string; fileName?: string; index?: number; xml?: string; componentIds: string[];
  camera?: { kind: 'Perspective' | 'Orthogonal'; position: [number, number, number]; direction: [number, number, number]; up: [number, number, number];
    fieldOfView?: number; viewToWorldScale?: number; aspectRatio: number };
  snapshot?: BcfSnapshot; bitmaps?: BcfSnapshot[] };
export type BcfTopic = { guid: string; title: string; description: string; status: string; topicType?: string;
  createdAtISO: string; createdAuthor?: string; modifiedAtISO?: string; modifiedAuthor?: string;
  componentIds: string[]; point?: [number, number, number]; comments?: BcfComment[]; viewpoints?: BcfViewpoint[] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ifcGuid = /^[0-9A-Za-z_$]{22}$/;
const xml = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_', format: true, suppressEmptyNode: true });
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseAttributeValue: false, parseTagValue: false, processEntities: false });
const clean = (value: unknown, limit: number) => String(value ?? '').trim().slice(0, limit);
const array = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const dateISO = (value: unknown): string | undefined => { const raw = clean(value, 40); return raw && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : undefined; };
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const fileName = (value: unknown, suffix: RegExp): string => {
  const name = clean(value, 150);
  if (!name || !/^[A-Za-z0-9._-]+$/.test(name) || name.includes('..') || !suffix.test(name)) throw new Error('BCF viewpoint or snapshot filename is invalid.');
  return name;
};
const vector = (value: unknown): [number, number, number] | undefined => {
  const row = record(value), xyz = [Number(row.X), Number(row.Y), Number(row.Z)];
  return xyz.every(Number.isFinite) && ['X', 'Y', 'Z'].every((key) => row[key] !== undefined) ? xyz as [number, number, number] : undefined;
};
function imageType(bytes: Uint8Array): BcfSnapshot['mediaType'] | undefined {
  if (bytes.length >= 24 && bytes.subarray(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16), height = view.getUint32(20);
    return width > 0 && height > 0 && width <= 1500 && height <= 1500 ? 'image/png' : undefined;
  }
  if (bytes.length >= 12 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217) {
    for (let at = 2; at + 9 < bytes.length;) {
      if (bytes[at++] !== 255) break;
      while (bytes[at] === 255) at++;
      const marker = bytes[at++];
      if (marker === 216 || marker === 217 || marker === 1 || marker >= 208 && marker <= 215) continue;
      const length = bytes[at] * 256 + bytes[at + 1];
      if (length < 2 || at + length > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        const height = bytes[at + 3] * 256 + bytes[at + 4], width = bytes[at + 5] * 256 + bytes[at + 6];
        return width > 0 && height > 0 && width <= 1500 && height <= 1500 ? 'image/jpeg' : undefined;
      }
      at += length;
    }
  }
}
function cameraOf(info: Record<string, unknown>): BcfViewpoint['camera'] {
  const perspective = record(info.PerspectiveCamera), orthogonal = record(info.OrthogonalCamera);
  const isPerspective = !!info.PerspectiveCamera, source = isPerspective ? perspective : orthogonal;
  const position = vector(source.CameraViewPoint), direction = vector(source.CameraDirection), up = vector(source.CameraUpVector);
  const aspectRatio = Number(source.AspectRatio), fieldOfView = Number(source.FieldOfView), viewToWorldScale = Number(source.ViewToWorldScale);
  if (!position || !direction || !up || !Number.isFinite(aspectRatio) || aspectRatio <= 0 ||
    (isPerspective && (!Number.isFinite(fieldOfView) || fieldOfView <= 0 || fieldOfView >= 180)) ||
    (!isPerspective && (!Number.isFinite(viewToWorldScale) || viewToWorldScale <= 0))) return undefined;
  return { kind: isPerspective ? 'Perspective' : 'Orthogonal', position, direction, up, aspectRatio,
    ...(isPerspective ? { fieldOfView } : { viewToWorldScale }) };
}

function safeZipEntries(bytes: Uint8Array): void {
  if (bytes.length < 22 || bytes.length > 4 * 1024 * 1024) throw new Error('BCFZIP must be at most 4 MB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) if (view.getUint32(at, true) === 0x06054b50) { end = at; break; }
  if (end < 0) throw new Error('BCFZIP directory is invalid.');
  const count = view.getUint16(end + 10, true), directory = view.getUint32(end + 16, true);
  if (count > 600 || directory >= end) throw new Error('BCFZIP contains too many files.');
  let at = directory, total = 0; const paths = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) throw new Error('BCFZIP file directory is invalid.');
    const size = view.getUint32(at + 24, true), nameLen = view.getUint16(at + 28, true), extraLen = view.getUint16(at + 30, true), commentLen = view.getUint16(at + 32, true);
    if (at + 46 + nameLen + extraLen + commentLen > end) throw new Error('BCFZIP file directory is invalid.');
    const path = strFromU8(bytes.subarray(at + 46, at + 46 + nameLen));
    if (!path || paths.has(path) || path.startsWith('/') || path.includes('..') || path.includes('\\') || !/^[A-Za-z0-9._/-]+$/.test(path)) throw new Error('BCFZIP contains an unsafe or repeated path.');
    paths.add(path);
    total += size; if (size > 2 * 1024 * 1024 || total > 10 * 1024 * 1024) throw new Error('BCFZIP expands beyond the permitted size.');
    at += 46 + nameLen + extraLen + commentLen;
  }
}

export function parseBcfZip(bytes: Uint8Array): BcfTopic[] {
  safeZipEntries(bytes);
  const files = unzipSync(bytes);
  if (Object.values(files).reduce((sum, data) => sum + data.length, 0) > 10 * 1024 * 1024) throw new Error('BCFZIP expands beyond the permitted size.');
  const version = files['bcf.version'];
  if (!version || XMLValidator.validate(strFromU8(version)) !== true || parser.parse(strFromU8(version))?.Version?.['@_VersionId'] !== '3.0') throw new Error('Choose a BCF 3.0 ZIP file.');
  const entries = Object.entries(files).filter(([path]) => /^[0-9a-f-]{36}\/markup\.bcf$/i.test(path));
  if (!entries.length || entries.length > 100) throw new Error('BCFZIP must contain between 1 and 100 topics.');
  const seen = new Set<string>();
  return entries.map(([path, data]) => {
    const markup = strFromU8(data);
    if (XMLValidator.validate(markup) !== true) throw new Error('BCF topic markup is invalid.');
    const root = parser.parse(markup)?.Markup;
    const topic = root?.Topic;
    const guid = clean(topic?.['@_Guid'], 36).toLowerCase();
    if (!uuid.test(guid) || seen.has(guid) || path.slice(0, 36).toLowerCase() !== guid) throw new Error('BCF topic identifier is invalid, repeated or does not match its folder.');
    seen.add(guid);
    const title = clean(topic?.Title, 180), description = clean(topic?.Description, 2000);
    if (title.length < 4) throw new Error('BCF topic title is missing.');
    const status = clean(topic?.['@_TopicStatus'], 40);
    const createdAtISO = dateISO(topic?.CreationDate);
    if (!status || !createdAtISO) throw new Error('BCF topic status or creation date is missing.');
    const folder = path.slice(0, -'markup.bcf'.length);
    const viewRefs = array(topic?.Viewpoints?.ViewPoint);
    if (viewRefs.length > 20) throw new Error('BCF topic has too many viewpoints.');
    const viewGuids = new Set<string>();
    const viewpoints: BcfViewpoint[] = [];
    const componentIds: string[] = [];
    let point: BcfTopic['point'];
    for (const rawRef of viewRefs) {
      const ref = record(rawRef), viewGuid = clean(ref['@_Guid'], 36).toLowerCase();
      if (!uuid.test(viewGuid) || viewGuids.has(viewGuid)) throw new Error('BCF viewpoint identifier is invalid or repeated.');
      viewGuids.add(viewGuid);
      let name: string | undefined, body: string | undefined, info: Record<string, unknown> = {}, camera: BcfViewpoint['camera'];
      let selected: string[] = [];
      if (ref.Viewpoint !== undefined) {
        name = fileName(ref.Viewpoint, /\.bcfv$/i);
        const viewpoint = files[folder + name];
        if (!viewpoint) throw new Error('BCF viewpoint file is missing.');
        body = strFromU8(viewpoint);
        if (XMLValidator.validate(body) !== true) throw new Error('BCF viewpoint XML is invalid.');
        info = record(parser.parse(body)?.VisualizationInfo);
        if (clean(info['@_Guid'], 36).toLowerCase() !== viewGuid) throw new Error('BCF viewpoint identifier does not match its markup.');
        camera = cameraOf(info);
        if (!camera) throw new Error('BCF viewpoint camera is invalid.');
        selected = array(record(record(info.Components).Selection).Component).map((row) => clean(record(row)['@_IfcGuid'], 22)).filter((id) => ifcGuid.test(id));
        if (selected.length > 1000) throw new Error('BCF viewpoint selects too many model elements.');
        for (const id of selected) if (!componentIds.includes(id) && componentIds.length < 1000) componentIds.push(id);
        point ??= camera.position;
      }
      if (ref.Viewpoint === undefined && ref.Snapshot === undefined) throw new Error('BCF viewpoint has no view or snapshot.');
      let snapshot: BcfSnapshot | undefined;
      if (ref.Snapshot !== undefined) {
        const snapName = fileName(ref.Snapshot, /\.(png|jpe?g)$/i), image = files[folder + snapName];
        if (!image || image.length > 2 * 1024 * 1024) throw new Error('BCF snapshot is missing or too large.');
        const mediaType = imageType(image);
        if (!mediaType || (mediaType === 'image/png') !== /\.png$/i.test(snapName)) throw new Error('BCF snapshot format does not match its file.');
        snapshot = { fileName: snapName, mediaType, base64: Buffer.from(image).toString('base64') };
      }
      const index = ref.Index === undefined ? undefined : Number(ref.Index);
      if (index !== undefined && !Number.isInteger(index)) throw new Error('BCF viewpoint order is invalid.');
      const bitmapRefs = array(record(info.Bitmaps).Bitmap);
      if (bitmapRefs.length > 8) throw new Error('BCF viewpoint has too many bitmap overlays.');
      const bitmaps = bitmapRefs.map((bitmap) => {
        const attachmentName = fileName(record(bitmap).Reference, /\.(png|jpe?g)$/i), attachment = files[folder + attachmentName];
        if (!attachment || attachment.length > 2 * 1024 * 1024) throw new Error('BCF viewpoint bitmap is missing or too large.');
        const mediaType = imageType(attachment);
        if (!mediaType || (mediaType === 'image/png') !== /\.png$/i.test(attachmentName)) throw new Error('BCF viewpoint bitmap format does not match its file.');
        return { fileName: attachmentName, mediaType, base64: Buffer.from(attachment).toString('base64') };
      });
      viewpoints.push({ guid: viewGuid, fileName: name, index, xml: body, componentIds: selected, camera, snapshot, bitmaps });
    }
    const comments = array(record(topic?.Comments).Comment);
    if (comments.length > 300) throw new Error('BCF topic has too many comments.');
    const commentGuids = new Set<string>();
    const parsedComments: BcfComment[] = comments.map((raw) => {
      const row = record(raw), id = clean(row['@_Guid'], 36).toLowerCase(), date = dateISO(row.Date);
      const author = clean(row.Author, 160), text = clean(row.Comment, 2000) || undefined;
      const viewpointGuid = clean(record(row.Viewpoint)['@_Guid'], 36).toLowerCase() || undefined;
      if (!uuid.test(id) || commentGuids.has(id) || !date || !author || (!text && !viewpointGuid) || (viewpointGuid && !viewGuids.has(viewpointGuid))) throw new Error('BCF comment is invalid or references a missing viewpoint.');
      commentGuids.add(id);
      return { guid: id, dateISO: date, author, text, viewpointGuid,
        modifiedAtISO: dateISO(row.ModifiedDate), modifiedAuthor: clean(row.ModifiedAuthor, 160) || undefined };
    });
    return { guid, title, description, status, topicType: clean(topic?.['@_TopicType'], 80) || undefined,
      createdAtISO, createdAuthor: clean(topic?.CreationAuthor, 160) || undefined,
      modifiedAtISO: dateISO(topic?.ModifiedDate), modifiedAuthor: clean(topic?.ModifiedAuthor, 160) || undefined,
      componentIds, point, comments: parsedComments, viewpoints };
  });
}

export function createBcfZip(projectName: string, projectGuid: string, topics: BcfTopic[]): Uint8Array {
  if (!uuid.test(projectGuid) || !topics.length || topics.length > 100) throw new Error('Choose 1 to 100 coordination issues for BCF export.');
  const files: Record<string, Uint8Array> = {
    'bcf.version': strToU8(xml.build({ Version: { '@_VersionId': '3.0' } })),
    'project.bcfp': strToU8(xml.build({ ProjectInfo: { Project: { '@_ProjectId': projectGuid, Name: clean(projectName, 160) } } })),
  };
  for (const topic of topics) {
    if (!uuid.test(topic.guid)) throw new Error('BCF topic identifier is invalid.');
    const ids = topic.componentIds.filter((id) => ifcGuid.test(id)).slice(0, 20);
    const guid = topic.guid.toLowerCase();
    const generated: BcfViewpoint[] = topic.point && !topic.viewpoints?.length ? [{ guid, fileName: 'viewpoint.bcfv', componentIds: ids,
      camera: { kind: 'Perspective', position: topic.point, direction: [0, 0, -1], up: [0, 1, 0], fieldOfView: 60, aspectRatio: 1.6 },
      xml: xml.build({ VisualizationInfo: { '@_Guid': guid,
        ...(ids.length ? { Components: { Selection: { Component: ids.map((id) => ({ '@_IfcGuid': id })) } } } : {}),
        PerspectiveCamera: { CameraViewPoint: { X: topic.point[0], Y: topic.point[1], Z: topic.point[2] },
          CameraDirection: { X: 0, Y: 0, Z: -1 }, CameraUpVector: { X: 0, Y: 1, Z: 0 }, FieldOfView: 60, AspectRatio: 1.6 },
      } }) }] : [];
    const viewpoints = topic.viewpoints?.length ? topic.viewpoints : generated;
    if (viewpoints.length > 20 || (topic.comments?.length ?? 0) > 300) throw new Error('BCF topic exceeds the exchange limits.');
    const usedFiles = new Set<string>(), viewGuids = new Set<string>();
    for (const view of viewpoints) {
      const id = view.guid.toLowerCase();
      if (!uuid.test(id) || viewGuids.has(id) || Boolean(view.fileName) !== Boolean(view.xml) || !view.xml && !view.snapshot)
        throw new Error('Stored BCF viewpoint is invalid.');
      viewGuids.add(id);
      if (view.xml && view.fileName) {
        const name = fileName(view.fileName, /\.bcfv$/i);
        if (usedFiles.has(name) || XMLValidator.validate(view.xml) !== true ||
          clean(parser.parse(view.xml)?.VisualizationInfo?.['@_Guid'], 36).toLowerCase() !== id) throw new Error('Stored BCF viewpoint is invalid.');
        usedFiles.add(name); files[`${guid}/${name}`] = strToU8(view.xml);
      }
      if (view.snapshot) {
        const snapName = fileName(view.snapshot.fileName, /\.(png|jpe?g)$/i), data = Buffer.from(view.snapshot.base64, 'base64');
        if (usedFiles.has(snapName) || data.length > 2 * 1024 * 1024 || imageType(data) !== view.snapshot.mediaType) throw new Error('Stored BCF snapshot is invalid.');
        usedFiles.add(snapName); files[`${guid}/${snapName}`] = data;
      }
      for (const bitmap of view.bitmaps ?? []) {
        const bitmapName = fileName(bitmap.fileName, /\.(png|jpe?g)$/i), data = Buffer.from(bitmap.base64, 'base64');
        if (usedFiles.has(bitmapName) || data.length > 2 * 1024 * 1024 || imageType(data) !== bitmap.mediaType) throw new Error('Stored BCF viewpoint bitmap is invalid.');
        usedFiles.add(bitmapName); files[`${guid}/${bitmapName}`] = data;
      }
    }
    const comments = topic.comments?.map((comment) => {
      if (!uuid.test(comment.guid) || !dateISO(comment.dateISO) || !clean(comment.author, 160) ||
        (!comment.text && !comment.viewpointGuid) || (comment.viewpointGuid && !viewGuids.has(comment.viewpointGuid.toLowerCase()))) throw new Error('Stored BCF comment is invalid.');
      return { '@_Guid': comment.guid.toLowerCase(), Date: comment.dateISO, Author: clean(comment.author, 160),
        ...(comment.text ? { Comment: clean(comment.text, 2000) } : {}),
        ...(comment.viewpointGuid ? { Viewpoint: { '@_Guid': comment.viewpointGuid.toLowerCase() } } : {}),
        ...(comment.modifiedAtISO ? { ModifiedDate: comment.modifiedAtISO } : {}),
        ...(comment.modifiedAuthor ? { ModifiedAuthor: clean(comment.modifiedAuthor, 160) } : {}) };
    });
    files[`${guid}/`] = new Uint8Array();
    files[`${guid}/markup.bcf`] = strToU8(xml.build({ Markup: {
      Topic: { '@_Guid': guid, '@_TopicType': clean(topic.topicType, 80) || 'Clash', '@_TopicStatus': clean(topic.status, 40),
        Title: clean(topic.title, 180), CreationDate: topic.createdAtISO, CreationAuthor: clean(topic.createdAuthor, 160) || 'Propbrew',
        ...(topic.modifiedAtISO ? { ModifiedDate: topic.modifiedAtISO } : {}),
        ...(topic.modifiedAuthor ? { ModifiedAuthor: clean(topic.modifiedAuthor, 160) } : {}),
        ...(clean(topic.description, 2000) ? { Description: clean(topic.description, 2000) } : {}),
        ...(comments?.length ? { Comments: { Comment: comments } } : {}),
        ...(viewpoints.length ? { Viewpoints: { ViewPoint: viewpoints.map((view) => ({ '@_Guid': view.guid.toLowerCase(),
          ...(view.fileName ? { Viewpoint: view.fileName } : {}), ...(view.snapshot ? { Snapshot: view.snapshot.fileName } : {}),
          ...(view.index !== undefined ? { Index: view.index } : {}) })) } } : {}) },
    } }));
  }
  const zipped = zipSync(files, { level: 6 });
  if (zipped.length > 4 * 1024 * 1024) throw new Error('BCFZIP is larger than 4 MB. Export fewer topics or snapshots.');
  return zipped;
}
