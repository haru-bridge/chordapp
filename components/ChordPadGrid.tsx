"use client";

import React, { useRef, useEffect, useCallback } from "react";
import * as Tone from "tone";
import { ParsedChord } from "../lib/chordEngine";
import { NOTES_DEBUG, dlog } from "../lib/debug";

type PadItem = {
  chord: ParsedChord; // 変換後（再生用）のコード
  notes: string[]; // 事前計算済み
  label?: string; // UI表示用（任意）
};

type ChordPadGridProps = {
  padItems: PadItem[];
};

const noteDetail = (n: string) => {
  const f = Tone.Frequency(n);
  return { note: n, midi: f.toMidi(), hz: f.toFrequency() };
};

const isTypingActive = () => {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    el.isContentEditable
  );
};

const keyToPadIndex = (e: KeyboardEvent): number | null => {
  // 1..9 / Numpad1..Numpad9
  let s: string | null = null;
  if (e.code.startsWith("Digit")) s = e.code.replace("Digit", "");
  else if (e.code.startsWith("Numpad")) s = e.code.replace("Numpad", "");

  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 1 || n > 9) return null;
  return n - 1;
};

export const ChordPadGrid: React.FC<ChordPadGridProps> = ({ padItems }) => {
  const synthRef = useRef<Tone.PolySynth | null>(null);

  // padごとに「このpadを何ソースで押してるか」（キーボード＋ポインタ同時押し対策）
  const padHoldCountsRef = useRef<Record<number, number>>({});

  // padごとに、そのpadが鳴らしている notes（stopで参照）
  const heldNotesRef = useRef<Record<number, string[]>>({});

  // ポインタ追跡（既存ロジック維持）
  const activePointersRef = useRef<Set<number>>(new Set());

  // noteの参照カウント（複数padで同じ音を鳴らしても破綻しない）
  const noteCountsRef = useRef<Record<string, number>>({});

  // キーボード押下中pad
  const kbdDownRef = useRef<Set<number>>(new Set());

  const stopAllPads = useCallback(() => {
    padHoldCountsRef.current = {};
    heldNotesRef.current = {};
    activePointersRef.current = new Set();
    noteCountsRef.current = {};
    kbdDownRef.current = new Set();
    synthRef.current?.releaseAll();
  }, []);

  useEffect(() => {
    const handleGlobalPointerUp = (e: PointerEvent) => {
      activePointersRef.current.delete(e.pointerId);
      if (activePointersRef.current.size === 0) {
        // pointer由来のホールドを全部落とす
        // （kbdは別に落としたくないので、kbdDownが残ってるpadはstopしない）
        // ただし現状「padHoldCountsRef」にsource区別は無いので、
        // pointerが0になった時点で全OFFにするのが一番安全。
        // ここは既存挙動を維持。
        stopAllPads();
      }
    };

    const handleGlobalPointerCancel = (e: PointerEvent) => {
      activePointersRef.current.delete(e.pointerId);
      if (activePointersRef.current.size === 0) stopAllPads();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") stopAllPads();
    };

    const handleBlur = () => stopAllPads();

    window.addEventListener("pointerup", handleGlobalPointerUp);
    window.addEventListener("pointercancel", handleGlobalPointerCancel);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pointerup", handleGlobalPointerUp);
      window.removeEventListener("pointercancel", handleGlobalPointerCancel);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);

      stopAllPads();
      if (synthRef.current) {
        synthRef.current.dispose();
        synthRef.current = null;
      }
    };
  }, [stopAllPads]);

  const initSynth = useCallback(async () => {
    if (synthRef.current) return synthRef.current;

    await Tone.start();

    const limiter = new Tone.Limiter(-12).toDestination();
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.2 },
    }).connect(limiter);

    synth.volume.value = -18;
    synthRef.current = synth;
    return synth;
  }, []);

  const startPad = useCallback(
    async (padIndex: number) => {
      const item = padItems[padIndex];
      if (!item) return;

      const notes = item.notes ?? [];
      if (!notes.length) return;

      const cur = padHoldCountsRef.current[padIndex] ?? 0;
      padHoldCountsRef.current[padIndex] = cur + 1;

      // 既に同じpadをどこかで押しているなら、追加で鳴らさない
      if (cur >= 1) return;

      if (NOTES_DEBUG) {
        dlog("[PAD ON]", {
          pad: padIndex + 1,
          chord: item.chord,
          notes,
          detail: notes.map(noteDetail),
        });
      }

      // synthがすでにあるなら同期で鳴らす（初回のawaitを避ける）
      if (synthRef.current) {
        heldNotesRef.current[padIndex] = notes;

        for (const n of notes) {
          const next = (noteCountsRef.current[n] ?? 0) + 1;
          noteCountsRef.current[n] = next;
          if (next === 1) synthRef.current.triggerAttack(n, undefined, 0.9);
        }
        return;
      }

      const synth = await initSynth();

      // init中にstopされていたら何もしない
      if ((padHoldCountsRef.current[padIndex] ?? 0) <= 0) return;

      heldNotesRef.current[padIndex] = notes;

      for (const n of notes) {
        const next = (noteCountsRef.current[n] ?? 0) + 1;
        noteCountsRef.current[n] = next;
        if (next === 1) synth.triggerAttack(n, undefined, 0.9);
      }
    },
    [padItems, initSynth]
  );

  const stopPad = useCallback((padIndex: number) => {
    const cur = padHoldCountsRef.current[padIndex] ?? 0;
    const nextHold = cur - 1;

    if (nextHold > 0) {
      padHoldCountsRef.current[padIndex] = nextHold;
      return;
    }

    delete padHoldCountsRef.current[padIndex];

    const synth = synthRef.current;
    if (!synth) return;

    const notes = heldNotesRef.current[padIndex];
    if (!notes?.length) return;

    if (NOTES_DEBUG) {
      dlog("[PAD OFF]", { pad: padIndex + 1, notes });
    }

    for (const n of notes) {
      const next = (noteCountsRef.current[n] ?? 0) - 1;
      if (next <= 0) {
        delete noteCountsRef.current[n];
        synth.triggerRelease(n);
      } else {
        noteCountsRef.current[n] = next;
      }
    }

    delete heldNotesRef.current[padIndex];
  }, []);

  // 追加：キーボード 1-9 / Numpad1-9 で pad を鳴らす
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (isTypingActive()) return;

      const idx = keyToPadIndex(e);
      if (idx === null) return;
      if (idx < 0 || idx >= padItems.length) return;

      e.preventDefault();

      if (kbdDownRef.current.has(idx)) return;
      kbdDownRef.current.add(idx);
      startPad(idx);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (isTypingActive()) return;

      const idx = keyToPadIndex(e);
      if (idx === null) return;

      e.preventDefault();

      if (!kbdDownRef.current.has(idx)) return;
      kbdDownRef.current.delete(idx);
      stopPad(idx);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [padItems.length, startPad, stopPad]);

  if (padItems.length === 0) {
    return (
      <p style={{ fontSize: 12, color: "#6b7280", marginTop: 8 }}>
        コード（またはローマ数字）を入力すると、ここにパッドが並びます。
      </p>
    );
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <div>
          <h2 style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            パッド演奏モード
          </h2>
          <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>
            複数同時押し対応。キーボード「1〜9」でも鳴らせます。
          </p>
        </div>

        <button
          type="button"
          onClick={() => stopAllPads()}
          style={{
            padding: "8px 12px",
            borderRadius: 999,
            border: "1px solid #374151",
            background: "#111827",
            color: "#e5e7eb",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          ALL OFF
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 12,
        }}
      >
        {padItems.map((item, idx) => (
          <button
            key={`${item.chord.symbol}-${idx}`}
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              activePointersRef.current.add(e.pointerId);
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {}
              startPad(idx);
            }}
            onPointerUp={(e) => {
              e.preventDefault();
              activePointersRef.current.delete(e.pointerId);
              try {
                e.currentTarget.releasePointerCapture(e.pointerId);
              } catch {}
              stopPad(idx);
            }}
            onPointerCancel={(e) => {
              e.preventDefault();
              activePointersRef.current.delete(e.pointerId);
              stopPad(idx);
            }}
            onPointerLeave={(e) => {
              e.preventDefault();
              stopPad(idx);
            }}
            onContextMenu={(e) => {
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
              userSelect: "none",
              touchAction: "manipulation",
            }}
          >
            <span style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>
              PAD {idx + 1}
            </span>
            <span
              style={{
                fontSize: 16,
                fontFamily: "Menlo, Monaco, Consolas, monospace",
              }}
            >
              {item.label ?? item.chord.raw ?? item.chord.symbol}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
