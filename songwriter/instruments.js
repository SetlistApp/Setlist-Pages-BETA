/* Songwriter: draws the guitar fretboard and piano keyboard as SVG text.
   No music rules here: the caller passes mark(pc, midi), which says how to show each note:
     { type: 'root' | 'tone' | 'plain', text: 'F♯' }  or  null (don't show it). */
(function (root) {
  var SW = root.SW = root.SW || {};

  var GUITAR_STRINGS = [64, 59, 55, 50, 45, 40];   // high e on top (like tab) → low E
  var GUITAR_NAMES = ['E', 'B', 'G', 'D', 'A', 'E'];
  var INLAYS = [3, 5, 7, 9, 15, 17, 19, 21];
  var BLACK = { 1: 1, 3: 1, 6: 1, 8: 1, 10: 1 };

  function circle(cx, cy, r, m) {
    return '<circle class="sw-dot-' + m.type + '" cx="' + cx + '" cy="' + cy + '" r="' + r + '"/>' +
      '<text class="sw-dot-txt" x="' + cx + '" y="' + (cy + 3.6) + '">' + m.text + '</text>';
  }
  function plain(cx, cy, bgClass) {
    return function (m) {
      return (bgClass ? '<rect class="' + bgClass + '" x="' + (cx - 8) + '" y="' + (cy - 6) + '" width="16" height="12"/>' : '') +
        '<text class="sw-plain-txt" x="' + cx + '" y="' + (cy + 3.8) + '">' + m.text + '</text>';
    };
  }

  /** o: { frets: 22, fw: fret width, sh: string gap, openW: open-string column width, mark } */
  function fretboard(o) {
    var frets = o.frets || 22, fw = o.fw || 44, sh = o.sh || 28, openW = o.openW || 34;
    var top = 18, boardH = sh * 5, H = top + boardH + 22, W = openW + frets * fw + 6;
    var s = '<svg class="sw-fretboard" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">';
    s += '<rect class="sw-fb-wood" x="' + openW + '" y="' + (top - 8) + '" width="' + frets * fw + '" height="' + (boardH + 16) + '" rx="3"/>';
    INLAYS.forEach(function (f) {
      if (f <= frets) s += '<circle class="sw-fb-inlay" cx="' + (openW + (f - 0.5) * fw) + '" cy="' + (top + boardH / 2) + '" r="5"/>';
    });
    if (frets >= 12) {
      var x12 = openW + 11.5 * fw;
      s += '<circle class="sw-fb-inlay" cx="' + x12 + '" cy="' + (top + sh * 1.5) + '" r="5"/><circle class="sw-fb-inlay" cx="' + x12 + '" cy="' + (top + sh * 3.5) + '" r="5"/>';
    }
    for (var f = 0; f <= frets; f++) {
      var x = openW + f * fw;
      s += '<line class="' + (f ? 'sw-fb-fret' : 'sw-fb-nut') + '" x1="' + x + '" y1="' + (top - 8) + '" x2="' + x + '" y2="' + (top + boardH + 8) + '"/>';
      if (f > 0) s += '<text class="sw-fb-num" x="' + (openW + (f - 0.5) * fw) + '" y="' + (H - 2) + '">' + f + '</text>';
    }
    GUITAR_STRINGS.forEach(function (open, i) {
      var y = top + i * sh;
      s += '<line class="sw-fb-string" x1="' + openW + '" y1="' + y + '" x2="' + (openW + frets * fw) + '" y2="' + y + '" style="stroke-width:' + (1 + i * 0.35) + '"/>';
    });
    GUITAR_STRINGS.forEach(function (open, i) {
      var y = top + i * sh;
      for (var f = 0; f <= frets; f++) {
        var midi = open + f, cx = f === 0 ? openW / 2 - 2 : openW + (f - 0.5) * fw;
        var m = o.mark(midi % 12, midi);
        if (!m && f === 0) m = { type: 'string', text: GUITAR_NAMES[i] };
        if (!m) continue;
        if (m.type === 'plain' || m.type === 'string') s += plain(cx, y, f === 0 ? 'sw-plain-bg-open' : 'sw-plain-bg')(m);
        else s += circle(cx, y, 11, m);
      }
    });
    return s + '</svg>';
  }

  /** o: { start: 48 (C3), end: 84 (C6), ww: white-key width, wh: white-key height, mark }.
      Returns { svg, xOf(midi) } so the caller can scroll to a key. */
  function piano(o) {
    var start = o.start || 48, end = o.end || 84, ww = o.ww || 34, wh = o.wh || 150;
    var whites = [], blacks = [], xOf = {};
    for (var m = start; m <= end; m++) (BLACK[m % 12] ? blacks : whites).push(m);
    var W = whites.length * ww + 2, H = wh + 20, bw = ww * 0.6, bh = wh * 0.62;
    var dotR = Math.min(11, ww * 0.33);   // same size on white and black keys
    var s = '<svg class="sw-piano" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">';
    whites.forEach(function (m, i) {
      xOf[m] = i * ww + 1;
      s += '<rect class="sw-key-white" x="' + xOf[m] + '" y="1" width="' + (ww - 1.5) + '" height="' + wh + '" rx="3"/>';
      // Octave labels go under the keyboard so they don't look like highlighted notes.
      if (m % 12 === 0) s += '<text class="sw-key-octave" x="' + (xOf[m] + ww / 2) + '" y="' + (wh + 15) + '">C' + (Math.floor(m / 12) - 1) + '</text>';
    });
    blacks.forEach(function (m) {
      xOf[m] = xOf[m - 1] + ww - bw / 2;
      s += '<rect class="sw-key-black" x="' + xOf[m] + '" y="1" width="' + bw + '" height="' + bh + '" rx="2"/>';
    });
    for (var k = start; k <= end; k++) {
      var mk = o.mark(k % 12, k);
      if (!mk) continue;
      var black = !!BLACK[k % 12];
      var cx = black ? xOf[k] + bw / 2 : xOf[k] + ww / 2 - 0.75, cy = black ? bh - 14 : wh - 28;
      if (mk.type === 'plain') s += '<text class="sw-plain-txt ' + (black ? '' : 'sw-on-white') + '" x="' + cx + '" y="' + (cy + 3.6) + '">' + mk.text + '</text>';
      else s += circle(cx, cy, dotR, { type: mk.type + (black ? '' : ' sw-on-white'), text: mk.text });
    }
    return { svg: s + '</svg>', xOf: function (midi) { return xOf[midi]; } };
  }

  // ---------- Voice-leading piano roll ----------

  /** Lowest/highest MIDI to draw for some voicings: widened so the left edge is a C or F and the
      right edge an E or B (white keys with no black key outside them, so none is cut in half). */
  function rollRange(paths) {
    var lo = Infinity, hi = -Infinity;
    paths.forEach(function (path) { path.forEach(function (v) { v.forEach(function (m) { lo = Math.min(lo, m); hi = Math.max(hi, m); }); }); });
    while (lo % 12 !== 0 && lo % 12 !== 5) lo--;
    while (hi % 12 !== 4 && hi % 12 !== 11) hi++;
    return { lo: lo, hi: hi };
  }

  function keyColumns(lo, hi, left, width) {
    var whites = [];
    for (var m = lo; m <= hi; m++) if (!BLACK[m % 12]) whites.push(m);
    var ww = width / whites.length, bw = ww * 0.6, x = {}, w = {};
    whites.forEach(function (m, i) { x[m] = left + i * ww; w[m] = ww; });
    for (var k = lo; k <= hi; k++) if (BLACK[k % 12]) { x[k] = x[k - 1] + ww - bw / 2; w[k] = bw; }
    return { whites: whites, ww: ww, bw: bw, x: x, w: w, cx: function (m) { return x[m] + w[m] / 2; } };
  }

  function stripes(cols, lo, hi, top, height) {
    var s = '';
    cols.whites.forEach(function (m) { s += '<rect class="sw-vr-white" x="' + cols.x[m] + '" y="' + top + '" width="' + cols.ww + '" height="' + height + '"/>'; });
    for (var m = lo; m <= hi; m++) if (BLACK[m % 12]) s += '<rect class="sw-vr-black" x="' + cols.x[m] + '" y="' + top + '" width="' + cols.bw + '" height="' + height + '"/>';
    return s;
  }

  /** The roll: keyboard along the bottom, chords stacking upward (first chord at the bottom),
      a circle per note, lines joining each note to the next chord's.
      o: { path: [voicing...], rows: [{ name, rootPc, labels: { midi: 'F♯' } }], width, sel, locks } */
  function voiceRoll(o) {
    var path = o.path, n = path.length, W = o.width || 334, rowH = 24, gapH = 22, keysH = 34, r = 9;
    // The name strip on the left widens to fit the longest chord name (E♭maj7, C♯m7♭5).
    var longest = Math.max.apply(null, o.rows.map(function (row) { return row.name.length; }));
    var gut = Math.max(40, Math.min(84, longest * 7.4 + 12));
    var range = rollRange([path]), cols = keyColumns(range.lo, range.hi, gut, W - gut);
    var rollH = n * rowH + (n - 1) * gapH + 8, H = rollH + keysH + 14;
    var cy = function (i) { return rollH - 4 - rowH / 2 - i * (rowH + gapH); };
    var s = '<svg class="sw-vroll" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">';
    s += stripes(cols, range.lo, range.hi, 0, rollH);
    if (o.sel >= 0) s += '<rect class="sw-vr-sel" x="' + gut + '" y="' + (cy(o.sel) - rowH / 2 - 2) + '" width="' + (W - gut) + '" height="' + (rowH + 4) + '"/>';
    // keyboard
    var ky = rollH + 2;
    cols.whites.forEach(function (m) {
      s += '<rect class="sw-key-white" x="' + (cols.x[m] + 0.5) + '" y="' + ky + '" width="' + (cols.ww - 1) + '" height="' + keysH + '" rx="3"/>';
      if (m % 12 === 0 || m === range.lo || m === range.hi) {
        s += '<text class="sw-key-octave" x="' + cols.cx(m) + '" y="' + (ky + keysH + 11) + '">' + ['C', '', 'D', '', 'E', 'F', '', 'G', '', 'A', '', 'B'][m % 12] + (Math.floor(m / 12) - 1) + '</text>';
      }
    });
    for (var m = range.lo; m <= range.hi; m++) if (BLACK[m % 12]) s += '<rect class="sw-key-black" x="' + cols.x[m] + '" y="' + ky + '" width="' + cols.bw + '" height="' + keysH * 0.62 + '" rx="2"/>';
    // lines between chords
    for (var i = 1; i < n; i++) {
      for (var k = 0; k < path[i].length; k++) {
        var a = path[i - 1][k], b = path[i][k], d = b - a;
        s += '<line class="' + (d ? 'sw-vr-move' : 'sw-vr-stay') + '" x1="' + cols.cx(a) + '" y1="' + cy(i - 1) + '" x2="' + cols.cx(b) + '" y2="' + cy(i) + '"/>';
        if (d) {
          s += '<text class="sw-vr-num" x="' + ((cols.cx(a) + cols.cx(b)) / 2 + (d > 0 ? 9 : -9)) + '" y="' + ((cy(i - 1) + cy(i)) / 2 + 3) + '">' + (d > 0 ? '+' + d : '−' + (-d)) + '</text>';
        }
      }
    }
    // circles and chord names (both tappable)
    path.forEach(function (v, i) {
      var row = o.rows[i], lock = (o.locks && o.locks[i]) || [];
      v.forEach(function (m) {
        var x = cols.cx(m), y = cy(i);
        s += '<g data-act="vl-note" data-idx="' + i + '" data-midi="' + m + '">' +
          '<circle class="sw-vr-hit" cx="' + x + '" cy="' + y + '" r="' + (r + 6) + '"/>' +
          '<circle class="' + (m % 12 === row.rootPc ? 'sw-vr-root' : 'sw-vr-tone') + '" cx="' + x + '" cy="' + y + '" r="' + r + '"/>' +
          '<text class="sw-vr-txt" x="' + x + '" y="' + (y + 3.4) + '">' + (row.labels[m] || '') + '</text>' +
          (lock.indexOf(m) >= 0 ? '<text class="sw-vr-lock" x="' + (x + 10) + '" y="' + (y - 5) + '">🔒</text>' : '') + '</g>';
      });
      s += '<g data-act="vl-chord" data-idx="' + i + '"><rect class="sw-vr-hit" x="0" y="' + (cy(i) - rowH / 2 - 6) + '" width="' + gut + '" height="' + (rowH + 12) + '"/>' +
        '<text class="sw-vr-name' + (i === o.sel ? ' sw-on' : '') + '" x="' + (gut / 2 - 2) + '" y="' + (cy(i) + 5) + '">' + row.name + '</text>' +
        (lock.length ? '<text class="sw-vr-lock" x="' + (gut / 2 - 2) + '" y="' + (cy(i) - 9) + '">🔒</text>' : '') + '</g>';
    });
    return s + '</svg>';
  }

  /** Small preview of a complete voicing, drawn over the given range. */
  function voiceRollMini(path, rootPcs, range, W, H) {
    var n = path.length, span = range.hi - range.lo + 1;
    var x = function (m) { return 4 + (m - range.lo + 0.5) * ((W - 8) / span); };
    var y = function (i) { return n === 1 ? H / 2 : H - 7 - i * ((H - 14) / (n - 1)); };
    var s = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">';
    for (var m = range.lo; m <= range.hi; m++) {
      s += '<rect class="' + (BLACK[m % 12] ? 'sw-vr-black' : 'sw-vr-white') + '" x="' + (4 + (m - range.lo) * ((W - 8) / span)) + '" y="0" width="' + ((W - 8) / span) + '" height="' + H + '"/>';
    }
    for (var i = 1; i < n; i++) for (var k = 0; k < path[i].length; k++) {
      var a = path[i - 1][k], b = path[i][k];
      s += '<line class="' + (a === b ? 'sw-vr-stay' : 'sw-vr-move') + ' sw-thin" x1="' + x(a) + '" y1="' + y(i - 1) + '" x2="' + x(b) + '" y2="' + y(i) + '"/>';
    }
    path.forEach(function (v, i) {
      v.forEach(function (m) { s += '<circle class="' + (m % 12 === rootPcs[i] ? 'sw-vr-root' : 'sw-vr-tone') + ' sw-thin" cx="' + x(m) + '" cy="' + y(i) + '" r="3.2"/>'; });
    });
    return s + '</svg>';
  }

  SW.instruments = { fretboard: fretboard, piano: piano, voiceRoll: voiceRoll, voiceRollMini: voiceRollMini, rollRange: rollRange };
})(typeof window !== 'undefined' ? window : globalThis);
