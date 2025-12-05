import React, { useRef, useMemo, useState, useEffect, useLayoutEffect, Suspense, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { Canvas, useFrame, useThree, extend, useLoader } from "@react-three/fiber";
import {
  OrbitControls,
  Float,
  Environment,
  shaderMaterial,
  Stars,
  Center,
  Image as DreiImage,
  useTexture,
  PerspectiveCamera
} from "@react-three/drei";
import { EffectComposer, Bloom, ToneMapping } from "@react-three/postprocessing";
import * as THREE from "three";
// @ts-ignore
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

// --- Constants & Configuration ---
const CONFIG = {
  particleCount: 28000, 
  ornamentCount: 1000, 
  colors: {
    emerald: "#004d25", 
    deepEmerald: "#001a0d",
    gold: "#FFD700",
    champagne: "#F7E7CE",
    roseGold: "#E0BFB8",
    galaxy: "#020205",
    redVelvet: "#E62020", // Bright Festive Red
    lighterRed: "#FF4D4D",
    silver: "#C0C0C0",
    warmLight: "#ffedd5",
    redFill: "#450a0a",
    saturatedGreen: "#008f39",
    saturatedGold: "#ffbf00"
  },
  dimensions: {
    height: 9,
    radius: 3.5
  }
};

// Use reliable placeholder images to prevent loading errors
const DEFAULT_IMAGES = [
  "https://picsum.photos/seed/christmas1/400/500",
  "https://picsum.photos/seed/christmas2/400/500",
  "https://picsum.photos/seed/christmas3/400/500",
  "https://picsum.photos/seed/christmas4/400/500",
  "https://picsum.photos/seed/christmas5/400/500",
  "https://picsum.photos/seed/christmas6/400/500",
  "https://picsum.photos/seed/christmas7/400/500",
  "https://picsum.photos/seed/christmas8/400/500"
];

// --- Custom Shaders ---
const LuxuryFoliageMaterial = shaderMaterial(
  {
    uTime: 0,
    uColor: new THREE.Color(CONFIG.colors.emerald),
    uColor2: new THREE.Color(CONFIG.colors.gold), 
    uMouse: new THREE.Vector3(999, 999, 999),
    uProgress: 0,
    uPixelRatio: 1
  },
  `
    uniform float uTime;
    uniform float uProgress;
    uniform vec3 uMouse;
    uniform float uPixelRatio;
    
    attribute vec3 aChaosPos;
    attribute vec3 aTargetPos;
    attribute float aSize;
    attribute float aRandom;
    
    varying float vDistToMouse;
    varying float vRandom;

    void main() {
      vRandom = aRandom;
      vec3 finalPos = mix(aChaosPos, aTargetPos, uProgress);
      
      // Jitter/Breathing Animation
      float breath = sin(uTime * 1.5 + finalPos.y * 0.5 + aRandom * 10.0);
      finalPos += normalize(finalPos) * breath * 0.03 * uProgress;

      float dist = distance(finalPos, uMouse);
      vDistToMouse = dist;

      float interactionRadius = 3.5;
      if (dist < interactionRadius) {
        vec3 dir = normalize(finalPos - uMouse);
        float force = (interactionRadius - dist) / interactionRadius;
        // Add curl noise-like movement
        float noise = sin(finalPos.x * 20.0 + uTime * 5.0);
        vec3 offset = dir * force * 2.5 + vec3(0, noise * 0.2, 0);
        finalPos += offset;
      }

      vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
      gl_PointSize = (aSize * uPixelRatio * 40.0) * (1.0 / -mvPosition.z);
      
      // Hover enlargement
      if (dist < 2.0) {
         gl_PointSize *= (1.5 + sin(uTime * 15.0) * 0.5);
      }

      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  `
    uniform vec3 uColor;
    uniform vec3 uColor2; // Gold Rim
    uniform float uTime;
    
    varying float vDistToMouse;
    varying float vRandom;

    void main() {
      // Circle shape
      float r = distance(gl_PointCoord, vec2(0.5));
      if (r > 0.5) discard;
      
      // Rim Glow Logic
      // Center is dark/emerald, Edge is Gold/Warm White
      float rim = smoothstep(0.35, 0.5, r); 
      
      vec3 baseColor = uColor;
      
      // Add subtle random variation to base color
      baseColor += vec3(vRandom * 0.1);

      // Mix Emerald center with Gold Rim
      vec3 finalColor = mix(baseColor, uColor2, rim * 0.8);
      
      // Mouse Interaction Glow
      if (vDistToMouse < 3.5) {
        float mixVal = 1.0 - smoothstep(0.0, 3.5, vDistToMouse);
        finalColor = mix(finalColor, uColor2, mixVal);
      }

      // High Frequency Twinkle
      float sparkle = sin(uTime * 8.0 + vRandom * 100.0) * 0.5 + 0.5;
      finalColor += vec3(sparkle * 0.15); // Add brightness

      // Alpha fade for soft edges
      float alpha = 1.0 - smoothstep(0.45, 0.5, r);

      gl_FragColor = vec4(finalColor, alpha);
    }
  `
);

extend({ LuxuryFoliageMaterial });

// --- Error Boundary ---
class ErrorBoundary extends React.Component<{children: React.ReactNode, fallback?: React.ReactNode}, {hasError: boolean}> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true };
  }
  componentDidCatch(error: any, errorInfo: any) {
    console.warn("Resource failed to load:", error);
  }
  render() {
    if (this.state.hasError) return this.props.fallback || null;
    return this.props.children;
  }
}

// --- Helper Functions ---
const generateTreeData = (count: number) => {
  const chaosPositions = new Float32Array(count * 3);
  const targetPositions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const randoms = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // Chaos: Galaxy Sphere distribution
    const r = 18 * Math.cbrt(Math.random());
    const theta = Math.random() * 2 * Math.PI;
    const phi = Math.acos(2 * Math.random() - 1);
    const chaos = new THREE.Vector3(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.sin(phi) * Math.sin(theta),
      r * Math.cos(phi)
    );
    chaosPositions.set([chaos.x, chaos.y, chaos.z], i * 3);

    // Target: Dense Cone Tree
    const y = (Math.random() - 0.5) * CONFIG.dimensions.height; 
    const normalizedY = 1 - (y + CONFIG.dimensions.height/2) / CONFIG.dimensions.height;
    // slightly curved cone profile
    const radiusAtY = CONFIG.dimensions.radius * Math.pow(normalizedY, 0.85);
    
    // Volume distribution inside the cone
    const spiralAngle = y * 8.0 + Math.random() * Math.PI * 2; 
    const volumeR = radiusAtY * Math.sqrt(Math.random()); // Even disk distribution
    
    const tx = Math.cos(spiralAngle) * volumeR;
    const tz = Math.sin(spiralAngle) * volumeR;
    targetPositions.set([tx, y, tz], i * 3);

    // Random attributes
    sizes[i] = Math.random() * 0.8 + 0.2; // Min size ensures visibility
    randoms[i] = Math.random();
  }

  return { chaosPositions, targetPositions, sizes, randoms };
};

// --- Components ---

const Foliage = ({ mode }: { mode: 'chaos' | 'formed' }) => {
  const meshRef = useRef<THREE.Points>(null);
  const materialRef = useRef<any>(null);
  const { chaosPositions, targetPositions, sizes, randoms } = useMemo(() => generateTreeData(CONFIG.particleCount), []);
  
  const { viewport } = useThree();
  const mouseVec = useRef(new THREE.Vector3(0, 0, 0));

  useFrame((state, delta) => {
    if (!materialRef.current) return;
    materialRef.current.uTime = state.clock.elapsedTime;
    
    const targetProgress = mode === 'formed' ? 1.0 : 0.0;
    materialRef.current.uProgress = THREE.MathUtils.lerp(
      materialRef.current.uProgress,
      targetProgress,
      delta * 0.8 
    );

    const x = (state.pointer.x * viewport.width) / 2;
    const y = (state.pointer.y * viewport.height) / 2;
    mouseVec.current.set(x, y, 2.0); 
    materialRef.current.uMouse.lerp(mouseVec.current, 0.15);
  });

  return (
    <points ref={meshRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={chaosPositions.length / 3} array={chaosPositions} itemSize={3} />
        <bufferAttribute attach="attributes-aChaosPos" count={chaosPositions.length / 3} array={chaosPositions} itemSize={3} />
        <bufferAttribute attach="attributes-aTargetPos" count={targetPositions.length / 3} array={targetPositions} itemSize={3} />
        <bufferAttribute attach="attributes-aSize" count={sizes.length} array={sizes} itemSize={1} />
        <bufferAttribute attach="attributes-aRandom" count={randoms.length} array={randoms} itemSize={1} />
      </bufferGeometry>
      {/* @ts-ignore */}
      <luxuryFoliageMaterial
        ref={materialRef}
        transparent
        depthWrite={false}
        blending={THREE.NormalBlending}
      />
    </points>
  );
};

// Ornament Data Interface
interface OrnamentData {
  chaos: THREE.Vector3;
  target: THREE.Vector3;
  current: THREE.Vector3;
  velocity: THREE.Vector3;
  scale: number;
  color: THREE.Color;
  phase?: number;
}

const Ornaments = ({ mode }: { mode: 'chaos' | 'formed' }) => {
  const baubleRef = useRef<THREE.InstancedMesh>(null);
  const boxRef = useRef<THREE.InstancedMesh>(null);
  const lightRef = useRef<THREE.InstancedMesh>(null);
  const starRef = useRef<THREE.InstancedMesh>(null);
  const bellRef = useRef<THREE.InstancedMesh>(null);
  const caneRef = useRef<THREE.InstancedMesh>(null);
  
  const { baubles, boxes, lights, stars, bells, canes } = useMemo(() => {
    const _baubles: OrnamentData[] = [];
    const _boxes: OrnamentData[] = [];
    const _lights: OrnamentData[] = [];
    const _stars: OrnamentData[] = [];
    const _bells: OrnamentData[] = [];
    const _canes: OrnamentData[] = [];
    
    // Palettes
    const metalPalette = [new THREE.Color(CONFIG.colors.champagne), new THREE.Color(CONFIG.colors.gold)];
    const boxPalette = [new THREE.Color(CONFIG.colors.champagne), new THREE.Color(CONFIG.colors.gold), new THREE.Color(CONFIG.colors.silver), new THREE.Color(CONFIG.colors.redVelvet)];

    for (let i = 0; i < CONFIG.ornamentCount; i++) {
      // Chaos Position
      const r = 14 * Math.cbrt(Math.random());
      const theta = Math.random() * 2 * Math.PI;
      const phi = Math.acos(2 * Math.random() - 1);
      const chaos = new THREE.Vector3(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi)
      );

      // Target Position
      const y = (Math.random() - 0.5) * (CONFIG.dimensions.height - 1.5);
      const normalizedY = 1 - (y + CONFIG.dimensions.height/2) / CONFIG.dimensions.height;
      const radiusAtY = (CONFIG.dimensions.radius - 0.4) * normalizedY; 
      const angle = Math.random() * Math.PI * 2;
      
      const target = new THREE.Vector3(
        Math.cos(angle) * radiusAtY,
        y,
        Math.sin(angle) * radiusAtY
      );

      // Type Determination
      const rand = Math.random();
      let type = 'bauble';
      
      if (rand > 0.30) type = 'box';  
      if (rand > 0.50) type = 'star';
      if (rand > 0.55) type = 'bell';
      if (rand > 0.60) type = 'cane';
      if (rand > 0.70) type = 'light';

      const data: OrnamentData = {
        chaos,
        target,
        current: chaos.clone(),
        velocity: new THREE.Vector3(),
        scale: 0.15 + Math.random() * 0.15,
        color: metalPalette[Math.floor(Math.random() * metalPalette.length)],
        phase: Math.random() * Math.PI * 2
      };
      
      // Customize based on type
      if (type === 'bauble') {
          data.scale *= 1.95; // Increased scale
          _baubles.push(data);
      } else if (type === 'box') {
         data.scale *= 1.6; // Heavy/Large
         data.color = boxPalette[Math.floor(Math.random() * boxPalette.length)];
         _boxes.push(data);
      } else if (type === 'star') {
         data.scale *= 1.2;
         data.color = new THREE.Color(CONFIG.colors.gold);
         _stars.push(data);
      } else if (type === 'bell') {
         data.scale *= 1.3;
         data.color = new THREE.Color(CONFIG.colors.gold);
         _bells.push(data);
      } else if (type === 'cane') {
         data.scale *= 1.4;
         data.color = Math.random() > 0.5 ? new THREE.Color(CONFIG.colors.lighterRed) : new THREE.Color(CONFIG.colors.roseGold);
         _canes.push(data);
      } else {
         data.scale *= 0.4;
         data.color = new THREE.Color("#fff7e6");
         _lights.push(data);
      }
    }
    return { baubles: _baubles, boxes: _boxes, lights: _lights, stars: _stars, bells: _bells, canes: _canes };
  }, []);

  // Update Instance Colors on Mount
  useLayoutEffect(() => {
     [baubleRef, boxRef, lightRef, starRef, bellRef, caneRef].forEach((ref, idx) => {
        let list: OrnamentData[] = [];
        if (idx === 0) list = baubles;
        if (idx === 1) list = boxes;
        if (idx === 2) list = lights;
        if (idx === 3) list = stars;
        if (idx === 4) list = bells;
        if (idx === 5) list = canes;

        if (ref.current) {
            list.forEach((item, i) => {
                ref.current!.setColorAt(i, item.color);
            });
            if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
        }
     });
  }, [baubles, boxes, lights, stars, bells, canes]);

  const dummy = new THREE.Object3D();
  const mouseVec = new THREE.Vector3();
  const tempColor = new THREE.Color();

  useFrame((state, delta) => {
    const isFormed = mode === 'formed';
    const time = state.clock.elapsedTime;
    
    mouseVec.set(
      (state.pointer.x * state.viewport.width) / 2,
      (state.pointer.y * state.viewport.height) / 2,
      2
    );

    const updateList = (list: OrnamentData[], ref: React.RefObject<THREE.InstancedMesh>, type: string) => {
        if (!ref.current) return;
        
        list.forEach((item, i) => {
            const dest = isFormed ? item.target : item.chaos;

            // --- Physics & Force Weights ---
            let speed = 3.0;
            let damping = 0.9;
            let repulsionWeight = 1.0;

            if (type === 'box') {
                // Heavy, sluggish
                speed = 1.2; 
                damping = 0.82; 
                repulsionWeight = 0.2; 
            } else if (type === 'star') {
                // Volatile
                speed = 4.0; 
                damping = 0.92; 
                repulsionWeight = 1.2;
            } else if (type === 'bell') {
                speed = 2.0; 
                damping = 0.88; 
                repulsionWeight = 0.5;
            } else if (type === 'cane') {
                speed = 4.0; 
                damping = 0.94; 
                repulsionWeight = 1.5;
            } else if (type === 'light') {
                // Very Light, Snappy
                speed = 6.0; 
                damping = 0.95; 
                repulsionWeight = 2.5;
                
                // Twinkle Logic
                if (isFormed) {
                    const brightness = 0.5 + 0.5 * Math.sin(time * 5 + item.phase!);
                    tempColor.set(item.color).multiplyScalar(brightness);
                    ref.current!.setColorAt(i, tempColor);
                }
            } else if (type === 'bauble') {
                // Standard weight
                speed = 2.8;
                damping = 0.9;
                repulsionWeight = 0.8;
            }

            // Force Calculation
            const force = dest.clone().sub(item.current).multiplyScalar(speed * delta);
            item.velocity.add(force);

            // Mouse Interaction (Star River Scatter)
            const dist = item.current.distanceTo(mouseVec);
            if (dist < 3.5) {
                const dir = item.current.clone().sub(mouseVec).normalize();
                const str = (3.5 - dist) * 15.0 * delta * repulsionWeight;
                item.velocity.add(dir.multiplyScalar(str));
            }

            // Apply Velocity
            item.velocity.multiplyScalar(damping);
            item.current.add(item.velocity);

            // Update Matrix
            dummy.position.copy(item.current);
            dummy.scale.setScalar(item.scale);
            
            // Rotation Logic
            if (type === 'bell') {
               dummy.rotation.x = Math.sin(time * 3 + item.current.x) * 0.3;
               dummy.rotation.z = Math.cos(time * 2 + item.current.z) * 0.3;
            } else if (type === 'cane') {
               dummy.rotation.x = 0.2; 
               dummy.rotation.y += delta * 0.5;
               dummy.rotation.z = 0.2;
            } else {
               dummy.rotation.x += delta * (type === 'box' ? 0.2 : 0.5);
               dummy.rotation.y += delta;
            }
            
            if (type === 'star') {
               dummy.rotation.z += delta * 0.8;
            }
            
            dummy.updateMatrix();
            ref.current!.setMatrixAt(i, dummy.matrix);
        });
        ref.current.instanceMatrix.needsUpdate = true;
        if (type === 'light') ref.current.instanceColor!.needsUpdate = true;
    };

    updateList(baubles, baubleRef, 'bauble');
    updateList(boxes, boxRef, 'box');
    updateList(lights, lightRef, 'light');
    updateList(stars, starRef, 'star');
    updateList(bells, bellRef, 'bell');
    updateList(canes, caneRef, 'cane');
  });

  return (
    <group>
      <instancedMesh ref={baubleRef} args={[undefined, undefined, baubles.length]} castShadow receiveShadow>
        <sphereGeometry args={[1, 32, 32]} />
        <meshStandardMaterial roughness={0.15} metalness={1.0} envMapIntensity={1.5} color={CONFIG.colors.champagne} />
      </instancedMesh>
      
      <instancedMesh ref={boxRef} args={[undefined, undefined, boxes.length]} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.2} metalness={0.6} envMapIntensity={1.2} />
      </instancedMesh>

      <instancedMesh ref={starRef} args={[undefined, undefined, stars.length]}>
        <octahedronGeometry args={[0.8, 0]} />
        <meshStandardMaterial emissive={CONFIG.colors.gold} emissiveIntensity={3} toneMapped={false} color={CONFIG.colors.gold} />
      </instancedMesh>

      <instancedMesh ref={bellRef} args={[undefined, undefined, bells.length]}>
        <cylinderGeometry args={[0.15, 0.5, 0.6, 16]} />
        <meshStandardMaterial roughness={0.2} metalness={0.9} envMapIntensity={1.2} />
      </instancedMesh>

      <instancedMesh ref={caneRef} args={[undefined, undefined, canes.length]}>
        <cylinderGeometry args={[0.08, 0.08, 1.2, 8]} />
        <meshStandardMaterial roughness={0.4} metalness={0.3} />
      </instancedMesh>

      <instancedMesh ref={lightRef} args={[undefined, undefined, lights.length]}>
        <sphereGeometry args={[0.25, 8, 8]} />
        <meshStandardMaterial emissive="white" emissiveIntensity={1.5} toneMapped={false} color="white" />
      </instancedMesh>
    </group>
  );
};

/**
 * Top Star: 5-Pointed Extruded Star
 */
const TopStar = ({ mode }: { mode: 'chaos' | 'formed' }) => {
  const ref = useRef<THREE.Group>(null);
  
  const starShape = useMemo(() => {
    const shape = new THREE.Shape();
    const points = 5;
    const outerRadius = 0.8;
    const innerRadius = 0.35;
    
    for (let i = 0; i < points * 2; i++) {
      const angle = (i * Math.PI) / points;
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const x = Math.sin(angle) * radius;
      const y = Math.cos(angle) * radius;
      
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    return shape;
  }, []);

  const extrudeSettings = useMemo(() => ({
    depth: 0.2, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 3
  }), []);

  useFrame((state) => {
    if (ref.current) {
       ref.current.rotation.y = state.clock.elapsedTime * 0.5;
       const targetScale = mode === 'formed' ? 0.85 : 0.01;
       ref.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.05);
    }
  });

  return (
    <group ref={ref} position={[0, CONFIG.dimensions.height / 2 + 0.3, 0]}>
      <Center>
         <mesh>
            <extrudeGeometry args={[starShape, extrudeSettings]} />
            <meshStandardMaterial color={CONFIG.colors.gold} emissive={CONFIG.colors.gold} emissiveIntensity={4} toneMapped={false} roughness={0.1} metalness={1} />
         </mesh>
      </Center>
      <pointLight intensity={15} color="#ffaa00" distance={8} />
    </group>
  );
};

// --- Polaroid Decorations ---

const PolaroidImage = ({ url, scale }: { url: string, scale: number }) => {
  return (
    <DreiImage 
      url={url} 
      position={[0, 0.15 * scale, 0.01]} 
      scale={[0.9 * scale, 0.9 * scale]} 
      transparent
      opacity={1}
      side={THREE.DoubleSide}
    />
  );
};

const Polaroids = ({ mode, customImages, handPosition, isPinching }: { mode: 'chaos' | 'formed', customImages: string[], handPosition: {x: number, y: number} | null, isPinching: boolean }) => {
  const groupRef = useRef<THREE.Group>(null);
  const { camera, size } = useThree();
  const focusedIdRef = useRef<number | null>(null);
  
  // Use custom images if available, otherwise default
  const activeImages = customImages.length > 0 ? customImages : DEFAULT_IMAGES;

  const photos = useMemo(() => {
    return new Array(30).fill(0).map((_, i) => {
      const y = (Math.random() - 0.5) * (CONFIG.dimensions.height - 2.5);
      const normalizedY = 1 - (y + CONFIG.dimensions.height/2) / CONFIG.dimensions.height;
      // Normal formed position radius
      const radius = (CONFIG.dimensions.radius - 0.2) * normalizedY + 0.5; 
      const angle = Math.random() * Math.PI * 2;
      
      return {
        id: i,
        // Store base tree coordinates
        treeY: y,
        treeAngle: angle,
        
        chaosPos: new THREE.Vector3((Math.random()-0.5)*20, (Math.random()-0.5)*20, (Math.random()-0.5)*20),
        rotation: [0, -angle + Math.PI / 2, (Math.random() - 0.5) * 0.2] as [number, number, number],
        url: activeImages[i % activeImages.length],
        scale: 0.9 + Math.random() * 0.4,
        phase: Math.random() * 10
      };
    });
  }, [activeImages]);

  useFrame((state, delta) => {
     if(!groupRef.current) return;
     const isFormed = mode === 'formed';
     const time = state.clock.elapsedTime;
     
     // 1. DETERMINE FOCUSED PHOTO (Closest to hand)
     let closestDist = 999;
     let nextFocusedId: number | null = null;
     
     // Only calculate focus if we have a hand position
     if (handPosition && groupRef.current.children.length > 0) {
        groupRef.current.children.forEach((child, i) => {
           // Project 3D position to 2D NDC
           const tempV = child.position.clone();
           tempV.project(camera); 
           // NDC is x[-1,1], y[-1,1]
           
           // Convert HandPosition (0..1) to NDC
           // MediaPipe Y is top-left 0, bottom-right 1. ThreeJS NDC Y is bottom -1, top 1.
           const handNDC_X = (handPosition.x - 0.5) * 2; // 0..1 -> -0.5..0.5 -> -1..1
           const handNDC_Y = -(handPosition.y - 0.5) * 2; // 0..1 -> -0.5..0.5 -> -1..1 (inverted)

           const dist = Math.sqrt(Math.pow(tempV.x - handNDC_X, 2) + Math.pow(tempV.y - handNDC_Y, 2));
           
           if (dist < closestDist) {
              closestDist = dist;
              nextFocusedId = photos[i].id;
           }
        });
     }

     // Lock focus if pinching, otherwise update
     if (!isPinching) {
        focusedIdRef.current = nextFocusedId;
     }
     
     const activeId = focusedIdRef.current;

     groupRef.current.children.forEach((child, i) => {
        const photo = photos[i];
        const isFocused = photo.id === activeId && handPosition !== null;
        const isZoomed = isFocused && isPinching;
        
        // Target calculation
        let targetPos = new THREE.Vector3();
        let targetRot = new THREE.Quaternion();
        let targetScaleScalar = photo.scale;

        if (isFormed && !isZoomed) {
          // FORMED: Tuck them in
          const normalizedY = 1 - (photo.treeY + CONFIG.dimensions.height/2) / CONFIG.dimensions.height;
          const r = (CONFIG.dimensions.radius - 0.5) * normalizedY + 0.1; 
          
          targetPos.set(
            Math.cos(photo.treeAngle) * r, 
            photo.treeY, 
            Math.sin(photo.treeAngle) * r
          );
          
          // Look outward
          const lookAtPos = new THREE.Vector3(0, targetPos.y, 0);
          const dummy = new THREE.Object3D();
          dummy.position.copy(targetPos);
          dummy.lookAt(lookAtPos);
          dummy.rotateY(Math.PI);
          targetRot.copy(dummy.quaternion);

          // Gentle Sway
          const sway = Math.sin(time * 1.5 + photo.phase) * 0.1;
          const euler = new THREE.Euler().setFromQuaternion(targetRot);
          euler.z += photo.rotation[2] + sway;
          targetRot.setFromEuler(euler);
          
        } else {
          // CHAOS
          targetPos.copy(photo.chaosPos);
          
          // Hand Influence on Cloud
          if (handPosition && !isZoomed) {
             const rotationAngle = (handPosition.x - 0.5) * Math.PI * 4; 
             targetPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationAngle);
          }
          
          // Billboard facing
          targetRot.copy(camera.quaternion);
        }

        // --- OVERRIDE FOR ZOOM/FOCUS ---
        if (isZoomed) {
            // Bring closer to camera
            const direction = camera.position.clone().sub(new THREE.Vector3(0,0,0)).normalize();
            const viewPos = camera.position.clone().sub(direction.multiplyScalar(5)); // 5 units in front of camera
            targetPos.copy(viewPos);
            targetRot.copy(camera.quaternion); // Face camera perfectly
            targetScaleScalar = 2.0; // Reduced to 2x Zoom
        } else if (isFocused) {
            // Slight Hover Effect
            targetScaleScalar *= 1.2;
        }

        // Apply Lerps
        child.position.lerp(targetPos, delta * (isZoomed ? 5.0 : 2.5));
        child.quaternion.slerp(targetRot, delta * (isZoomed ? 5.0 : 2.5));
        
        const currentScale = child.scale.x; // Assumes uniform scale in container
        const newScale = THREE.MathUtils.lerp(currentScale, targetScaleScalar, delta * 4.0);
        child.scale.setScalar(newScale);
     });
  });

  return (
    <group ref={groupRef}>
      {photos.map((photo, i) => (
        <group key={photo.id + photo.url}>
           {/* White Frame - slightly narrower to show less white */}
          <mesh position={[0, 0.1, -0.02]}>
             <boxGeometry args={[1.0 * photo.scale, 1.35 * photo.scale, 0.02]} />
             <meshStandardMaterial color="#f8f8f8" roughness={0.9} />
          </mesh>
          
          {/* Robust Image Loading */}
          <ErrorBoundary fallback={null}>
             <Suspense fallback={null}>
               <PolaroidImage url={photo.url} scale={photo.scale} />
             </Suspense>
          </ErrorBoundary>

          {/* Gold Clip */}
           <mesh position={[0, 0.75 * photo.scale, -0.01]} rotation={[0,0,Math.PI/2]}>
              <cylinderGeometry args={[0.02, 0.02, 0.2, 8]} />
              <meshStandardMaterial color={CONFIG.colors.gold} metalness={1} roughness={0.2} />
           </mesh>
        </group>
      ))}
    </group>
  );
};

// --- Photo Manager UI Component ---
const PhotoManager = ({ onUpdateImages }: { onUpdateImages: (imgs: string[]) => void }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [inputUrl, setInputUrl] = useState("");

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newImages = Array.from(e.target.files).map(file => URL.createObjectURL(file));
      setImages(prev => [...prev, ...newImages]);
    }
  };

  const handleUrlSubmit = () => {
    if (inputUrl) {
      setImages(prev => [...prev, inputUrl]);
      setInputUrl("");
    }
  };

  const applyChanges = () => {
    onUpdateImages(images);
    setIsOpen(false);
  };

  return (
    <div className="absolute bottom-5 right-20 z-50 pointer-events-auto">
      {!isOpen ? (
        <button 
          onClick={() => setIsOpen(true)}
          className="bg-black/50 hover:bg-black/80 text-[#ffd700] border border-[#ffd700] px-4 py-2 rounded-full font-serif-luxury transition-all backdrop-blur-md"
        >
          📷 Customize Photos
        </button>
      ) : (
        <div className="bg-black/90 border border-[#ffd700] p-6 rounded-lg w-80 shadow-[0_0_30px_rgba(255,215,0,0.2)] backdrop-blur-xl">
           <div className="flex justify-between items-center mb-4">
             <h3 className="text-[#ffd700] font-serif-luxury text-xl">Your Memories</h3>
             <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-white">✕</button>
           </div>
           
           {/* File Upload */}
           <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-1">UPLOAD FROM DEVICE</label>
              <input 
                type="file" 
                multiple 
                accept="image/*" 
                onChange={handleFileUpload} 
                className="text-sm text-gray-300 w-full file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-[#ffd700] file:text-black hover:file:bg-yellow-400"
              />
           </div>

           {/* URL Input */}
           <div className="mb-4">
             <label className="block text-xs text-gray-400 mb-1">OR PASTE IMAGE URL</label>
             <div className="flex gap-2">
               <input 
                 type="text" 
                 value={inputUrl} 
                 onChange={(e) => setInputUrl(e.target.value)}
                 className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white flex-1 focus:outline-none focus:border-[#ffd700]"
                 placeholder="https://..."
               />
               <button onClick={handleUrlSubmit} className="text-[#ffd700] text-lg hover:text-white">+</button>
             </div>
           </div>

           {/* Gallery Preview */}
           <div className="flex flex-wrap gap-2 mb-4 max-h-32 overflow-y-auto">
             {images.map((img, idx) => (
               <div key={idx} className="relative w-12 h-12 border border-gray-600 rounded overflow-hidden group">
                 <img src={img} className="w-full h-full object-cover" />
                 <button 
                    onClick={() => setImages(images.filter((_, i) => i !== idx))}
                    className="absolute inset-0 bg-black/60 text-white text-xs opacity-0 group-hover:opacity-100 flex items-center justify-center"
                 >✕</button>
               </div>
             ))}
             {images.length === 0 && <span className="text-gray-500 text-xs italic">No photos added yet.</span>}
           </div>

           <button 
             onClick={applyChanges} 
             className="w-full bg-[#ffd700] text-black font-bold py-2 rounded hover:bg-yellow-400 transition-colors"
           >
             Apply to Tree
           </button>
        </div>
      )}
    </div>
  );
};

// --- Main App Scene ---

const Scene = ({ mode, handPosition, customImages, isPinching }: { mode: 'chaos' | 'formed', handPosition: { x: number, y: number } | null, customImages: string[], isPinching: boolean }) => {
  const controlsRef = useRef<any>(null);

  useFrame(() => {
    // If hand detected, gently nudge camera
    if (handPosition && controlsRef.current && !isPinching) {
       const targetAzimuth = (handPosition.x - 0.5) * 2.0; // -1 to 1 radians
       const targetPolar = Math.PI / 2 - (handPosition.y - 0.5); // Adjust height
       
       controlsRef.current.setAzimuthalAngle(THREE.MathUtils.lerp(controlsRef.current.getAzimuthalAngle(), targetAzimuth, 0.05));
       controlsRef.current.setPolarAngle(THREE.MathUtils.lerp(controlsRef.current.getPolarAngle(), targetPolar, 0.05));
    }
  });

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 4, 20]} fov={45} />
      <OrbitControls 
        ref={controlsRef}
        enablePan={false} 
        minDistance={8} 
        maxDistance={30} 
        autoRotate={!handPosition} 
        autoRotateSpeed={0.8}
        maxPolarAngle={Math.PI / 1.5}
      />

      <ambientLight intensity={0.3} color="#001100" />
      <spotLight position={[10, 20, 10]} angle={0.5} penumbra={1} intensity={350} color={CONFIG.colors.warmLight} castShadow />
      <pointLight position={[-10, 5, -10]} intensity={60} color="#ffd700" />
      <pointLight position={[0, -5, 10]} intensity={30} color={CONFIG.colors.redFill} distance={20} />

      {/* Changed Environment to Lobby */}
      <Environment preset="lobby" />
      <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
      
      <group position={[0, -1.5, 0]}>
        <Float speed={2} rotationIntensity={0.1} floatIntensity={0.5} floatingRange={[-0.2, 0.2]}>
          <Foliage mode={mode} />
          <Ornaments mode={mode} />
          {/* Granular Error Boundary inside Polaroids now */}
          <Polaroids mode={mode} customImages={customImages} handPosition={handPosition} isPinching={isPinching} />
          <TopStar mode={mode} />
        </Float>
      </group>

      <EffectComposer enableNormalPass={false}>
        <Bloom luminanceThreshold={0.85} mipmapBlur intensity={1.0} radius={0.7} />
        <ToneMapping adaptive={true} resolution={256} middleGrey={0.6} maxLuminance={16.0} averageLuminance={1.0} adaptationRate={1.0} />
      </EffectComposer>
      
      <color attach="background" args={[CONFIG.colors.galaxy]} />
    </>
  );
};

const App = () => {
  const [mode, setMode] = useState<'chaos' | 'formed'>('formed'); // Default to formed to start
  const [handPosition, setHandPosition] = useState<{ x: number, y: number } | null>(null);
  const [isPinching, setIsPinching] = useState(false);
  const [customImages, setCustomImages] = useState<string[]>([]);
  
  // MediaPipe Vision logic
  useEffect(() => {
    let handLandmarker: any = undefined;
    let animationFrameId: number;
    const video = document.getElementById("webcam") as HTMLVideoElement;

    const runVision = async () => {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
      );
      handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        numHands: 1
      });

      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
         const stream = await navigator.mediaDevices.getUserMedia({ video: true });
         video.srcObject = stream;
         video.addEventListener("loadeddata", predictWebcam);
      }
    };

    let lastVideoTime = -1;
    const predictWebcam = () => {
      if (video.currentTime !== lastVideoTime && handLandmarker) {
        lastVideoTime = video.currentTime;
        const result = handLandmarker.detectForVideo(video, performance.now());
        
        if (result.landmarks && result.landmarks.length > 0) {
           const landmarks = result.landmarks[0];
           
           // 1. Gesture Detection (Open vs Closed)
           // Simple heuristic: distance of finger tips to wrist (index 0)
           const wrist = landmarks[0];
           const tips = [4, 8, 12, 16, 20].map(i => landmarks[i]);
           
           // Calculate average distance from wrist
           let avgDist = 0;
           tips.forEach(tip => {
              const d = Math.sqrt(
                Math.pow(tip.x - wrist.x, 2) + 
                Math.pow(tip.y - wrist.y, 2)
              );
              avgDist += d;
           });
           avgDist /= 5;

           // Threshold (tuned for normalized coords)
           // Open hand usually > 0.3, Fist usually < 0.15
           // Priority check: If we are pinching, we might be in "Chaos" mode visually, but logic needs to handle it.
           // Usually pinch happens with open hand (fingers extended except thumb/index).
           
           if (avgDist > 0.25) {
             setMode('chaos');
           } else if (avgDist < 0.15) {
             setMode('formed');
           }

           // 2. Pinch Detection (Thumb Tip 4 to Index Tip 8)
           const thumb = landmarks[4];
           const index = landmarks[8];
           const pinchDist = Math.sqrt(
             Math.pow(thumb.x - index.x, 2) + 
             Math.pow(thumb.y - index.y, 2)
           );
           
           // Threshold 0.05 is standard for normalized coords
           setIsPinching(pinchDist < 0.05);

           // 3. Position Tracking for Camera
           setHandPosition({ x: 1 - wrist.x, y: wrist.y });

        } else {
           setHandPosition(null);
           setIsPinching(false);
        }
      }
      animationFrameId = requestAnimationFrame(predictWebcam);
    };

    runVision();

    return () => {
      cancelAnimationFrame(animationFrameId);
      if (video && video.srcObject) {
         (video.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  return (
    <>
      <div className="w-full h-screen bg-black">
        <Canvas shadows dpr={[1, 2]} gl={{ antialias: false, toneMapping: THREE.ReinhardToneMapping }}>
          <Scene mode={mode} handPosition={handPosition} customImages={customImages} isPinching={isPinching} />
        </Canvas>
      </div>

      <div className="absolute top-0 left-0 w-full h-full pointer-events-none flex flex-col justify-between p-10 z-10">
        <header>
          <h1 className="text-7xl font-serif-luxury text-transparent bg-clip-text bg-gradient-to-br from-[#ffd700] via-[#fff0a0] to-[#b8860b] drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)] filter">
            To: LrK
          </h1>
          <h2 className="text-2xl text-yellow-100/80 tracking-[0.6em] font-light mt-2 uppercase border-b border-yellow-500/30 pb-4 inline-block">
            Merry Christmas
          </h2>
        </header>

        <footer className="flex justify-between items-end">
           <div className="text-emerald-500/60 text-xs font-mono tracking-widest">
              STATUS: {mode === 'chaos' ? 'CHAOS (HAND OPEN)' : 'FORMED (FIST CLOSED)'} <br/>
              ACTION: {isPinching ? 'ZOOMING PHOTO' : 'IDLE'} <br/>
              CAMERA CONTROL: {handPosition ? 'ACTIVE (HAND)' : 'AUTO'}
           </div>
           <div className="text-right">
              <p className="text-yellow-400/90 italic font-serif-luxury text-xl drop-shadow-md">
                "Pinch to bring memories closer."
              </p>
           </div>
        </footer>
      </div>
      
      {/* Photo Manager UI */}
      <PhotoManager onUpdateImages={setCustomImages} />
    </>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);