import { SpectralGate } from "./spectral-gate";

const SPECTRAL_GATE = "akira-spectral-gate";

/**
 * The worklet script. It embeds SpectralGate's own source, so the code
 * tested in Node is exactly the code running on the audio thread.
 */
export const WORKLET_SOURCE = `
const Gate = (${SpectralGate.toString()});

class SpectralGateProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.strength = options.processorOptions.strength;
    this.gates = [];
    this.port.onmessage = (event) => {
      this.strength = event.data.strength;
      for (const gate of this.gates) gate.strength = this.strength;
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    for (let channel = 0; channel < output.length; channel++) {
      if (!this.gates[channel]) this.gates[channel] = new Gate(this.strength);
      const samples = output[channel];
      if (input && input[channel]) samples.set(input[channel]);
      else samples.fill(0);
      this.gates[channel].process(samples);
    }
    return true;
  }
}

registerProcessor("${SPECTRAL_GATE}", SpectralGateProcessor);
`;

const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

/** Loads Akira's audio processors into a context, once. */
export function loadAudioWorklets(context: BaseAudioContext): Promise<void> {
  let loading = loaded.get(context);
  if (!loading) {
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" }));
    loading = context.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    loaded.set(context, loading);
  }
  return loading;
}

/** A hiss reducer node. The context must have had `loadAudioWorklets` awaited first. */
export function createSpectralGateNode(context: BaseAudioContext, strength: number): AudioWorkletNode {
  return new AudioWorkletNode(context, SPECTRAL_GATE, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: "explicit",
    channelInterpretation: "speakers",
    processorOptions: { strength },
  });
}
