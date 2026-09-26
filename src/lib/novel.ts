import { AGNES_INDIC_MODEL, agnesChat, getApiKey, type AgnesProgress, type LangCode } from "./agnes";

import {
  cleanNovelText,
  extractEpisodePlan,
  findNovelQualityProblems,
  hasOnlySoftProblems,
} from "./novel-quality";
import { findIndicStyleProblems } from "./indic-style";

export type { LangCode };

const LANGUAGE_RULES: Record<LangCode, string> = {
  en: "Write idiomatic, polished literary English. Prefer precise, varied sentences over ornamental repetition.",
  hi: "किसी अनुवाद की तरह नहीं, आज के कुशल हिन्दी उपन्यासकार की तरह सहज, साफ़ और रोज़मर्रा की हिन्दी में लिखो। संवाद वैसे हों जैसे लोग सचमुच आपस में बोलते हैं—छोटे, स्वाभाविक और पात्र की उम्र, रिश्ते तथा परिस्थिति के अनुरूप। वर्णन सरल लेकिन असरदार रखो। अत्यधिक संस्कृतनिष्ठ, किताबी, पुरानी या भाषण जैसी हिन्दी मत लिखो। कठिन शब्द की जगह आम बोलचाल का प्रचलित शब्द चुनो, लेकिन सड़क-छाप भाषा या बेवजह अंग्रेज़ी मत मिलाओ। केवल देवनागरी प्रयोग करो; लैटिन, अरबी, फ़ारसी, हिब्रू, सिरिलिक, गुरुमुखी, बंगाली, कोरियाई या किसी अन्य लिपि का एक भी अक्षर मत मिलाओ। पात्रों के नामों का एक ही सुसंगत लिप्यंतरण रखो। अंग्रेज़ी शीर्षक या वाक्य मत लिखो। कृत्रिम संयुक्त शब्द, शब्दशः अनुवाद और निरर्थक उपमाएँ मत गढ़ो।",
  mr: "अनुवादासारखे नव्हे, तर आजच्या कुशल मराठी कादंबरीकाराप्रमाणे सहज, स्वच्छ आणि रोजच्या बोलण्यातली मराठी वापरून लिही. संवाद खऱ्या माणसांच्या बोलण्यासारखे असू देत—लहान, नैसर्गिक आणि पात्राचे वय, नाते व प्रसंग यांना साजेसे. निवेदन सोपे पण परिणामकारक ठेव. अतिसंस्कृत, पुस्तकी, जुनाट किंवा भाषणासारखी मराठी लिहू नको; अवघड शब्दाऐवजी रोजच्या वापरातला प्रचलित शब्द निवड, पण उगाच इंग्रजी मिसळू नको. फक्त देवनागरी वापर; लॅटिन, अरबी, हिब्रू, सिरिलिक, गुरुमुखी, बंगाली, कोरियन किंवा इतर कोणत्याही लिपीतील एकही अक्षर मिसळू नको. पात्रांच्या नावांचे एकच सुसंगत लिप्यंतर ठेव. इंग्रजी शीर्षके किंवा वाक्ये लिहू नको. हिंदीसदृश वाक्यरचना, शब्दशः भाषांतर, कृत्रिम जोडशब्द आणि निरर्थक उपमा टाळ. एक-दोन शब्दांची तुटक वाक्ये सलग लिहू नको; आणि, पण, तेव्हा, कारण यांसारख्या जोडशब्दांनी नैसर्गिक संयुक्त व मिश्र वाक्यरचना वापर.",
};

const LANGUAGE_LABEL: Record<LangCode, string> = { en: "English", hi: "Hindi", mr: "Marathi" };

function craftSystemPrompt(lang: LangCode): string {
  return [
    "You are a master novelist adapting a story recap into a full-length, publishable novel.",
    LANGUAGE_RULES[lang],
    "Craft rules you must follow:",
    "- Deep third-person limited narration with scene-by-scene dramatization: dialogue, sensory detail, subtext, silence.",
    "- Never summarize events that deserve a scene. Never narrate like a recap, wiki or synopsis.",
    "- Give the protagonist an inner moral spine: what power costs, who he becomes, what he refuses to lose.",
    "- Secondary characters have their own wants and contradictions; antagonists have reasons, not just menace.",
    "- Braid a thematic meaning through the action (survival vs. humanity, being used vs. choosing loyalty).",
    "- Keep continuity with the recap's names, classes, factions and events; you may invent connective scenes.",
    "- Never rename, merge, gender-swap or invent relationships for characters. Preserve the recap's facts and event order.",
    "- Every paragraph must advance action, character, tension or setting. Never loop a phrase, image, thought, sentence, exchange or event.",
    "- Use restrained imagery. Do not stack metaphors, explain a metaphor, or repeat a thematic keyword for emphasis.",
    "- Plain text only: never use Markdown, asterisks, underscores, hashes, bold, italics, bullet points, author notes or word-count notes.",
    "- System notifications may be plain standalone lines, without decorative symbols or Markdown.",
  ].join("\n");
}

const HEADING_RULE: Record<LangCode, string> = {
  en: 'Use exactly "Episode N: Title" for the episode heading.',
  hi: 'एपिसोड का शीर्षक ठीक "एपिसोड N: शीर्षक" के रूप में लिखो।',
  mr: 'भागाचे शीर्षक नेमके "एपिसोड N: शीर्षक" या स्वरूपात लिही.',
};

/** Step 1 — story bible + episode outline. One call, one key, one language. */
export async function generateOutline(
  data: { lang: LangCode; recap: string; episodes: number; title?: string },
  progress?: AgnesProgress | undefined,
) {
    const apiKey = getApiKey(data.lang);

    const outline = await agnesChat({
      apiKey,
      progress,
      maxTokens: 6000,
      messages: [
        { role: "system", content: craftSystemPrompt(data.lang) },
        {
          role: "user",
          content: [
            `Here is a recap of an existing story:\n\n"""\n${data.recap.slice(0, 120000)}\n"""`,
            "",
            `Plan a ${data.episodes}-episode novel based on this recap, written in ${LANGUAGE_LABEL[data.lang]}.`,
            "Deliver, compactly:",
            "1. Novel title and one-line premise.",
            "2. Core theme and the protagonist's inner arc (start state -> end state).",
            "3. Cast list: name, want, wound, function in the plot.",
            "4. An episode-by-episode outline using these exact machine-readable delimiters:",
            "EPISODE 1",
            "TITLE: ...",
            "PART 1 SCENES: 2-3 concrete scene beats",
            "PART 2 SCENES: 2-3 different concrete scene beats",
            "ENDING TURN: ...",
            "Repeat that exact block structure for every episode. Never place an episode's event in another episode.",
            `5. The final episode (${data.episodes}) must land a real emotional resolution for the inner arc but leave the outer story OPEN: a deliberate, tantalising open ending — a new threat revealed, a choice not yet made, a door opening. Never write 'The End'.`,
            "This plan is for your own use as the author. Be dense and concrete, no filler.",
          ].join("\n"),
        },
      ],
    });

  return { outline };
}

/** Step 2 — one half of one episode. Called repeatedly by the client, sequentially per language. */
export async function generateEpisodePart(
  data: {
    lang: LangCode;
    recap: string;
    outline: string;
    episode: number;
    episodes: number;
    part: 1 | 2;
    wordsPerPart: number;
    previousTail: string;
  },
  progress?: AgnesProgress | undefined,
) {
    const apiKey = getApiKey(data.lang);

    const isFinalEpisode = data.episode === data.episodes;
    const episodePlan = extractEpisodePlan(data.outline, data.episode);
    const instructions: string[] = [
      `You are writing Episode ${data.episode} of ${data.episodes}, part ${data.part} of 2.`,
      `Write ${Math.round(data.wordsPerPart * 0.8)}-${Math.round(data.wordsPerPart * 1.1)} words. Never exceed that range to compensate for earlier parts.`,
      `Dramatize ONLY the PART ${data.part} SCENES in the current episode plan. Do not replay completed events or borrow scenes from another episode.`,
      "Move forward continuously. Each physical action happens once unless the plan explicitly calls for its later repetition.",
      "Use complete, varied paragraphs. Avoid rhetorical fragments, chained 'and' clauses, repeated sentence openings and recurring decorative imagery.",
      "Never build circular chains such as 'X was the Y, and the Y was the Z.' Never repeat a sentence template, thematic keyword or striking metaphor to fill space.",
      "If planned material runs short, deepen the scene through purposeful action, dialogue, decisions and consequences—never restatement.",
      "Return only finished plain-text novel prose. Do not discuss these instructions.",
    ];

    if (data.part === 1) {
      instructions.push(
        HEADING_RULE[data.lang],
        "Open in the middle of a live scene, not with exposition. Dramatize the first half of this episode's outline.",
        "End this part mid-momentum, on a beat that pulls the reader forward.",
      );
    } else {
      instructions.push(
        "Continue seamlessly from where the text below stops — same scene, same breath, no recap, no new episode heading.",
        "Dramatize the remaining scenes of this episode and land the episode's closing turn.",
      );
    }

    if (isFinalEpisode && data.part === 2) {
      instructions.push(
        "This is the end of the novel. Resolve the protagonist's inner arc with real emotional weight, then leave the outer story deliberately OPEN: reveal or imply something larger just beginning. The last paragraph should feel like a held breath, not a full stop. Do not write 'The End' or any closing note.",
      );
    }

    const contextBlocks = [
      `SOURCE RECAP (canon — keep names and events consistent):\n"""\n${data.recap.slice(0, 60000)}\n"""`,
      `CURRENT EPISODE PLAN — this is the only outline section you may dramatize now:\n"""\n${episodePlan}\n"""`,
    ];
    if (data.previousTail.trim()) {
      contextBlocks.push(
        `END OF WHAT YOU HAVE WRITTEN SO FAR (continue from here, never repeat it):\n"""\n${data.previousTail.slice(-6000)}\n"""`,
      );
    }

    const requestText = [...contextBlocks, "", ...instructions].join("\n\n");
    const createDraft = (correction?: string) =>
      agnesChat({
        apiKey,
        progress,
        maxTokens: 8000,
        temperature: correction ? 0.65 : 0.8,
        messages: [
          { role: "system", content: craftSystemPrompt(data.lang) },
          {
            role: "user",
            content: correction
              ? `${requestText}\n\nYOUR PREVIOUS ATTEMPT WAS REJECTED because it contained: ${correction}. Rewrite the entire part from scratch. Do not copy any sentence from the rejected attempt.`
              : requestText,
          },
        ],
      });

  let text = cleanNovelText(await createDraft());
  let problems = findNovelQualityProblems(text, data.lang, data.wordsPerPart, data.part === 1);
  // Up to two rewrites; always keep the cleanest draft so the story never breaks its chain.
  for (let attempt = 0; attempt < 2 && problems.length; attempt += 1) {
    const retryText = cleanNovelText(await createDraft(problems.join(", ")));
    const retryProblems = findNovelQualityProblems(
      retryText,
      data.lang,
      data.wordsPerPart,
      data.part === 1,
    );
    if (retryProblems.length <= problems.length) {
      text = retryText;
      problems = retryProblems;
    }
    if (hasOnlySoftProblems(problems)) break;
  }

  return { text, problems };
}


const TRANSLATE_RULES: Record<"hi" | "mr", string> = {
  hi: [
    "You are a contemporary Hindi novelist writing for ordinary Indian readers. The English passage is your story reference, NOT a script to translate.",
    "Retell its scenes in original, natural Hindi prose as if the novel had been written in Hindi first. Keep the same characters, relationships, event order, actions, clues, emotional turns and outcome. Do not add any objects, actions, scenery, dialogue, motives or plot facts absent from the source.",
    "Do NOT translate sentence by sentence or paragraph by paragraph. Read a whole beat, then write it again from scratch in Hindi. Rebuild sentences, reorder phrasing, and combine or split paragraphs whenever Hindi flows better. Convey meaning and feeling, never the English wording or its metaphors.",
    "REGISTER: everyday spoken Hindi — the Hindi of a well-written popular novel, a good web-series dialogue, or an educated person talking at home. Narration may be lightly formal; dialogue must sound exactly like real people speaking, with contractions, natural particles (ही, तो, ना, बस, अरे, यार where the character fits) and short turns.",
    "Prefer the common word over the literary one: लेकिन not परंतु/किंतु, और not एवं, या not अथवा, उसके बाद not तत्पश्चात, पास not समीप, आँख not नेत्र, कपड़े not वस्त्र, घर not गृह, खून not रुधिर, आँसू not अश्रु, बाल not केश, जवाब not प्रत्युत्तर, बातचीत not वार्तालाप, लगना not प्रतीत होना, दिखाई देना not दृष्टिगोचर होना, गुस्सा not क्रोधित, डर गया not भयभीत, हैरान not विस्मित. Never write a Sanskritised, archaic, news-anchor or stage-speech Hindi.",
    "Keep sentences short and mostly 8-20 words. Avoid heavy chains of clauses, avoid literal English idioms and calques ('उसके चेहरे पर एक मुस्कान खेल गई' style translationese), avoid invented compound words, avoid needless English words, and do not add poetic imagery of your own. Vary dialogue tags instead of repeating कहा.",
    "Keep the whole passage in past-tense storytelling; never slip into present tense mid-scene. Keep words that Hindi speakers actually use as loanwords in Devanagari (गेट, रैंक, हंटर, कार्ड, पार्किंग, लेवल, स्किल, गिल्ड, सिस्टम, फोन); do not invent literal Hindi translations for them.",
    "Use correct Hindi grammar, natural postpositions and consistent Devanagari spellings of names. Write ONLY Hindi in Devanagari, with numbers in Devanagari; no Latin, Marathi or other scripts or words. If the source has an episode heading, start with एपिसोड and its Devanagari number, then a natural Hindi title. Return only finished novel prose in plain text.",
  ].join("\n"),
  mr: [
    "You are a contemporary Marathi novelist writing for ordinary Maharashtrian readers. The English passage is your story reference, NOT a script to translate.",
    "Retell its scenes in original, natural Marathi prose as if the novel had been written in Marathi first. Keep the same characters, relationships, event order, actions, clues, emotional turns and outcome. Do not add any objects, actions, scenery, dialogue, motives or plot facts absent from the source.",
    "Do NOT translate sentence by sentence or paragraph by paragraph. Read a whole beat, then write it again from scratch in Marathi. Rebuild sentences, reorder phrasing, and combine or split paragraphs whenever Marathi flows better. Convey meaning and feeling, never the English wording or its metaphors.",
    "REGISTER: everyday spoken Marathi — the Marathi of a good popular novel or a well-written Marathi serial. Narration may be lightly formal; dialogue must sound exactly like people actually talk, with natural particles (च, ना, अरे, बरं, काय रे) and short turns suited to the character's age and relationship.",
    "Prefer the common word over the literary one: पण not परंतु, तरीही not तथापि, किंवा not अथवा, त्यानंतर not तत्पश्चात, जवळ not समीप, डोळे not नेत्र, कपडे not वस्त्र, घर not गृह, रक्त not रुधिर, केस not केश, उत्तर not प्रत्युत्तर, बोलणं not संभाषण, वाटलं not प्रतीत झालं, म्हणाला not उद्गारला, रागावला not क्रोधित झाला, घाबरला not भयभीत झाला. Never write Sanskritised, archaic or speech-like Marathi.",
    "Marathi must be Marathi, never Hindi in Devanagari: आणि not और, पण not लेकिन, कारण not क्योंकि, नाही not नहीं, आहे/होतं not है/था, त्याने not उसने, मला not मुझे. Use correct Marathi verb endings and genders throughout.",
    "Keep sentences short and mostly 8-20 words, but complete — do not write strings of two-word fragments. Avoid literal English idioms and calques, invented words, needless English words and self-added poetic imagery. Vary dialogue tags instead of repeating म्हणाला.",
    "Write standard Maharashtrian Marathi only — never Konkani or another dialect. Never use forms like मजकूराचो, आवाजाचो, बसल्लं, हांव, आसा; write मजकुराचा, आवाजाचा, बसलं. Spell every word correctly.",
    "Keep the whole passage in past-tense storytelling; never slip into present tense mid-scene. Keep words that Marathi speakers actually use as loanwords in Devanagari (गेट, रँक, हंटर, कार्ड, पार्किंग, लेव्हल, स्किल, गिल्ड, सिस्टम, फोन); do not invent literal Marathi translations for them.",
    "Use consistent Devanagari spellings of names. Write ONLY Marathi in Devanagari, with numbers in Devanagari; no Latin or other scripts. If the source has an episode heading, start with एपिसोड and its Devanagari number, then a natural Marathi title. Return only finished novel prose in plain text.",
  ].join("\n"),
};

function chunkParagraphs(text: string, maxWords = 350): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let count = 0;
  for (const para of text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
    const w = para.split(/\s+/).length;
    if (count + w > maxWords && current.length) {
      chunks.push(current.join("\n\n"));
      current = [];
      count = 0;
    }
    current.push(para);
    count += w;
  }
  if (current.length) chunks.push(current.join("\n\n"));
  return chunks;
}

const COMMON_CAPS = new Set(["The","A","An","He","She","They","It","His","Her","I","But","And","Then","When","Episode","Part","In","On","At","No","Yes","Not","So","If","As","We","You","Of","For","With","What","Why","How","Now","Even","Something","Someone","Nothing","Down","Up","Out","Her.","The."]);

/** Proper names in the source, so every chunk spells them the same way. */
function properNames(text: string): string[] {
  const found = new Map<string, number>();
  for (const match of text.matchAll(/\b[A-Z][a-z]{2,}\b/g)) {
    const word = match[0];
    if (COMMON_CAPS.has(word)) continue;
    found.set(word, (found.get(word) ?? 0) + 1);
  }
  return [...found.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([word]) => word);
}

function adaptationProblems(text: string, source: string): string[] {
  const problems: string[] = [];
  const dev = text.match(/[\u0900-\u097f]/g)?.length ?? 0;
  const lat = text.match(/[A-Za-z]/g)?.length ?? 0;
  const srcWords = source.split(/\s+/).length;
  const outWords = text.split(/\s+/).filter(Boolean).length;
  if (dev < 50 || outWords < srcWords * 0.5) problems.push("the story passage is incomplete");
  // A stray English word is a wording slip, not a broken scene; only a real
  // chunk of another script means the retelling failed.
  if (
    lat > Math.max(40, dev * 0.03) ||
    /[\u0590-\u08ff\u0980-\u0dff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0400-\u052f]/u.test(text)
  ) {
    problems.push("non-Devanagari writing remains");
  }
  if (/(.)\1{15,}/u.test(text)) problems.push("repeated, corrupted characters");
  if (/^Episode\s*\d+/im.test(source) && !/^एपिसोड\s*[०-९]+/m.test(text)) {
    problems.push("the episode heading is missing");
  }
  return problems;
}

/** Retells one finished English part as original Hindi/Marathi prose, scene by scene. */
export async function translatePart(
  data: { lang: "hi" | "mr"; english: string; previousTranslated: string },
  progress?: AgnesProgress | undefined,
) {
  const apiKey = getApiKey(data.lang);
  const out: string[] = [];
  const names = properNames(data.english);
  for (const chunk of chunkParagraphs(data.english)) {
    const context = (out.at(-1) ?? data.previousTranslated).slice(-800);
    const call = (correction?: string) =>
      agnesChat({
        apiKey,
        model: AGNES_INDIC_MODEL,
        progress,
        maxTokens: 8000,
        temperature: correction ? 0.2 : 0.35,
        messages: [
          { role: "system", content: TRANSLATE_RULES[data.lang] },
          {
            role: "user",
            content: [
              context
                ? `Previous passage of your ${data.lang === "hi" ? "Hindi" : "Marathi"} novel (for continuity of names, voice and scene only — do NOT repeat it):\n"""\n${context}\n"""\n`
                : "",
              names.length
                ? `Names in this story (transliterate each into Devanagari and spell it the same way every time; never change, shorten or replace a name): ${names.join(", ")}.`
                : "",
              /^Episode\s*\d+/im.test(chunk)
                ? `Begin with exactly "एपिसोड ${String(chunk.match(/^Episode\s*(\d+)/im)?.[1] ?? "1").replace(/\d/g, (digit) => "०१२३४५६७८९"[Number(digit)] ?? digit)}: <natural title>". Do not use अध्याय or प्रकरण.`
                : "Do not add any heading.",
              `Write this section of your novel based on the English reference below. Keep every story fact, but not its sentence structure. Keep roughly the same amount of story: do not expand small passages into long scenes. Do not invent descriptions, details or dialogue:\n"""\n${chunk}\n"""`,
              correction ? `Your previous draft had this problem: ${correction}. Rewrite the entire section in simple, idiomatic language; do not reuse the flawed draft.` : "",
            ].join("\n"),
          },
        ],
      });
    // Hard problems (missing content, wrong script) must be fixed; wording problems
    // are graded, so we keep the cleanest draft rather than failing the whole run.
    const grade = (draft: string) => {
      const hard = adaptationProblems(draft, chunk);
      const style = findIndicStyleProblems(draft, data.lang).problems;
      const latin = draft.match(/[A-Za-z]+/g) ?? [];
      if (latin.length) {
        style.push(`some words are still in Latin script (${[...new Set(latin)].slice(0, 6).join(", ")}) — write them in Devanagari`);
      }
      return { hard, style, all: [...hard, ...style] };
    };
    let text = cleanNovelText(await call());
    let result = grade(text);
    let best = { text, score: result.all.length, hard: result.hard.length };
    for (let i = 0; i < 3 && result.all.length; i++) {
      const candidate = cleanNovelText(await call(result.all.join("; ")));
      const candidateResult = grade(candidate);
      const better =
        candidateResult.hard.length < best.hard ||
        (candidateResult.hard.length === best.hard && candidateResult.all.length < best.score);
      if (better) {
        best = {
          text: candidate,
          score: candidateResult.all.length,
          hard: candidateResult.hard.length,
        };
      }
      text = candidate;
      result = candidateResult;
      if (!candidateResult.all.length) break;
    }
    if (best.hard > 0) {
      throw new Error(
        `The ${data.lang === "hi" ? "Hindi" : "Marathi"} scene could not be completed cleanly (${grade(best.text).hard.join(", ")}). Please retry this language.`,
      );
    }
    out.push(best.text);
  }
  return { text: out.join("\n\n") };
}
