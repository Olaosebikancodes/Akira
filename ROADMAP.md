# Roadmap

The v1 checklist. An item is only ticked once it's built, tested and committed. A step is done when every box under it is ticked.

## Setup

- [x] Monorepo: Next.js editor app plus a framework-independent engine package
- [x] MIT licence and README
- [x] Engine unit tests, type checks, lint and production build all pass

## 1. Engine spike: import, play, scrub, trim, export ✅

- [x] Frame-accurate time maths: integer microseconds, exact frame rates such as 30000/1001
- [x] Project data model, with all clip timing going through one mapping
- [x] Open and probe media: codecs, size, frame rate, duration, clear errors for unsupported files
- [x] Frame cursor: decodes forward and only seeks again when the playhead jumps
- [x] WebGL2 compositor: GPU upload, phone rotation and flip, mipmapped downscaling
- [x] Player: audio-clock playback so video follows the sound, plus coalesced scrubbing
- [x] Export: same renderer as the preview, offline audio mix, H.264/AAC MP4
- [x] Editor test page: import, play/pause, scrub, frame stepping, trim in/out, export with progress and cancel
- [x] Browser tests in real Chrome: import, play, scrub, trim, export, re-import the export
- [x] Run and verified end to end

## 2. Timeline and layers ✅

- [x] Timeline UI: tracks, clips, playhead, zoom, snapping, markers
- [x] Magnetic main track and ripple delete
- [x] Split, trim handles, duplicate, delete, replace, freeze frame, detach audio
- [x] Constant speed (0.25× to 4×), rotate 90°, flip, crop
- [x] Multi-select, undo/redo, keyboard shortcuts
- [x] Layers: picture-in-picture with on-canvas move, scale, rotate and opacity
- [x] Images and stickers (PNG, GIF, WebP), canvas background (colour, blur, image), aspect ratio presets
- [x] Decoding and export moved off the main thread into workers

## 3. Audio ✅

- [x] Audio tracks with volume, fades, mute and solo
- [x] Waveforms
- [x] Voiceover recording
- [x] Noise reduction (classic filters for hiss, hum and rumble)

## 4. Text ✅

- [x] Text clips: fonts (including your own), colour, stroke, shadow, background
- [x] Text animations
- [x] Captions typed by hand or imported from `.srt`

## 5. Shader library

- [ ] Transitions (from gl-transitions, licence-checked)
- [ ] Adjustments, `.cube` LUTs and effects
- [ ] Blend modes, masks and chroma key
- [ ] Enhance: sharpen, denoise, FSR 1 upscale, auto colour, deband/deblock

## 6. Keyframes and animations

- [ ] Keyframes with easing for transform, opacity and volume
- [ ] Clip in, out and loop animations

## 7. Saving

- [ ] Autosave to local storage (OPFS and IndexedDB) and a project list
- [ ] Export and import a project as a `.zip`

## 8. Speed curves and reverse

- [ ] Speed curves: presets and custom curves, with frame blending for slow motion
- [ ] Reverse, built as a background job

## 9. Stabilisation and motion tracking

- [ ] Background job system with cached results
- [ ] Stabilisation (OpenCV.js)
- [ ] Motion tracking that produces editable keyframes

## 10. Ship

- [ ] Export settings: MP4 and WebM up to 4K, bitrate presets
- [ ] Enhance for TikTok preset, safe-zone overlay and upload tips
- [ ] Landing page and docs
- [ ] Deploy to Vercel
