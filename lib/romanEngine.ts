// lib/romanEngine.ts
import * as Tone from "tone";
import { KeyMode, KeySpec } from "./keyTransform";
import { ParsedChord, ParsedItem } from "./chordEngine";

const stripOctave = (noteWithOctave: string) => noteWithOctave.replace(/\d+/g, "");

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

// 主要スケール（将来、旋律的短音階や和声的短音階へ拡張可能）
const SCALE_STEPS: Record<KeyMode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10], // natural minor
};

const ROMAN_TO_DEGREE: Record<string, number> = {
  I: 0, II: 1, III: 2, IV: 3, V: 4, VI: 5, VII: 6,
};

function expandRomanAliases(raw: string): string[] {
  const s = raw.trim();

  // 数字ショートカット
  if (/^(251|2-5-1)$/i.test(s)) return ["ii", "V7", "Imaj7"];

  // 英語っぽい入力
  if (/^two[-\s]?five[-\s]?one$/i.test(s)) return ["ii", "V7", "Imaj7"];

  // 日本語（雑に）
  if (s.includes("ツーファイブワン")) return ["ii", "V7", "Imaj7"];

  return [raw];
}

function normalizeRomanToken(token: string): string {
  let s = token.trim();
  s = s.replace(/♭/g, "b").replace(/[♯＃]/g, "#");
  s = s.replace(/（/g, "(").replace(/）/g, ")");
  s = s.replace(/\(([^)]+)\)/g, "$1");
  return s;
}

type RomanParsed = {
  display: string;      // 表示用（入力に近い形）
  rootPc: string;       // ルート音名（C, Db, ...）
  chordSuffix: string;  // m, dim, aug, 7, maj7, m7b5...
};

function parseRomanToChord(tokenRaw: string, key: KeySpec): RomanParsed | null {
  const token = normalizeRomanToken(tokenRaw);

  // accidentals + roman + modifiers + extension
  // 例: bVII, #iv, viio, iiø7, V7, Imaj7
  const m = token.match(/^([b#]{0,2})?([ivIV]+)(.*)$/);
  if (!m) return null;

  const acc = m[1] ?? "";
  const romanPart = m[2];
  const tail = (m[3] ?? "").trim();

  const romanUp = romanPart.toUpperCase();
  const deg = ROMAN_TO_DEGREE[romanUp];
  if (deg === undefined) return null;

  const steps = SCALE_STEPS[key.mode] ?? SCALE_STEPS.major;
  const baseSemis = steps[deg];

  const accSemis =
    (acc.match(/b/g)?.length ?? 0) * -1 +
    (acc.match(/#/g)?.length ?? 0) * 1;

  const tonicMidi = Tone.Frequency(`${key.tonic}4`).toMidi();
  if (!Number.isFinite(tonicMidi)) return null;

  const rootMidi = Tone.Frequency(`${key.tonic}4`).transpose(baseSemis + accSemis).toMidi();
  if (!Number.isFinite(rootMidi)) return null;

  const rootPc = stripOctave(Tone.Frequency(rootMidi, "midi").toNote());

  // quality
  const isLower = romanPart === romanPart.toLowerCase();
  const hasDim = tail.includes("°") || /dim/i.test(tail) || /o(?![a-z])/i.test(tail) || romanUp.endsWith("VII") && tail.includes("o");
  const hasHalfDim = tail.includes("ø");
  const hasAug = tail.includes("+") || /aug/i.test(tail);

  // extension (明示があれば尊重)
  const ext = tail;

  // suffix決定（最小）
  let suffix = "";

  if (hasHalfDim) {
    // half-diminished = m7b5 が基本
    suffix = "m7b5";
  } else if (hasDim) {
    // diminished triad
    suffix = "dim";
  } else if (hasAug) {
    suffix = "aug";
  } else if (isLower) {
    suffix = "m";
  } else {
    suffix = ""; // major triad
  }

  // extensionが明示されてる場合：よくあるものだけ上書き
  // 例: V7 / Imaj7 / iim7 / viio7 / iiø7
  if (ext) {
    const e = ext
      .replace(/^\s+/, "")
      .replace(/^maj7/i, "maj7")
      .replace(/^M7/i, "maj7")
      .replace(/^Δ7/i, "maj7");

    if (/^maj7/i.test(e)) {
      suffix = suffix === "m" ? "mmaj7" : "maj7"; // 使うなら後で整理
    } else if (/^m7b5/i.test(e)) {
      suffix = "m7b5";
    } else if (/^m7/i.test(e)) {
      suffix = "m7";
    } else if (/^7/i.test(e)) {
      suffix = "7";
    } else if (/^sus2/i.test(e)) {
      suffix = "sus2";
    } else if (/^sus4/i.test(e) || /^sus/i.test(e)) {
      suffix = "sus4";
    } else if (/^add9/i.test(e)) {
      suffix = (suffix || "") + "add9";
    } else if (/^dim7/i.test(e)) {
      suffix = "dim7";
    }
  } else {
    // 明示がないなら、ユーザーがローマ入力する用途でありがちな「7thのデフォルト」を軽く入れる
    // ただし“勝手に付けすぎる”と嫌なので、最小限に。
    // ・ii, V, I は 2-5-1 でよく使うので、m7 / 7 / maj7 を採用
    if (romanUp === "II" && isLower) suffix = "m7";
    if (romanUp === "V" && !isLower) suffix = "7";
    if (romanUp === "I" && !isLower) suffix = "maj7";
    if (hasHalfDim) suffix = "m7b5";
  }

  const display = `${acc}${romanPart}${tail}`;

  return { display, rootPc, chordSuffix: suffix };
}

export function parseRomanInputDetailed(
  input: string,
  key: KeySpec,
  options?: { silent?: boolean }
): ParsedItem[] {
  const rawTokens = tokenize(input).flatMap(expandRomanAliases);

  const items: ParsedItem[] = rawTokens.map((raw, index) => {
    if (isRestToken(raw)) return { index, raw, kind: "roman", status: "rest" };

    const normalized = normalizeRomanToken(raw);
    const parsed = parseRomanToChord(normalized, key);
    if (!parsed) {
      return {
        index,
        raw,
        kind: "roman",
        status: "error",
        normalized,
        symbol: null,
        message: "ローマ数字として解釈できません",
      };
    }

    const symbol = `${parsed.rootPc}${parsed.chordSuffix}`;
    return {
      index,
      raw,
      kind: "roman",
      status: "ok",
      normalized,
      degree: parsed.display,
      symbol,
      bass: null,
    };
  });

  if (!options?.silent) {
    // eslint-disable-next-line no-console
    console.log("parseRomanInputDetailed:", items);
  }
  return items;
}

export function itemsToPlayableChords(items: ParsedItem[]): ParsedChord[] {
  return items
    .filter((it) => it.status === "ok" || it.status === "warn")
    .filter((it) => it.symbol)
    .map((it) => ({
      raw: it.raw,
      symbol: it.symbol!,
      bass: it.bass ?? null,
    }));
}
