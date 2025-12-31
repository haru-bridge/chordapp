// lib/chordEngine.ts
import * as Tone from "tone";
import { Chord } from "tonal";

export type ParsedChord = {
  raw: string;
  symbol: string;
  bass?: string | null;
};

export type ParseStatus = "ok" | "warn" | "error" | "rest";
export type ParseKind = "chord" | "roman";

export type ParsedItem = {
  index: number;
  raw: string;
  kind: ParseKind;
  status: ParseStatus;
  normalized?: string;
  symbol?: string | null;
  bass?: string | null;
  degree?: string; // roman入力時や、表示用に入れる
  message?: string;
};

export function normalizeChordToken(token: string): string {
  let s = token.trim();

  // 記号ゆれ
  s = s.replace(/♭/g, "b").replace(/[♯＃]/g, "#");

  // △→maj7
  s = s.replace(/([A-G][b#]?)[△Δ]7/g, "$1maj7");
  s = s.replace(/([A-G][b#]?)[△Δ](?=$|\/|\s|,|\|)/g, "$1maj7");

  // 全角括弧→半角、括弧内除去（テンション系は後で強化）
  s = s.replace(/（/g, "(").replace(/）/g, ")");
  s = s.replace(/\(([^)]+)\)/g, "$1");

  return s;
}

const tokenize = (input: string): string[] => {
  return input
    .split(/[\s,|→]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
};

const isRestToken = (t: string): boolean => {
  const s = t.trim();
  return s === "-" || s === "休" || s === "(休)" || s === "（休）";
};

export function parseChordInputDetailed(
  input: string,
  options?: { silent?: boolean }
): ParsedItem[] {
  const tokens = tokenize(input);

  const items: ParsedItem[] = tokens.map((raw, index) => {
    if (isRestToken(raw)) {
      return { index, raw, kind: "chord", status: "rest" };
    }

    const normalized = normalizeChordToken(raw);
    const [symbol, bass] = normalized.split("/");

    // tonalで解釈できるか（最低限チェック）
    const info = Chord.get(symbol);

    if (!info || info.empty) {
      return {
        index,
        raw,
        kind: "chord",
        status: "error",
        normalized,
        symbol: null,
        bass: bass ?? null,
        message: "Chord.get で解釈できません",
      };
    }

    // bassが指定されてるが音名として成立しない、などは warn に落とす
    let warn = false;
    if (bass) {
      const midi = Tone.Frequency(`${bass}4`).toMidi();
      if (!Number.isFinite(midi)) warn = true;
    }

    return {
      index,
      raw,
      kind: "chord",
      status: warn ? "warn" : "ok",
      normalized,
      symbol,
      bass: bass ?? null,
      message: warn ? "slash bass が解釈できない可能性" : undefined,
    };
  });

  if (!options?.silent) {
    // eslint-disable-next-line no-console
    console.log("parseChordInputDetailed:", items);
  }
  return items;
}

export function chordToNotes(
  parsed: ParsedChord,
  rootOctave: number,
  options?: { silent?: boolean }
): string[] {
  const info = Chord.get(parsed.symbol);

  if (!info || info.empty || !info.notes || info.notes.length === 0) {
    if (!options?.silent) {
      // eslint-disable-next-line no-console
      console.warn("解釈できないコード:", parsed.raw, parsed.symbol, info);
    }
    return [];
  }

  const pcs = info.notes.slice();
  const notes: string[] = [];
  const midis: number[] = [];

  // ルートを基準に「常に上へ積む」単純voicing
  const rootPc = pcs[0];
  const rootNote = `${rootPc}${rootOctave}`;
  const rootMidi = Tone.Frequency(rootNote).toMidi();
  if (!Number.isFinite(rootMidi)) return [];

  notes.push(rootNote);
  midis.push(rootMidi);

  for (let i = 1; i < pcs.length; i++) {
    const pc = pcs[i];
    let octave = rootOctave;
    let noteName = `${pc}${octave}`;
    let midi = Tone.Frequency(noteName).toMidi();
    if (!Number.isFinite(midi)) continue;

    while (midi <= midis[midis.length - 1]) {
      octave++;
      noteName = `${pc}${octave}`;
      midi = Tone.Frequency(noteName).toMidi();
      if (!Number.isFinite(midi)) break;
    }
    if (!Number.isFinite(midi)) continue;

    notes.push(noteName);
    midis.push(midi);
  }

  // slash bass を一番下に置く（可能なら）
  if (parsed.bass) {
    let bassOct = rootOctave - 1;
    let bassName = `${parsed.bass}${bassOct}`;
    let bassMidi = Tone.Frequency(bassName).toMidi();

    if (Number.isFinite(bassMidi)) {
      while (bassMidi >= midis[0]) {
        bassOct--;
        bassName = `${parsed.bass}${bassOct}`;
        bassMidi = Tone.Frequency(bassName).toMidi();
        if (!Number.isFinite(bassMidi)) break;
      }
      if (Number.isFinite(bassMidi)) {
        const bassNote = Tone.Frequency(bassMidi, "midi").toNote();
        notes.unshift(bassNote);
        midis.unshift(bassMidi);
      }
    }
  }

  if (!options?.silent) {
    // eslint-disable-next-line no-console
    console.log("chordToNotes:", {
      raw: parsed.raw,
      symbol: parsed.symbol,
      bass: parsed.bass,
      pitchClasses: pcs,
      notesWithOctave: notes,
      midis,
    });
  }

  return notes;
}
