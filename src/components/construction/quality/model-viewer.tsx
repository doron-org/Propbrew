'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { BufferGeometry, Mesh, MeshStandardMaterial } from 'three';
import { Box, Focus, Layers3, Search } from 'lucide-react';
import { Button } from '@/components/ui';
import type { MeshElement } from '@/domain/construction/model-mesh';
import styles from './model-viewer.module.css';

type ViewerPayload = { model: { id: string; name: string; revision?: string; format: string }; elements: MeshElement[] };

export function ModelViewer({ modelId, focusElementId }: { modelId: string; focusElementId?: string }) {
  const mount = useRef<HTMLDivElement>(null);
  const cameraControl = useRef<{ target: { set: (x: number, y: number, z: number) => void }; update: () => void } | null>(null);
  const objects = useRef(new Map<string, { mesh: { visible: boolean; material: { color: { set: (color: string) => void }; wireframe: boolean } }; center: [number, number, number] }>());
  const redraw = useRef<(() => void) | null>(null);
  const [data, setData] = useState<ViewerPayload | null>(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(focusElementId ?? null);
  const [search, setSearch] = useState(''), [isolate, setIsolate] = useState(false), [wireframe, setWireframe] = useState(false);
  const [upAxis, setUpAxis] = useState<'z' | 'y'>('z');
  const selected = data?.elements.find((row) => row.id === selectedId);
  const listed = useMemo(() => data?.elements.filter((row) => `${row.name} ${row.id}`.toLowerCase().includes(search.toLowerCase())).slice(0, 100) ?? [], [data, search]);

  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/construction/models/${encodeURIComponent(modelId)}/mesh`, { signal: abort.signal, cache: 'no-store' })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Model geometry is unavailable.'); return body as ViewerPayload; })
      .then((body) => { if (!abort.signal.aborted) { setData(body); setLoading(false); } })
      .catch((cause) => { if (!abort.signal.aborted) { setError(cause instanceof Error ? cause.message : 'Model geometry is unavailable.'); setLoading(false); } });
    return () => abort.abort();
  }, [modelId]);

  useEffect(() => {
    if (!data || !mount.current) return;
    let stopped = false;
    let clean = () => {};
    void (async () => {
      try {
        const THREE = await import('three');
        const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
        if (stopped || !mount.current) return;
        const host = mount.current, width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setSize(width, height);
        const style = getComputedStyle(document.documentElement);
        const surface = style.getPropertyValue('--surface-2').trim() || '#f4f5f7';
        const brand = style.getPropertyValue('--brand-solid').trim() || '#4b49ed';
        const selectedColor = style.getPropertyValue('--primary').trim() || '#4544f4';
        renderer.setClearColor(surface); host.replaceChildren(renderer.domElement);
        const scene = new THREE.Scene();
        const group = new THREE.Group(); scene.add(group);
        const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 1_000_000);
        camera.up.set(0, 0, upAxis === 'z' ? 1 : 0);
        if (upAxis === 'y') camera.up.set(0, 1, 0);
        const grid = new THREE.GridHelper(10, 20, 0x9da2b0, 0xcdd1d8);
        if (upAxis === 'z') grid.rotation.x = Math.PI / 2;
        scene.add(grid);
        scene.add(new THREE.AmbientLight(0xffffff, 2));
        const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(10, 12, 15); scene.add(light);
        const meshes = new Map<string, { mesh: Mesh<BufferGeometry, MeshStandardMaterial>; center: [number, number, number] }>();
        for (const row of data.elements) {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.Float32BufferAttribute(row.positions, 3)); geometry.computeVertexNormals();
          const material = new THREE.MeshStandardMaterial({ color: brand, side: THREE.DoubleSide, transparent: true, opacity: 0.82, roughness: 0.86 });
          const mesh = new THREE.Mesh(geometry, material); mesh.userData.elementId = row.id; group.add(mesh);
          meshes.set(row.id, { mesh, center: [(row.min[0] + row.max[0]) / 2, (row.min[1] + row.max[1]) / 2, (row.min[2] + row.max[2]) / 2] });
        }
        objects.current = meshes;
        const box = new THREE.Box3().setFromObject(group), center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
        const distance = Math.max(size.length() * 1.25, 2);
        camera.position.set(center.x + distance, center.y + distance, center.z + distance);
        camera.near = Math.max(distance / 10000, 0.01); camera.far = Math.max(distance * 100, 100); camera.updateProjectionMatrix();
        grid.position.set(center.x, center.y, upAxis === 'z' ? box.min.z : center.z);
        const controls = new OrbitControls(camera, renderer.domElement); controls.target.copy(center); controls.enableDamping = false;
        controls.maxDistance = distance * 20; controls.update(); cameraControl.current = controls;
        const initialFocus = selectedId ? meshes.get(selectedId)?.center : undefined;
        if (initialFocus) { controls.target.set(...initialFocus); controls.update(); }
        const render = () => renderer.render(scene, camera); redraw.current = render; controls.addEventListener('change', render); render();
        const resize = new ResizeObserver(() => { const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
          camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); render(); }); resize.observe(host);
        const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
        let press: { x: number; y: number } | null = null;
        const pointerDown = (event: PointerEvent) => { press = { x: event.clientX, y: event.clientY }; };
        const click = (event: PointerEvent) => {
          if (!press || Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6) { press = null; return; }
          press = null;
          const rect = renderer.domElement.getBoundingClientRect();
          pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
          raycaster.setFromCamera(pointer, camera);
          const hit = raycaster.intersectObjects(group.children, false)[0];
          if (hit?.object.userData.elementId) setSelectedId(String(hit.object.userData.elementId));
        };
        renderer.domElement.addEventListener('pointerdown', pointerDown);
        renderer.domElement.addEventListener('pointerup', click);
        clean = () => { resize.disconnect(); controls.removeEventListener('change', render); controls.dispose(); renderer.domElement.removeEventListener('pointerup', click);
          renderer.domElement.removeEventListener('pointerdown', pointerDown);
          group.children.forEach((item) => { const mesh = item as Mesh<BufferGeometry, MeshStandardMaterial>; mesh.geometry.dispose(); mesh.material.dispose(); });
          grid.geometry.dispose();
          if (Array.isArray(grid.material)) grid.material.forEach((material) => material.dispose()); else grid.material.dispose();
          renderer.dispose(); host.replaceChildren(); objects.current.clear(); cameraControl.current = null; redraw.current = null; };
        // Apply the initial selection after the meshes have been created.
        for (const [id, row] of meshes) row.mesh.material.color.set(id === selectedId ? selectedColor : brand);
        render();
      } catch { if (!stopped) setError('This device cannot open the 3D canvas. Element details remain available below.'); }
    })();
    return () => { stopped = true; clean(); };
    // The viewer is rebuilt only when the model or coordinate-up choice changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, upAxis]);

  useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    const brand = style.getPropertyValue('--brand-solid').trim() || '#4b49ed';
    const selectedColor = style.getPropertyValue('--primary').trim() || '#4544f4';
    for (const [id, row] of objects.current) {
      // Three.js objects are imperative render resources, not React state.
      // eslint-disable-next-line react-hooks/immutability
      row.mesh.visible = !isolate || !selectedId || id === selectedId;
      row.mesh.material.color.set(id === selectedId ? selectedColor : brand);
      row.mesh.material.wireframe = wireframe;
    }
    const target = selectedId ? objects.current.get(selectedId)?.center : undefined;
    if (target && cameraControl.current) { cameraControl.current.target.set(...target); cameraControl.current.update(); }
    redraw.current?.();
  }, [selectedId, isolate, wireframe]);

  function focus(id: string) { setSelectedId(id); const target = objects.current.get(id)?.center;
    if (target && cameraControl.current) { cameraControl.current.target.set(...target); cameraControl.current.update(); redraw.current?.(); } }

  return <div className={styles.layout}>
    <div className={styles.stage}>
      <div className={styles.toolbar}>
        <strong><Layers3 size={17} /> {data?.model.name ?? 'Model viewer'}</strong>
        <div className={styles.actions}>
          <label>Up axis<select value={upAxis} onChange={(event) => setUpAxis(event.target.value as 'z' | 'y')}><option value="z">Z</option><option value="y">Y</option></select></label>
          <Button type="button" variant="secondary" aria-pressed={wireframe} onClick={() => setWireframe((value) => !value)}><Box size={15} /> Wireframe</Button>
          <Button type="button" variant="secondary" aria-pressed={isolate} disabled={!selectedId} onClick={() => setIsolate((value) => !value)}><Focus size={15} /> Isolate</Button>
        </div>
      </div>
      <div ref={mount} className={styles.canvas} role="img" aria-label={`Interactive 3D view of ${data?.model.name ?? 'the selected model'}. Drag to orbit, scroll to zoom, tap an element to inspect it.`} />
      {loading && <p className={styles.overlay} role="status">Loading controlled model geometry…</p>}
      {error && <p className={styles.overlay} role="alert">{error}</p>}
      <p className={styles.hint}>Drag to orbit · scroll or pinch to zoom · tap an element to inspect</p>
    </div>
    <aside className={styles.inspector} aria-label="Model element inspector">
      <div className={styles.inspectorHead}><strong>Element inspector</strong><span>{data?.elements.length ?? 0} elements</span></div>
      {selected ? <dl className={styles.facts}>
        <div><dt>Name</dt><dd>{selected.name}</dd></div><div><dt>Element ID</dt><dd>{selected.id}</dd></div>
        <div><dt>Triangles</dt><dd>{selected.triangleCount.toLocaleString()}</dd></div>
        <div><dt>Minimum XYZ</dt><dd>{selected.min.map((n) => n.toFixed(3)).join(' · ')} m</dd></div>
        <div><dt>Maximum XYZ</dt><dd>{selected.max.map((n) => n.toFixed(3)).join(' · ')} m</dd></div>
      </dl> : <p className={styles.placeholder}>Select a model element to inspect its identity and exact triangle bounds.</p>}
      <label className={styles.search}><Search size={16} aria-hidden="true" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find element name or ID" aria-label="Search model elements" /></label>
      <div className={styles.elementList} role="region" aria-label="Model elements" tabIndex={0}>
        {listed.map((row) => <button type="button" key={row.id} aria-pressed={selectedId === row.id} onClick={() => focus(row.id)}>
          <span>{row.name}</span><small>{row.id}</small>
        </button>)}
        {data && listed.length === 0 && <p>No matching elements.</p>}
        {data && listed.length === 100 && <p>Showing the first 100 matches. Narrow the search to find a specific element.</p>}
      </div>
    </aside>
  </div>;
}
