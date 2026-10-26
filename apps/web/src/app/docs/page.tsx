import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Docs · Akira",
  description: "How to edit with Akira: the timeline, looks, motion, saving, exporting for TikTok, and every keyboard shortcut.",
};

const SHORTCUTS: readonly [string, string][] = [
  ["Space", "Play or pause"],
  ["← / →", "Step a frame back or forward"],
  ["Shift + ← / →", "Step a second"],
  ["↑ / ↓", "Jump to the previous or next cut"],
  ["Home / End", "Go to the start or end"],
  ["S or Ctrl + B", "Split at the playhead"],
  ["Q / W", "Trim the clip's start or end to the playhead"],
  ["Delete", "Delete the selection (Shift + Delete also closes gaps on other tracks)"],
  ["Ctrl + D", "Duplicate"],
  ["F", "Freeze the frame under the playhead"],
  ["M", "Add or remove a marker"],
  ["Alt + ← / →", "Nudge the selected clip by a frame"],
  ["Ctrl + Z / Ctrl + Shift + Z", "Undo and redo"],
  ["Ctrl + A", "Select every clip"],
  ["N", "Turn snapping on or off"],
  ["- / =", "Zoom the timeline out or in"],
  ["Shift + Z", "Fit the whole timeline in view"],
  ["Escape", "Clear the selection"],
];

const SECTIONS = [
  ["start", "Getting started"],
  ["timeline", "The timeline"],
  ["looks", "Looks and effects"],
  ["motion", "Motion"],
  ["saving", "Saving and moving projects"],
  ["export", "Exporting, and TikTok"],
  ["shortcuts", "Keyboard shortcuts"],
  ["privacy", "Privacy and browsers"],
] as const;

export default function DocsPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col px-4 sm:px-8">
      <header className="flex items-center justify-between py-5">
        <Link href="/" className="rounded text-[15px] font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          Akira
        </Link>
        <Link
          href="/projects"
          className="press rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Open Akira
        </Link>
      </header>

      <div className="grid gap-12 pb-24 pt-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="On this page" className="lg:sticky lg:top-8 lg:self-start">
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm lg:flex-col">
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="max-w-2xl">
          <h1 className="text-4xl font-semibold tracking-tight">Docs</h1>
          <p className="mt-4 text-pretty leading-relaxed text-muted">
            Everything Akira does, and where to find it. It’s built for laptops and desktops; open it in Chrome or Edge for the
            best results.
          </p>

          <Section id="start" title="Getting started">
            <p>
              Open <Link href="/projects">Projects</Link> and choose <em>New project</em>. Drop video, audio, images, fonts, .srt
              captions or .cube LUTs onto the Media panel, then press <Kbd>+</Kbd> on a file, or drag it onto the timeline.
            </p>
            <p>
              Set the shape of the video under <em>Project</em> in the inspector (16:9, 9:16 for TikTok and Reels, 1:1 and more)
              with nothing selected. The background can be a colour, an image, or a blurred copy of the video.
            </p>
          </Section>

          <Section id="timeline" title="The timeline">
            <p>
              The bottom track is the main track: clips there sit end to end, so deleting one closes the gap. Drag clips above it to
              layer stickers, text and picture-in-picture. Drag a clip’s edges to trim it, and its middle to move it.
            </p>
            <p>
              The toolbar splits, deletes, duplicates, freezes frames, detaches audio, replaces a clip’s media and reverses clips.
              Hover a cut between two clips to add a transition there.
            </p>
          </Section>

          <Section id="looks" title="Looks and effects">
            <p>
              The <em>Effects</em> tab on the left has 123 transitions (hover one to preview it), effects such as blur, glitch and
              film grain, and filters including any .cube LUT you import. Select a clip first, then click one to apply it.
            </p>
            <p>
              The inspector’s <em>Colour</em> tab adjusts exposure, contrast, saturation, white balance and more, and removes green
              or blue screens. <em>Effects</em> holds blend modes and masks. <em>Enhance</em> sharpens, reduces noise and
              blockiness, fixes colour automatically and upscales with AMD FSR 1. These are classic filters: they make footage
              cleaner and crisper, but can’t invent detail that was never filmed.
            </p>
          </Section>

          <Section id="motion" title="Motion">
            <p>
              Press the diamond beside any value in the inspector to keyframe it at the playhead. Once a value has keyframes,
              changing it anywhere on the clip adds another; the <em>Keyframes</em> section sets the easing between them.
            </p>
            <p>
              <em>Speed</em> switches between a constant speed and a curve. Pick a preset ramp or drag the points, and turn on
              <em> Smooth slow motion</em> to blend frames when a clip plays slower than it was filmed. <em>Reverse</em> plays a
              clip backwards; the reversed copy is made in the background the first time.
            </p>
            <p>
              <em>Stabilise</em> (in <em>Enhance</em>) measures the camera’s shake once, then steadies the clip at the strength you
              choose. <em>Motion tracking</em> makes a clip, such as a sticker or a caption, follow something moving in the video
              beneath it: draw a box around the object, and the path becomes keyframes you can adjust.
            </p>
          </Section>

          <Section id="saving" title="Saving and moving projects">
            <p>
              Projects save as you edit, in this browser, along with copies of their media, so they reopen exactly as you left them.
              The top bar shows when everything is saved.
            </p>
            <p>
              On the Projects page, download any project as a .zip to back it up or open it in another browser, and import a .zip
              to bring one in. Clearing this site’s data in your browser deletes saved projects, so keep a .zip of anything that
              matters.
            </p>
          </Section>

          <Section id="export" title="Exporting, and TikTok">
            <p>
              <em>Export</em> renders MP4 (H.264) or WebM (VP9) at up to 4K, at the quality you choose. The TikTok preset renders
              1080 × 1920, adds a light clean-up and sharpen, and keeps the file within TikTok’s limits.
            </p>
            <p>
              TikTok always re-compresses what you upload and plays it at 1080p at most; the preset gives that step the cleanest
              possible start. For the best result, turn on <em>Upload HD</em> in TikTok’s settings, upload the exported file
              straight from your phone or computer rather than sending it through WhatsApp or another app first, and turn on the
              safe-zone guide in the preview so captions stay clear of TikTok’s buttons.
            </p>
          </Section>

          <Section id="shortcuts" title="Keyboard shortcuts">
            <table className="w-full text-left text-sm">
              <thead className="sr-only">
                <tr>
                  <th scope="col">Keys</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {SHORTCUTS.map(([keys, action]) => (
                  <tr key={keys}>
                    <td className="whitespace-nowrap py-2.5 pr-6 font-mono text-xs text-foreground">{keys}</td>
                    <td className="py-2.5 text-muted">{action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>On a Mac, use Cmd where this says Ctrl.</p>
          </Section>

          <Section id="privacy" title="Privacy and browsers">
            <p>
              Nothing you edit is uploaded. Files are read from your disk, processed on your own computer, and saved only in your
              browser. There are no accounts and no analytics on your media.
            </p>
            <p>
              Chrome and Edge on desktop are fully supported. Firefox and Safari are best-effort: Akira checks which codecs the
              browser can decode and encode, and says so when a file or export isn’t possible.
            </p>
          </Section>
        </main>
      </div>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-14 scroll-mt-8">
      <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">
        {title}
      </h2>
      <div className="mt-4 flex flex-col gap-4 leading-relaxed text-muted [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4 [&_em]:not-italic [&_em]:text-foreground">
        {children}
      </div>
    </section>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border-strong bg-raised px-1.5 py-0.5 font-mono text-xs text-foreground">{children}</kbd>;
}
