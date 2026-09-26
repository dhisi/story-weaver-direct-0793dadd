/**
 * Naturalness checks for the Hindi and Marathi retellings.
 *
 * The model's failure mode is not grammar — it is register: bookish,
 * Sanskritised, translationese wording, plus Hindi words leaking into Marathi
 * (and the reverse). These checks name the exact offending words so the retry
 * prompt can ask for a precise fix instead of a vague "be more natural".
 */

export type IndicLang = "hi" | "mr";

/** Bookish / literary words with an everyday spoken replacement. */
const HINDI_STIFF: Record<string, string> = {
  परंतु: "लेकिन",
  किंतु: "लेकिन",
  तथापि: "फिर भी",
  अथवा: "या",
  एवं: "और",
  तत्पश्चात: "उसके बाद",
  पश्चात: "बाद",
  उपरांत: "बाद",
  यद्यपि: "हालाँकि",
  अतएव: "इसलिए",
  किंचित: "थोड़ा",
  अत्यल्प: "बहुत कम",
  अनेकानेक: "कई",
  समीप: "पास",
  दृष्टिगोचर: "दिखाई देना",
  प्रतीत: "लगना",
  व्यतीत: "बिताना",
  अवलोकन: "देखना",
  नेत्र: "आँख",
  नयन: "आँख",
  कर्ण: "कान",
  ओष्ठ: "होंठ",
  वक्ष: "सीना",
  केश: "बाल",
  अश्रु: "आँसू",
  रुधिर: "खून",
  मस्तक: "माथा",
  उदर: "पेट",
  वस्त्र: "कपड़े",
  गृह: "घर",
  निद्रा: "नींद",
  पुष्प: "फूल",
  वृक्ष: "पेड़",
  गमन: "जाना",
  प्रस्थान: "निकलना",
  आगमन: "आना",
  वार्तालाप: "बातचीत",
  संभाषण: "बातचीत",
  प्रत्युत्तर: "जवाब",
  उच्चारित: "कहा",
  उद्गार: "बोल",
  क्रोधित: "गुस्सा",
  भयभीत: "डरा हुआ",
  हर्षित: "खुश",
  दुःखित: "दुखी",
  विस्मित: "हैरान",
  उद्विग्न: "बेचैन",
  शनैः: "धीरे",
  त्वरित: "जल्दी",
  समीपस्थ: "पास का",
  तदनंतर: "फिर",
  महोदय: "जी",
};

const MARATHI_STIFF: Record<string, string> = {
  परंतु: "पण",
  तथापि: "तरीही",
  किंबहुना: "उलट",
  अथवा: "किंवा",
  तत्पश्चात: "त्यानंतर",
  पश्चात: "नंतर",
  यद्यपि: "जरी",
  किंचित: "थोडं",
  अनेकानेक: "कितीतरी",
  समीप: "जवळ",
  दृष्टीस: "दिसायला",
  प्रतीत: "वाटणं",
  अवलोकन: "बघणं",
  नेत्र: "डोळे",
  कर्ण: "कान",
  ओष्ठ: "ओठ",
  वक्ष: "छाती",
  केश: "केस",
  अश्रू: "डोळ्यांतलं पाणी",
  रुधिर: "रक्त",
  उदर: "पोट",
  वस्त्र: "कपडे",
  गृह: "घर",
  निद्रा: "झोप",
  पुष्प: "फूल",
  वृक्ष: "झाड",
  गमन: "जाणं",
  प्रस्थान: "निघणं",
  आगमन: "येणं",
  संभाषण: "बोलणं",
  प्रत्युत्तर: "उत्तर",
  उद्गारला: "म्हणाला",
  वदला: "म्हणाला",
  क्रोधित: "रागावलेला",
  भयभीत: "घाबरलेला",
  हर्षित: "खूश",
  दुःखित: "दुःखी",
  विस्मित: "थक्क",
  शनैः: "हळू",
  त्वरित: "पटकन",
  तदनंतर: "मग",
};

/** Words that only exist in the other language — a clear register leak. */
const HINDI_ONLY = [
  "और", "लेकिन", "क्योंकि", "नहीं", "है", "हैं", "था", "थी", "थे", "हुआ", "गया",
  "किया", "रहा", "रही", "मुझे", "तुम्हें", "उसने", "उन्होंने", "कुछ", "बहुत",
  "अपना", "वापस", "अभी",
];

const MARATHI_ONLY = [
  "आणि", "आहे", "आहेत", "नाही", "होतं", "होती", "झालं", "केलं", "म्हणाला",
  "म्हणाली", "त्याने", "तिने", "त्याला", "तिला", "पण", "खूप", "थोडं", "इथे", "तिथे",
  "आता", "काहीतरी",
];

function wordSet(text: string): Set<string> {
  return new Set(
    text
      .replace(/[^\u0900-\u097f\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean),
  );
}

function countWord(text: string, word: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = text.indexOf(word, from);
    if (at === -1) return count;
    const before = text[at - 1] ?? " ";
    const after = text[at + word.length] ?? " ";
    // Devanagari words inflect with suffixes, so allow a trailing matra/letter
    // only for the leak lists (handled by exact-word matching there).
    if (!/[\u0900-\u097f]/.test(before) && !/[\u093e-\u094d\u0900-\u0903]/.test(after)) count += 1;
    from = at + word.length;
  }
}

export type StyleReport = {
  /** Human-readable, model-facing corrections. Empty when the prose reads naturally. */
  problems: string[];
};

export function findIndicStyleProblems(text: string, lang: IndicLang): StyleReport {
  const problems: string[] = [];
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 30) return { problems };

  if (lang === "mr") {
    // Konkani / dialect drift the model slips into: चो endings, ल्लं participles.
    const drift = [
      ...(text.match(/[\u0900-\u097f]+(?:चो|चें|तें|ल्लं|ल्ले|ल्ला)\b/g) ?? []),
      ...(text.match(/\b(हांव|आसा|आसात|केल्लें|जाल्यार)\b/g) ?? []),
    ];
    if (drift.length) {
      problems.push(
        `Konkani or dialect forms instead of standard Marathi (${[...new Set(drift)].slice(0, 8).join(", ")}) — use standard written Marathi endings (चा/ची/चे, लं/ले)`,
      );
    }
  }

  const stiffMap = lang === "hi" ? HINDI_STIFF : MARATHI_STIFF;
  const hits: string[] = [];
  for (const [bookish, plain] of Object.entries(stiffMap)) {
    if (countWord(text, bookish) > 0) hits.push(`"${bookish}" → "${plain}"`);
  }
  // A couple of formal words in a long passage is fine; a cluster is not.
  const allowed = Math.max(1, Math.floor(words.length / 400));
  if (hits.length > allowed) {
    problems.push(
      `bookish, written-only words instead of everyday spoken ones — replace each of these: ${hits.slice(0, 14).join(", ")}`,
    );
  }

  const present = wordSet(text);
  const leaks = (lang === "hi" ? MARATHI_ONLY : HINDI_ONLY).filter((word) => present.has(word));
  if (leaks.length) {
    const other = lang === "hi" ? "Marathi" : "Hindi";
    problems.push(
      `${other} words mixed into the ${lang === "hi" ? "Hindi" : "Marathi"} prose (${leaks.slice(0, 10).join(", ")}) — rewrite those lines in pure ${lang === "hi" ? "Hindi" : "Marathi"}`,
    );
  }

  const sentences = text
    .split(/[।.!?]+/u)
    .map((sentence) => sentence.trim().split(/\s+/).filter(Boolean).length)
    .filter((length) => length > 0);
  if (sentences.length >= 8) {
    const average = sentences.reduce((sum, length) => sum + length, 0) / sentences.length;
    const veryLong = sentences.filter((length) => length > 40).length;
    if (average > 26 || veryLong / sentences.length > 0.2) {
      problems.push(
        "sentences are too long and winding — break them into shorter, natural spoken-length sentences",
      );
    }
  }

  // Translationese: English-style possessive/quotative scaffolding repeated.
  const scaffolding = lang === "hi" ? /\bउसने कहा\b/g : /\bतो म्हणाला\b/g;
  const scaffoldingCount = text.match(scaffolding)?.length ?? 0;
  if (scaffoldingCount > Math.max(3, words.length / 250)) {
    problems.push("the same dialogue tag repeats over and over — vary how speech is attributed");
  }

  return { problems };
}
