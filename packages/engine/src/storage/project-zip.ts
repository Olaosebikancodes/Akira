import { downloadZip } from "client-zip";
import { createId } from "../project/create";
import type { Id } from "../project/model";
import type { ProjectLibrary } from "./library";
import { type MediaDescription, parseProject, ProjectFileError, safeFileName, serializeProject } from "./project-file";
import { readZip } from "./zip";

const MANIFEST = "project.json";

/** Where an asset's media goes inside a project zip. */
function mediaPath(assetId: Id, name: string): string {
  return `media/${assetId}/${safeFileName(name)}`;
}

/**
 * Packs a saved project and all its media into one .zip, for moving it to
 * another browser or keeping a backup. Media is stored without compression:
 * video and audio are already compressed, and this keeps zipping fast.
 */
export async function exportProjectZip(library: ProjectLibrary, id: Id): Promise<Blob> {
  const loaded = await library.load(id);
  if (!loaded) throw new ProjectFileError("That project isn't saved on this device.");
  const media: Record<Id, MediaDescription> = {};
  const entries = [...loaded.files].map(([assetId, file]) => {
    media[assetId] = { name: file.name, type: file.type };
    return { name: mediaPath(assetId, file.name), input: file, lastModified: new Date(file.lastModified) };
  });
  const manifest = { name: MANIFEST, input: serializeProject(loaded.project, media), lastModified: new Date() };
  return downloadZip([manifest, ...entries]).blob();
}

/**
 * Adds a project from a zip made by `exportProjectZip` and returns its id.
 * A project that's already on this device comes in as a copy, so neither
 * overwrites the other.
 */
export async function importProjectZip(library: ProjectLibrary, zip: Blob): Promise<Id> {
  const entries = await readZip(zip);
  const manifest = entries.find((entry) => entry.name === MANIFEST);
  if (!manifest) throw new ProjectFileError("This zip isn't an Akira project: it has no project.json.");
  const saved = parseProject(await (await manifest.blob()).text());

  let project = saved.project;
  if (await library.has(project.id)) project = { ...project, id: createId(), name: `${project.name} (copy)` };
  for (const assetId of Object.keys(project.assets)) {
    const description = saved.media?.[assetId];
    const entry = description && entries.find((e) => e.name === mediaPath(assetId, description.name));
    // Media missing from the zip shows as offline in the editor rather than failing the import.
    if (!entry) continue;
    const file = new File([await entry.blob()], description.name, { type: description.type });
    await library.storeMedia(project.id, assetId, file);
  }
  await library.save(project, null);
  return project.id;
}
