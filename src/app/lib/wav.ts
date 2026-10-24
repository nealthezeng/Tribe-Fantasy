const RATE = 16_000; // what speech models want; also keeps a 15 s clip under 0.5 MB

/** 16-bit mono PCM WAV of `samples` (−1…1): the one format every speech API takes. */
export function encodeWav(samples: Float32Array, rate: number): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per sample
  view.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return view.buffer;
}

/**
 * Whatever the phone recorded (webm on Chrome, mp4 on iPhone) as 16 kHz mono WAV, so every model gets the same bytes.
 * Decoding in a 16 kHz context does the resampling. `peak` is the loudest sample (0…1).
 */
export async function toWav(recording: Blob): Promise<{ wav: Blob; peak: number }> {
  const audio = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(await recording.arrayBuffer());
  const samples = audio.getChannelData(0);
  return {
    wav: new Blob([encodeWav(samples, RATE)], { type: 'audio/wav' }),
    peak: samples.reduce((max, s) => Math.max(max, Math.abs(s)), 0),
  };
}
