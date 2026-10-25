import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col justify-center gap-3 px-6 py-24 sm:px-16">
      <h1 className="text-4xl font-semibold tracking-tight">Akira</h1>
      <p className="max-w-md text-muted">
        A video editor that runs in your browser. Everything renders on your own
        GPU, so nothing is uploaded.
      </p>
      <p className="font-mono text-sm text-muted">In development.</p>
      <Link
        href="/editor"
        className="mt-2 w-fit rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Open the editor
      </Link>
    </main>
  );
}
