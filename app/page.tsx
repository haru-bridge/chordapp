"use client";

import React, { useState, ChangeEvent } from "react";
import * as Tone from "tone";
import {
  ParsedChord,
  parseProgression,
  chordToNotes,
} from "../lib/chordEngine";
import { ChordPadGrid } from "../components/ChordPadGrid";



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

  // 拍数を ±1 する（1〜16 にクランプ）
  const stepBeats = (delta: number) => {
    setBeatsPerChord((prev) => {
      const next = prev + delta;
      if (next < 1) return 1;
      if (next > 16) return 16;
      return next;
    });
  };

  // ルートオクターブを ±1 する（1〜6 にクランプ）
  const stepRootOctave = (delta: number) => {
    setRootOctave((prev) => {
      const next = prev + delta;
      if (next < 1) return 1;
      if (next > 6) return 6;
      return next;
    });
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
        bass: ch.bass,
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
        background: "#020617",
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
            例（丸サ進行 / Cメジャー）: <code>Fmaj7 E7 Am7 Dm7 G7</code>
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

            {/* 拍数（ステッパー） */}
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
              <div
                style={{
                  marginTop: 4,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <button
                  type="button"
                  onClick={() => stepBeats(-1)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    border: "1px solid #374151",
                    background: "#020617",
                    color: "#e5e7eb",
                    cursor: "pointer",
                  }}
                >
                  −
                </button>
                <span
                  style={{
                    minWidth: 32,
                    textAlign: "center",
                    padding: "4px 8px",
                    borderRadius: 8,
                    border: "1px solid #374151",
                    background: "#020617",
                    fontVariantNumeric: "tabular-nums",
                    fontSize: 13,
                  }}
                >
                  {beatsPerChord}
                </span>
                <button
                  type="button"
                  onClick={() => stepBeats(1)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    border: "1px solid #374151",
                    background: "#020617",
                    color: "#e5e7eb",
                    cursor: "pointer",
                  }}
                >
                  ＋
                </button>
              </div>
            </div>

            {/* オクターブ（ステッパー） */}
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
              <div
                style={{
                  marginTop: 4,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <button
                  type="button"
                  onClick={() => stepRootOctave(-1)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    border: "1px solid #374151",
                    background: "#020617",
                    color: "#e5e7eb",
                    cursor: "pointer",
                  }}
                >
                  −
                </button>
                <span
                  style={{
                    minWidth: 32,
                    textAlign: "center",
                    padding: "4px 8px",
                    borderRadius: 8,
                    border: "1px solid #374151",
                    background: "#020617",
                    fontVariantNumeric: "tabular-nums",
                    fontSize: 13,
                  }}
                >
                  {rootOctave}
                </span>
                <button
                  type="button"
                  onClick={() => stepRootOctave(1)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    border: "1px solid #374151",
                    background: "#020617",
                    color: "#e5e7eb",
                    cursor: "pointer",
                  }}
                >
                  ＋
                </button>
              </div>
            </div>
          </div>
        </section>
        {/* パッド演奏モード */}
        <section
          style={{
            marginTop: 24,
            paddingTop: 16,
            borderTop: "1px solid #111827",
          }}
        >
          <ChordPadGrid chords={previewChords} rootOctave={rootOctave} />
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
