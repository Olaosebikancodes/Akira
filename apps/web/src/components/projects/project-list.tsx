"use client";

import {
  exportProjectZip,
  formatTimecode,
  FPS_30,
  type Id,
  importProjectZip,
  type ProjectSummary,
} from "@akira/engine";
import { DownloadSimpleIcon, FilmStripIcon, PlusIcon, TrashIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ChangeEvent, type DragEvent, type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { projectLibrary } from "@/components/editor/persistence";
import { focusRing } from "@/components/editor/ui";

type Status = { kind: "idle" } | { kind: "busy"; message: string } | { kind: "error"; message: string };

/** Every project saved in this browser, newest first, with ways to open, back up, import and delete them. */
export function ProjectList() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [dropping, setDropping] = useState(false);
  const inputId = useId();

  async function refresh() {
    setProjects(await (await projectLibrary()).list());
  }

  useEffect(() => {
    let live = true;
    void projectLibrary()
      .then((library) => library.list())
      .then((list) => {
        if (live) setProjects(list);
      });
    return () => {
      live = false;
    };
  }, []);

  async function importZip(file: File) {
    setStatus({ kind: "busy", message: `Importing ${file.name}…` });
    try {
      const id = await importProjectZip(await projectLibrary(), file);
      router.push(`/editor?project=${id}`);
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  function onChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void importZip(file);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDropping(false);
    const file = [...event.dataTransfer.files].find((f) => /\.zip$/i.test(f.name));
    if (file) void importZip(file);
  }

  async function download(project: ProjectSummary) {
    setStatus({ kind: "busy", message: `Packing ${project.name}…` });
    try {
      const zip = await exportProjectZip(await projectLibrary(), project.id);
      const url = URL.createObjectURL(zip);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${project.name || "Akira project"}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setStatus({ kind: "idle" });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function remove(id: Id) {
    await (await projectLibrary()).delete(id);
    await refresh();
  }

  return (
    <main
      className={`mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-8 ${dropping ? "outline-2 -outline-offset-8 outline-ring" : ""}`}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <Link href="/" className={`rounded text-[15px] font-semibold tracking-tight ${focusRing}`}>
            Akira
          </Link>
          <h1 className="text-[15px] text-muted">Projects</h1>
        </div>
        <div className="flex items-center gap-2">
          <input id={inputId} type="file" accept=".zip,application/zip" className="peer sr-only" onChange={onChosen} />
          <label
            htmlFor={inputId}
            className="press inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-raised px-3 text-[13px] font-medium hover:bg-raised-hover peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring"
          >
            <UploadSimpleIcon size={15} aria-hidden />
            Import project
          </label>
          <Link
            href="/editor"
            className={`press inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-foreground hover:bg-accent-hover ${focusRing}`}
          >
            <PlusIcon size={15} weight="bold" aria-hidden />
            New project
          </Link>
        </div>
      </header>

      <div aria-live="polite">
        {status.kind === "busy" && <p className="text-sm text-muted">{status.message}</p>}
        {status.kind === "error" && (
          <p role="alert" className="text-sm text-danger">
            {status.message}
          </p>
        )}
      </div>

      {projects === null ? (
        <p className="text-sm text-muted">Loading projects…</p>
      ) : projects.length === 0 ? (
        <section className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border px-6 py-12">
          <h2 className="text-base font-semibold tracking-tight">No projects yet</h2>
          <p className="max-w-md text-sm text-muted">
            Projects save themselves in this browser as you edit. To bring one from another computer, import its .zip here.
          </p>
        </section>
      ) : (
        <ul aria-label="Projects" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {projects.map((project) => (
            <li key={project.id}>
              <ProjectCard project={project} onDownload={() => void download(project)} onDelete={() => void remove(project.id)} />
            </li>
          ))}
        </ul>
      )}

      <p className="mt-auto max-w-xl text-xs text-subtle">
        Projects and their media are kept in this browser only. Download a project to back it up or open it somewhere
        else; clearing this site’s data deletes them.
      </p>
    </main>
  );
}

function ProjectCard({ project, onDownload, onDelete }: { project: ProjectSummary; onDownload: () => void; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const thumbnail = useMemo(() => (project.thumbnail ? URL.createObjectURL(project.thumbnail) : null), [project.thumbnail]);
  useEffect(() => {
    if (!thumbnail) return;
    return () => URL.revokeObjectURL(thumbnail);
  }, [thumbnail]);

  const name = project.name || "Untitled project";
  return (
    <article className="group flex flex-col gap-2">
      <Link
        href={`/editor?project=${project.id}`}
        aria-label={`Open ${name}`}
        className={`relative block aspect-video overflow-hidden rounded-lg bg-raised ring-accent hover:ring-2 ${focusRing}`}
      >
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local blob, which next/image can't optimise
          <img src={thumbnail} alt="" className="size-full object-cover" />
        ) : (
          <FilmStripIcon size={28} className="absolute inset-0 m-auto text-subtle" aria-hidden />
        )}
        {project.duration > 0 && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1 font-mono text-[11px] tabular-nums text-foreground">
            {formatTimecode(project.duration, FPS_30).slice(3, 8)}
          </span>
        )}
      </Link>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-medium">{name}</h2>
          <p className="text-xs text-subtle">Edited {relativeTime(project.updatedAt)}</p>
        </div>
        {confirming ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onDelete}
              className={`press h-7 rounded-md bg-danger px-2 text-xs font-medium text-background ${focusRing}`}
            >
              Delete
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={`press h-7 rounded-md px-2 text-xs text-muted hover:bg-raised ${focusRing}`}>
              Keep
            </button>
          </div>
        ) : (
          <div className="flex shrink-0">
            <CardButton label={`Download ${name} as .zip`} onClick={onDownload}>
              <DownloadSimpleIcon size={16} aria-hidden />
            </CardButton>
            <CardButton label={`Delete ${name}`} onClick={() => setConfirming(true)}>
              <TrashIcon size={16} aria-hidden />
            </CardButton>
          </div>
        )}
      </div>
    </article>
  );
}

function CardButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`press grid size-7 place-items-center rounded-md text-muted hover:bg-raised hover:text-foreground ${focusRing}`}
    >
      {children}
    </button>
  );
}

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "3 minutes ago", "yesterday", or "just now". */
function relativeTime(time: number): string {
  const seconds = (time - Date.now()) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return RELATIVE.format(Math.round(seconds / size), unit);
  }
  return "just now";
}
