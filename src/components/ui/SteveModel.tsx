"use client";

import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
// The Steve model is INLINED at build time as a self-contained string (the
// geometry buffer + texture are base64 data URIs inside the glTF). This means
// GLTFLoader.parse() needs NO network fetch at all — which sidesteps Tauri's
// `asset://` protocol entirely (it blocks the separate .bin/.png sub-resource
// fetches that a normal multi-file .gltf would make, causing a black screen).
import STEVE_MODEL from "../../assets/SteveEmbedded.gltf?raw";

interface SteveModelProps {
  /** Model URL, relative to the app root (public/models/...). */
  src?: string;
  className?: string;
  /** Camera distance multiplier — bigger = smaller Steve. */
  zoom?: number;
  /** Initial yaw in radians (rotate the model to face the camera). */
  yaw?: number;
  /** Idle spin speed in radians per second. */
  spin?: number;
  /** Bob (breathing) amplitude in world units. */
  bob?: number;
}

/**
 * SteveModel — raw three.js GLTF renderer for the Home hero background.
 *
 * Deliberately NOT @react-three/fiber: this is a single static mesh with an
 * idle animation, so we keep the dependency surface tiny. The canvas is
 * alpha-transparent and `pointer-events: none`, so it purely decorates the
 * hero card behind the launch UI.
 *
 * Failure policy: if WebGL is unavailable or the GLTF fails to load, this
 * component renders nothing at all — the hero keeps its gradient background.
 */
export function SteveModel({
  src = "models/steve/SteveEmbedded.gltf",
  className = "",
  zoom = 1,
  yaw = 0,
  spin = 0.16,
  bob = 0.035,
}: SteveModelProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let raf = 0;

    /* ------------------------------------------------------------ renderer */
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "low-power",
      });
    } catch {
      return; // no WebGL — silently keep the CSS background only
    }
    if (disposed) return;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const canvas = renderer.domElement;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    host.appendChild(canvas);

    /* --------------------------------------------------------------- scene */
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    const CAM_Z = 4.6 * zoom;
    camera.position.set(0, 0.18, CAM_Z);
    camera.lookAt(0, 0.05, 0);

    // Soft ambient base + warm key + amber rim (matches the #e06b22 accent).
    scene.add(new THREE.AmbientLight(0x9fb4d8, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(2.2, 3.4, 4.0);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xe06b22, 2.4);
    rim.position.set(-2.6, 1.2, -2.2);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0x6d8dff, 0.5);
    fill.position.set(-2.0, -1.0, 3.0);
    scene.add(fill);

    const root = new THREE.Group();
    scene.add(root);

    /* --------------------------------------------------------------- model */
    const loader = new GLTFLoader();
    let model: THREE.Object3D | null = null;

    const onLoaded = (gltf: any) => {
        if (disposed) return;
        const obj = gltf.scene;

        // Normalize: center on origin, then scale so Steve is ~2.5 units tall.
        const box = new THREE.Box3().setFromObject(obj);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        const tallest = Math.max(size.y, 0.0001);
        const scale = 2.5 / tallest;
        obj.scale.setScalar(scale);
        obj.position.set(
          -center.x * scale,
          -center.y * scale + 0.05,
          -center.z * scale
        );
        obj.rotation.y = yaw;

        obj.traverse((child: THREE.Object3D) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mat = mesh.material as THREE.MeshStandardMaterial;
          if (mat && mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
        });

        root.add(obj);
        obj.userData.baseY = obj.position.y;
        model = obj;
    };

    const onFailed = () => {
      /* silent failure — hero keeps its gradient background */
    };

    // Parse the inlined, self-contained glTF string — no fetch, no sub-resources.
    try {
      loader.parse(STEVE_MODEL, "", onLoaded, onFailed);
    } catch {
      /* silent failure */
    }

    /* -------------------------------------------------------------- resize */
    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    /* ------------------------------------------------------------ animate */
    const clock = new THREE.Clock();
    // The showcase spin/bob is slow motion — 30fps is visually identical to
    // 60fps but halves the WebGL work per second. Frames are also skipped
    // entirely while the window is hidden so we burn zero GPU when minimized.
    const MIN_FRAME_MS = 1000 / 30;
    let lastFrame = -Infinity;
    const tick = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      if (now - lastFrame < MIN_FRAME_MS) return;
      lastFrame = now;
      const t = clock.getElapsedTime();
      if (model) {
        // Slow showcase spin + gentle breathing bob.
        const baseY = (model.userData.baseY as number) ?? model.position.y;
        model.rotation.y = yaw + t * spin;
        model.position.y = baseY + Math.sin(t * 1.1) * bob;
      }
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    /* ------------------------------------------------------------- dispose */
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      root.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          const mats = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
          mats.forEach((m: any) => {
            if (m?.map) m.map.dispose();
            m?.dispose?.();
          });
        }
      });
      renderer.dispose();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, zoom]);

  return (
    <div
      ref={hostRef}
      className={`pointer-events-none select-none ${className}`}
      aria-hidden="true"
    />
  );
}

export default SteveModel;
