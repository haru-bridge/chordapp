"use client";

import React, {
  useMemo,
  useRef,
  useEffect,
  useState,
  ChangeEvent,
} from "react";
import * as Tone from "tone";

import {
  ParsedItem,
  ParsedChord,
  parseChordInputDetailed,
  chordToNotes,
} from "../lib/chordEngine";

import {
  parseRomanInputDetailed,
  itemsToPlayableChords,
} from "../lib/romanEngine";
import {
  
  KeySpec,
  semitoneShift,
  transposeChord,
  romanDegreeForChord,
  formatChordSymbol,
} from "../lib/keyTransform";

import { ChordPadGrid } from "../components/ChordPadGrid";

type InputMode = "chord" | "roman";

const MAX_PADS = 9;
const TONICS = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const;
type Tonic = (typeof TONICS)[number];

type KeyMode = "major" | "minor";


export default function Home() {
  const playSynthRef = useRef<Tone.PolySynth | null>(null);
  const playLimiterRef = useRef<Tone.Limiter | null>(null);
  const playTimeoutRef = useRef<number | null>(null);

  const [inputMode, setInputMode] = useState<InputMode>("chord");

  const [input, setInput] = useState<string>("Fmaj7 E7 Am7 Dm7 G7");
  const [bpm, setBpm] = useState<number>(90);
  const [beatsPerChord, setBeatsPerChord] = useState<number>(4);
  const [rootOctave, setRootOctave] = useState<number>(3);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  const [fromTonic, setFromTonic] = useState<Tonic>("C");
  const [fromMode, setFromMode] = useState<KeyMode>("major");

  const [toTonic, setToTonic] = useState<Tonic>("C");
  const [toMode, setToMode] = useState<KeyMode>("major");


  const fromKey: KeySpec = useMemo(
    () => ({ tonic: fromTonic, mode: fromMode }),
    [fromTonic, fromMode]
  );
  const toKey: KeySpec = useMemo(
    () => ({ tonic: toTonic, mode: toMode }),
    [toTonic, toMode]
  );

  const parsedItems: ParsedItem[] = useMemo(() => {
    if (inputMode === "roman")
      return parseRomanInputDetailed(input, fromKey, { silent: true });
    return parseChordInputDetailed(input, { silent: true });
  }, [input, inputMode, fromKey]);

  const playableOriginal: ParsedChord[] = useMemo(() => {
    return itemsToPlayableChords(parsedItems);
  }, [parsedItems]);

  const shift = useMemo(
    () => semitoneShift(fromKey.tonic, toKey.tonic),
    [fromKey.tonic, toKey.tonic]
  );

  const playableTransposed: ParsedChord[] = useMemo(() => {
    return playableOriginal
      .map((ch) => transposeChord(ch, shift))
      .filter(Boolean) as ParsedChord[];
  }, [playableOriginal, shift]);

  // 度数表示
  const degrees: string[] = useMemo(() => {
    if (inputMode === "roman") {
      // roman入力は、degree をそのまま並べる（無ければ raw）
      return parsedItems
        .filter((it) => it.status === "ok" || it.status === "warn")
        .map((it) => it.degree ?? it.raw);
    }
    return playableOriginal.map((ch) => romanDegreeForChord(ch, fromKey));
  }, [inputMode, parsedItems, playableOriginal, fromKey]);

  // PAD用（変換後コードを鳴らす）
  const padItems = useMemo(() => {
    const pads = playableTransposed.slice(0, MAX_PADS);
    return pads.map((ch, i) => ({
      chord: ch,
      notes: chordToNotes(ch, rootOctave),
      label:
        inputMode === "roman"
          ? degrees[i] ?? formatChordSymbol(ch)
          : ch.raw ?? formatChordSymbol(ch),
    }));
  }, [playableTransposed, rootOctave, inputMode, degrees]);

  const handleInputChange = (e: ChangeEvent<HTMLTextAreaElement>) =>
    setInput(e.target.value);
  const handleBpmChange = (e: ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    if (!Number.isNaN(v)) setBpm(v);
  };
  const stepBeats = (delta: number) =>
    setBeatsPerChord((p) => Math.min(16, Math.max(1, p + delta)));
  const stepRootOctave = (delta: number) =>
    setRootOctave((p) => Math.min(6, Math.max(1, p + delta)));

  const stopPlayback = () => {
    Tone.Transport.stop();
    Tone.Transport.cancel(0);

    if (playTimeoutRef.current !== null) {
      window.clearTimeout(playTimeoutRef.current);
      playTimeoutRef.current = null;
    }

    playSynthRef.current?.releaseAll();
    playSynthRef.current?.dispose();
    playSynthRef.current = null;

    playLimiterRef.current?.dispose();
    playLimiterRef.current = null;

    setIsPlaying(false);
  };

  useEffect(() => () => stopPlayback(), []);

  const ensurePlaySynth = () => {
    if (playSynthRef.current) return playSynthRef.current;

    Tone.getDestination().volume.value = -6;

    const limiter = new Tone.Limiter(-16).toDestination();
    playLimiterRef.current = limiter;

    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 0.02, decay: 0.12, sustain: 0.6, release: 0.4 },
    }).connect(limiter);

    synth.volume.value = -20;
    playSynthRef.current = synth;
    return synth;
  };

  const handlePlay = async () => {
    if (isPlaying) return;
    if (playableTransposed.length === 0) return;

    stopPlayback();
    await Tone.start();

    const synth = ensurePlaySynth();

    const secondsPerBeat = 60 / bpm;
    const intervalSec = beatsPerChord * secondsPerBeat;
    const noteDurationSec = intervalSec * 0.9;
    const startAt = Tone.now();

    playableTransposed.forEach((ch, i) => {
      const notes = chordToNotes(ch, rootOctave);
      if (!notes.length) return;
      synth.triggerAttackRelease(
        notes,
        noteDurationSec,
        startAt + i * intervalSec,
        0.8
      );
    });

    setIsPlaying(true);

    const totalMs = playableTransposed.length * intervalSec * 1000 + 500;
    playTimeoutRef.current = window.setTimeout(() => stopPlayback(), totalMs);
  };

  const hasErrors = parsedItems.some((it) => it.status === "error");

  // ------- UI -------
  return (
    <main style={pageStyle}>
      <div style={cardStyle}>
        <header style={headerStyle}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: 0.4 }}>
              コード進行プレイヤー
            </h1>
            <p style={{ marginTop: 4, fontSize: 12, color: "#9ca3af" }}>
              入力（Chord / Roman）→ 度数 → 再生キーに変換して鳴らす
            </p>
          </div>
          <span style={{ fontSize: 11, color: "#6b7280" }}>v0.1 prototype</span>
        </header>

        {/* 入力モード */}
        <section style={{ marginTop: 10 }}>
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div style={labelStyle}>入力モード</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => setInputMode("chord")}
                style={pillStyle(inputMode === "chord")}
              >
                Chord
              </button>
              <button
                type="button"
                onClick={() => setInputMode("roman")}
                style={pillStyle(inputMode === "roman")}
              >
                Roman
              </button>
            </div>

            <div style={{ fontSize: 12, color: "#9ca3af" }}>
              {inputMode === "roman"
                ? "例: ii V7 Imaj7 / 251 / ツーファイブワン"
                : "例: Fmaj7 E7 Am7 Dm7 G7"}
            </div>
          </div>
        </section>

        {/* キー設定 */}
        <section style={{ marginTop: 10 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ minWidth: 240 }}>
              <div style={labelStyle}>元キー（解析基準）</div>
              <div style={{ display: "flex", gap: 8 }}>
                <select
                  value={fromTonic}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                    setFromTonic(e.target.value as Tonic)
                  }
                  style={selectStyle}
                >
                  {TONICS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>

                <select
                  value={fromMode}
                  onChange={(e) => setFromMode(e.target.value as KeyMode)}
                  style={selectStyle}
                >
                  <option value="major">major</option>
                  <option value="minor">minor</option>
                </select>
              </div>
            </div>

            <div style={{ minWidth: 240 }}>
              <div style={labelStyle}>再生キー（移調先）</div>
              <div style={{ display: "flex", gap: 8 }}>
                <select
                  value={toTonic}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                    setToTonic(e.target.value as Tonic)
                  }
                  style={selectStyle}
                >
                  {TONICS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>

                <select
                  value={toMode}
                  onChange={(e) => setToMode(e.target.value as KeyMode)}
                  style={selectStyle}
                >
                  <option value="major">major</option>
                  <option value="minor">minor</option>
                </select>
              </div>
            </div>

            <div style={{ alignSelf: "end", fontSize: 12, color: "#9ca3af" }}>
              shift: {shift} semitone(s)
            </div>
          </div>
        </section>

        {/* 入力 */}
        <section style={{ marginTop: 12 }}>
          <label
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            {inputMode === "roman"
              ? "進行（ローマ数字）"
              : "コード進行（入力）"}
          </label>

          <textarea
            value={input}
            onChange={handleInputChange}
            rows={3}
            style={textareaStyle}
            placeholder={
              inputMode === "roman"
                ? "例: ii V7 Imaj7  /  251"
                : "例: Fmaj7 E7 Am7 Dm7 G7"
            }
          />

          {/* パース状況（わかりやすく） */}
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
              解析結果（トークン単位）
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {parsedItems.length === 0 ? (
                <Muted>（入力なし）</Muted>
              ) : (
                parsedItems.map((it) => (
                  <span
                    key={`${it.index}-${it.raw}`}
                    title={it.message ?? ""}
                    style={tokenChipStyle(it.status)}
                  >
                    {it.raw}
                  </span>
                ))
              )}
            </div>

            {hasErrors && (
              <div style={{ marginTop: 8, fontSize: 12, color: "#fca5a5" }}>
                解釈できないトークンがあります（errorのチップにマウスで理由表示）。
              </div>
            )}
          </div>
        </section>

        {/* 翻訳表示 */}
        <section
          style={{
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid #111827",
          }}
        >
          <h2 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            変換結果（翻訳表示）
          </h2>

          {inputMode === "roman" ? (
            <div style={{ display: "grid", gap: 10 }}>
              <Row label="入力（度数）">
                {degrees.length ? (
                  degrees.map((d, i) => <Chip key={i} text={d} />)
                ) : (
                  <Muted>（なし）</Muted>
                )}
              </Row>

              <Row label="元キーに展開したコード">
                {playableOriginal.length ? (
                  playableOriginal.map((c, i) => (
                    <Chip key={i} text={formatChordSymbol(c)} />
                  ))
                ) : (
                  <Muted>（有効な進行がありません）</Muted>
                )}
              </Row>

              <Row label="変換後（再生キー）">
                {playableTransposed.length ? (
                  playableTransposed.map((c, i) => (
                    <Chip key={i} text={formatChordSymbol(c)} />
                  ))
                ) : (
                  <Muted>（なし）</Muted>
                )}
              </Row>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              <Row label="変換前（元キー基準のコード）">
                {playableOriginal.length ? (
                  playableOriginal.map((c, i) => (
                    <Chip key={i} text={formatChordSymbol(c)} />
                  ))
                ) : (
                  <Muted>（有効なコードがありません）</Muted>
                )}
              </Row>

              <Row label="度数（ローマ数字）">
                {degrees.length ? (
                  degrees.map((d, i) => <Chip key={i} text={d} />)
                ) : (
                  <Muted>（なし）</Muted>
                )}
              </Row>

              <Row label="変換後（再生キー）">
                {playableTransposed.length ? (
                  playableTransposed.map((c, i) => (
                    <Chip key={i} text={formatChordSymbol(c)} />
                  ))
                ) : (
                  <Muted>（なし）</Muted>
                )}
              </Row>
            </div>
          )}
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
            <div style={{ minWidth: 200 }}>
              <div style={labelStyle}>BPM</div>
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

            <div>
              <div style={labelStyle}>1コードの長さ（拍）</div>
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
                  style={btnMiniStyle}
                >
                  −
                </button>
                <span style={badgeStyle}>{beatsPerChord}</span>
                <button
                  type="button"
                  onClick={() => stepBeats(1)}
                  style={btnMiniStyle}
                >
                  ＋
                </button>
              </div>
            </div>

            <div>
              <div style={labelStyle}>ルートのオクターブ</div>
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
                  style={btnMiniStyle}
                >
                  −
                </button>
                <span style={badgeStyle}>{rootOctave}</span>
                <button
                  type="button"
                  onClick={() => stepRootOctave(1)}
                  style={btnMiniStyle}
                >
                  ＋
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* PAD */}
        <section
          style={{
            marginTop: 24,
            paddingTop: 16,
            borderTop: "1px solid #111827",
          }}
        >
          <ChordPadGrid padItems={padItems} />
        </section>

        {/* 再生/停止 */}
        <section style={{ marginTop: 28, display: "flex", gap: 10 }}>
          <button
            onClick={handlePlay}
            disabled={isPlaying || playableTransposed.length === 0}
            style={{
              padding: "10px 26px",
              fontSize: 15,
              fontWeight: 600,
              borderRadius: 999,
              border: "none",
              cursor:
                isPlaying || playableTransposed.length === 0
                  ? "not-allowed"
                  : "pointer",
              background:
                isPlaying || playableTransposed.length === 0
                  ? "#374151"
                  : "linear-gradient(135deg, #22c55e, #16a34a)",
              color: "#0b1120",
              boxShadow:
                isPlaying || playableTransposed.length === 0
                  ? "none"
                  : "0 8px 22px rgba(34,197,94,0.35)",
            }}
          >
            再生
          </button>

          <button
            onClick={stopPlayback}
            disabled={!isPlaying}
            style={{
              padding: "10px 18px",
              fontSize: 14,
              fontWeight: 600,
              borderRadius: 999,
              border: "1px solid #374151",
              cursor: !isPlaying ? "not-allowed" : "pointer",
              background: !isPlaying ? "#0b1120" : "#111827",
              color: "#e5e7eb",
            }}
          >
            停止
          </button>
        </section>

        <section style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
          単音ログ: URLに <code>?debug&amp;notes</code> を付ける（例:{" "}
          <code>http://localhost:3000/?debug&amp;notes</code>）
        </section>
      </div>
    </main>
  );
}

// ---- UI small components ----
function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
        {label}
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          alignItems: "center",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Chip({ text }: { text: string }) {
  return (
    <span
      style={{
        padding: "3px 10px",
        borderRadius: 999,
        border: "1px solid #374151",
        fontSize: 12,
        background: "#0b1120",
        fontFamily: "Menlo, Monaco, Consolas, monospace",
      }}
    >
      {text}
    </span>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 12, color: "#6b7280" }}>{children}</span>;
}

const tokenChipStyle = (status: string): React.CSSProperties => {
  const base: React.CSSProperties = {
    padding: "3px 10px",
    borderRadius: 999,
    border: "1px solid #374151",
    fontSize: 12,
    background: "#0b1120",
    fontFamily: "Menlo, Monaco, Consolas, monospace",
  };

  if (status === "ok") return base;
  if (status === "warn")
    return { ...base, border: "1px solid #f59e0b", color: "#fde68a" };
  if (status === "error")
    return { ...base, border: "1px solid #ef4444", color: "#fecaca" };
  if (status === "rest") return { ...base, opacity: 0.6 };
  return base;
};

const pillStyle = (active: boolean): React.CSSProperties => ({
  padding: "6px 12px",
  borderRadius: 999,
  border: "1px solid #374151",
  background: active ? "#111827" : "#020617",
  color: "#e5e7eb",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
});

const pageStyle: React.CSSProperties = {
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
};

const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 760,
  background: "#020617",
  borderRadius: 16,
  border: "1px solid #1f2937",
  boxShadow: "0 18px 45px rgba(0,0,0,0.55)",
  padding: 24,
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  marginBottom: 16,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
};

const selectStyle: React.CSSProperties = {
  height: 34,
  borderRadius: 10,
  border: "1px solid #374151",
  background: "#020617",
  color: "#e5e7eb",
  padding: "0 10px",
};

const textareaStyle: React.CSSProperties = {
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
};

const btnMiniStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 999,
  border: "1px solid #374151",
  background: "#020617",
  color: "#e5e7eb",
  cursor: "pointer",
};

const badgeStyle: React.CSSProperties = {
  minWidth: 32,
  textAlign: "center",
  padding: "4px 8px",
  borderRadius: 8,
  border: "1px solid #374151",
  background: "#020617",
  fontVariantNumeric: "tabular-nums",
  fontSize: 13,
};
