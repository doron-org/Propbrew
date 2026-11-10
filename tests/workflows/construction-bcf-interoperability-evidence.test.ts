/**
 * Deterministic BCF 3.0 evidence-pack generator.
 *
 * Run explicitly with RUN_BCF_INTEROP_EVIDENCE=1. The generated archive and
 * extracted XML can then be validated independently with buildingSMART's
 * official XSD files. No customer or consultant project data is used.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createBcfZip, parseBcfZip, type BcfTopic } from '@/domain/construction/bcf';

const RUN = process.env.RUN_BCF_INTEROP_EVIDENCE === '1';
const OUT = process.env.BCF_INTEROP_OUT ?? fileURLToPath(new URL('../../docs/construction-bcf-interoperability-2026-11-10', import.meta.url));
const projectGuid = '12345678-1234-4234-8234-123456789abc';
const topicGuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const viewpointGuid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const commentGuid = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const componentId = '0sfBnoLAb0R9H9P$iaZWyE';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9z7xQAAAAASUVORK5CYII=';

const viewpoint = `<VisualizationInfo Guid="${viewpointGuid}"><Components><Selection><Component IfcGuid="${componentId}"/></Selection><Visibility DefaultVisibility="true"><Exceptions><Component IfcGuid="${componentId}"/></Exceptions></Visibility></Components><PerspectiveCamera><CameraViewPoint><X>12.5</X><Y>8.25</Y><Z>4</Z></CameraViewPoint><CameraDirection><X>0</X><Y>0</Y><Z>-1</Z></CameraDirection><CameraUpVector><X>0</X><Y>1</Y><Z>0</Z></CameraUpVector><FieldOfView>60</FieldOfView><AspectRatio>1.6</AspectRatio></PerspectiveCamera><ClippingPlanes><ClippingPlane><Location><X>12.5</X><Y>8.25</Y><Z>3.9</Z></Location><Direction><X>0</X><Y>0</Y><Z>1</Z></Direction></ClippingPlane></ClippingPlanes></VisualizationInfo>`;
const topic: BcfTopic = {
  guid: topicGuid, title: 'Duct and beam coordination review', description: 'Synthetic interoperability evidence; consultant review remains open.',
  status: 'Open', topicType: 'Clash', createdAtISO: '2026-11-10T09:00:00.000Z', createdAuthor: 'Propbrew interoperability harness',
  modifiedAtISO: '2026-11-10T09:15:00.000Z', modifiedAuthor: 'Propbrew interoperability harness', componentIds: [componentId],
  comments: [{ guid: commentGuid, dateISO: '2026-11-10T09:10:00.000Z', author: 'Propbrew interoperability harness', text: 'Retain this comment, camera, component ID and snapshot on import.', viewpointGuid }],
  viewpoints: [{ guid: viewpointGuid, fileName: 'coordination.bcfv', index: 0, xml: viewpoint, componentIds: [componentId],
    camera: { kind: 'Perspective', position: [12.5, 8.25, 4], direction: [0, 0, -1], up: [0, 1, 0], fieldOfView: 60, aspectRatio: 1.6 },
    snapshot: { fileName: 'coordination.png', mediaType: 'image/png', base64: png } }],
};

describe.skipIf(!RUN)('BCF interoperability evidence generator', () => {
  it('exports and reimports a complete BCF 3.0 evidence archive', () => {
    const bytes = createBcfZip('Propbrew synthetic coordination pilot', projectGuid, [topic]);
    const parsed = parseBcfZip(bytes);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ guid: topicGuid, componentIds: [componentId],
      comments: [{ guid: commentGuid, text: topic.comments![0].text, viewpointGuid }],
      viewpoints: [{ guid: viewpointGuid, xml: viewpoint, camera: { position: [12.5, 8.25, 4] }, snapshot: { base64: png } }] });

    const files = unzipSync(bytes);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'propbrew-coordination.bcf'), bytes);
    for (const [path, data] of Object.entries(files)) {
      if (path.endsWith('/')) continue;
      const target = join(OUT, 'extracted', ...path.split('/'));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, data);
    }
    writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({
      generatedAtISO: new Date().toISOString(), standard: 'BCF-XML 3.0', generator: 'Propbrew createBcfZip',
      evidenceClass: 'Synthetic interoperability fixture — not consultant or authoring-tool acceptance',
      archive: 'propbrew-coordination.bcf', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
      projectGuid, topicGuid, viewpointGuid, commentGuid, componentIds: [componentId], files: Object.keys(files).filter((path) => !path.endsWith('/')).sort(),
    }, null, 2) + '\n');
  });
});
