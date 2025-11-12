"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

type Palette = {
  dominant: string;
  accent: string;
  ambient: string;
};

type SceneSettings = {
  warm: boolean;
  highContrast: boolean;
  fogDensity: number;
  backlit: boolean;
  spotlight: boolean;
  monochrome: boolean;
  desaturated: boolean;
  fov: number;
  move: "dolly-in" | "pan-left" | "orbit-right" | "tilt-up" | "static";
  durationSec: number;
};

function parsePrompt(prompt: string): SceneSettings {
  const p = prompt.toLowerCase();
  const includes = (w: string) => p.includes(w);
  const warm = includes('warm') || includes('gold') || includes('sunset');
  const highContrast = includes('high contrast') || includes('chiaroscuro') || includes('dramatic');
  const fogDensity = includes('fog') || includes('haze') ? (includes('thick') ? 0.035 : 0.015) : 0.006;
  const backlit = includes('backlit') || includes('rim light') || includes('silhouette');
  const spotlight = includes('spotlight') || includes('stage') || includes('interview');
  const monochrome = includes('monochrome') || includes('black and white');
  const desaturated = includes('desaturated') || includes('minimal');
  const fov = includes('wide') ? 60 : includes('close') || includes('portrait') ? 35 : 45;
  let move: SceneSettings['move'] = 'static';
  if (includes('dolly')) move = 'dolly-in';
  else if (includes('pan')) move = 'pan-left';
  else if (includes('orbit')) move = 'orbit-right';
  else if (includes('tilt')) move = 'tilt-up';
  const durationSec = includes('10s') || includes('10 seconds') ? 10 : includes('5s') ? 5 : 7;
  return { warm, highContrast, fogDensity, backlit, spotlight, monochrome, desaturated, fov, move, durationSec };
}

function averageColorFromImage(img: HTMLImageElement): Palette {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return { dominant: '#888888', accent: '#444444', ambient: '#cccccc' };
  const w = (canvas.width = Math.min(256, img.naturalWidth || 256));
  const h = (canvas.height = Math.min(256, img.naturalHeight || 256));
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  let r = 0, g = 0, b = 0;
  let r2 = 0, g2 = 0, b2 = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 16) {
    const rr = data[i], gg = data[i + 1], bb = data[i + 2];
    r += rr; g += gg; b += bb;
    r2 += rr * rr; g2 += gg * gg; b2 += bb * bb;
    count++;
  }
  r = Math.round(r / count); g = Math.round(g / count); b = Math.round(b / count);
  const dominant = `rgb(${r}, ${g}, ${b})`;
  const ambient = `rgb(${Math.min(255, r + 40)}, ${Math.min(255, g + 40)}, ${Math.min(255, b + 40)})`;
  const accent = `rgb(${Math.max(0, r - 60)}, ${Math.max(0, g - 60)}, ${Math.max(0, b - 60)})`;
  return { dominant, accent, ambient };
}

function createMannequin(): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.05, roughness: 0.8 });
  const capsule = (radiusTop: number, radiusBottom: number, height: number, radialSegments = 24) => {
    const g = new THREE.CapsuleGeometry(radiusTop, Math.max(0, height - radiusTop - radiusBottom), radialSegments, 16);
    return new THREE.Mesh(g, material);
  };
  const sphere = (r: number) => new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16), material);

  // Torso
  const torso = capsule(0.35, 0.35, 1.3);
  torso.position.y = 1.4;
  group.add(torso);
  // Head
  const head = sphere(0.32);
  head.position.set(0, 2.3, 0);
  group.add(head);
  // Arms
  const upperArmL = capsule(0.16, 0.16, 0.9);
  upperArmL.position.set(0.55, 1.85, 0);
  upperArmL.rotation.z = Math.PI * 0.15;
  const lowerArmL = capsule(0.14, 0.14, 0.8);
  lowerArmL.position.set(0.95, 1.4, 0);
  lowerArmL.rotation.z = Math.PI * 0.25;

  const upperArmR = upperArmL.clone(); upperArmR.position.x *= -1; upperArmR.rotation.z *= -1;
  const lowerArmR = lowerArmL.clone(); lowerArmR.position.x *= -1; lowerArmR.rotation.z *= -1;

  group.add(upperArmL, lowerArmL, upperArmR, lowerArmR);

  // Legs
  const upperLegL = capsule(0.2, 0.2, 1.0);
  upperLegL.position.set(0.25, 0.6, 0);
  upperLegL.rotation.z = Math.PI * 0.02;
  const lowerLegL = capsule(0.18, 0.18, 0.95);
  lowerLegL.position.set(0.25, -0.1, 0.05);

  const upperLegR = upperLegL.clone(); upperLegR.position.x *= -1; upperLegR.rotation.z *= -1;
  const lowerLegR = lowerLegL.clone(); lowerLegR.position.x *= -1;

  group.add(upperLegL, lowerLegL, upperLegR, lowerLegR);

  // Subtle contrapposto
  group.rotation.y = 0.05;
  head.rotation.x = -0.03;

  return group;
}

export default function Page() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [prompt, setPrompt] = useState<string>(
    'Minimal, backlit interview, soft fog, warm rim light, slow dolly'
  );
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isRenderingStill, setIsRenderingStill] = useState(false);
  const [duration, setDuration] = useState<number>(7);

  const settings = useMemo(() => parsePrompt(prompt), [prompt]);

  useEffect(() => setDuration(settings.durationSec), [settings.durationSec]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#111111');

    const camera = new THREE.PerspectiveCamera(settings.fov, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
    camera.position.set(3.2, 1.9, 4.2);

    const controls = { t: 0 };

    // Ground and backdrop
    const groundMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0.02 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;

    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), groundMat);
    backdrop.position.set(0, 10, -8);

    scene.add(ground, backdrop);

    // Mannequin
    const mannequin = createMannequin();
    scene.add(mannequin);

    // Lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, settings.highContrast ? 0.35 : 0.6);
    scene.add(hemi);

    const key = new THREE.SpotLight(settings.warm ? 0xffc58f : 0xb0c7ff, settings.spotlight ? 3.0 : 1.6, 30, Math.PI / 6, 0.3, 1.5);
    key.position.set(3.5, 3.6, 3.2);
    key.target = mannequin;
    scene.add(key);

    const rim = new THREE.DirectionalLight(settings.warm ? 0xffb070 : 0xcfe3ff, settings.backlit ? 2.5 : 0.8);
    rim.position.set(-3, 3.5, -3);
    scene.add(rim);

    const fill = new THREE.DirectionalLight(0xffffff, settings.highContrast ? 0.2 : 0.6);
    fill.position.set(-2, 1.0, 2);
    scene.add(fill);

    // Fog
    scene.fog = new THREE.FogExp2(settings.monochrome ? 0xdddddd : 0xf3f3f3, settings.fogDensity);

    // Color grading via uploaded image palette
    let revokeUrl: string | null = null;
    if (imgUrl) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = imgUrl;
      img.onload = () => {
        const pal = averageColorFromImage(img);
        const to = (css: string) => new THREE.Color(css);
        const dom = to(pal.dominant);
        const amb = to(pal.ambient);
        groundMat.color.lerp(dom, 0.25);
        (backdrop.material as THREE.MeshStandardMaterial).color.lerp(amb, 0.25);
        hemi.color = amb.clone();
        rim.color = dom.clone().offsetHSL(settings.warm ? -0.04 : 0.04, 0, 0);
        key.color = dom.clone();
      };
    } else {
      const base = new THREE.Color(settings.warm ? '#e9dcc8' : '#dfe7f1');
      groundMat.color.lerp(base, 0.3);
      (backdrop.material as THREE.MeshStandardMaterial).color.lerp(base, 0.2);
    }

    // Monochrome / desaturation via material color
    if (settings.monochrome || settings.desaturated) {
      const gray = settings.warm ? new THREE.Color('#e6e0d4') : new THREE.Color('#e8ebef');
      (mannequin.children as THREE.Mesh[]).forEach((m) => {
        const mesh = m as THREE.Mesh;
        (mesh.material as THREE.MeshStandardMaterial).color.copy(gray);
      });
    }

    // Resize
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = settings.fov;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // Animation and camera motion
    const start = performance.now();
    let raf = 0;

    const animate = () => {
      const now = performance.now();
      const t = (now - start) / 1000;
      controls.t = t;

      // subtle breathing
      mannequin.position.y = 0.02 * Math.sin(t * 1.1);
      mannequin.rotation.y = 0.05 + 0.02 * Math.sin(t * 0.6);

      // camera paths
      const basePos = new THREE.Vector3(3.2, 1.9, 4.2);
      let cam = basePos.clone();
      switch (settings.move) {
        case 'dolly-in':
          cam.z = 4.2 - 0.8 * Math.min(1, (t % duration) / duration);
          break;
        case 'pan-left':
          cam.x = 3.2 - 1.0 * Math.sin((t / duration) * Math.PI * 2);
          break;
        case 'orbit-right':
          {
            const ang = 0.4 + 0.25 * Math.sin((t / duration) * Math.PI * 2);
            cam.x = 3.6 * Math.cos(ang);
            cam.z = 3.6 * Math.sin(ang);
          }
          break;
        case 'tilt-up':
          cam.y = 1.6 + 0.5 * Math.min(1, (t % duration) / duration);
          break;
        default:
          break;
      }
      camera.position.lerp(cam, 0.1);
      camera.lookAt(0, 1.6, 0);

      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
    };
  }, [imgUrl, settings.fov, settings.move, settings.backlit, settings.spotlight, settings.warm, settings.highContrast, settings.monochrome, settings.desaturated, settings.fogDensity, duration]);

  const handleImageUpload = (file: File) => {
    const url = URL.createObjectURL(file);
    if (imgUrl) URL.revokeObjectURL(imgUrl);
    setImgUrl(url);
  };

  const renderStill4K = async () => {
    if (!canvasRef.current) return;
    setIsRenderingStill(true);
    const canvas = canvasRef.current;
    const rendererCanvas = canvas as HTMLCanvasElement;
    const prevWidth = rendererCanvas.clientWidth;
    const prevHeight = rendererCanvas.clientHeight;
    // Temporarily size the canvas for high-res render
    rendererCanvas.style.width = '3840px';
    rendererCanvas.style.height = '2160px';
    await new Promise((r) => setTimeout(r, 50));
    const dataUrl = rendererCanvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'cinematic_still_4k.png';
    a.click();
    // Restore
    rendererCanvas.style.width = prevWidth + 'px';
    rendererCanvas.style.height = prevHeight + 'px';
    setIsRenderingStill(false);
  };

  const recordBroll = async () => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const stream = canvas.captureStream(24);
    const chunks: BlobPart[] = [];
    const mr = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
    setIsRecording(true);

    const stopAfter = (settings.durationSec || duration) * 1000;

    await new Promise<void>((resolve) => {
      mr.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      mr.onstop = () => resolve();
      mr.start();
      setTimeout(() => mr.stop(), stopAfter);
    });

    const blob = new Blob(chunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'broll.webm';
    a.click();
    URL.revokeObjectURL(url);
    setIsRecording(false);
  };

  return (
    <main className="container">
      <header className="header">
        <h1>Cinematic 3D Generator</h1>
        <p>Ultra-realistic, featureless humanoid visuals for documentaries and interviews.</p>
      </header>

      <section className="controls">
        <div className="control">
          <label htmlFor="prompt">Describe your scene</label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g., Minimal, backlit interview, soft fog, warm rim light, slow dolly"
            rows={3}
          />
          <div className="presets">
            <button onClick={() => setPrompt('Backlit interview, spotlight, high contrast, slow dolly, warm')}>Interview Backlit</button>
            <button onClick={() => setPrompt('Monochrome, soft haze, wide, orbit, minimal')}>Monochrome Orbit</button>
            <button onClick={() => setPrompt('Cool, desaturated, gentle fog, pan left, minimal white void')}>Minimal White Void</button>
          </div>
        </div>

        <div className="control">
          <label>Upload reference photo (for palette)</label>
          <input type="file" accept="image/*" onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleImageUpload(f);
          }} />
          {imgUrl && (
            <div className="thumb">
              <img src={imgUrl} alt="palette" />
              <button className="clear" onClick={() => { if (imgUrl) URL.revokeObjectURL(imgUrl); setImgUrl(null); }}>Remove</button>
            </div>
          )}
        </div>

        <div className="actions">
          <button onClick={renderStill4K} disabled={isRenderingStill}>{isRenderingStill ? 'Rendering?' : 'Render 4K Still'}</button>
          <button onClick={recordBroll} disabled={isRecording}>{isRecording ? 'Recording?' : `Record B?roll (${duration}s)`}</button>
        </div>
      </section>

      <section className="stage">
        <canvas ref={canvasRef} className="stage-canvas" />
      </section>

      <footer className="footer">
        <span>Tip: Use keywords like ?backlit?, ?spotlight?, ?fog?, ?wide?, ?orbit?.</span>
      </footer>
    </main>
  );
}
