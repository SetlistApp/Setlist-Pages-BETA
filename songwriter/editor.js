/* Songwriter: the Lyrics songs list and song editor (screen code).
   Saving goes through SW.songs; rhyme letters and syllables come from SW.rhymes.

   app.js creates it with SW.editor.create(ctx) and calls:
     page()        the Lyrics page (songs list or one song)
     sheet()       its pop-ups (rhyme letter picker, song menu), when state.sheet starts with "ed-"
     act(name, d)  taps on data-act="ed-…" buttons; returns true if handled
     isBusy()      true while typing or saving (the page shouldn't refresh itself then)
     typing()      true while the lyrics box has the keyboard (app.js then calls refresh(), not a redraw)
     refresh()     update the counts, rhyme letters and word bar in place
   ctx = { el, state, render, esc, dict() (word list or null), findBox() (Find rhymes HTML), openWord(word, tab) }

   A song is one text box (2.0.8.2, Alex): a line starting with "#" is a section title ("# Chorus") and
   the lines under it are that section's words. Each section is still saved as its own row
   (song_lyric_sections), so two people editing different sections never clash: every change in the box
   is matched back to the sections (SW.songs.matchSections) and only what changed is saved.

   The box's own letters are invisible. A copy of the text laid out exactly the same way (the mirror)
   sits behind it and draws them: titles in gold (their "#" hidden unless the cursor is on that line),
   lyrics with their rhyme underlines. That's why it never changes look when you tap in to type.
   While you type, the page is never redrawn (that would close the keyboard). */
(function (root) {
  var SW = root.SW = root.SW || {};
  var R = SW.rhymes;

  var SAVE_AFTER_MS = 800;      // save a section this long after you stop typing
  var RETRY_MS = 5000;          // try a failed save again after this long
  var UNDO_MS = 10000;          // how long "Undo" stays after deleting a song
  // Lyrics save to the Setlist app's songs (song_lyric_sections), only inside the Setlist app (it
  // passes its database client). Anywhere else (the test site) songs are practice ones kept in the
  // browser tab and never sent anywhere. #practice forces that inside Setlist too, for testing.

  function create(ctx) {
    var state = ctx.state, esc = ctx.esc;
    var store = null, storeProblem = null;      // problem: 'offline' | 'not-configured' | 'not-set-up' | 'error'
    var list = null, listLoading = false;       // songs list
    var song = null, secs = {}, stopLive = null; // the open song, its saved sections by id, live-updates switch
    // The sections as shown in the box, top to bottom: { key, id (null until saved), tag, body,
    // rhyme_letters, editedAt }. key stays the same while a new section is being saved.
    var rows = [];
    var pending = {}, saveTimer = null, saving = false, saveError = false, titleTimer = null;
    var structChain = Promise.resolve(), structBusy = 0, newKey = 0;   // adding/removing sections, one at a time
    var needsReload = false;                    // someone else added/removed a section while we were typing
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
      state.lyView = 'song'; state.lySong = id;
      song = null; secs = {}; rows = []; typingHist = null;
      if (stopLive) { stopLive(); stopLive = null; }
      if (!store) return;
      loadingId = id;
      store.load(id).then(function (r) {
        if (!r.song || r.song.deleted_at) { if (ctx.singleSong) notFound = true; else state.lyView = 'list'; return; }
        song = r.song; secs = {};
        r.sections.forEach(function (x) { secs[x.id] = x; });
        rowsFromSaved();
        stopLive = store.subscribe(id, onLive);
      }).catch(function (e) { storeProblem = problemOf(e); if (!ctx.singleSong) state.lyView = 'list'; })
        .then(function () { loadingId = null; ctx.render(); });
    }

    /** Reload the song's sections (after someone else added or removed one while we were typing). */
    function reloadSong() {
      if (!song || !store) return;
      needsReload = false;
      store.load(song.id).then(function (r) {
        if (!r.song || typing() || structBusy || Object.keys(pending).length) { needsReload = true; return; }
        secs = {}; r.sections.forEach(function (x) { secs[x.id] = x; });
        rowsFromSaved();
        ctx.render();
      }).catch(function () { needsReload = true; });
    }

    function closeSong() {
      flush();
      if (stopLive) { stopLive(); stopLive = null; }
      state.lyView = 'list'; song = null; secs = {}; rows = [];
      list = null;   // reload so the list shows the changes
    }

    // ---------- Song page ----------
    /** Section ids top to bottom: by position for Setlist songs, else the song's own list. */
    function order() {
      if (store && store.positional) return Object.keys(secs).sort(function (a, b) { return (secs[a].position || 0) - (secs[b].position || 0); });
      return (song.section_order || []).filter(function (id) { return secs[id]; });
    }

    /** rows ← the saved sections. Old-style sections are tidied on the way (and saved like any edit):
        a repeat ("↻ Chorus", gone since 2.0.8.2) becomes a written-out copy; a plain "Verse" gets the
        number it was shown with ("Verse 2"), since the title is now just what's typed. */
    function rowsFromSaved() {
      var o = order(), lab = labels(o, secs);
      o.forEach(function (id) {
        var x = secs[id];
        if (!x.repeat_of) return;
        var from = secs[x.repeat_of];
        while (from && from.repeat_of) from = secs[from.repeat_of];
        var patch = { repeat_of: null, tag: from ? lab[from.id] || from.tag : x.tag, body: from ? from.body || '' : x.body || '' };
        if (from && from.rhyme_letters && Object.keys(from.rhyme_letters).length) patch.rhyme_letters = from.rhyme_letters;
        Object.assign(x, patch);
        queue(id, patch);
      });
      o.forEach(function (id) {
        var x = secs[id];
        if (x.tag === 'Verse' && lab[id] && lab[id] !== x.tag) { x.tag = lab[id]; queue(id, { tag: x.tag }); }
      });
      rows = o.map(function (id) {
        var x = secs[id];
        return { key: id, id: id, tag: x.tag == null ? '' : x.tag, body: x.body || '', rhyme_letters: x.rhyme_letters || {}, editedAt: 0 };
      });
    }

    function status() {
      if (saveError) return '<span class="sw-saved sw-bad">Not saved · retrying</span>';
      if (saving || structBusy || Object.keys(pending).length) return '<span class="sw-saved sw-dimtext">Saving…</span>';
      return '<span class="sw-saved">✓ Saved</span>';
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
      return `sw-k${(info.letter.charCodeAt(0) - 65) % 6}${info.kind === 'family' ? ' sw-near' : info.kind === 'vowel' ? ' sw-vowel' : ''}`;   // perfect & picked: solid
    }
    function letterChip(info) {
      return info.letter ? `<span class="sw-lr ${kindClass(info)}">${info.letter}</span>` : '<span class="sw-lr sw-none"></span>';
    }

    function songPage() {
      connect();
      if (notFound) return '<div class="sw-wempty">Couldn’t find this song’s lyrics.</div>';
      if (store && !song && state.lySong && loadingId !== state.lySong) openSong(state.lySong);
      if (!song) return `${storeProblem ? problemBox() : '<div class="sw-wempty">Opening…</div>'}`;
      return `<div class="sw-wordslot"><div class="sw-wordbar" data-wordbar hidden></div></div>
        <div class="sw-songbar">${ctx.singleSong ? '' : '<button class="sw-back" data-act="ed-back" aria-label="Back to songs">‹</button>'}
          ${ctx.singleSong ? '<span class="sw-grow"></span>'   /* inside a Setlist song page, which already shows the title */
            : store.canRename === false ? `<div class="sw-title sw-keepcase">${esc(song.title || 'Untitled')}</div>`
            : `<input class="sw-title sw-keepcase" data-title value="${esc(song.title || '')}" placeholder="Song title" autocomplete="off">`}
          ${status()}<button class="sw-dots" data-act="ed-songmenu" aria-label="Song menu">⋯</button></div>
        <div class="sw-countbar"><button class="sw-switch ${showCounts ? 'sw-on' : ''}" data-act="ed-counts"><span></span>Syllables &amp; rhymes</button></div>
        <div class="sw-box ${showCounts ? '' : 'sw-nocounts'}"><div class="sw-tawrap">
          <textarea class="sw-ta sw-one" data-body="song" rows="1" placeholder="Tap to write… Start a line with # for a section title (# Chorus)." autocapitalize="sentences" spellcheck="true">${esc(SW.songs.sheetText(rows))}</textarea>
          <div class="sw-gutter" data-gutter></div><div class="sw-mirror" aria-hidden="true"></div></div></div>
        ${showCounts ? '<div class="sw-legend"><span># Chorus = section title</span><span>8 = syllables</span><span><b>A</b> = rhymes</span><span>dashed = near · dotted = vowel</span><span>tap a letter to change</span></div>' : '<div class="sw-legend"><span># Chorus = section title</span></div>'}
        ${undoBar()}`;
    }

    function undoBar() {
      return undo ? `<div class="sw-toast">${esc(undo.text)}${undo.run ? ' <button data-act="ed-undo">Undo</button>' : ''}</div>` : '';
    }

    // ---------- Pop-ups ----------
    function sheet() {
      var body = '';
      if (state.sheet === 'ed-link') body = letterMenu();
      else if (state.sheet === 'ed-songmenu') body = `<div class="sw-sheet-title">${esc(song ? song.title || 'Untitled' : '')}<button data-act="close-sheet">Done</button></div>
        <button class="sw-mitem" data-act="ed-copy">Copy lyrics <span>to paste anywhere</span></button>
        ${store && store.canDeleteSong === false ? '' : '<button class="sw-mitem sw-red" data-act="ed-delsong">Delete song <span>Undo for 10 s</span></button>'}`;
      if (!body) return '';
      return `<div class="sw-dimmer" data-act="close-sheet"></div>
        <div class="sw-sheet"><div class="sw-sheet-head" data-sheet-grab><div class="sw-grab"></div></div>${body}</div>`;
    }

    function rowOf(key) { return rows.filter(function (r) { return r.key === key; })[0]; }

    /** Pick a word's rhyme letter: Auto, A, B, C… or None. Same letter = they rhyme. Works for line
        endings (tap the letter) and any other word (A·B on the word bar), for inner rhymes. */
    function letterMenu() {
      var x = rowOf(state.lyMenu), dict = ctx.dict(), word = state.lyPickWord;
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
    ctx.on(root, 'resize', function () { refitBar(); });   // turned sideways: the word bar may fit on one row now
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { refitBar(); });   // measured before the font arrived

    /** Adding and removing sections: one at a time, in order, then everyone's positions are saved. */
    function structural(run) {
      structBusy++; showStatus();
      structChain = structChain.then(run).then(function () { saveError = false; }, function () { saveError = true; })
        .then(function () {
          structBusy--;
          if (!structBusy && song && store) {
            var ids = rows.filter(function (r) { return r.id; }).map(function (r) { return r.id; });
            if (store.positional) ids.forEach(function (id, i) { if (secs[id]) secs[id].position = i; }); else song.section_order = ids;
            return store.setOrder(song.id, ids).catch(function () { saveError = true; });
          }
        })
        .then(function () { showStatus(); if (!structBusy && needsReload && !typing()) reloadSong(); });
    }
    /** The order to save with a new section ("NEW" where it goes; sections still being added are left out). */
    function orderWith(row) {
      return rows.filter(function (r) { return r === row || r.id; }).map(function (r) { return r === row ? 'NEW' : r.id; });
    }
    function addRow(row) {
      structural(function () {
        if (row.dead) return;
        return store.addSection(song.id, { tag: row.tag, body: row.body }, orderWith(row)).then(function (r) {
          var sec = r.section;
          secs[sec.id] = sec; row.id = sec.id;
          if (row.dead) { delete secs[sec.id]; row.id = null; return store.setSectionDeleted(sec.id, song.id, true, rows.filter(function (x) { return x.id; }).map(function (x) { return x.id; })); }
          var later = {};   // typed while it was being added
          if (row.tag !== sec.tag) later.tag = row.tag;
          if (row.body !== (sec.body || '')) later.body = row.body;
          if (Object.keys(later).length) queue(sec.id, later);
        });
      });
    }
    function removeRow(row) {
      row.dead = true;
      if (!row.id) return;   // still being added: addRow takes it away again when it lands
      var id = row.id;
      delete pending[id];
      structural(function () {
        delete secs[id];
        return store.setSectionDeleted(id, song.id, true, rows.filter(function (x) { return x.id && x.id !== id; }).map(function (x) { return x.id; }));
      });
    }

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

    /** Runs a change that the store saves right away (a song deleted…), then redraws. */
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

    // ---------- The text box ----------
    function box() { return ctx.el.querySelector('[data-body]'); }
    function typing() { var ta = box(); return !!(ta && document.activeElement === ta); }

    /** Something was typed (or undone): match the box back to the sections and save what changed. */
    function textChanged(ta) {
      var now = Date.now();
      var after = SW.songs.parseSheet(ta.value);
      var m = SW.songs.matchSections(rows, after);
      var byKey = {}; rows.forEach(function (r) { byKey[r.key] = r; });
      var next = after.map(function (s, i) {
        var r = m.keys[i] && byKey[m.keys[i]];
        if (!r) {
          r = { key: 'new' + (++newKey), id: null, tag: s.tag, body: s.body, rhyme_letters: {}, editedAt: now };
          r.isNew = true;
          return r;
        }
        var patch = {};
        if (r.tag !== s.tag) patch.tag = r.tag = s.tag;
        if (r.body !== s.body) patch.body = r.body = s.body;
        if (Object.keys(patch).length) { r.editedAt = now; if (r.id) queue(r.id, patch); }
        return r;
      });
      // Joined into the section above (title erased): its picked rhyme letters come along.
      m.removed.forEach(function (gone) {
        var g = byKey[gone.key], into = gone.into && byKey[gone.into];
        if (g && into && next.indexOf(into) >= 0 && Object.keys(g.rhyme_letters || {}).length) {
          into.rhyme_letters = Object.assign({}, g.rhyme_letters, into.rhyme_letters);
          if (into.id) queue(into.id, { rhyme_letters: into.rhyme_letters });
        }
      });
      rows = next;
      m.removed.forEach(function (gone) { removeRow(byKey[gone.key]); });
      rows.forEach(function (r) { if (r.isNew) { delete r.isNew; addRow(r); } });
      rows.forEach(function (r) { if (r.id && secs[r.id]) { secs[r.id].tag = r.tag; secs[r.id].body = r.body; } });
      drawBox(ta);
      updateWordBar(ta);
    }

    /** Where each line of the box belongs: [{ title, row (index in rows), line (index in that section) }]. */
    function lineMap(text) {
      var out = [], sec = -1, at = 0;
      text.split('\n').forEach(function (l) {
        if (/^#/.test(l)) { sec++; at = 0; out.push({ title: true, row: sec, line: -1 }); return; }
        if (sec < 0) sec = 0;
        out.push({ title: false, row: sec, line: at++ });
      });
      return out;
    }
    function caretLine(ta) {
      if (!ta || document.activeElement !== ta) return -1;
      return ta.value.slice(0, ta.selectionStart).split('\n').length - 1;
    }

    /** Draw the mirror (the visible text) and the gutter (counts and rhyme letters), lined up with the
        box's lines even when they wrap, and size the box to fit. */
    var drawnCaretLine = null;
    function drawBox(ta) {
      if (!ta) return;
      var wrap = ta.parentNode, mirror = wrap.querySelector('.sw-mirror'), gutter = wrap.querySelector('[data-gutter]');
      var text = ta.value, lines = text.split('\n'), map = lineMap(text), dict = ctx.dict(), cl = caretLine(ta);
      drawnCaretLine = cl;
      var schemes = rows.map(function (r) { return dict && r.body.trim() ? R.rhymeScheme(dict, r.body.split('\n'), r.rhyme_letters) : null; });
      mirror.innerHTML = lines.map(function (l, i) {
        var at = map[i];
        if (at.title) {
          // Shown in bold capitals without the "#" (2.0.8.2-beta5, Alex). The line as typed stays in
          // place, invisible, so it takes exactly the room the box gives it; the title is drawn over it.
          // On the cursor's line it shows as typed, so the cursor sits right and you can erase the "#".
          if (i === cl) return `<div class="sw-tl">${esc(l) || '&#8203;'}</div>`;
          return `<div class="sw-tl"><span class="sw-tlas">${esc(l)}</span><span class="sw-tlcap">${esc(l.replace(/^#\s*/, ''))}</span></div>`;
        }
        var sch = schemes[at.row];
        return `<div>${underlined(l, sch && sch.lines[at.line]) || '&#8203;'}</div>`;
      }).join('');
      ta.style.height = 'auto';
      ta.style.height = Math.max(ta.scrollHeight, mirror.offsetHeight) + 'px';
      var wrapTop = wrap.getBoundingClientRect().top;   // exact (offsetTop rounds to whole pixels and drifts)
      var tops = [].map.call(mirror.children, function (d) { return d.getBoundingClientRect().top - wrapTop; });
      gutter.innerHTML = lines.map(function (l, i) {
        var at = map[i], sch = schemes[at.row], r = rows[at.row];
        if (at.title) return sch && sch.scheme ? `<span class="sw-gs" style="top:${tops[i]}px">${esc(sch.scheme)}</span>` : '';
        if (!l.trim() || !sch || !r) return '';
        var info = sch.lines[at.line];
        // Tap to pick this line's rhyme letter.
        return `<button class="sw-gl" style="top:${tops[i]}px" data-act="ed-link" data-key="${esc(r.key)}" data-line="${at.line}" aria-label="Choose the rhyme letter for this line"><span class="sw-ls">${info.syllables}</span>${letterChip(info)}</button>`;
      }).join('');
    }

    /** Someone else saved: put their change in the box. Never the section you're typing in (or have
        just typed in, or is still saving): yours wins there, like everywhere in Setlist. A section
        added or removed elsewhere shows once you stop typing. */
    function onLive(ev) {
      if (!song) return;
      var r = ev.row;
      if (ev.table === 'songs' && r && r.id === song.id) {
        var titleBox = ctx.el.querySelector('[data-title]');
        var typingTitle = titleBox && document.activeElement === titleBox;
        song = Object.assign({}, song, r, typingTitle ? { title: song.title } : {});
        if (r.deleted_at) { closeSong(); ctx.render(); return; }
        if (!typing()) ctx.render();
        return;
      }
      if (ev.table !== 'sections' || !r || !r.id) return;
      var row = rows.filter(function (x) { return x.id === r.id; })[0];
      if (!row) {
        if (r.deleted_at || structBusy) return;   // gone already, or our own new section arriving
        needsReload = true;
        if (!typing()) reloadSong();
        return;
      }
      if (r.deleted_at) { if (row.dead) return; needsReload = true; if (!typing()) reloadSong(); return; }
      var ta = box(), cl = caretLine(ta), here = cl >= 0 ? lineMap(ta.value)[cl] : null;
      var mine = here && rows[here.row] === row;
      if (mine || pending[r.id] || Date.now() - row.editedAt < 3000) return;
      var tag = r.tag == null ? '' : r.tag, body = r.body || '';
      secs[r.id] = Object.assign(secs[r.id] || {}, r);
      if (row.tag === tag && row.body === body && JSON.stringify(row.rhyme_letters || {}) === JSON.stringify(r.rhyme_letters || {})) return;
      if (!typing()) {
        row.tag = tag; row.body = body; row.rhyme_letters = r.rhyme_letters || {};
        ctx.render();
        return;
      }
      // While typing elsewhere in the box: swap that section's text in and keep the cursor where it was.
      var k = rows.indexOf(row), a = ta.selectionStart, b = ta.selectionEnd;
      var startOf = SW.songs.sheetText(rows.slice(0, k + 1)).length, before = SW.songs.sheetText(rows).length;
      row.tag = tag; row.body = body; row.rhyme_letters = r.rhyme_letters || {};
      var shift = SW.songs.sheetText(rows).length - before, after = a >= startOf;
      ta.value = SW.songs.sheetText(rows);
      ta.setSelectionRange(after ? a + shift : a, after ? b + shift : b);
      typingHist = null;   // our undo steps would undo their change
      drawBox(ta);
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
      var cl = caretLine(ta);
      var onTitle = cl >= 0 && /^#/.test(ta.value.split('\n')[cl] || '');
      var w = cl >= 0 && !onTitle ? wordAtCursor(ta) : '';
      if (!w) { bar.hidden = true; barWord = ''; var a = scrollParent(ctx.el); if (a) a.style.scrollPaddingTop = ''; return; }
      bar.hidden = false;
      if (w !== barWord) {
        barWord = w;
        var dict = ctx.dict(), syl = dict ? R.syllables(dict, w) : 0;
        bar.innerHTML = `<span class="sw-wword"><b class="sw-keepcase">${esc(w)}</b>${syl ? `<small>${syl} syl</small>` : ''}</span>
          <span class="sw-wbtns">${[['rhymes', 'Rhymes'], ['syn', 'Syn'], ['ant', 'Ant'], ['def', 'Meaning'], ['rel', 'Related']].map(function (t) {
            return `<button data-act="ed-word" data-arg="${t[0]}">${t[1]}</button>`; }).join('')}<button class="sw-wletter" data-act="ed-pickword" aria-label="Give this word a rhyme letter">A·B</button></span>`;
        fitBar(bar);
      }
      placeBar(bar);
    }
    /** The whole word always shows (Alex, 2.0.8.2-beta7): a long word gets smaller text, down to 14px;
        if it still doesn't fit beside the buttons, the buttons move to a second row under it.
        The room is measured as the bar's width minus the buttons, not from the word's own box. */
    var WORD_PX = 17, WORD_MIN_PX = 14;
    function fitBar(bar) {
      var b = bar.querySelector('.sw-wword b'), btns = bar.querySelector('.sw-wbtns');
      if (!b || !btns) return;
      bar.classList.remove('sw-wrap');
      var cs = getComputedStyle(bar);
      var room = bar.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - btns.offsetWidth - (parseFloat(cs.columnGap) || 0);
      var range = document.createRange();
      range.selectNodeContents(b);
      var fits = function () { return range.getBoundingClientRect().width <= room; };
      for (var px = WORD_PX; px >= WORD_MIN_PX; px -= 0.5) {
        b.style.fontSize = px + 'px';
        if (fits()) return;
      }
      b.style.fontSize = '';
      bar.classList.add('sw-wrap');
    }
    function refitBar() {
      var bar = ctx.el.querySelector('[data-wordbar]');
      if (bar && !bar.hidden) { fitBar(bar); placeBar(bar); }
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

    /** The cursor moved: show the "#" of the title it's on (and hide the one it left), update the word bar. */
    function caretMoved(ta) {
      if (caretLine(ta) !== drawnCaretLine) drawBox(ta);
      updateWordBar(ta);
    }

    // ---------- Typing undo (⌘Z / ⌘⇧Z in the lyrics, 2.0.8.2) ----------
    // A burst of typing (until a pause of TYPING_BURST_MS) is one step. Kept while the song is open.
    var TYPING_BURST_MS = 1000;
    var typingHist = null;   // { undo: [state], redo: [state], cur: state, at: time of last typing }
    var stateOf = function (ta) { return { value: ta.value, a: ta.selectionStart, b: ta.selectionEnd }; };
    function hist(ta) {
      if (!typingHist) typingHist = { undo: [], redo: [], cur: stateOf(ta), at: 0 };
      return typingHist;
    }
    function noteTyping(ta) {
      var h = hist(ta), now = Date.now();
      if (h.cur.value === ta.value) { h.cur = stateOf(ta); return; }
      if (now - h.at >= TYPING_BURST_MS) { h.undo.push(h.cur); if (h.undo.length > 200) h.undo.shift(); }
      h.redo = [];
      h.cur = stateOf(ta); h.at = now;
    }
    function undoTyping(ta, redo) {
      var h = hist(ta), from = redo ? h.redo : h.undo, to = redo ? h.undo : h.redo;
      if (!from.length) return;
      to.push(stateOf(ta));
      var s = from.pop();
      ta.value = s.value; ta.setSelectionRange(s.a, s.b);
      h.cur = s; h.at = 0;   // the next letter starts a new step
      textChanged(ta);
    }
    ctx.el.addEventListener('keydown', function (e) {
      var t = e.target;
      if (!(t.matches && t.matches('[data-body]')) || !(e.metaKey || e.ctrlKey) || e.altKey || (e.key || '').toLowerCase() !== 'z') return;
      e.preventDefault(); e.stopPropagation();   // not the browser's undo, not the Setlist app's
      undoTyping(t, e.shiftKey);
    });
    ctx.el.addEventListener('focusin', function (e) { if (e.target.matches && e.target.matches('[data-body]')) { hist(e.target); caretMoved(e.target); } });

    ctx.el.addEventListener('input', function (e) {
      var t = e.target;
      if (t.matches && t.matches('[data-body]')) {
        noteTyping(t);
        textChanged(t);
      } else if (t.matches && t.matches('[data-title]') && song) {
        saveTitle(t.value);
      }
    });
    ['keyup', 'click'].forEach(function (type) {
      ctx.el.addEventListener(type, function (e) { if (e.target.matches && e.target.matches('[data-body]')) caretMoved(e.target); });
    });
    ctx.on(document, 'selectionchange', function () {
      var ta = box();
      if (ta && document.activeElement === ta) caretMoved(ta);
    });
    ctx.el.addEventListener('focusout', function (e) {
      if (!(e.target.matches && e.target.matches('[data-body]'))) return;
      setTimeout(function () {
        var ta = box();
        updateWordBar(null);
        if (ta && document.activeElement !== ta) drawBox(ta);   // hide the "#" again
        flush();
        if (needsReload && !structBusy) reloadSong();
      }, 150);
    });
    // Tapping the word bar mustn't take focus from the lyrics (that would close the keyboard first).
    ['pointerdown', 'mousedown'].forEach(function (type) {
      ctx.el.addEventListener(type, function (e) { if (e.target.closest && e.target.closest('[data-wordbar]')) e.preventDefault(); });
    });

    /** After each redraw: draw the box's text, counts and letters. */
    function afterRender() { drawBox(box()); }
    function refresh() { var ta = box(); drawBox(ta); if (ta) updateWordBar(ta); showStatus(); }

    // ---------- Taps ----------
    function act(name, d) {
      var x = state.lyMenu && rowOf(state.lyMenu);
      switch (name) {
        case 'ed-retry': storeProblem = null; store = null; list = null; connect(); break;
        case 'ed-new':
          change(store.create('Untitled').then(function (r) {
            song = r.song; secs = {}; r.sections.forEach(function (s) { secs[s.id] = s; });
            rowsFromSaved();
            state.lyView = 'song'; state.lySong = song.id;
            if (stopLive) stopLive();
            stopLive = store.subscribe(song.id, onLive);
          }));
          return true;
        case 'ed-open': openSong(d.id); break;
        case 'ed-back': closeSong(); break;
        case 'ed-word': {
          var ta = box();
          var w = ta ? wordAtCursor(ta) : barWord;
          if (w) ctx.openWord(w, d.arg);
          break;
        }
        case 'ed-songmenu': state.sheet = 'ed-songmenu'; break;
        case 'ed-counts':
          showCounts = !showCounts;
          try { root.localStorage.setItem(COUNTS_KEY, showCounts ? 'on' : 'off'); } catch (e) { /* fine */ }
          break;
        case 'ed-link': {   // tapped a line's letter: pick the letter for that line's last word
          flush();
          var dk = ctx.dict(), sx = rowOf(d.key);
          if (!dk || !sx) break;
          state.lyMenu = sx.key;
          state.lyPickWord = R.rhymeScheme(dk, sx.body.split('\n'), sx.rhyme_letters).lines[+d.line].end;
          state.sheet = 'ed-link';
          break;
        }
        case 'ed-pickword': {   // A·B on the word bar: pick the letter for the word at the cursor
          var tb = box();
          var pw = tb ? wordAtCursor(tb) : barWord;
          var at = tb && lineMap(tb.value)[caretLine(tb)];
          if (!pw || !at || !rows[at.row]) break;
          flush();
          state.lyMenu = rows[at.row].key; state.lyPickWord = pw; state.sheet = 'ed-link';
          break;
        }
        case 'ed-letter': {
          var end = state.lyPickWord;
          if (!x || !end) break;
          var letters = Object.assign({}, x.rhyme_letters || {});
          if (d.arg === 'auto') delete letters[end]; else letters[end] = d.arg;
          x.rhyme_letters = letters;
          if (x.id) { if (secs[x.id]) secs[x.id].rhyme_letters = letters; queue(x.id, { rhyme_letters: letters }); flush(); }
          break;
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
          var text = [song.title || 'Untitled'].concat(rows.map(function (r) {
            return (r.tag ? '[' + r.tag + ']\n' : '') + (r.body || '').trim();
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
      typing: typing,
      refresh: refresh,
      /** Before the Songwriter is taken off the page: save what's pending, stop live updates. */
      destroy: function () {
        flush();
        if (stopLive) { stopLive(); stopLive = null; }
        if (undo) clearTimeout(undo.timer);
      },
      isBusy: function () {
        return !!(typing() || saving || structBusy || Object.keys(pending).length);
      }
    };
  }

  SW.editor = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
