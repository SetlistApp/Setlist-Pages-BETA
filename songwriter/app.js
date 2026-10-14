/* Songwriter: the screen. Holds the state (what's picked), draws the page from it, and
   handles taps and drag-and-drop. Music rules come from SW.theory, rhymes from SW.rhymes,
   drawings from SW.instruments.

   Use: const sw = SW.app.mount(someElement, options). Everything is drawn inside that element.
   sw.destroy() removes it again (and every page-wide listener it added).
   Options (all optional), for use inside the Setlist app:
     embedded: true      no Songwriter title bar / version, no reload snapshot
     area: 'chords' | 'lyrics'          which big tab to start on
     songId: 'id…'       open straight to that Setlist song's lyrics (no songs list, no back button)
     client              the Setlist app's Supabase client (instead of loading our own)
     who: () => 'Dan'    the member name saved as "updated by"
     assetBase: '/Songwriter/'   where the word-list files are (they load when first needed) */
(function (root) {
  const SW = root.SW = root.SW || {};
  const T = SW.theory;
  const INST = SW.instruments;
  const R = SW.rhymes;

  const LAND_QUERY = '(orientation: landscape) and (max-height: 520px)';   // phone turned sideways
  const DESK_QUERY = '(min-width: 900px)';
  const APP_VERSION = '1.0-beta35';   // shown next to the title, like the Setlist app; keep in step with CHANGELOG.md
  const SNAPSHOT_KEY = 'songwriter_reloadSnapshot';   // keeps your work through an automatic update
  const DRAG_START_PX = 6;   // a finger has to move this far before a tap becomes a drag
  const WORDS_URL = 'words.js';   // the rhyme word list (~0.5 MB), loaded the first time Lyrics opens
  const DEFINITIONS_URL = 'definitions.js';   // meanings with examples (~2.7 MB), loaded the first time Meaning opens
  const THESAURUS_URL = 'thesaurus.js';   // synonyms & antonyms by meaning (~1.8 MB), loaded the first time they're asked for
  const DATAMUSE = 'https://api.datamuse.com/words';   // extra related words (needs internet)
  const STRICT_HELP = [
    'Same vowel and same ending sound.',
    'Same or close vowel (thing / mean), and the ending sounds are cousins: p t k, b d g, m n ng, f s sh th ch, v z j; more loosely, any buzzy sounds (liv / did) or any airy ones (lot / loss). Open endings can add a soft sound (day / rain, go / home).',
    'Just the vowel sounds match.'
  ];
  // First batch shown in each word-sheet tab; the rest is one tap away ("Show N more").
  // Rhymes count per kind (perfect, family, vowel), so lots of perfect rhymes can't hide the family ones.
  const FIRST = { rhymes: 30, phrases: 12, syn: 40, ant: 40, def: 4 };

  function mount(el, options) {
    const opts = options || {};
    const BASE = opts.assetBase || '';   // where words.js etc. live ("/Songwriter/" inside the Setlist app)
    // Page-wide listeners go through on(), so destroy() can take them all off again.
    const offs = [];
    const on = (target, type, fn, o) => { target.addEventListener(type, fn, o); offs.push(() => target.removeEventListener(type, fn, o)); };
    const state = {
      tonic: T.parseNote('C'),
      scaleId: 'major',
      size: 3,               // 3 = triads, 4 = 7th chords
      tab: 'key',            // 'key' | 'borrowed' | 'any'
      anySemi: 0,            // "Any chord" root, in half-steps above the key
      anyType: 'maj',
      instrument: 'guitar',  // 'guitar' | 'piano'
      labels: 'notes',       // 'notes' | 'degrees'
      shown: null,           // chord spec shown on the instrument (null = show the scale)
      selChip: -1,           // selected progression chip (tap a chord card to swap it)
      progression: [],       // chord specs, stored relative to the key
      sheet: null,           // 'pick' (key & scale) | 'word' | null
      area: 'chords',        // big top tabs: 'chords' | 'lyrics'
      page: 'progression',   // Chords switch: 'progression' | 'voicing'
      // Lyrics
      lyQuery: '',           // what's typed in the Find rhymes box
      lyRecent: [],          // words looked up this visit, newest first
      word: null,            // word shown in the word sheet
      wordTrail: [],         // words looked up before it from inside the sheet (for ‹ Back)
      wordTab: 'rhymes',     // 'rhymes' | 'syn' | 'ant' | 'def'
      strict: 1,             // rhyme strictness: 0 Perfect, 1 Family, 2 Vowel
      showHidden: false,     // Synonyms/Antonyms: vulgar words shown at the bottom
      showAll: {},           // word-sheet tabs showing everything, not just the first batch: { rhymes: true }
      wordPron: -1,          // Rhymes for one way of saying the word ("liv" / "lyve"); -1 = all
      // Voice leading
      vlNotes: 3,            // 3 or 4 notes per chord
      vlInv: true,           // allow inversions
      vlPath: null,          // chosen voicing for every chord (MIDI arrays); null = pick the smoothest
      vlLocks: {},           // { chipIndex: [locked MIDI notes] }
      vlSel: -1,             // chord picked on the roll (its options show below); -1 = "All chords"
      vlGroups: 3,           // how many half-step groups to list ("Show more" adds 3)
      vlOpen: [],            // totals of the groups opened up to show every voicing
      vlLabels: 'notes',     // roll labels: 'notes' (C, E, G) or 'tones' (1, 3, 5, 7)
      vlSig: ''              // what the voicings were worked out for (key, chords, settings)
    };
    if (!opts.embedded) restoreSnapshot(state);
    if (opts.area) state.area = opts.area;
    if (opts.songId) Object.assign(state, { area: 'lyrics', lyView: 'song', lySong: opts.songId, lyEditing: null });
    const landMq = root.matchMedia(LAND_QUERY);
    const deskMq = root.matchMedia(DESK_QUERY);
    let drag = null;
    let suppressClick = false;
    let lastInstrument = null;
    let dict = null;          // the searchable word list, once words.js has loaded
    let dictState = 'idle';   // 'idle' | 'loading' | 'ready'
    let th = null;            // the offline thesaurus, once thesaurus.js has loaded
    let thState = 'idle';
    let defs = null;          // definitions, once definitions.js has loaded
    let defState = 'idle';
    const dmCache = {};       // Datamuse answers: { 'syn:stop': { status, words } }

    // ---------- Small helpers ----------
    const layout = () => (landMq.matches ? 'land' : deskMq.matches ? 'desk' : 'phone');
    const scale = () => T.getScale(state.scaleId);
    const chord = (spec) => T.buildChord(state.tonic, spec);
    const specAttr = (s) => `${s.deg},${s.semi},${s.quality},${s.of || ''}`;
    const parseSpec = (text) => {
      const [deg, semi, quality, of] = text.split(',');
      const spec = { deg: +deg, semi: +semi, quality };
      if (of) spec.of = of;   // secondary dominant: "V/ii" leads to ii
      return spec;
    };
    const anySpec = () => {
      const r = T.anyRoots(state.tonic, state.scaleId).find((x) => x.semi === state.anySemi);
      return { deg: r.deg, semi: r.semi, quality: state.anyType };
    };
    const seg = (act, options, current, cls = '') =>
      `<div class="sw-seg ${cls}">${options.map(([v, label]) =>
        `<button class="${String(v) === String(current) ? 'sw-on' : ''}" data-act="${act}" data-arg="${v}">${label}</button>`).join('')}</div>`;

    // ---------- Drawing ----------
    function picker() {
      return `<button class="sw-pick" data-act="open-sheet">${state.tonic.name} ${scale().name} <span>▾</span></button>`;
    }

    function notesStrip() {
      return `<div class="sw-notes">${T.scaleNotes(state.tonic, state.scaleId).map((n) =>
        `<div class="sw-note"><b>${n.name}</b><i>${n.degree}</i></div>`).join('')}</div>`;
    }

    function card(c, extraClass = '') {
      const sel = T.sameChord(c, state.shown) ? 'sw-sel' : '';
      return `<button class="sw-card ${sel} ${extraClass}" data-act="card" data-drag="card" data-spec="${specAttr(c)}"><b>${c.symbol}</b><i>${c.numeral}</i></button>`;
    }

    function chordsSection() {
      const tabs = [['key', 'In key'], ['borrowed', 'Borrowed'], ['any', 'Any chord']];
      const swapping = state.selChip >= 0;
      const hint = swapping
        ? `<span class="sw-hint sw-gold">Tap a chord to swap it in for ${chord(state.progression[state.selChip]).symbol}</span>`
        : '<span class="sw-hint">Tap to see · drag to add</span>';
      let body;

      if (state.tab === 'key') {
        const list = T.diatonicChords(state.tonic, state.scaleId, state.size);
        const parent = scale().parent && T.getScale(scale().parent);
        body = `<div class="sw-row sw-chords-head">${hint}${seg('size', [[3, 'Triads'], [4, '7ths']], state.size, 'sw-sm')}</div>
          <div class="sw-grid ${state.size === 4 ? 'sw-3col' : ''}">${list.map((c) => card(c)).join('')}</div>
          ${parent ? `<div class="sw-footnote">Chords come from ${state.tonic.name} ${parent.name.toLowerCase()}, the full scale this one is part of.</div>` : ''}`;
      } else if (state.tab === 'borrowed') {
        const list = T.borrowedChords(state.tonic, state.scaleId, state.size);
        const from = scale().flavor === 'major' ? 'minor' : 'major';
        body = `<div class="sw-row sw-chords-head">${hint}${seg('size', [[3, 'Triads'], [4, '7ths']], state.size, 'sw-sm')}</div>
          <div class="sw-grid ${state.size === 4 ? 'sw-3col' : ''}">${list.map((c) => card(c)).join('')}</div>
          <div class="sw-footnote">From ${state.tonic.name} ${from}, plus secondary dominants (V/ii = the V of ii).</div>`;
      } else {
        const roots = T.anyRoots(state.tonic, state.scaleId);
        const result = chord(anySpec());
        body = `<div class="sw-row sw-chords-head">${hint}</div>
          <div class="sw-sub">Root</div>
          <div class="sw-roots">${roots.map((r) =>
            `<button class="${r.semi === state.anySemi ? 'sw-on' : ''}" data-act="any-root" data-arg="${r.semi}">${r.name}</button>`).join('')}</div>
          <div class="sw-sub">Type</div>
          <div class="sw-types">${T.ANY_TYPES.map((q) =>
            `<button class="${q === state.anyType ? 'sw-on' : ''}" data-act="any-type" data-arg="${q}">${T.QUALITIES[q].label}</button>`).join('')}</div>
          <button class="sw-card sw-result ${T.sameChord(result, state.shown) ? 'sw-sel' : ''}" data-act="card" data-drag="card" data-spec="${specAttr(result)}">
            <b>${result.symbol}</b><i>${result.numeral}</i><span>drag to add</span></button>`;
      }

      return `<div class="sw-label">Chords</div>
        <section class="sw-chords" data-chords>
          <div class="sw-tabs">${tabs.map(([v, label]) =>
            `<button class="sw-tab ${state.tab === v ? 'sw-on' : ''}" data-act="tab" data-arg="${v}">${label}</button>`).join('')}</div>
          ${body}
          <div class="sw-remove">Drop here to remove</div>
        </section>`;
    }

    function progressionSection(withLabel, emptyText) {
      const chips = state.progression.map((spec, i) => {
        const c = chord(spec);
        return `<button class="sw-chip ${i === state.selChip ? 'sw-sel' : ''}" data-act="chip" data-drag="chip" data-idx="${i}" data-spec="${specAttr(spec)}"><b>${c.symbol}</b><i>${c.numeral}</i></button>`;
      });
      const label = withLabel
        ? `<div class="sw-label">Progression ${chips.length ? '<button data-act="clear">Clear</button>' : ''}</div>` : '';
      return `<section data-prog>${label}<div class="sw-prog">${chips.length ? chips.join('') : `<div class="sw-empty">${emptyText}</div>`}</div></section>`;
    }

    /** How to show each note on the instrument. */
    function noteMarker(shownChord) {
      const names = {}, degrees = {}, inScale = {}, inChord = {};
      T.scaleNotes(state.tonic, state.scaleId).forEach((n) => {
        names[n.pc] = n.name; degrees[n.pc] = n.degree; inScale[n.pc] = true;
      });
      if (shownChord) {
        shownChord.notes.forEach((n) => {
          inChord[n.pc] = true;
          names[n.pc] = n.name;   // chord spelling wins (B♭ in a borrowed ♭VI, not A♯)
          if (!(n.pc in degrees)) degrees[n.pc] = T.degreeLabel(state.tonic, state.scaleId, n.pc);
        });
      }
      const rootPc = shownChord ? shownChord.root.pc : state.tonic.pc;
      return (pc) => {
        const text = state.labels === 'notes' ? names[pc] : degrees[pc];
        if (shownChord) {
          if (inChord[pc]) return { type: pc === rootPc ? 'root' : 'tone', text };
          return inScale[pc] ? { type: 'plain', text } : null;   // other scale notes: letter only, no circle
        }
        return inScale[pc] ? { type: pc === rootPc ? 'root' : 'tone', text } : null;
      };
    }

    /** Returns { svg, c4 } sized for the current layout. */
    function instrumentDrawing(mode) {
      const shown = state.shown ? chord(state.shown) : null;
      const mark = noteMarker(shown);
      const w = root.innerWidth, h = root.innerHeight;
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      if (state.instrument === 'guitar') {
        let o = { frets: 22, fw: 44, sh: 28, openW: 34, mark };
        if (mode === 'land') {
          const avail = w - 32;
          o = { frets: 22, openW: 26, fw: (avail - 26 - 6) / 22, sh: clamp((h - 115) / 5, 20, 42), mark };
        } else if (mode === 'desk') {
          const avail = Math.min(w, 1400) - 32 - 470 - 28 - 26;
          o.fw = clamp((avail - 34 - 6) / 22, 26, 44);
        }
        return { svg: INST.fretboard(o), c4: 0 };
      }
      let o = { ww: 34, wh: 150, mark };
      if (mode === 'land') o = { ww: (w - 34) / 22, wh: clamp(h - 105, 90, 250), mark };
      else if (mode === 'desk') o.ww = clamp((Math.min(w, 1400) - 32 - 470 - 28 - 26 - 2) / 22, 26, 40);
      const p = INST.piano(o);
      return { svg: p.svg, c4: p.xOf(60) };
    }

    function instrumentToggles() {
      return seg('instrument', [['guitar', 'Guitar'], ['piano', 'Piano']], state.instrument) +
        seg('labels', [['notes', 'Notes'], ['degrees', 'Degrees']], state.labels, 'sw-sm');
    }

    function instrumentPanel(mode, drawing) {
      const shown = state.shown ? chord(state.shown) : null;
      const caption = shown
        ? `<span>Showing <b>${shown.symbol}</b> chord (${shown.numeral})</span><button data-act="show-scale">Show scale ×</button>`
        : `<span>Showing <b>${state.tonic.name} ${scale().name.toLowerCase()}</b> scale</span>`;
      const turn = mode === 'phone'
        ? `<div class="sw-turn">↻ Turn your phone sideways to see the whole ${state.instrument === 'guitar' ? 'neck' : 'keyboard'}</div>` : '';
      return `<div class="sw-label">Instrument</div>
        <div class="sw-panel">
          <div class="sw-row">${instrumentToggles()}</div>
          <div class="sw-caption">${caption}</div>
          <div class="sw-scroll">${drawing.svg}</div>
          ${turn}
        </div>`;
    }

    /** The Key & scale pop-up. Changes show right away behind it; Done or tapping outside closes it. */
    function sheet() {
      if (state.sheet === 'word') return wordSheet();
      if (state.sheet && state.sheet.indexOf('ed-') === 0) return editor.sheet();
      if (!state.sheet) return '';
      const choices = T.keyChoices(state.scaleId);
      const cur = choices[state.tonic.pc];
      const other = cur.alt ? (cur.alt.name === state.tonic.name ? cur.note : cur.alt) : null;
      return `<div class="sw-dimmer" data-act="close-sheet"></div>
        <div class="sw-sheet">
          <div class="sw-sheet-head" data-sheet-grab><div class="sw-grab"></div>
            <div class="sw-sheet-title">${state.tonic.name} ${scale().name}<button data-act="close-sheet">Done</button></div>
          </div>
          <div class="sw-sub">Key</div>
          <div class="sw-keys">${choices.map((k) => {
            const on = k.pc === state.tonic.pc;
            return `<button class="${on ? 'sw-on' : ''}" data-act="pick-key" data-arg="${k.pc}">${on ? state.tonic.name : k.note.name}</button>`;
          }).join('')}</div>
          ${other ? `<div class="sw-swap">${state.tonic.name} can also be spelled ${other.name} · <button data-act="swap-spelling">Swap spelling</button></div>` : ''}
          ${T.SCALE_GROUPS.map((g) => `<div class="sw-sub">${g}</div><div class="sw-scales">${T.SCALES.filter((x) => x.group === g).map((x) =>
            `<button class="${x.id === state.scaleId ? 'sw-on' : ''}" data-act="pick-scale" data-arg="${x.id}">${x.name}</button>`).join('')}</div>`).join('')}
        </div>`;
    }

    // ---------- Voice leading page ----------
    const vlOpts = () => ({ notes: state.vlNotes, inversions: state.vlInv });
    const pathKey = (path) => path.map((v) => v.join('.')).join('|');

    /** Start fresh (smoothest, nothing locked) whenever the chords, key or settings change. */
    function vlSync() {
      const sig = JSON.stringify([state.tonic.name, state.progression, state.vlNotes, state.vlInv]);
      if (sig !== state.vlSig) {
        Object.assign(state, { vlSig: sig, vlPath: null, vlLocks: {}, vlSel: -1, vlGroups: 3, vlOpen: [] });
      }
      if (!state.vlPath) state.vlPath = T.smoothestVoicing(state.tonic, state.progression, vlOpts(), state.vlLocks);
      if (state.vlSel >= state.progression.length) state.vlSel = -1;
    }

    function vlGroupsNow() {
      return T.voicingGroups(state.tonic, state.progression, vlOpts(), state.vlLocks, state.vlGroups);
    }

    function vlRows() {
      return state.progression.map((spec, i) => {
        const c = chord(spec), labels = {};
        (state.vlPath[i] || []).forEach((m) => {
          const k = c.notes.findIndex((x) => x.pc === m % 12);
          labels[m] = k < 0 ? '' : state.vlLabels === 'tones' ? c.tones[k] : c.notes[k].name;
        });
        return { name: c.symbol, rootPc: c.root.pc, labels };
      });
    }

    /** "F♯4": spelled the way the chord spells it, plus the octave. */
    const noteName = (m, i) => {
      const n = chord(state.progression[i]).notes.find((x) => x.pc === m % 12);
      return `${n ? n.name : ''}${Math.floor(m / 12) - 1}`;
    };

    function vlControls() {
      return `<div class="sw-vlbar">
        ${seg('vl-notes', [[3, '3 notes'], [4, '4 notes']], state.vlNotes, 'sw-sm')}
        ${seg('vl-labels', [['notes', 'C E G'], ['tones', '1 3 5']], state.vlLabels, 'sw-sm')}
      </div>
      <div class="sw-vlbar">
        <button class="sw-switch ${state.vlInv ? 'sw-on' : ''}" data-act="vl-inv"><span></span>Inversions</button>
        <span class="sw-total"><b>${T.pathTotal(state.vlPath)}</b> half-steps</span>
      </div>`;
    }

    function vlRoll(width) {
      return `<div class="sw-panel sw-vlpanel">${INST.voiceRoll({ path: state.vlPath, rows: vlRows(), width, sel: state.vlSel, locks: state.vlLocks })}</div>`;
    }

    /** "All chords": every complete voicing, grouped by total half-steps. */
    function vlGroupList() {
      const groups = vlGroupsNow();
      const shown = groups.flatMap((g) => (state.vlOpen.includes(g.total) ? g.paths : g.paths.slice(0, 3)));
      const range = INST.rollRange(shown);
      const roots = state.progression.map((spec) => chord(spec).root.pc);
      const cur = pathKey(state.vlPath);
      const h = Math.max(58, state.progression.length * 13);
      return `<div class="sw-optbox">
        <div class="sw-opthead"><div><b>All chords</b> · ways to voice the whole progression</div></div>
        ${groups.map((g, gi) => {
          const open = state.vlOpen.includes(g.total), shownHere = open ? g.paths : g.paths.slice(0, 3), extra = g.paths.length - 3;
          return `<div class="sw-grp">
          <div class="sw-grph">${g.total} half-steps <span>· ${g.paths.length} way${g.paths.length > 1 ? 's' : ''}</span>
            ${extra > 0 ? `<button class="sw-fewer" data-act="vl-expand" data-total="${g.total}">${open ? 'Show fewer' : `+${extra} more`}</button>` : ''}</div>
          <div class="sw-thumbs">${shownHere.map((p, pi) =>
            `<button class="sw-thumb ${pathKey(p) === cur ? 'sw-on' : ''}" data-act="vl-pick" data-g="${gi}" data-p="${pi}">${INST.voiceRollMini(p, roots, range, 96, h)}</button>`).join('')}
</div>
        </div>`;
        }).join('')}
        ${groups.length === state.vlGroups ? '<button class="sw-more" data-act="vl-more">Show more</button>' : ''}
        <div class="sw-opthint">Tap a preview to use it. Tap a chord name on the roll to swap just that chord.</div>
      </div>`;
    }

    /** One chord: its voicings, sorted by how far its notes move. */
    function vlChordList() {
      const i = state.vlSel, names = state.progression.map((spec) => chord(spec).symbol);
      const options = T.chordVoicingOptions(state.tonic, state.progression, state.vlPath, i, vlOpts(), state.vlLocks).slice(0, 6);
      const cur = state.vlPath[i].join('.');
      const lock = state.vlLocks[i] || [];
      return `<div class="sw-optbox">
        <button class="sw-back" data-act="vl-back">‹ All chords</button>
        <div class="sw-opthead">
          <div><b>${names[i]}</b> · ways to play it${lock.length ? ` with <span class="sw-gold">${lock.map((m) => noteName(m, i)).join(' ')} 🔒</span>` : ''}</div>
          <button class="sw-lockbtn ${lock.length ? 'sw-on' : ''}" data-act="vl-lock">${lock.length ? 'Unlock' : '🔒 Lock'}</button>
        </div>
        ${options.map((o, k) => `<button class="sw-opt ${o.voicing.join('.') === cur ? 'sw-on' : ''}" data-act="vl-option" data-k="${k}">
          <span class="sw-rank">${k + 1}</span>
          <span class="sw-info"><b>${o.voicing.map((m) => noteName(m, i)).join(' · ')}</b>${k === 0 ? '<span class="sw-best">smoothest</span>' : ''}
            <span class="sw-sub2">${[i > 0 ? `${o.moveIn} in from ${names[i - 1]}` : '', i < names.length - 1 ? `${o.moveOut} out to ${names[i + 1]}` : ''].filter(Boolean).join(' · ') || 'only chord'}</span></span>
          <span class="sw-hs">${o.total}<small>half-steps</small></span>
        </button>`).join('')}
        <div class="sw-opthint">${lock.length ? 'Only voicings with the locked notes are listed. The other chords re-arrange around them.' : 'Tap an option to use it. Lock keeps it, or tap a circle on the roll to lock just that note.'}</div>
      </div>`;
    }

    /** Big tabs (Chords | Lyrics); on Chords, the smaller Progression | Voice leading switch below. */
    function pageTabs() {
      if (opts.songId) return '';   // one song's lyrics inside Setlist: no big tabs
      const area = `<div class="sw-tabs sw-areatabs">${[['chords', 'Chords'], ['lyrics', 'Lyrics']].map(([v, label]) =>
        `<button class="sw-tab ${state.area === v ? 'sw-on' : ''}" data-act="area" data-arg="${v}">${label}</button>`).join('')}</div>`;
      if (state.area !== 'chords') return area;
      return area + seg('page', [['progression', 'Progression'], ['voicing', 'Voice leading']], state.page, 'sw-wide');
    }

    const header = () => {
      if (opts.embedded) return state.area === 'chords' ? `<header class="sw-hdr sw-embedded"><span></span>${picker()}</header>` : '';
      return `<header class="sw-hdr"><div class="sw-brand"><div class="sw-logo">Song<b>writer</b></div><span class="sw-ver">v${APP_VERSION}</span></div>${state.area === 'chords' ? picker() : ''}</header>`;
    };
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // ---------- Lyrics page ----------
    /** Loads the word list the first time it's needed (it's big, so Chords never waits for it). */
    /** Adds a script once; calls done() when it's there. On failure, it's tried again next time. */
    function loadScript(url, done, failed) {
      const s = document.createElement('script');
      s.src = url;
      s.onload = done;
      s.onerror = () => { s.remove(); failed(); };
      document.head.appendChild(s);
    }
    function needWords() {
      if (dictState !== 'idle') return;
      if (SW.WORDS) { dict = R.load(SW.WORDS); dictState = 'ready'; return; }
      dictState = 'loading';
      loadScript(BASE + WORDS_URL, () => { dict = R.load(SW.WORDS); dictState = 'ready'; render(); }, () => { dictState = 'idle'; render(); });
    }
    function needThesaurus() {
      if (thState !== 'idle') return;
      if (SW.THESAURUS) { th = R.loadThesaurus(SW.THESAURUS); thState = 'ready'; return; }
      thState = 'loading';
      loadScript(BASE + THESAURUS_URL, () => { th = R.loadThesaurus(SW.THESAURUS); thState = 'ready'; render(); }, () => { thState = 'idle'; render(); });
    }

    function needDefinitions() {
      if (defState !== 'idle') return;
      if (SW.DEFINITIONS) { defs = R.loadDefinitions(SW.DEFINITIONS); defState = 'ready'; return; }
      defState = 'loading';
      loadScript(BASE + DEFINITIONS_URL, () => { defs = R.loadDefinitions(SW.DEFINITIONS); defState = 'ready'; render(); }, () => { defState = 'idle'; render(); });
    }

    /** The Find rhymes box (top of the songs list). */
    function findBox() {
      needWords();
      const recent = state.lyRecent.length
        ? `<div class="sw-sub">Recent</div><div class="sw-words">${state.lyRecent.map((w) =>
          `<button class="sw-wd" data-act="lookup" data-arg="${esc(w)}">${esc(w)}</button>`).join('')}</div>` : '';
      return `<div class="sw-label">Find rhymes</div>
        <form class="sw-find" data-find>
          <input class="sw-input" name="q" type="search" value="${esc(state.lyQuery)}" placeholder="Type a word" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search">
          <button class="sw-findbtn" type="submit">Find</button>
        </form>
        <div class="sw-footnote">Rhymes, synonyms, antonyms and meanings. Works offline.</div>
        ${recent}`;
    }

    function lookup(word, fromSheet) {
      const w = R.clean(word);
      if (!w) return;
      if (fromSheet && state.word && state.word !== w) state.wordTrail.push(state.word);
      if (!fromSheet) { state.wordTrail = []; state.wordTab = 'rhymes'; state.strict = 1; }   // a new search starts on Rhymes, Family
      state.word = w;
      state.sheet = 'word';
      state.showHidden = false;
      state.showAll = {};
      state.wordPron = -1;
      state.lyRecent = [w].concat(state.lyRecent.filter((x) => x !== w)).slice(0, 10);
      needWords();
      if (state.wordTab === 'syn' || state.wordTab === 'ant') fetchWords(state.wordTab, w);
    }

    /** Extra related words or opposites from Datamuse, sorted best first (SW.rhymes ranks them).
        Shown under the offline thesaurus groups. Redraws when the answer arrives. */
    function fetchWords(kind, word) {
      const key = `${kind}:${word}`;
      if (dmCache[key] && dmCache[key].status !== 'error') return;
      dmCache[key] = { status: 'loading', words: [] };
      const ask = (query) => fetch(`${DATAMUSE}?${query}`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
      const w = encodeURIComponent(word);
      // Meaning: Datamuse's definitions, only asked for when the offline dictionary doesn't know the word.
      if (kind === 'def') {
        ask(`sp=${w}&md=d&max=1`).then((r) => r[0] && r[0].word === word ? (r[0].defs || []) : [])
          .then((list) => { dmCache[key] = { status: 'ok', words: list.map((d) => ({ pos: { n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb' }[d.split('\t')[0]] || '', def: d.split('\t')[1] || d })) }; })
          .catch(() => { dmCache[key] = { status: 'error', words: [] }; })
          .then(() => { if (state.sheet === 'word' && state.word === word && state.wordTab === kind) render(); });
        return;
      }
      const done = kind === 'syn'
        ? Promise.all([ask(`sp=${w}&md=p&max=1`), ask(`rel_syn=${w}&md=fp&max=100`), ask(`ml=${w}&md=fp&max=150`)])
          .then(([me, syns, related]) => R.rankSynonyms(word, me[0], syns, related))
        : ask(`rel_ant=${w}&md=f&max=50`).then((ants) => R.rankAntonyms(word, ants));
      done.then((words) => { dmCache[key] = { status: 'ok', words }; })
        .catch(() => { dmCache[key] = { status: 'error', words: [] }; })
        .then(() => { if (state.sheet === 'word' && state.word === word && state.wordTab === kind) render(); });
    }

    /** The first batch of a list for a tab, plus "Show N more" (or "Show fewer" once it's open).
        kindOf (optional) splits the batch by kind: the first N of each kind are shown. */
    function firstBatch(tab, list, kindOf) {
      const n = FIRST[tab], seen = {};
      const first = kindOf ? list.filter((x) => { const k = kindOf(x); seen[k] = (seen[k] || 0) + 1; return seen[k] <= n; }) : list.slice(0, n);
      const extra = list.length - first.length;
      if (!extra) return { list, more: '' };
      if (state.showAll[tab]) return { list, more: `<button class="sw-moremean" data-act="show-less" data-arg="${tab}">Show fewer</button>` };
      return { list: first, more: `<button class="sw-moremean sw-gold" data-act="show-all" data-arg="${tab}">Show ${extra} more</button>` };
    }

    const wordButtons = (list, cls = () => '') => `<div class="sw-words">${list.map((w) =>
      `<button class="sw-wd ${cls(w)}" data-act="word-pick" data-arg="${esc(w.word || w)}">${esc(w.word || w)}</button>`).join('')}</div>`;

    /** The rhyme list for the current strictness: help line, then results grouped by syllables. */
    function rhymeBody() {
      const found = R.rhymes(dict, state.word, state.strict, state.wordPron) || [];
      const all = found.filter((r) => !r.phrase), twoWord = found.filter((r) => r.phrase);
      const { list, more } = firstBatch('rhymes', all, (r) => r.type);
      // Two-word rhymes ("golden" → "told him") in their own group.
      const pb = firstBatch('phrases', twoWord);
      const phraseGroup = twoWord.length ? `<div class="sw-sub">Two-word rhymes</div>${wordButtons(pb.list, (r) => `sw-t-${r.type}`)}${pb.more}` : '';
      const help = `<div class="sw-whelp"><b>${R.STRICTNESS[state.strict]}:</b> ${STRICT_HELP[state.strict]}</div>`;
      if (!list.length && !twoWord.length) return `${help}<div class="sw-wempty">Nothing at this strictness. Try sliding right.</div>`;
      const bySyl = {};
      list.forEach((r) => { (bySyl[r.syllables] = bySyl[r.syllables] || []).push(r); });
      const groups = Object.keys(bySyl).sort((a, b) => a - b).map((n) =>
        `<div class="sw-sub">${n} syllable${n > 1 ? 's' : ''}</div>${wordButtons(bySyl[n], (r) => `sw-t-${r.type}`)}`).join('');
      const kinds = R.TYPES.slice(0, state.strict + 1);
      const key = kinds.length > 1 ? `<div class="sw-wkey">${kinds.map((k) => `<span><i class="sw-t-${k}"></i>${k}</span>`).join('')}<span>most usable first</span></div>` : '';
      return help + groups + more + phraseGroup + key;
    }

    function rhymesTab() {
      if (dictState !== 'ready') return '<div class="sw-wempty">Loading the word list…</div>';
      if (!R.tailsOf(dict, state.word)) {
        return `<div class="sw-wempty">“${esc(state.word)}” isn’t in the word list, so there are no rhymes for it. Synonyms may still work.</div>`;
      }
      const stops = R.STRICTNESS.map((s, i) => `<button class="${i === state.strict ? 'sw-on' : ''}" data-act="strict" data-arg="${i}">${s}</button>`).join('');
      // Words said more than one way ("live": liv / lyve) get a switch to rhyme one of them.
      const prons = R.pronunciations(dict, state.word);
      const sayIt = prons.length ? `<label class="sw-pron"><span class="sw-sub">Pronunciation</span>
          <select data-pron>${[[-1, 'All']].concat(prons.map((p) => [p.pron, p.label])).map(([v, label]) =>
            `<option value="${v}" ${v === state.wordPron ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label>` : '';
      return `${sayIt}<div class="sw-strict"><div class="sw-sub">Strictness</div>
          <input class="sw-range" type="range" min="0" max="2" step="1" value="${state.strict}" data-strict style="--p:${state.strict * 50}%">
          <div class="sw-stops">${stops}</div></div>
        <div data-wbody>${rhymeBody()}</div>`;
    }

    /** Synonyms or antonyms: one list, best first. Single words before phrases, everyday words before
        rare ones; Datamuse's extra words (online) join each band. Vulgar words wait behind a button
        at the bottom, unless the search itself is vulgar. */
    function wordsTab(kind) {
      needThesaurus();
      if (dictState !== 'ready' || thState !== 'ready') return '<div class="sw-wempty">Loading the thesaurus…</div>';
      const typed = R.clean(state.word), m = R.meanings(th, dict, state.word);
      const name = kind === 'syn' ? 'synonyms' : 'antonyms';
      const best = m ? (kind === 'syn' ? m.best.synonyms : m.best.antonyms) : { words: [], hidden: [] };
      const allowVulgar = m ? m.vulgarSearch : !!(th.vulgar[typed]);
      const seen = new Set([typed, m && m.base].concat(best.words.map((x) => x.word), best.hidden));
      const got = dmCache[`${kind}:${state.word}`];
      const online = got && got.status === 'ok' ? got.words.filter((w) => !seen.has(w)) : [];
      const hidden = best.hidden.concat(allowVulgar ? [] : online.filter((w) => R.isVulgar(th, w)));
      const extra = online.filter((w) => allowVulgar || !R.isVulgar(th, w)).map((w) => ({ word: w, band: R.band(dict, w) }));
      // Bands: 0 everyday single words, 1 everyday phrases, 2 rare single words, 3 rare phrases.
      const list = [0, 1, 2, 3].flatMap((b) => best.words.filter((x) => x.band === b).concat(extra.filter((x) => x.band === b))).map((x) => x.word);

      let html = m && m.base !== typed ? `<div class="sw-whelp">Including words for <b>${esc(m.base)}</b>.</div>` : '';
      const batch = firstBatch(kind, list);
      html += list.length ? wordButtons(batch.list) + batch.more : `<div class="sw-wempty">No ${name} found.</div>`;
      if (hidden.length) {
        html += state.showHidden
          ? `<div class="sw-sub">Vulgar</div>${wordButtons(hidden)}`
          : `<button class="sw-moremean" data-act="show-hidden">Show ${hidden.length} hidden word${hidden.length > 1 ? 's' : ''} (vulgar)</button>`;
      }
      let note = 'Best first: everyday single words, then phrases, then rare words. Works offline.';
      if (!got || got.status === 'loading') note += ' Looking for more online…';
      else if (got.status === 'error') note += navigator.onLine === false ? ' Connect to the internet for a few more.' : ' <button class="sw-link" data-act="word-retry">Try online again</button>';
      return `<div class="sw-wlist">${html}</div><div class="sw-wnote">${note}</div>`;
    }

    /** Meaning: the word's definitions, most used first, each with an example. Offline; words the
        dictionary doesn't know ask Datamuse when online. */
    function meaningTab() {
      needThesaurus();
      needDefinitions();
      if (thState !== 'ready' || defState !== 'ready') return '<div class="sw-wempty">Loading the dictionary…</div>';
      const typed = R.clean(state.word);
      let list = R.definitions(defs, th, state.word), from = '';
      if (!list) {
        const got = dmCache[`def:${state.word}`];
        if (!got) { fetchWords('def', state.word); return '<div class="sw-wempty">Looking it up online…</div>'; }
        if (got.status === 'loading') return '<div class="sw-wempty">Looking it up online…</div>';
        if (got.status === 'error' || !got.words.length) {
          return `<div class="sw-wempty">“${esc(state.word)}” isn’t in the offline dictionary${got.status === 'error' ? (navigator.onLine === false ? ', and you’re offline.' : '. <button class="sw-link" data-act="word-retry">Try online again</button>') : ', and none was found online.'}</div>`;
        }
        list = got.words;
        from = '<div class="sw-wnote">From Datamuse (online).</div>';
      }
      const owners = [...new Set(list.map((d) => d.word).filter(Boolean))];
      const batch = firstBatch('def', list);
      const note = owners.length > 1 || (owners[0] && owners[0] !== typed) ? `<div class="sw-whelp">Including meanings of <b>${esc(owners[owners.length - 1])}</b>.</div>` : '';
      return `<div class="sw-defs">${note}${batch.list.map((d) => `<div class="sw-def">
          <div class="sw-defh">${d.word && d.word !== typed ? `${esc(d.word)} · ` : ''}${d.pos}</div>
          <div class="sw-deft">${esc(d.def)}</div>
          ${d.example ? `<div class="sw-defx">“${esc(d.example)}”</div>` : ''}
        </div>`).join('')}</div>${batch.more}${from}`;
    }

    function wordSheet() {
      const syl = dictState === 'ready' ? R.syllables(dict, state.word) : 0;
      const back = state.wordTrail.length
        ? `<button class="sw-wback" data-act="word-back">‹ ${esc(state.wordTrail[state.wordTrail.length - 1])}</button>` : '';
      const body = state.wordTab === 'rhymes' ? rhymesTab() : state.wordTab === 'def' ? meaningTab() : wordsTab(state.wordTab);
      return `<div class="sw-dimmer" data-act="close-sheet"></div>
        <div class="sw-sheet sw-wsheet">
          <div class="sw-sheet-head" data-sheet-grab><div class="sw-grab"></div>
            ${back}
            <div class="sw-whead"><b class="sw-keepcase">${esc(state.word)}</b>${syl ? `<span>${syl} syllable${syl > 1 ? 's' : ''}</span>` : ''}<button class="sw-x" data-act="close-sheet" aria-label="Close">✕</button></div>
          </div>
          ${seg('word-tab', [['rhymes', 'Rhymes'], ['syn', 'Synonyms'], ['ant', 'Antonyms'], ['def', 'Meaning']], state.wordTab, 'sw-wide sw-4tabs')}
          ${body}
        </div>`;
    }

    function voicingPage(mode) {
      if (!state.progression.length) {
        return '<div class="sw-empty sw-vlempty">No chords yet.<br>Build a progression on the Progression tab, then come back here.</div>';
      }
      vlSync();
      const w = root.innerWidth;
      if (mode === 'desk') {
        return `<div class="sw-cols"><div class="sw-main">${vlControls()}${vlRoll(470 - 22)}</div>
          <div class="sw-side">${state.vlSel >= 0 ? vlChordList() : vlGroupList()}</div></div>`;
      }
      return vlControls() + vlRoll(w - 32 - 22) + (state.vlSel >= 0 ? vlChordList() : vlGroupList());
    }

    function vlAct(name, data) {
      const i = +data.idx;
      switch (name) {
        case 'vl-notes': state.vlNotes = +data.arg; break;
        case 'vl-inv': state.vlInv = !state.vlInv; break;
        case 'vl-chord': state.vlSel = state.vlSel === i ? -1 : i; break;
        case 'vl-back': state.vlSel = -1; break;
        case 'vl-more': state.vlGroups += 3; break;
        case 'vl-labels': state.vlLabels = data.arg; break;
        case 'vl-expand': {
          const t = +data.total;
          state.vlOpen = state.vlOpen.includes(t) ? state.vlOpen.filter((x) => x !== t) : state.vlOpen.concat([t]);
          break;
        }
        case 'vl-pick': state.vlPath = vlGroupsNow()[+data.g].paths[+data.p].map((v) => v.slice()); break;
        case 'vl-option': {
          const o = T.chordVoicingOptions(state.tonic, state.progression, state.vlPath, state.vlSel, vlOpts(), state.vlLocks)[+data.k];
          state.vlPath = state.vlPath.map((v, k) => (k === state.vlSel ? o.voicing.slice() : v));
          break;
        }
        case 'vl-lock': {
          const k = state.vlSel;
          if ((state.vlLocks[k] || []).length) delete state.vlLocks[k];
          else state.vlLocks[k] = state.vlPath[k].slice();
          state.vlPath = T.smoothestVoicing(state.tonic, state.progression, vlOpts(), state.vlLocks);
          break;
        }
        case 'vl-note': {
          // Tap a circle to lock (or unlock) just that note; everything else re-arranges around it.
          const m = +data.midi, lock = (state.vlLocks[i] || []).slice(), at = lock.indexOf(m);
          if (at >= 0) lock.splice(at, 1); else lock.push(m);
          if (lock.length) state.vlLocks[i] = lock; else delete state.vlLocks[i];
          state.vlSel = i;
          state.vlPath = T.smoothestVoicing(state.tonic, state.progression, vlOpts(), state.vlLocks);
          break;
        }
        default: return false;
      }
      return true;
    }

    function render() {
      const mode = layout();
      const oldScroll = el.querySelector('.sw-scroll');
      const scrollLeft = oldScroll ? oldScroll.scrollLeft : 0;
      const drawing = instrumentDrawing(mode);
      let page;
      if (state.area === 'lyrics') {
        page = `<div class="sw-page sw-lyrics">${header()}${pageTabs()}${editor.page()}</div>`;
      } else if (state.page === 'voicing') {
        page = mode === 'land'
          ? `<div class="sw-page">${voicingPage(mode)}</div>`
          : `<div class="sw-page">${header()}${pageTabs()}${voicingPage(mode)}</div>`;
      } else if (mode === 'land') {
        page = `<div class="sw-page">
          <div class="sw-land-top">${progressionSection(false, 'No chords yet. Turn your phone upright to build one.')}<div class="sw-picks">${instrumentToggles()}</div></div>
          <div class="sw-scroll">${drawing.svg}</div>
        </div>`;
      } else {
        page = `<div class="sw-page">
          ${header()}
          ${pageTabs()}
          <div class="sw-cols">
            <div class="sw-main">${notesStrip()}${chordsSection()}${progressionSection(true, 'No chords yet.<br>Drag a chord here from above.')}</div>
            <div class="sw-side">${instrumentPanel(mode, drawing)}</div>
          </div>
        </div>`;
      }
      el.innerHTML = `<div class="sw-app sw-${mode}">${page}${sheet()}</div>`;
      if (state.area === 'lyrics') editor.afterRender();
      lockPageScroll(!!state.sheet);

      // Keep the fretboard/keyboard scrolled where it was; start the piano at middle C.
      const sc = el.querySelector('.sw-scroll');
      if (sc) {
        if (state.instrument !== lastInstrument) sc.scrollLeft = state.instrument === 'piano' ? Math.max(0, drawing.c4 - 1) : 0;
        else sc.scrollLeft = scrollLeft;
      }
      lastInstrument = state.instrument;
    }

    // ---------- Taps ----------
    function tapChord(spec) {
      if (state.selChip >= 0) {
        state.progression[state.selChip] = spec;   // swap it into the selected spot
        state.shown = spec;
      } else {
        state.shown = T.sameChord(state.shown, spec) ? null : spec;
      }
    }

    function tapChip(i) {
      if (state.selChip === i) {
        state.selChip = -1;
        state.shown = null;
        return;
      }
      const spec = state.progression[i];
      state.selChip = i;
      state.shown = spec;
      // Select the same chord in the Chords section, on whichever tab it lives.
      const where = T.findChord(state.tonic, state.scaleId, spec);
      state.tab = where.tab;
      if (where.size) state.size = where.size;
      if (where.tab === 'any') { state.anySemi = spec.semi; state.anyType = spec.quality; }
    }

    function act(name, arg, data) {
      switch (name) {
        case 'open-sheet': state.sheet = 'pick'; break;
        case 'close-sheet': state.sheet = null; break;
        case 'pick-key': state.tonic = T.keyChoices(state.scaleId)[+arg].note; break;
        case 'swap-spelling': {
          const cur = T.keyChoices(state.scaleId)[state.tonic.pc];
          state.tonic = cur.alt.name === state.tonic.name ? cur.note : cur.alt;
          break;
        }
        case 'pick-scale':
          state.scaleId = arg;
          state.tonic = T.respellTonic(state.tonic, arg);
          break;
        case 'tab': state.tab = arg; break;
        case 'size': state.size = +arg; break;
        case 'card': tapChord(parseSpec(data.spec)); break;
        case 'any-root': state.anySemi = +arg; tapChordAny(); break;
        case 'any-type': state.anyType = arg; tapChordAny(); break;
        case 'chip': tapChip(+data.idx); break;
        case 'clear': state.progression = []; state.selChip = -1; break;
        case 'instrument': state.instrument = arg; break;
        case 'labels': state.labels = arg; break;
        case 'show-scale': state.shown = null; state.selChip = -1; break;
        case 'page': state.page = arg; break;
        case 'area': state.area = arg; break;
        case 'lookup': lookup(arg, false); break;
        case 'word-pick': lookup(arg, true); break;
        case 'show-hidden': state.showHidden = true; break;
        case 'show-all': state.showAll[arg] = true; break;
        case 'show-less': state.showAll[arg] = false; break;
        case 'word-back': state.word = state.wordTrail.pop(); state.showHidden = false; state.showAll = {}; state.wordPron = -1; if (state.wordTab === 'syn' || state.wordTab === 'ant') fetchWords(state.wordTab, state.word); break;
        case 'word-tab':
          state.wordTab = arg;
          if (arg === 'syn' || arg === 'ant') fetchWords(arg, state.word);
          break;
        case 'word-retry': fetchWords(state.wordTab, state.word); break;
        case 'strict': state.strict = +arg; break;
        default: if (!vlAct(name, data) && !editor.act(name, data)) return;
      }
      render();
    }

    // Changing the "Any chord" root or type shows it right away (and swaps it in if a chip is selected).
    function tapChordAny() {
      const spec = anySpec();
      if (state.selChip >= 0) state.progression[state.selChip] = spec;
      state.shown = spec;
    }

    el.addEventListener('click', (e) => {
      if (suppressClick) { suppressClick = false; return; }
      const target = e.target.closest('[data-act]');
      if (!target || !el.contains(target)) {
        // Tapping a blank area finishes swapping.
        if (state.selChip >= 0 && !e.target.closest('.sw-sheet')) { state.selChip = -1; render(); }
        return;
      }
      act(target.dataset.act, target.dataset.arg, target.dataset);
    });

    // Find rhymes box: Search on the keyboard (or the Find button) opens the word sheet.
    el.addEventListener('submit', (e) => {
      if (!e.target.closest('[data-find]')) return;
      e.preventDefault();
      const input = e.target.querySelector('input');
      input.blur();   // put the keyboard away
      if (!R.clean(input.value)) return;
      lookup(input.value, false);
      render();
    });
    // Pronunciation dropdown on Rhymes ("live": All / lyve / liv).
    el.addEventListener('change', (e) => {
      if (!e.target.matches('[data-pron]')) return;
      state.wordPron = +e.target.value;
      state.showAll.rhymes = false;
      render();
    });
    el.addEventListener('input', (e) => {
      if (e.target.closest('[data-find]')) { state.lyQuery = e.target.value; return; }
      // Strictness slider: update just the list (redrawing everything would drop the finger's grip).
      if (e.target.matches('[data-strict]')) {
        state.strict = +e.target.value;
        e.target.style.setProperty('--p', `${state.strict * 50}%`);
        el.querySelectorAll('.sw-stops button').forEach((b, i) => b.classList.toggle('sw-on', i === state.strict));
        el.querySelector('[data-wbody]').innerHTML = rhymeBody();
      }
    });

    // ---------- Drag and drop ----------
    // Press a chord and move your finger (or mouse) to drag it. A tap without moving is a normal tap.
    el.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || drag) return;
      const src = e.target.closest('[data-drag]');
      if (!src) return;
      drag = {
        kind: src.dataset.drag, src, spec: parseSpec(src.dataset.spec),
        idx: src.dataset.idx === undefined ? -1 : +src.dataset.idx,
        x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
        touch: e.pointerType !== 'mouse', active: false, insertAt: -1, overRemove: false
      };
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
      document.addEventListener('pointercancel', onPointerCancel);
    });

    // Stop the page from scrolling while a chord is being dragged.
    on(document, 'touchmove', (e) => {
      if ((drag && drag.active) || sheetDrag) e.preventDefault();
    }, { passive: false });
    el.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-drag]')) e.preventDefault(); });

    function onPointerMove(e) {
      if (!drag) return;
      drag.x = e.clientX; drag.y = e.clientY;
      if (!drag.active) {
        if (Math.hypot(drag.x - drag.x0, drag.y - drag.y0) > DRAG_START_PX) startDrag();
        return;
      }
      e.preventDefault();
      moveGhost();
      findDropTarget();
    }

    function onPointerUp() {
      if (!drag) return;
      // A plain tap: don't redraw here, or the tap would land on a button that no longer exists.
      if (!drag.active) { endDrag(); return; }
      drop();
      suppressClick = true;                              // the drag shouldn't also count as a tap
      setTimeout(() => { suppressClick = false; }, 400);
      endDrag();
      render();
    }

    function onPointerCancel() {
      if (!drag) return;
      const wasActive = drag.active;
      endDrag();
      if (wasActive) render();
    }

    function startDrag() {
      if (!drag) return;
      drag.active = true;
      const c = chord(drag.spec);
      const app = el.querySelector('.sw-app');
      drag.ghost = document.createElement('div');
      drag.ghost.className = 'sw-ghost';
      drag.ghost.innerHTML = `<b>${c.symbol}</b><i>${c.numeral}</i>`;
      app.appendChild(drag.ghost);
      app.classList.add('sw-dragging');
      drag.src.classList.add('sw-lift');
      const chordsEl = el.querySelector('[data-chords]');
      if (drag.kind === 'chip' && chordsEl) {
        chordsEl.classList.add('sw-removing');
        // The chord name keeps its case ("E♭m" must not turn into "E♭M").
        chordsEl.querySelector('.sw-remove').innerHTML = `Drop here to remove&nbsp;<span class="sw-keepcase">${c.symbol}</span>`;
      }
      if (navigator.vibrate) navigator.vibrate(10);
      moveGhost();
      findDropTarget();
      autoScroll();
    }

    function moveGhost() {
      const g = drag.ghost;
      const dx = drag.x - g.offsetWidth / 2;
      const dy = drag.touch ? drag.y - g.offsetHeight - 28 : drag.y - g.offsetHeight / 2 - 4;   // above the finger
      g.style.transform = `translate(${dx}px, ${dy}px)`;
    }

    function otherChips(progEl) {
      return [...progEl.querySelectorAll('.sw-chip')].filter((c) => c !== drag.src);
    }

    function findDropTarget() {
      el.querySelectorAll('.sw-ins').forEach((m) => m.remove());
      el.querySelectorAll('.sw-empty').forEach((m) => m.classList.remove('sw-over'));
      drag.insertAt = -1;
      drag.overRemove = false;
      const hit = document.elementFromPoint(drag.x, drag.y);
      const progEl = hit && hit.closest('[data-prog]');
      const chordsEl = el.querySelector('[data-chords]');
      if (progEl && el.contains(progEl)) {
        const chips = otherChips(progEl);
        let idx = chips.length;
        for (let k = 0; k < chips.length; k++) {
          const r = chips[k].getBoundingClientRect();
          if (drag.y < r.top || (drag.y <= r.bottom && drag.x < r.left + r.width / 2)) { idx = k; break; }
        }
        drag.insertAt = idx;
        const empty = progEl.querySelector('.sw-empty');
        if (empty) empty.classList.add('sw-over');
        else {
          const marker = document.createElement('div');
          marker.className = 'sw-ins';
          const box = progEl.querySelector('.sw-prog');
          if (idx < chips.length) box.insertBefore(marker, chips[idx]); else box.appendChild(marker);
        }
      } else if (drag.kind === 'chip' && chordsEl && hit && chordsEl.contains(hit)) {
        drag.overRemove = true;
      }
      if (chordsEl) chordsEl.classList.toggle('sw-over', drag.overRemove);
    }

    // Scroll the page when dragging near the top or bottom edge.
    function autoScroll() {
      if (!drag || !drag.active) return;
      const topEdge = 90, bottomEdge = root.innerHeight - 60;
      let dy = 0;
      if (drag.y < topEdge) dy = -(topEdge - drag.y) / 5;
      else if (drag.y > bottomEdge) dy = (drag.y - bottomEdge) / 5;
      if (dy) { root.scrollBy(0, dy); findDropTarget(); }
      drag.raf = requestAnimationFrame(autoScroll);
    }

    function drop() {
      const p = state.progression;
      if (drag.kind === 'card') {
        if (drag.insertAt < 0) return;
        p.splice(drag.insertAt, 0, drag.spec);
        if (state.selChip >= drag.insertAt) state.selChip++;
        return;
      }
      const i = drag.idx;
      if (drag.insertAt >= 0) {                          // reorder
        const [moved] = p.splice(i, 1);
        p.splice(drag.insertAt, 0, moved);
        state.selChip = state.selChip === i ? drag.insertAt : -1;
      } else if (drag.overRemove) {                      // dragged back to Chords: remove it
        p.splice(i, 1);
        if (state.selChip === i) { state.selChip = -1; state.shown = null; }
        else if (state.selChip > i) state.selChip--;
      }
    }

    function endDrag() {
      if (!drag) return;
      cancelAnimationFrame(drag.raf);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerCancel);
      drag = null;
    }

    // ---------- Key & scale pop-up: swipe down to close, page behind stays still ----------
    let sheetDrag = null;
    let lockedScrollY = null;

    // While the pop-up is open, pin the page so swiping on the pop-up can't scroll it.
    function lockPageScroll(lock) {
      const body = document.body;
      if (lock && lockedScrollY === null) {
        lockedScrollY = root.scrollY;
        Object.assign(body.style, { position: 'fixed', top: `-${lockedScrollY}px`, left: '0', right: '0' });
      } else if (!lock && lockedScrollY !== null) {
        Object.assign(body.style, { position: '', top: '', left: '', right: '' });
        root.scrollTo(0, lockedScrollY);
        lockedScrollY = null;
      }
    }

    el.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('[data-sheet-grab]')) return;
      const sheetEl = el.querySelector('.sw-sheet');
      sheetDrag = { y0: e.clientY, t0: Date.now(), dy: 0, sheetEl, dimEl: el.querySelector('.sw-dimmer') };
      sheetEl.style.transition = 'none';
    });
    on(document, 'pointermove', (e) => {
      if (!sheetDrag) return;
      sheetDrag.dy = Math.max(0, e.clientY - sheetDrag.y0);   // only follows the finger downward
      sheetDrag.sheetEl.style.transform = `translateY(${sheetDrag.dy}px)`;
      sheetDrag.dimEl.style.opacity = String(Math.max(0, 1 - sheetDrag.dy / 400));
    });
    function endSheetDrag() {
      if (!sheetDrag) return;
      const { dy, t0, sheetEl, dimEl } = sheetDrag;
      sheetDrag = null;
      const fast = dy > 30 && dy / Math.max(1, Date.now() - t0) > 0.5;   // a quick flick also closes it
      sheetEl.style.transition = 'transform 0.18s ease-out';
      dimEl.style.transition = 'opacity 0.18s ease-out';
      if (dy > 90 || fast) {
        sheetEl.style.transform = 'translateY(100%)';
        dimEl.style.opacity = '0';
        suppressClick = true;
        setTimeout(() => { suppressClick = false; state.sheet = null; render(); }, 180);
      } else {
        sheetEl.style.transform = '';
        dimEl.style.opacity = '';
      }
    }
    on(document, 'pointerup', endSheetDrag);
    on(document, 'pointercancel', endSheetDrag);

    // ---------- Lyrics: songs list and editor (editor.js) ----------
    const editor = SW.editor.create({
      el, state, render, esc, findBox, on,
      client: opts.client, who: opts.who, singleSong: !!opts.songId,
      dict: () => { needWords(); return dictState === 'ready' ? dict : null; },
      openWord: (word, tab) => {
        lookup(word, false);
        state.wordTab = tab;
        if (tab === 'syn' || tab === 'ant') fetchWords(tab, state.word);
      }
    });

    // ---------- Start ----------
    let resizeTimer;
    on(root, 'resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 120); });
    on(landMq, 'change', render);
    on(deskMq, 'change', render);
    render();
    return {
      state,
      render,
      /** Save what's on screen so it comes back after the page refreshes itself. */
      saveSnapshot() {
        try { root.sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(state)); } catch (e) { /* private mode: fine */ }
      },
      /** True while a chord is being dragged (don't refresh mid-drag). */
      isBusy: () => !!(drag && drag.active) || editor.isBusy(),
      /** Take the Songwriter off the page: saves anything pending, removes its listeners and drawing. */
      destroy() {
        endDrag();
        editor.destroy();
        offs.splice(0).forEach((off) => off());
        clearTimeout(resizeTimer);
        lockPageScroll(false);
        el.innerHTML = '';
      }
    };
  }

  function restoreSnapshot(state) {
    try {
      const snap = JSON.parse(root.sessionStorage.getItem(SNAPSHOT_KEY));
      root.sessionStorage.removeItem(SNAPSHOT_KEY);
      if (!snap) return;
      T.getScale(snap.scaleId);   // throws if the saved scale no longer exists
      Object.assign(state, snap, { tonic: T.note(snap.tonic.letter, snap.tonic.acc), sheet: null });
      state.strict = Math.min(state.strict, SW.rhymes.STRICTNESS.length - 1);   // Loose (3) was removed in beta5
    } catch (e) { /* nothing saved, or it's from an older version: start fresh */ }
  }

  SW.app = { mount };
})(window);
