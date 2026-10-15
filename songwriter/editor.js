/* Songwriter: the Lyrics songs list and song editor (screen code).
   Saving goes through SW.songs; rhyme letters and syllables come from SW.rhymes.

   app.js creates it with SW.editor.create(ctx) and calls:
     page()        the Lyrics page (songs list or one song)
     sheet()       its pop-ups (section menu, add section, song menu), when state.sheet starts with "ed-"
     act(name, d)  taps on data-act="ed-…" buttons; returns true if handled
     isBusy()      true while typing or saving (the page shouldn't refresh itself then)
   ctx = { el, state, render, esc, dict() (word list or null), findBox() (Find rhymes HTML), openWord(word, tab) }

   While a section is being typed in, the page is never redrawn (that would close the keyboard):
   the line counts, rhyme letters and word bar are updated in place instead. */
(function (root) {
  var SW = root.SW = root.SW || {};
  var R = SW.rhymes;

  var TAGS = ['Verse', 'Pre-chorus', 'Chorus', 'Bridge', 'Intro', 'Outro'];
  var SAVE_AFTER_MS = 800;      // save a section this long after you stop typing
  var RETRY_MS = 5000;          // try a failed save again after this long
  var UNDO_MS = 10000;          // how long "Undo" stays after deleting
  // Lyrics save to the Setlist app's songs (song_lyric_sections), only inside the Setlist app (it
  // passes its database client). Anywhere else (the test site) songs are practice ones kept in the
  // browser tab and never sent anywhere. #practice forces that inside Setlist too, for testing.

  function create(ctx) {
    var state = ctx.state, esc = ctx.esc;
    var store = null, storeProblem = null;      // problem: 'offline' | 'not-configured' | 'not-set-up' | 'error'
    var list = null, listLoading = false;       // songs list
    var song = null, secs = {}, stopLive = null; // the open song, its sections by id, live-updates switch
    var pending = {}, saveTimer = null, saving = false, saveError = false, titleTimer = null;
    var undo = null;                            // { text, run, timer }
    var loadingId = null;                       // song being fetched (so it's only asked for once)
    var notFound = false;                       // single-song mode (inside Setlist): that song isn't there
    // Syllable counts & rhyme letters on/off: a small per-phone convenience, so phone storage is fine.
    var COUNTS_KEY = 'songwriter_showCounts';
    var showCounts = true;
    try { showCounts = root.localStorage.getItem(COUNTS_KEY) !== 'off'; } catch (e) { /* private mode: default on */ }

    if (!state.lyView) state.lyView = 'list';   // 'list' | 'song'

    // ---------- Connecting ----------
    function connect() {
      if (store || storeProblem === 'connecting') return;
      if (!ctx.client || /practice/.test(root.location.hash)) { store = SW.songs.practiceStore(); return; }
      storeProblem = 'connecting';
      SW.songs.open(function (s) { store = s; storeProblem = null; ctx.render(); }, function (why) { storeProblem = why; ctx.render(); },
        { client: ctx.client, who: ctx.who });   // inside the Setlist app: its own database connection and member name
    }
    function problemOf(err) {
      var m = String(err && err.message || err);
      if (/schema cache|does not exist|PGRST205|42P01/.test(m)) return 'not-set-up';
      if (navigator.onLine === false || /fetch|network|Failed/i.test(m)) return 'offline';
      return 'error';
    }

    // ---------- Songs list ----------
    function loadList() {
      if (!store || listLoading) return;
      listLoading = true;
      store.list().then(function (l) { list = l; storeProblem = null; })
        .catch(function (e) { storeProblem = problemOf(e); })
        .then(function () { listLoading = false; ctx.render(); });
    }

    function ago(iso) {
      var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
      if (s < 60) return 'just now';
      if (s < 3600) return Math.floor(s / 60) + ' min ago';
      if (s < 86400) return Math.floor(s / 3600) + ' h ago';
      if (s < 86400 * 7) return Math.floor(s / 86400) + ' d ago';
      return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    /** "Verse 1", "Verse 2" … for plain Verse tags, in order; other tags as they are. */
    function labels(order, byId) {
      var n = 0, out = {};
      order.forEach(function (id) {
        var x = byId[id];
        if (!x || x.repeat_of) return;
        out[id] = x.tag === 'Verse' ? 'Verse ' + (++n) : x.tag;
      });
      return out;
    }

    function problemBox() {
      var text = {
        connecting: 'Connecting…',
        offline: '<b>You’re offline.</b> For now, songs are saved online, so you need internet to open or edit them. Find rhymes still works.',
        'not-configured': '<b>Saving isn’t set up</b> (no database settings in config.js).',
        'not-set-up': '<b>The lyrics table isn’t set up yet.</b> Run supabase-lyrics.sql in the Supabase dashboard.',
        library: '<b>Couldn’t start the database connection.</b> Try reloading.',
        error: '<b>Couldn’t reach the database.</b> <button class="sw-link" data-act="ed-retry">Try again</button>'
      }[storeProblem];
      return text ? `<div class="sw-offline">${text}</div>` : '';
    }

    function listPage() {
      connect();
      if (store && !list && !listLoading && !storeProblem) loadList();
      var body;
      if (storeProblem) body = problemBox();
      else if (!list) body = '<div class="sw-wempty">Loading songs…</div>';
      else if (!list.length) body = '<div class="sw-empty">No songs yet.<br>Tap <b>+ New song</b> to start one.</div>';
      else {
        body = list.map(function (s) {
          var byId = {}; s.sections.forEach(function (x) { byId[x.id] = x; });
          var order = (s.section_order || []).filter(function (id) { return byId[id]; });
          var lab = labels(order, byId);
          var first = '';
          order.some(function (id) { var l = (byId[id].body || '').split('\n').filter(function (t) { return t.trim(); })[0]; if (l) first = l; return !!l; });
          var tags = order.map(function (id) { return byId[id].repeat_of ? null : lab[id]; }).filter(Boolean);
          return `<button class="sw-song" data-act="ed-open" data-id="${esc(s.id)}">
            <b class="sw-keepcase">${esc(s.title || 'Untitled')}</b>
            <span class="sw-songline">${first ? esc(first) : '<i>No lyrics yet</i>'}</span>
            ${s.updated_at ? `<span class="sw-songmeta">${esc(ago(s.updated_at))}${tags.length ? ' · ' + esc(tags.join(', ')) : ''}</span>` : ''}
          </button>`;
        }).join('');
      }
      var practice = store && store.kind === 'practice'
        ? '<div class="sw-notsaved"><b>Not saved yet.</b> Songs stay while this tab is open (even through updates), but close the tab and they’re gone. Use ⋯ → <b>Copy lyrics</b> in a song to keep a copy. This test site never saves or sends your songs anywhere.</div>' : '';
      return `${ctx.findBox()}
        <div class="sw-label">Songs ${store && !storeProblem && store.canCreate !== false ? '<button data-act="ed-new">+ New song</button>' : ''}</div>
        ${store && store.canCreate === false ? '<div class="sw-footnote" style="margin:-4px 0 10px">Your Setlist songs. New songs are added in the Setlist app.</div>' : ''}
        ${practice}${body}${undoBar()}`;
    }

    // ---------- Opening a song ----------
    function openSong(id) {
      state.lyView = 'song'; state.lySong = id; state.lyEditing = null;
      song = null; secs = {};
      if (stopLive) { stopLive(); stopLive = null; }
      if (!store) return;
      loadingId = id;
      store.load(id).then(function (r) {
        if (!r.song || r.song.deleted_at) { if (ctx.singleSong) notFound = true; else state.lyView = 'list'; return; }
        song = r.song; secs = {};
        r.sections.forEach(function (x) { secs[x.id] = x; });
        stopLive = store.subscribe(id, onLive);
      }).catch(function (e) { storeProblem = problemOf(e); if (!ctx.singleSong) state.lyView = 'list'; })
        .then(function () { loadingId = null; ctx.render(); });
    }

    function closeSong() {
      flush();
      if (stopLive) { stopLive(); stopLive = null; }
      state.lyView = 'list'; state.lyEditing = null; song = null; secs = {};
      list = null;   // reload so the list shows the changes
    }

    /** Someone else saved: update that part (never the section being typed in). */
    function onLive(ev) {
      if (!song) return;
      var r = ev.row;
      if (ev.table === 'songs' && r && r.id === song.id) {
        var titleBox = ctx.el.querySelector('[data-title]');
        var typingTitle = titleBox && document.activeElement === titleBox;
        song = Object.assign({}, song, r, typingTitle ? { title: song.title } : {});
        if (r.deleted_at) { closeSong(); ctx.render(); return; }
      } else if (ev.table === 'sections' && r && r.id) {
        if (r.id === state.lyEditing || pending[r.id]) return;   // ours wins while we're typing it
        if (r.deleted_at) delete secs[r.id]; else secs[r.id] = r;
        delete typingHist[r.id];   // someone else changed it: our undo steps would undo their change
      }
      redrawQuietly();
    }

    // ---------- Song page ----------
    /** Section ids top to bottom: by position for Setlist songs, else the song's own list. */
    function order() {
      if (store && store.positional) return Object.keys(secs).sort(function (a, b) { return (secs[a].position || 0) - (secs[b].position || 0); });
      return (song.section_order || []).filter(function (id) { return secs[id]; });
    }
    /** Use a new top-to-bottom order (keeps positions in step for Setlist songs). */
    function applyOrder(o) {
      song.section_order = o;
      o.forEach(function (id, i) { if (secs[id]) secs[id].position = i; });
    }

    function status() {
      if (saveError) return '<span class="sw-saved sw-bad">Not saved · retrying</span>';
      if (saving || Object.keys(pending).length) return '<span class="sw-saved sw-dimtext">Saving…</span>';
      return '<span class="sw-saved">✓ Saved</span>';
    }

    function linesHtml(x) {
      var lines = (x.body || '').split('\n');
      if (!x.body.trim()) return '<div class="sw-ph">Tap to write…</div>';
      var dict = ctx.dict();
      var sch = dict ? R.rhymeScheme(dict, lines, x.rhyme_letters) : null;
      return lines.map(function (line, i) {
        if (!line.trim()) return '<div class="sw-ln sw-blank"></div>';
        var info = sch ? sch.lines[i] : { letter: '', syllables: '' };
        var text = underlined(line, info);
        // The counts and letter are a button: tap to pick this line's rhyme letter.
        return `<div class="sw-ln"><span class="sw-lt">${text}</span><button class="sw-lg" data-act="ed-link" data-id="${x.id}" data-line="${i}" aria-label="Choose the rhyme letter for this line"><span class="sw-ls">${info.syllables}</span>${letterChip(info)}</button></div>`;
      }).join('');
    }
    /** A line as HTML with its rhyme underlines: the rhyming ending (one or more words) and any
        word you gave a letter yourself. */
    function underlined(line, info) {
      var out = '', at = 0;
      ((info && info.underline) || []).forEach(function (u) {
        if (u.start < at) return;
        out += esc(line.slice(at, u.start)) + `<span class="sw-u ${kindClass(u)}">${esc(line.slice(u.start, u.end))}</span>`;
        at = u.end;
      });
      return out + esc(line.slice(at));
    }

    /** Color by letter; outline by how closely it rhymes: solid (perfect, or a letter you picked), dashed (family), dotted (vowel). */
    function kindClass(info) {
      return `sw-c${info.letter.charCodeAt(0) % 4}${info.kind === 'family' ? ' sw-near' : info.kind === 'vowel' ? ' sw-vowel' : ''}`;   // perfect & picked: solid
    }
    function letterChip(info) {
      return info.letter ? `<span class="sw-lr ${kindClass(info)}">${info.letter}</span>` : '<span class="sw-lr sw-none"></span>';
    }

    function schemeOf(x) {
      var dict = ctx.dict();
      return dict && x.body.trim() ? R.rhymeScheme(dict, x.body.split('\n'), x.rhyme_letters).scheme : '';
    }

    function sectionCard(id, lab) {
      var x = secs[id];
      if (x.repeat_of) {
        var target = secs[x.repeat_of];
        return `<div class="sw-sec sw-rep" data-sec="${id}"><button class="sw-tag sw-keepcase" data-act="ed-menu" data-id="${id}">↻ ${esc(target ? lab[x.repeat_of] || target.tag : 'Repeat')} <span>▾</span></button></div>`;
      }
      var editing = state.lyEditing === id;
      var head = `<div class="sw-sechd"><button class="sw-tag sw-keepcase" data-act="ed-menu" data-id="${id}">${esc(lab[id])} <span>▾</span></button>
        <span class="sw-scheme" data-scheme="${id}">${esc(schemeOf(x))}</span></div>`;
      if (editing) {
        return `<div class="sw-sec sw-editing" data-sec="${id}">${head}
          <div class="sw-tawrap"><textarea class="sw-ta" data-body="${id}" rows="1" placeholder="Tap to write…" autocapitalize="sentences" spellcheck="true">${esc(x.body)}</textarea>
          <div class="sw-gutter" data-gutter="${id}"></div><div class="sw-mirror" aria-hidden="true"></div></div></div>`;
      }
      return `<div class="sw-sec" data-sec="${id}">${head}<div class="sw-lines" data-act="ed-edit" data-id="${id}">${linesHtml(x)}</div></div>`;
    }

    /** No more repeats ("↻ Chorus") since 2.0.8.2 (Alex): a repeat becomes a normal section with the
        words written out, edited on its own. Old ones (or ones an older app version just made) are
        turned into copies the moment the song is on screen, and saved like any other edit. */
    function writeOutRepeats() {
      Object.keys(secs).forEach(function (id) {
        var x = secs[id];
        if (!x.repeat_of) return;
        var from = secs[x.repeat_of];
        while (from && from.repeat_of) from = secs[from.repeat_of];   // a repeat of a repeat
        var patch = { repeat_of: null, tag: from ? from.tag : x.tag, body: from ? from.body || '' : x.body || '' };
        if (from && from.rhyme_letters && Object.keys(from.rhyme_letters).length) patch.rhyme_letters = from.rhyme_letters;
        Object.assign(x, patch);
        queue(id, patch);
      });
    }

    function songPage() {
      connect();
      if (notFound) return '<div class="sw-wempty">Couldn’t find this song’s lyrics.</div>';
      if (store && !song && state.lySong && loadingId !== state.lySong) openSong(state.lySong);
      if (!song) return `${storeProblem ? problemBox() : '<div class="sw-wempty">Opening…</div>'}`;
      writeOutRepeats();
      var o = order(), lab = labels(o, secs);
      return `<div class="sw-wordslot"><div class="sw-wordbar" data-wordbar hidden></div></div>
        <div class="sw-songbar">${ctx.singleSong ? '' : '<button class="sw-back" data-act="ed-back" aria-label="Back to songs">‹</button>'}
          ${ctx.singleSong ? '<span class="sw-grow"></span>'   /* inside a Setlist song page, which already shows the title */
            : store.canRename === false ? `<div class="sw-title sw-keepcase">${esc(song.title || 'Untitled')}</div>`
            : `<input class="sw-title sw-keepcase" data-title value="${esc(song.title || '')}" placeholder="Song title" autocomplete="off">`}
          ${status()}<button class="sw-dots" data-act="ed-songmenu" aria-label="Song menu">⋯</button></div>
        <div class="sw-countbar"><button class="sw-switch ${showCounts ? 'sw-on' : ''}" data-act="ed-counts"><span></span>Syllables &amp; rhymes</button></div>
        <div class="sw-secs ${showCounts ? '' : 'sw-nocounts'}">${o.map(function (id) { return sectionCard(id, lab); }).join('')}</div>
        <button class="sw-addsec" data-act="ed-add">+ Add section</button>
        ${showCounts ? '<div class="sw-legend"><span>8 = syllables</span><span><b>A</b> = rhymes</span><span>dashed = near · dotted = vowel</span><span>tap a letter to change</span></div>' : '<div class="sw-legend"></div>'}
        ${undoBar()}`;
    }

    function undoBar() {
      return undo ? `<div class="sw-toast">${esc(undo.text)}${undo.run ? ' <button data-act="ed-undo">Undo</button>' : ''}</div>` : '';
    }

    // ---------- Pop-ups ----------
    function sheet() {
      var body = '';
      if (state.sheet === 'ed-menu') body = sectionMenu(secs[state.lyMenu]);
      else if (state.sheet === 'ed-add') body = tagPicker('ed-addtag', null, 'Add a section');
      else if (state.sheet === 'ed-link') body = letterMenu();
      else if (state.sheet === 'ed-songmenu') body = `<div class="sw-sheet-title">${esc(song ? song.title || 'Untitled' : '')}<button data-act="close-sheet">Done</button></div>
        <button class="sw-mitem" data-act="ed-copy">Copy lyrics <span>to paste anywhere</span></button>
        ${store && store.canDeleteSong === false ? '' : '<button class="sw-mitem sw-red" data-act="ed-delsong">Delete song <span>Undo for 10 s</span></button>'}`;
      if (!body) return '';
      return `<div class="sw-dimmer" data-act="close-sheet"></div>
        <div class="sw-sheet"><div class="sw-sheet-head" data-sheet-grab><div class="sw-grab"></div></div>${body}</div>`;
    }

    /** Pick a word's rhyme letter: Auto, A, B, C… or None. Same letter = they rhyme. Works for line
        endings (tap the letter) and any other word (Letter on the word bar), for inner rhymes. */
    function letterMenu() {
      var x = secs[state.lyMenu], dict = ctx.dict(), word = state.lyPickWord;
      if (!x || !dict || !word) return '';
      var picked = x.rhyme_letters || {};
      var sch = R.rhymeScheme(dict, x.body.split('\n'), picked);
      var mine = sch.lines.filter(function (l) { return l.end === word && l.letter; })[0];
      var me = { end: word, letter: mine ? mine.letter : '' };
      // Which words already use each letter, as a hint ("A · me").
      var users = {}, maxUsed = -1, lines = x.body.split('\n');
      sch.lines.forEach(function (l, i) {
        l.underline.forEach(function (u) {
          var w = R.clean(lines[i].slice(u.start, u.end).split(/\s+/).pop());
          maxUsed = Math.max(maxUsed, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(u.letter));
          if (w !== word) (users[u.letter] = users[u.letter] || []).indexOf(w) < 0 && users[u.letter].push(w);
        });
      });
      var letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, Math.min(26, Math.max(4, maxUsed + 2))).split('');
      var cur = picked[me.end] || 'auto';
      var btn = function (val, label, hint) {
        return `<button class="${cur === val ? 'sw-on' : ''}" data-act="ed-letter" data-arg="${val}">${label}${hint ? `<small class="sw-keepcase">${esc(hint)}</small>` : ''}</button>`;
      };
      return `<div class="sw-sheet-title"><span class="sw-keepcase">Rhyme letter for “${esc(me.end)}”</span><button data-act="close-sheet">Done</button></div>
        <div class="sw-whelp">Words with the same letter rhyme. ${mine ? 'Auto lets the dictionary decide' + (cur === 'auto' && me.letter ? ` (now ${me.letter})` : '') + '.' : 'Give a word in the middle of a line a letter to mark an inner rhyme.'}</div>
        <div class="sw-letters">${btn('auto', 'Auto')}${letters.map(function (L) { return btn(L, L, (users[L] || []).slice(0, 2).join(', ')); }).join('')}${btn('-', 'None')}</div>`;
    }

    /** Section type buttons plus a Custom… box (with names used before in this song). */
    function tagPicker(act, current, title) {
      var used = [];
      Object.keys(secs).forEach(function (id) { var t = secs[id].tag; if (TAGS.indexOf(t) < 0 && used.indexOf(t) < 0 && !secs[id].repeat_of) used.push(t); });
      return `<div class="sw-sheet-title">${esc(title)}<button data-act="close-sheet">Done</button></div>
        <div class="sw-sub">Section type</div>
        <div class="sw-scales">${TAGS.map(function (t) { return `<button class="${t === current ? 'sw-on' : ''}" data-act="${act}" data-arg="${t}">${t}</button>`; }).join('')}
        ${used.map(function (t) { return `<button class="sw-keepcase ${t === current ? 'sw-on' : ''}" data-act="${act}" data-arg="${esc(t)}">${esc(t)}</button>`; }).join('')}</div>
        <div class="sw-sub">Custom name</div>
        <form class="sw-find" data-custom="${act}"><input class="sw-input" name="tag" maxlength="40" placeholder="e.g. Breakdown, Chorus 2 (half time)" autocomplete="off">
          <button class="sw-findbtn" type="submit">Use</button></form>`;
    }

    function sectionMenu(x) {
      if (!x) return '';
      var o = order(), i = o.indexOf(x.id);
      var moves = `<button class="sw-mitem" data-act="ed-move" data-arg="-1" ${i <= 0 ? 'disabled' : ''}>Move up</button>
        <button class="sw-mitem" data-act="ed-move" data-arg="1" ${i >= o.length - 1 ? 'disabled' : ''}>Move down</button>`;
      if (x.repeat_of) {
        return `<div class="sw-sheet-title">Repeat<button data-act="close-sheet">Done</button></div>${moves}
          <button class="sw-mitem sw-red" data-act="ed-delete">Remove repeat <span>Undo for 10 s</span></button>`;
      }
      return tagPicker('ed-tag', x.tag, 'Section') +
        `<div class="sw-mlist">${moves}
        <button class="sw-mitem" data-act="ed-dup">Duplicate</button>
        <button class="sw-mitem sw-red" data-act="ed-delete">Delete section <span>Undo for 10 s</span></button></div>`;
    }

    // ---------- Saving ----------
    function queue(id, patch) {
      pending[id] = Object.assign(pending[id] || {}, patch);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flush, SAVE_AFTER_MS);
      showStatus();
    }
    function flush() {
      clearTimeout(saveTimer);
      if (saving || !song || !store) return;
      var ids = Object.keys(pending);
      if (!ids.length) return;
      var id = ids[0], patch = pending[id], songId = secs[id] ? secs[id].song_id : song.id;
      delete pending[id];
      saving = true; showStatus();
      store.saveSection(id, songId, patch).then(function () { saveError = false; })
        .catch(function () {
          pending[id] = Object.assign({}, patch, pending[id] || {});   // keep it, and anything typed since
          saveError = true;
          saveTimer = setTimeout(flush, RETRY_MS);
        })
        .then(function () { saving = false; showStatus(); if (!saveError && Object.keys(pending).length) flush(); });
    }
    ctx.on(root, 'online', function () { if (saveError) flush(); });

    function saveTitle(title) {
      clearTimeout(titleTimer);
      song.title = title;
      titleTimer = setTimeout(function () {
        saving = true; showStatus();
        store.saveTitle(song.id, title).then(function () { saveError = false; }).catch(function () { saveError = true; })
          .then(function () { saving = false; showStatus(); });
      }, SAVE_AFTER_MS);
    }

    function showStatus() {
      var s = ctx.el.querySelector('.sw-songbar .sw-saved');
      if (s) s.outerHTML = status();
    }

    /** Runs a change that the store saves right away (add, move, delete…), then redraws. */
    function change(promise) {
      saving = true;
      return promise.then(function (r) { saveError = false; return r; })
        .catch(function (e) { saveError = true; storeProblem = problemOf(e) === 'offline' ? null : storeProblem; })
        .then(function (r) { saving = false; ctx.render(); return r; });
    }

    function showUndo(text, run) {
      if (undo) clearTimeout(undo.timer);
      undo = { text: text, run: run, timer: setTimeout(function () {
        undo = null;
        var bar = ctx.el.querySelector('.sw-toast');   // just remove it: a redraw would close the keyboard
        if (bar) bar.remove();
      }, UNDO_MS) };
    }

    // ---------- Typing (no full redraws) ----------
    /** Redraw everything except the section being typed in, without closing the keyboard. */
    function redrawQuietly() {
      var ta = ctx.el.querySelector('[data-body]');
      if (!ta || document.activeElement !== ta) { ctx.render(); return; }
      var o = order(), lab = labels(o, secs);
      ctx.el.querySelectorAll('[data-sec]').forEach(function (card) {
        var id = card.dataset.sec;
        if (id === state.lyEditing) return;
        if (!secs[id]) card.remove();
        else card.outerHTML = sectionCard(id, lab);
      });
      var title = ctx.el.querySelector('[data-title]');
      if (title && document.activeElement !== title) title.value = song.title || '';
    }

    /** Line counts and rhyme letters next to the textarea, lined up with each line even when it wraps.
        The mirror is a copy of the text behind the textarea, laid out the same way: its letters are
        invisible, but it draws the colored rhyme underlines, which show through under what you type. */
    function updateGutter(ta) {
      var id = ta.dataset.body, wrap = ta.parentNode, mirror = wrap.querySelector('.sw-mirror'), gutter = wrap.querySelector('[data-gutter]');
      var lines = ta.value.split('\n');
      var dict = ctx.dict(), sch = dict ? R.rhymeScheme(dict, lines, secs[id] && secs[id].rhyme_letters) : null;
      mirror.innerHTML = lines.map(function (l, i) { return `<div>${underlined(l, sch && sch.lines[i]) || '&#8203;'}</div>`; }).join('');
      ta.style.height = 'auto';
      ta.style.height = Math.max(ta.scrollHeight, mirror.offsetHeight) + 'px';   // same height as the reading lines
      var wrapTop = wrap.getBoundingClientRect().top;   // exact (offsetTop rounds to whole pixels and drifts)
      var tops = [].map.call(mirror.children, function (d) { return d.getBoundingClientRect().top - wrapTop; });
      gutter.innerHTML = lines.map(function (l, i) {
        if (!l.trim() || !sch) return '';
        var info = sch.lines[i];
        // Tappable while typing too: opens the rhyme letter picker for this line.
        return `<button class="sw-gl" style="top:${tops[i]}px" data-act="ed-link" data-id="${id}" data-line="${i}" aria-label="Choose the rhyme letter for this line"><span class="sw-ls">${info.syllables}</span>${letterChip(info)}</button>`;
      }).join('');
      var sc = ctx.el.querySelector(`[data-scheme="${id}"]`);
      if (sc) sc.textContent = sch ? sch.scheme : '';
    }

    /** The word the cursor is on (or the selected word). */
    function wordAtCursor(ta) {
      var v = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
      if (b > a) return R.clean(v.slice(a, b).split(/\s+/)[0]);
      var isW = function (c) { return /[A-Za-z'’-]/.test(c || ''); };
      var s = a, e = a;
      while (s > 0 && isW(v[s - 1])) s--;
      while (e < v.length && isW(v[e])) e++;
      return R.clean(v.slice(s, e));
    }

    var barWord = '';
    function updateWordBar(ta) {
      var bar = ctx.el.querySelector('[data-wordbar]');
      if (!bar) return;
      var w = ta && document.activeElement === ta ? wordAtCursor(ta) : '';
      if (!w) { bar.hidden = true; barWord = ''; var a = scrollParent(ctx.el); if (a) a.style.scrollPaddingTop = ''; return; }
      bar.hidden = false;
      placeBar(bar);
      if (w === barWord) return;
      barWord = w;
      var dict = ctx.dict(), syl = dict ? R.syllables(dict, w) : 0;
      bar.innerHTML = `<b class="sw-keepcase">${esc(w)}</b>${syl ? `<small>${syl} syl</small>` : ''}
        <span class="sw-wbtns">${[['rhymes', 'Rhymes'], ['syn', 'Syn'], ['ant', 'Ant'], ['def', 'Meaning']].map(function (t) {
          return `<button data-act="ed-word" data-arg="${t[0]}">${t[1]}</button>`; }).join('')}<button class="sw-wletter" data-act="ed-pickword" aria-label="Give this word a rhyme letter">A·B</button></span>`;
    }
    /** The word bar is pinned to the top of the lyrics' scrolling area (in the Setlist app: right under the
        song tabs) by CSS alone: .sw-wordslot is position: sticky, first thing on the page, zero height, so
        the bar floats over the lyrics without pushing them down. Alex's call (2.0.8.1); it used to sit just
        above the keyboard. Measuring the screen instead broke on iPhone: with the keyboard up, iOS reports
        the visible area's position in a way that put the bar ~100px too low (2.0.8.1-beta1). */
    function scrollParent(el) {
      for (var s = el.parentElement; s; s = s.parentElement) {
        var oy = getComputedStyle(s).overflowY;
        if (oy === 'auto' || oy === 'scroll') return s;
      }
      return null;
    }
    /** Keep the line being typed from hiding under the bar when the browser scrolls to the cursor. */
    function placeBar(bar) {
      var area = scrollParent(ctx.el);
      if (area) area.style.scrollPaddingTop = bar.offsetHeight + 'px';
    }

    // ---------- Typing undo (⌘Z / ⌘⇧Z while typing lyrics, 2.0.8.2) ----------
    // Per section: a burst of typing (until a pause of TYPING_BURST_MS) is one step. Kept while the
    // song is open, also when you move between sections.
    var TYPING_BURST_MS = 1000;
    var typingHist = {};   // section id → { undo: [state], redo: [state], cur: state, at: time of last typing }
    var stateOf = function (ta) { return { value: ta.value, a: ta.selectionStart, b: ta.selectionEnd }; };
    function histFor(ta) {
      var id = ta.dataset.body;
      if (!typingHist[id]) typingHist[id] = { undo: [], redo: [], cur: stateOf(ta), at: 0 };
      return typingHist[id];
    }
    function noteTyping(ta) {
      var h = histFor(ta), now = Date.now();
      if (h.cur.value === ta.value) { h.cur = stateOf(ta); return; }
      if (now - h.at >= TYPING_BURST_MS) { h.undo.push(h.cur); if (h.undo.length > 200) h.undo.shift(); }
      h.redo = [];
      h.cur = stateOf(ta); h.at = now;
    }
    function bodyChanged(ta) {
      var id = ta.dataset.body;
      if (secs[id]) secs[id].body = ta.value;
      queue(id, { body: ta.value });
      updateGutter(ta);
      updateWordBar(ta);
    }
    function undoTyping(ta, redo) {
      var h = histFor(ta), from = redo ? h.redo : h.undo, to = redo ? h.undo : h.redo;
      if (!from.length) return;
      to.push(stateOf(ta));
      var s = from.pop();
      ta.value = s.value; ta.setSelectionRange(s.a, s.b);
      h.cur = s; h.at = 0;   // the next letter starts a new step
      bodyChanged(ta);
    }
    ctx.el.addEventListener('keydown', function (e) {
      var t = e.target;
      if (!(t.matches && t.matches('[data-body]')) || !(e.metaKey || e.ctrlKey) || e.altKey || (e.key || '').toLowerCase() !== 'z') return;
      e.preventDefault(); e.stopPropagation();   // not the browser's undo, not the Setlist app's
      undoTyping(t, e.shiftKey);
    });
    ctx.el.addEventListener('focusin', function (e) { if (e.target.matches && e.target.matches('[data-body]')) histFor(e.target); });

    ctx.el.addEventListener('input', function (e) {
      var t = e.target;
      if (t.matches && t.matches('[data-body]')) {
        noteTyping(t);
        var id = t.dataset.body;
        if (secs[id]) secs[id].body = t.value;
        queue(id, { body: t.value });
        updateGutter(t);
        updateWordBar(t);
      } else if (t.matches && t.matches('[data-title]') && song) {
        saveTitle(t.value);
      }
    });
    ['keyup', 'click', 'focusin'].forEach(function (type) {
      ctx.el.addEventListener(type, function (e) { if (e.target.matches && e.target.matches('[data-body]')) updateWordBar(e.target); });
    });
    ctx.on(document, 'selectionchange', function () {
      var ta = ctx.el.querySelector('[data-body]');
      if (ta && document.activeElement === ta) updateWordBar(ta);
    });
    ctx.el.addEventListener('focusout', function (e) {
      if (e.target.matches && e.target.matches('[data-body]')) setTimeout(function () { updateWordBar(null); flush(); }, 150);
    });
    // Tapping the word bar mustn't take focus from the lyrics (that would close the keyboard first).
    ['pointerdown', 'mousedown'].forEach(function (type) {
      ctx.el.addEventListener(type, function (e) { if (e.target.closest && e.target.closest('[data-wordbar]')) e.preventDefault(); });
    });
    ctx.el.addEventListener('submit', function (e) {
      var f = e.target.closest('[data-custom]');
      if (!f) return;
      e.preventDefault();
      var name = f.querySelector('input').value.trim().replace(/\s+/g, ' ');
      if (name && act(f.dataset.custom, { arg: name })) ctx.render();
    });

    /** After each redraw: size the textarea, line up its gutter, and put the cursor back. */
    function afterRender() {
      var ta = ctx.el.querySelector('[data-body]');
      if (!ta) return;
      updateGutter(ta);
      if (afterRender.focusNext) {
        afterRender.focusNext = false;
        ta.focus();
        // The cursor goes where you tapped (2.0.8.2); otherwise at the end.
        var at = afterRender.caretAt != null ? Math.min(afterRender.caretAt, ta.value.length) : ta.value.length;
        afterRender.caretAt = null;
        ta.setSelectionRange(at, at);
      }
    }

    // ---------- Taps ----------
    // Where the last tap was, so tapping a word puts the cursor on that word.
    var lastTap = null;
    ctx.el.addEventListener('pointerdown', function (e) { lastTap = { x: e.clientX, y: e.clientY }; }, true);
    /** The character in section id's text under the last tap (null if it wasn't on a line). */
    function tapOffset(id) {
      var box = lastTap && ctx.el.querySelector('.sw-lines[data-id="' + id + '"]');
      var x = box && secs[id];
      if (!box || !x || !x.body.trim()) return null;
      var rows = box.querySelectorAll('.sw-ln'), lines = x.body.split('\n');
      if (rows.length !== lines.length) return null;
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i].getBoundingClientRect();
        if (lastTap.y < r.top || lastTap.y >= r.bottom) continue;
        var before = 0;
        for (var k = 0; k < i; k++) before += lines[k].length + 1;
        var lt = rows[i].querySelector('.sw-lt'), col = lines[i].length;
        var pos = document.caretPositionFromPoint ? document.caretPositionFromPoint(lastTap.x, lastTap.y)
          : document.caretRangeFromPoint ? (function (rg) { return rg && { offsetNode: rg.startContainer, offset: rg.startOffset }; })(document.caretRangeFromPoint(lastTap.x, lastTap.y)) : null;
        if (lt && pos && lt.contains(pos.offsetNode)) {
          col = 0;
          var walk = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT), n;
          while ((n = walk.nextNode())) { if (n === pos.offsetNode) { col += pos.offset; break; } col += n.textContent.length; }
        }
        return before + Math.min(col, lines[i].length);
      }
      return null;
    }

    function act(name, d) {
      var x = state.lyMenu && secs[state.lyMenu];
      var o, i, lab;
      switch (name) {
        case 'ed-retry': storeProblem = null; store = null; list = null; connect(); break;
        case 'ed-new':
          change(store.create('Untitled').then(function (r) {
            song = r.song; secs = {}; r.sections.forEach(function (s) { secs[s.id] = s; });
            state.lyView = 'song'; state.lySong = song.id; state.lyEditing = r.sections[0].id;
            afterRender.focusNext = true;
            if (stopLive) stopLive();
            stopLive = store.subscribe(song.id, onLive);
          }));
          return true;
        case 'ed-open': openSong(d.id); break;
        case 'ed-back': closeSong(); break;
        case 'ed-edit':
          flush();
          afterRender.caretAt = tapOffset(d.id);   // read before the reading view is replaced
          state.lyEditing = d.id; afterRender.focusNext = true;
          break;
        case 'ed-done': flush(); state.lyEditing = null; break;
        case 'ed-word': {
          var ta = ctx.el.querySelector('[data-body]');
          var w = ta ? wordAtCursor(ta) : barWord;
          if (w) ctx.openWord(w, d.arg);
          break;
        }
        case 'ed-menu': flush(); state.lyMenu = d.id; state.sheet = 'ed-menu'; break;
        case 'ed-songmenu': state.sheet = 'ed-songmenu'; break;
        case 'ed-counts':
          showCounts = !showCounts;
          try { root.localStorage.setItem(COUNTS_KEY, showCounts ? 'on' : 'off'); } catch (e) { /* fine */ }
          break;
        case 'ed-link': {   // tapped a line's letter: pick the letter for that line's last word
          flush();
          var dk = ctx.dict(), sx = secs[d.id];
          if (!dk || !sx) break;
          state.lyMenu = d.id;
          state.lyPickWord = R.rhymeScheme(dk, sx.body.split('\n'), sx.rhyme_letters).lines[+d.line].end;
          state.sheet = 'ed-link';
          break;
        }
        case 'ed-pickword': {   // "Letter" on the word bar: pick the letter for the word at the cursor
          var tb = ctx.el.querySelector('[data-body]');
          var pw = tb ? wordAtCursor(tb) : barWord;
          if (!pw || !state.lyEditing) break;
          flush();
          state.lyMenu = state.lyEditing; state.lyPickWord = pw; state.sheet = 'ed-link';
          break;
        }
        case 'ed-letter': {
          var end = state.lyPickWord;
          if (!x || !end) break;
          var letters = Object.assign({}, x.rhyme_letters || {});
          if (d.arg === 'auto') delete letters[end]; else letters[end] = d.arg;
          x.rhyme_letters = letters;
          queue(x.id, { rhyme_letters: letters }); flush();
          break;
        }
        case 'ed-add': state.sheet = 'ed-add'; break;
        case 'ed-addtag':
          o = order().concat(['NEW']);
          state.sheet = null;
          change(store.addSection(song.id, { tag: d.arg }, o).then(function (r) {
            secs[r.section.id] = r.section; applyOrder(r.order);
            state.lyEditing = r.section.id; afterRender.focusNext = true;
          }));
          return true;
        case 'ed-tag':
          if (!x) break;
          x.tag = d.arg; queue(x.id, { tag: d.arg }); flush();
          state.sheet = null;
          break;
        case 'ed-dup':
          if (!x) break;
          o = order(); i = o.indexOf(x.id);
          o.splice(i + 1, 0, 'NEW');
          state.sheet = null;
          change(store.addSection(song.id, { tag: x.tag, body: x.body }, o).then(function (r) { secs[r.section.id] = r.section; applyOrder(r.order); }));
          return true;
        case 'ed-move': {
          if (!x) break;
          o = order(); i = o.indexOf(x.id);
          var j = i + (+d.arg);
          if (j < 0 || j >= o.length) break;
          o.splice(i, 1); o.splice(j, 0, x.id);
          applyOrder(o);
          change(store.setOrder(song.id, o));
          return true;
        }
        case 'ed-delete': {
          if (!x) break;
          o = order(); i = o.indexOf(x.id);
          lab = labels(o, secs);
          var gone = x, before = o.slice();
          o.splice(i, 1);
          // Repeats of this section go too (they'd point at nothing).
          var reps = Object.keys(secs).filter(function (id) { return secs[id].repeat_of === gone.id; });
          o = o.filter(function (id) { return reps.indexOf(id) < 0; });
          applyOrder(o);
          delete secs[gone.id]; reps.forEach(function (id) { delete secs[id]; });
          state.sheet = null; if (state.lyEditing === gone.id) state.lyEditing = null;
          var all = [gone.id].concat(reps);
          change(Promise.all(all.map(function (id) { return store.setSectionDeleted(id, song.id, true, o); })));
          showUndo(`${gone.repeat_of ? 'Repeat' : lab[gone.id] || 'Section'} deleted`, function () {
            secs[gone.id] = gone;
            applyOrder(before);
            change(Promise.all(all.map(function (id) { return store.setSectionDeleted(id, song.id, false, before); })).then(function () { return store.load(song.id); })
              .then(function (r) { secs = {}; r.sections.forEach(function (s) { secs[s.id] = s; }); song.section_order = r.song.section_order; }));
          });
          return true;
        }
        case 'ed-delsong': {
          var s = song;
          state.sheet = null;
          closeSong();
          change(store.setSongDeleted(s.id, true).then(function () { list = null; }));
          showUndo(`“${s.title || 'Untitled'}” deleted`, function () { change(store.setSongDeleted(s.id, false).then(function () { list = null; })); });
          return true;
        }
        case 'ed-copy': {
          // The whole song as plain text: title, then each section's name and words.
          var o2 = order(), lab2 = labels(o2, secs);
          var text = [song.title || 'Untitled'].concat(o2.map(function (id) {
            var s = secs[id];
            return s.repeat_of ? '[' + (lab2[s.repeat_of] || 'Repeat') + ']' : '[' + lab2[id] + ']\n' + (s.body || '').trim();
          })).join('\n\n');
          state.sheet = null;
          var done = function (ok) { showUndo(ok ? 'Lyrics copied' : 'Couldn’t copy on this device', null); ctx.render(); };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
          else done(false);
          break;
        }
        case 'ed-undo':
          if (undo) { clearTimeout(undo.timer); var run = undo.run; undo = null; run(); }
          break;
        default: return false;
      }
      return true;   // app.js redraws after a handled tap
    }

    return {
      page: function () { return state.lyView === 'song' ? songPage() : listPage(); },
      sheet: sheet,
      act: act,
      afterRender: afterRender,
      /** Before the Songwriter is taken off the page: save what's pending, stop live updates. */
      destroy: function () {
        flush();
        if (stopLive) { stopLive(); stopLive = null; }
        if (undo) clearTimeout(undo.timer);
      },
      isBusy: function () {
        var ta = ctx.el.querySelector('[data-body]');
        return !!((ta && document.activeElement === ta) || saving || Object.keys(pending).length);
      }
    };
  }

  SW.editor = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
