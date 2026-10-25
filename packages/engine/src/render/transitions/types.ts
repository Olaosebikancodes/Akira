/** A transition shader from the gl-transitions collection. */
export interface TransitionDefinition {
  name: string;
  /** Name for the UI, e.g. "Circle open". */
  label: string;
  author: string;
  license: string;
  tags: string[];
  /**
   * GLSL ES 3.00 defining `vec4 transition(vec2 uv)`, which may call
   * getFromColor, getToColor and read `progress` and `ratio`.
   */
  glsl: string;
  /** Uniforms the shader declares, with their default values. */
  params: Record<string, { type: string; value: number | number[] | boolean }>;
}
