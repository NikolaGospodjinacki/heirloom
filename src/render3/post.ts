import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { HorizontalTiltShiftShader } from 'three/examples/jsm/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/examples/jsm/shaders/VerticalTiltShiftShader.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';
import type { Stage } from './core';

/** A gentle warm grade: warm the mids, lift the shadows a touch, a little more colour. */
const GradeShader = {
  name: 'HeirloomGrade',
  uniforms: {
    tDiffuse: { value: null },
    warmth: { value: new THREE.Vector3(1.06, 1.0, 0.88) },
    lift: { value: new THREE.Vector3(0.012, 0.008, 0.02) },
    saturation: { value: 1.1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 warmth;
    uniform vec3 lift;
    uniform float saturation;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * warmth + lift;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation);
      gl_FragColor = vec4(col, c.a);
    }`,
};

export interface Post {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  tiltH: ShaderPass;
  tiltV: ShaderPass;
  grade: ShaderPass;
  vignette: ShaderPass;
  /** blur strength at the top and bottom of the frame, in pixels */
  tiltPx: number;
  resize: (w: number, h: number) => void;
  render: () => void;
}

/**
 * The HD-2D look lives here as much as in the models: tilt-shift that makes
 * the world read as a miniature, soft bloom on lanterns and windows, a warm
 * grade and a vignette to hold the eye in the middle.
 */
export function makePost(stage: Stage): Post {
  const { renderer, scene, camera } = stage;
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.6, 0.58);
  composer.addPass(bloom);

  const tiltH = new ShaderPass(HorizontalTiltShiftShader);
  const tiltV = new ShaderPass(VerticalTiltShiftShader);
  tiltH.uniforms.r.value = 0.5;
  tiltV.uniforms.r.value = 0.5;
  composer.addPass(tiltH);
  composer.addPass(tiltV);

  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  const vignette = new ShaderPass(VignetteShader);
  vignette.uniforms.offset.value = 0.92;
  vignette.uniforms.darkness.value = 1.1;
  composer.addPass(vignette);

  composer.addPass(new OutputPass());

  const post: Post = {
    composer, bloom, tiltH, tiltV, grade, vignette,
    tiltPx: 2.6,
    resize: (w: number, h: number) => {
      composer.setSize(w, h);
      const pr = renderer.getPixelRatio();
      tiltH.uniforms.h.value = post.tiltPx / Math.max(1, w * pr);
      tiltV.uniforms.v.value = post.tiltPx / Math.max(1, h * pr);
      bloom.resolution.set(w, h);
    },
    render: () => composer.render(),
  };
  return post;
}

export type Mood = 'town' | 'wild' | 'gloom' | 'ember';

const MOODS: Record<Mood, { warmth: [number, number, number]; saturation: number; vignette: number; bloom: number }> = {
  // late afternoon in the village: golden and a little rich
  town: { warmth: [1.06, 1.0, 0.88], saturation: 1.1, vignette: 1.1, bloom: 0.42 },
  // fields and woods: still warm, lighter at the edges so you can see what is coming
  wild: { warmth: [1.04, 1.0, 0.92], saturation: 1.08, vignette: 0.85, bloom: 0.38 },
  // the barrows: cooler and closer
  gloom: { warmth: [0.96, 1.0, 1.06], saturation: 0.96, vignette: 1.15, bloom: 0.5 },
  // the ridge is red already; leave its colour alone and let the embers glow
  ember: { warmth: [1.0, 0.98, 0.96], saturation: 1.02, vignette: 0.8, bloom: 0.6 },
};

/** The grade for a scene: warmth, colour, how dark the corners get and how much things glow. */
export function setMood(post: Post, mood: Mood): void {
  const m = MOODS[mood];
  (post.grade.uniforms.warmth.value as THREE.Vector3).set(m.warmth[0], m.warmth[1], m.warmth[2]);
  post.grade.uniforms.saturation.value = m.saturation;
  post.vignette.uniforms.darkness.value = m.vignette;
  post.bloom.strength = m.bloom;
}
