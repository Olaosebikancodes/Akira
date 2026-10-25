/** A linked shader program and its uniforms, looked up on first use. */
export class Program {
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly program: WebGLProgram,
  ) {}

  use(): this {
    this.gl.useProgram(this.program);
    return this;
  }

  /** A uniform's location, or null if the shader optimised it away. */
  location(name: string): WebGLUniformLocation | null {
    if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    return this.uniforms.get(name)!;
  }

  float(name: string, value: number): this {
    this.gl.uniform1f(this.location(name), value);
    return this;
  }

  int(name: string, value: number): this {
    this.gl.uniform1i(this.location(name), value);
    return this;
  }

  vec2(name: string, x: number, y: number): this {
    this.gl.uniform2f(this.location(name), x, y);
    return this;
  }

  vec3(name: string, value: readonly number[]): this {
    this.gl.uniform3f(this.location(name), value[0]!, value[1]!, value[2]!);
    return this;
  }

  vec4(name: string, x: number, y: number, z: number, w: number): this {
    this.gl.uniform4f(this.location(name), x, y, z, w);
    return this;
  }

  mat3(name: string, value: Float32Array): this {
    this.gl.uniformMatrix3fv(this.location(name), false, value);
    return this;
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
  }
}

export function linkProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): Program {
  const program = gl.createProgram();
  const vertexShader = compile(gl, gl.VERTEX_SHADER, vertex);
  const fragmentShader = compile(gl, gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  // Every program shares one vertex array, so pin the attribute to slot 0.
  gl.bindAttribLocation(program, 0, "a_corner");
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Shader program failed to link: ${log}`);
  }
  return new Program(gl, program);
}

function compile(gl: WebGL2RenderingContext, type: GLenum, source: string): WebGLShader {
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

export function createTexture(gl: WebGL2RenderingContext, mipmapped: boolean): WebGLTexture {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmapped ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

/**
 * A texture that can be drawn into. Every target stores its picture with
 * row 0 at the top, the same way uploaded images are, so passes never have
 * to think about flipping; only the final present to the screen flips.
 */
export interface Target {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

export function createTarget(gl: WebGL2RenderingContext, width: number, height: number): Target {
  const texture = createTexture(gl, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { framebuffer, texture, width, height };
}

export function deleteTarget(gl: WebGL2RenderingContext, target: Target): void {
  gl.deleteFramebuffer(target.framebuffer);
  gl.deleteTexture(target.texture);
}

/**
 * Hands out scratch targets by size and takes them all back at the end of
 * each frame, so per-layer processing doesn't allocate textures every frame.
 */
export class TargetPool {
  private readonly free = new Map<string, Target[]>();
  private readonly lent: Target[] = [];

  constructor(private readonly gl: WebGL2RenderingContext) {}

  acquire(width: number, height: number): Target {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const target = this.free.get(`${w}x${h}`)?.pop() ?? createTarget(this.gl, w, h);
    this.lent.push(target);
    return target;
  }

  /** Returns every target handed out this frame. */
  releaseAll(): void {
    for (const target of this.lent.splice(0)) {
      const key = `${target.width}x${target.height}`;
      const list = this.free.get(key) ?? [];
      list.push(target);
      this.free.set(key, list);
    }
  }

  /** Frees everything, e.g. when the canvas changes size. */
  clear(): void {
    this.releaseAll();
    for (const list of this.free.values()) for (const target of list) deleteTarget(this.gl, target);
    this.free.clear();
  }
}
