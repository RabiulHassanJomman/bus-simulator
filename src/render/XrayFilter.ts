// Soft circular see-through hole: fades overhead structures (flyovers, metro viaduct,
// buildings) around a screen point so ground traffic under them stays visible.
import { Filter, GlProgram, UniformGroup, type FilterSystem, type RenderSurface, type Texture } from 'pixi.js';

// default filter vertex shader plus the fragment's screen position
const vert = /* glsl */ `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vScreen;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
uniform vec2 uOrigin;
void main() {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
  vScreen = aPosition * uOutputFrame.zw + uOrigin;
}`;

const frag = /* glsl */ `
in vec2 vTextureCoord;
in vec2 vScreen;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec3 uHole; // screen x, y, radius (logical px)
uniform vec2 uFade; // soft edge width (px), alpha left inside the hole
void main() {
  float d = distance(vScreen, uHole.xy);
  float k = smoothstep(uHole.z - uFade.x, uHole.z, d);
  finalColor = texture(uTexture, vTextureCoord) * mix(uFade.y, 1.0, k);
}`;

export class XrayFilter extends Filter {
  private u: UniformGroup;

  constructor() {
    const u = new UniformGroup({
      uOrigin: { value: new Float32Array(2), type: 'vec2<f32>' },
      uHole: { value: new Float32Array(3), type: 'vec3<f32>' },
      uFade: { value: new Float32Array([30, 0.15]), type: 'vec2<f32>' },
    });
    super({ glProgram: GlProgram.from({ vertex: vert, fragment: frag, name: 'xray-filter' }), resources: { xray: u } });
    this.u = u;
  }

  /** Hole centre/radius/soft edge in screen px; `minAlpha` is the opacity left at the centre. */
  set(x: number, y: number, radius: number, edge: number, minAlpha: number) {
    const h = this.u.uniforms.uHole as Float32Array;
    h[0] = x;
    h[1] = y;
    h[2] = radius;
    const f = this.u.uniforms.uFade as Float32Array;
    f[0] = edge;
    f[1] = minAlpha;
  }

  override apply(fs: FilterSystem, input: Texture, output: RenderSurface, clear: boolean) {
    // filter texture origin in screen space, so the shader can work in screen px
    const b = (fs as unknown as { _activeFilterData?: { bounds: { minX: number; minY: number } } })._activeFilterData?.bounds;
    const o = this.u.uniforms.uOrigin as Float32Array;
    o[0] = b?.minX ?? 0;
    o[1] = b?.minY ?? 0;
    this.u.update();
    fs.applyFilter(this, input, output, clear);
  }
}
