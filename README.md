# Akira

A high-quality video editor that runs in your browser.

No AI and no uploads. Your footage never leaves your machine: decoding, effects and export all run locally on your GPU through WebCodecs and WebGL2.

> **Status:** early development. The features below are the v1 plan, not what works today. See the [roadmap](ROADMAP.md) for progress.

## Planned for v1

- **Timeline:** multi-track editing with a magnetic main track, plus trim, split, ripple delete, snapping, markers and unlimited undo
- **Motion:** keyframes with easing for transform, opacity and volume. Clips get in, out and loop animations
- **Speed:** constant speed, speed curves (ramps), reverse and freeze frame
- **Transitions and effects:** GPU shader transitions, colour adjustments, `.cube` LUTs, blend modes, masks and chroma key
- **Text:** styled text, text animations, and captions typed by hand or imported from `.srt`
- **Stabilisation and motion tracking:** classic computer vision (feature tracking and path smoothing), no AI
- **Enhance:** sharpen, denoise, FSR 1 upscaling, auto colour and deband
- **Audio:** multiple tracks with fades and waveforms, voiceover recording and noise reduction
- **Export:** MP4 (H.264/AAC) and WebM up to 4K, plus a TikTok preset that prepares footage to survive TikTok's re-compression

## How it's built

```
apps/web          Next.js editor UI
packages/engine   Editing engine: project model, decoding, compositing, audio, export
```

The engine is plain TypeScript with no UI framework, so it can be tested on its own and reused outside the web app.

- **Media:** [Mediabunny](https://mediabunny.dev) on top of WebCodecs for hardware-accelerated decode, encode and muxing
- **Rendering:** a custom WebGL2 compositor. Preview and export share the same shader pipeline, so what you see is what you export
- **Time:** integer microseconds throughout, never floating-point seconds, so cuts stay frame-accurate

## Development

Requires Node.js 22.12 or newer.

```sh
npm install
npm run dev        # editor at http://localhost:3000
npm test           # engine tests
npm run typecheck
```

## Browser support

Chrome and Edge on desktop are fully supported. Firefox desktop and Safari 26 are best-effort: Akira checks which codecs the browser supports and falls back where it can.

## License

[MIT](LICENSE)
