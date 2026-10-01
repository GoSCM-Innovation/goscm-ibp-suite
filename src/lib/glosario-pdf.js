// El PDF del glosario, portado de `_buildPDF` de v7 (glosario.js, líneas 1018-1305).
//
// Lee el glosario YA pintado en pantalla (`contenedor`) y lo dibuja con jsPDF, como en v7. Los
// textos que v7 sacaba de `I18n.t(...)` van aquí en español, que es lo que v7 mostraba en es.
// `jspdf-autotable` v5 se llama `autoTable(doc, …)`; v7 usaba la 3.x, que colgaba `doc.autoTable`.

export function construirPdf(J, autoTable, contenedor, modName, today, fileName) {
  var doc = new J.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  var PW = 210, PH = 297, ML = 15, MR = 15;
  var CW  = PW - ML - MR;          // 180 mm usable
  var HDR = 12, FTR = 12;
  var TOP = HDR + 3, BOT = PH - FTR;

  var C = {
    accent: [247, 168, 0],
    dark:   [30, 41, 59],
    text:   [25, 25, 35],
    muted:  [100, 105, 125],
    border: [210, 215, 225],
    cInfo:  [41, 171, 226],
    cTip:   [52, 211, 153],
    cWarn:  [232, 98, 42],
    tHead:  [30, 41, 59],
    tAlt:   [244, 246, 252],
  };

  var y = TOP;

  function F(c) { doc.setFillColor(c[0], c[1], c[2]); }
  function D(c) { doc.setDrawColor(c[0], c[1], c[2]); }
  function T(c) { doc.setTextColor(c[0], c[1], c[2]); }

  function strip(html) {
    var d = document.createElement('div');
    d.innerHTML = html;
    var t = (d.textContent || d.innerText || '').replace(/\s+/g, ' ').trim();
    // eslint-disable-next-line no-control-regex
    return t.replace(/[^\u0000-ɏ–—‘’“”…]/g, '')
            .replace(/\s+/g, ' ').trim();
  }

  function drawHeader() {
    F(C.dark);
    doc.rect(0, 0, PW, HDR, 'F');
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    T([185, 200, 220]);
    doc.text(`GoSCM  |  Glosario ${modName}`, ML, 8);
  }

  function newPage() {
    doc.addPage();
    y = TOP;
    drawHeader();
  }

  function ensure(h) { if (y + h > BOT - 3) newPage(); }

  /* ── COVER ── */
  F([13, 21, 40]);
  doc.rect(0, 0, PW, PH, 'F');
  F(C.accent);
  doc.rect(0, 72, PW, 58, 'F');

  doc.setFontSize(8.5); T([90, 110, 150]); doc.setFont('helvetica', 'normal');
  doc.text('GOSCM APPLICATIONS HUB', PW / 2, 62, { align: 'center' });

  doc.setFontSize(30); T([10, 10, 10]); doc.setFont('helvetica', 'bold');
  doc.text('Glosario', PW / 2, 94, { align: 'center' });
  doc.setFontSize(17);
  doc.text(modName, PW / 2, 108, { align: 'center' });

  D([10, 10, 10]); doc.setLineWidth(0.4);
  doc.line(ML + 25, 140, PW - MR - 25, 140);

  var dateLocale = today.toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' });
  doc.setFontSize(9.5); T([150, 165, 205]); doc.setFont('helvetica', 'normal');
  doc.text('Guía de referencia para la lectura del análisis exportado', PW / 2, 149, { align: 'center' });
  doc.text(`Generado el ${dateLocale}`, PW / 2, 159, { align: 'center' });

  /* ── CONTENT PAGES ── */
  newPage();

  var secEls = contenedor.querySelectorAll('.glos-section');
  secEls.forEach(function (sec) {
    var h2    = sec.querySelector('.glos-section-title');
    var title = h2 ? strip(h2.innerHTML) : '';

    ensure(14);
    F(C.accent);
    doc.rect(ML, y, CW, 9, 'F');
    doc.setFontSize(11); T([10, 10, 10]); doc.setFont('helvetica', 'bold');
    doc.text(title, ML + 3, y + 6.2);
    y += 11;

    var kids = sec.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].tagName === 'H2') continue;
      renderEl(kids[i]);
    }
    y += 4;
  });

  /* ── FOOTERS (post-process) ── */
  var totalPg = doc.getNumberOfPages();
  var contPg  = totalPg - 1;
  for (var pg = 2; pg <= totalPg; pg++) {
    doc.setPage(pg);
    D(C.border); doc.setLineWidth(0.2);
    doc.line(ML, PH - FTR + 2, PW - MR, PH - FTR + 2);
    doc.setFontSize(7); T(C.muted); doc.setFont('helvetica', 'normal');
    doc.text('GoSCM Applications Hub', ML, PH - 5.5);
    doc.text(`Página ${pg - 1} de ${contPg}`, PW - MR, PH - 5.5, { align: 'right' });
  }

  doc.save(fileName);

  /* ── ELEMENT RENDERERS ── */

  function renderEl(el) {
    var cls = el.className || '';
    var tag = el.tagName;
    if (tag === 'HR') return;
    if (tag === 'P')                            { renderPara(el);              return; }
    if (tag === 'UL' || tag === 'OL')           { renderList(el);              return; }
    if (cls.indexOf('glos-section-title') >= 0) return;
    if (cls.indexOf('glos-p') >= 0)             { renderPara(el);              return; }
    if (cls.indexOf('glos-callout') >= 0)        { renderCallout(el, cls);     return; }
    if (cls.indexOf('glos-mattype-card') >= 0)   { renderMattypeCard(el);      return; }
    if (cls.indexOf('glos-sub') >= 0) {
      var h3 = el.querySelector('.glos-sub-title');
      if (h3) renderSubTitle(strip(h3.innerHTML));
      var ch = el.children;
      for (var i = 0; i < ch.length; i++) {
        if (ch[i].tagName === 'H3') continue;
        renderEl(ch[i]);
      }
      return;
    }
    if (cls.indexOf('glos-table-wrap') >= 0) { var t = el.querySelector('table'); if (t) renderTable(t); return; }
    if (cls.indexOf('glos-legend') >= 0)      { renderLegend(el); return; }
    var gc = el.children;
    for (var j = 0; j < gc.length; j++) renderEl(gc[j]);
  }

  function renderPara(el) {
    var text = strip(el.innerHTML);
    if (!text) return;
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); T(C.text);
    var lines = doc.splitTextToSize(text, CW - 4);
    ensure(lines.length * 4.5 + 3);
    doc.text(lines, ML + 2, y);
    y += lines.length * 4.5 + 3;
  }

  function renderSubTitle(text) {
    if (!text) return;
    doc.setFontSize(9.5); doc.setFont('helvetica', 'bold');
    var lines = doc.splitTextToSize(text, CW - 6);
    var rectH = lines.length * 5.2 + 2;
    ensure(rectH + 3);
    F(C.dark); doc.rect(ML, y, CW, rectH, 'F');
    T(C.accent);
    for (var li = 0; li < lines.length; li++) {
      doc.text(lines[li], ML + 3, y + 4.5 + li * 5.2);
    }
    y += rectH + 2;
  }

  function renderCallout(el, cls) {
    var text = strip(el.innerHTML);
    if (!text) return;
    var ac = cls.indexOf('callout-tip')  >= 0 ? C.cTip  :
             cls.indexOf('callout-warn') >= 0 ? C.cWarn : C.cInfo;
    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal');
    var lines = doc.splitTextToSize(text, CW - 10);
    var boxH  = lines.length * 4.3 + 6;
    ensure(boxH + 3);
    var bg = [
      Math.min(255, Math.round(255 - (255 - ac[0]) * 0.10)),
      Math.min(255, Math.round(255 - (255 - ac[1]) * 0.10)),
      Math.min(255, Math.round(255 - (255 - ac[2]) * 0.10))
    ];
    F(bg);  doc.rect(ML, y, CW, boxH, 'F');
    F(ac);  doc.rect(ML, y, 3, boxH, 'F');
    T(C.text);
    doc.text(lines, ML + 6, y + 4.5);
    y += boxH + 3;
  }

  function renderLegend(el) {
    var items = el.querySelectorAll('.glos-legend-item');
    if (!items.length) return;
    var rows = [];
    items.forEach(function (item) {
      var spans = item.querySelectorAll('span');
      var badge = spans.length > 0 ? strip(spans[0].innerHTML) : '';
      var desc  = spans.length > 1 ? strip(spans[spans.length - 1].innerHTML) : '';
      rows.push([badge, desc]);
    });
    ensure(12);
    autoTable(doc, {
      startY: y,
      head: [[('Estado'), ('Significado')]],
      body: rows,
      margin: { top: TOP, left: ML, right: MR, bottom: FTR + 3 },
      tableWidth: CW,
      styles: { fontSize: 8, cellPadding: 2.5, overflow: 'linebreak' },
      headStyles: { fillColor: C.tHead, textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: C.tAlt },
      columnStyles: { 0: { cellWidth: 28 }, 1: { cellWidth: CW - 29 } },
      didDrawPage: drawHeader
    });
    y = doc.lastAutoTable.finalY + 4;
    ensure(0);
  }

  function renderTable(tblEl) {
    var thead = tblEl.querySelector('thead');
    var tbody = tblEl.querySelector('tbody');
    if (!tbody) return;
    var head = [];
    if (thead) {
      head = [Array.from(thead.querySelectorAll('th')).map(function (th) { return strip(th.innerHTML); })];
    }
    var body = Array.from(tbody.querySelectorAll('tr')).map(function (tr) {
      return Array.from(tr.querySelectorAll('td')).map(function (td) { return strip(td.innerHTML); });
    });
    if (!body.length) return;
    var nc = head.length ? head[0].length : (body[0] ? body[0].length : 1);
    var colStyles = {};
    if (nc === 2) {
      colStyles = { 0: { cellWidth: 55 }, 1: { cellWidth: CW - 56 } };
    } else if (nc === 4) {
      colStyles = { 0: { cellWidth: 44 }, 1: { cellWidth: 20 }, 2: { cellWidth: 24 }, 3: { cellWidth: CW - 91 } };
    } else if (nc === 5) {
      var rem = CW - 42 - 20 - 24 - 40 - 2;
      colStyles = { 0: { cellWidth: 42 }, 1: { cellWidth: 20 }, 2: { cellWidth: 24 }, 3: { cellWidth: rem }, 4: { cellWidth: 40 } };
    } else if (nc === 6) {
      var w6 = (CW - 50) / 5;
      colStyles = {
        0: { cellWidth: 50 },
        1: { cellWidth: w6 }, 2: { cellWidth: w6 }, 3: { cellWidth: w6 },
        4: { cellWidth: w6 }, 5: { cellWidth: CW - 50 - w6 * 4 }
      };
    }
    ensure(12);
    autoTable(doc, {
      startY: y,
      head: head.length ? head : undefined,
      body: body,
      margin: { top: TOP, left: ML, right: MR, bottom: FTR + 3 },
      tableWidth: CW,
      styles: { fontSize: 7.5, cellPadding: 2, overflow: 'linebreak' },
      headStyles: { fillColor: C.tHead, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: C.tAlt },
      columnStyles: colStyles,
      didDrawPage: drawHeader
    });
    y = doc.lastAutoTable.finalY + 4;
    ensure(0);
  }

  function renderList(el) {
    var items = el.querySelectorAll('li');
    if (!items.length) return;
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); T(C.text);
    items.forEach(function (li) {
      var text = strip(li.innerHTML);
      if (!text) return;
      var lines = doc.splitTextToSize(text, CW - 10);
      ensure(lines.length * 4.5 + 1);
      doc.text('-', ML + 4, y);
      doc.text(lines[0], ML + 9, y);
      for (var k = 1; k < lines.length; k++) {
        y += 4.5;
        doc.text(lines[k], ML + 9, y);
      }
      y += 5;
    });
    y += 2;
  }

  function renderMattypeCard(el) {
    var headerEl = el.querySelector('.glos-mattype-header');
    var bodyEl   = el.querySelector('.glos-mattype-body');
    if (headerEl) renderSubTitle(strip(headerEl.innerHTML));
    if (bodyEl) {
      var ch = bodyEl.children;
      for (var i = 0; i < ch.length; i++) renderEl(ch[i]);
    }
    y += 3;
  }
}
