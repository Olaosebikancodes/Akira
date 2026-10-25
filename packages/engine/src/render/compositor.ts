import type { Rgb } from "./color";
import { coverScale, layerGeometry, type Mat3 } from "./geometry";
import type { Rotation } from "./orientation";

/** A decoded picture and the orientation stored with it. */
export interface Picture {
  source: VideoFrame | ImageBitmap;
  /** Size as displayed, after `rotation`. */
  displayWidth: number;
  displayHeight: number;
  rotation: Rotation;
  flip: boolean;
  /**
   * Stills and sticker frames set this so their texture is uploaded once and
   * reused; video frames leave it unset and stream through a shared texture.
   */
  cacheKey?: string;
}

export interface Layer {
  picture: Picture;
  /** From `layerGeometry`: unit square to canvas pixels, and to texture coordinates. */
  model: Mat3;
  texture: Mat3;
  opacity: number;
}

export type BackgroundFill =
  | { kind: "color"; color: Rgb }
  /** A picture scaled to cover the canvas. */
  | { kind: "picture"; picture: Picture }
  /** A picture scaled to cover the canvas and blurred; `amount` runs 0 to 1. */
  | { kind: "blur"; picture: Picture; amount: number };

export interface CompositorOptions {
  /**
   * Keep the last frame readable after drawing. Export needs this so the
   * encoder can capture the canvas; the live preview doesn't.
   */
  preserveDrawingBuffer?: boolean;
}

const LAYER_VERTEX = `#version 300 es
// Unit quad corner: (0, 0) is the top-left of the visible picture.
in vec2 a_corner;
uniform mat3 u_model;
uniform mat3 u_texture;
uniform vec2 u_target;
out vec2 v_texCoord;

void main() {
  vec2 pixel = (u_model * vec3(a_corner, 1.0)).xy;
  vec2 clipSpace = pixel / u_target * 2.0 - 1.0;
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_texCoord = (u_texture * vec3(a_corner, 1.0)).xy;
}
`;

const LAYER_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform float u_opacity;
in vec2 v_texCoord;
out vec4 outColor;

void main() {
  // Textures hold premultiplied alpha, so opacity scales every channel.
  outColor = texture(u_image, v_texCoord) * u_opacity;
}
`;

const BLUR_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_step;
in vec2 v_texCoord;
out vec4 outColor;

// 9-tap Gaussian folded into 5 bilinear samples.
void main() {
  vec4 sum = texture(u_image, v_texCoord) * 0.2270270270;
  sum += texture(u_image, v_texCoord + u_step * 1.3846153846) * 0.3162162162;
  sum += texture(u_image, v_texCoord - u_step * 1.3846153846) * 0.3162162162;
  sum += texture(u_image, v_texCoord + u_step * 3.2307692308) * 0.0702702703;
  sum += texture(u_image, v_texCoord - u_step * 3.2307692308) * 0.0702702703;
  outColor = sum;
}
`;

const IDENTITY: Mat3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
/** Framebuffer textures store rows bottom-up, so sampling them flips vertically. */
const FLIP_V: Mat3 = new Float32Array([1, 0, 0, 0, -1, 0, 0, 1, 1]);

interface Program {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation>;
}

interface Target {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

interface CachedTexture {
  texture: WebGLTexture;
  source: VideoFrame | ImageBitmap;
}

/**
 * Draws pictures onto a canvas with WebGL2. Preview and export both render
 * through this class, so what the user sees is exactly what gets encoded.
 */
export class Compositor {
  private readonly gl: WebGL2RenderingContext;
  private readonly layerProgram: Program;
  private readonly blurProgram: Program;
  private readonly quad: WebGLVertexArrayObject;
  private readonly streamTexture: WebGLTexture;
  private readonly cache = new Map<string, CachedTexture>();
  private blurTargets: [Target, Target] | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement | OffscreenCanvas,
    options: CompositorOptions = {},
  ) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("WebGL2 isn't available in this browser.");
    this.gl = gl;

    this.layerProgram = linkProgram(gl, LAYER_VERTEX, LAYER_FRAGMENT, ["u_model", "u_texture", "u_target", "u_opacity"]);
    this.blurProgram = linkProgram(gl, LAYER_VERTEX, BLUR_FRAGMENT, ["u_model", "u_texture", "u_target", "u_step"]);
    this.quad = createUnitQuad(gl);
    this.streamTexture = createTexture(gl, true);
  }

  get width(): number {
    return this.canvas.width;
  }

  get height(): number {
    return this.canvas.height;
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
    this.releaseBlurTargets();
  }

  /** Fills the background, then draws the layers bottom to top. */
  render(background: BackgroundFill, layers: readonly Layer[]): void {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    const clear = background.kind === "color" ? background.color : [0, 0, 0];
    gl.clearColor(clear[0]!, clear[1]!, clear[2]!, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(this.quad);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    if (background.kind === "picture") this.drawCover(background.picture);
    if (background.kind === "blur") this.drawBlurred(background.picture, background.amount);
    for (const layer of layers) {
      this.drawLayer(layer.picture, layer.model, layer.texture, layer.opacity, this.width, this.height);
    }
    gl.bindVertexArray(null);
  }

  /** Frees the texture kept for a still or sticker that's no longer used. */
  release(cacheKey: string): void {
    const cached = this.cache.get(cacheKey);
    if (!cached) return;
    this.gl.deleteTexture(cached.texture);
    this.cache.delete(cacheKey);
  }

  dispose(): void {
    const { gl } = this;
    for (const key of [...this.cache.keys()]) this.release(key);
    this.releaseBlurTargets();
    gl.deleteTexture(this.streamTexture);
    gl.deleteVertexArray(this.quad);
    gl.deleteProgram(this.layerProgram.program);
    gl.deleteProgram(this.blurProgram.program);
  }

  private drawLayer(picture: Picture, model: Mat3, texture: Mat3, opacity: number, targetWidth: number, targetHeight: number): void {
    const { gl } = this;
    const { program, uniforms } = this.layerProgram;
    gl.useProgram(program);
    this.bindPicture(picture);
    gl.uniformMatrix3fv(uniforms.u_model!, false, model);
    gl.uniformMatrix3fv(uniforms.u_texture!, false, texture);
    gl.uniform2f(uniforms.u_target!, targetWidth, targetHeight);
    gl.uniform1f(uniforms.u_opacity!, opacity);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private drawCover(picture: Picture): void {
    const geometry = coverGeometry(picture, this.width, this.height);
    this.drawLayer(picture, geometry.model, geometry.texture, 1, this.width, this.height);
  }

  /**
   * Draws the picture small into an offscreen buffer, blurs it there and
   * scales it back up. Downscaling does most of the blurring for free, which
   * keeps this fast even at 4K.
   */
  private drawBlurred(picture: Picture, amount: number): void {
    const { gl } = this;
    const [a, b] = this.ensureBlurTargets();
    const geometry = coverGeometry(picture, a.width, a.height);

    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, a.framebuffer);
    gl.viewport(0, 0, a.width, a.height);
    this.drawLayer(picture, geometry.model, geometry.texture, 1, a.width, a.height);

    const passes = 1 + Math.round(Math.max(0, Math.min(1, amount)) * 5);
    const full = fullTargetModel(a.width, a.height);
    for (let pass = 0; pass < passes; pass++) {
      this.blurPass(a, b, [1 / a.width, 0], full);
      this.blurPass(b, a, [0, 1 / a.height], full);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.layerProgram.program);
    gl.bindTexture(gl.TEXTURE_2D, a.texture);
    const { uniforms } = this.layerProgram;
    gl.uniformMatrix3fv(uniforms.u_model!, false, fullTargetModel(this.width, this.height));
    gl.uniformMatrix3fv(uniforms.u_texture!, false, FLIP_V);
    gl.uniform2f(uniforms.u_target!, this.width, this.height);
    gl.uniform1f(uniforms.u_opacity!, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.enable(gl.BLEND);
  }

  private blurPass(from: Target, to: Target, step: [number, number], model: Mat3): void {
    const { gl } = this;
    const { program, uniforms } = this.blurProgram;
    gl.bindFramebuffer(gl.FRAMEBUFFER, to.framebuffer);
    gl.useProgram(program);
    gl.bindTexture(gl.TEXTURE_2D, from.texture);
    gl.uniformMatrix3fv(uniforms.u_model!, false, model);
    gl.uniformMatrix3fv(uniforms.u_texture!, false, IDENTITY);
    gl.uniform2f(uniforms.u_target!, to.width, to.height);
    gl.uniform2f(uniforms.u_step!, step[0], step[1]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Binds the picture's texture, uploading it only when it isn't already on the GPU. */
  private bindPicture(picture: Picture): void {
    const { gl } = this;
    if (!picture.cacheKey) {
      gl.bindTexture(gl.TEXTURE_2D, this.streamTexture);
      upload(gl, picture.source);
      return;
    }
    let cached = this.cache.get(picture.cacheKey);
    if (!cached) {
      cached = { texture: createTexture(gl, true), source: picture.source };
      this.cache.set(picture.cacheKey, cached);
      gl.bindTexture(gl.TEXTURE_2D, cached.texture);
      upload(gl, picture.source);
      return;
    }
    gl.bindTexture(gl.TEXTURE_2D, cached.texture);
    if (cached.source !== picture.source) {
      cached.source = picture.source;
      upload(gl, picture.source);
    }
  }

  private ensureBlurTargets(): [Target, Target] {
    if (this.blurTargets) return this.blurTargets;
    // An eighth of the canvas on the long edge, which the blur then smooths.
    const scale = 240 / Math.max(this.width, this.height);
    const width = Math.max(8, Math.round(this.width * scale));
    const height = Math.max(8, Math.round(this.height * scale));
    this.blurTargets = [createTarget(this.gl, width, height), createTarget(this.gl, width, height)];
    return this.blurTargets;
  }

  private releaseBlurTargets(): void {
    if (!this.blurTargets) return;
    for (const target of this.blurTargets) {
      this.gl.deleteFramebuffer(target.framebuffer);
      this.gl.deleteTexture(target.texture);
    }
    this.blurTargets = null;
  }
}

function coverGeometry(picture: Picture, width: number, height: number) {
  return layerGeometry({
    displayWidth: picture.displayWidth,
    displayHeight: picture.displayHeight,
    rotation: picture.rotation,
    flip: picture.flip,
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    canvasWidth: width,
    canvasHeight: height,
    transform: {
      x: 0,
      y: 0,
      scale: coverScale(picture.displayWidth, picture.displayHeight, width, height),
      rotation: 0,
      opacity: 1,
      flipX: false,
      flipY: false,
    },
  });
}

/** Model matrix for a quad covering a whole target of the given size. */
function fullTargetModel(width: number, height: number): Mat3 {
  return new Float32Array([width, 0, 0, 0, height, 0, 0, 0, 1]);
}

function upload(gl: WebGL2RenderingContext, source: VideoFrame | ImageBitmap): void {
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  // Mipmaps keep 4K footage from shimmering when it's drawn much smaller.
  gl.generateMipmap(gl.TEXTURE_2D);
}

function createTexture(gl: WebGL2RenderingContext, mipmapped: boolean): WebGLTexture {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmapped ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function createTarget(gl: WebGL2RenderingContext, width: number, height: number): Target {
  const texture = createTexture(gl, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { framebuffer, texture, width, height };
}

function compileShader(gl: WebGL2RenderingContext, type: GLenum, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Couldn't create a WebGL shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader failed to compile: ${log}`);
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string, uniformNames: string[]): Program {
  const program = gl.createProgram();
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertex);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  // Both programs share one vertex array, so pin the attribute to slot 0.
  gl.bindAttribLocation(program, 0, "a_corner");
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Shader program failed to link: ${log}`);
  }
  const uniforms: Record<string, WebGLUniformLocation> = {};
  for (const name of uniformNames) {
    const location = gl.getUniformLocation(program, name);
    if (!location) throw new Error(`Shader uniform ${name} is missing.`);
    uniforms[name] = location;
  }
  return { program, uniforms };
}

function createUnitQuad(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return vao;
}
