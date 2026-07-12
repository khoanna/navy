'use client';
import { MeshReflectorMaterial, Sparkles } from '@react-three/drei';

/**
 * The sea the vessel sits on: a large reflective water plane (mirrors the hull +
 * sky glow) plus a haze of drifting sea-mist Sparkles. Kept intentionally dark
 * and calm so it reads premium, not gamey. Sits under the vessel at the waterline
 * (tune `y` on the group if the hull floats above/below it).
 */
export function Ocean() {
  return (
    <group position={[0, -0.55, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[60, 60]} />
        <MeshReflectorMaterial
          resolution={512}
          mixBlur={1}
          mixStrength={3}
          blur={[400, 100]}
          mirror={0.55}
          color="#06121f"
          metalness={0.7}
          roughness={0.85}
          depthScale={1.1}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.2}
        />
      </mesh>
      {/* Sea-mist / spray drifting just above the surface. */}
      <Sparkles count={70} scale={[26, 3, 26]} position={[0, 0.6, 0]} size={2.2} speed={0.25} opacity={0.5} color="#8fe8ff" />
    </group>
  );
}
