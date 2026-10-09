'use client';
// The living ecosystem behind the hero: the Genovus golden egg in 3D, lit by a light that sweeps across
// its shell, with carrier, agencies, agents and customers orbiting and light flowing between them.
// Reacts gently to the cursor, pauses when off screen, and renders one still frame under reduced motion.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const NODES = [
  { label: 'Carrier', angle: -Math.PI / 2 },
  { label: 'Agencies', angle: 0.1 },
  { label: 'Customers', angle: Math.PI / 2 + 0.15 },
  { label: 'Agents', angle: Math.PI - 0.1 },
];

export default function HeroScene({ onReady }: { onReady?: () => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const labels = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const host = wrap.current;
    if (!host) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const small = window.innerWidth < 760;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      return; // No WebGL: the static egg stays.
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 0, 11);

    // ---- the golden egg, turned on a lathe: narrower at the top, glossy orange, tipped like it was just laid ----
    const profile: THREE.Vector2[] = [];
    for (let i = 0; i <= 64; i++) {
      const y = -1 + (2 * i) / 64;
      const r = Math.sqrt(Math.max(0, 1 - y * y)) * (0.8 - 0.1 * y);
      profile.push(new THREE.Vector2(r, y));
    }
    const geo = new THREE.LatheGeometry(profile, 96);
    // Brand gradient as vertex colours: deep orange at the base to warm amber at the crown.
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c0 = new THREE.Color("#c42c0b"), c1 = new THREE.Color("#f6781c"), c2 = new THREE.Color("#ffb04a"), tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.clamp((pos.getY(i) + 1) / 2 + pos.getX(i) * -0.15, 0, 1);
      tmp.copy(t < 0.5 ? c0 : c1).lerp(t < 0.5 ? c1 : c2, t < 0.5 ? t * 2 : (t - 0.5) * 2);
      colors.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const markMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 0.15, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.3, sheenColor: new THREE.Color("#ffd38a"), emissive: new THREE.Color("#ff4a10"), emissiveIntensity: 0.08 });
    const mark = new THREE.Mesh(geo, markMat);
    mark.scale.setScalar(1.75);
    mark.rotation.z = -0.14; // tipped 8 degrees

    const world = new THREE.Group();
    world.add(mark);
    scene.add(world);

    // ---- light: a soft key, a rim, and a warm light that sweeps across the chambers ----
    scene.add(new THREE.AmbientLight('#ffffff', 0.25));
    const key = new THREE.DirectionalLight('#fff1e0', 1.6);
    key.position.set(-3, 4, 6);
    scene.add(key);
    const rim = new THREE.DirectionalLight('#6f8cff', 1.1);
    rim.position.set(4, -2, -5);
    scene.add(rim);
    const sweep = new THREE.PointLight('#ffc070', 18, 12, 1.6);
    scene.add(sweep);

    // ---- orbit: four nodes on a tilted ring, with light flowing into the G ----
    const ring = new THREE.Group();
    ring.rotation.x = -1.12;
    world.add(ring);
    const R = 3.55;
    const ringLine = new THREE.Mesh(new THREE.TorusGeometry(R, 0.006, 8, 220), new THREE.MeshBasicMaterial({ color: '#ff8a4c', transparent: true, opacity: 0.35 }));
    ring.add(ringLine);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(R * 1.32, 0.004, 8, 220), new THREE.MeshBasicMaterial({ color: '#8aa0ff', transparent: true, opacity: 0.16 }));
    ring.add(ring2);

    const nodeMeshes: THREE.Mesh[] = [];
    const nodeGeo = new THREE.SphereGeometry(0.11, 32, 32);
    NODES.forEach((n) => {
      const m = new THREE.Mesh(nodeGeo, new THREE.MeshBasicMaterial({ color: '#ffd29a' }));
      m.position.set(Math.cos(n.angle) * R, Math.sin(n.angle) * R, 0);
      ring.add(m);
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.26, 24, 24), new THREE.MeshBasicMaterial({ color: '#ff7a3a', transparent: true, opacity: 0.18 }));
      m.add(halo);
      nodeMeshes.push(m);
    });

    // Particles flowing along curves from each node into the centre (data and approvals moving).
    const PER = small ? 10 : 18;
    const flowGeo = new THREE.BufferGeometry();
    const flowPos = new Float32Array(NODES.length * PER * 3);
    flowGeo.setAttribute('position', new THREE.BufferAttribute(flowPos, 3));
    const flow = new THREE.Points(flowGeo, new THREE.PointsMaterial({ color: '#ffb36b', size: 0.06, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.add(flow);
    const curves = NODES.map((n) => {
      const a = new THREE.Vector3(Math.cos(n.angle) * R, Math.sin(n.angle) * R, 0);
      const mid = a.clone().multiplyScalar(0.45).add(new THREE.Vector3(0, 0, 1.2));
      return new THREE.QuadraticBezierCurve3(a, mid, new THREE.Vector3(0, 0, 0.2));
    });
    const offsets = Array.from({ length: NODES.length * PER }, () => Math.random());

    // A deep field of slow dust for depth.
    const DUST = small ? 260 : 620;
    const dustPos = new Float32Array(DUST * 3);
    for (let i = 0; i < DUST; i++) dustPos.set([(Math.random() - 0.5) * 22, (Math.random() - 0.5) * 14, -Math.random() * 14 - 1], i * 3);
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: '#c9b6a6', size: 0.025, transparent: true, opacity: 0.55, depthWrite: false }));
    scene.add(dust);

    // ---- post: a gentle bloom so the light reads as light ----
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), small ? 0.42 : 0.5, 0.55, 0.32);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      camera.aspect = w / h;
      // Keep the whole orbit in frame on narrow screens.
      camera.position.z = w / h < 0.9 ? 15 : 11.5;
      const wide = w / h > 1.25;
      world.position.x = wide ? 3.35 : 0;
      // Turn the G back toward the camera when it sits off to the side, so it never shows its edge.
      mark.rotation.y = wide ? -0.28 : 0;
      world.position.y = wide ? 0 : 2.7;
      world.scale.setScalar(wide ? 0.7 : 0.66);
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    // ---- motion ----
    const target = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
    const onPointer = (e: PointerEvent) => {
      target.y = (e.clientX / window.innerWidth - 0.5) * 0.5;
      target.x = (e.clientY / window.innerHeight - 0.5) * 0.3;
    };
    window.addEventListener('pointermove', onPointer, { passive: true });

    const v = new THREE.Vector3();
    const placeLabels = () => {
      const w = host.clientWidth, h = host.clientHeight;
      nodeMeshes.forEach((m, i) => {
        const el = labels.current[i];
        if (!el) return;
        m.getWorldPosition(v).project(camera);
        el.style.transform = `translate(-50%, -160%) translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px)`;
        el.style.opacity = v.z < 1 ? '1' : '0';
      });
    };

    let raf = 0, visible = true, t0 = performance.now(), first = true;
    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      cur.x += (target.x - cur.x) * 0.05;
      cur.y += (target.y - cur.y) * 0.05;
      world.rotation.y = cur.y * 0.6 + Math.sin(t * 0.35) * 0.08;
      world.rotation.x = cur.x + Math.sin(t * 0.27) * 0.05;
      mark.position.y = Math.sin(t * 0.8) * 0.06;
      ring.rotation.z = t * 0.08;
      sweep.position.set(Math.cos(t * 0.6) * 3, Math.sin(t * 0.9) * 1.6, 2.6);
      markMat.emissiveIntensity = 0.09 + Math.sin(t * 1.3) * 0.03;
      curves.forEach((c, n) => {
        for (let k = 0; k < PER; k++) {
          const idx = n * PER + k;
          c.getPoint((offsets[idx] + t * 0.18) % 1, v);
          flowPos.set([v.x, v.y, v.z], idx * 3);
        }
      });
      flowGeo.attributes.position.needsUpdate = true;
      dust.rotation.y = t * 0.01;
      composer.render();
      placeLabels();
      if (first) {
        first = false;
        onReady?.();
      }
      if (!reduce && visible) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const io = new IntersectionObserver(([e]) => {
      const was = visible;
      visible = e.isIntersecting && !document.hidden;
      if (visible && !was && !reduce) raf = requestAnimationFrame(frame);
    });
    io.observe(host);
    const onVis = () => {
      const was = visible;
      visible = !document.hidden;
      if (visible && !was && !reduce) raf = requestAnimationFrame(frame);
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener('pointermove', onPointer);
      document.removeEventListener('visibilitychange', onVis);
      composer.dispose();
      renderer.dispose();
      geo.dispose();
      renderer.domElement.remove();
    };
  }, [onReady]);

  return (
    <div ref={wrap} className="hero-canvas" aria-hidden="true">
      {NODES.map((n, i) => (
        <span key={n.label} ref={(el) => { labels.current[i] = el; }} className="orbit-label">{n.label}</span>
      ))}
    </div>
  );
}
