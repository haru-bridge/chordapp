"use client";

import React, { useRef, useEffect } from "react";
import * as Tone from "tone";
import { ParsedChord, chordToNotes } from "../lib/chordEngine";


type ChordPadGridProps = {
  chords: ParsedChord[]; // parseProgression の結果
  rootOctave: number;
};

const MAX_PADS = 9;

export const ChordPadGrid: React.FC<ChordPadGridProps> = ({
  chords,
  rootOctave,
}) => {
  const synthRef = useRef<Tone.PolySynth | null>(null);

  // アンマウント時にシンセ破棄
  useEffect(() => {
    return () => {
      if (synthRef.current) {
        synthRef.current.dispose();
        synthRef.current = null;
      }
    };
  }, []);

  async function ensureSynth() {
    if (!synthRef.current) {
      await Tone.start();
      const limiter = new Tone.Limiter(-8).toDestination();
      const synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: {
          attack: 0.01,
          decay: 0.1,
          sustain: 0.7,
          release: 0.2,
        },
      }).connect(limiter);
      synth.volume.value = -10;
      synthRef.current = synth;
    }
    return synthRef.current;
  }

  const handlePadDown = async (chord: ParsedChord) => {
    const synth = await ensureSynth();
    const notes = chordToNotes(chord, rootOctave);
    if (notes.length === 0) return;
    synth.triggerAttack(notes); // 押している間鳴らす
  };

  const handlePadUp = (chord: ParsedChord) => {
    const synth = synthRef.current;
    if (!synth) return;
    const notes = chordToNotes(chord, rootOctave);
    if (notes.length === 0) return;
    synth.triggerRelease(notes);
  };

  const pads = chords.slice(0, MAX_PADS);

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
            onMouseDown={() => handlePadDown(ch)}
            onMouseUp={() => handlePadUp(ch)}
            onMouseLeave={() => handlePadUp(ch)}
            onTouchStart={(e) => {
              e.preventDefault();
              handlePadDown(ch);
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              handlePadUp(ch);
            }}
            onTouchCancel={(e) => {
              e.preventDefault();
              handlePadUp(ch);
            }}
            style={{
              borderRadius: 18,
              border: "1px solid #1f2937",
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
              transition:
                "transform 0.06s ease-out, box-shadow 0.06s ease-out",
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
            color: "#6b7280",
          }}
        >
          ※ 先頭から 9 個までのコードがパッドに割り当てられています。
        </p>
      )}
    </div>
  );
};
