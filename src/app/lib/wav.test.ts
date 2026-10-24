import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeWav, toWav } from './wav';

describe('encodeWav', () => {
  it('writes a 16 kHz mono 16-bit header and clamps samples', () => {
    const v = new DataView(encodeWav(new Float32Array([0, 1, -1, 2]), 16_000));
    const ascii = (at: number) => String.fromCharCode(...[0, 1, 2, 3].map((k) => v.getUint8(at + k)));
    expect([ascii(0), ascii(8), ascii(12), ascii(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(v.byteLength).toBe(44 + 8);
    expect([v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true), v.getUint32(40, true)]).toEqual([1, 16_000, 16, 8]);
    expect([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32767, 32767]);
  });
});

describe('toWav', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('decodes at 16 kHz and returns the WAV with the loudest sample', async () => {
    const rates: number[] = [];
    vi.stubGlobal('OfflineAudioContext', class {
      constructor(_channels: number, _length: number, rate: number) { rates.push(rate); }
      async decodeAudioData() { return { getChannelData: () => new Float32Array([0.1, -0.5, 0.25]) }; }
    });
    const { wav, peak } = await toWav(new Blob(['clip']));
    expect(rates).toEqual([16_000]);
    expect(peak).toBe(0.5);
    expect(wav.type).toBe('audio/wav');
    expect(wav.size).toBe(44 + 3 * 2);
  });
});
