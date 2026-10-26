// Custom mesh shaders: per-vertex colour meshes and sun-extruded shadow volumes.
import { Geometry, Mesh, Shader, UniformGroup } from 'pixi.js';
import type { MeshData } from './geometry';

const colorVert = /* glsl */ `
in vec2 aPosition;
in vec4 aColor;
out vec4 vColor;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vColor = vec4(aColor.rgb * aColor.a, aColor.a) * uColor;
}`;

const colorFrag = /* glsl */ `
in vec4 vColor;
void main() {
  gl_FragColor = vColor;
}`;

const shadowVert = /* glsl */ `
in vec2 aPosition;
in float aExtrude;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec2 uSun;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  vec2 p = aPosition + uSun * aExtrude;
  gl_Position = vec4((mvp * vec3(p, 1.0)).xy, 0.0, 1.0);
}`;

const shadowFrag = /* glsl */ `
uniform vec4 uShadowColor;
void main() {
  gl_FragColor = uShadowColor;
}`;

let colorShader: Shader | null = null;
let shadowShader: Shader | null = null;
export const shadowUniforms = new UniformGroup({
  uSun: { value: new Float32Array([0.42, 0.55]), type: 'vec2<f32>' },
  uShadowColor: { value: new Float32Array([0.13, 0.12, 0.16, 1]), type: 'vec4<f32>' },
});

function getColorShader() {
  return (colorShader ??= Shader.from({ gl: { vertex: colorVert, fragment: colorFrag }, resources: {} }));
}
function getShadowShader() {
  return (shadowShader ??= Shader.from({ gl: { vertex: shadowVert, fragment: shadowFrag }, resources: { shadowUniforms } }));
}

export function colorMesh(d: MeshData): Mesh<Geometry, Shader> {
  const geometry = new Geometry({
    attributes: {
      aPosition: { buffer: d.pos, format: 'float32x2' },
      aColor: { buffer: d.col!, format: 'unorm8x4' },
    },
    indexBuffer: d.idx,
  });
  return new Mesh({ geometry, shader: getColorShader() });
}

export function shadowMesh(d: MeshData): Mesh<Geometry, Shader> {
  const geometry = new Geometry({
    attributes: {
      aPosition: { buffer: d.pos, format: 'float32x2' },
      aExtrude: { buffer: d.ext!, format: 'float32' },
    },
    indexBuffer: d.idx,
  });
  return new Mesh({ geometry, shader: getShadowShader() });
}

/** Set sun direction: shadow offset (metres) per metre of height. */
export function setSun(dx: number, dy: number) {
  const u = shadowUniforms.uniforms.uSun as Float32Array;
  u[0] = dx;
  u[1] = dy;
  shadowUniforms.update();
}
