import type { TransitionDefinition } from "./types";

export type { TransitionDefinition } from "./types";

let catalog: Promise<ReadonlyMap<string, TransitionDefinition>> | null = null;

/** Every transition, by name. The shaders are large, so they load on first use. */
export function loadTransitions(): Promise<ReadonlyMap<string, TransitionDefinition>> {
  catalog ??= import("./catalog").then(({ TRANSITIONS }) => new Map(TRANSITIONS.map((t) => [t.name, t])));
  return catalog;
}

export async function findTransition(name: string): Promise<TransitionDefinition | undefined> {
  return (await loadTransitions()).get(name);
}
