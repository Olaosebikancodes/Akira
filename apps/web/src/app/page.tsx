import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Akira · A video editor in your browser",
  description:
    "Multi-track editing, transitions, keyframes, speed ramps, stabilisation and motion tracking, rendered on your own GPU. No uploads, no account, no AI.",
};

const FEATURES = [
  {
    title: "Edit",
    body: "A magnetic main track with overlays above it. Trim, split, ripple delete, freeze frames, markers, snapping and unlimited undo, all from the keyboard too.",
  },
  {
    title: "Look",
    body: "123 GPU transitions, colour adjustments, .cube LUTs, blend modes, masks, chroma key and effects, all rendered live on your graphics card.",
  },
  {
    title: "Move",
    body: "Keyframes with easing on position, scale, rotation, opacity and volume. Speed curves, reverse, stabilisation, and tracking that turns movement into keyframes.",
  },
  {
    title: "Words and sound",
    body: "Styled text with animations, captions from .srt files, your own fonts, voiceover recording, and hum, rumble and hiss removal.",
  },
  {
    title: "Enhance",
    body: "Sharpening, noise reduction, deband, deblock, auto colour and AMD FSR 1 upscaling. These are classic filters: they clean up and sharpen without inventing detail.",
  },
  {
    title: "Export",
    body: "MP4 or WebM up to 4K, and a TikTok preset that sizes, sharpens and budgets the file so it survives the app's re-compression better.",
  },
] as const;

const BUILT_WITH = [
  ["WebCodecs", "Hardware decoding and encoding through Mediabunny, in workers so the editor stays responsive."],
  ["WebGL2", "One compositor draws both the preview and the export, so what you see is exactly what you get."],
  ["Our own vision code", "Optical flow, feature tracking and RANSAC written in TypeScript for stabilising and tracking."],
  ["Microsecond time", "Every timestamp is an integer, so cuts stay frame-accurate at any frame rate."],
] as const;

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-8">
        <span className="text-[15px] font-semibold tracking-tight">Akira</span>
        <nav aria-label="Main" className="flex items-center gap-1 text-sm">
          <Link href="/docs" className="rounded-md px-3 py-1.5 text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            Docs
          </Link>
          <Link
            href="/projects"
            className="press rounded-md bg-accent px-3 py-1.5 font-medium text-accent-foreground hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Open Akira
          </Link>
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pb-20 pt-10 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:pt-20">
          <div className="flex flex-col items-start gap-6">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">Video editor · runs in your browser</p>
            <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              A real video editor. Nothing leaves your computer.
            </h1>
            <p className="max-w-xl text-pretty text-base leading-relaxed text-muted sm:text-lg">
              Cut, grade, animate and export in a browser tab. Decoding, effects and rendering all happen on your own GPU: no
              uploads, no account, and no AI.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/projects"
                className="press rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Start editing
              </Link>
              <Link
                href="/docs"
                className="press rounded-md bg-raised px-4 py-2.5 text-sm font-medium hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Read the docs
              </Link>
            </div>
            <p className="text-xs text-subtle">Works best in Chrome or Edge on a laptop or desktop. Phones get a touch layout.</p>
          </div>
          <TimelineArt />
        </section>

        <section aria-labelledby="features" className="border-t border-border">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-20 sm:px-8 lg:grid-cols-[1fr_2fr]">
            <div>
              <h2 id="features" className="text-2xl font-semibold tracking-tight">
                What’s in it
              </h2>
              <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted">
                The tools short-form editors reach for every day, built from scratch for the web.
              </p>
            </div>
            <dl className="grid gap-x-10 gap-y-9 sm:grid-cols-2">
              {FEATURES.map((feature) => (
                <div key={feature.title} className="border-l border-border-strong pl-4">
                  <dt className="text-sm font-semibold">{feature.title}</dt>
                  <dd className="mt-2 text-sm leading-relaxed text-muted">{feature.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section aria-labelledby="private" className="border-t border-border bg-panel">
          <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-20 sm:px-8 lg:grid-cols-[1fr_2fr]">
            <h2 id="private" className="text-2xl font-semibold tracking-tight">
              Private by design
            </h2>
            <div className="grid gap-6 text-sm leading-relaxed text-muted sm:grid-cols-3">
              <p>
                <span className="block font-medium text-foreground">No uploads.</span>
                Your footage is read straight from your disk and never sent anywhere.
              </p>
              <p>
                <span className="block font-medium text-foreground">Saved in your browser.</span>
                Projects and their media save as you edit, and reopen where you left them.
              </p>
              <p>
                <span className="block font-medium text-foreground">Yours to move.</span>
                Download any project as a .zip to back it up or open it on another computer.
              </p>
            </div>
          </div>
        </section>

        <section aria-labelledby="built" className="border-t border-border">
          <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-20 sm:px-8 lg:grid-cols-[1fr_2fr]">
            <div>
              <h2 id="built" className="text-2xl font-semibold tracking-tight">
                How it’s built
              </h2>
              <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted">
                An editing engine in plain TypeScript, with a Next.js interface on top.
              </p>
            </div>
            <ul className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
              {BUILT_WITH.map(([title, body]) => (
                <li key={title} className="bg-background p-5">
                  <p className="font-mono text-xs text-accent">{title}</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-subtle sm:px-8">
          <p>Akira is open source under the MIT licence.</p>
          <p>Transitions from gl-transitions. Upscaling by AMD FidelityFX Super Resolution 1.</p>
        </div>
      </footer>
    </div>
  );
}

/** A drawing of the timeline: clips, a transition, keyframes and the playhead sweeping across. */
function TimelineArt() {
  const lanes = [
    [{ left: 6, width: 34, colour: "var(--clip-text)", label: "Title" }],
    [
      { left: 14, width: 22, colour: "var(--clip-image)", label: "Sticker" },
      { left: 52, width: 30, colour: "var(--clip-image)", label: "Logo" },
    ],
    [
      { left: 0, width: 46, colour: "var(--clip-video)", label: "Beach.mp4" },
      { left: 46, width: 54, colour: "var(--clip-video)", label: "Sunset.mp4" },
    ],
    [{ left: 0, width: 92, colour: "var(--clip-audio)", label: "Voiceover" }],
  ];
  return (
    <figure className="relative overflow-hidden rounded-xl border border-border-strong bg-panel p-4 shadow-[0_30px_80px_oklch(0%_0_0/0.45)]">
      <div className="mb-3 flex items-center justify-between font-mono text-[10px] text-subtle" aria-hidden>
        <span>00:00:00:00</span>
        <span>00:00:05:00</span>
        <span>00:00:10:00</span>
      </div>
      <div className="relative flex flex-col gap-2" aria-hidden>
        {lanes.map((lane, row) => (
          <div key={row} className="relative h-9 rounded-md bg-lane-main">
            {lane.map((clip) => (
              <div
                key={clip.label}
                className="absolute inset-y-1 overflow-hidden rounded px-2 text-[10px] font-medium leading-7 text-foreground/90"
                style={{ left: `${clip.left}%`, width: `${clip.width}%`, background: clip.colour }}
              >
                {clip.label}
              </div>
            ))}
            {row === 0 &&
              [10, 22, 34].map((at) => (
                <span key={at} className="absolute bottom-1.5 size-2 -translate-x-1/2 rotate-45 bg-foreground" style={{ left: `${at}%` }} />
              ))}
            {row === 2 && (
              <span className="absolute top-1/2 grid h-4 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-sm border border-white/60 bg-black/60" style={{ left: "46%" }} />
            )}
          </div>
        ))}
        <span className="absolute -top-2 bottom-0 left-[38%] w-px bg-accent motion-safe:animate-[sweep_9s_linear_infinite]">
          <span className="absolute -left-1 -top-1 size-2.5 rounded-sm bg-accent" />
        </span>
      </div>
      <figcaption className="mt-4 text-xs text-subtle">Clips, a transition at the cut, keyframes on the title, and the playhead.</figcaption>
    </figure>
  );
}
