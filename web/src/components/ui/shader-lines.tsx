"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    THREE?: ThreeGlobal;
  }
}

type ShaderUniforms = {
  time: { type: "f"; value: number };
  resolution: { type: "v2"; value: Vector2Like };
};

type Vector2Like = {
  x: number;
  y: number;
};

type WebGlRendererLike = {
  domElement: HTMLCanvasElement;
  setPixelRatio: (value: number) => void;
  setSize: (width: number, height: number) => void;
  render: (scene: unknown, camera: unknown) => void;
  dispose: () => void;
};

type SceneLike = {
  add: (mesh: unknown) => void;
};

type ThreeGlobal = {
  Camera: new () => { position: { z: number } };
  Scene: new () => SceneLike;
  PlaneBufferGeometry: new (width: number, height: number) => unknown;
  Vector2: new () => Vector2Like;
  ShaderMaterial: new (params: {
    uniforms: ShaderUniforms;
    vertexShader: string;
    fragmentShader: string;
  }) => unknown;
  Mesh: new (geometry: unknown, material: unknown) => unknown;
  WebGLRenderer: new () => WebGlRendererLike;
};

type ShaderScene = {
  camera: unknown;
  scene: unknown;
  renderer: WebGlRendererLike | null;
  uniforms: ShaderUniforms | null;
  animationId: number | null;
  resizeHandler: (() => void) | null;
};

export function ShaderAnimation({ onReady }: { onReady?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const readyRef = useRef(false);
  const sceneRef = useRef<ShaderScene>({
    camera: null,
    scene: null,
    renderer: null,
    uniforms: null,
    animationId: null,
    resizeHandler: null
  });

  useEffect(() => {
    let cancelled = false;

    const initThreeJS = () => {
      if (!containerRef.current || !window.THREE || cancelled) {
        return;
      }

      const THREE = window.THREE;
      const container = containerRef.current;

      container.innerHTML = "";

      const camera = new THREE.Camera();
      camera.position.z = 1;

      const scene = new THREE.Scene();
      const geometry = new THREE.PlaneBufferGeometry(2, 2);
      const uniforms: ShaderUniforms = {
        time: { type: "f", value: 1.0 },
        resolution: { type: "v2", value: new THREE.Vector2() }
      };

      const vertexShader = `
        void main() {
          gl_Position = vec4( position, 1.0 );
        }
      `;

      const fragmentShader = `
        #define TWO_PI 6.2831853072
        #define PI 3.14159265359

        precision highp float;
        uniform vec2 resolution;
        uniform float time;

        float random (in float x) {
          return fract(sin(x)*1e4);
        }

        float random (vec2 st) {
          return fract(sin(dot(st.xy,
                               vec2(12.9898,78.233)))*
              43758.5453123);
        }

        varying vec2 vUv;

        void main(void) {
          vec2 uv = (gl_FragCoord.xy * 2.0 - resolution.xy) / min(resolution.x, resolution.y);

          vec2 fMosaicScal = vec2(4.0, 2.0);
          vec2 vScreenSize = vec2(256,256);
          uv.x = floor(uv.x * vScreenSize.x / fMosaicScal.x) / (vScreenSize.x / fMosaicScal.x);
          uv.y = floor(uv.y * vScreenSize.y / fMosaicScal.y) / (vScreenSize.y / fMosaicScal.y);

          float t = time*0.06+random(uv.x)*0.4;
          float lineWidth = 0.0008;

          vec3 color = vec3(0.0);
          for(int j = 0; j < 3; j++){
            for(int i=0; i < 5; i++){
              color[j] += lineWidth*float(i*i) / abs(fract(t - 0.01*float(j)+float(i)*0.01)*1.0 - length(uv));
            }
          }

          gl_FragColor = vec4(color[2],color[1],color[0],1.0);
        }
      `;

      const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader,
        fragmentShader
      });

      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);

      const renderer = new THREE.WebGLRenderer();
      renderer.setPixelRatio(window.devicePixelRatio);
      container.appendChild(renderer.domElement);

      const onWindowResize = () => {
        const rect = container.getBoundingClientRect();
        renderer.setSize(rect.width, rect.height);
        uniforms.resolution.value.x = renderer.domElement.width;
        uniforms.resolution.value.y = renderer.domElement.height;
      };

      sceneRef.current = {
        camera,
        scene,
        renderer,
        uniforms,
        animationId: null,
        resizeHandler: onWindowResize
      };

      onWindowResize();
      window.addEventListener("resize", onWindowResize, false);

      const animate = () => {
        sceneRef.current.animationId = requestAnimationFrame(animate);
        uniforms.time.value += 0.05;
        renderer.render(scene, camera);

        if (!readyRef.current) {
          readyRef.current = true;
          onReady?.();
        }
      };

      animate();
    };

    if (window.THREE) {
      initThreeJS();
    } else {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/three.js/89/three.min.js";
      script.onload = initThreeJS;
      script.onerror = () => onReady?.();
      document.head.appendChild(script);

      return () => {
        cancelled = true;

        if (sceneRef.current.animationId) {
          cancelAnimationFrame(sceneRef.current.animationId);
        }

        if (sceneRef.current.resizeHandler) {
          window.removeEventListener("resize", sceneRef.current.resizeHandler, false);
        }

        if (sceneRef.current.renderer) {
          sceneRef.current.renderer.dispose();
        }

        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }
      };
    }

    return () => {
      cancelled = true;

      if (sceneRef.current.animationId) {
        cancelAnimationFrame(sceneRef.current.animationId);
      }

      if (sceneRef.current.resizeHandler) {
        window.removeEventListener("resize", sceneRef.current.resizeHandler, false);
      }

      if (sceneRef.current.renderer) {
        sceneRef.current.renderer.dispose();
      }
    };
  }, [onReady]);

  return <div ref={containerRef} className="shader-lines-canvas" />;
}
