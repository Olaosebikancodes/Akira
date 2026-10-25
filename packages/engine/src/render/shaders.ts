/*
 * GLSL for the compositor. Every texture and render target keeps row 0 at
 * the top of the picture, so passes sample them directly; only drawing to
 * the screen flips (u_flipY = -1).
 */

export const VERTEX = `#version 300 es
in vec2 a_corner;
uniform mat3 u_model;   // unit square to target pixels
uniform mat3 u_texture; // unit square to texture coordinates
uniform vec2 u_target;  // target size in pixels
uniform float u_flipY;  // -1 when drawing to the screen, 1 into a render target
out vec2 v_texCoord;
out vec2 v_unit;        // position across the quad, 0 to 1

void main() {
  vec2 pixel = (u_model * vec3(a_corner, 1.0)).xy;
  vec2 clipSpace = pixel / u_target * 2.0 - 1.0;
  gl_Position = vec4(clipSpace.x, clipSpace.y * u_flipY, 0.0, 1.0);
  v_texCoord = (u_texture * vec3(a_corner, 1.0)).xy;
  v_unit = a_corner;
}
`;

export const COPY = `#version 300 es
precision highp float;
uniform sampler2D u_image;
in vec2 v_texCoord;
out vec4 outColor;

void main() {
  outColor = texture(u_image, v_texCoord);
}
`;

/** Shape masks as signed distances (negative inside), measured in picture heights. */
const MASK_FUNCTIONS = `
float dot2(vec2 v) { return dot(v, v); }

// Heart and star distances after Inigo Quilez, adapted to y pointing down.
float sdHeart(vec2 p) {
  p.x = abs(p.x);
  if (p.y + p.x > 1.0) return sqrt(dot2(p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
  return sqrt(min(dot2(p - vec2(0.0, 1.0)), dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}

float sdStar5(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}

float maskDistance(vec2 uv) {
  vec2 p = uv - u_maskCenter;
  p.x *= u_aspect;
  float c = cos(u_maskRotation);
  float s = sin(u_maskRotation);
  p = vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
  vec2 halfSize = u_maskSize * 0.5;
  if (u_maskShape == 1) return -p.y;
  if (u_maskShape == 2) return abs(p.y) - halfSize.y;
  if (u_maskShape == 3) return (length(p / halfSize) - 1.0) * min(halfSize.x, halfSize.y);
  if (u_maskShape == 4) {
    vec2 d = abs(p) - halfSize;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  }
  if (u_maskShape == 5) {
    float scale = min(halfSize.x, halfSize.y) * 1.8;
    return sdHeart(vec2(p.x, -p.y) / scale + vec2(0.0, 0.5)) * scale;
  }
  if (u_maskShape == 6) return sdStar5(vec2(p.x, -p.y), min(halfSize.x, halfSize.y), 0.45);
  return -1.0;
}
`;

/** W3C compositing formulas on unpremultiplied colour; d is what's beneath, s the layer. */
const BLEND_FUNCTIONS = `
vec3 blendSoftLight(vec3 d, vec3 s) {
  vec3 dd = mix(sqrt(d), ((16.0 * d - 12.0) * d + 4.0) * d, step(d, vec3(0.25)));
  return mix(d + (2.0 * s - 1.0) * (dd - d), d - (1.0 - 2.0 * s) * d * (1.0 - d), step(s, vec3(0.5)));
}

vec3 blendHardLight(vec3 d, vec3 s) {
  return mix(d + (2.0 * s - 1.0) - d * (2.0 * s - 1.0), d * 2.0 * s, step(s, vec3(0.5)));
}

vec3 blendColors(vec3 d, vec3 s) {
  if (u_blend == 1) return d * s;
  if (u_blend == 2) return d + s - d * s;
  if (u_blend == 3) return blendHardLight(s, d);
  if (u_blend == 4) return min(d, s);
  if (u_blend == 5) return max(d, s);
  if (u_blend == 6) return mix(min(vec3(1.0), d / max(1.0 - s, vec3(1e-4))), vec3(1.0), step(1.0, s)) * step(1e-4, d);
  if (u_blend == 7) return mix(vec3(1.0) - min(vec3(1.0), (1.0 - d) / max(s, vec3(1e-4))), vec3(1.0), step(1.0, d));
  if (u_blend == 8) return blendHardLight(d, s);
  if (u_blend == 9) return blendSoftLight(d, s);
  if (u_blend == 10) return abs(d - s);
  if (u_blend == 11) return d + s - 2.0 * d * s;
  if (u_blend == 12) return min(vec3(1.0), d + s);
  return s;
}
`;

/** Draws a finished layer: opacity, mask, then normal or computed blending. */
export const LAYER = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform sampler2D u_destination;
uniform float u_opacity;
uniform vec4 u_crop;          // left, top, visible width, visible height of the picture
uniform float u_aspect;       // picture width / height
uniform int u_maskShape;      // 0 for no mask
uniform vec2 u_maskCenter;    // in picture coordinates, 0 to 1
uniform vec2 u_maskSize;      // fractions of picture height, so equal values make a circle
uniform float u_maskRotation; // radians
uniform float u_maskFeather;
uniform bool u_maskInvert;
uniform int u_blend;          // 0 is normal, done by the GPU's blending
in vec2 v_texCoord;
in vec2 v_unit;
out vec4 outColor;
${MASK_FUNCTIONS}
${BLEND_FUNCTIONS}
void main() {
  vec4 color = texture(u_image, v_texCoord) * u_opacity;
  if (u_maskShape != 0) {
    vec2 uv = u_crop.xy + v_unit * u_crop.zw;
    float feather = max(u_maskFeather * 0.25, 0.0015);
    float inside = 1.0 - smoothstep(-feather, feather, maskDistance(uv));
    color *= u_maskInvert ? 1.0 - inside : inside;
  }
  if (u_blend == 0) {
    outColor = color;
    return;
  }
  vec3 d = texelFetch(u_destination, ivec2(gl_FragCoord.xy), 0).rgb;
  vec3 s = color.a > 0.0 ? color.rgb / color.a : vec3(0.0);
  outColor = vec4(mix(d, blendColors(d, s), color.a), 1.0);
}
`;

/** Auto colour, adjustments, LUT, vignette and chroma key in one pass. */
export const GRADE = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D u_image;
uniform sampler3D u_lut;
uniform bool u_hasLut;
uniform float u_lutIntensity;
uniform float u_lutSize;
uniform vec3 u_lutMin;
uniform vec3 u_lutMax;
uniform vec3 u_black;
uniform vec3 u_white;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_exposure;
uniform float u_temperature;
uniform float u_tint;
uniform float u_highlights;
uniform float u_shadows;
uniform float u_vignette;
uniform bool u_key;
uniform vec3 u_keyColor;
uniform float u_keyTolerance;
uniform float u_keySoftness;
uniform float u_keySpill;
in vec2 v_texCoord;
out vec4 outColor;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// BT.709 colour difference: hue and saturation without brightness, so a
// green screen keys the same in light and shadow.
vec2 chroma(vec3 c) {
  return vec2(-0.1146 * c.r - 0.3854 * c.g + 0.5 * c.b, 0.5 * c.r - 0.4542 * c.g - 0.0458 * c.b);
}

void main() {
  vec4 texel = texture(u_image, v_texCoord);
  if (texel.a <= 0.0) {
    outColor = vec4(0.0);
    return;
  }
  vec3 original = texel.rgb / texel.a;
  vec3 c = (original - u_black) / max(u_white - u_black, vec3(1e-4));
  c *= exp2(u_exposure * 2.0);
  c *= vec3(1.0 + u_temperature * 0.25, 1.0 + u_tint * 0.2, 1.0 - u_temperature * 0.25);
  float l = luma(c);
  c += u_shadows * 0.4 * (1.0 - smoothstep(0.0, 0.55, l));
  c += u_highlights * 0.4 * smoothstep(0.45, 1.0, l);
  c += u_brightness * 0.3;
  c = (c - 0.5) * (1.0 + u_contrast) + 0.5;
  c = mix(vec3(luma(c)), c, 1.0 + u_saturation);
  c = clamp(c, 0.0, 1.0);
  if (u_hasLut) {
    vec3 n = clamp((c - u_lutMin) / (u_lutMax - u_lutMin), 0.0, 1.0);
    c = mix(c, texture(u_lut, n * ((u_lutSize - 1.0) / u_lutSize) + 0.5 / u_lutSize).rgb, u_lutIntensity);
  }
  float alpha = texel.a;
  if (u_key) {
    // Key on the footage's own colours, before any grading changed them.
    float d = distance(chroma(original), chroma(u_keyColor));
    float t = u_keyTolerance * 0.3;
    alpha *= smoothstep(t, t + u_keySoftness * 0.2 + 0.002, d);
    float spill = u_keySpill * (1.0 - smoothstep(t, t + 0.15, d));
    c = mix(c, vec3(luma(c)), spill);
  }
  float edge = distance(v_texCoord, vec2(0.5)) * 1.4142;
  c *= 1.0 - u_vignette * smoothstep(0.4, 1.0, edge);
  outColor = vec4(clamp(c, 0.0, 1.0) * alpha, alpha);
}
`;

/** 9-tap Gaussian folded into 5 bilinear samples, along u_step. */
export const BLUR = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_step;
in vec2 v_texCoord;
out vec4 outColor;

void main() {
  vec4 sum = texture(u_image, v_texCoord) * 0.2270270270;
  sum += texture(u_image, v_texCoord + u_step * 1.3846153846) * 0.3162162162;
  sum += texture(u_image, v_texCoord - u_step * 1.3846153846) * 0.3162162162;
  sum += texture(u_image, v_texCoord + u_step * 3.2307692308) * 0.0702702703;
  sum += texture(u_image, v_texCoord - u_step * 3.2307692308) * 0.0702702703;
  outColor = sum;
}
`;

/** Glitch, VHS, film grain and flash. Shake moves the layer instead, so it isn't here. */
export const EFFECT = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform int u_effect;   // 1 glitch, 2 VHS, 3 grain, 4 flash
uniform float u_amount;
uniform float u_time;   // seconds into the clip
uniform float u_seed;
uniform vec2 u_size;    // pixels
in vec2 v_texCoord;
out vec4 outColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + u_seed) * 43758.5453);
}

void main() {
  vec2 uv = v_texCoord;
  if (u_effect == 1) {
    // Horizontal slices jump sideways a few times a second, with the colour channels split.
    float row = floor(uv.y * 24.0);
    float tick = floor(u_time * 12.0);
    if (hash(vec2(row, tick)) < 0.15 + 0.35 * u_amount) uv.x += (hash(vec2(tick, row)) - 0.5) * 0.12 * u_amount;
    vec2 split = vec2(0.012 * u_amount * (0.5 + hash(vec2(tick))), 0.0);
    vec4 base = texture(u_image, uv);
    outColor = vec4(texture(u_image, uv + split).r, base.g, texture(u_image, uv - split).b, base.a);
    return;
  }
  if (u_effect == 2) {
    // Tape wobble, bleeding colour, scanlines and noise.
    uv.x += sin(uv.y * 240.0 + u_time * 6.0) * 0.0015 * u_amount;
    vec2 bleed = vec2(0.004 * u_amount, 0.0);
    vec4 base = texture(u_image, uv);
    vec3 c = vec3(texture(u_image, uv + bleed).r, base.g, texture(u_image, uv - bleed).b);
    c *= 1.0 - u_amount * 0.18 * (0.5 + 0.5 * sin(uv.y * u_size.y * 3.14159));
    c += (hash(floor(uv * u_size) + fract(u_time) * 97.0) - 0.5) * 0.12 * u_amount * base.a;
    c = mix(c, vec3(dot(c, vec3(0.3, 0.59, 0.11))) * vec3(1.06, 1.0, 0.92), 0.25 * u_amount);
    outColor = vec4(clamp(c, 0.0, base.a), base.a);
    return;
  }
  vec4 color = texture(u_image, uv);
  if (u_effect == 3) {
    float grain = hash(floor(uv * u_size) + floor(u_time * 24.0) * 17.0) - 0.5;
    color.rgb = clamp(color.rgb + grain * 0.25 * u_amount * color.a, 0.0, color.a);
  } else if (u_effect == 4) {
    float pulse = pow(max(0.0, sin(u_time * 6.2831853 * 1.5)), 8.0);
    color.rgb = mix(color.rgb, vec3(color.a), pulse * u_amount * 0.8);
  }
  outColor = color;
}
`;

/** Edge-preserving noise reduction: a 5×5 bilateral filter. */
export const DENOISE = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_texel;
uniform float u_strength;
in vec2 v_texCoord;
out vec4 outColor;

void main() {
  vec4 center = texture(u_image, v_texCoord);
  // Neighbours that differ by more than this barely count, so edges stay sharp.
  float sigma = 0.02 + u_strength * 0.12;
  vec4 sum = vec4(0.0);
  float weight = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec4 s = texture(u_image, v_texCoord + vec2(x, y) * u_texel);
      vec3 diff = s.rgb - center.rgb;
      float w = exp(-float(x * x + y * y) / 4.5) * exp(-dot(diff, diff) / (2.0 * sigma * sigma));
      sum += s * w;
      weight += w;
    }
  }
  outColor = sum / weight;
}
`;

/** Smooths banding: where nearby colours barely differ, average them, then add a whisper of noise. */
export const DEBAND = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_texel;
uniform float u_strength;
in vec2 v_texCoord;
out vec4 outColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec4 c = texture(u_image, v_texCoord);
  float radius = 4.0 + 12.0 * u_strength;
  float threshold = 0.006 + 0.02 * u_strength;
  float angle = hash(v_texCoord) * 6.2831853;
  vec2 o = vec2(cos(angle), sin(angle)) * (0.5 + 0.5 * hash(v_texCoord.yx)) * radius * u_texel;
  vec4 average = (texture(u_image, v_texCoord + o) + texture(u_image, v_texCoord - o)
    + texture(u_image, v_texCoord + vec2(-o.y, o.x)) + texture(u_image, v_texCoord + vec2(o.y, -o.x))) * 0.25;
  vec4 result = mix(c, average, vec4(lessThan(abs(average - c), vec4(threshold))));
  result.rgb += (hash(v_texCoord * 917.0) - 0.5) / 255.0 * result.a;
  outColor = result;
}
`;

/** Softens the edges of the 8×8 blocks heavy compression leaves, where the step across is small. */
export const DEBLOCK = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_size;
uniform float u_strength;
in vec2 v_texCoord;
out vec4 outColor;

void main() {
  vec4 c = texture(u_image, v_texCoord);
  vec2 inBlock = mod(floor(v_texCoord * u_size), 8.0);
  float threshold = 0.02 + 0.08 * u_strength;
  vec4 result = c;
  if (inBlock.x == 0.0 || inBlock.x == 7.0) {
    vec4 across = texture(u_image, v_texCoord + vec2((inBlock.x == 0.0 ? -1.0 : 1.0) / u_size.x, 0.0));
    if (all(lessThan(abs(across.rgb - c.rgb), vec3(threshold)))) result = mix(result, (c + across) * 0.5, u_strength);
  }
  if (inBlock.y == 0.0 || inBlock.y == 7.0) {
    vec4 across = texture(u_image, v_texCoord + vec2(0.0, (inBlock.y == 0.0 ? -1.0 : 1.0) / u_size.y));
    if (all(lessThan(abs(across.rgb - c.rgb), vec3(threshold)))) result = mix(result, (result + across) * 0.5, u_strength);
  }
  outColor = result;
}
`;

/*
 * AMD FidelityFX Super Resolution 1.0, ported from ffx_fsr1.h (v1.20210629).
 * Copyright (c) 2021 Advanced Micro Devices, Inc. MIT licence; see
 * THIRD_PARTY_NOTICES.md. WebGL has no gather instruction, so the 12 taps
 * are fetched directly, and AMD's fast approximations become exact maths.
 */
export const FSR_EASU = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec4 u_con0;
uniform vec2 u_inputSize;
out vec4 outColor;

vec4 fetch(ivec2 p) {
  return texelFetch(u_image, clamp(p, ivec2(0), ivec2(u_inputSize) - 1), 0);
}

float lumaTimesTwo(vec3 c) { return c.b * 0.5 + (c.r * 0.5 + c.g); }

void tap(inout vec3 aC, inout float aW, vec2 off, vec2 dir, vec2 len, float lob, float clp, vec3 c) {
  vec2 v = vec2(off.x * dir.x + off.y * dir.y, off.x * -dir.y + off.y * dir.x);
  v *= len;
  float d2 = min(v.x * v.x + v.y * v.y, clp);
  float wB = 2.0 / 5.0 * d2 - 1.0;
  float wA = lob * d2 - 1.0;
  wB *= wB;
  wA *= wA;
  wB = 25.0 / 16.0 * wB - (25.0 / 16.0 - 1.0);
  float w = wB * wA;
  aC += c * w;
  aW += w;
}

void setDirection(inout vec2 dir, inout float len, float w, float lA, float lB, float lC, float lD, float lE) {
  float dc = lD - lC;
  float cb = lC - lB;
  float lenX = max(abs(dc), abs(cb));
  lenX = lenX > 0.0 ? 1.0 / lenX : 0.0;
  float dirX = lD - lB;
  dir.x += dirX * w;
  lenX = clamp(abs(dirX) * lenX, 0.0, 1.0);
  len += lenX * lenX * w;
  float ec = lE - lC;
  float ca = lC - lA;
  float lenY = max(abs(ec), abs(ca));
  lenY = lenY > 0.0 ? 1.0 / lenY : 0.0;
  float dirY = lE - lA;
  dir.y += dirY * w;
  lenY = clamp(abs(dirY) * lenY, 0.0, 1.0);
  len += lenY * lenY * w;
}

void main() {
  vec2 pp = floor(gl_FragCoord.xy) * u_con0.xy + u_con0.zw;
  vec2 fp = floor(pp);
  pp -= fp;
  ivec2 f = ivec2(fp);
  //    b c
  //  e f g h
  //  i j k l
  //    n o
  vec4 b = fetch(f + ivec2(0, -1)), c = fetch(f + ivec2(1, -1));
  vec4 e = fetch(f + ivec2(-1, 0)), ff = fetch(f), g = fetch(f + ivec2(1, 0)), h = fetch(f + ivec2(2, 0));
  vec4 i = fetch(f + ivec2(-1, 1)), j = fetch(f + ivec2(0, 1)), k = fetch(f + ivec2(1, 1)), l = fetch(f + ivec2(2, 1));
  vec4 n = fetch(f + ivec2(0, 2)), o = fetch(f + ivec2(1, 2));
  float bL = lumaTimesTwo(b.rgb), cL = lumaTimesTwo(c.rgb), eL = lumaTimesTwo(e.rgb), fL = lumaTimesTwo(ff.rgb);
  float gL = lumaTimesTwo(g.rgb), hL = lumaTimesTwo(h.rgb), iL = lumaTimesTwo(i.rgb), jL = lumaTimesTwo(j.rgb);
  float kL = lumaTimesTwo(k.rgb), lL = lumaTimesTwo(l.rgb), nL = lumaTimesTwo(n.rgb), oL = lumaTimesTwo(o.rgb);

  vec2 dir = vec2(0.0);
  float len = 0.0;
  setDirection(dir, len, (1.0 - pp.x) * (1.0 - pp.y), bL, eL, fL, gL, jL);
  setDirection(dir, len, pp.x * (1.0 - pp.y), cL, fL, gL, hL, kL);
  setDirection(dir, len, (1.0 - pp.x) * pp.y, fL, iL, jL, kL, nL);
  setDirection(dir, len, pp.x * pp.y, gL, jL, kL, lL, oL);

  vec2 dir2 = dir * dir;
  float dirR = dir2.x + dir2.y;
  bool zero = dirR < 1.0 / 32768.0;
  dirR = zero ? 1.0 : inversesqrt(dirR);
  dir.x = zero ? 1.0 : dir.x;
  dir *= dirR;
  len = len * 0.5;
  len *= len;
  float stretch = (dir.x * dir.x + dir.y * dir.y) / max(abs(dir.x), abs(dir.y));
  vec2 len2 = vec2(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
  float lob = 0.5 + ((1.0 / 4.0 - 0.04) - 0.5) * len;
  float clp = 1.0 / lob;

  vec3 min4 = min(min(ff.rgb, g.rgb), min(j.rgb, k.rgb));
  vec3 max4 = max(max(ff.rgb, g.rgb), max(j.rgb, k.rgb));
  vec3 aC = vec3(0.0);
  float aW = 0.0;
  tap(aC, aW, vec2(0.0, -1.0) - pp, dir, len2, lob, clp, b.rgb);
  tap(aC, aW, vec2(1.0, -1.0) - pp, dir, len2, lob, clp, c.rgb);
  tap(aC, aW, vec2(-1.0, 1.0) - pp, dir, len2, lob, clp, i.rgb);
  tap(aC, aW, vec2(0.0, 1.0) - pp, dir, len2, lob, clp, j.rgb);
  tap(aC, aW, vec2(0.0, 0.0) - pp, dir, len2, lob, clp, ff.rgb);
  tap(aC, aW, vec2(-1.0, 0.0) - pp, dir, len2, lob, clp, e.rgb);
  tap(aC, aW, vec2(1.0, 1.0) - pp, dir, len2, lob, clp, k.rgb);
  tap(aC, aW, vec2(2.0, 1.0) - pp, dir, len2, lob, clp, l.rgb);
  tap(aC, aW, vec2(2.0, 0.0) - pp, dir, len2, lob, clp, h.rgb);
  tap(aC, aW, vec2(1.0, 0.0) - pp, dir, len2, lob, clp, g.rgb);
  tap(aC, aW, vec2(1.0, 2.0) - pp, dir, len2, lob, clp, o.rgb);
  tap(aC, aW, vec2(0.0, 2.0) - pp, dir, len2, lob, clp, n.rgb);
  // Alpha follows the plain bilinear blend of the four nearest pixels.
  float alpha = mix(mix(ff.a, g.a, pp.x), mix(j.a, k.a, pp.x), pp.y);
  outColor = vec4(min(max4, max(min4, aC / aW)), alpha);
}
`;

/** FSR 1 robust contrast-adaptive sharpening, from the same source as FSR_EASU. */
export const FSR_RCAS = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform float u_sharpness; // 1 is the most, halving per stop
uniform vec2 u_size;
out vec4 outColor;

vec4 load(ivec2 p) {
  return texelFetch(u_image, clamp(p, ivec2(0), ivec2(u_size) - 1), 0);
}

void main() {
  ivec2 sp = ivec2(gl_FragCoord.xy);
  vec3 b = load(sp + ivec2(0, -1)).rgb;
  vec3 d = load(sp + ivec2(-1, 0)).rgb;
  vec4 ee = load(sp);
  vec3 e = ee.rgb;
  vec3 f = load(sp + ivec2(1, 0)).rgb;
  vec3 h = load(sp + ivec2(0, 1)).rgb;
  vec3 mn4 = min(min(b, d), min(f, h));
  vec3 mx4 = max(max(b, d), max(f, h));
  vec2 peakC = vec2(1.0, -4.0);
  vec3 hitMin = min(mn4, e) / (4.0 * mx4 + 1e-5);
  vec3 hitMax = (peakC.x - max(mx4, e)) / (4.0 * mn4 + peakC.y - 1e-5);
  vec3 lobeRGB = max(-hitMin, hitMax);
  float limit = 0.25 - 1.0 / 16.0;
  float lobe = max(-limit, min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.0)) * u_sharpness;
  vec3 pix = (lobe * b + lobe * d + lobe * h + lobe * f + e) / (4.0 * lobe + 1.0);
  outColor = vec4(clamp(pix, 0.0, ee.a), ee.a);
}
`;

/** Wraps a gl-transitions shader. Their uv has y pointing up, so it's flipped at the edges. */
export function transitionShader(glsl: string): string {
  return `#version 300 es
precision highp float;
uniform sampler2D u_from;
uniform sampler2D u_to;
uniform float progress;
uniform float ratio;
in vec2 v_texCoord;
out vec4 outColor;

vec4 getFromColor(vec2 uv) { return texture(u_from, vec2(uv.x, 1.0 - uv.y)); }
vec4 getToColor(vec2 uv) { return texture(u_to, vec2(uv.x, 1.0 - uv.y)); }

${glsl}

void main() {
  outColor = transition(vec2(v_texCoord.x, 1.0 - v_texCoord.y));
}
`;
}
