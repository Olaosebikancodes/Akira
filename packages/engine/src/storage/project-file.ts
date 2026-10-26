import { createTrack } from "../project/create";
import type { Id, Project } from "../project/model";

/** Bumped whenever the saved shape changes; older saves are upgraded as they load. */
export const PROJECT_FORMAT = 1;

export class ProjectFileError extends Error {
  override name = "ProjectFileError";
}

/** What a media file was called and what kind it is, which a stored copy doesn't keep on its own. */
export interface MediaDescription {
  name: string;
  /** MIME type, e.g. "video/mp4". Images are only recognised by it. */
  type: string;
}

/** A project as written to storage or into a project zip. */
export interface SavedProject {
  app: "akira";
  format: number;
  project: Project;
  /** In project zips, the media each asset's file holds. */
  media?: Record<Id, MediaDescription>;
}

export function serializeProject(project: Project, media?: Record<Id, MediaDescription>): string {
  const saved: SavedProject = { app: "akira", format: PROJECT_FORMAT, project, ...(media ? { media } : {}) };
  return JSON.stringify(saved);
}

/** Reads a saved project, checking it's Akira's and upgrading older formats. */
export function parseProject(json: string): SavedProject {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new ProjectFileError("This project file is damaged.");
  }
  if (!isRecord(data) || data.app !== "akira") throw new ProjectFileError("This isn't an Akira project.");
  if (typeof data.format !== "number" || data.format > PROJECT_FORMAT) {
    throw new ProjectFileError("This project was saved by a newer version of Akira. Update Akira and try again.");
  }
  const project = data.project;
  if (
    !isRecord(project) ||
    typeof project.id !== "string" ||
    !isRecord(project.canvas) ||
    !isRecord(project.assets) ||
    !Array.isArray(project.tracks)
  ) {
    throw new ProjectFileError("This project file is damaged.");
  }
  // Format 1 is the first, so there's nothing to upgrade yet; later formats convert here.
  const upgraded = project as unknown as Project;
  const tracks = upgraded.tracks.length > 0 ? upgraded.tracks : [createTrack("video")];
  return {
    app: "akira",
    format: PROJECT_FORMAT,
    project: { ...upgraded, markers: upgraded.markers ?? [], tracks },
    ...(isRecord(data.media) ? { media: data.media as Record<Id, MediaDescription> } : {}),
  };
}

/** A name safe to use as a file name in storage and in zips. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : "media";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
