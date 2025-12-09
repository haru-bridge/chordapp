// lib/chordEngine.ts
import * as Tone from "tone";
import { Chord } from "tonal";

export type ParsedChord = {
  raw: string;        // ユーザー入力そのまま（表示用）
  symbol: string;     // tonal 用に正規化したシンボル
  bass?: string | null; // 分数コードのベース
};

/**
 * ユーザー入力された 1 個のコードトークンを tonal が読める形に正規化
 * 例: "Db△7", "Bm7(♭5)/F", "Esus4add♭9" など
 */
export function normalizeChordToken(token: string): string {
  let s = token.trim();

  // Unicode の記号を ASCII に
  s = s.replace(/♭/g, "b").replace(/[♯＃]/g, "#");

  // 三角形メジャー7記法: F△7 / C△7 / Bb△7 → Fmaj7 / Cmaj7 / Bbmaj7
  s = s.replace(/([A-G][b#]?)[△Δ]7/g, "$1maj7");

  // 「△」だけ（7 が省略）も一応サポート: F△ → Fmaj7
  s = s.replace(/([A-G][b#]?)[△Δ](?=$|\/|\s|,|\|)/g, "$1maj7");

  // 全角カッコ → 半角
  s = s.replace(/（/g, "(").replace(/）/g, ")");

  // Bm7(♭5) → Bm7♭5 → Bm7b5
  s = s.replace(/\(([^)]+)\)/g, "$1");
  s = s.replace(/♭/g, "b");

  return s;
}

/**
 * テキスト（例: "Db Ab/C Bbm7 Gbmaj7"）をパースして ParsedChord 配列に
 */
export function parseProgression(
  input: string,
  options?: { silent?: boolean }
): ParsedChord[] {
  const rawTokens: string[] = input
    // 空白・カンマ・縦棒・矢印で区切る
    .split(/[\s,|→]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== "-"); // 「-」だけは無視（伸ばし記号扱い）

  const result: ParsedChord[] = rawTokens.map((rawToken) => {
    const normalized = normalizeChordToken(rawToken);
    const [symbol, bass] = normalized.split("/");

    return {
      raw: rawToken,          // 表示用（F△7 とか）
      symbol,                 // tonal 用（Fmaj7 など）
      bass: bass ?? null,
    };
  });

  if (!options?.silent) {
    console.log("parseProgression result:", result);
  }

  return result;
}

/**
 * 1 つのコード（ParsedChord）を、実際に鳴らすノート配列に変換
 * rootOctave でルートの高さを指定
 */
export function chordToNotes(parsed: ParsedChord, rootOctave: number): string[] {
  const info = Chord.get(parsed.symbol);

  console.log("Chord.get:", {
    inputSymbol: parsed.symbol,
    chordInfo: info,
  });

  if (!info || info.empty || !info.notes || info.notes.length === 0) {
    console.warn("解釈できないコード:", parsed.raw, info);
    return [];
  }

  const pcs = info.notes.slice(); // 例: ["F", "A", "C", "E"]
  const notes: string[] = [];
  const midis: number[] = [];

  // 1. ルートを rootOctave に置く
  const rootPc = pcs[0];
  const rootNote = `${rootPc}${rootOctave}`;
  const rootMidi = Tone.Frequency(rootNote).toMidi(); // ← const に変更

  if (!Number.isFinite(rootMidi)) {
    console.warn("無効なルートノート:", rootNote, parsed);
    return [];
  }

  notes.push(rootNote);
  midis.push(rootMidi);

  // 2. 残りの構成音は「直前より下がらないように」上に積む
  for (let i = 1; i < pcs.length; i++) {
    const pc = pcs[i];

    let octave = rootOctave;
    let noteName = `${pc}${octave}`;
    let midi = Tone.Frequency(noteName).toMidi();

    if (!Number.isFinite(midi)) {
      console.warn("無効な構成音:", noteName, parsed);
      continue;
    }

    while (midi <= midis[midis.length - 1]) {
      octave++;
      noteName = `${pc}${octave}`;
      midi = Tone.Frequency(noteName).toMidi();
      if (!Number.isFinite(midi)) {
        console.warn("無効な構成音(オクターブ調整中):", noteName, parsed);
        break;
      }
    }

    if (!Number.isFinite(midi)) continue;

    notes.push(noteName);
    midis.push(midi);
  }

  // 3. 分数コードがあれば、ベースはルートより下になるまで下げて先頭に追加
  if (parsed.bass) {
    let bassOct = rootOctave - 1;
    let bassName = `${parsed.bass}${bassOct}`;
    let bassMidi = Tone.Frequency(bassName).toMidi();

    if (!Number.isFinite(bassMidi)) {
      console.warn("無効なベースノート:", bassName, parsed);
    } else {
      while (bassMidi >= midis[0]) {
        bassOct--;
        bassName = `${parsed.bass}${bassOct}`;
        bassMidi = Tone.Frequency(bassName).toMidi();
        if (!Number.isFinite(bassMidi)) {
          console.warn("無効なベースノート(オクターブ調整中):", bassName, parsed);
          break;
        }
      }

      if (Number.isFinite(bassMidi)) {
        const bassNote = Tone.Frequency(bassMidi, "midi").toNote();
        notes.unshift(bassNote);
        midis.unshift(bassMidi);
      }
    }
  }

  console.log("chordToNotes (voiced):", {
    raw: parsed.raw,
    symbol: parsed.symbol,
    bass: parsed.bass,
    pitchClasses: pcs,
    notesWithOctave: notes,
    midis,
  });

  return notes;
}
