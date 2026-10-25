/**
 * Audio as plain sample data. Unlike an AudioBuffer it can be transferred
 * to a worker without copying.
 */
export interface PcmAudio {
  sampleRate: number;
  /** One array of samples per channel, all the same length. */
  channels: Float32Array[];
}

export function audioBufferToPcm(buffer: AudioBuffer): PcmAudio {
  return {
    sampleRate: buffer.sampleRate,
    channels: Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i).slice()),
  };
}

/** The channels laid end to end, which is the "f32-planar" layout encoders take. */
export function planar(audio: PcmAudio): Float32Array {
  const length = audio.channels[0]?.length ?? 0;
  const data = new Float32Array(length * audio.channels.length);
  audio.channels.forEach((channel, index) => data.set(channel, index * length));
  return data;
}

/** The ArrayBuffers to list as transferables when posting PCM to a worker. */
export function pcmTransferables(audio: PcmAudio): ArrayBuffer[] {
  return audio.channels.map((channel) => channel.buffer as ArrayBuffer);
}
