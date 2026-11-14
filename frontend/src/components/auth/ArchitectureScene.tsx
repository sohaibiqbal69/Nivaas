import { useEffect, useRef } from 'react';
import * as THREE from 'three';

type ArchitectureSceneProps = {
  onReady: () => void;
  onFailure: () => void;
};

type FacadeSpec = {
  x: number;
  width: number;
  height: number;
  depth: number;
  z: number;
  profile: 'terrace' | 'lean' | 'stepped';
  material: THREE.MeshStandardMaterial;
  windows: THREE.MeshBasicMaterial;
};

type ParallaxLayer = {
  group: THREE.Group;
  factor: number;
};

const colors = {
  ink: '#091120',
  cream: '#fff8db',
  red: '#e03b29',
  blue: '#1d5287',
  gold: '#f6e7a7',
};

function makeFacade(spec: FacadeSpec): THREE.ExtrudeGeometry {
  const { width, height, depth, profile } = spec;
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);

  if (profile === 'terrace') {
    shape.lineTo(-width / 2, height * 0.72);
    shape.lineTo(-width * 0.18, height * 0.72);
    shape.lineTo(-width * 0.18, height);
    shape.lineTo(width * 0.5, height);
    shape.lineTo(width * 0.5, 0);
  } else if (profile === 'lean') {
    shape.lineTo(-width / 2, height * 0.78);
    shape.lineTo(width * 0.2, height);
    shape.lineTo(width / 2, height * 0.91);
    shape.lineTo(width / 2, 0);
  } else {
    shape.lineTo(-width / 2, height * 0.84);
    shape.lineTo(-width * 0.12, height * 0.84);
    shape.lineTo(-width * 0.12, height);
    shape.lineTo(width * 0.34, height);
    shape.lineTo(width * 0.34, height * 0.62);
    shape.lineTo(width / 2, height * 0.62);
    shape.lineTo(width / 2, 0);
  }
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 1,
    steps: 1,
    bevelSize: 0.018,
    bevelThickness: 0.018,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function addFacade(group: THREE.Group, spec: FacadeSpec): void {
  const facade = new THREE.Mesh(makeFacade(spec), spec.material);
  facade.position.set(spec.x, 0.22, spec.z);
  facade.castShadow = true;
  facade.receiveShadow = true;
  group.add(facade);

  const columns = spec.width > 2.4 ? 3 : 2;
  const rows = spec.height > 5.8 ? 4 : 3;
  const windowGeometry = new THREE.BoxGeometry(0.12, 0.36, 0.035);
  const horizontalSpace = spec.width / (columns + 1);
  const verticalSpace = spec.height / (rows + 1);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const pane = new THREE.Mesh(windowGeometry, spec.windows);
      pane.position.set(
        spec.x - spec.width / 2 + horizontalSpace * (column + 1),
        0.42 + verticalSpace * (row + 1),
        spec.z + spec.depth / 2 + 0.03,
      );
      group.add(pane);
    }
  }
}

export function ArchitectureScene({ onReady, onFailure }: ArchitectureSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const host = canvas.parentElement;
    if (!host) return undefined;
    const sceneHost = host;

    let renderer: THREE.WebGLRenderer | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let frameId = 0;
    let frameActive = false;
    let disposed = false;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 80);
    const pointerTarget = { x: 0, y: 0 };
    const pointerCurrent = { x: 0, y: 0 };
    camera.position.set(0, 2.8, 18);
    camera.lookAt(0, 2.5, 0);

    const makeMaterial = (color: string, opacity: number, roughness = 0.84) => new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness: 0.025,
      transparent: true,
      opacity,
      depthWrite: false,
    });

    const glassMaterial = (color: string, opacity: number) => new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    });

    const cream = makeMaterial(colors.cream, 0.66);
    const gold = makeMaterial(colors.gold, 0.43);
    const terracotta = makeMaterial(colors.red, 0.38, 0.72);
    const navy = makeMaterial(colors.blue, 0.42, 0.68);
    const glass = glassMaterial(colors.blue, 0.45);
    const warmGlass = glassMaterial(colors.red, 0.52);

    const rearLayer = new THREE.Group();
    const middleLayer = new THREE.Group();
    const nearLayer = new THREE.Group();
    scene.add(rearLayer, middleLayer, nearLayer);
    const layers: ParallaxLayer[] = [
      { group: rearLayer, factor: 0.045 },
      { group: middleLayer, factor: 0.095 },
      { group: nearLayer, factor: 0.16 },
    ];

    const horizon = new THREE.Mesh(new THREE.BoxGeometry(18.5, 0.22, 4.4), gold);
    horizon.position.set(0, 0.12, -1.65);
    horizon.receiveShadow = true;
    horizon.castShadow = true;
    rearLayer.add(horizon);

    const farFacades: FacadeSpec[] = [
      { x: -7.05, width: 2.35, height: 5.9, depth: 0.52, z: -2.25, profile: 'terrace', material: gold, windows: glass },
      { x: -4.72, width: 1.85, height: 4.7, depth: 0.48, z: -2.05, profile: 'lean', material: cream, windows: warmGlass },
      { x: -2.55, width: 2.45, height: 6.45, depth: 0.58, z: -2.55, profile: 'stepped', material: navy, windows: glass },
      { x: 0.1, width: 2.5, height: 4.25, depth: 0.72, z: -1.82, profile: 'terrace', material: gold, windows: glass },
      { x: 2.82, width: 2.0, height: 5.15, depth: 0.56, z: -2.3, profile: 'lean', material: cream, windows: warmGlass },
      { x: 5.12, width: 2.5, height: 6.9, depth: 0.72, z: -2.65, profile: 'stepped', material: terracotta, windows: glass },
      { x: 7.85, width: 2.2, height: 5.45, depth: 0.64, z: -2.18, profile: 'terrace', material: navy, windows: warmGlass },
    ];
    farFacades.forEach((facade) => addFacade(rearLayer, facade));

    const middleFacades: FacadeSpec[] = [
      { x: -5.45, width: 1.45, height: 3.55, depth: 0.66, z: -0.48, profile: 'stepped', material: cream, windows: glass },
      { x: -1.88, width: 2.55, height: 3.35, depth: 0.78, z: -0.62, profile: 'lean', material: gold, windows: warmGlass },
      { x: 1.45, width: 1.42, height: 4.7, depth: 0.56, z: -0.94, profile: 'terrace', material: navy, windows: glass },
      { x: 4.42, width: 1.75, height: 4.0, depth: 0.7, z: -0.38, profile: 'stepped', material: gold, windows: warmGlass },
      { x: 7.05, width: 1.32, height: 3.25, depth: 0.6, z: -0.72, profile: 'lean', material: terracotta, windows: glass },
    ];
    middleFacades.forEach((facade) => addFacade(middleLayer, facade));

    const terrace = new THREE.Mesh(new THREE.BoxGeometry(13.2, 0.16, 2.1), cream);
    terrace.position.set(0.6, 0.28, 0.28);
    terrace.castShadow = true;
    terrace.receiveShadow = true;
    nearLayer.add(terrace);

    const frontFins = [
      { x: -3.45, height: 3.15, color: terracotta },
      { x: 0.05, height: 2.25, color: gold },
      { x: 3.05, height: 3.55, color: navy },
      { x: 5.45, height: 2.65, color: cream },
    ];
    frontFins.forEach(({ x, height, color }) => {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, height, 0.56), color);
      fin.position.set(x, 0.36 + height / 2, 0.56);
      fin.rotation.y = -0.16;
      fin.castShadow = true;
      nearLayer.add(fin);
    });

    const planeMaterial = (color: string, opacity: number) => new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const suspendedPlanes = [
      { x: -3.7, y: 6.45, z: -3.05, width: 4.6, height: 1.3, rotation: -0.12, color: colors.gold, opacity: 0.28 },
      { x: 2.8, y: 7.42, z: -3.25, width: 3.8, height: 1.1, rotation: 0.1, color: colors.cream, opacity: 0.52 },
      { x: 6.2, y: 4.2, z: -0.15, width: 3.1, height: 0.48, rotation: -0.09, color: colors.red, opacity: 0.22 },
    ];
    suspendedPlanes.forEach(({ x, y, z, width, height, rotation, color, opacity }) => {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(width, height), planeMaterial(color, opacity));
      panel.position.set(x, y, z);
      panel.rotation.z = rotation;
      panel.rotation.y = -0.08;
      middleLayer.add(panel);
    });

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 36),
      new THREE.ShadowMaterial({ color: colors.ink, opacity: 0.13 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.015;
    ground.receiveShadow = true;
    scene.add(ground);

    const ambient = new THREE.HemisphereLight(colors.cream, colors.blue, 1.65);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight('#fff0c7', 2.4);
    keyLight.position.set(-5.5, 9, 7);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(768, 768);
    keyLight.shadow.camera.left = -10;
    keyLight.shadow.camera.right = 10;
    keyLight.shadow.camera.top = 9;
    keyLight.shadow.camera.bottom = -1;
    keyLight.shadow.bias = -0.0004;
    keyLight.shadow.radius = 4;
    scene.add(keyLight);

    const warmLight = new THREE.PointLight(colors.gold, 0.75, 18, 1.8);
    warmLight.position.set(1.5, 5.6, 4.2);
    scene.add(warmLight);

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    function render() {
      if (!renderer || disposed) return;
      renderer.render(scene, camera);
    }

    function settlePointer() {
      frameActive = false;
      const easing = 0.075;
      pointerCurrent.x += (pointerTarget.x - pointerCurrent.x) * easing;
      pointerCurrent.y += (pointerTarget.y - pointerCurrent.y) * easing;

      camera.position.x = pointerCurrent.x * 0.34;
      camera.position.y = 2.8 - pointerCurrent.y * 0.14;
      camera.lookAt(pointerCurrent.x * 0.16, 2.5 + pointerCurrent.y * 0.06, 0);
      layers.forEach(({ group, factor }) => {
        group.position.x = pointerCurrent.x * factor * 4.4;
        group.position.y = -pointerCurrent.y * factor * 2.8;
      });
      keyLight.position.x = -5.5 + pointerCurrent.x * 1.1;
      warmLight.intensity = 0.75 + Math.abs(pointerCurrent.x) * 0.2;
      render();

      const remaining = Math.abs(pointerTarget.x - pointerCurrent.x) + Math.abs(pointerTarget.y - pointerCurrent.y);
      if (remaining > 0.001) {
        frameId = window.requestAnimationFrame(settlePointer);
      } else {
        pointerCurrent.x = pointerTarget.x;
        pointerCurrent.y = pointerTarget.y;
      }
    }

    function scheduleSettle() {
      if (frameActive || disposed) return;
      frameActive = true;
      frameId = window.requestAnimationFrame(settlePointer);
    }

    function resize() {
      if (!renderer || disposed) return;
      const { width, height } = sceneHost.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
      camera.aspect = width / height;
      camera.position.z = camera.aspect < 1.42 ? 20 : camera.aspect < 1.72 ? 18 : 16.5;
      camera.updateProjectionMatrix();
      render();
    }

    function pointerMove(event: PointerEvent) {
      if (reducedMotion.matches || event.pointerType === 'touch') return;
      pointerTarget.x = Math.max(-1, Math.min(1, (event.clientX / window.innerWidth) * 2 - 1));
      pointerTarget.y = Math.max(-1, Math.min(1, (event.clientY / window.innerHeight) * 2 - 1));
      scheduleSettle();
    }

    function resetPointer() {
      pointerTarget.x = 0;
      pointerTarget.y = 0;
      if (reducedMotion.matches) {
        if (frameActive) window.cancelAnimationFrame(frameId);
        frameActive = false;
        pointerCurrent.x = 0;
        pointerCurrent.y = 0;
        camera.position.set(0, 2.8, camera.position.z);
        camera.lookAt(0, 2.5, 0);
        layers.forEach(({ group }) => group.position.set(0, 0, 0));
        keyLight.position.x = -5.5;
        warmLight.intensity = 0.75;
        render();
      } else {
        scheduleSettle();
      }
    }

    function motionPreferenceChanged() {
      if (reducedMotion.matches) resetPointer();
    }

    function contextLost(event: Event) {
      event.preventDefault();
      disposed = true;
      onFailure();
    }

    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'low-power',
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.setClearColor(0x000000, 0);
      resize();
      window.addEventListener('pointermove', pointerMove, { passive: true });
      document.documentElement.addEventListener('pointerleave', resetPointer, { passive: true });
      window.addEventListener('blur', resetPointer, { passive: true });
      canvas.addEventListener('webglcontextlost', contextLost);
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(sceneHost);
      } else {
        window.addEventListener('resize', resize, { passive: true });
      }
      reducedMotion.addEventListener('change', motionPreferenceChanged);
      onReady();
    } catch {
      disposed = true;
      renderer?.dispose();
      onFailure();
    }

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('pointermove', pointerMove);
      document.documentElement.removeEventListener('pointerleave', resetPointer);
      window.removeEventListener('blur', resetPointer);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('webglcontextlost', contextLost);
      reducedMotion.removeEventListener('change', motionPreferenceChanged);
      resizeObserver?.disconnect();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer?.dispose();
    };
  }, [onFailure, onReady]);

  return <canvas ref={canvasRef} className="login-environment-canvas" aria-hidden="true" tabIndex={-1} />;
}
