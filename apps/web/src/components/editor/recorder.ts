"use client";

import { wallClock } from "@akira/engine";

export interface Recording {
  /** Wall-clock time the microphone started capturing, comparable with `Player.heardAt`. */
  startedAt: number;
  /** Stops recording and returns the take as a file. */
  stop(): Promise<File>;
}

/**
 * Starts recording the microphone. The browser's own echo cancellation,
 * noise suppression and gain control are off: Akira mutes playback while
 * recording, and its own clean-up filters do the rest, so the take is the
 * natural sound of the voice.
 */
export async function startRecording(name: string): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  const startedAt = await new Promise<number>((resolve, reject) => {
    recorder.onstart = () => resolve(wallClock());
    recorder.onerror = () => reject(new Error("The microphone stopped unexpectedly."));
    recorder.start();
  });

  return {
    startedAt,
    stop: () =>
      new Promise<File>((resolve) => {
        recorder.onstop = () => {
          for (const track of stream.getTracks()) track.stop();
          const type = recorder.mimeType || "audio/webm";
          resolve(new File(chunks, `${name}.${type.includes("mp4") ? "m4a" : "webm"}`, { type }));
        };
        recorder.stop();
      }),
  };
}
