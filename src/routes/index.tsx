import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";

import { CancelledError, type AgnesProgress } from "@/lib/agnes";
import { generateOutline, generateEpisodePart, translatePart, type LangCode } from "@/lib/novel";

type Feed = { push: (t: string) => void; close: () => void; get: (i: number) => Promise<string | null> };

/** English parts are published here; Hindi/Marathi wait on them in order. */
function createFeed(isCancelled: () => boolean): Feed {
  const parts: string[] = [];
  let closed = false;
  return {
    push: (t) => void parts.push(t),
    close: () => void (closed = true),
    get: async (i) => {
      while (parts[i] === undefined) {
        if (closed || isCancelled()) return null;
        await new Promise((r) => setTimeout(r, 1000));
      }
      return parts[i];
    },
  };
}



export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Hive Archive — Recap to Novel in 3 Languages" },
      {
        name: "description",
        content:
          "Upload a story recap and write a full open-ended novel in English, Hindi and Marathi — with natural Hindi and Marathi retellings.",
      },
      { property: "og:title", content: "Hive Archive — Recap to Novel in 3 Languages" },
      {
        property: "og:description",
        content:
          "Upload a story recap and write a full open-ended novel in English, Hindi and Marathi — with natural Hindi and Marathi retellings.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const LANGS: Array<{ code: LangCode; name: string; native: string; file: string }> = [
  { code: "en", name: "English", native: "English", file: "novel-english.txt" },
  { code: "hi", name: "Hindi", native: "हिन्दी", file: "novel-hindi.txt" },
  { code: "mr", name: "Marathi", native: "मराठी", file: "novel-marathi.txt" },
];

type LangState = {
  status: "idle" | "running" | "done" | "error";
  step: string;
  outline: string;
  episodes: string[];
  progress: number;
  error: string;
};

const emptyState: LangState = {
  status: "idle",
  step: "Waiting",
  outline: "",
  episodes: [],
  progress: 0,
  error: "",
};

function countWords(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Index() {
  const [recap, setRecap] = useState("");
  const [recapName, setRecapName] = useState("");
  const [episodes, setEpisodes] = useState(30);
  const [wordsPerEpisode, setWordsPerEpisode] = useState(4000);
  const [state, setState] = useState<Record<LangCode, LangState>>({
    en: emptyState,
    hi: emptyState,
    mr: emptyState,
  });
  const cancelled = useRef(false);

  const patch = useCallback((lang: LangCode, next: Partial<LangState>) => {
    setState((prev) => ({ ...prev, [lang]: { ...prev[lang], ...next } }));
  }, []);

  const busy = LANGS.some(({ code }) => state[code].status === "running");

  const runLanguage = useCallback(
    async (lang: LangCode, source: string, total: number, words: number, feed: Feed) => {
      const collected: string[] = [];
      let currentStep = lang === "en" ? "Planning the story" : "Waiting for the English chapter";
      const setStep = (step: string) => {
        currentStep = step;
        patch(lang, { step });
      };
      const progress: AgnesProgress = {
        isCancelled: () => cancelled.current,
        onCooldown: (secondsLeft, reason) =>
          patch(lang, {
            step: `Key limit (${reason}) — resuming in ${secondsLeft}s · ${currentStep}`,
          }),
      };
      const totalParts = total * 2;

      try {
        patch(lang, { ...emptyState, status: "running", step: currentStep });

        if (lang !== "en") {
          // Hindi and Marathi retell the finished English parts in natural prose.
          for (let index = 0; index < totalParts; index++) {
            if (cancelled.current) return;
            setStep(`Waiting for English episode ${Math.floor(index / 2) + 1}`);
            const english = await feed.get(index);
            if (english === null) throw new Error("The English run stopped, so this version stopped too.");
            if (cancelled.current) return;
            setStep(`Retelling episode ${Math.floor(index / 2) + 1} of ${total} (part ${(index % 2) + 1})`);
            const { text } = await translatePart(
              { lang, english, previousTranslated: collected.at(-1) ?? "" },
              progress,
            );
            collected.push(text.trim());
            patch(lang, { episodes: [...collected], progress: (index + 1) / totalParts });
          }
          patch(lang, { status: "done", step: "Novel complete", progress: 1 });
          return;
        }

        const { outline } = await generateOutline({ lang, recap: source, episodes: total }, progress);
        if (cancelled.current) return;
        patch(lang, { outline, progress: 1 / (totalParts + 1) });

        for (let episode = 1; episode <= total; episode++) {
          for (const part of [1, 2] as const) {
            if (cancelled.current) return;
            setStep(`Writing episode ${episode} of ${total} (part ${part})`);
            const previousTail = collected.at(-1)?.slice(-6000) ?? "";
            const { text } = await generateEpisodePart(
              {
                lang,
                recap: source,
                outline,
                episode,
                episodes: total,
                part,
                wordsPerPart: Math.round(words / 2),
                previousTail,
              },
              progress,
            );
            collected.push(text.trim());
            feed.push(text.trim());
            patch(lang, {
              episodes: [...collected],
              progress: ((episode - 1) * 2 + part + 1) / (totalParts + 1),
            });
          }
        }

        patch(lang, { status: "done", step: "Novel complete", progress: 1 });
      } catch (error) {
        if (lang === "en") feed.close();
        if (error instanceof CancelledError) {
          patch(lang, { status: "idle", step: "Stopped", episodes: [...collected] });
          return;
        }
        patch(lang, {
          status: "error",
          step: "Stopped",
          episodes: [...collected],
          error: error instanceof Error ? error.message : "Something went wrong.",
        });
      }
    },
    [patch],
  );

  const start = useCallback(() => {
    if (!recap.trim()) return;
    cancelled.current = false;
    const feed = createFeed(() => cancelled.current);
    for (const { code } of LANGS) {
      void runLanguage(code, recap, episodes, wordsPerEpisode, feed);
    }
  }, [recap, episodes, wordsPerEpisode, runLanguage]);

  const fullText = useCallback(
    (lang: LangCode) => {
      const s = state[lang];
      const header = LANGS.find((language) => language.code === lang);
      if (!header) return "";
      return [
        `${recapName || "Novel"} — ${header.name} edition`,
        `Written from the uploaded recap with Agnes 3.0 Flash.`,
        "",
        "".padEnd(60, "="),
        "",
        s.episodes.join("\n\n\n"),
        "",
      ].join("\n");
    },
    [state, recapName],
  );

  const totals = useMemo(
    () =>
      Object.fromEntries(
        LANGS.map(({ code }) => [code, countWords(state[code].episodes.join(" "))]),
      ) as Record<LangCode, number>,
    [state],
  );

  const anyText = LANGS.some(({ code }) => state[code].episodes.length > 0);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-16">
      <header className="mb-10">
        <p className="font-display text-xs uppercase tracking-[0.35em] text-primary">
          Hive Archive
        </p>
        <h1 className="mt-3 text-3xl font-bold leading-tight sm:text-5xl">
          Turn a recap into a full novel — in three languages at once
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          Drop in your episode recap. Three separate Agnes 3.0 Flash keys write the same story as a
          long, scene-driven novel with a deliberate open ending. Hindi and Marathi follow the
          English story in natural, everyday language, not word-for-word. Download all three as text files.
        </p>
      </header>

      <section className="panel p-5 sm:p-7">
        <label className="block text-sm font-semibold" htmlFor="recap-file">
          1. Your recap
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            id="recap-file"
            type="file"
            accept=".txt,.md,text/plain"
            className="field max-w-xs text-sm"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setRecapName(file.name.replace(/\.[^.]+$/, ""));
              setRecap(await file.text());
            }}
          />
          {recap ? (
            <span className="text-xs text-primary">
              {countWords(recap).toLocaleString()} words loaded
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">or paste it below</span>
          )}
        </div>
        <textarea
          className="field mt-4 h-40 resize-y font-body text-sm leading-relaxed"
          placeholder="Paste your recap text here…"
          value={recap}
          onChange={(event) => setRecap(event.target.value)}
        />

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <div>
            <label className="text-sm font-semibold" htmlFor="episodes">
              2. Episodes: <span className="text-primary">{episodes}</span>
            </label>
            <input
              id="episodes"
              type="range"
              min={5}
              max={30}
              step={1}
              value={episodes}
              className="mt-3 w-full accent-primary"
              onChange={(event) => setEpisodes(Number(event.target.value))}
            />
          </div>
          <div>
            <label className="text-sm font-semibold" htmlFor="words">
              3. Words per episode:{" "}
              <span className="text-primary">{wordsPerEpisode.toLocaleString()}</span>
            </label>
            <input
              id="words"
              type="range"
              min={3000}
              max={5000}
              step={500}
              value={wordsPerEpisode}
              className="mt-3 w-full accent-primary"
              onChange={(event) => setWordsPerEpisode(Number(event.target.value))}
            />
          </div>
        </div>

        <p className="mt-5 text-xs text-muted-foreground">
          Estimated length per language:{" "}
          <span className="text-accent">
            {(episodes * wordsPerEpisode).toLocaleString()} words
          </span>
          . Long books take a while — keep this tab open while it writes.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            className="btn-hive hover:btn-hive-hover disabled:opacity-50"
            disabled={!recap.trim() || busy}
            onClick={start}
          >
            {busy ? "Writing…" : "Write all three novels"}
          </button>
          {busy && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                cancelled.current = true;
              }}
            >
              Stop after current step
            </button>
          )}
          {anyText && !busy && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                for (const lang of LANGS) {
                  if (state[lang.code].episodes.length) download(lang.file, fullText(lang.code));
                }
              }}
            >
              Download all 3 files
            </button>
          )}
        </div>
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-3">
        {LANGS.map((lang) => {
          const s = state[lang.code];
          return (
            <article key={lang.code} className="panel flex flex-col p-5">
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-bold">{lang.native}</h2>
                <span className="font-display text-[11px] uppercase tracking-widest text-muted-foreground">
                  {lang.name}
                </span>
              </div>

              <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${Math.round(s.progress * 100)}%` }}
                />
              </div>

              <p className="mt-3 text-xs text-muted-foreground">{s.step}</p>
              <p className="mt-1 text-xs">
                <span className="text-primary">{totals[lang.code].toLocaleString()}</span> words ·{" "}
                {Math.ceil(s.episodes.length / 2)} / {episodes} episodes
              </p>

              {s.error && (
                <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive-foreground">
                  {s.error}
                </p>
              )}

              {s.episodes.length > 0 && (
                <div className="mt-4 max-h-44 overflow-y-auto rounded-md border border-border bg-background/50 p-3 text-xs leading-relaxed text-muted-foreground">
                  {s.episodes.at(-1)?.slice(-700)}
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-ghost text-xs disabled:opacity-40"
                  disabled={!s.episodes.length}
                  onClick={() => download(lang.file, fullText(lang.code))}
                >
                  Download .txt
                </button>
                {(s.status === "error" || s.status === "done") && (
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    onClick={() => {
                      cancelled.current = false;
                      {
                         // Retrying one language: retellings reuse the English text already written.
                        const feed = createFeed(() => cancelled.current);
                        state.en.episodes.forEach((t) => feed.push(t));
                        if (lang.code !== "en" && state.en.status !== "running") feed.close();
                        void runLanguage(lang.code, recap, episodes, wordsPerEpisode, feed);
                      }
                    }}
                  >
                    Rewrite this language
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
