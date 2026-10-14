/* Songwriter: lyrics for the Setlist app's songs, saved in its Supabase database.

   Songs are the Setlist app's own songs (read only here: they're created, renamed and deleted in
   Setlist). Each song's lyrics are rows in song_lyric_sections (made by supabase-lyrics.sql, a private
   file): one row per section, in order by `position`. Each section saves on its own, so two people
   editing different sections never clash; on the same section the last save wins (like Setlist's
   fields). "Deleting" a section only sets deleted_at (Undo); deleting a song in Setlist deletes its
   sections.

   SW.songs.open(onReady, onFail, options) loads the Supabase library (online only), or uses the
   Setlist app's own client (options.client), and calls onReady(store).
   SW.songs.practiceStore() is a stand-in kept in the browser tab, for testing (#practice).
   Both have the same methods, all returning promises. */
(function (root) {
  var SW = root.SW = root.SW || {};
  var LIB_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
  var SONGS = 'songs', SECTIONS = 'song_lyric_sections';

  var now = function () { return new Date().toISOString(); };
  var check = function (res) { if (res.error) throw new Error(res.error.message); return res.data; };
  /** Section ids in order (by position). */
  var orderOf = function (secs) { return secs.slice().sort(function (a, b) { return a.position - b.position; }).map(function (s) { return s.id; }); };

  /** A store for Setlist songs. who() = the name to save as "updated by" (a Setlist member view). */
  function setlistStore(client, who) {
    var by = function () { return (who && who()) || 'Songwriter'; };
    var setOrder = function (songId, order) {
      return Promise.all(order.map(function (id, i) { return client.from(SECTIONS).update({ position: i }).eq('id', id).then(check); }));
    };
    return {
      kind: 'setlist',
      positional: true,     // the order comes from each section's position
      canCreate: false, canRename: false, canDeleteSong: false,   // songs belong to Setlist

      /** Every Setlist song: ones with lyrics first (most recently edited first), then the rest A–Z. */
      list: function () {
        return Promise.all([
          client.from(SONGS).select('id,title').then(check),
          client.from(SECTIONS).select('id,song_id,tag,repeat_of,body,position,updated_at').is('deleted_at', null).then(check)
        ]).then(function (r) {
          var songs = r[0], secs = r[1];
          var out = songs.map(function (s) {
            var mine = secs.filter(function (x) { return x.song_id === s.id; });
            var latest = mine.reduce(function (m, x) { return x.updated_at > m ? x.updated_at : m; }, '');
            return { id: s.id, title: s.title, sections: mine, section_order: orderOf(mine), updated_at: latest || null };
          });
          return out.sort(function (a, b) {
            if (!!a.updated_at !== !!b.updated_at) return a.updated_at ? -1 : 1;
            if (a.updated_at) return a.updated_at < b.updated_at ? 1 : -1;
            return String(a.title || '').localeCompare(String(b.title || ''));
          });
        });
      },

      load: function (songId) {
        return Promise.all([
          client.from(SONGS).select('id,title').eq('id', songId).single().then(check),
          client.from(SECTIONS).select('*').eq('song_id', songId).is('deleted_at', null).then(check)
        ]).then(function (r) { return { song: Object.assign({}, r[0], { section_order: orderOf(r[1]) }), sections: r[1] }; });
      },

      /** Save one section's changes ({ tag, body, repeat_of, rhyme_letters }). */
      saveSection: function (id, songId, patch) {
        return client.from(SECTIONS).update(Object.assign({}, patch, { updated_at: now(), updated_by: by() })).eq('id', id).select().single().then(check);
      },

      /** Add a section where "NEW" sits in the given order, then save everyone's positions. */
      addSection: function (songId, fields, order) {
        return client.from(SECTIONS).insert(Object.assign({ song_id: songId, position: order.indexOf('NEW'), updated_by: by() }, fields)).select().single().then(check)
          .then(function (sec) {
            var o = order.map(function (x) { return x === 'NEW' ? sec.id : x; });
            return setOrder(songId, o).then(function () { return { section: sec, order: o }; });
          });
      },

      setOrder: setOrder,

      /** Hide a section (or bring it back with deleted = false), then save the new order. */
      setSectionDeleted: function (id, songId, deleted, order) {
        return client.from(SECTIONS).update({ deleted_at: deleted ? now() : null, updated_by: by() }).eq('id', id).then(check)
          .then(function () { return setOrder(songId, order); });
      },

      /** Live updates for one song: calls onChange({ table: 'sections', row }) when anyone saves. Returns stop(). */
      subscribe: function (songId, onChange) {
        var ch = client.channel('songwriter-lyrics-' + songId)
          .on('postgres_changes', { event: '*', schema: 'public', table: SECTIONS, filter: 'song_id=eq.' + songId },
            function (p) { onChange({ table: 'sections', row: p.new && p.new.id ? p.new : Object.assign({}, p.old, { deleted_at: now() }) }); })
          .subscribe();
        return function () { client.removeChannel(ch); };
      }
    };
  }

  /** Same methods, without the database. Songs are kept in this browser tab's session storage, so
      they survive a reload or an automatic update, but not closing the tab. (Until saving is connected.) */
  var DRAFTS_KEY = 'songwriter_draftSongs';
  function practiceStore() {
    var songs = [], sections = [], n = 0;
    try {
      var kept = JSON.parse(root.sessionStorage.getItem(DRAFTS_KEY));
      if (kept && kept.songs) { songs = kept.songs; sections = kept.sections; n = kept.n || 0; }
    } catch (e) { /* nothing kept, or private mode */ }
    var keep = function () {
      try { root.sessionStorage.setItem(DRAFTS_KEY, JSON.stringify({ songs: songs, sections: sections, n: n })); } catch (e) { /* full or private: fine */ }
    };
    var id = function () { return 'p' + (++n); };
    var copy = function (x) { return JSON.parse(JSON.stringify(x)); };
    // Every method answers through later(), after its change is made: a good moment to keep everything.
    var later = function (v) { keep(); return new Promise(function (ok) { setTimeout(function () { ok(copy(v)); }, 60); }); };
    var song = function (sid) { return songs.filter(function (s) { return s.id === sid; })[0]; };
    var sec = function (xid) { return sections.filter(function (s) { return s.id === xid; })[0]; };
    var live = function (sid) { return sections.filter(function (s) { return s.song_id === sid && !s.deleted_at; }); };
    var touch = function (sid) { song(sid).updated_at = now(); };
    return {
      kind: 'practice',
      list: function () {
        return later(songs.filter(function (s) { return !s.deleted_at; }).sort(function (a, b) { return a.updated_at < b.updated_at ? 1 : -1; })
          .map(function (s) { return Object.assign({}, s, { sections: live(s.id) }); }));
      },
      create: function (title) {
        var s = { id: id(), title: title || 'Untitled', section_order: [], updated_at: now(), deleted_at: null };
        var x = { id: id(), song_id: s.id, tag: 'Verse', repeat_of: null, body: '', updated_at: now(), deleted_at: null };
        s.section_order = [x.id]; songs.push(s); sections.push(x);
        return later({ song: s, sections: [x] });
      },
      load: function (sid) { return later({ song: song(sid), sections: live(sid) }); },
      saveTitle: function (sid, title) { song(sid).title = title; touch(sid); return later(song(sid)); },
      saveSection: function (xid, sid, patch) { Object.assign(sec(xid), patch, { updated_at: now() }); touch(sid); return later(sec(xid)); },
      addSection: function (sid, fields, order) {
        var x = Object.assign({ id: id(), song_id: sid, tag: 'Verse', repeat_of: null, body: '', updated_at: now(), deleted_at: null }, fields);
        sections.push(x);
        var o = order.map(function (v) { return v === 'NEW' ? x.id : v; });
        song(sid).section_order = o; touch(sid);
        return later({ section: x, order: o });
      },
      setOrder: function (sid, order) { song(sid).section_order = order.slice(); touch(sid); return later(null); },
      setSectionDeleted: function (xid, sid, deleted, order) { sec(xid).deleted_at = deleted ? now() : null; song(sid).section_order = order.slice(); touch(sid); return later(null); },
      setSongDeleted: function (sid, deleted) { song(sid).deleted_at = deleted ? now() : null; return later(null); },
      subscribe: function () { return function () {}; }
    };
  }

  /** Loads the Supabase library once (it's online-only) and calls onReady(store) or onFail(reason). */
  var opened = null;
  function open(onReady, onFail, options) {
    options = options || {};
    if (opened) return onReady(opened);
    // Inside the Setlist app: use its client (one connection, its settings).
    if (options.client) { opened = setlistStore(options.client, options.who); return onReady(opened); }
    var cfg = root.SW_CONFIG;
    if (!cfg || !cfg.supabaseUrl || !cfg.supabaseKey) return onFail('not-configured');
    var ready = function () {
      try {
        opened = setlistStore(root.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey), options.who);
        onReady(opened);
      } catch (e) { onFail('library'); }
    };
    if (root.supabase && root.supabase.createClient) return ready();
    var s = document.createElement('script');
    s.src = LIB_URL;
    s.onload = ready;
    s.onerror = function () { s.remove(); onFail('offline'); };
    document.head.appendChild(s);
  }

  // ---------- Converting old plain-text lyrics into sections ----------
  // Setlist songs keep their lyrics as one block of text (songs.chordsLyrics). importLyrics turns
  // that into sections the editor understands. Pure function: the old text itself is never changed.
  var KNOWN = {
    verse: 'Verse', chorus: 'Chorus', 'pre-chorus': 'Pre-chorus', prechorus: 'Pre-chorus', 'pre chorus': 'Pre-chorus',
    bridge: 'Bridge', intro: 'Intro', outro: 'Outro'
  };
  var OTHER = ['hook', 'refrain', 'post-chorus', 'post chorus', 'interlude', 'breakdown', 'solo', 'instrumental', 'tag', 'coda', 'vamp', 'ending', 'turnaround', 'drop'];
  var CHORD = /^[A-G](?:#|b|♯|♭)?(?:maj|min|m|M|dim|aug|sus|add|°|ø|\+)?\d{0,2}(?:(?:sus|add|maj|b|#|♭|♯)\d{1,2})*(?:\([^)]*\))?(?:\/[A-G](?:#|b|♯|♭)?)?$/;

  /** True for a line with only chords on it ("G  D/F#  Em7 | C", "N.C.", "x2" allowed). */
  function isChordLine(line) {
    var parts = line.trim().replace(/[|]/g, ' ').split(/\s+/).filter(Boolean);
    if (!parts.length) return false;
    var chords = parts.filter(function (p) { return CHORD.test(p.replace(/[()]/g, '')) || /^n\.?c\.?$/i.test(p); }).length;   // N.C. = no chord
    var extras = parts.filter(function (p) { return /^(x\d+|\d+x|-+|\.+|\/+)$/i.test(p); }).length;
    return chords > 0 && chords + extras === parts.length;
  }

  /** If a line is a section label ("Verse 2:", "[Chorus]", "(Bridge)", "CHORUS x2", "Repeat chorus"),
      returns { tag, repeat, rest } (rest = lyrics written after a colon on the same line); else null. */
  function readHeader(line) {
    var raw = line.trim(), m;
    if (!raw || raw.length > 60) return null;
    var rest = '';
    var colon = raw.match(/^([^:]{1,40}):\s*(.*)$/);
    var body = raw;
    if (colon) { body = colon[1]; rest = colon[2]; }
    var bracketed = /^[\[(].*[\])]$/.test(body);
    var inner = body.replace(/^[\[(]\s*|\s*[\])]$/g, '').trim();
    var repeat = false;
    if (/^(repeat|rpt\.?)\s+/i.test(inner)) { repeat = true; inner = inner.replace(/^(repeat|rpt\.?)\s+/i, ''); }
    if (/\s*(x\s*\d+|\d+\s*x|\(repeat\)|repeat)$/i.test(inner)) { repeat = repeat || !rest; inner = inner.replace(/\s*(x\s*\d+|\d+\s*x|\(repeat\)|repeat)$/i, '').trim(); }
    var lower = inner.toLowerCase().replace(/\s+/g, ' ');
    var base = lower.replace(/\s*#?\d+$/, '');
    if (KNOWN[base]) {
      // "Chorus 2" is just another chorus; "Chorus (half time)" keeps its own name.
      return { tag: KNOWN[base], repeat: repeat, rest: rest };
    }
    m = lower.match(/^(verse|chorus|pre-?chorus|bridge|intro|outro)\b/);
    if (m && (bracketed || colon)) return { tag: inner.replace(/\s+/g, ' '), repeat: false, rest: rest };
    if (OTHER.indexOf(base) >= 0) return { tag: base.replace(/\b\w/g, function (c) { return c.toUpperCase(); }), repeat: repeat, rest: rest };
    if (bracketed && !colon && inner && inner.split(/\s+/).length <= 4) return { tag: inner, repeat: false, rest: '' };   // [Anything short]
    return null;
  }

  var LONG_BLOCK = 8;   // an unlabeled block longer than this is checked for a repeating chorus inside it

  /** A long block with no blank lines or labels: if a group of 2+ lines appears more than once, those
      copies become Chorus blocks and the lines between them Verse blocks. Otherwise it's left whole. */
  function splitByRepeats(block) {
    var lines = block.lines, n = lines.length;
    var k = lines.map(function (l) { return l.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim(); });
    var best = null;
    for (var i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        var len = 0;
        while (j + len < n && i + len < j && k[i + len] && k[i + len] === k[j + len]) len++;
        if (len >= 2 && (!best || len > best.len)) best = { start: i, len: len };
      }
    }
    if (!best) return [block];
    var run = k.slice(best.start, best.start + best.len).join('\n'), out = [], gap = [];
    var flush = function () { if (gap.length) out.push({ tag: null, repeat: false, lines: gap, labeled: false }); gap = []; };
    for (var p = 0; p < n;) {
      if (k.slice(p, p + best.len).join('\n') === run) {
        flush();
        out.push({ tag: 'Chorus', repeat: false, lines: lines.slice(p, p + best.len), labeled: false });
        p += best.len;
      } else { gap.push(lines[p]); p++; }
    }
    flush();
    return out;
  }

  /** Old plain-text lyrics → [{ tag, body, repeatOf (index of an earlier section) }].
      - Labels like "Verse 1", "[Chorus]", "Bridge:" start a section; "Repeat chorus" or a bare
        "Chorus" label with no words under it repeats the last section with that tag.
      - Without labels, blank lines split it into sections: a block that appears more than once is
        the Chorus (later copies become repeats); the others are Verses.
      - A long unlabeled block with no blank lines is split where a group of lines repeats (the chorus).
      - Lines with only chords are left out (they stay in the old text). */
  function importLyrics(text) {
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').map(function (l) { return l.replace(/\s+$/, ''); });
    var blocks = [], cur = null;
    var start = function (tag, repeat) { cur = { tag: tag, repeat: !!repeat, lines: [], labeled: !!tag }; blocks.push(cur); };
    lines.forEach(function (line) {
      if (isChordLine(line)) return;
      var h = readHeader(line);
      if (h) { start(h.tag, h.repeat); if (h.rest) cur.lines.push(h.rest); return; }
      if (!line.trim()) { if (cur && cur.lines.length) cur = null; return; }
      if (!cur) start(null);
      cur.lines.push(line.trim());
    });
    blocks = blocks.filter(function (b) { return b.lines.length || b.tag; });
    blocks = [].concat.apply([], blocks.map(function (b) { return !b.tag && b.lines.length > LONG_BLOCK ? splitByRepeats(b) : [b]; }));

    var key = function (b) { return b.lines.join('\n').toLowerCase().replace(/[^a-z\n ]/g, ''); };
    var seen = {};
    blocks.forEach(function (b) { if (b.lines.length) seen[key(b)] = (seen[key(b)] || 0) + 1; });
    var out = [], firstOf = {};
    blocks.forEach(function (b) {
      var k = key(b);
      if (!b.tag) b.tag = b.lines.length && seen[k] > 1 ? 'Chorus' : 'Verse';
      // Same words as an earlier section with this tag (or a label with nothing under it): a repeat.
      var earlier = b.lines.length ? firstOf[b.tag + '|' + k] : firstOf[b.tag];
      if ((b.repeat || !b.lines.length || earlier !== undefined) && (earlier !== undefined || firstOf[b.tag] !== undefined)) {
        out.push({ tag: b.tag, body: '', repeatOf: earlier !== undefined ? earlier : firstOf[b.tag] });
        return;
      }
      var i = out.length;   // (a label with nothing under it stays as an empty section, so the song's shape is kept)
      out.push({ tag: b.tag, body: b.lines.join('\n'), repeatOf: null });
      if (firstOf[b.tag] === undefined) firstOf[b.tag] = i;
      firstOf[b.tag + '|' + k] = i;
    });
    return out;
  }

  SW.songs = { open: open, practiceStore: practiceStore, importLyrics: importLyrics, isChordLine: isChordLine };
})(typeof window !== 'undefined' ? window : globalThis);
