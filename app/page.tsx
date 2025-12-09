"use client";

import React, { useState, ChangeEvent } from "react";
import * as Tone from "tone";
import { Chord } from "tonal";

type ParsedChord = {
  raw: string;      // 入力そのまま（表示用）
  symbol: string;   // スラッシュ前の部分
  bass?: string | null;
};

/** 文字コード系を Tonal が読める形に揃える */
function normalizeChordSymbol(symbol: string): string {
  let s = symbol.trim();

  // 全角スペース削除
  s = s.replace(/\u3000/g, " ");

  // メジャー7の△記号 → maj
  // （△ U+25B3, Δ U+0394 両方ケア）
  s = s.replace(/[△Δ]/g, "maj");

  // ♭ / ♯ を b / #
  s = s.replace(/♭/g, "b").replace(/♯/g, "#");

  // 全角カッコ → 半角
  s = s.replace(/（/g, "(").replace(/）/g, ")");

  // Bm7(♭5) → Bm7♭5 → Bm7b5
  s = s.replace(/\(([^)]+)\)/g, "$1");

  // もう一度フラットを ascii に
  s = s.replace(/♭/g, "b");

  return s;
}

/**
 * テキスト（例: "Db Ab/C Bbm7 Gbmaj7"）をパース
 */
function parseProgression(
  input: string,
  options?: { silent?: boolean }
): ParsedChord[] {
  const tokens: string[] = input
    // 空白・カンマ・縦棒・矢印・ハイフンで区切る
    // 例: "F△7 - B♭7 - Em7" に対応
    .split(/[\s,|→\-–]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const result: ParsedChord[] = tokens.map((token: string) => {
    const [symbol, bass] = token.split("/");
    return {
      raw: token,
      symbol,
      bass: bass ?? null,
    };
  });

  if (!options?.silent) {
    console.log("parseProgression result:", result);
  }

  return result;
}

/**
 * Chord.get の結果から、実際に鳴らすノート配列に変換
 * rootOctave でルートの高さだけ調整できる
 */
function chordToNotes(parsed: ParsedChord, rootOctave: number): string[] {
  // ここで F△7 / B♭7 / Bm7(♭5) などを Tonal 用に正規化
  const normalized = normalizeChordSymbol(parsed.symbol);

  // ローマ数字など、音名で始まらないものはスキップ（(IV) とか）
  if (!/^[A-G][#b]?/i.test(normalized)) {
    console.log("skip non-pitch symbol:", parsed.symbol, "=>", normalized);
    return [];
  }

  const info = Chord.get(normalized);

  console.log("Chord.get:", {
    inputSymbol: parsed.symbol,
    normalizedSymbol: normalized,
    chordInfo: info,
  });

  if (!info || info.empty || !info.notes || info.notes.length === 0) {
    console.warn("解釈できないコード:", parsed.raw, info);
    return [];
  }

  // 例: ["F", "A", "C", "E"]
  const pcs: string[] = info.notes.slice();

  const notes: string[] = [];
  const midis: number[] = [];

  // 1. ルートを rootOctave に置く
  const rootPc = pcs[0];
  const rootNote = `${rootPc}${rootOctave}`;
  const rootMidi = Tone.Frequency(rootNote).toMidi();

  notes.push(rootNote);
  midis.push(rootMidi);

  // 2. 残りの構成音は「直前より下がらないように」上に積む
  for (let i = 1; i < pcs.length; i++) {
    const pc = pcs[i];

    let octave = rootOctave;
    let noteName = `${pc}${octave}`;
    let midi = Tone.Frequency(noteName).toMidi();

    // 直前の音以下ならオクターブを上げていく
    while (midi <= midis[midis.length - 1]) {
      octave++;
      noteName = `${pc}${octave}`;
      midi = Tone.Frequency(noteName).toMidi();
    }

    notes.push(noteName);
    midis.push(midi);
  }

  // 3. 分数コードがあれば、ベースはルートより下になるまで下げて先頭に追加
  if (parsed.bass) {
    let bassOct = rootOctave - 1;
    let bassName = `${parsed.bass}${bassOct}`;
    let bassMidi = Tone.Frequency(bassName).toMidi();

    while (bassMidi >= midis[0]) {
      bassOct--;
      bassName = `${parsed.bass}${bassOct}`;
      bassMidi = Tone.Frequency(bassName).toMidi();
    }

    const bassNote = Tone.Frequency(bassMidi, "midi").toNote();
    notes.unshift(bassNote);
    midis.unshift(bassMidi);
  }

  console.log("chordToNotes (voiced):", {
    raw: parsed.raw,
    symbol: parsed.symbol,
    normalizedSymbol: normalized,
    bass: parsed.bass,
    pitchClasses: pcs,
    notesWithOctave: notes,
    midis,
  });

  return notes;
}

export default function Home() {
  // デフォルトは Cメジャーの丸サ進行
  const [input, setInput] = useState<string>("Fmaj7 E7 Am7 Dm7 G7");
  const [bpm, setBpm] = useState<number>(90);
  const [beatsPerChord, setBeatsPerChord] = useState<number>(4);
  const [rootOctave, setRootOctave] = useState<number>(3);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  // 画面表示用のプレビュー（ログは抑制）
  const previewChords = parseProgression(input, { silent: true });

  const handleInputChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  };

  const handleBpmChange = (e: ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    if (!Number.isNaN(v)) {
      setBpm(v);
    }
  };

  const handleBeatsChange = (e: ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    if (!Number.isNaN(v) && v > 0) {
      setBeatsPerChord(v);
    }
  };

  const handleRootOctaveChange = (e: ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    if (!Number.isNaN(v)) {
      setRootOctave(v);
    }
  };

  const handlePlay = async () => {
    console.clear();
    console.log("=== PLAY START ===");
    console.log("raw input:", input);

    const chords: ParsedChord[] = parseProgression(input);
    if (chords.length === 0) {
      console.warn("コードが1つもパースできなかったので再生しません");
      return;
    }

    console.log("parsed chords:", chords);
    console.log("settings:", {
      bpm,
      beatsPerChord,
      rootOctave,
    });

    await Tone.start();

    // 音割れ対策：リミッター＋まろやかなシンセ
    const limiter = new Tone.Limiter(-8).toDestination();
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: {
        type: "sine",
      },
      envelope: {
        attack: 0.01,
        decay: 0.1,
        sustain: 0.7,
        release: 0.3,
      },
    }).connect(limiter);

    synth.volume.value = -10;

    const secondsPerBeat = 60 / bpm;
    const intervalSec = beatsPerChord * secondsPerBeat;
    const noteDurationSec = intervalSec * 0.9;
    const now = Tone.now();

    console.log("timing:", {
      secondsPerBeat,
      intervalSecPerChord: intervalSec,
      noteDurationSec,
      startAt: now,
    });

    chords.forEach((ch: ParsedChord, i: number) => {
      const notes: string[] = chordToNotes(ch, rootOctave);
      if (notes.length === 0) return;

      const startTime = now + i * intervalSec;

      const detail = notes.map((n: string) => {
        const freq = Tone.Frequency(n);
        return {
          note: n,
          frequencyHz: freq.toFrequency(),
          midi: freq.toMidi(),
        };
      });

      console.log(`Chord #${i + 1}`, {
        index: i,
        raw: ch.raw,
        symbol: ch.symbol,
        notes,
        noteDetail: detail,
        startTimeRelativeSec: startTime - now,
        durationSec: noteDurationSec,
      });

      synth.triggerAttackRelease(notes, noteDurationSec, startTime);
    });

    setIsPlaying(true);

    const totalMs = chords.length * intervalSec * 1000 + 500;
    setTimeout(() => {
      synth.dispose();
      setIsPlaying(false);
      console.log("=== PLAY END ===");
    }, totalMs);
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        margin: 0,
        padding: "40px 16px",
        background: "#020617", // 背景: ほぼ黒
        color: "#e5e7eb",
        fontFamily:
          'system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 760,
          background: "#020617",
          borderRadius: 16,
          border: "1px solid #1f2937",
          boxShadow: "0 18px 45px rgba(0,0,0,0.55)",
          padding: 24,
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 16,
          }}
        >
          <div>
            <h1
              style={{
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: 0.4,
              }}
            >
              コード進行プレイヤー
            </h1>
            <p
              style={{
                marginTop: 4,
                fontSize: 12,
                color: "#9ca3af",
              }}
            >
              テキストでコードを書いて、そのままブラウザで鳴らす
              &nbsp;—&nbsp;Tone.js × tonal
            </p>
          </div>
          <span
            style={{
              fontSize: 11,
              color: "#6b7280",
            }}
          >
            v0.1 prototype
          </span>
        </header>

        {/* コード入力 */}
        <section style={{ marginTop: 12 }}>
          <label
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            コード進行
          </label>
          <textarea
            value={input}
            onChange={handleInputChange}
            rows={3}
            style={{
              width: "100%",
              padding: 12,
              borderRadius: 10,
              border: "1px solid #374151",
              background: "#020617",
              color: "#e5e7eb",
              resize: "vertical",
              fontFamily: "Menlo, Monaco, Consolas, monospace",
              fontSize: 14,
              lineHeight: 1.5,
            }}
            placeholder="例: Fmaj7 E7 Am7 Dm7 G7"
          />

          {/* パース済みコードのチップ表示 */}
          <div style={{ marginTop: 8, minHeight: 28 }}>
            {previewChords.length > 0 ? (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  alignItems: "center",
                }}
              >
                {previewChords.map((ch: ParsedChord, idx: number) => (
                  <span
                    key={`${ch.raw}-${idx}`}
                    style={{
                      padding: "3px 10px",
                      borderRadius: 999,
                      border: "1px solid #374151",
                      fontSize: 12,
                      background: "#0b1120",
                    }}
                  >
                    {ch.raw}
                  </span>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: 12, color: "#6b7280" }}>
                コードを半角スペース区切りで入力してください
              </span>
            )}
          </div>

          <p
            style={{
              marginTop: 10,
              color: "#6b7280",
              fontSize: 11,
              lineHeight: 1.5,
            }}
          >
            例（丸サ進行 / Cメジャー）:{" "}
            <code>Fmaj7 E7 Am7 Dm7 G7</code>
            <br />
            例（Db の進行）: <code>Db Ab/C Bbm7 Gbmaj7</code>
            <br />
            空白・カンマ・「|」「→」・「-」で区切って入力できます。
          </p>
        </section>

        {/* コントロール */}
        <section
          style={{
            marginTop: 20,
            paddingTop: 16,
            borderTop: "1px solid #111827",
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 24,
              alignItems: "flex-end",
            }}
          >
            {/* BPM */}
            <div style={{ minWidth: 200 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                BPM
              </label>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  marginTop: 4,
                }}
              >
                <span
                  style={{
                    width: 40,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                    fontSize: 13,
                  }}
                >
                  {bpm}
                </span>
                <input
                  type="range"
                  min={40}
                  max={220}
                  value={bpm}
                  onChange={handleBpmChange}
                  style={{ flex: 1 }}
                />
              </div>
            </div>

            {/* 拍数 */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                1コードの長さ（拍）
              </label>
              <input
                type="number"
                min={1}
                max={16}
                value={beatsPerChord}
                onChange={handleBeatsChange}
                style={{
                  marginTop: 4,
                  width: 80,
                  padding: "4px 6px",
                  borderRadius: 8,
                  border: "1px solid #374151",
                  background: "#020617",
                  color: "#e5e7eb",
                  fontSize: 13,
                  textAlign: "right",
                }}
              />
            </div>

            {/* オクターブ */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                ルートのオクターブ
              </label>
              <input
                type="number"
                min={1}
                max={6}
                value={rootOctave}
                onChange={handleRootOctaveChange}
                style={{
                  marginTop: 4,
                  width: 80,
                  padding: "4px 6px",
                  borderRadius: 8,
                  border: "1px solid #374151",
                  background: "#020617",
                  color: "#e5e7eb",
                  fontSize: 13,
                  textAlign: "right",
                }}
              />
            </div>
          </div>
        </section>

        {/* 再生ボタン */}
        <section
          style={{
            marginTop: 28,
            display: "flex",
            justifyContent: "flex-start",
          }}
        >
          <button
            onClick={handlePlay}
            disabled={isPlaying || previewChords.length === 0}
            style={{
              padding: "10px 26px",
              fontSize: 15,
              fontWeight: 600,
              borderRadius: 999,
              border: "none",
              cursor:
                isPlaying || previewChords.length === 0
                  ? "not-allowed"
                  : "pointer",
              background:
                isPlaying || previewChords.length === 0
                  ? "#374151"
                  : "linear-gradient(135deg, #22c55e, #16a34a)",
              color: "#0b1120",
              boxShadow:
                isPlaying || previewChords.length === 0
                  ? "none"
                  : "0 8px 22px rgba(34,197,94,0.35)",
              transition: "transform 0.08s ease-out, box-shadow 0.08s ease-out",
            }}
          >
            {isPlaying ? "再生中..." : "再生"}
          </button>
        </section>
      </div>
    </main>
  );
}
