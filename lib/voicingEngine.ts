// lib/voicingEngine.ts
import * as Tone from "tone";
import { Chord } from "tonal";
import { ParsedChord } from "./chordEngine";
import { splitChordRootAndSuffix } from "./keyTransform";

type Range = { low: number; high: number };

export type VoicingOptions = {
  maxVoices?: number;          // 4 推奨（将来 5/6 に拡張可）
  range?: Range;               // MIDI範囲
  includeBass?: boolean;       // slash bass がある場合に低音として入れる
  includeRoot?: boolean;       // root を入れる（bassが無い場合）
  anchorWeight?: number;       // 平均音高が中心から離れるのを抑える
  leapPenaltyWeight?: number;  // 大跳躍抑制
  maxLeap?: number;            // これ以上の跳躍にペナルティ
};

type ToneRole =
  | "bass"
  | "root"
  | "third"
  | "seventh"
  | "altered"
  | "tension"
  | "fifth"
  | "other";

type PcInfo = {
  pc: string;
  diff: number;   // rootからの半音差(0-11)
  role: ToneRole;
};

const stripOctave = (n: string) => n.replace(/\d+/g, "");

// pc + octave -> midi
const toMidiPc = (pc: string, octave: number): number => {
  const m = Tone.Frequency(`${pc}${octave}`).toMidi();
  return Number.isFinite(m) ? m : NaN;
};

const midiToPc = (m: number): string =>
  stripOctave(Tone.Frequency(m, "midi").toNote());

const clampRange = (midis: number[], range?: Range): boolean => {
  if (!range) return true;
  return midis.every((m) => m >= range.low && m <= range.high);
};

// centerOctave は「C基準の手の位置」: C4=60
const centerCMidi = (centerOctave: number): number => {
  const m = Tone.Frequency(`C${centerOctave}`).toMidi();
  return Number.isFinite(m) ? m : 60;
};

// anchorMidi に最も近い「pc の実音midi」を返す（オクターブを自動選択）
function midiForPcNearAnchor(pc: string, anchorMidi: number): number {
  // anchorMidi 近辺の oct を推定（C4=60 -> 4）
  // midi = 12*(oct+1) + pcOffset(0..11) なので oct ≒ floor(m/12)-1
  const anchorOct = Math.floor(anchorMidi / 12) - 1;

  const candidates: number[] = [];
  for (let o = anchorOct - 2; o <= anchorOct + 2; o++) {
    const m = toMidiPc(pc, o);
    if (Number.isFinite(m)) candidates.push(m);
  }
  if (!candidates.length) {
    // フォールバック
    const m = toMidiPc(pc, 4);
    return Number.isFinite(m) ? m : anchorMidi;
  }

  let best = candidates[0];
  let bestDist = Math.abs(best - anchorMidi);
  for (const m of candidates.slice(1)) {
    const d = Math.abs(m - anchorMidi);
    if (d < bestDist) {
      bestDist = d;
      best = m;
    }
  }
  return best;
}

// 「floorMidi より上」に来るように pc を配置（近いところから上に押し上げる）
function midiForPcAbove(pc: string, floorMidi: number): number {
  let m = midiForPcNearAnchor(pc, floorMidi + 6); // 少し上側に寄せる
  while (m <= floorMidi) m += 12;
  return m;
}

function classifyChordPcs(ch: ParsedChord): { rootPc: string | null; pcs: PcInfo[] } {
  const { root } = splitChordRootAndSuffix(ch.symbol);
  if (!root) return { rootPc: null, pcs: [] };

  const info = Chord.get(ch.symbol);
  const notePcs = (info?.notes ?? []).map(stripOctave);
  if (!notePcs.length) return { rootPc: root, pcs: [] };

  const rootMidi = toMidiPc(root, 4);
  if (!Number.isFinite(rootMidi)) return { rootPc: root, pcs: [] };

  const hasM3 = notePcs.some((pc) => {
    const m = toMidiPc(pc, 4);
    const d = ((m - rootMidi) % 12 + 12) % 12;
    return d === 4;
  });

  const isDim7 = /dim7/i.test(ch.symbol);

  const pcs: PcInfo[] = notePcs
    .map((pc) => {
      const m = toMidiPc(pc, 4);
      if (!Number.isFinite(m)) return null;

      const diff = ((m - rootMidi) % 12 + 12) % 12;

      let role: ToneRole = "other";
      if (diff === 0) role = "root";
      else if (diff === 4) role = "third";
      else if (diff === 3) role = hasM3 ? "altered" : "third"; // m3 が M3 と同居→#9寄り
      else if (diff === 10 || diff === 11) role = "seventh";
      else if (isDim7 && diff === 9) role = "seventh";
      else if (diff === 7) role = "fifth";
      else if (diff === 1) role = "altered"; // b9
      else if (diff === 2) role = "tension"; // 9
      else if (diff === 5) role = "tension"; // 11
      else if (diff === 6) role = "altered"; // #11/b5
      else if (diff === 8) role = "altered"; // b13/#5
      else if (diff === 9) role = "tension"; // 13 (dim7以外)
      else role = "other";

      return { pc, diff, role } as PcInfo;
    })
    .filter(Boolean) as PcInfo[];

  pcs.sort((a, b) => a.diff - b.diff);
  return { rootPc: root, pcs };
}

function pickSetForMaxVoices(
  ch: ParsedChord,
  opts: Required<Pick<VoicingOptions, "maxVoices" | "includeBass" | "includeRoot">>
): { pcs: string[]; baseIsBass: boolean } {
  const { rootPc, pcs } = classifyChordPcs(ch);
  const maxVoices = opts.maxVoices;

  const selected: string[] = [];
  const used = new Set<string>();

  let baseIsBass = false;

  // 低音：slash bass を優先（counts as one voice）
  if (opts.includeBass && ch.bass) {
    selected.push(ch.bass);
    used.add(ch.bass);
    baseIsBass = true;
  } else if (opts.includeRoot && rootPc) {
    selected.push(rootPc);
    used.add(rootPc);
    baseIsBass = false;
  }

  // 必須：3rd / 7th
  const thirds = pcs.filter((x) => x.role === "third");
  const sevenths = pcs.filter((x) => x.role === "seventh");

  // 3rd：M3優先
  if (thirds.length) {
    const m3 = thirds.find((t) => t.diff === 4) ?? thirds[0];
    if (!used.has(m3.pc) && selected.length < maxVoices) {
      selected.push(m3.pc);
      used.add(m3.pc);
    }
  }

  // 7th：maj7(11) > b7(10) > その他
  if (sevenths.length) {
    const s =
      sevenths.find((t) => t.diff === 11) ??
      sevenths.find((t) => t.diff === 10) ??
      sevenths[0];
    if (!used.has(s.pc) && selected.length < maxVoices) {
      selected.push(s.pc);
      used.add(s.pc);
    }
  }

  // 次：altered（色）
  for (const a of pcs.filter((x) => x.role === "altered")) {
    if (selected.length >= maxVoices) break;
    if (used.has(a.pc)) continue;
    selected.push(a.pc);
    used.add(a.pc);
  }

  // 次：tension（9/11/13）
  for (const t of pcs.filter((x) => x.role === "tension")) {
    if (selected.length >= maxVoices) break;
    if (used.has(t.pc)) continue;
    selected.push(t.pc);
    used.add(t.pc);
  }

  // 次：fifth
  for (const f of pcs.filter((x) => x.role === "fifth")) {
    if (selected.length >= maxVoices) break;
    if (used.has(f.pc)) continue;
    selected.push(f.pc);
    used.add(f.pc);
  }

  // まだ足りない場合：root を追加 or 重複で埋める
  if (rootPc && selected.length < maxVoices && !used.has(rootPc)) {
    selected.push(rootPc);
    used.add(rootPc);
  }
  while (selected.length < maxVoices) {
    selected.push(selected[selected.length - 1] ?? (rootPc ?? "C"));
  }

  return { pcs: selected, baseIsBass };
}

function buildCloseStackMidis(
  pcs: string[],
  centerOctave: number,
  baseIsBass: boolean
): number[] {
  const center = centerCMidi(centerOctave);
  const baseAnchor = baseIsBass ? center - 12 : center;

  // 1) 先頭音：アンカーに最も近い位置に置く
  const basePc = pcs[0];
  let base = midiForPcNearAnchor(basePc, baseAnchor);

  const midis: number[] = [base];

  // 2) 残り：常に上に積む（クローズ寄り）
  for (let i = 1; i < pcs.length; i++) {
    const pc = pcs[i];
    const m = midiForPcAbove(pc, midis[midis.length - 1]);
    midis.push(m);
  }

  midis.sort((a, b) => a - b);
  return midis;
}

function invertOnce(midis: number[]): number[] {
  if (midis.length <= 1) return midis.slice();
  const next = midis.slice();
  next[0] = next[0] + 12;
  next.sort((a, b) => a - b);
  return next;
}

function generateCandidates(base: number[]): number[][] {
  const invs: number[][] = [];
  let cur = base.slice();
  invs.push(cur);
  for (let i = 1; i < base.length; i++) {
    cur = invertOnce(cur);
    invs.push(cur);
  }

  const shifts = [-12, 0, 12];
  const out: number[][] = [];
  for (const v of invs) {
    for (const s of shifts) out.push(v.map((m) => m + s));
  }
  return out;
}

function cost(
  cand: number[],
  prev: number[] | null,
  centerOctave: number,
  opts: Required<Pick<VoicingOptions, "anchorWeight" | "leapPenaltyWeight" | "maxLeap">>
): number {
  const center = centerCMidi(centerOctave);

  // アンカー：平均音高が中心から離れるのを抑える
  const avg = cand.reduce((a, b) => a + b, 0) / Math.max(1, cand.length);
  let c = opts.anchorWeight * Math.abs(avg - center);

  if (!prev || prev.length !== cand.length) return c;

  // 声部対応（インデックス同士）で距離
  for (let i = 0; i < cand.length; i++) {
    const d = Math.abs(cand[i] - prev[i]);
    c += d;
    if (d > opts.maxLeap) c += (d - opts.maxLeap) * opts.leapPenaltyWeight;
  }
  return c;
}

export function voicingForChord(
  ch: ParsedChord,
  centerOctave: number,
  prevMidis: number[] | null,
  options?: VoicingOptions
): { notes: string[]; midis: number[]; pcs: string[] } {
  const opts: Required<VoicingOptions> = {
    maxVoices: options?.maxVoices ?? 4,
    range: options?.range ?? { low: 36, high: 84 }, // C2〜C6
    includeBass: options?.includeBass ?? true,
    includeRoot: options?.includeRoot ?? true,
    anchorWeight: options?.anchorWeight ?? 0.35,
    leapPenaltyWeight: options?.leapPenaltyWeight ?? 0.7,
    maxLeap: options?.maxLeap ?? 7,
  };

  // 1) 採用する pcs を選ぶ（色を残す）
  const picked = pickSetForMaxVoices(ch, {
    maxVoices: opts.maxVoices,
    includeBass: opts.includeBass,
    includeRoot: opts.includeRoot,
  });

  // 2) クローズに積む（中心オクターブ基準）
  const base = buildCloseStackMidis(picked.pcs, centerOctave, picked.baseIsBass);

  // 3) 転回×±12 で候補生成し、レンジでフィルタ
  const candidates = generateCandidates(base).filter((m) => clampRange(m, opts.range));
  const pool = candidates.length ? candidates : [base];

  // 4) 前後最小移動 + アンカーで選ぶ
  let best = pool[0];
  let bestCost = cost(best, prevMidis, centerOctave, opts);
  for (const cand of pool.slice(1)) {
    const cc = cost(cand, prevMidis, centerOctave, opts);
    if (cc < bestCost) {
      bestCost = cc;
      best = cand;
    }
  }

  const notes = best.map((m) => Tone.Frequency(m, "midi").toNote());
  return { notes, midis: best, pcs: best.map(midiToPc) };
}
