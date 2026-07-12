'use client';
import { Suspense, useRef } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import * as THREE from 'three';
import { Vessel } from './Vessel';
import { Ocean } from './Ocean';
import { interpolateScene } from '@/lib/landing/scenes';

gsap.registerPlugin(ScrollTrigger, useGSAP);

/** Drives the camera + vessel from a shared scroll-progress ref each frame. */
function Rig({ progress }: { progress: React.RefObject<number> }) {
  const vessel = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const target = useRef(new THREE.Vector3());

  useFrame(() => {
    const f = interpolateScene(progress.current);
    // Idle bob layered on the scene position.
    const bob = Math.sin(performance.now() / 900) * 0.04;
    camera.position.set(f.camPos[0], f.camPos[1], f.camPos[2]);
    target.current.set(f.camTarget[0], f.camTarget[1], f.camTarget[2]);
    camera.lookAt(target.current);
    if (vessel.current) {
      vessel.current.position.set(f.vesselPos[0], f.vesselPos[1] + bob, f.vesselPos[2]);
      vessel.current.rotation.y = f.vesselRotY;
    }
  });

  return (
    <>
      {/* Atmospheric depth — objects fade into the deep-navy horizon. */}
      <fog attach="fog" args={['#050a14', 9, 26]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 6, 4]} intensity={1.4} color="#dff0ff" />
      <directionalLight position={[-4, 2, -3]} intensity={0.6} color="#2FE0C2" />
      <Suspense fallback={null}>
        <Vessel ref={vessel} />
        <Ocean />
        <Environment preset="night" />
      </Suspense>
    </>
  );
}

/** Pins section 1–4 wrapper (#voyage-pin, height = 400vh) and maps scroll to a
 *  0..1 progress ref that the Rig reads. One canvas for all four beats. */
export function VoyageCanvas() {
  const progress = useRef(0);
  const container = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const st = ScrollTrigger.create({
        trigger: '#voyage-pin',
        start: 'top top',
        end: 'bottom bottom',
        scrub: 1,
        onUpdate: (self) => {
          progress.current = self.progress;
        },
      });
      const id = window.setTimeout(() => ScrollTrigger.refresh(), 300);
      return () => {
        st.kill();
        window.clearTimeout(id);
      };
    },
    { scope: container },
  );

  return (
    <div ref={container} style={{ position: 'fixed', inset: 0, zIndex: 0 }}>
      <Canvas dpr={[1, 1.5]} camera={{ fov: 42, position: [0, 1.2, 6.5] }} gl={{ antialias: true, alpha: true }}>
        <Suspense fallback={null}>
          <Rig progress={progress} />
        </Suspense>
      </Canvas>
    </div>
  );
}
