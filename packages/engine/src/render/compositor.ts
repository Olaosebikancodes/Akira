import type { Adjustments, BlendMode, Crop, EffectKind, Mask, MaskShape } from "../project/model";
import type { Rgb } from "./color";
import type { CubeLut } from "./cube-lut";
import { coverScale, layerGeometry, type Mat3 } from "./geometry";
import { createTarget, createTexture, deleteTarget, linkProgram, type Program, type Target, TargetPool } from "./gl";
import { type Rotation, textureTransform } from "./orientation";
import {
  BLUR,
  COPY,
  DEBAND,
  DEBLOCK,
  DENOISE,
  EFFECT,
  FSR_EASU,
  FSR_RCAS,
  GRADE,
  LAYER,
  transitionShader,
  VERTEX,
} from "./shaders";
import type { TransitionDefinition } from "./transitions/types";

/** A decoded picture and the orientation stored with it. */
export interface Picture {
  source: VideoFrame | ImageBitmap | OffscreenCanvas;
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
  /** For frame blending: the following frame, mixed in by `amount` (0 to 1). Same size and orientation. */
  next?: { source: VideoFrame; amount: number };
}

/** Colour work done in one pass: auto colour, adjustments, a LUT and a chroma key. */
export interface Grade {
  /** Per-channel black and white points; [0, 0, 0] and [1, 1, 1] leave colour alone. */
  black: readonly [number, number, number];
  white: readonly [number, number, number];
  adjust: Adjustments;
  lut: { cacheKey: string; lut: CubeLut; intensity: number } | null;
  key: { color: Rgb; tolerance: number; softness: number; spill: number } | null;
}

/** Work done on a layer's own pixels before it's placed on the canvas. */
export interface LayerProcessing {
  denoise: number;
  deband: number;
  deblock: number;
  grade: Grade | null;
  /** Shader effects in order; shake moves the layer instead, so it isn't one. */
  effects: readonly { kind: Exclude<EffectKind, "shake">; amount: number }[];
  sharpen: number;
  upscale: boolean;
  /** Seconds into the clip, for effects that move. */
  time: number;
  /** Varies random effects between clips. */
  seed: number;
}

export interface Layer {
  picture: Picture;
  /** From `layerGeometry`: unit square to canvas pixels, and to texture coordinates. */
  model: Mat3;
  texture: Mat3;
  crop: Crop;
  opacity: number;
  processing: LayerProcessing | null;
  mask: Mask | null;
  blend: BlendMode;
}

/** Two layers mid-transition, drawn as one. */
export interface TransitionLayer {
  kind: "transition";
  from: Layer;
  to: Layer;
  definition: TransitionDefinition;
  /** 0 to 1 across the transition. */
  progress: number;
}

export type RenderItem = Layer | TransitionLayer;

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

const IDENTITY: Mat3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
/** Processing that changes nothing, for layers that only need frame blending. */
const NO_PROCESSING: LayerProcessing = {
  denoise: 0,
  deband: 0,
  deblock: 0,
  grade: null,
  effects: [],
  sharpen: 0,
  upscale: false,
  time: 0,
  seed: 0,
};
/** Processing never works on more pixels than this per side. */
const MAX_WORKING_SIZE = 4096;
/** Texture units: pictures on 0, what's beneath a blended layer on 1, LUTs on 2. */
const DESTINATION_UNIT = 1;
const LUT_UNIT = 2;

const MASK_SHAPES: Record<MaskShape, number> = { linear: 1, mirror: 2, circle: 3, rectangle: 4, heart: 5, star: 6 };
const BLEND_MODES: Record<BlendMode, number> = {
  normal: 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  darken: 4,
  lighten: 5,
  "color-dodge": 6,
  "color-burn": 7,
  "hard-light": 8,
  "soft-light": 9,
  difference: 10,
  exclusion: 11,
  add: 12,
};
const EFFECTS: Record<Exclude<EffectKind, "shake" | "blur">, number> = { glitch: 1, vhs: 2, grain: 3, flash: 4 };

const PROGRAMS = {
  copy: COPY,
  layer: LAYER,
  grade: GRADE,
  blur: BLUR,
  effect: EFFECT,
  denoise: DENOISE,
  deband: DEBAND,
  deblock: DEBLOCK,
  easu: FSR_EASU,
  rcas: FSR_RCAS,
};
type ProgramName = keyof typeof PROGRAMS;

const FALLBACK_TRANSITION = "vec4 transition(vec2 uv) { return mix(getFromColor(uv), getToColor(uv), progress); }";

interface CachedTexture {
  texture: WebGLTexture;
  source: Picture["source"];
}

/**
 * Draws pictures onto a canvas with WebGL2. Preview and export both render
 * through this class, so what the user sees is exactly what gets encoded.
 *
 * The frame is built in an offscreen buffer and copied to the canvas at the
 * end, which lets blend modes read what's beneath a layer. Layers with
 * processing (grading, effects, Enhance) are first drawn upright into
 * scratch textures and run through their passes there.
 */
export class Compositor {
  private readonly gl: WebGL2RenderingContext;
  private readonly programs = new Map<string, Program>();
  private readonly quad: WebGLVertexArrayObject;
  private readonly streamTexture: WebGLTexture;
  /** The second frame of a blended pair streams through here. */
  private readonly nextTexture: WebGLTexture;
  private readonly emptyLut: WebGLTexture;
  private readonly cache = new Map<string, CachedTexture>();
  private readonly luts = new Map<string, WebGLTexture>();
  private readonly pool: TargetPool;
  private frame: Target | null = null;

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
    this.quad = createUnitQuad(gl);
    this.streamTexture = createTexture(gl, true);
    this.nextTexture = createTexture(gl, true);
    this.emptyLut = createLutTexture(gl, 2, new Float32Array(2 * 2 * 2 * 3));
    this.pool = new TargetPool(gl);
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
    if (this.frame) deleteTarget(this.gl, this.frame);
    this.frame = null;
    this.pool.clear();
  }

  /** Fills the background, draws the items bottom to top, then shows the result. */
  render(background: BackgroundFill, items: readonly RenderItem[]): void {
    const { gl } = this;
    gl.bindVertexArray(this.quad);
    this.frame ??= createTarget(gl, this.width, this.height);
    const frame = this.frame;

    this.bindTarget(frame);
    const clear = background.kind === "color" ? background.color : [0, 0, 0];
    gl.clearColor(clear[0]!, clear[1]!, clear[2]!, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (background.kind === "picture") this.drawCover(background.picture, frame, true);
    if (background.kind === "blur") this.drawBlurred(background.picture, background.amount, frame);

    for (const item of items) {
      if ("kind" in item) this.drawTransition(item, frame);
      else this.drawLayer(item, frame);
    }

    // Copy the finished frame to the canvas, flipping it the right way up.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.BLEND);
    this.drawTexture(frame.texture, fullTarget(this.width, this.height), IDENTITY, this.width, this.height, -1);
    gl.bindVertexArray(null);
    this.pool.releaseAll();
  }

  /** Frees the texture kept for a still, sticker or LUT that's no longer used. */
  release(cacheKey: string): void {
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.gl.deleteTexture(cached.texture);
      this.cache.delete(cacheKey);
    }
    const lut = this.luts.get(cacheKey);
    if (lut) {
      this.gl.deleteTexture(lut);
      this.luts.delete(cacheKey);
    }
  }

  dispose(): void {
    const { gl } = this;
    for (const key of [...this.cache.keys(), ...this.luts.keys()]) this.release(key);
    this.pool.clear();
    if (this.frame) deleteTarget(gl, this.frame);
    for (const program of new Set(this.programs.values())) program.dispose();
    gl.deleteTexture(this.streamTexture);
    gl.deleteTexture(this.nextTexture);
    gl.deleteTexture(this.emptyLut);
    gl.deleteVertexArray(this.quad);
    // Browsers allow only a handful of live contexts, so give this one back now.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  private drawLayer(layer: Layer, target: Target): void {
    const { gl } = this;
    const processed = this.process(layer);
    const blend = BLEND_MODES[layer.blend];
    this.bindTarget(target);

    if (blend === 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      // Blend modes need what's beneath, so copy it aside for the shader to read.
      const beneath = this.pool.acquire(target.width, target.height);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, beneath.framebuffer);
      gl.blitFramebuffer(0, 0, target.width, target.height, 0, 0, target.width, target.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      this.bindTarget(target);
      gl.activeTexture(gl.TEXTURE0 + DESTINATION_UNIT);
      gl.bindTexture(gl.TEXTURE_2D, beneath.texture);
      gl.disable(gl.BLEND);
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, processed.texture);
    const program = this.program("layer").use().int("u_image", 0).int("u_destination", DESTINATION_UNIT);
    setGeometry(program, layer.model, processed.matrix, target.width, target.height, 1);
    const { crop, mask } = layer;
    program
      .float("u_opacity", layer.opacity)
      .vec4("u_crop", crop.left, crop.top, 1 - crop.left - crop.right, 1 - crop.top - crop.bottom)
      .float("u_aspect", layer.picture.displayWidth / layer.picture.displayHeight)
      .int("u_blend", blend)
      .int("u_maskShape", mask ? MASK_SHAPES[mask.shape] : 0);
    if (mask) {
      program
        .vec2("u_maskCenter", 0.5 + mask.x, 0.5 + mask.y)
        .vec2("u_maskSize", mask.width, mask.height)
        .float("u_maskRotation", (mask.rotation * Math.PI) / 180)
        .float("u_maskFeather", mask.feather)
        .int("u_maskInvert", mask.invert ? 1 : 0);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // A texture left bound where a shader reads it can't also be drawn into, so unbind it.
    gl.activeTexture(gl.TEXTURE0 + DESTINATION_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Draws both sides into their own transparent frames, then mixes them with the transition's shader. */
  private drawTransition(item: TransitionLayer, target: Target): void {
    const { gl } = this;
    const sides = [item.from, item.to].map((layer) => {
      const side = this.pool.acquire(target.width, target.height);
      this.bindTarget(side);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      // Blend modes need an opaque frame beneath, so each side draws normally.
      this.drawLayer({ ...layer, blend: "normal" }, side);
      return side;
    });

    const program = this.transitionProgram(item.definition);
    this.bindTarget(target);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sides[0]!.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, sides[1]!.texture);
    program.use().int("u_from", 0).int("u_to", 1);
    setGeometry(program, fullTarget(target.width, target.height), IDENTITY, target.width, target.height, 1);
    program.float("progress", item.progress).float("ratio", target.width / target.height);
    for (const [name, param] of Object.entries(item.definition.params)) setParam(gl, program, name, param);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
  }

  /**
   * Runs a layer's processing, returning the texture to draw and how the
   * layer's unit square maps onto it. Layers without processing draw
   * straight from their source.
   */
  private process(layer: Layer): { texture: WebGLTexture; matrix: Mat3 } {
    const { gl } = this;
    const source = this.bindPicture(layer.picture);
    if (!layer.processing && !layer.picture.next) return { texture: source, matrix: layer.texture };
    const work = layer.processing ?? NO_PROCESSING;

    const { picture, crop } = layer;
    const visibleWidth = 1 - crop.left - crop.right;
    const visibleHeight = 1 - crop.top - crop.bottom;
    // On-canvas size of the whole picture, crop included.
    const drawnWidth = Math.hypot(layer.model[0]!, layer.model[1]!) / visibleWidth;
    const drawnHeight = Math.hypot(layer.model[3]!, layer.model[4]!) / visibleHeight;

    // Work at the size the layer is shown, or its own size if that's smaller.
    // Upscaling and deblocking need every source pixel, so they work at full size.
    const scale = work.upscale || work.deblock > 0 ? 1 : Math.min(1, drawnWidth / picture.displayWidth);
    let width = clampSize(picture.displayWidth * scale);
    let height = clampSize(picture.displayHeight * scale);

    // Turn the picture upright first, so scanlines and grain run the right way.
    let current = this.pool.acquire(width, height);
    this.bindTarget(current);
    gl.disable(gl.BLEND);
    const upright = textureTransform(picture.rotation, picture.flip);
    this.drawTexture(source, fullTarget(width, height), upright, width, height, 1);
    if (picture.next) {
      // Frame blending: lay the next frame over this one, `amount` of the way in.
      gl.bindTexture(gl.TEXTURE_2D, this.nextTexture);
      upload(gl, picture.next.source);
      gl.enable(gl.BLEND);
      gl.blendColor(0, 0, 0, picture.next.amount);
      gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
      this.drawTexture(this.nextTexture, fullTarget(width, height), upright, width, height, 1);
      gl.disable(gl.BLEND);
    }

    const pass = (name: ProgramName, setup: (program: Program) => void, outWidth = width, outHeight = height) => {
      const next = this.pool.acquire(outWidth, outHeight);
      this.bindTarget(next);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, current.texture);
      const program = this.program(name).use().int("u_image", 0);
      setGeometry(program, fullTarget(outWidth, outHeight), IDENTITY, outWidth, outHeight, 1);
      setup(program);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      current = next;
    };

    // Clean up first, so grading and sharpening don't exaggerate noise and blocks.
    if (work.denoise > 0) pass("denoise", (p) => p.vec2("u_texel", 1 / width, 1 / height).float("u_strength", work.denoise));
    if (work.deblock > 0) pass("deblock", (p) => p.vec2("u_size", width, height).float("u_strength", work.deblock));
    if (work.deband > 0) pass("deband", (p) => p.vec2("u_texel", 1 / width, 1 / height).float("u_strength", work.deband));
    if (work.grade) this.bindLut(work.grade);
    if (work.grade) pass("grade", (p) => setGrade(p, work.grade!));

    for (const effect of work.effects) {
      if (effect.amount <= 0) continue;
      if (effect.kind === "blur") {
        // Repeated small Gaussians, scaled to the picture so blur looks the same at any size.
        const radius = (effect.amount * Math.max(width, height)) / 120;
        const passes = Math.max(1, Math.ceil(radius / 3));
        const step = radius / passes;
        for (let i = 0; i < passes; i++) {
          pass("blur", (p) => p.vec2("u_step", step / width, 0));
          pass("blur", (p) => p.vec2("u_step", 0, step / height));
        }
        continue;
      }
      const shader = EFFECTS[effect.kind];
      pass("effect", (p) =>
        p
          .int("u_effect", shader)
          .float("u_amount", effect.amount)
          .float("u_time", work.time)
          .float("u_seed", work.seed)
          .vec2("u_size", width, height),
      );
    }

    // FSR only upscales when the layer is shown bigger than its own pixels.
    const upscaleWidth = clampSize(drawnWidth);
    const upscaleHeight = clampSize(drawnHeight);
    if (work.upscale && upscaleWidth > width * 1.05) {
      const [inWidth, inHeight] = [width, height];
      pass(
        "easu",
        (p) =>
          p
            .vec4(
              "u_con0",
              inWidth / upscaleWidth,
              inHeight / upscaleHeight,
              (0.5 * inWidth) / upscaleWidth - 0.5,
              (0.5 * inHeight) / upscaleHeight - 0.5,
            )
            .vec2("u_inputSize", inWidth, inHeight),
        upscaleWidth,
        upscaleHeight,
      );
      width = upscaleWidth;
      height = upscaleHeight;
      // FSR pairs its upscaler with a light sharpen even when none is asked for.
      pass("rcas", (p) => p.float("u_sharpness", sharpness(Math.max(work.sharpen, 0.6))).vec2("u_size", width, height));
    } else if (work.sharpen > 0) {
      pass("rcas", (p) => p.float("u_sharpness", sharpness(work.sharpen)).vec2("u_size", width, height));
    }

    // The result is upright, so only the crop is left to apply.
    const cropOnly = new Float32Array([visibleWidth, 0, 0, 0, visibleHeight, 0, crop.left, crop.top, 1]);
    return { texture: current.texture, matrix: cropOnly };
  }

  private bindLut(grade: Grade): void {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0 + LUT_UNIT);
    gl.bindTexture(gl.TEXTURE_3D, grade.lut ? this.lutTexture(grade.lut.cacheKey, grade.lut.lut) : this.emptyLut);
    gl.activeTexture(gl.TEXTURE0);
  }

  private drawCover(picture: Picture, target: Target, blend: boolean): void {
    const { gl } = this;
    const geometry = coverGeometry(picture, target.width, target.height);
    this.bindTarget(target);
    if (blend) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.disable(gl.BLEND);
    }
    this.drawTexture(this.bindPicture(picture), geometry.model, geometry.texture, target.width, target.height, 1);
  }

  /**
   * Draws the picture small, blurs it there and scales it back up.
   * Downscaling does most of the blurring for free, which keeps this fast
   * even at 4K.
   */
  private drawBlurred(picture: Picture, amount: number, target: Target): void {
    const { gl } = this;
    // An eighth of the canvas on the long edge, which the blur then smooths.
    const scale = 240 / Math.max(target.width, target.height);
    const width = Math.max(8, Math.round(target.width * scale));
    const height = Math.max(8, Math.round(target.height * scale));
    let a = this.pool.acquire(width, height);
    let b = this.pool.acquire(width, height);
    this.drawCover(picture, a, false);

    const passes = 1 + Math.round(Math.max(0, Math.min(1, amount)) * 5);
    const program = this.program("blur");
    for (let i = 0; i < passes * 2; i++) {
      this.bindTarget(b);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, a.texture);
      const horizontal = i % 2 === 0;
      program.use().int("u_image", 0).vec2("u_step", horizontal ? 1 / width : 0, horizontal ? 0 : 1 / height);
      setGeometry(program, fullTarget(width, height), IDENTITY, width, height, 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      [a, b] = [b, a];
    }
    this.bindTarget(target);
    this.drawTexture(a.texture, fullTarget(target.width, target.height), IDENTITY, target.width, target.height, 1);
  }

  /** Draws a texture through the copy shader into whatever framebuffer is bound. */
  private drawTexture(texture: WebGLTexture, model: Mat3, matrix: Mat3, width: number, height: number, flipY: 1 | -1): void {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const program = this.program("copy").use().int("u_image", 0);
    setGeometry(program, model, matrix, width, height, flipY);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private bindTarget(target: Target): void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, target.framebuffer);
    this.gl.viewport(0, 0, target.width, target.height);
  }

  private program(name: ProgramName): Program {
    let program = this.programs.get(name);
    if (!program) {
      program = linkProgram(this.gl, VERTEX, PROGRAMS[name]);
      this.programs.set(name, program);
    }
    return program;
  }

  /** Compiles a transition on first use. One that won't compile becomes a plain fade. */
  private transitionProgram(definition: TransitionDefinition): Program {
    const key = `transition:${definition.name}`;
    let program = this.programs.get(key);
    if (program) return program;
    try {
      program = linkProgram(this.gl, VERTEX, transitionShader(definition.glsl));
    } catch (error) {
      console.warn(`The ${definition.label} transition didn't compile, so it fades instead.`, error);
      program = this.programs.get("transition:fallback") ?? linkProgram(this.gl, VERTEX, transitionShader(FALLBACK_TRANSITION));
      this.programs.set("transition:fallback", program);
    }
    this.programs.set(key, program);
    return program;
  }

  /** Binds the picture's texture to unit 0, uploading it only when it isn't already on the GPU. */
  private bindPicture(picture: Picture): WebGLTexture {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0);
    if (!picture.cacheKey) {
      gl.bindTexture(gl.TEXTURE_2D, this.streamTexture);
      upload(gl, picture.source);
      return this.streamTexture;
    }
    let cached = this.cache.get(picture.cacheKey);
    if (!cached) {
      cached = { texture: createTexture(gl, true), source: picture.source };
      this.cache.set(picture.cacheKey, cached);
      gl.bindTexture(gl.TEXTURE_2D, cached.texture);
      upload(gl, picture.source);
      return cached.texture;
    }
    gl.bindTexture(gl.TEXTURE_2D, cached.texture);
    if (cached.source !== picture.source) {
      cached.source = picture.source;
      upload(gl, picture.source);
    }
    return cached.texture;
  }

  private lutTexture(cacheKey: string, lut: CubeLut): WebGLTexture {
    let texture = this.luts.get(cacheKey);
    if (!texture) {
      texture = createLutTexture(this.gl, lut.size, lut.data);
      this.luts.set(cacheKey, texture);
    }
    return texture;
  }
}

function setGeometry(program: Program, model: Mat3, matrix: Mat3, width: number, height: number, flipY: 1 | -1): void {
  program.mat3("u_model", model).mat3("u_texture", matrix).vec2("u_target", width, height).float("u_flipY", flipY);
}

function setGrade(program: Program, grade: Grade): void {
  const { adjust, lut, key } = grade;
  program
    .int("u_lut", LUT_UNIT)
    .int("u_hasLut", lut ? 1 : 0)
    .float("u_lutIntensity", lut?.intensity ?? 0)
    .float("u_lutSize", lut?.lut.size ?? 2)
    .vec3("u_lutMin", lut?.lut.domainMin ?? [0, 0, 0])
    .vec3("u_lutMax", lut?.lut.domainMax ?? [1, 1, 1])
    .vec3("u_black", grade.black)
    .vec3("u_white", grade.white)
    .float("u_brightness", adjust.brightness)
    .float("u_contrast", adjust.contrast)
    .float("u_saturation", adjust.saturation)
    .float("u_exposure", adjust.exposure)
    .float("u_temperature", adjust.temperature)
    .float("u_tint", adjust.tint)
    .float("u_highlights", adjust.highlights)
    .float("u_shadows", adjust.shadows)
    .float("u_vignette", adjust.vignette)
    .int("u_key", key ? 1 : 0);
  if (key) {
    program
      .vec3("u_keyColor", key.color)
      .float("u_keyTolerance", key.tolerance)
      .float("u_keySoftness", key.softness)
      .float("u_keySpill", key.spill);
  }
}

/** RCAS takes sharpness in stops below its strongest; 0 to 1 here maps to 2 stops down to none. */
function sharpness(amount: number): number {
  return 2 ** (-(1 - amount) * 2);
}

function clampSize(size: number): number {
  return Math.min(MAX_WORKING_SIZE, Math.max(1, Math.round(size)));
}

function setParam(
  gl: WebGL2RenderingContext,
  program: Program,
  name: string,
  param: TransitionDefinition["params"][string],
): void {
  const location = program.location(name);
  if (!location) return;
  const { value } = param;
  if (typeof value === "boolean") gl.uniform1i(location, value ? 1 : 0);
  else if (typeof value === "number") {
    if (param.type === "int" || param.type === "bool") gl.uniform1i(location, value);
    else gl.uniform1f(location, value);
  } else if (param.type.startsWith("ivec")) {
    if (value.length === 2) gl.uniform2iv(location, value);
    else if (value.length === 3) gl.uniform3iv(location, value);
    else gl.uniform4iv(location, value);
  } else if (value.length === 2) gl.uniform2fv(location, value);
  else if (value.length === 3) gl.uniform3fv(location, value);
  else if (value.length === 4) gl.uniform4fv(location, value);
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
function fullTarget(width: number, height: number): Mat3 {
  return new Float32Array([width, 0, 0, 0, height, 0, 0, 0, 1]);
}

function upload(gl: WebGL2RenderingContext, source: Picture["source"]): void {
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  // Mipmaps keep 4K footage from shimmering when it's drawn much smaller.
  gl.generateMipmap(gl.TEXTURE_2D);
}

function createLutTexture(gl: WebGL2RenderingContext, size: number, data: Float32Array): WebGLTexture {
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + LUT_UNIT);
  gl.bindTexture(gl.TEXTURE_3D, texture);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  // 16-bit floats keep smooth gradients smooth where 8 bits would band.
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, size, size, size, 0, gl.RGB, gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  gl.activeTexture(gl.TEXTURE0);
  return texture;
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
