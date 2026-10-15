/* Songwriter: rhymes and syllables.
   Pure functions only (no screen code), like theory.js, so they can be tested and reused.

   How it works: every word in the word list (words.js) is written as its sounds, from the
   CMU Pronouncing Dictionary. "stop" is S T AA1 P: consonants, plus vowels with a stress
   number (1 = the loud syllable, 2 = a bit loud, 0 = quiet).

   A word's rhyme part (its "tail") is everything from its last loud vowel to the end:
   stop → AA P, golden → OW L D AH N. Two words rhyme by comparing tails:
     perfect  the tails are the same                         stop / top
     family   same vowels; each consonant is a close cousin  stop / lot (P and T are both "stop" sounds)
              or an open vowel plus one soft sound            day / rain, me / seen, go / home
     vowel    just the vowels match                          stop / mob
   (One side adding a sound at the end, star / start, lands under vowel.)
   Strictness 0-2 (Perfect, Family, Vowel) lists that kind and every closer kind.

   Also here: the offline thesaurus (thesaurus.js, from WordNet: synonyms and antonyms grouped by
   meaning) and ranking the extra online words from Datamuse (the screen does the asking). */
(function (root) {
  var SW = root.SW = root.SW || {};

  var CONSONANTS = ['B', 'CH', 'D', 'DH', 'F', 'G', 'HH', 'JH', 'K', 'L', 'M', 'N', 'NG', 'P', 'R', 'S', 'SH', 'T', 'TH', 'V', 'W', 'Y', 'Z', 'ZH'];
  var VOWELS = ['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW'];
  var SYMBOLS = CONSONANTS.concat([].concat.apply([], VOWELS.map(function (v) { return [v + '0', v + '1', v + '2']; })));
  // One character per sound, so the word list stays small. Index matches SYMBOLS.
  var CODE = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&*+';

  // Consonant families: sounds made the same way, which most ears hear as near rhymes.
  var FAMILY = {
    P: 'stop', T: 'stop', K: 'stop',                     // p t k
    B: 'vstop', D: 'vstop', G: 'vstop',                  // b d g
    M: 'hum', N: 'hum', NG: 'hum',                       // m n ng
    F: 'hiss', TH: 'hiss', S: 'hiss', SH: 'hiss', CH: 'hiss',   // f th s sh ch
    V: 'buzz', DH: 'buzz', Z: 'buzz', ZH: 'buzz', JH: 'buzz'    // v th("the") z zh j
  };
  var TYPES = ['perfect', 'family', 'vowel'];
  var STRICTNESS = ['Perfect', 'Family', 'Vowel'];

  var isVowel = function (p) { return /\d$/.test(p); };

  /** CMU sounds → one-character code (used by build-words.js). */
  function encode(phones) {
    return phones.map(function (p) {
      var i = SYMBOLS.indexOf(p);
      if (i < 0) throw new Error('Unknown sound ' + p);
      return CODE[i];
    }).join('');
  }
  function decode(code) {
    var out = [];
    for (var i = 0; i < code.length; i++) out.push(SYMBOLS[CODE.indexOf(code[i])]);
    return out;
  }

  /** Where the rhyme starts: the last loud (1) vowel, else the last a-bit-loud (2) one, else the last vowel. */
  function tailStart(phones) {
    var last1 = -1, last2 = -1, lastV = -1;
    phones.forEach(function (p, i) {
      if (!isVowel(p)) return;
      lastV = i;
      if (p[p.length - 1] === '1') last1 = i;
      if (p[p.length - 1] === '2') last2 = i;
    });
    return last1 >= 0 ? last1 : last2 >= 0 ? last2 : Math.max(lastV, 0);
  }

  /** The rhyme part, ready to compare. Quiet "uh" and "ih" sound alike, so they count as one sound. */
  function tail(phones) {
    var part = phones.slice(tailStart(phones));
    return part.map(function (p, i) {
      if (!isVowel(p)) return p;
      var v = p.slice(0, -1);
      if ((v === 'IY' || v === 'IH') && part[i + 1] === 'R') v = 'IY';   // "ear" sound: here / fear are written differently but sound the same
      if (i > 0 && p[p.length - 1] === '0' && (v === 'AH' || v === 'IH')) return 'UH0';   // quiet "uh"
      return v;
    });
  }

  // "cot" and "caught" sound the same to most American ears, so AA and AO match beyond Perfect.
  // Vowels that sound alike when sung count as one beyond Perfect: "cot"/"caught" (AA/AO), "ih"/"ee"
  // (thing/mean: "-ing" is usually sung "-een"), and "oo" as in good/food (UH/UW).
  // "ih"/"ee" only blur right before m, n, ng (thing / mean, sin / seen, him / team); elsewhere they're
  // clearly different (live / leave). (Before r they're one sound, "ear"; tail() writes both as IY.)
  var CLOSE = { AO: 'AA', UW: 'UH' };
  var NASAL = { M: 1, N: 1, NG: 1 };
  var nearVowel = function (v, next) {
    if ((v === 'IY' || v === 'IH') && NASAL[next]) return 'IH';
    return CLOSE[v] || v;
  };
  /** The vowels of a tail, with close ones counted as one (each looks at the sound after it). */
  var nearVowels = function (t) { return t.map(function (p, i) { return isVowelToken(p) ? nearVowel(p, t[i + 1]) : null; }).filter(function (v) { return v; }); };
  var sameFamily = function (a, b) { return a === b || (FAMILY[a] && FAMILY[a] === FAMILY[b]); };
  // Looser cousins: same voicing across stop/hiss groups. Voiced (your voice buzzes): b d g + v z th j;
  // voiceless (just air): p t k + f s sh ch. So liv / did, lot / loss.
  var VOICING = { B: 'v', D: 'v', G: 'v', V: 'v', DH: 'v', Z: 'v', ZH: 'v', JH: 'v', P: 'u', T: 'u', K: 'u', F: 'u', TH: 'u', S: 'u', SH: 'u', CH: 'u' };
  var sameVoicing = function (a, b) { return !!VOICING[a] && VOICING[a] === VOICING[b]; };

  // Soft (voiced) sounds that can be added after an open vowel and still feel like a family rhyme:
  // day / rain, me / seen, go / home. (day / date, with a hard T, stays a vowel rhyme.)
  var SOFT_ADD = { M: 1, N: 1, NG: 1, D: 1, B: 1, G: 1, L: 1, Z: 1, V: 1 };

  /** How closely two tails rhyme, as a score: 0 perfect; 1 family (same vowel, cousin sounds),
      1.3 family with close vowels (thing / mean), 1.4 family by an added soft sound (day / rain),
      1.5 family by voicing only (liv / did: both buzzy), 1.6 that plus close vowels;
      2 vowel, 2.3 vowel with close vowels; -1 not at all. Whole number = the kind (see compareTails);
      the fraction only decides which of two family rhymes is closer. */
  function tailScore(a, b) {
    var i;
    if (a.join() === b.join()) return 0;
    var exactVowels = a.filter(isVowelToken).join() === b.filter(isVowelToken).join();
    // Open ending vs. the same thing plus one soft sound (day / rain, me / seen): family. Same vowel only.
    var longer = a.length > b.length ? a : b, shorter = longer === a ? b : a;
    if (longer.length === shorter.length + 1 && isVowelToken(shorter[shorter.length - 1]) && SOFT_ADD[longer[longer.length - 1]] &&
        longer.slice(0, -1).join() === shorter.join()) return 1.4;
    var va = nearVowels(a), vb = nearVowels(b);
    var sameVowels = va.join() === vb.join();
    if (sameVowels && a.length === b.length) {
      var byVoicing = false;
      for (i = 0; i < a.length; i++) {
        if (isVowelToken(a[i]) !== isVowelToken(b[i])) break;
        if (isVowelToken(a[i])) { if (nearVowel(a[i], a[i + 1]) !== nearVowel(b[i], b[i + 1])) break; }
        else if (!sameFamily(a[i], b[i])) { if (sameVoicing(a[i], b[i])) byVoicing = true; else break; }
      }
      if (i === a.length) return byVoicing ? (exactVowels ? 1.5 : 1.6) : exactVowels ? 1 : 1.3;
    }
    if (sameVowels) return exactVowels ? 2 : 2.3;
    return -1;
  }
  /** How two tails rhyme: 0 perfect, 1 family, 2 vowel, or -1 not at all. */
  function compareTails(a, b) { var s = tailScore(a, b); return s < 0 ? -1 : Math.floor(s); }

  /** Closeness score of two words (see tailScore); the same word scores 0; unknown words -1. */
  function wordScore(dict, a, b) {
    if (a === b) return 0;
    var i = find(dict, a), j = find(dict, b);
    return i < 0 || j < 0 ? -1 : bestScore(dict.tails[i], dict.tails[j]);
  }
  function isVowelToken(t) { return VOWELS.indexOf(t) >= 0 || t === 'UH0'; }

  /** Turns the word list text (SW.WORDS) into something fast to search. */
  /** Entry "word CODE[,ALT…]" ("^word" = not a dictionary word, e.g. a name; "+word" = a verb). tails[i]
      holds the rhyme part of every way to say the word ("live" = lyve / liv); phones[i] is the usual way. */
  function load(text) {
    var words = [], phones = [], alts = [], tails = [], real = [], verb = [], index = Object.create(null);
    text.split('|').forEach(function (entry, i) {
      var sp = entry.indexOf(' '), w = entry.slice(0, sp), isName = w[0] === '^', isVerb = w[0] === '+';
      if (isName || isVerb) w = w.slice(1);
      verb.push(isVerb);
      // Other ways to say it count for rhyming only if they're real ones: not a mumbled form with no
      // stressed vowel ("to" as "tih", "does" as "diz"), and not for small grammar words ("says" as "siz").
      var all = entry.slice(sp + 1).split(',').map(decode).filter(function (ph, k) {
        return k === 0 || (!GRAMMAR_WORDS[w] && ph.some(function (p) { return /[12]$/.test(p); }));
      });
      words.push(w); phones.push(all[0]); alts.push(all); tails.push(all.map(tail)); real.push(!isName);
      index[w] = i;
    });
    return { words: words, phones: phones, alts: alts, tails: tails, real: real, verb: verb, index: index, phrases: null };
  }

  /** The closest score between any way of saying one word and any way of saying the other. */
  function bestScore(ta, tb) {
    var best = -1;
    ta.forEach(function (a) { tb.forEach(function (b) { var s = tailScore(a, b); if (s >= 0 && (best < 0 || s < best)) best = s; }); });
    return best;
  }

  // ---------- Ordering rhymes by how usable they are in a lyric ----------
  // Mostly how common the word is (everyday words first), names and odd words much lower, and a
  // little for how close it sounds, so a common family rhyme ("lot") can beat an obscure perfect
  // one ("plop"). The strictness slider still decides which kinds are listed.
  var CLOSENESS = { 0: 1, 1: 0.75, 1.3: 0.65, 1.4: 0.6, 1.5: 0.55, 1.6: 0.5, 2: 0.4, 2.3: 0.3 };
  var SONORANT = { M: 1, N: 1, NG: 1, L: 1, R: 1, W: 1, Y: 1 };   // humming / flowing sounds

  /** For vowel rhymes (only the vowels match): how alike the endings sound, 0 … 1. Compares the
      consonants from the end of the word: the last one counts most (same sound > same family > same
      voicing > both humming/flowing), then the ones before it, then whether both have the same number
      of consonants (an open ending vs. "-ixth" is far apart). liv / film beats liv / sixth. */
  function endingLikeness(a, b) {
    var ca = a.filter(notVowelToken), cb = b.filter(notVowelToken);
    if (!ca.length && !cb.length) return 1;
    if (!ca.length || !cb.length) return 0.25;
    var pair = function (x, y) {
      if (x === y) return 1;
      if (sameFamily(x, y)) return 0.8;
      if (sameVoicing(x, y)) return 0.6;
      if (SONORANT[x] && SONORANT[y]) return 0.5;
      return 0.15;
    };
    var n = Math.min(ca.length, cb.length), last = pair(ca[ca.length - 1], cb[cb.length - 1]), rest = 0;
    for (var k = 2; k <= n; k++) rest += pair(ca[ca.length - k], cb[cb.length - k]);
    var sounds = n > 1 ? 0.7 * last + 0.3 * rest / (n - 1) : last;
    var shape = 1 - Math.abs(ca.length - cb.length) / Math.max(ca.length, cb.length);
    return 0.65 * sounds + 0.35 * shape;
  }
  function notVowelToken(t) { return !isVowelToken(t); }
  // Grammar words (and filler sounds): only their usual pronunciation counts for rhyming ("says" isn't
  // "siz"). They're ranked like any other word: me, you, did, do… are classic line endings.
  var GRAMMAR_WORDS = {};
  ('a an the to of in on at by for with from into onto upon is am are was were be been being do does did ' +
    'has have had i me my mine you your yours he him his she her hers it its we us our ours they them their ' +
    'theirs this that these those and or but if as so than then which what who whom whose says said can ' +
    'could would should will shall may might must just ' +
    'uh um huh hmm mm ah eh er erm uhh umm').split(' ').forEach(function (w) { GRAMMAR_WORDS[w] = true; });   // + filler sounds
  // ---------- Lyric bump (lyricwords.js) ----------
  // How often each word is sung (musiXmatch song-lyric counts), 0 … 1. Every word-sheet list uses it
  // as a small push up for words songs actually use, never as the whole sort (or every list would
  // start love, baby, heart).
  var LYRIC_DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
  /** Adds the sung-word counts to a loaded word list (ignored if they were made for another list). */
  function addLyrics(dict, code) {
    if (code && code.length === dict.words.length) dict.lyric = code;
    return dict;
  }
  function lyricAt(dict, j) { return LYRIC_DIGITS.indexOf(dict.lyric[j]) / 35; }
  /** How often a word is sung, 0 … 1 (0 for words not in the list). A phrase counts as its least-sung
      real word ("heart of gold" → gold). null when the counts aren't loaded. */
  function lyricOf(dict, word) {
    if (!dict || !dict.lyric) return null;
    var parts = clean(word).split(/[ -]+/).filter(function (p) { return p && !GRAMMAR_WORDS[p]; });
    if (!parts.length) parts = clean(word).split(/[ -]+/);
    return Math.min.apply(null, parts.map(function (p) { var j = find(dict, p); return j >= 0 && dict.real[j] && p.indexOf("'") < 0 ? lyricAt(dict, j) : 0; }));
  }
  function usability(dict, j) {
    var w = dict.words[j], u = 1 - Math.log(j + 1) / Math.log(dict.words.length + 1);   // most common word → 1
    // Lyric bump: sung words a bit higher. Contractions were counted as their first word (why're = why),
    // so they get a middling count; names and foreign words get none (the song counts include other
    // languages, so "hier" and "se" would look sung).
    if (dict.lyric) u = 0.75 * u + 0.25 * (!dict.real[j] ? 0 : w.indexOf("'") >= 0 ? 0.5 : lyricAt(dict, j));
    if (!dict.real[j]) u *= 0.35;                                                       // names, foreign words, abbreviations
    if (w.indexOf("'") >= 0) u *= 0.9;                                                  // contractions, a little lower
    return u;
  }

  /** Lower case, straight apostrophes, no punctuation around it ("Stop!" → "stop"). */
  function clean(word) {
    var w = String(word || '').toLowerCase().replace(/[‘’`]/g, "'").replace(/^[^a-z']+|[^a-z']+$/g, '').replace(/^'+/, '');
    return /in'$/.test(w) ? w : w.replace(/'+$/, '');   // keep the apostrophe in "runnin'"
  }

  /** Word list lookup that also understands "runnin'" (= running). */
  function find(dict, word) {
    var w = clean(word);
    if (w in dict.index) return dict.index[w];
    if (/in'$/.test(w) && (w.slice(0, -1) + 'g') in dict.index) return dict.index[w.slice(0, -1) + 'g'];
    return -1;
  }

  /** Syllables in a word. Words the list doesn't know are guessed from their spelling. */
  function syllables(dict, word) {
    var i = find(dict, word);
    if (i >= 0) return dict.phones[i].filter(isVowel).length;
    var w = clean(word).replace(/'/g, '');
    if (!w) return 0;
    var groups = (w.match(/[aeiouy]+/g) || []).length;
    if (/[^aeiouyl]e$/.test(w) && groups > 1) groups--;   // silent e ("stone"), but not "table"
    return Math.max(1, groups);
  }

  /** How two words rhyme: 'perfect' | 'family' | 'vowel' | null (unknown word or no rhyme). */
  function rhymeType(dict, a, b) {
    var i = find(dict, a), j = find(dict, b);
    if (i < 0 || j < 0) return null;
    var s = bestScore(dict.tails[i], dict.tails[j]), t = s < 0 ? -1 : Math.floor(s);
    return t < 0 ? null : TYPES[t];
  }

  // ---------- Saying a word: spelled-out pronunciations ("liv", "lyve", "tuh-MAY-toh") ----------
  var SPELL_C = { B: 'b', CH: 'ch', D: 'd', DH: 'th', F: 'f', G: 'g', HH: 'h', JH: 'j', K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ng',
    P: 'p', R: 'r', S: 's', SH: 'sh', T: 't', TH: 'th', V: 'v', W: 'w', Y: 'y', Z: 'z', ZH: 'zh' };
  // Vowel spellings: [in a syllable that ends in a consonant, at the end of a syllable]
  var SPELL_V = { AA: ['ah', 'ah'], AE: ['a', 'a'], AH: ['u', 'uh'], AO: ['aw', 'aw'], AW: ['ow', 'ow'], AY: ['y', 'y'],
    EH: ['e', 'eh'], ER: ['ur', 'ur'], EY: ['ay', 'ay'], IH: ['i', 'ih'], IY: ['ee', 'ee'], OW: ['oh', 'oh'],
    OY: ['oy', 'oy'], UH: ['uu', 'uu'], UW: ['oo', 'oo'] };

  /** A pronunciation spelled out for reading: L AY1 V → "lyve", T AH0 M EY1 T OW2 → "tuh-MAY-toh"
      (the loud syllable in capitals when there's more than one). */
  function respell(phones) {
    var vowelsAt = [];
    phones.forEach(function (p, i) { if (isVowel(p)) vowelsAt.push(i); });
    if (!vowelsAt.length) return phones.map(function (p) { return SPELL_C[p] || ''; }).join('');
    // Syllables: each vowel gets the consonants before it (but leaves one for itself if there are
    // several between two vowels: "win-ter").
    var cuts = [0];
    for (var k = 1; k < vowelsAt.length; k++) {
      var between = vowelsAt[k] - vowelsAt[k - 1] - 1;
      cuts.push(vowelsAt[k] - (between > 1 ? 1 : between));
    }
    var sylls = cuts.map(function (c, k) { return phones.slice(c, k + 1 < cuts.length ? cuts[k + 1] : phones.length); });
    var many = sylls.length > 1;
    return sylls.map(function (s) {
      var vi = s.findIndex(isVowel), v = s[vi].slice(0, -1), loud = s[vi].slice(-1) === '1';
      var onset = s.slice(0, vi).map(function (p) { return SPELL_C[p]; }).join('');
      var coda = s.slice(vi + 1).map(function (p) { return SPELL_C[p]; }).join('');
      var vs = SPELL_V[v][coda ? 0 : 1];
      if (v === 'AY' && !onset && !coda) vs = 'eye';
      // Vowel + r reads better spelled together: "tair", "teer", "KORD", "car", "poor".
      var R_SPELL = { AA: 'ar', AO: 'or', OW: 'or', EH: 'air', AE: 'air', EY: 'air', IH: 'eer', IY: 'eer', UH: 'oor', UW: 'oor' };
      if (coda[0] === 'r' && R_SPELL[v]) { vs = R_SPELL[v]; coda = coda.slice(1); }
      var out = onset + vs + coda + (v === 'AY' && coda && coda.length === 1 ? 'e' : '');   // "lyve", "fyne"
      return many && loud ? out.toUpperCase() : out;
    }).join('-');
  }

  /** The different ways to say a word that rhyme differently: [{ pron (index), label ("liv") }].
      Fewer than two → nothing to choose. */
  function pronunciations(dict, word) {
    var i = find(dict, word);
    if (i < 0) return [];
    var seen = {}, out = [];
    dict.alts[i].forEach(function (ph, k) {
      var key = dict.tails[i][k].join(' ');
      if (seen[key]) return;
      seen[key] = true;
      out.push({ pron: k, label: respell(ph) });
    });
    return out.length > 1 ? out : [];
  }

  // ---------- Two-word rhymes: a verb + a light word ("told him", "hold it", "show me") ----------
  var PHRASE_ENDS = ['it', 'me', 'you', 'him', 'her', 'them', 'us'];
  var PHRASE_VERBS = 6000;   // the most common verbs only

  /** Builds the two-word phrases once (the first time they're needed): [{ text, tails, j (verb's place) }]. */
  function phrases(dict) {
    if (dict.phrases) return dict.phrases;
    var ends = PHRASE_ENDS.map(function (w) {
      var k = dict.index[w];
      var ph = dict.phones[k].map(function (p) { return /\d$/.test(p) ? p.slice(0, -1) + '0' : p; });   // said lightly
      if (ph[0] === 'HH') ph = ph.slice(1);   // "told 'im", "kiss 'er": the h drops when sung
      return { w: w, k: k, ph: ph };
    });
    var out = [];
    for (var j = 0, n = 0; j < dict.words.length && n < PHRASE_VERBS; j++) {
      if (!dict.verb[j]) continue;
      n++;
      ends.forEach(function (e) {
        out.push({ text: dict.words[j] + ' ' + e.w, j: j, end: e.k, tails: dict.alts[j].map(function (ph) { return tail(ph.concat(e.ph)); }) });
      });
    }
    // Quick lookup by the rhyme's first vowel, so a search only checks phrases that could match.
    out.byVowel = {};
    out.forEach(function (p) {
      p.tails.forEach(function (tl) { var key = vowelKey(tl); (out.byVowel[key] = out.byVowel[key] || []).indexOf(p) < 0 && out.byVowel[key].push(p); });
    });
    return (dict.phrases = out);
  }
  /** A tail's first (stressed) vowel, with close vowels counted as one. */
  function vowelKey(tl) { return nearVowel(tl[0], tl[1]); }

  /** The rhyme parts of a word, or of a phrase like "hold it" (from its last stressed syllable). */
  function tailsOf(dict, word) {
    var i = find(dict, word);
    if (i >= 0) return dict.tails[i];
    var spans = wordSpans(String(word));
    if (spans.length < 2) return null;
    var p = phraseEnd(dict, spans);
    return p ? [p.tail] : null;
  }

  /** Rhymes for a word, most usable first (see usability; closeness counts a little).
      pron (optional) = rhyme only one way of saying it (an index from pronunciations()).
      Returns null if the word isn't in the list; otherwise [{ word, syllables, type }]. */
  function rhymes(dict, word, strictness, pron) {
    var i = find(dict, word), all = tailsOf(dict, word);
    if (!all) return null;
    var mine = i >= 0 && pron >= 0 && dict.tails[i][pron] ? [dict.tails[i][pron]] : all, found = [];
    for (var j = 0; j < dict.words.length; j++) {
      if (j === i) continue;
      var sc = bestScore(mine, dict.tails[j]), t = sc < 0 ? -1 : Math.floor(sc);
      if (t < 0 || t > strictness) continue;
      if (sc === 1.4 && dict.words[j].indexOf("'") >= 0) continue;   // "we've" for "me": just the word plus a contraction
      var w = dict.words[j];
      var score;
      if (t === 2) {
        // Vowel rhymes: how alike the endings sound matters as much as how common the word is.
        var like = 0;
        mine.forEach(function (a) { dict.tails[j].forEach(function (b) { if (compareTails(a, b) === 2) like = Math.max(like, endingLikeness(a, b)); }); });
        score = 0.3 * usability(dict, j) + 0.55 * like;
      } else score = 0.65 * usability(dict, j) + 0.35 * CLOSENESS[sc];
      found.push({ word: w, syllables: dict.phones[j].filter(isVowel).length, type: TYPES[t], t: t, score: score });
    }
    // Two-word rhymes (perfect or family only): "golden" → "told him", "broken" → "woke it".
    var self = clean(word);
    var ph = phrases(dict), candidates = [];
    mine.forEach(function (a) { (ph.byVowel[vowelKey(a)] || []).forEach(function (p) { if (candidates.indexOf(p) < 0) candidates.push(p); }); });
    candidates.forEach(function (p) {
      if (p.text === self) return;
      var sc = -1;
      mine.forEach(function (a) { p.tails.forEach(function (b) { var s = tailScore(a, b); if (s >= 0 && (sc < 0 || s < sc)) sc = s; }); });
      // Only perfect and the closest family matches (cousin consonants, close vowels): looser ones are
      // too far-fetched for a phrase. Sound counts as much as how common the verb is.
      if (sc < 0 || sc > 1.3 || Math.floor(sc) > strictness) return;
      var t = Math.floor(sc);
      found.push({ word: p.text, phrase: true, syllables: dict.phones[p.j].filter(isVowel).length + 1, type: TYPES[t], t: t,
        score: 0.5 * Math.min(usability(dict, p.j), usability(dict, p.end)) + 0.5 * CLOSENESS[sc] });
    });
    found.sort(function (x, y) { return y.score - x.score; });
    return found.map(function (r) { return { word: r.word, syllables: r.syllables, type: r.type, phrase: !!r.phrase }; });
  }

  // ---------- Lyric lines: syllables and rhyme letters ----------
  /** The words of a lyric line, as typed ("Engine running, couldn't stop" → Engine, running, couldn't, stop). */
  function lineWords(line) { return (String(line).match(/[A-Za-z‘’'][A-Za-z‘’'-]*/g) || []).filter(function (w) { return /[a-z]/i.test(w); }); }

  /** Syllables in a line (words the list doesn't know are guessed from spelling). */
  function lineSyllables(dict, line) {
    return lineWords(line).reduce(function (n, w) {
      return n + w.split('-').reduce(function (m, part) { return m + (part ? syllables(dict, part) : 0); }, 0);
    }, 0);
  }

  var LEVEL = { perfect: 0, family: 1, vowel: 2 };
  var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  // Small words a singer doesn't lean on at the end of a line ("hold IT", "tell ME"): the rhyme
  // starts on the word before them.
  var LIGHT = {};
  ('a an the to of in on at for with and or but is was am are be been it me you him her them us ' +
    'my your his its our their ya em \'em').split(' ').forEach(function (w) { LIGHT[w] = true; });

  /** How two line-ending words rhyme: 'perfect' | 'family' | 'vowel' | null. */
  function lineRhyme(dict, a, b) {
    if (a === b) return 'perfect';
    return rhymeType(dict, a, b);
  }

  /** Words of a line with where they are: [{ word (as typed), key (cleaned), start, end }]. */
  function wordSpans(line) {
    var out = [], re = /[A-Za-z‘’'][A-Za-z‘’'-]*/g, m;
    while ((m = re.exec(line))) if (/[a-z]/i.test(m[0])) out.push({ word: m[0], key: clean(m[0]), start: m.index, end: m.index + m[0].length });
    return out;
  }

  /** A line's multi-syllable ending: the sounds from its last stressed syllable to the end, reading
      light words at the end ("it", "me") as unstressed, so "hold it" ends "-old it" like "golden".
      Returns { tail, from (index of the first word in it), multi (more than one word) } or null. */
  function phraseEnd(dict, spans) {
    var phones = [], owner = [];
    for (var k = spans.length - 1; k >= 0 && k >= spans.length - 4; k--) {
      var i = find(dict, spans[k].key);
      if (i < 0) return null;
      var ph = dict.phones[i].map(function (p) { return LIGHT[spans[k].key] && /\d$/.test(p) ? p.slice(0, -1) + '0' : p; });
      if (LIGHT[spans[k].key] && k > 0 && ph[0] === 'HH') ph = ph.slice(1);   // "told 'im": a light word's h drops
      phones = ph.concat(phones); owner = ph.map(function () { return k; }).concat(owner);
      if (!LIGHT[spans[k].key] && ph.some(function (p) { return /[12]$/.test(p); })) {
        var st = tailStart(phones);
        return { tail: tail(phones), from: owner[st], multi: owner[st] < spans.length - 1 };
      }
    }
    return null;
  }

  /** Rhyme letters for a section's lines.
      Line endings are compared two ways and the closer match wins: the last words ("me" / "me"), and
      the multi-syllable endings ("broken" / "hopin'", "hold it" / "golden"). Each line pairs with the
      line(s) it rhymes with *best* (so "thing" goes with "mean", not with "me" on a looser match),
      and paired lines share a letter, A, B, C… in order of appearance.
      kind: perfect (solid), family (dashed), vowel (dotted), picked (you chose it).
      picked = letters you chose yourself, by word: { mean: 'B', skrrt: '-' } ('-' = no letter). A
      picked word in the middle of a line gets that letter's underline too (an inner rhyme you marked).
      Returns { lines: [{ letter, kind, near, word, end, syllables, underline: [{ start, end, letter, kind }] }], scheme }. */
  function rhymeScheme(dict, lines, picked) {
    picked = picked || {};
    var info = lines.map(function (line) {
      var spans = wordSpans(line), last = spans.length ? spans[spans.length - 1] : null;
      return {
        letter: '', kind: '', near: false, word: last ? last.word : '', end: last ? last.key : '',
        syllables: lineSyllables(dict, line), spans: spans, phrase: spans.length ? phraseEnd(dict, spans) : null, from: spans.length - 1, underline: []
      };
    });
    var n = info.length, parent = info.map(function (x, i) { return i; }), mark = {};   // mark[root] = a picked letter
    var root = function (i) { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
    var join = function (i, j) {
      var a = root(i), b = root(j);
      if (a === b || (mark[a] && mark[b] && mark[a] !== mark[b])) return;   // never merge two different letters you picked
      parent[b] = a;
      if (mark[b]) mark[a] = mark[b];
    };
    var pickOf = function (i) { var p = info[i].end && picked[info[i].end]; return p && (p === '-' || LETTERS.indexOf(p) >= 0) ? p : null; };
    /** How lines i and j rhyme: { kind, phrase } (phrase = it's the multi-syllable endings that match). */
    // The same word at the end of two lines isn't a rhyme ("night" / "night"); only different words
    // count. A shared small word after different ones still can: "hold it" / "told it".
    var endWords = function (x) { return x.spans.slice(x.phrase.from).map(function (s) { return s.key; }).join(' '); };
    var match = function (i, j) {
      var a = info[i], b = info[j], same = a.end === b.end;
      var ws = same ? -1 : wordScore(dict, a.end, b.end), best = ws >= 0 ? { score: ws, kind: TYPES[Math.floor(ws)], phrase: false } : null;
      if (a.phrase && b.phrase && (a.phrase.multi || b.phrase.multi) && !(same && endWords(a) === endWords(b))) {
        var ps = tailScore(a.phrase.tail, b.phrase.tail);
        if (ps >= 0 && (!best || ps <= best.score)) best = { score: ps, kind: TYPES[Math.floor(ps)], phrase: true };
      }
      return best;
    };
    // Your letters first.
    var byLetter = {};
    info.forEach(function (x, i) {
      var p = pickOf(i);
      if (!p || p === '-') return;
      mark[root(i)] = p;
      if (byLetter[p] !== undefined) join(byLetter[p], i); else byLetter[p] = i;
      x.kind = 'picked';
    });
    // Then each other line joins the line(s) it rhymes with best.
    info.forEach(function (x, i) {
      if (!x.end || pickOf(i)) return;
      var best = null, partners = [];
      info.forEach(function (y, j) {
        if (j === i || !y.end || pickOf(j) === '-') return;
        var m = match(i, j);
        if (!m) return;
        if (!best || m.score < best.score) { best = m; partners = [j]; } else if (m.score === best.score) partners.push(j);
      });
      if (!best) return;
      x.kind = best.kind;
      if (best.phrase) x.from = x.phrase.from;
      partners.forEach(function (j) { join(i, j); if (best.phrase && !pickOf(j) && info[j].from === info[j].spans.length - 1) info[j].from = info[j].phrase.from; });
    });
    // Letters: picked groups keep theirs; other groups of 2+ lines get the next free letter in order.
    var size = {};
    info.forEach(function (x, i) { if (x.end && pickOf(i) !== '-') size[root(i)] = (size[root(i)] || 0) + 1; });
    var used = {}; Object.keys(mark).forEach(function (r) { if (root(+r) === +r) used[mark[r]] = true; });
    var auto = {}, next = 0;
    info.forEach(function (x, i) {
      if (!x.end || pickOf(i) === '-') { x.kind = ''; }
      else {
        var r = root(i);
        if (mark[r]) { x.letter = mark[r]; if (!x.kind) x.kind = 'perfect'; }
        else if (size[r] >= 2) {
          if (!auto[r]) { while (used[LETTERS[next % 26]]) next++; auto[r] = LETTERS[next % 26]; used[auto[r]] = true; }
          x.letter = auto[r];
          if (!x.kind) x.kind = 'perfect';
        } else x.kind = '';
      }
      x.near = x.kind === 'family' || x.kind === 'vowel';
      // What to underline: the rhyming ending (one word, or several for a multi-syllable rhyme)…
      if (x.letter) x.underline.push({ start: x.spans[x.from].start, end: x.spans[x.spans.length - 1].end, letter: x.letter, kind: x.kind });
      // …and any other word you gave a letter (an inner rhyme).
      var endFrom = x.letter ? x.from : x.spans.length;
      x.spans.forEach(function (s, k) {
        var p = picked[s.key];
        if (k < endFrom && p && p !== '-' && LETTERS.indexOf(p) >= 0) x.underline.push({ start: s.start, end: s.end, letter: p, kind: 'picked' });
      });
      x.underline.sort(function (a, b) { return a.start - b.start; });
      delete x.spans; delete x.phrase; delete x.from;
    });
    var scheme = info.filter(function (l, i) { return lines[i].trim(); }).map(function (l) { return l.letter || '·'; }).join('');
    return { lines: info, scheme: /[A-Z]/.test(scheme) ? scheme : '' };
  }

  // ---------- Synonyms & antonyms (Datamuse) ----------
  // Datamuse lists every meaning of a word in no useful order ("point" and "period" for stop,
  // from "full stop"). These sort its answers so the likely ones come first: words that are
  // true synonyms, closely related, common, and used the same way (a verb for a verb).
  // Each list item is Datamuse's { word, tags } (asked with md=fp: frequency + part of speech).
  var RARE = 0.3;   // per million words; rarer ones (kibosh) still show, but after all the others
  var freqOf = function (x) {
    var f = (x.tags || []).filter(function (t) { return t.indexOf('f:') === 0; })[0];
    return f ? +f.slice(2) : 0;
  };
  var posOf = function (x) { return (x.tags || []).filter(function (t) { return /^(n|v|adj|adv)$/.test(t); })[0] || null; };
  var popularity = function (f) { return Math.min(1, Math.log10(f + 1) / 2.5); };   // 0 rare … 1 very common
  var usable = function (word) { return function (x) { return x.word !== word && /^[a-z' -]+$/.test(x.word); }; };
  var rarePenalty = function (x) { return freqOf(x) < RARE ? 10 : 0; };   // sinks rare words below every common one

  /** Synonyms, best first. me = Datamuse's own entry for the word (for its part of speech),
      syns = rel_syn answers, related = ml ("means like") answers in Datamuse's order.
      maxCommon (optional) limits the common words; rare ones always follow, all of them.
      sung (optional): word → how often it's sung, 0 … 1 (lyricOf), for the lyric bump. */
  function rankSynonyms(word, me, syns, related, maxCommon, sung) {
    var myPos = me && me.word === word ? posOf(me) : null;
    var strict = {}, all = {};
    syns.forEach(function (x) { strict[x.word] = true; });
    related.forEach(function (x, i) { all[x.word] = { x: x, rel: Math.pow(1 - i / related.length, 2) }; });
    syns.forEach(function (x) { if (!all[x.word]) all[x.word] = { x: x, rel: 0.3 }; });
    return Object.keys(all).map(function (k) { return all[k]; }).filter(function (o) { return usable(word)(o.x); })
      .map(function (o) {
        var l = sung ? sung(o.x.word) : null;   // lyric bump, when the counts are loaded
        var common = l == null ? 0.3 * popularity(freqOf(o.x)) : 0.15 * popularity(freqOf(o.x)) + 0.15 * l;
        var score = 0.45 * o.rel + common + (strict[o.x.word] ? 0.25 : 0) + (myPos && posOf(o.x) === myPos ? 0.2 : 0) - rarePenalty(o.x);
        return { word: o.x.word, score: score, rare: !!rarePenalty(o.x) };
      })
      .sort(function (a, b) { return b.score - a.score; })
      .filter(function (o, i) { return o.rare || !maxCommon || i < maxCommon; })
      .map(function (o) { return o.word; });
  }

  /** Antonyms, best first: Datamuse's order counts a little, how common the word is counts more,
      and with sung(word) given (0 … 1, the lyric bump) how often it's sung counts too. */
  function rankAntonyms(word, ants, sung) {
    return ants.map(function (x, i) {
      var l = sung ? sung(x.word) : null;
      var common = l == null ? 0.75 * popularity(freqOf(x)) : 0.4 * popularity(freqOf(x)) + 0.35 * l;
      return { x: x, score: 0.25 * (1 - i / ants.length) + common - rarePenalty(x) };
    })
      .filter(function (o) { return usable(word)(o.x); })
      .sort(function (a, b) { return b.score - a.score; })
      .map(function (o) { return o.x.word; });
  }

  // ---------- Related words (Datamuse, the word sheet's Related tab) ----------
  var RELATED_GROUPS = [
    { id: 'phrases', label: 'Phrases & sayings' },       // sp=* word / word * / * word *: heart → heart of gold, take heart
    { id: 'describing', label: 'Describing words' },     // rel_jjb: adjectives used with a noun (ocean → deep, vast)
    { id: 'describes', label: 'Things it describes' },   // rel_jja: nouns an adjective is used with (broken → heart, glass)
    { id: 'next', label: 'Often next to' },              // lc / rc: words seen right after or before it (midnight → hour)
    { id: 'world', label: 'Same world' }                 // rel_trg: words that turn up with it (rain → thunder, mud)
  ];
  // Left out of Related on top of the grammar words: small words that go with anything (no, some,
  // between, very, began…) and plain sizes and amounts (little, much, last). They crowd out the
  // words a lyric can use.
  var RELATED_SKIP = {};
  ('no not nor any some all each every both either neither one two three four five ten first second ' +
    'last next other another same such own only even ever never always often again still already ' +
    'now then here there where when why how very too quite rather almost nearly just also yet else ' +
    'more most less least much many few several enough little lot lots whole various certain ' +
    'about above across after against along among around before behind below beneath beside between ' +
    'beyond during except inside like near off out outside over past since through throughout till ' +
    'toward towards under until up down within without away back once ' +
    'get gets got getting take takes took taking make makes made making came come comes coming go goes ' +
    'went going gone began begin having felt feel feels let put set say tell told seem seems ' +
    'new latter former recent previous major minor general common national public certain particular ' +
    'great good bad big small large high low long short real right left full non anti post pre ' +
    'thing things way ways part kind sort type time times day year years man men people').split(' ')
    .forEach(function (x) { RELATED_SKIP[x] = true; });
  // Phrases: "one's" / "someone's" read as "your" (eat your heart out), and other forms of the same
  // saying are shown once (have a heart of gold, had a heart of gold → heart of gold).
  var PHRASE_YOUR = /\b(one's|someone's|somebody's|oneself)\b/g;
  var PHRASE_ANY = /\b(your|my|his|her|their|our|one's|someone's|somebody's)\b/g;
  /** Phrases, sayings and idioms with the word in them, best first: how often their words are sung
      counts most (heart of gold before congestive heart failure), how common the phrase is counts
      too. Phrases with a word the list doesn't know, or a name, are left out; so are rarely-sung ones. */
  function relatedPhrases(dict, w, list) {
    var has = new RegExp('(^| )' + w.replace(/[^a-z']/g, '') + '( |$)');
    var seen = {}, out = [];
    list.map(function (x, i) {
      var p = x.word.replace(PHRASE_YOUR, 'your').replace(new RegExp('\\bones (?=' + w + ')'), 'your ');   // with all ones heart
      if (!/^[a-z][a-z' -]*$/.test(p) || p.indexOf(' ') < 0 || p.split(' ').length > 7 || !has.test(p)) return null;
      if (/^(a|an|the) [^ ]+$/.test(p)) return null;   // "the road" is no phrase
      var parts = p.split(/[ -]+/).filter(function (q) { return q !== w && !GRAMMAR_WORDS[q]; });
      if (!parts.every(function (q) { var j = find(dict, q); return j >= 0 && dict.real[j]; })) return null;
      var l = lyricOf(dict, p);
      if (l != null && l < 0.4) return null;   // rarely sung: medical, legal, technical (congestive heart failure)
      return { p: p, score: 0.3 * popularity(freqOf(x)) + 0.6 * (l == null ? 0.5 : l) + 0.1 * (1 - i / list.length) };
    }).filter(Boolean).sort(function (a, b) { return b.score - a.score; }).forEach(function (o) {
      // One of each saying: as right as rain = be as right as rain = right as rain; burn / burning / burned
      // the midnight oil; a bright spark = bright spark.
      var key = o.p.replace(PHRASE_ANY, '·').replace(/^(to |be |have |has |had |having )+/, '').replace(/^(a|an|the|as) /, '')
        .split(' ').map(function (q) { return q.replace(/(ing|ed|s)$/, '').replace(/e$/, '').replace(/(.)\1$/, '$1'); }).join(' ');
      if (seen[key]) return;
      seen[key] = true;
      out.push(o.p);
    });
    return out;
  }
  /** The Related tab's groups for a word, best first in each, each word in only one group.
      me = Datamuse's own entry for the word (part of speech, its first tag = its main use);
      a = { jjb, jja, after, before, trg, ml, pre, post, mid }, each a Datamuse answer list (asked
      with md=pf; pre / post / mid = phrases with the word last, first or inside).
      Datamuse's order counts most (it puts the telling words first: spark → electric, divine);
      how common a word is, and how often it's sung (the lyric bump), count a little. Grammar words, small everyday words, names, odd
      spellings and other forms of the word itself are left out; rare words come last.
      Returns [{ id, label, words }] for the groups that have any words. */
  function rankRelated(dict, word, me, a) {
    var w = clean(word), tags = me && clean(me.word) === w ? me.tags || [] : [];
    var main = tags.filter(function (t) { return /^(n|v|adj|adv)$/.test(t); })[0] || null;
    var forms = {};
    [w, w + 's', w + 'es', w + 'ed', w + 'd', w + 'ing', w.replace(/e$/, '') + 'ing', w + 'ly', w + 'ness',
      w.replace(/s$/, ''), w.replace(/es$/, ''), w.replace(/ey$/, 'y'), w.replace(/y$/, 'ey')]
      .forEach(function (f) { forms[f] = true; });
    var inMl = {};
    (a.ml || []).forEach(function (x) { inMl[x.word] = true; });
    var shown = {};
    var known = function (v) { return v.split(' ').every(function (p) { return find(dict, p) >= 0; }); };
    function ok(x) {
      var v = x.word;
      if (forms[v] || GRAMMAR_WORDS[v] || RELATED_SKIP[v] || !/^[a-z][a-z' -]*$/.test(v)) return false;
      var i = find(dict, v);
      return !(i >= 0 && !dict.real[i]);   // names, foreign words, abbreviations
    }
    function rank(list, boost) {
      list = (list || []).filter(ok);
      var picked = list.map(function (x, i) {
        var l = lyricOf(dict, x.word);   // lyric bump: words songs use move up (flame above capacitor)
        var common = l == null ? 0.25 * popularity(freqOf(x)) : 0.1 * popularity(freqOf(x)) + 0.5 * l;
        var score = (l == null ? 0.75 : 0.5) * (1 - i / list.length) + common + (boost && boost[x.word] ? 0.3 : 0)
          - rarePenalty(x) - (known(x.word) ? 0 : 10);
        return { word: x.word, score: score };
      }).sort(function (p, q) { return q.score - p.score; });
      var out = [];
      picked.forEach(function (p) {
        var v = p.word;
        if (shown[v] || shown[v.replace(/s$/, '')] || shown[v.replace(/es$/, '')]) return;   // plugs after plug
        shown[v] = true;
        out.push(v);
      });
      return out;
    }
    var words = {
      describing: !main || main === 'n' ? rank(a.jjb) : [],   // broken → "heart, sword" (as a noun) is no help
      describes: main === 'adj' ? rank(a.jja) : []   // road → "side, building" (road as a describing word) is no help
    };
    var near = (a.after || []).concat(a.before || []).filter(function (x) { return (x.tags || []).indexOf('adv') < 0 || (x.tags || []).indexOf('n') >= 0; });
    words.next = rank(near.sort(function (p, q) { return (q.score || 0) - (p.score || 0); }));
    words.world = rank(a.trg, inMl);
    words.phrases = relatedPhrases(dict, w, (a.pre || []).concat(a.post || [], a.mid || []));
    return RELATED_GROUPS.map(function (g) { return { id: g.id, label: g.label, words: words[g.id] }; })
      .filter(function (g) { return g.words.length; });
  }

  // ---------- Offline thesaurus (thesaurus.js) ----------
  /** Turns SW.THESAURUS into something fast to look up. Meanings are unpacked when first asked for. */
  function loadThesaurus(th) {
    var words = th.words.split('|'), heads = Object.create(null), forms = Object.create(null);
    var id = function (s) { return parseInt(s, 36); };
    th.heads.split('|').forEach(function (h) {
      var p = h.split(':');
      // Each meaning: "number" or "number.usage count" (base 36)
      heads[words[id(p[0])]] = p[1].split(',').map(function (m) { var x = m.split('.'); return { sense: id(x[0]), used: x[1] ? id(x[1]) : 0 }; });
    });
    th.forms.split('|').forEach(function (f) {
      var p = f.split('>');
      if (p[1]) forms[p[0]] = words[id(p[1])];
    });
    var vulgar = Object.create(null);
    (th.vulgar || '').split('|').concat(SWEARS).forEach(function (w) { if (w) vulgar[w] = true; });
    return { words: words, senses: th.senses.split('\n'), heads: heads, forms: forms, vulgar: vulgar };
  }

  // Backstop for words from outside WordNet's labels (Datamuse extras): core swear words and slurs.
  var SWEARS = ['fuck', 'fucking', 'fucked', 'fucker', 'motherfucker', 'shit', 'shitty', 'bullshit', 'cunt', 'twat',
    'bitch', 'bitches', 'asshole', 'dick', 'dickhead', 'cock', 'pussy', 'whore', 'slut', 'bastard', 'piss',
    'pissed', 'damn', 'goddamn', 'nigger', 'nigga', 'fag', 'faggot', 'dyke', 'retard', 'skank', 'wanker', 'bollocks'];

  /** True if a word is vulgar wherever it shows up (it's then hidden unless the search itself is vulgar). */
  function isVulgar(th, w) { return !!th.vulgar[w]; }

  /** The plain form of what was typed, if the thesaurus has it: "stopped" → stop, "running" → run,
      "went" → go. Returns the word itself if it's already plain, null if unknown. */
  function baseWord(th, word, has) {
    has = has || function (x) { return !!th.heads[x]; };
    var w = clean(word);
    if (th.forms[w]) return th.forms[w];
    var rules = [['ies', 'y'], ['ied', 'y'], ['ier', 'y'], ['iest', 'y'], ['es', ''], ['s', ''], ['ed', ''], ['ed', 'e'],
      ['ing', ''], ['ing', 'e'], ['er', ''], ['er', 'e'], ['est', ''], ['est', 'e'], ["in'", ''], ["in'", 'e']];
    for (var i = 0; i < rules.length; i++) {
      var end = rules[i][0];
      if (w.length <= end.length + 1 || w.slice(-end.length) !== end) continue;
      var stem = w.slice(0, -end.length);
      if (has(stem + rules[i][1])) return stem + rules[i][1];
      // stopped → stop, running → run
      if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2] && has(stem.slice(0, -1))) return stem.slice(0, -1);
    }
    return has(w) ? w : null;
  }

  // ---------- Definitions (definitions.js) ----------
  function loadDefinitions(d) {
    var words = Object.create(null);
    d.words.split('|').forEach(function (e) {
      var p = e.split(':');
      words[p[0]] = p[1].split(',').map(function (x) { return parseInt(x, 36); });
    });
    return { texts: d.texts.split('\n'), words: words };
  }

  /** A word's definitions, most used meaning first: [{ word, pos, def, example }].
      "running" gives its own and then run's (word forms come from the thesaurus). null if unknown. */
  function definitions(defs, th, word) {
    var typed = clean(word), has = function (x) { return !!defs.words[x]; };
    var base = baseWord(th, word, has), owners = [];
    if (has(typed)) owners.push(typed);
    if (base && base !== typed) owners.push(base);
    if (!owners.length) return null;
    var name = { n: 'noun', v: 'verb', a: 'adjective', r: 'adverb' }, out = [];
    owners.forEach(function (o) {
      defs.words[o].forEach(function (i) {
        var parts = defs.texts[i].split('\t');
        out.push({ word: o, pos: name[parts[0][0]], def: parts[0].slice(1), example: parts[1] || '' });
      });
    });
    return out;
  }

  /** How common a word is, for sorting: its place in the word list (0 = most common).
      A phrase counts as its rarest word, a bit lower; words not in the list (rare) come last. */
  function commonRank(dict, w) {
    if (w in dict.index) return dict.index[w];
    var parts = w.split(' ');
    if (parts.length > 1 && parts.every(function (p) { return p in dict.index; })) {
      return 1.5 * Math.max.apply(null, parts.map(function (p) { return dict.index[p]; }));
    }
    return Infinity;
  }
  function byCommon(dict, list) {
    return list.map(function (w, i) { return { w: w, r: commonRank(dict, w), i: i }; })
      .sort(function (a, b) { return a.r - b.r || a.i - b.i; })
      .map(function (o) { return o.w; });
  }

  /** How everyday a word is, 0 (rare) … 1 (most common). A phrase counts as its rarest word, a bit less. */
  function commonness(dict, w) {
    var n = dict.words.length;
    if (w in dict.index) return 1 - dict.index[w] / n;
    var parts = w.split(' ');
    if (parts.length > 1 && parts.every(function (p) { return p in dict.index; })) {
      return 0.7 * (1 - Math.max.apply(null, parts.map(function (p) { return dict.index[p]; })) / n);
    }
    return 0;
  }

  /** Which of four bands a word sorts into: 0 everyday single word, 1 everyday phrase, 2 rare single, 3 rare phrase. */
  function band(dict, w) { return (commonness(dict, w) > 0 ? 0 : 2) + (w.indexOf(' ') >= 0 ? 1 : 0); }

  /** Every word from every meaning in one list, best first, each word once: single words before
      phrases, everyday words before rare ones; inside each band, words from often-used meanings that
      are most common come first ("stop": halt, block, break, quit, cease…).
      Words that are vulgar in every meaning they came from go to hidden (unless showVulgar).
      Returns { words: [{ word, band }], hidden: [word] }. */
  function bestOf(th, dict, groups, key, showVulgar) {
    var score = {}, order = [], vulgarOnly = {};
    groups.forEach(function (g) {
      g[key].forEach(function (w) {
        var vul = th.vulgar[w] || (key === 'synonyms' && (g.vulgarAll || g.vulgarWords[w]));
        if (vul && !showVulgar) { if (!(w in score)) vulgarOnly[w] = true; return; }
        if (!(w in score)) { score[w] = 0; order.push(w); delete vulgarOnly[w]; }
        var c = commonness(dict, w), l = lyricOf(dict, w);
        score[w] += Math.log2(g.used + 2) * c * c * (l == null ? 1 : 0.5 + l);   // lyric bump
      });
    });
    var words = order.map(function (w, i) { return { word: w, band: band(dict, w), s: score[w], i: i }; })
      .sort(function (a, b) { return a.band - b.band || b.s - a.s || a.i - b.i; })
      .map(function (o) { return { word: o.word, band: o.band }; });
    return { words: words, hidden: Object.keys(vulgarOnly) };
  }

  /** A word's meanings, most useful first:
      { base, vulgarSearch, best: { synonyms, antonyms }, groups: [{ word, pos, gloss, used, synonyms, antonyms }] }.
      best = all of them in one list, best first (see bestOf). vulgarSearch = the word itself is
      vulgar in all its meanings ("fuck"), so nothing is hidden; "love" or "screw" aren't.
      "running" gives its own meanings ("running water") and then run's. Inside each group, common
      words come first, then phrases, then rare words. null if the thesaurus doesn't know it. */
  function meanings(th, dict, word) {
    var typed = clean(word), base = baseWord(th, word);
    var owners = [];
    if (th.heads[typed]) owners.push(typed);
    if (base && base !== typed) owners.push(base);
    if (!owners.length) return null;
    var name = { n: 'noun', v: 'verb', a: 'adjective', r: 'adverb' };
    var list = function (s) { return s ? s.split(',').map(function (x) { return th.words[parseInt(x, 36)]; }) : []; };
    var groups = [];
    owners.forEach(function (owner) {
      th.heads[owner].forEach(function (m) {
        var parts = th.senses[m.sense].split('\t'), vulgarWords = {};
        list(parts[3] === '*' ? '' : parts[3]).forEach(function (w) { vulgarWords[w] = true; });
        groups.push({
          word: owner, pos: name[parts[0][0]], gloss: parts[0].slice(1), used: m.used,
          vulgarAll: parts[3] === '*', vulgarWords: vulgarWords,
          selfVulgar: parts[3] === '*' || !!vulgarWords[owner] || !!th.vulgar[owner],
          synonyms: byCommon(dict, list(parts[1]).filter(function (w) { return w !== owner && w !== typed; })),
          antonyms: byCommon(dict, list(parts[2]))
        });
      });
    });
    var vulgarSearch = !!th.vulgar[typed] || groups.every(function (g) { return g.selfVulgar; });
    return {
      base: base || typed, vulgarSearch: vulgarSearch, groups: groups,
      best: { synonyms: bestOf(th, dict, groups, 'synonyms', vulgarSearch), antonyms: bestOf(th, dict, groups, 'antonyms', vulgarSearch) }
    };
  }

  SW.rhymes = {
    CODE: CODE, SYMBOLS: SYMBOLS, TYPES: TYPES, STRICTNESS: STRICTNESS, FAMILY: FAMILY,
    encode: encode, decode: decode, tail: tail, compareTails: compareTails, tailScore: tailScore,
    load: load, clean: clean, find: find, syllables: syllables, rhymeType: rhymeType, rhymes: rhymes,
    respell: respell, pronunciations: pronunciations, tailsOf: tailsOf,
    rankSynonyms: rankSynonyms, rankAntonyms: rankAntonyms, addLyrics: addLyrics, lyricOf: lyricOf, rankRelated: rankRelated, RELATED_GROUPS: RELATED_GROUPS,
    lineWords: lineWords, wordSpans: wordSpans, lineSyllables: lineSyllables, rhymeScheme: rhymeScheme, lineRhyme: lineRhyme,
    loadThesaurus: loadThesaurus, baseWord: baseWord, loadDefinitions: loadDefinitions, definitions: definitions, meanings: meanings, isVulgar: isVulgar, band: band
  };
})(typeof window !== 'undefined' ? window : globalThis);
