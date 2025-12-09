"use client";

import React, { useRef, useEffect } from "react";
import * as Tone from "tone";
import { ParsedChord, chordToNotes } from "../lib/chordEngine";

type ChordPadGridProps = {
  chords: ParsedChord[];
  rootOctave: number;
};

const MAX_PADS = 9;

export const ChordPadGrid: React.FC<ChordPadGridProps> = ({
  chords,
  rootOctave,
}) => {
  const synthRef = useRef<Tone.PolySynth | null>(null);
  const heldNotesRef = useRef<Record<number, string[]>>({});
  const isPadHeldRef = useRef<Record<number, boolean>>({});

  /** すべての PAD を強制ストップ */
  const stopAllPads = () => {
    isPadHeldRef.current = {};
    heldNotesRef.current = {};

    const synth = synthRef.current;
    if (!synth) return;

    // 発音中のすべてのノートを解放
    synth.releaseAll();
  };

  // アンマウント & グローバルイベントの登録
  useEffect(() => {
    const handleGlobalPointerEnd = () => {
      stopAllPads();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stopAllPads();
      }
    };

    window.addEventListener("pointerup", handleGlobalPointerEnd);
    window.addEventListener("pointercancel", handleGlobalPointerEnd);
    window.addEventListener("blur", handleGlobalPointerEnd);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pointerup", handleGlobalPointerEnd);
      window.removeEventListener("pointercancel", handleGlobalPointerEnd);
      window.removeEventListener("blur", handleGlobalPointerEnd);
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      if (synthRef.current) {
        synthRef.current.releaseAll();
        synthRef.current.dispose();
        synthRef.current = null;
      }
      heldNotesRef.current = {};
      isPadHeldRef.current = {};
    };
  }, []);

  /** Pad 用シンセを lazy に確保 */
  const ensureSynth = async (): Promise<Tone.PolySynth> => {
    if (!synthRef.current) {
      await Tone.start();

      const limiter = new Tone.Limiter(-12).toDestination();
      const synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: {
          attack: 0.01,
          decay: 0.1,
          sustain: 0.7,
          release: 0.2,
        },
      }).connect(limiter);

      synth.volume.value = -18; // モバイル向けに小さめ

      synthRef.current = synth;
    }
    return synthRef.current;
  };

  const pads = chords.slice(0, MAX_PADS);

  /** 実際に PAD を鳴らし始める処理 */
  const startPad = async (padIndex: number) => {
    const chord = pads[padIndex];
    if (!chord) return;

    // 押された印を先につけておく（async 用）
    isPadHeldRef.current[padIndex] = true;

    const synth = await ensureSynth();

    // Tone.start() 待ちの間に離されていたら中断
    if (!isPadHeldRef.current[padIndex]) return;

    const notes = chordToNotes(chord, rootOctave);
    if (!notes.length) return;

    heldNotesRef.current[padIndex] = notes;
    synth.triggerAttack(notes, undefined, 0.9);
  };

  /** PAD を止める処理 */
  const stopPad = (padIndex: number) => {
    isPadHeldRef.current[padIndex] = false;

    const synth = synthRef.current;
    if (!synth) return;

    const notes = heldNotesRef.current[padIndex];
    if (!notes || !notes.length) return;

    synth.triggerRelease(notes);
    delete heldNotesRef.current[padIndex];
  };

  if (pads.length === 0) {
    return (
      <p style={{ fontSize: 12, color: "#6b7280", marginTop: 8 }}>
        コードを入力すると、ここにパッドが並びます。
      </p>
    );
  }

  return (
    <div style={{ marginTop: 16 }}>
      <h2
        style={{
          fontSize: 13,
          fontWeight: 600,
          marginBottom: 8,
        }}
      >
        パッド演奏モード
      </h2>
      <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>
        それぞれのパッドにコードが割り当てられます。押している間だけ音が鳴ります。
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 12,
        }}
      >
        {pads.map((ch, idx) => (
          <button
            key={`${ch.raw}-${idx}`}
            type="button"
            onPointerDown={(e: React.PointerEvent<HTMLButtonElement>) => {
              e.preventDefault();
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                /* ignore */
              }
              startPad(idx);
            }}
            onPointerUp={(e: React.PointerEvent<HTMLButtonElement>) => {
              e.preventDefault();
              try {
                e.currentTarget.releasePointerCapture(e.pointerId);
              } catch {
                /* ignore */
              }
              stopPad(idx);
            }}
            onPointerLeave={(e: React.PointerEvent<HTMLButtonElement>) => {
              e.preventDefault();
              stopPad(idx);
            }}
            onPointerCancel={(e: React.PointerEvent<HTMLButtonElement>) => {
              e.preventDefault();
              stopPad(idx);
            }}
            // 長押しコンテキストメニューを潰す & 念のためストップ
            onContextMenu={(e: React.MouseEvent<HTMLButtonElement>) => {
              e.preventDefault();
              stopPad(idx);
            }}
            style={{
              borderRadius: 18,
              border: "1px solid #262547ff",
              padding: "18px 12px",
              background:
                "radial-gradient(circle at 30% 30%, #1f2937, #020617 70%)",
              color: "#e5e7eb",
              boxShadow: "0 10px 25px rgba(0,0,0,0.45)",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              outline: "none",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              transition: "transform 0.06s ease-out, box-shadow 0.06s ease-out",
              userSelect: "none",
              touchAction: "manipulation",
            }}
          >
            <span
              style={{
                fontSize: 11,
                opacity: 0.6,
                marginBottom: 4,
              }}
            >
              PAD {idx + 1}
            </span>
            <span
              style={{
                fontSize: 16,
                fontFamily: "Menlo, Monaco, Consolas, monospace",
              }}
            >
              {ch.raw}
            </span>
          </button>
        ))}
      </div>

      {chords.length > MAX_PADS && (
        <p
          style={{
            marginTop: 6,
            fontSize: 11,
            color: "#33405fff",
          }}
        >
          ※ 先頭から 9 個までのコードがパッドに割り当てられています。
        </p>
      )}
    </div>
  );
};
