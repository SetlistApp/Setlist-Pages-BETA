/* Songwriter: music theory.
   Pure functions only (no screen code), so they can be tested, reused by the
   Setlist app later, and fed to a sound engine.

   Words used below:
   - pc ("pitch class"): a note's position in the octave, 0-11 (C=0, C♯/D♭=1 … B=11).
   - letter: 0-6 for C D E F G A B.  acc: accidentals (+1 = ♯, -1 = ♭, ±2 = double).
   - A chord "spec" is stored relative to the key, not by name:
       { deg: letter steps above the key (0-6), semi: half-steps above the key (0-11), quality }
     e.g. vi in any major key is { deg: 5, semi: 9, quality: 'min' }. That's what makes
     a progression change key automatically.
*/
(function (root) {
  var SW = root.SW = root.SW || {};

  var LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  var LETTER_PC = [0, 2, 4, 5, 7, 9, 11];   // also the major scale, in half-steps
  var ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  // Letter step to use for a chromatic note that isn't in the scale: ♭2 2 ♭3 3 4 ♭5 5 ♭6 6 ♭7 7
  var CHROMATIC_DEG = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6];

  function mod(n, m) { return ((n % m) + m) % m; }

  function accText(acc) {
    if (acc === 0) return '';
    if (acc === 2) return '𝄪';
    if (acc === -2) return '𝄫';
    return new Array(Math.abs(acc) + 1).join(acc > 0 ? '♯' : '♭');
  }

  function note(letter, acc) {
    return { letter: letter, acc: acc, pc: mod(LETTER_PC[letter] + acc, 12), name: LETTERS[letter] + accText(acc) };
  }

  /** "F#", "Bb", "F♯", "B♭" → note object. */
  function parseNote(text) {
    var letter = LETTERS.indexOf(text.charAt(0).toUpperCase());
    if (letter < 0) throw new Error('Not a note: ' + text);
    var acc = 0;
    for (var i = 1; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch === '#' || ch === '♯') acc++;
      else if (ch === 'b' || ch === '♭') acc--;
    }
    return note(letter, acc);
  }

  /** The note `letterSteps` letters and `semi` half-steps above `tonic`, spelled correctly. */
  function spellFrom(tonic, letterSteps, semi) {
    var letter = mod(tonic.letter + letterSteps, 7);
    var pc = mod(tonic.pc + semi, 12);
    return note(letter, mod(pc - LETTER_PC[letter] + 6, 12) - 6);
  }

  /** Degree label compared with the major scale: (2, 3) → "♭3". */
  function degreeText(deg, semi) {
    return accText(mod(semi - LETTER_PC[deg] + 6, 12) - 6) + (deg + 1);
  }

  // ---------- Scales ----------

  var SCALES = [
    { id: 'major', name: 'Major', group: 'Major & minor', steps: [0, 2, 4, 5, 7, 9, 11], flavor: 'major' },
    { id: 'minor', name: 'Natural minor', group: 'Major & minor', steps: [0, 2, 3, 5, 7, 8, 10], flavor: 'minor' },
    // Spelled with the natural-minor key signature, so G♯ harmonic minor gets F𝄪 like in real charts.
    { id: 'harmonicMinor', name: 'Harmonic minor', group: 'Major & minor', steps: [0, 2, 3, 5, 7, 8, 11], flavor: 'minor', signature: 'minor' },
    { id: 'dorian', name: 'Dorian', group: 'Modes', steps: [0, 2, 3, 5, 7, 9, 10], flavor: 'minor' },
    { id: 'phrygian', name: 'Phrygian', group: 'Modes', steps: [0, 1, 3, 5, 7, 8, 10], flavor: 'minor' },
    { id: 'lydian', name: 'Lydian', group: 'Modes', steps: [0, 2, 4, 6, 7, 9, 11], flavor: 'major' },
    { id: 'mixolydian', name: 'Mixolydian', group: 'Modes', steps: [0, 2, 4, 5, 7, 9, 10], flavor: 'major' },
    { id: 'locrian', name: 'Locrian', group: 'Modes', steps: [0, 1, 3, 5, 6, 8, 10], flavor: 'minor' },
    // 5- and 6-note scales borrow their chords (and spelling) from a full "parent" scale.
    { id: 'majorPentatonic', name: 'Major pentatonic', group: 'Pentatonic & blues', steps: [0, 2, 4, 7, 9], letters: [0, 1, 2, 4, 5], flavor: 'major', parent: 'major' },
    { id: 'minorPentatonic', name: 'Minor pentatonic', group: 'Pentatonic & blues', steps: [0, 3, 5, 7, 10], letters: [0, 2, 3, 4, 6], flavor: 'minor', parent: 'minor' },
    { id: 'blues', name: 'Blues', group: 'Pentatonic & blues', steps: [0, 3, 5, 6, 7, 10], letters: [0, 2, 3, 4, 4, 6], flavor: 'minor', parent: 'minor',
      // The "blue note" is ♭5, but written ♯4 when ♭5 would need a double flat (E♭ blues: A, not B𝄫).
      fallbackLetters: { 3: 3 } }
  ];
  var SCALE_GROUPS = ['Major & minor', 'Modes', 'Pentatonic & blues'];

  function getScale(id) {
    for (var i = 0; i < SCALES.length; i++) if (SCALES[i].id === id) return SCALES[i];
    throw new Error('Unknown scale: ' + id);
  }
  function letterSteps(scale) { return scale.letters || [0, 1, 2, 3, 4, 5, 6]; }
  /** The 7-note scale the chords come from. */
  function chordScale(scale) { return scale.parent ? getScale(scale.parent) : scale; }
  /** The 7-note scale whose key signature decides sharps vs flats. */
  function signatureScale(scale) { return scale.signature ? getScale(scale.signature) : chordScale(scale); }

  /** Notes of a scale: [{ name, pc, letter, acc, deg, semi, degree: "♭3" }]. */
  function scaleNotes(tonic, scaleId) {
    var scale = getScale(scaleId), lets = letterSteps(scale);
    return scale.steps.map(function (semi, i) {
      var deg = lets[i];
      var n = spellFrom(tonic, deg, semi);
      if (Math.abs(n.acc) > 1 && scale.fallbackLetters && i in scale.fallbackLetters) {
        deg = scale.fallbackLetters[i];
        n = spellFrom(tonic, deg, semi);
      }
      n.deg = deg;
      n.semi = semi;
      n.degree = degreeText(deg, semi);
      return n;
    });
  }

  var ODD_ROOTS = { 'C♭': 1, 'F♭': 1, 'E♯': 1, 'B♯': 1 };

  /** The 12 key buttons for a scale: [{ pc, note, alt }] where alt is the other usable spelling (or null). */
  function keyChoices(scaleId) {
    var sig = signatureScale(getScale(scaleId));
    var out = [];
    for (var pc = 0; pc < 12; pc++) {
      var options = [];
      for (var letter = 0; letter < 7; letter++) {
        for (var acc = -1; acc <= 1; acc++) {
          var n = note(letter, acc);
          if (n.pc !== pc) continue;
          var count = 0, doubles = false;
          scaleNotes(n, sig.id).forEach(function (s) {
            count += Math.abs(s.acc);
            if (Math.abs(s.acc) > 1) doubles = true;
          });
          if (!doubles) options.push({ note: n, count: count });
        }
      }
      options.sort(function (a, b) {
        if (a.count !== b.count) return a.count - b.count;
        var oa = ODD_ROOTS[a.note.name] ? 1 : 0, ob = ODD_ROOTS[b.note.name] ? 1 : 0;
        if (oa !== ob) return oa - ob;
        if (a.note.name === 'F♯') return -1;    // F♯ is more common than G♭
        if (b.note.name === 'F♯') return 1;
        return a.note.acc - b.note.acc;         // otherwise prefer flats
      });
      // Offer the other spelling only if it's a real-world key (no C♭/F♭/E♯/B♯ roots, ≤ 7 accidentals).
      var alt = options[1] && options[1].count <= 7 && !ODD_ROOTS[options[1].note.name] ? options[1].note : null;
      out.push({ pc: pc, note: options[0].note, alt: alt });
    }
    return out;
  }

  /** Keep the user's spelling of the tonic if the new scale allows it, else use the usual one. */
  function respellTonic(tonic, scaleId) {
    var choice = keyChoices(scaleId)[tonic.pc];
    if (choice.alt && choice.alt.name === tonic.name) return choice.alt;
    return choice.note;
  }

  // ---------- Chords ----------

  // tones: [letter steps, half-steps] above the chord root.
  var QUALITIES = {
    maj:    { label: 'major',  suffix: '',        num: '',      minor: false, tones: [[0, 0], [2, 4], [4, 7]] },
    min:    { label: 'minor',  suffix: 'm',       num: '',      minor: true,  tones: [[0, 0], [2, 3], [4, 7]] },
    dim:    { label: 'dim',    suffix: '°',       num: '°',     minor: true,  tones: [[0, 0], [2, 3], [4, 6]] },
    aug:    { label: 'aug',    suffix: '+',       num: '+',     minor: false, tones: [[0, 0], [2, 4], [4, 8]] },
    sus2:   { label: 'sus2',   suffix: 'sus2',    num: 'sus2',  minor: false, tones: [[0, 0], [1, 2], [4, 7]] },
    sus4:   { label: 'sus4',   suffix: 'sus4',    num: 'sus4',  minor: false, tones: [[0, 0], [3, 5], [4, 7]] },
    dom7:   { label: '7',      suffix: '7',       num: '7',     minor: false, tones: [[0, 0], [2, 4], [4, 7], [6, 10]] },
    maj7:   { label: 'maj7',   suffix: 'maj7',    num: 'maj7',  minor: false, tones: [[0, 0], [2, 4], [4, 7], [6, 11]] },
    min7:   { label: 'm7',     suffix: 'm7',      num: '7',     minor: true,  tones: [[0, 0], [2, 3], [4, 7], [6, 10]] },
    m7b5:   { label: 'm7♭5',   suffix: 'm7♭5',    num: 'ø7',    minor: true,  tones: [[0, 0], [2, 3], [4, 6], [6, 10]] },
    dim7:   { label: 'dim7',   suffix: '°7',      num: '°7',    minor: true,  tones: [[0, 0], [2, 3], [4, 6], [6, 9]] },
    mMaj7:  { label: 'm(maj7)', suffix: 'm(maj7)', num: '(maj7)', minor: true, tones: [[0, 0], [2, 3], [4, 7], [6, 11]] },
    maj7s5: { label: 'maj7♯5', suffix: 'maj7♯5',  num: '+maj7', minor: false, tones: [[0, 0], [2, 4], [4, 8], [6, 11]] }
  };
  /** Chord types offered in the "Any chord" tab, in order. */
  var ANY_TYPES = ['maj', 'min', 'dim', 'aug', 'sus2', 'sus4', 'dom7', 'maj7', 'min7', 'm7b5', 'dim7'];

  var TRIAD_BY_SHAPE = { '4,7': 'maj', '3,7': 'min', '3,6': 'dim', '4,8': 'aug' };
  var SEVENTH_BY_SHAPE = { 'maj,11': 'maj7', 'maj,10': 'dom7', 'min,10': 'min7', 'min,11': 'mMaj7', 'dim,10': 'm7b5', 'dim,9': 'dim7', 'aug,11': 'maj7s5' };

  /** Full chord from a spec, in a key: { deg, semi, quality, root, notes, symbol, numeral }. */
  function buildChord(tonic, spec) {
    var q = QUALITIES[spec.quality];
    var root = spellFrom(tonic, spec.deg, spec.semi);
    var roman = ROMAN[spec.deg];
    var prefix = degreeText(spec.deg, spec.semi).replace(/\d+$/, '');
    // Secondary dominants are named after the chord they lead to: V/ii, V7/vi.
    var numeral = spec.of
      ? 'V' + q.num + '/' + spec.of
      : prefix + (q.minor ? roman.toLowerCase() : roman) + q.num;
    return {
      deg: spec.deg, semi: spec.semi, quality: spec.quality, of: spec.of,
      root: root,
      notes: q.tones.map(function (t) { return spellFrom(root, t[0], t[1]); }),
      intervals: q.tones.map(function (t) { return t[1]; }),
      // What each note is within the chord: "1", "♭3", "5", "♭7"...
      tones: q.tones.map(function (t) { return degreeText(t[0], t[1]); }),
      symbol: root.name + q.suffix,
      numeral: numeral
    };
  }

  /** The chord family of a scale. size: 3 (triads) or 4 (7th chords). */
  function diatonicChords(tonic, scaleId, size) {
    var steps = chordScale(getScale(scaleId)).steps;
    return steps.map(function (semi, i) {
      function up(k) { return mod(steps[(i + k) % 7] - semi, 12); }
      var triad = TRIAD_BY_SHAPE[up(2) + ',' + up(4)];
      var quality = size === 4 ? SEVENTH_BY_SHAPE[triad + ',' + up(6)] : triad;
      return buildChord(tonic, { deg: i, semi: semi, quality: quality });
    });
  }

  function sameChord(a, b) { return !!a && !!b && a.semi === b.semi && a.quality === b.quality; }

  // Each borrowed chord as a triad (tri) and as a 7th chord (sev).
  var BORROWED = {
    // Major-flavored keys borrow from the parallel minor.
    major: [
      { deg: 3, semi: 5, tri: 'min', sev: 'min7' },   // iv
      { deg: 2, semi: 3, tri: 'maj', sev: 'maj7' },   // ♭III
      { deg: 5, semi: 8, tri: 'maj', sev: 'maj7' },   // ♭VI
      { deg: 6, semi: 10, tri: 'maj', sev: 'dom7' },  // ♭VII
      { deg: 1, semi: 2, tri: 'dim', sev: 'm7b5' },   // ii°
      { deg: 4, semi: 7, tri: 'min', sev: 'min7' }    // v
    ],
    // Minor-flavored keys borrow from Dorian, harmonic minor and the parallel major.
    minor: [
      { deg: 3, semi: 5, tri: 'maj', sev: 'dom7' },   // IV (Dorian)
      { deg: 4, semi: 7, tri: 'maj', sev: 'dom7' },   // V (harmonic minor)
      { deg: 0, semi: 0, tri: 'maj', sev: 'maj7' }    // I (Picardy third)
    ]
  };

  /** "The V of" each major or minor chord in the key (not the I, which already has its V). */
  function secondaryDominants(tonic, scaleId, size) {
    return diatonicChords(tonic, scaleId, 3).filter(function (c, i) {
      return i > 0 && (c.quality === 'maj' || c.quality === 'min');
    }).map(function (target) {
      return { deg: (target.deg + 4) % 7, semi: (target.semi + 7) % 12, quality: size === 4 ? 'dom7' : 'maj', of: target.numeral };
    });
  }

  /** Borrowed chords plus secondary dominants, leaving out any already in the key and any repeats
      (e.g. Lydian's II is the same chord as V/V, so it shows once, as V/V). size: 3 or 4. */
  function borrowedChords(tonic, scaleId, size) {
    size = size || 3;
    var inKey = diatonicChords(tonic, scaleId, 3).concat(diatonicChords(tonic, scaleId, 4));
    var specs = BORROWED[getScale(scaleId).flavor].map(function (b) {
      return { deg: b.deg, semi: b.semi, quality: size === 4 ? b.sev : b.tri };
    }).concat(secondaryDominants(tonic, scaleId, size));
    var out = [];
    specs.forEach(function (spec) {
      var same = function (c) { return sameChord(c, spec); };
      if (!inKey.some(same) && !out.some(same)) out.push(buildChord(tonic, spec));
    });
    return out;
  }

  /** The 12 roots for "Any chord", spelled for this key: [{ deg, semi, pc, name }], ordered from C. */
  function anyRoots(tonic, scaleId) {
    var steps = chordScale(getScale(scaleId)).steps;
    var out = [];
    for (var semi = 0; semi < 12; semi++) {
      var i = steps.indexOf(semi);
      var deg = i >= 0 ? i : CHROMATIC_DEG[semi];
      var n = spellFrom(tonic, deg, semi);
      out.push({ deg: deg, semi: semi, pc: n.pc, name: n.name });
    }
    return out.sort(function (a, b) { return a.pc - b.pc; });
  }

  /** Which Chords tab a chord lives in: { tab: 'key' | 'borrowed', size } or { tab: 'any' }. */
  function findChord(tonic, scaleId, spec) {
    var match = function (c) { return sameChord(c, spec); };
    if (diatonicChords(tonic, scaleId, 3).some(match)) return { tab: 'key', size: 3 };
    if (diatonicChords(tonic, scaleId, 4).some(match)) return { tab: 'key', size: 4 };
    if (borrowedChords(tonic, scaleId, 3).some(match)) return { tab: 'borrowed', size: 3 };
    if (borrowedChords(tonic, scaleId, 4).some(match)) return { tab: 'borrowed', size: 4 };
    return { tab: 'any' };
  }

  /** Degree label ("5", "♭3", "♭6") for any pitch class in a key. */
  function degreeLabel(tonic, scaleId, pc) {
    var semi = mod(pc - tonic.pc, 12);
    var lists = [scaleNotes(tonic, scaleId), scaleNotes(tonic, chordScale(getScale(scaleId)).id)];
    for (var k = 0; k < lists.length; k++) {
      for (var i = 0; i < lists[k].length; i++) if (lists[k][i].semi === semi) return lists[k][i].degree;
    }
    return degreeText(CHROMATIC_DEG[semi], semi);
  }

  /** MIDI note numbers for a chord in root position (for sound later). Middle C = 60 = octave 4. */
  function chordMidi(chord, octave) {
    var base = 12 * ((octave === undefined ? 4 : octave) + 1) + chord.root.pc;
    return chord.intervals.map(function (semi) { return base + semi; });
  }

  // ---------- Voice leading ----------
  // A "voicing" is the exact notes of a chord as MIDI numbers, low to high (60 = middle C).
  // These are the right-hand / guitar notes; the bass (the root, left hand or bass player) is implied.

  var VOICE_LO = 53, VOICE_HI = 76;   // F3 to E5
  var VOICE_CENTER = 64;              // E4: ties go to the voicing nearest the middle
  var MAX_SPAN = 16;                  // lowest to highest note: up to a 10th (open voicings allowed)
  var KEEP_PER_STEP = 80;             // partial paths kept per voicing when listing many options

  /** Every voicing of a chord. opts: { notes: 3|4, inversions: true|false }.
      3 notes: a triad (7th chords leave out the 5th). 4 notes: a 7th chord, or a triad with
      any one note doubled. Close or open: the notes span at most a 10th (one hand / guitar).
      inversions false: the chord's root is always the lowest note. */
  function chordVoicings(chord, opts) {
    var count = (opts && opts.notes) || 3, inv = !opts || opts.inversions !== false;
    var pcs = chord.notes.map(function (n) { return n.pc; });
    var sets;
    if (pcs.length >= 4 && count === 3) sets = [[pcs[0], pcs[1], pcs[3]]];
    else if (pcs.length === 3 && count === 4) sets = pcs.map(function (d) { return pcs.concat([d]); });
    else sets = [pcs.slice(0, count)];
    var seen = {}, out = [];
    sets.forEach(function (set) {
      (function pick(k, chosen) {
        if (k === set.length) {
          var v = chosen.slice().sort(function (a, b) { return a - b; });
          for (var i = 1; i < v.length; i++) if (v[i] === v[i - 1]) return;
          if (v[v.length - 1] - v[0] > MAX_SPAN) return;
          if (!inv && mod(v[0], 12) !== chord.root.pc) return;
          var key = v.join();
          if (!seen[key]) { seen[key] = true; out.push(v); }
          return;
        }
        for (var m = VOICE_LO; m <= VOICE_HI; m++) if (mod(m, 12) === set[k]) pick(k + 1, chosen.concat([m]));
      })(0, []);
    });
    return out.sort(function (a, b) { return a[0] - b[0] || a.join().localeCompare(b.join()); });
  }

  /** Half-steps the notes move from one voicing to the next (lowest to lowest, next to next...). */
  function voiceMove(a, b) {
    var t = 0;
    for (var i = 0; i < a.length; i++) t += Math.abs(a[i] - b[i]);
    return t;
  }

  /** Tie-breaker between voicings that move the same amount: prefer compact (close) voicings,
      then ones near the middle of the keyboard. */
  function centerPenalty(v) {
    var sum = 0;
    v.forEach(function (m) { sum += m; });
    return (v[v.length - 1] - v[0]) * 2 + Math.abs(sum / v.length - VOICE_CENTER);
  }

  /** Voicings for each chord of a progression, keeping only those with every locked note.
      locks: { chipIndex: [midi, ...] }. A lock that no voicing can satisfy is ignored. */
  function progressionVoicings(tonic, specs, opts, locks) {
    return specs.map(function (spec, i) {
      var all = chordVoicings(buildChord(tonic, spec), opts);
      var lock = locks && locks[i];
      if (!lock || !lock.length) return all;
      var kept = all.filter(function (v) { return lock.every(function (m) { return v.indexOf(m) >= 0; }); });
      return kept.length ? kept : all;
    });
  }

  function pathTotal(path) {
    var t = 0;
    for (var i = 1; i < path.length; i++) t += voiceMove(path[i - 1], path[i]);
    return t;
  }

  /** Complete voicings of the progression with the least total movement, grouped by total.
      Returns [{ total, paths: [[voicing, ...], ...] }], smoothest group first, at most `groups`. */
  function voicingGroups(tonic, specs, opts, locks, groups) {
    if (!specs.length) return [];
    var lists = progressionVoicings(tonic, specs, opts, locks);
    var rank = function (a, b) { return a.total - b.total || a.center - b.center; };
    // Each step keeps the best few partial paths ending in each voicing.
    var layer = lists[0].map(function (v) { return [{ path: [v], total: 0, center: centerPenalty(v) }]; });
    for (var k = 1; k < lists.length; k++) {
      var prev = [].concat.apply([], layer);
      layer = lists[k].map(function (v) {
        return prev.map(function (p) {
          return { path: p.path.concat([v]), total: p.total + voiceMove(p.path[p.path.length - 1], v), center: p.center + centerPenalty(v) };
        }).sort(rank).slice(0, KEEP_PER_STEP);
      });
    }
    var done = [].concat.apply([], layer).sort(rank), out = [];
    done.forEach(function (p) {
      var g = out[out.length - 1];
      if (g && g.total === p.total) g.paths.push(p.path);
      else if (out.length < (groups || 3)) out.push({ total: p.total, paths: [p.path] });
    });
    return out;
  }

  /** The smoothest complete voicing (respecting locks). */
  function smoothestVoicing(tonic, specs, opts, locks) {
    var g = voicingGroups(tonic, specs, opts, locks, 1);
    return g.length ? g[0].paths[0] : [];
  }

  /** Ways to play one chord of a chosen path, the others left as they are, sorted by how far
      this chord's notes move: [{ voicing, moveIn, moveOut, total }]. */
  function chordVoicingOptions(tonic, specs, path, index, opts, locks) {
    var prev = path[index - 1], next = path[index + 1];
    return progressionVoicings(tonic, specs, opts, locks)[index].map(function (v) {
      var a = prev ? voiceMove(prev, v) : 0, b = next ? voiceMove(v, next) : 0;
      return { voicing: v, moveIn: a, moveOut: b, total: a + b, center: centerPenalty(v) };
    }).sort(function (x, y) { return x.total - y.total || x.center - y.center; });
  }

  SW.theory = {
    LETTERS: LETTERS, SCALES: SCALES, SCALE_GROUPS: SCALE_GROUPS, QUALITIES: QUALITIES, ANY_TYPES: ANY_TYPES,
    note: note, parseNote: parseNote, getScale: getScale, chordScale: chordScale,
    scaleNotes: scaleNotes, keyChoices: keyChoices, respellTonic: respellTonic,
    buildChord: buildChord, diatonicChords: diatonicChords, borrowedChords: borrowedChords,
    anyRoots: anyRoots, findChord: findChord, sameChord: sameChord,
    degreeLabel: degreeLabel, chordMidi: chordMidi,
    chordVoicings: chordVoicings, voiceMove: voiceMove, pathTotal: pathTotal,
    voicingGroups: voicingGroups, smoothestVoicing: smoothestVoicing, chordVoicingOptions: chordVoicingOptions
  };
})(typeof window !== 'undefined' ? window : globalThis);
