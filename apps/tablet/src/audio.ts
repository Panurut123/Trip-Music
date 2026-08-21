import fs from "node:fs";
import path from "node:path";

export function writeTone(filePath: string, seconds = 4, frequency = 440): void {
  if (fs.existsSync(filePath)) return;
  const sampleRate = 44100, channels = 1, bits = 16, samples = Math.floor(sampleRate * seconds), dataSize = samples * channels * bits / 8;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + dataSize, 4); buffer.write("WAVE", 8); buffer.write("fmt ", 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(channels, 22); buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * channels * bits / 8, 28); buffer.writeUInt16LE(channels * bits / 8, 32); buffer.writeUInt16LE(bits, 34); buffer.write("data", 36); buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples; i++) { const envelope = Math.min(1, i / 5000, (samples - i) / 5000); const sample = Math.sin(2 * Math.PI * frequency * i / sampleRate) * 0.2 * envelope; buffer.writeInt16LE(Math.max(-1, Math.min(1, sample)) * 32767, 44 + i * 2); }
  fs.writeFileSync(filePath, buffer);
}
