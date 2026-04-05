import * as Tone from 'tone';
import { AudioData } from './types';
import { storeAudioFile, getAudioFile } from '@daw/services/audioStorage';
import { generateId } from '@daw/utils/id';

export interface AudioFileResult {
  audioData: AudioData;
  buffer: AudioBuffer;
}

// Supported formats
export const SUPPORTED_AUDIO_FORMATS = [
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/mp3',
  'audio/mpeg',
  'audio/ogg',
  'audio/webm',
  'audio/aac',
  'audio/m4a',
  'audio/x-m4a',
];

export const WAVEFORM_SAMPLES = 1000; // Number of peaks to store for visualization

// Check if a file is a supported audio format
export function isAudioFile(file: File): boolean {
  return SUPPORTED_AUDIO_FORMATS.includes(file.type) ||
         file.name.match(/\.(wav|mp3|ogg|webm|m4a|aac|flac)$/i) !== null;
}

// Load, decode, and store audio file in IndexedDB
export async function processAudioFile(file: File): Promise<AudioFileResult> {
  // Validate file type
  if (!isAudioFile(file)) {
    throw new Error(`Unsupported audio format: ${file.type || file.name}`);
  }

  // Read file as ArrayBuffer for decoding
  const arrayBuffer = await file.arrayBuffer();

  // Decode audio to get buffer and metadata
  const buffer = await decodeAudioFromArrayBuffer(arrayBuffer);

  // Generate waveform peaks
  const waveformPeaks = generateWaveformPeaks(buffer, WAVEFORM_SAMPLES);

  // Generate a unique storage ID
  const storageId = generateId();

  // Store the original file blob in IndexedDB
  await storeAudioFile(storageId, file, {
    fileName: file.name,
    mimeType: file.type || 'audio/wav',
    duration: buffer.duration,
    sampleRate: buffer.sampleRate,
    waveformPeaks,
  });

  return {
    audioData: {
      storageId,
      fileName: file.name,
      mimeType: file.type || 'audio/wav',
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      waveformPeaks,
    },
    buffer,
  };
}

// Decode ArrayBuffer to AudioBuffer
export async function decodeAudioFromArrayBuffer(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
  // Ensure Tone.js context is started
  await Tone.start();
  const audioContext = Tone.getContext().rawContext as AudioContext;
  return audioContext.decodeAudioData(arrayBuffer.slice(0));
}

// Load audio from IndexedDB by storage ID
export async function loadAudioFromStorage(storageId: string): Promise<{
  blob: Blob;
  buffer: AudioBuffer;
} | null> {
  const stored = await getAudioFile(storageId);
  if (!stored) return null;

  const arrayBuffer = await stored.blob.arrayBuffer();
  const buffer = await decodeAudioFromArrayBuffer(arrayBuffer);

  return { blob: stored.blob, buffer };
}

// Generate downsampled waveform peaks for visualization
export function generateWaveformPeaks(buffer: AudioBuffer, numSamples: number): number[] {
  // Use first channel (or mix stereo to mono)
  let channelData: Float32Array;
  if (buffer.numberOfChannels === 1) {
    channelData = buffer.getChannelData(0);
  } else {
    // Mix stereo to mono
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    channelData = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) {
      channelData[i] = (left[i] + right[i]) / 2;
    }
  }

  const blockSize = Math.floor(channelData.length / numSamples);
  const peaks: number[] = [];

  for (let i = 0; i < numSamples; i++) {
    const start = i * blockSize;
    const end = Math.min(start + blockSize, channelData.length);
    let max = 0;

    // Find peak amplitude in this block
    for (let j = start; j < end; j++) {
      const abs = Math.abs(channelData[j]);
      if (abs > max) max = abs;
    }

    peaks.push(max);
  }

  return peaks;
}

// Calculate bars from audio duration
export function audioDurationToBars(durationSeconds: number, bpm: number, beatsPerBar: number): number {
  const beatsPerSecond = bpm / 60;
  const totalBeats = durationSeconds * beatsPerSecond;
  return Math.ceil(totalBeats / beatsPerBar);
}
