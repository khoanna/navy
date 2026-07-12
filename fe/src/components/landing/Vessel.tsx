'use client';
import { forwardRef, useLayoutEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

const MODEL_URL = '/navy-opt.glb';

/** Loads the optimized voyage GLB and applies in-engine fixes (Path A):
 *  - retint the off-brand lime-green hull material to deep navy + aqua
 *  - give the sail a subtle aqua emissive so its glow holds at every angle.
 *  Exposes a group ref the canvas drives (position + rotation.y). */
export const Vessel = forwardRef<THREE.Group>(function Vessel(_props, ref) {
  const { scene } = useGLTF(MODEL_URL);

  const cloned = useMemo(() => scene.clone(true), [scene]);

  useLayoutEffect(() => {
    cloned.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const mat = obj.material as THREE.MeshStandardMaterial;
      if (!mat || !mat.color) return;
      const c = mat.color;
      // Green-dominant material = the off-brand under-hull -> deep navy.
      if (c.g > c.r * 1.25 && c.g > c.b * 1.1) {
        mat.color.set('#0B1B33');
        mat.emissive = new THREE.Color('#123a5f');
        mat.emissiveIntensity = 0.15;
      }
      // Large dark near-flat material = the sail -> subtle aqua emissive glow.
      const isDark = c.r < 0.15 && c.g < 0.2 && c.b < 0.4;
      if (isDark) {
        mat.emissive = new THREE.Color('#2FE0C2');
        mat.emissiveIntensity = 0.25;
      }
      mat.needsUpdate = true;
    });
  }, [cloned]);

  return (
    <group ref={ref} dispose={null}>
      {/* Scale up so the hero vessel reads large on screen (tunable). */}
      <primitive object={cloned} scale={1.7} />
    </group>
  );
});

useGLTF.preload(MODEL_URL);
