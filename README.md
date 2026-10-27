# Akira

A high-quality video editor that runs in your browser.

No AI and no uploads. Your footage never leaves your machine: decoding, effects and export all run locally on your GPU through WebCodecs and WebGL2.

> **Status:** v1 is feature-complete; see the [roadmap](ROADMAP.md). The [docs](apps/web/src/app/docs/page.tsx) page in the app covers every feature and shortcut.

## Features

- **Timeline:** multi-track editing with a magnetic main track, plus trim, split, ripple delete, snapping, markers and unlimited undo
- **Motion:** keyframes with easing for transform, opacity and volume. Clips get in, out and loop animations
- **Speed:** constant speed, speed curves (ramps), reverse and freeze frame
- **Transitions and effects:** GPU shader transitions, colour adjustments, `.cube` LUTs, blend modes, masks and chroma key
- **Text:** styled text, text animations, and captions typed by hand or imported from `.srt`
- **Stabilisation and motion tracking:** classic computer vision (feature tracking and path smoothing), no AI. Tracking turns movement into keyframes you can edit
- **Enhance:** sharpen, denoise, FSR 1 upscaling, auto colour and deband
- **Audio:** multiple tracks with fades and waveforms, voiceover recording and noise reduction
- **Export:** MP4 (H.264/AAC) and WebM up to 4K, a TikTok preset that prepares footage to survive TikTok's re-compression, and a master preset that keeps the full picture at up to 8K in H.264, HEVC or AV1
- **Phones:** below 1024 px wide the editor switches to a phone layout, with tools in sheets along the bottom and a touch timeline: tap to select, swipe to scroll, pinch to zoom

## How it's built

```
apps/web          Next.js editor UI
packages/engine   Editing engine: project model, decoding, compositing, audio, export
```

The engine is plain TypeScript with no UI framework, so it can be tested on its own and reused outside the web app.

- **Media:** [Mediabunny](https://mediabunny.dev) on top of WebCodecs for hardware-accelerated decode, encode and muxing
- **Rendering:** a custom WebGL2 compositor. Each frame is built in an offscreen buffer, so blend modes can read what's beneath a layer, and clips with grading, effects or Enhance run through their own shader passes first. Preview and export share the same pipeline, so what you see is what you export
- **Shaders from others:** transitions come from [gl-transitions](https://github.com/gl-transitions/gl-transitions) and upscaling from AMD FidelityFX Super Resolution 1. Each is credited, with its licence, in [THIRD_PARTY_NOTICES.md](packages/engine/THIRD_PARTY_NOTICES.md)
- **Time:** integer microseconds throughout, never floating-point seconds, so cuts stay frame-accurate
- **Computer vision:** Shi–Tomasi corners, pyramidal Lucas–Kanade optical flow and RANSAC similarity fitting, written in TypeScript (`packages/engine/src/vision`) rather than pulling in a 15 MB OpenCV build
- **Big exports:** exports stream into the origin private file system as they're encoded, so multi-gigabyte masters never sit in memory. A master's codec is picked by asking the browser what it can encode at that size and bitrate, and whether its hardware does it
- **Background jobs:** reversing, measuring shake and tracking run in workers with progress and cancel; results are kept with the project so they're only worked out once
- **Saving:** projects live in IndexedDB with media copied into the origin private file system; project zips are written with client-zip and read by a small ZIP64-aware reader that slices files instead of loading them

## Development

Requires Node.js 22.12 or newer.

```sh
npm install
npm run dev        # editor at http://localhost:3000
npm test           # engine and web unit tests
npm run test:e2e   # browser tests (Playwright, installed Chrome)
npm run typecheck
```

## Deploying

Akira is a static Next.js app, so any static host works; Vercel is the simplest. Import the repository, set the project's root directory to `apps/web`, and keep the defaults: Vercel installs the npm workspaces from the repository root and builds with `next build`. The app sends `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers itself (see `apps/web/next.config.ts`), which audio needs for `SharedArrayBuffer`.

## Browser support

Chrome and Edge on desktop are fully supported. Firefox desktop and Safari 26 are best-effort: Akira checks which codecs the browser supports and falls back where it can. The phone layout is tested in Chrome's touch emulation; on a real phone, Chrome on Android is the best bet.

## License

[MIT](LICENSE)
