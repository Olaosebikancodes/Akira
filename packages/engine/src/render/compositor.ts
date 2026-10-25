import type { VideoSample } from "mediabunny";
import type { Rgb } from "./color";
import type { Rect } from "./fit";
import { textureTransform } from "./orientation";

export interface VideoLayer {
  sample: VideoSample;
  /** Where the displayed frame goes on the canvas, in canvas pixels. */
  rect: Rect;
}

export interface CompositorOptions {
  /**
   * Keep the last frame readable after drawing. Export needs this so the
   * encoder can capture the canvas; the live preview doesn't.
   */
  preserveDrawingBuffer?: boolean;
}

const VERTEX_SHADER = `#version 300 es
// Unit quad corner: (0, 0) is the top-left of the displayed frame.
in vec2 a_corner;
uniform vec4 u_rect;
uniform vec2 u_canvas;
uniform mat3 u_texture;
out vec2 v_texCoord;

void main() {
  vec2 pixel = u_rect.xy + a_corner * u_rect.zw;
  vec2 clipSpace = pixel / u_canvas * 2.0 - 1.0;
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_texCoord = (u_texture * vec3(a_corner, 1.0)).xy;
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_frame;
in vec2 v_texCoord;
out vec4 outColor;

void main() {
  outColor = texture(u_frame, v_texCoord);
}
`;

/**
 * Draws frames onto a canvas with WebGL2. Preview and export both render
 * through this class, so what the user sees is exactly what gets encoded.
 */
export class Compositor {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly texture: WebGLTexture;
  private readonly quad: WebGLVertexArrayObject;
  private readonly uniforms: {
    rect: WebGLUniformLocation;
    canvas: WebGLUniformLocation;
    texture: WebGLUniformLocation;
  };

  constructor(
    private readonly canvas: HTMLCanvasElement | OffscreenCanvas,
    options: CompositorOptions = {},
  ) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("WebGL2 isn't available in this browser.");
    this.gl = gl;

    this.program = linkProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    this.uniforms = {
      rect: uniform(gl, this.program, "u_rect"),
      canvas: uniform(gl, this.program, "u_canvas"),
      texture: uniform(gl, this.program, "u_texture"),
    };
    this.quad = createUnitQuad(gl, gl.getAttribLocation(this.program, "a_corner"));
    this.texture = createFrameTexture(gl);
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
  }

  /** Clears to `background` and draws the layers bottom to top. */
  render(background: Rgb, layers: readonly VideoLayer[]): void {
    const { gl } = this;
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(background[0], background[1], background[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);
    gl.bindVertexArray(this.quad);
    gl.uniform2f(this.uniforms.canvas, this.width, this.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);

    for (const layer of layers) this.drawLayer(layer);

    gl.bindVertexArray(null);
  }

  dispose(): void {
    const { gl } = this;
    gl.deleteTexture(this.texture);
    gl.deleteVertexArray(this.quad);
    gl.deleteProgram(this.program);
  }

  private drawLayer({ sample, rect }: VideoLayer): void {
    const { gl } = this;
    const frame = sample.toVideoFrame();
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    } finally {
      frame.close();
    }
    // Mipmaps keep 4K footage from shimmering when it's drawn much smaller.
    gl.generateMipmap(gl.TEXTURE_2D);

    gl.uniform4f(this.uniforms.rect, rect.x, rect.y, rect.width, rect.height);
    gl.uniformMatrix3fv(
      this.uniforms.texture,
      false,
      textureTransform(sample.rotation, sample.flip),
    );
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
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

function linkProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const program = gl.createProgram();
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertex);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Shader program failed to link: ${log}`);
  }
  return program;
}

function uniform(gl: WebGL2RenderingContext, program: WebGLProgram, name: string): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (!location) throw new Error(`Shader uniform ${name} is missing.`);
  return location;
}

function createUnitQuad(gl: WebGL2RenderingContext, attribute: number): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(attribute);
  gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return vao;
}

function createFrameTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}
