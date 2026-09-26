export type NovelLangCode = "en" | "hi" | "mr";

const DEVANAGARI = /[\u0900-\u097f]/g;
const LATIN = /[A-Za-z]/g;
const FOREIGN_SCRIPT = /[\u0590-\u08ff\u0980-\u0dff\u1100-\u11ff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0400-\u052f]/u;

export function cleanNovelText(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?thinking>/gi, "")
    .replace(/^```[^\n]*\n?|```$/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1")
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g, "$1")
    .replace(/^\s*[-*_]{3,}\s*$/gm, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizedParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim().toLocaleLowerCase())
    .filter((paragraph) => paragraph.length >= 35);
}

function hasPhraseLoop(text: string, lang: NovelLangCode): boolean {
  // Indic prose repeats auxiliaries/particles constantly, so use longer n-grams and a looser limit there.
  const n = lang === "en" ? 3 : 4;
  const tokens = text
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const trigrams = new Map<string, number>();
  for (let index = 0; index <= tokens.length - n; index += 1) {
    const phrase = tokens.slice(index, index + n).join(" ");
    trigrams.set(phrase, (trigrams.get(phrase) ?? 0) + 1);
  }
  const limit = lang === "en" ? Math.max(8, Math.ceil(tokens.length / 450)) : Math.max(10, Math.ceil(tokens.length / 300));
  return [...trigrams.values()].some((count) => count > limit);
}

export function findNovelQualityProblems(
  text: string,
  lang: NovelLangCode,
  targetWords: number,
  allowEpisodeHeading: boolean,
): string[] {
  const problems: string[] = [];
  const words = text.trim().split(/\s+/).filter(Boolean);

  if (/(.)\1{20,}/u.test(text) || /(\S{2,12})(?:\1){7,}/u.test(text)) {
    problems.push("corrupted repeated characters or syllables");
  }

  const paragraphCounts = new Map<string, number>();
  for (const paragraph of normalizedParagraphs(text)) {
    paragraphCounts.set(paragraph, (paragraphCounts.get(paragraph) ?? 0) + 1);
  }
  if ([...paragraphCounts.values()].some((count) => count >= 3)) {
    problems.push("the same passage is repeated several times");
  }

  const sentences = text
    .split(/(?<=[.!?।])\s+/u)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim().toLocaleLowerCase())
    .filter((sentence) => sentence.length >= 45);
  const sentenceCounts = new Map<string, number>();
  for (const sentence of sentences) {
    sentenceCounts.set(sentence, (sentenceCounts.get(sentence) ?? 0) + 1);
  }
  if ([...sentenceCounts.values()].some((count) => count >= 4)) {
    problems.push("sentences are looping");
  }
  if (hasPhraseLoop(text, lang)) {
    problems.push("a phrase pattern is repeated excessively");
  }

  if (/\*\*|__|(?<!\*)\*[^*\n]+\*(?!\*)/.test(text)) {
    problems.push("Markdown styling remains");
  }

  if (lang !== "en") {
    const devanagariCount = text.match(DEVANAGARI)?.length ?? 0;
    const latinCount = text.match(LATIN)?.length ?? 0;
    if (FOREIGN_SCRIPT.test(text)) {
      problems.push("characters from a foreign script are embedded in the prose");
    }
    if (devanagariCount < 200 || latinCount > devanagariCount * 0.18) {
      problems.push("too much text is outside Devanagari script");
    }
  }

  if (lang === "mr") {
    // Short replies inside dialogue are natural spoken Marathi; judge narration only.
    const narration = text.replace(/["“”][^"“”\n]*["“”]/g, " ").replace(/^\s*[-–—].*$/gm, " ");
    const proseSentences = narration
      .split(/[.!?।]+/u)
      .map((sentence) => sentence.trim().split(/\s+/).filter(Boolean).length)
      .filter((length) => length > 0);
    const brokenFragments = proseSentences.filter((length) => length <= 3).length;
    if (proseSentences.length >= 12 && brokenFragments / proseSentences.length > 0.45) {
      problems.push("the Marathi prose contains too many broken sentence fragments");
    }
  }

  const episodeHeadings = text.match(/^(?:Episode|एपिसोड)\s*[०-९0-9]+[^\n]*$/gim) ?? [];
  if (episodeHeadings.length > (allowEpisodeHeading ? 1 : 0)) {
    problems.push("an extra episode begins inside this part");
  }
  if (allowEpisodeHeading && episodeHeadings.length !== 1) {
    problems.push("the required episode heading is missing");
  }

  if (words.length > targetWords * 1.35) problems.push("the part greatly exceeds its target length");
  if (words.length < Math.min(700, targetWords * 0.45)) problems.push("the part stops far too early");

  return problems;
}

/** Problems that are stylistic judgement calls; a draft with only these is still usable after retries. */
const SOFT_PROBLEMS = new Set([
  "a phrase pattern is repeated excessively",
  "the Marathi prose contains too many broken sentence fragments",
  "the part greatly exceeds its target length",
]);

export function hasOnlySoftProblems(problems: string[]): boolean {
  return problems.every((problem) => SOFT_PROBLEMS.has(problem));
}

export function extractEpisodePlan(outline: string, episode: number): string {
  const marker = new RegExp(`(?:^|\\n)\\s*EPISODE\\s+${episode}\\s*\\n`, "i");
  const start = marker.exec(outline);
  if (!start) return outline.slice(0, 30_000);
  const bodyStart = start.index + start[0].length;
  const rest = outline.slice(bodyStart);
  const next = /\n\s*EPISODE\s+\d+\s*\n/i.exec(rest);
  return rest.slice(0, next?.index ?? rest.length).slice(0, 8_000).trim();
}