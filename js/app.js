/* Occhio al Latte — fotocamera, codice a barre, lettura testo, risultati */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const video = $('#video'), tela = $('#tela');
  const ctx = tela.getContext('2d', { willReadFrequently: true });

  const S = {
    stream: null, attivo: false, pausa: false,
    timerCodice: null, lettore: null, hints: null, giro: 0,
    ocr: null, ocrPronto: false, ocrAcc: null,
    ultimoCodice: null, giroCamera: 0, ricerca: 0, modo: 'codice',
  };

  // ---------------------------------------------------------------------------
  // UTILITÀ
  // ---------------------------------------------------------------------------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ICONE = { rosso: '🚫', arancio: '⚠️', giallo: '🔎', verde: '✅', blu: '✅', grigio: '❔' };
  // la risposta in una parola, grande, per capire al volo
  const PAROLA = { rosso: 'NO', arancio: 'ATTENZIONE', giallo: 'CONTROLLA', verde: 'VA BENE', blu: 'VA BENE', grigio: '…' };
  const INVITI = { codice: 'Inquadra il codice a barre', ingredienti: 'Inquadra la lista degli ingredienti' };
  const invito = () => INVITI[S.modo];
  const stato = (t) => { $('#stato').textContent = t; };
  const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

  function evidenzia(a) {
    // testo originale con le parole trovate colorate
    let html = '', pos = 0;
    for (const p of a.parti) {
      if (p.da < pos) continue;
      html += esc(a.testo.slice(pos, p.da)) + '<mark class="' + p.tipo + '">' + esc(a.testo.slice(p.da, p.a)) + '</mark>';
      pos = p.a;
    }
    return html + esc(a.testo.slice(pos));
  }

  function vociHtml(a, max) {
    const righe = [];
    for (const x of a.rosso) righe.push(['rosso', '🚫', x.testo, x.nota]);
    if (a.senzaLattosio) righe.push(['blu', '💙', 'Senza lattosio', 'scritto sulla confezione']);
    for (const x of a.tracce) righe.push(['arancio', '⚠️', 'Tracce', x.testo]);
    for (const x of a.giallo) righe.push(['giallo', '🔎', x.testo, x.nota]);
    for (const x of a.nonLatte) righe.push(['ok', '✓', x.testo, x.nota]);
    const lista = max ? righe.slice(0, max) : righe;
    let h = lista.map(([c, ic, t, n]) => '<div class="voce ' + c + '"><span class="ic">' + ic + '</span><span><b>' + esc(t) + '</b>' + (n ? ' <small>— ' + esc(n) + '</small>' : '') + '</span></div>').join('');
    if (max && righe.length > max) h += '<div class="voce"><small>… e altre ' + (righe.length - max) + '</small></div>';
    return h;
  }

  // ---------------------------------------------------------------------------
  // FOTOCAMERA
  // ---------------------------------------------------------------------------
  async function avviaCamera() {
    $('#errore-camera').hidden = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return erroreCamera('Questo browser non può usare la fotocamera. Su iPhone apri il sito con Safari (indirizzo che inizia con https).');
    }
    try {
      S.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
    } catch (e) {
      const negato = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      return erroreCamera(negato
        ? 'Permesso fotocamera negato. Su iPhone: Impostazioni › Safari › Fotocamera › "Consenti", poi ricarica la pagina.'
        : 'Non riesco ad aprire la fotocamera (' + (e && e.name || 'errore') + ').');
    }
    video.srcObject = S.stream;
    $('#camera').classList.add('modo-' + S.modo);
    $('#inizio').hidden = true;
    $('#camera').hidden = false;   // prima di play(): iPhone non avvia un video nascosto
    try { await video.play(); } catch (_) { /* iOS a volte parte da solo */ }
    const traccia = S.stream.getVideoTracks()[0];
    try { await traccia.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (_) {}
    try {
      const cap = traccia.getCapabilities ? traccia.getCapabilities() : {};
      $('#torcia').hidden = !cap.torch;
    } catch (_) {}

    try { localStorage.setItem('camera-ok', '1'); } catch (_) {}
    S.attivo = true; S.pausa = false;
    S.giroCamera++;
    impostaModo('codice');   // si parte sempre dal codice a barre
    avviaCodici();
    avviaOcr();
  }

  // due modalità: si legge solo il codice a barre, oppure solo gli ingredienti
  function impostaModo(m) {
    S.modo = m;
    const cam = $('#camera');
    cam.classList.toggle('modo-codice', m === 'codice');
    cam.classList.toggle('modo-ingredienti', m === 'ingredienti');
    for (const [id, nome] of [['#modo-codice', 'codice'], ['#modo-ingredienti', 'ingredienti']]) {
      $(id).classList.toggle('attivo', m === nome);
      $(id).setAttribute('aria-pressed', String(m === nome));
    }
    azzeraLettura();
    stato(invito());
    if (m === 'ingredienti' && S.attivo && !S.ocrPronto) avviaOcr();   // riprova se la prima volta non era partito
  }
  $('#modo-codice').addEventListener('click', () => impostaModo('codice'));
  $('#modo-ingredienti').addEventListener('click', () => impostaModo('ingredienti'));

  function erroreCamera(msg) {
    const el = $('#errore-camera');
    el.textContent = msg; el.hidden = false;
  }

  function fermaCamera() {
    S.attivo = false;
    clearInterval(S.timerCodice);
    if (S.stream) S.stream.getTracks().forEach((t) => t.stop());
    S.stream = null;
    video.srcObject = null;
    $('#camera').hidden = true;
    $('#inizio').hidden = false;
  }

  let torciaAccesa = false;
  $('#torcia').addEventListener('click', async () => {
    const t = S.stream && S.stream.getVideoTracks()[0];
    if (!t) return;
    torciaAccesa = !torciaAccesa;
    try { await t.applyConstraints({ advanced: [{ torch: torciaAccesa }] }); } catch (_) {}
  });

  // zona del video che corrisponde al mirino (il video è "object-fit: cover")
  function zonaMirino(margine) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const vr = video.getBoundingClientRect(), mr = $('#mirino').getBoundingClientRect();
    const scala = Math.max(vr.width / vw, vr.height / vh);
    const offX = (vw * scala - vr.width) / 2, offY = (vh * scala - vr.height) / 2;
    const m = margine || 0;
    let x = (mr.left - vr.left + offX) / scala - m, y = (mr.top - vr.top + offY) / scala - m;
    let w = mr.width / scala + 2 * m, h = mr.height / scala + 2 * m;
    x = Math.max(0, x); y = Math.max(0, y);
    w = Math.min(vw - x, w); h = Math.min(vh - y, h);
    return { x, y, w, h };
  }

  // zona per leggere il testo: TUTTA la larghezza visibile (così le parole sul bordo
  // non vengono tagliate: "latte" letto a metà diventerebbe "atte") e un po' più in alto/basso
  function zonaTesto() {
    const z = zonaMirino(0);
    if (!z) return null;
    const vw = video.videoWidth, vh = video.videoHeight;
    const vr = video.getBoundingClientRect();
    const scala = Math.max(vr.width / vw, vr.height / vh);
    const visW = vr.width / scala, x = (vw - visW) / 2;
    const extra = z.h * 0.25;
    const y = Math.max(0, z.y - extra), h = Math.min(vh - y, z.h + 2 * extra);
    return { x, y, w: visW, h };
  }

  // ---------------------------------------------------------------------------
  // CODICE A BARRE (ZXing: funziona anche su iPhone)
  // ---------------------------------------------------------------------------
  function avviaCodici() {
    if (!window.ZXing) { stato('Lettore codici non caricato: controlla internet'); return; }
    if (!S.lettore) {
      const Z = window.ZXing;
      S.hints = new Map();
      S.hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E]);
      S.hints.set(Z.DecodeHintType.TRY_HARDER, true);
      S.lettore = new Z.MultiFormatReader();
      S.lettore.setHints(S.hints);
    }
    clearInterval(S.timerCodice);
    S.timerCodice = setInterval(leggiCodice, 160);
  }

  function leggiCodice() {
    if (!S.attivo || S.pausa || document.hidden || S.modo !== 'codice') return;
    const z = zonaMirino(40);
    if (!z) return;
    const Z = window.ZXing;
    S.giro++;
    const scala = Math.min(1, 1000 / z.w);
    const w = Math.round(z.w * scala), h = Math.round(z.h * scala);
    tela.width = w; tela.height = h;
    ctx.drawImage(video, z.x, z.y, z.w, z.h, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const lum = new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = (px[j] * 77 + px[j + 1] * 150 + px[j + 2] * 29) >> 8;
    try {
      const sorgente = new Z.RGBLuminanceSource(lum, w, h);
      const bin = (S.giro % 2) ? new Z.HybridBinarizer(sorgente) : new Z.GlobalHistogramBinarizer(sorgente);
      const r = S.lettore.decode(new Z.BinaryBitmap(bin), S.hints);
      const codice = r && r.getText();
      if (codice && /^\d{8,14}$/.test(codice)) trovatoCodice(codice);
    } catch (_) { /* nessun codice in questo fotogramma */ }
  }

  function trovatoCodice(codice) {
    if (S.pausa) return;
    S.pausa = true;
    if (navigator.vibrate) navigator.vibrate(60);
    cercaProdotto(codice);
  }

  // ---------------------------------------------------------------------------
  // OPEN FOOD FACTS
  // ---------------------------------------------------------------------------
  const CAMPI = 'code,product_name,product_name_it,generic_name_it,brands,allergens_tags,traces_tags,labels_tags,' +
    'ingredients_text_it,ingredients_text,ingredients_analysis_tags,image_front_small_url';

  async function chiediProdotto(codice) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch('https://world.openfoodfacts.org/api/v2/product/' + encodeURIComponent(codice) + '.json?fields=' + CAMPI, { signal: ctrl.signal });
      if (res.status === 404) return { status: 0 };
      if (!res.ok) throw Object.assign(new Error('server'), { server: true });
      return await res.json();
    } finally { clearTimeout(t); }
  }

  async function cercaProdotto(codice) {
    const mia = ++S.ricerca;          // se nel frattempo si cerca un altro prodotto, questa risposta va ignorata
    S.ultimoCodice = codice;
    apriScheda('<div class="attesa"><div class="rotella"></div>Cerco il prodotto…<br><small>' + esc(codice) + '</small></div>', true);
    let dati;
    try {
      // i codici europei che iniziano con 0 a volte vengono letti a 12 cifre
      dati = await chiediProdotto(codice.length === 12 ? '0' + codice : codice);
      if ((!dati || dati.status !== 1) && codice.length === 12) dati = await chiediProdotto(codice);
    } catch (e) {
      if (mia !== S.ricerca) return;
      const server = e && e.server;
      return apriScheda(schedaVerdetto({ livello: 'grigio', titolo: server ? 'Archivio non raggiungibile' : 'Niente internet',
        sotto: (server ? 'Riprova tra poco.' : 'Non riesco a cercare il prodotto.') + ' Intanto puoi inquadrare gli ingredienti.' }) +
        '<p class="fonte">Codice: ' + esc(codice) + '</p>', true);
    }
    if (mia !== S.ricerca) return;
    if (!dati || dati.status !== 1 || !dati.product) {
      return apriScheda(schedaVerdetto({ livello: 'grigio', titolo: 'Prodotto non trovato', sotto: 'Questo codice non è nell\'archivio. Inquadra gli ingredienti sulla confezione.' }) +
        '<p class="fonte">Codice: ' + esc(codice) + '</p>', true);
    }
    mostraProdotto(dati.product, codice);
  }

  function mostraProdotto(p, codice) {
    const allergeni = p.allergens_tags || [], tracce = p.traces_tags || [], etichette = p.labels_tags || [];
    const analisiIngr = p.ingredients_analysis_tags || [];
    const testo = p.ingredients_text_it || p.ingredients_text || '';
    const a = Latte.analizza(testo, { fuzzy: false });

    const haLatte = allergeni.some((t) => /^en:(milk|lactose)$/.test(t));
    const haTracce = tracce.some((t) => /^en:(milk|lactose)$/.test(t));
    if (haLatte && !a.rosso.length) a.rosso.push({ chiave: '_all', testo: 'Latte', nota: 'dichiarato tra gli allergeni' });
    if (haTracce && !a.tracce.length) a.tracce.push({ chiave: '_tr', testo: 'Può contenere latte (dichiarato)' });
    if (etichette.some((t) => /^en:(no-lactose|lactose-free|naturally-lactose-free)$/.test(t))) a.senzaLattosio = true;
    if (etichette.some((t) => /^en:(vegan|no-milk|dairy-free|milk-free|no-dairy)$/.test(t)) || analisiIngr.includes('en:vegan')) a.senzaLatte = true;
    if (a.rosso.length && a.rosso.every((x) => x.stag)) a.soloStagionati = true;

    const abbastanza = testo.trim().length > 8 || allergeni.length > 0 || tracce.length > 0 || a.senzaLatte;
    const v = Latte.verdetto(a, 'codice', abbastanza);
    if (v.livello === 'verde' && !testo.trim()) v.sotto = 'Nessun latte tra gli allergeni dichiarati (ingredienti non disponibili).';

    const nome = p.product_name_it || p.product_name || p.generic_name_it || 'Prodotto senza nome';
    let h = schedaVerdetto(v);
    h += '<div class="prodotto">' + (p.image_front_small_url ? '<img src="' + esc(p.image_front_small_url) + '" alt="">' : '') +
      '<div><div class="nome">' + esc(nome) + '</div>' + (p.brands ? '<div class="marca">' + esc(p.brands) + '</div>' : '') +
      '<div class="cod">' + esc(codice) + '</div></div></div>';
    const voci = vociHtml(a);
    if (voci) h += '<div class="titoletto">Cosa ho trovato</div><div class="voci">' + voci + '</div>';
    if (testo.trim()) {
      h += '<details class="dett"><summary>Vedi gli ingredienti</summary><div class="ingredienti">' + evidenzia(a) + '</div></details>';
    } else {
      h += '<p class="fonte">Ingredienti non disponibili per questo prodotto: per sicurezza inquadrali.</p>';
    }
    h += '<p class="fonte">Dati da Open Food Facts, inseriti da volontari. Le ricette cambiano: nel dubbio controlla l\'etichetta.</p>';
    apriScheda(h, true);
    if (v.livello === 'rosso') $('#leggi-ingr').hidden = true;
  }

  function schedaVerdetto(v, daTesto) {
    const p = daTesto ? parolaTesto(v) : PAROLA[v.livello];
    const parola = v.livello === 'grigio' ? '' : '<div class="parola">' + p + '</div>';
    return '<div class="verdetto ' + v.livello + '"><div class="icona">' + ICONE[v.livello] + '</div>' + parola + '<h2>' + esc(v.titolo) + '</h2><p>' + esc(v.sotto) + '</p></div>';
  }

  // ---------------------------------------------------------------------------
  // LETTURA DEL TESTO (Tesseract, gratis, gira sul telefono)
  // ---------------------------------------------------------------------------
  let ocrPromessa = null;
  function preparaOcr() {
    if (!ocrPromessa) ocrPromessa = creaOcr();
    return ocrPromessa;
  }
  async function creaOcr() {
    if (!window.Tesseract) return;
    $('#carica-ocr').hidden = false;
    try {
      S.ocr = await Tesseract.createWorker('ita', 1, {
        logger: (m) => {
          if (m.status && /load|init/i.test(m.status) && typeof m.progress === 'number') $('#ocr-perc').textContent = Math.round(m.progress * 100) + '%';
        },
      });
      S.ocrPronto = true;
    } catch (e) {
      S.ocr = null;
      ocrPromessa = null;   // la prossima volta riprova
    }
    $('#carica-ocr').hidden = true;
  }

  const telaOcr = document.createElement('canvas');
  const ctxOcr = telaOcr.getContext('2d', { willReadFrequently: true });

  async function avviaOcr() {
    const giro = S.giroCamera;      // ogni apertura della fotocamera ha il suo ciclo
    await preparaOcr();
    if (giro !== S.giroCamera || !S.attivo || S.cicloOcr === giro) return;   // un solo ciclo per volta
    if (!S.ocrPronto) { if (S.modo === 'ingredienti') stato('Non riesco a leggere il testo: serve internet'); return; }
    S.cicloOcr = giro;
    while (S.attivo && giro === S.giroCamera) {
      if (S.pausa || document.hidden || S.modo !== 'ingredienti') { await attendi(300); continue; }
      const z = zonaTesto();
      if (!z) { await attendi(300); continue; }
      // ritaglio del mirino, ingrandito e in bianco e nero per leggere meglio
      const scala = Math.min(2, 1400 / z.w);
      telaOcr.width = Math.round(z.w * scala); telaOcr.height = Math.round(z.h * scala);
      ctxOcr.filter = 'grayscale(1) contrast(1.35)';
      ctxOcr.drawImage(video, z.x, z.y, z.w, z.h, 0, 0, telaOcr.width, telaOcr.height);
      try {
        const { data } = await S.ocr.recognize(telaOcr);
        if (S.attivo && !S.pausa && giro === S.giroCamera && S.modo === 'ingredienti') unisciLettura(data.text || '');
      } catch (_) {}
      await attendi(250);
    }
  }

  function azzeraLettura() {
    S.ocrAcc = { rosso: [], giallo: [], tracce: [], nonLatte: [], senzaLattosio: false, senzaLatte: false, parole: 0, testi: [], haIngredienti: false };
    $('#live').hidden = true;
  }

  // unisce ciò che legge fotogramma dopo fotogramma: così si può "passare" sull'etichetta
  function unisciLettura(testo) {
    const a = Latte.analizza(testo, { fuzzy: true });
    const sembraTesto = a.parole >= 6 || a.haIngredienti;
    if (!sembraTesto && !a.rosso.some((x) => !x.forse)) return;
    if (!sembraTesto) a.rosso = a.rosso.filter((x) => !x.forse);
    const acc = S.ocrAcc;
    const unisci = (lista, nuove) => { for (const n of nuove) if (!lista.some((x) => x.chiave === n.chiave)) lista.push(n); };
    unisci(acc.rosso, a.rosso); unisci(acc.giallo, a.giallo); unisci(acc.tracce, a.tracce); unisci(acc.nonLatte, a.nonLatte);
    acc.senzaLattosio = acc.senzaLattosio || a.senzaLattosio;
    acc.senzaLatte = acc.senzaLatte || a.senzaLatte;
    acc.haIngredienti = acc.haIngredienti || a.haIngredienti;
    acc.parole += a.parole;
    if (a.testo) { acc.testi.push(a); if (acc.testi.length > 6) acc.testi.shift(); }
    acc.soloStagionati = acc.rosso.length > 0 && acc.rosso.every((x) => x.stag);
    mostraLive();
  }

  // con la sola fotocamera non si è mai sicuri di aver letto TUTTO: il verde è prudente
  const parolaTesto = (v) => v.livello === 'verde' ? 'SEMBRA OK' : PAROLA[v.livello];
  const fraseTesto = (v) => v.livello === 'verde' ? 'Non vedo latte: inquadra tutti gli ingredienti' : v.titolo;

  function mostraLive() {
    const acc = S.ocrAcc;
    const abbastanza = acc.parole >= 15 || (acc.haIngredienti && acc.parole >= 8);
    const v = Latte.verdetto(acc, 'testo', abbastanza);
    const box = $('#live-verdetto');
    box.className = 'live-verdetto ' + v.livello;
    box.innerHTML = v.livello === 'grigio'
      ? '<div class="frase">' + esc(v.sotto) + '</div>'
      : '<div class="parola">' + ICONE[v.livello] + ' ' + parolaTesto(v) + '</div><div class="frase">' + esc(fraseTesto(v)) + '</div>';
    $('#live-voci').innerHTML = v.livello === 'grigio' ? '' : vociHtml({ rosso: acc.rosso, tracce: acc.tracce, giallo: acc.giallo, nonLatte: [], senzaLattosio: acc.senzaLattosio }, 2);
    $('#live').hidden = false;
    stato(v.livello === 'grigio' ? 'Tieni fermo il telefono…' : 'Passa pure su tutta l\'etichetta');
  }

  $('#live-reset').addEventListener('click', () => { azzeraLettura(); stato(invito()); });
  $('#live-dettagli').addEventListener('click', () => {
    const acc = S.ocrAcc;
    const abbastanza = acc.parole >= 15 || (acc.haIngredienti && acc.parole >= 8);
    const v = Latte.verdetto(acc, 'testo', abbastanza);
    let h = schedaVerdetto(v, true);
    const voci = vociHtml(acc);
    if (voci) h += '<div class="titoletto">Cosa ho trovato</div><div class="voci">' + voci + '</div>';
    h += '<div class="titoletto">Testo letto dalla fotocamera</div>';
    h += acc.testi.length ? acc.testi.slice().reverse().map((a) => '<div class="ingredienti">' + evidenzia(a) + '</div>').join('')
      : '<p class="fonte">Ancora niente.</p>';
    h += '<p class="fonte">La fotocamera può leggere male qualche parola. Nel dubbio controlla l\'etichetta.</p>';
    S.pausa = true;
    apriScheda(h, false);
  });

  // ---------------------------------------------------------------------------
  // SCHEDA
  // ---------------------------------------------------------------------------
  let schedaDaCodice = false;
  function apriScheda(html, daCodice) {
    schedaDaCodice = daCodice;
    $('#scheda-contenuto').innerHTML = html;
    $('#leggi-ingr').hidden = !daCodice || !S.attivo;
    $('#altro').textContent = S.attivo ? (daCodice ? 'Controlla un altro prodotto' : 'Torna alla fotocamera') : 'Chiudi';
    $('#velo').hidden = false; $('#scheda').hidden = false;
    $('#scheda').scrollTop = 0;
  }
  function chiudiScheda(azzera) {
    S.ricerca++;   // una ricerca ancora in corso non deve più aprire la scheda
    $('#velo').hidden = true; $('#scheda').hidden = true;
    if (azzera) azzeraLettura();
    S.pausa = false;
    if (S.attivo) stato(azzera ? invito() : 'Continuo a leggere…');
  }
  $('#altro').addEventListener('click', () => chiudiScheda(schedaDaCodice));
  $('#leggi-ingr').addEventListener('click', () => { chiudiScheda(true); impostaModo('ingredienti'); });
  $('#velo').addEventListener('click', () => chiudiScheda(schedaDaCodice));

  // ---------------------------------------------------------------------------
  // PULSANTI SCHERMATA INIZIALE
  // ---------------------------------------------------------------------------
  $('#avvia').addEventListener('click', avviaCamera);
  $('#mostra-altro').addEventListener('click', () => { $('#altro-modo').hidden = false; $('#mostra-altro').hidden = true; });
  $('#chiudi').addEventListener('click', fermaCamera);
  $('#form-codice').addEventListener('submit', (e) => {
    e.preventDefault();
    const c = $('#codice-manuale').value.replace(/\D/g, '');
    if (c.length >= 8) cercaProdotto(c);
  });
  $('#form-testo').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = $('#testo-manuale').value;
    if (!t.trim()) return;
    const a = Latte.analizza(t, { fuzzy: false });
    const v = Latte.verdetto(a, 'testo', a.parole >= 2);
    let h = schedaVerdetto(v);
    const voci = vociHtml(a);
    if (voci) h += '<div class="titoletto">Cosa ho trovato</div><div class="voci">' + voci + '</div>';
    h += '<div class="titoletto">Testo</div><div class="ingredienti">' + evidenzia(a) + '</div>';
    apriScheda(h, false);
  });

  // quando si torna sull'app dopo averla lasciata, riapre la fotocamera se iOS l'ha spenta
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && S.attivo) {
      const t = S.stream && S.stream.getVideoTracks()[0];
      if (!t || t.readyState === 'ended') { fermaCamera(); avviaCamera(); }
    }
  });

  // se la fotocamera ha già funzionato, si apre da sola: niente pulsanti da premere
  try { if (localStorage.getItem('camera-ok') === '1') avviaCamera(); } catch (_) {}

  // prepara in anticipo il lettore di testo (scarica i dati una volta sola)
  if ('requestIdleCallback' in window) requestIdleCallback(() => preparaOcr());
  else setTimeout(preparaOcr, 1500);
})();
