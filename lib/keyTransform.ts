// lib/keyTransform.ts
import * as Tone from "tone";
import { Chord } from "tonal";
import { ParsedChord } from "./chordEngine";

export type KeyMode = "major" | "minor";
export type KeySpec = { tonic: string; mode: KeyMode };

const stripOctave = (noteWithOctave: string) => noteWithOctave.replace(/\d+/g, "");

const DEGREE_MAP: Record<number, string> = {
  0: "I",
  1: "♭II",
  2: "II",
  3: "♭III",
  4: "III",
  5: "IV",
  6: "♯IV/♭V",
  7: "V",
  8: "♭VI",
  9: "VI",
  10: "♭VII",
  11: "VII",
};

export function semitoneShift(fromTonic: string, toTonic: string): number {
  const a = Tone.Frequency(`${fromTonic}4`).toMidi();
  const b = Tone.Frequency(`${toTonic}4`).toMidi();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;

  let diff = (b - a) % 12;
  if (diff > 6) diff -= 12;
  if (diff < -6) diff += 12;
  return diff;
}

export function transposeNoteName(note: string, semis: number): string | null {
  const m = Tone.Frequency(`${note}4`).toMidi();
  if (!Number.isFinite(m)) return null;
  const n = Tone.Frequency(`${note}4`).transpose(semis).toNote();
  return stripOctave(n);
}

export function splitChordRootAndSuffix(symbol: string): { root: string | null; suffix: string } {
  const m = symbol.match(/^([A-G](?:b|#)?)(.*)$/);
  if (!m) return { root: null, suffix: symbol };
  return { root: m[1], suffix: m[2] ?? "" };
}

export function transposeChord(ch: ParsedChord, semis: number): ParsedChord | null {
  const { root, suffix } = splitChordRootAndSuffix(ch.symbol);
  if (!root) return null;

  const newRoot = transposeNoteName(root, semis);
  if (!newRoot) return null;

  let newBass: string | null = null;
  if (ch.bass) {
    const b = transposeNoteName(ch.bass, semis);
    if (b) newBass = b;
  }

  return {
    raw: ch.raw,
    symbol: `${newRoot}${suffix}`,
    bass: newBass,
  };
}

export function formatChordSymbol(ch: ParsedChord): string {
  return ch.bass ? `${ch.symbol}/${ch.bass}` : ch.symbol;
}

// chord→度数（表示用）
// ※厳密な機能和声解析ではなく「ユーザーが見て理解できる」ことを優先
export function romanDegreeForChord(ch: ParsedChord, fromKey: KeySpec): string {
  const { root } = splitChordRootAndSuffix(ch.symbol);
  if (!root) return "?";

  const tonicMidi = Tone.Frequency(`${fromKey.tonic}4`).toMidi();
  const rootMidi = Tone.Frequency(`${root}4`).toMidi();
  if (!Number.isFinite(tonicMidi) || !Number.isFinite(rootMidi)) return "?";

  const diff = ((rootMidi - tonicMidi) % 12 + 12) % 12;
  const base = DEGREE_MAP[diff] ?? "?";

  const info = Chord.get(ch.symbol);
  const q = (info?.quality ?? "").toLowerCase();

  let numeral = base;
  const isMinor = q === "minor";
  const isDim = q === "diminished";
  const isAug = q === "augmented";

  if (isMinor) numeral = base.toLowerCase();
  if (isDim) numeral = base.toLowerCase() + "°";
  if (isAug) numeral = base + "+";

  const s = ch.symbol;
  const ext =
    s.includes("maj7") ? "maj7" :
    s.includes("m7b5") ? "ø" :
    s.includes("m7") ? "m7" :
    /(^|[^a-z])7(?!\d)/.test(s) ? "7" :
    s.includes("sus") ? "sus" :
    "";

  return ext ? `${numeral}${ext}` : numeral;
}
