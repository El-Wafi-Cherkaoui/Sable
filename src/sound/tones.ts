export const sampleRate = 22_050;
const attackMs = 8;
const releaseMs = 12;

export type Note = {
  frequency: number;
  // When the note starts, so notes can overlap like a soft bell.
  startMs: number;
  durationMs: number;
};

// Renders notes as 16-bit mono samples. Each note is a sine with a quiet
// second harmonic, a smooth attack, and an exponential decay that fades to
// zero, so nothing clicks or sounds harsh.
export function renderSamples(notes: Note[], volume: number): Int16Array {
  const totalMs = Math.max(0, ...notes.map((note) => note.startMs + note.durationMs));
  const sampleCount = Math.ceil((totalMs / 1000) * sampleRate);
  const mix = new Float64Array(sampleCount);

  for (const note of notes) {
    const start = Math.floor((note.startMs / 1000) * sampleRate);
    const length = Math.floor((note.durationMs / 1000) * sampleRate);
    const attack = Math.max(1, Math.floor((attackMs / 1000) * sampleRate));
    const release = Math.min(length, Math.max(1, Math.floor((releaseMs / 1000) * sampleRate)));

    for (let index = 0; index < length && start + index < sampleCount; index += 1) {
      const time = index / sampleRate;
      const decay = Math.exp((-4 * index) / length);
      const fadeIn = index < attack ? 0.5 - 0.5 * Math.cos((Math.PI * index) / attack) : 1;
      const fadeOut = index >= length - release ? 0.5 + 0.5 * Math.cos((Math.PI * (index - (length - release))) / release) : 1;
      const wave = Math.sin(2 * Math.PI * note.frequency * time) + 0.15 * Math.sin(4 * Math.PI * note.frequency * time);

      mix[start + index]! += (wave / 1.15) * decay * fadeIn * fadeOut;
    }
  }

  const peak = Math.max(1, ...mix.map(Math.abs));
  const samples = new Int16Array(sampleCount);

  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = Math.round((mix[index]! / peak) * volume * 32767);
  }

  return samples;
}

export function renderTones(notes: Note[], volume: number): Buffer {
  return toWav(renderSamples(notes, volume));
}

function toWav(samples: Int16Array): Buffer {
  const dataSize = samples.length * 2;
  const wav = Buffer.alloc(44 + dataSize);

  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < samples.length; index += 1) {
    wav.writeInt16LE(samples[index]!, 44 + index * 2);
  }

  return wav;
}
