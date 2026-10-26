import { projectDuration } from "../project/query";
import type { Id, Project } from "../project/model";
import type { Micros } from "../time";
import { parseProject, safeFileName, serializeProject } from "./project-file";

const DB_NAME = "akira";
const DB_VERSION = 1;
const PROJECTS = "projects";
const MEDIA = "media";
/** Media copies live under this folder of the origin private file system, one folder per project. */
const MEDIA_ROOT = "projects";

interface ProjectRecord {
  id: Id;
  name: string;
  updatedAt: number;
  duration: Micros;
  thumbnail: Blob | null;
  /** The project, as `serializeProject` writes it. */
  json: string;
}

/** Written once a media copy is complete, so a half-copied file is never mistaken for a whole one. */
interface MediaRecord {
  projectId: Id;
  assetId: Id;
  name: string;
  type: string;
  size: number;
  lastModified: number;
}

export interface ProjectSummary {
  id: Id;
  name: string;
  updatedAt: number;
  duration: Micros;
  thumbnail: Blob | null;
}

export interface LoadedProject {
  project: Project;
  /** Each asset's media, by asset id. */
  files: Map<Id, File>;
  /** Assets whose media isn't on this device, such as one still copying when the page closed. */
  missing: Id[];
}

/**
 * Projects saved in the browser. The project itself goes in IndexedDB; the
 * media it uses is copied into the origin private file system, so a project
 * reopens without the user finding their files again. Nothing leaves the
 * device.
 */
export class ProjectLibrary {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(): Promise<ProjectLibrary> {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore(PROJECTS, { keyPath: "id" });
      const media = db.createObjectStore(MEDIA, { keyPath: ["projectId", "assetId"] });
      media.createIndex("projectId", "projectId");
    };
    return new ProjectLibrary(await done(request));
  }

  /** Every saved project, most recently edited first. */
  async list(): Promise<ProjectSummary[]> {
    const records = await done(this.store(PROJECTS, "readonly").getAll() as IDBRequest<ProjectRecord[]>);
    return records
      .map(({ id, name, updatedAt, duration, thumbnail }) => ({ id, name, updatedAt, duration, thumbnail }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async has(id: Id): Promise<boolean> {
    return (await done(this.store(PROJECTS, "readonly").count(id))) > 0;
  }

  async load(id: Id): Promise<LoadedProject | null> {
    const record = await done(this.store(PROJECTS, "readonly").get(id) as IDBRequest<ProjectRecord | undefined>);
    if (!record) return null;
    const { project } = parseProject(record.json);
    const media = await this.mediaRecords(id);
    const files = new Map<Id, File>();
    const missing: Id[] = [];
    for (const assetId of Object.keys(project.assets)) {
      const entry = media.find((m) => m.assetId === assetId);
      const file = entry && (await readMedia(entry));
      if (file) files.set(assetId, file);
      else missing.push(assetId);
    }
    return { project, files, missing };
  }

  /** Saves the project. Leaving out `thumbnail` keeps the one already saved. */
  async save(project: Project, thumbnail?: Blob | null): Promise<void> {
    const store = this.store(PROJECTS, "readwrite");
    const previous = await done(store.get(project.id) as IDBRequest<ProjectRecord | undefined>);
    const record: ProjectRecord = {
      id: project.id,
      name: project.name,
      updatedAt: Date.now(),
      duration: projectDuration(project),
      thumbnail: thumbnail === undefined ? (previous?.thumbnail ?? null) : thumbnail,
      json: serializeProject(project),
    };
    await done(store.put(record));
  }

  async hasMedia(projectId: Id, assetId: Id): Promise<boolean> {
    return (await done(this.store(MEDIA, "readonly").count([projectId, assetId]))) > 0;
  }

  /** Copies an asset's media into storage, streaming so large files never sit in memory. */
  async storeMedia(projectId: Id, assetId: Id, file: File): Promise<void> {
    const folder = await mediaFolder(projectId, assetId, true);
    const handle = await folder!.getFileHandle(safeFileName(file.name), { create: true });
    const writable = await handle.createWritable();
    await file.stream().pipeTo(writable);
    const record: MediaRecord = {
      projectId,
      assetId,
      name: file.name,
      type: file.type,
      size: file.size,
      lastModified: file.lastModified,
    };
    await done(this.store(MEDIA, "readwrite").put(record));
  }

  /** Deletes a project and every media copy it owns. */
  async delete(id: Id): Promise<void> {
    await done(this.store(PROJECTS, "readwrite").delete(id));
    const media = this.store(MEDIA, "readwrite");
    const keys = await done(media.index("projectId").getAllKeys(id));
    for (const key of keys) media.delete(key);
    try {
      const root = await navigator.storage.getDirectory();
      const projects = await root.getDirectoryHandle(MEDIA_ROOT);
      await projects.removeEntry(id, { recursive: true });
    } catch {
      // No media was ever copied for it.
    }
  }

  close(): void {
    this.db.close();
  }

  private async mediaRecords(projectId: Id): Promise<MediaRecord[]> {
    return done(this.store(MEDIA, "readonly").index("projectId").getAll(projectId) as IDBRequest<MediaRecord[]>);
  }

  private store(name: string, mode: IDBTransactionMode): IDBObjectStore {
    return this.db.transaction(name, mode).objectStore(name);
  }
}

async function mediaFolder(projectId: Id, assetId: Id, create: boolean): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const projects = await root.getDirectoryHandle(MEDIA_ROOT, { create });
    const project = await projects.getDirectoryHandle(projectId, { create });
    return await project.getDirectoryHandle(assetId, { create });
  } catch (error) {
    if (create) throw error;
    return null;
  }
}

async function readMedia(record: MediaRecord): Promise<File | null> {
  const folder = await mediaFolder(record.projectId, record.assetId, false);
  if (!folder) return null;
  try {
    const stored = await (await folder.getFileHandle(safeFileName(record.name))).getFile();
    // A stored copy has no MIME type, and images are only recognised by theirs.
    return new File([stored], record.name, { type: record.type, lastModified: record.lastModified });
  } catch {
    return null;
  }
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
