/* Occhio al Latte — analisi del testo degli ingredienti.
   Cerca latte, derivati, tracce e "senza lattosio" in un testo (etichetta letta
   dalla fotocamera o ingredienti presi da Open Food Facts).
   Il testo viene "normalizzato" (minuscolo, senza accenti) mantenendo la stessa
   lunghezza, così si possono evidenziare le parole trovate nel testo originale. */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // 1. COSE CHE SEMBRANO LATTE MA NON LO SONO (vanno tolte prima di tutto)
  // ---------------------------------------------------------------------------
  const NON_LATTE = [
    ['burro di (cacao|karite|arachid[ie]|mandorl[ae]|nocciol[ae]|anacardi|cocco|pistacchi[o]?|semi|frutta secca|girasole|sesamo|soia|cupuacu|mango|illipe)', 'Burro vegetale: non è latte'],
    ['latte di (cocco|mandorl[ae]|soia|riso|avena|nocciol[ae]|anacardi|canapa|farro|miglio|kamut|quinoa|piselli|cocc?o)', 'Bevanda vegetale: non è latte'],
    ['latte vegetale|bevanda (vegetale|a base di (soia|riso|avena|mandorl[ae]|cocco|nocciol[ae]|anacardi|farro|miglio|canapa|kamut|quinoa|piselli))', 'Bevanda vegetale: non è latte'],
    ['(crema|panna) di (cocco|riso|soia|avena|mandorl[ae])', 'Crema vegetale: non è latte'],
    ['formagg(io|i) (vegan[oi]|vegetal[ei])', 'Formaggio vegetale: non è latte'],
    ['acido lattico|lattat[oi]|lattilat[oi]|stearoil[- ]?\\d?[- ]?lattilato|glucono[- ]?delta[- ]?lattone|lattoni?\\b|lattug[ah]\\w*|lattughin[oi]', 'Non è latte (solo il nome somiglia)'],
    ['cremor(e)? tartaro|cream of tartar', 'Non è latte'],
    ['(cocoa|shea|peanut|nut|almond|cashew|seed) butter', 'Burro vegetale: non è latte'],
    ['(coconut|almond|soy|soya|oat|rice|cashew|hazelnut) (milk|drink|cream)', 'Bevanda vegetale: non è latte'],
    ['lactic acid|lactates?|beurre de (cacao|karite)|lait de (coco|soja|amande|riz)|kakaobutter|kokosmilch|leche de (coco|soja|almendra)|manteca de cacao', 'Non è latte'],
  ];

  // ---------------------------------------------------------------------------
  // 2. "SENZA LATTE" / "SENZA LATTOSIO" (frasi da riconoscere prima)
  // ---------------------------------------------------------------------------
  const SENZA_LATTE = [
    "senza latte", "non contiene latte", "privo di latte", "priva di latte",
    "senza derivati del latte", "senza latte e derivati", "non contiene derivati del latte",
    "milk free", "milk-free", "dairy free", "dairy-free", "sans lait", "ohne milch",
    "100% vegetale", "vegano", "vegana", "vegan",
  ];
  const SENZA_LATTOSIO = [
    "senza lattosio", "delattosat[oaie]", "privo di lattosio", "priva di lattosio",
    "naturalmente privo di lattosio", "naturalmente senza lattosio",
    "lattosio\\s*(inferiore a|<|minore di|meno di)\\s*0[,.]\\d+\\s*(g|%)?",
    "lattosio\\s*0[,.]0+\\s*(g|%)?", "0\\s*%\\s*lattosio", "zero lattosio",
    "lactose[- ]free", "free from lactose", "laktosefrei", "lactosefrei", "sans lactose",
    "sin lactosa", "sem lactose",
  ];

  // ---------------------------------------------------------------------------
  // 3. TRACCE: frasi tipo "può contenere tracce di latte"
  // ---------------------------------------------------------------------------
  const INIZIO_TRACCE =
    "(puo'?\\s+contenere|potrebbe\\s+contenere|contiene\\s+tracce|eventuali\\s+tracce|tracce|" +
    "puo'?\\s+essere\\s+presente|possibile\\s+presenza|prodotto\\s+in\\s+uno\\s+stabilimento|" +
    "(prodotto|confezionato)\\s+in\\s+(uno\\s+)?(stabilimento|impianto|ambiente)|stabilimento\\s+che|" +
    "linea\\s+(di\\s+produzione\\s+)?che|che\\s+(utilizza|lavora|impiega)\\s+anche|" +
    "may\\s+contain|traces?\\s+of|made\\s+in\\s+a\\s+factory|peut\\s+contenir|traces\\s+de|" +
    "kann\\s+(spuren|enthalten)|spuren\\s+von|puede\\s+contener|trazas\\s+de)";

  // ---------------------------------------------------------------------------
  // 4. LATTE E DERIVATI (rosso). [parola/espressione, nota opzionale, stagionato?]
  // ---------------------------------------------------------------------------
  const ROSSO = [
    // latte
    ['fior di latte', null], ['fiocchi di latte', 'formaggio fresco'],
    ['solidi (del|di) latte', 'derivato del latte'], ['proteine (del|di) latte', 'derivato del latte'],
    ['zuccheri? del latte', 'è il lattosio'], ['grass[oi] (del|di) latte', 'derivato del latte'],
    ['materia grassa (del|di) latte|materia grassa lattica', 'derivato del latte'],
    ['lattosio', 'è lo zucchero del latte'],
    ['lattoalbumin[ae]|lattalbumin[ae]', 'proteina del latte'],
    ['(beta[- ]?)?lattoglobulin[ae]', 'proteina del latte'],
    ['lattoferrin[ae]', 'proteina del latte'], ['lattoproteine?|lattoproteina', 'proteine del latte'],
    ['lattulosio', 'ricavato dal lattosio'], ['lattoserio|lattosiero', 'siero di latte'],
    ['lattier[oi][- ]?casear[ioe]', 'latticini'], ['latticin[io]', 'derivati del latte'],
    ['latticello', 'liquido che resta facendo il burro'],
    // siero e caseine
    ['siero (di latte|in polvere|dolce|acido|di formaggio|concentrato|demineralizzato)( in polvere| concentrato)?', 'derivato del latte'],
    ['sieroproteine?|siero ?proteine|proteine del siero|permeato di siero', 'derivato del latte'],
    ['siero', 'nei cibi è siero di latte'],
    ['para[- ]?caseina|casein[ae]', 'proteina del latte'],
    ['caseinat[oi]( di (sodio|calcio|potassio|magnesio))?', 'proteina del latte'],
    // burro e panna
    ['burro (anidro|chiarificato|concentrato|fuso|di centrifuga|di affioramento)', null],
    ['burro|burri', null], ['ghee', 'burro chiarificato'], ['butirro|grasso butirrico|olio di burro', 'grasso del burro'],
    ['panna (fresca|da cucina|acida|montata|cotta|uht)', null], ['panna|panne', 'derivato del latte'],
    ['crema di latte|crema al latte|crema pasticcera|crema chantilly', 'contiene latte'],
    ['besciamella|besciamel', 'fatta con latte'],
    ['cioccolato (al latte|bianco)|cioccolata (al latte|bianca)', 'contiene latte'],
    ['dulce de leche|mou\\b', 'caramello al latte'],
    // yogurt e simili
    ['yogurt|yoghurt|iogurt|yogourt|jogurt', null], ['kefir', 'latte fermentato'], ['skyr', 'latticino'],
    ['latte fermentato|latti fermentati', null],
    // formaggi
    ['formagg(io|i|ino|ini)( fuso| fusi| in polvere| grattugiato)?', null],
    ['cagliata|quark|primo sale', 'formaggio fresco'],
    ['ricotta', null], ['mascarpone', null], ['mozzarell[ae]', null], ['burrata', null],
    ['stracciatella di bufala|stracciatella', 'formaggio (o gelato) con latte/panna'],
    ['parmigiano( reggiano)?', 'stagionato: naturalmente senza lattosio', true],
    ['grana (padano|trentino)', 'stagionato: naturalmente senza lattosio', true],
    ['pecorino|gorgonzola|stracchino|provolone|fontina|asiago|emment(h)?al(er)?|groviera|gruyere|scamorza|' +
     'caciocavallo|caciotta|taleggio|crescenza|robiola|feta|cheddar|montasio|edamer|gouda|brie|camembert|' +
     'squacquerone|casatella|caprino|tomino|bitto|raschera|castelmagno|monte veronese|' +
     'ragusano|fiore sardo|halloumi|paneer|maasdam|leerdammer|philadelphia|spalmabile al latte', 'formaggio'],
    // parole generiche per ultime (così prima si riconoscono le espressioni intere)
    ['latte (intero|scremato|parzialmente scremato|in polvere|condensato|concentrato|evaporato|fresco|crudo|uht|di (vacca|mucca|capra|pecora|bufala|asina))( in polvere)?', null],
    ['latte', null], ['latti', null],
    // altre lingue
    ['milk( powder| solids| protein| fat| sugar)?|skimmed milk|whole milk|buttermilk', 'inglese: latte'],
    ['lactose', 'lattosio'], ['whey( powder| protein)?', 'inglese: siero di latte'],
    ['casein(ate)?s?', 'inglese: caseina'], ['butter(fat|oil|milk)?', 'inglese: burro'],
    ['cream|creme fraiche|cheese|curd|yoghurt', 'inglese/francese: derivato del latte'],
    ['lactalbumin|lactoglobulin|milk ?fat', 'proteine/grassi del latte'],
    ['lait|lactoserum|beurre|fromage|caseine', 'francese: latte/derivato'],
    ['\\w*milch\\w*|laktose|molke\\w*|sahne|rahm|kase|kaese|butterreinfett|butterschmalz|joghurt|quarg', 'tedesco: latte/derivato'],
    ['leche|lactosa|mantequilla|queso|suero lacteo|lacteos?', 'spagnolo: latte/derivato'],
    ['leite|manteiga|queijo|soro de leite', 'portoghese: latte/derivato'],
  ];

  // ---------------------------------------------------------------------------
  // 5. DA CONTROLLARE (giallo): a volte contengono latte, a volte no
  // ---------------------------------------------------------------------------
  const GIALLO = [
    ['fermenti lattici', 'possono essere coltivati sul latte'],
    ['lattitolo|e ?966', 'dolcificante ricavato dal lattosio'],
    ['panna vegetale|preparato vegetale', 'spesso contiene proteine del latte'],
    ['burro vegetale|margarina', 'a volte contiene siero o latte'],
    ['gelato', 'di solito è fatto con latte'],
    ['cioccolat[oa](?! (fondente|extra fondente)?\\s*\\()', 'a volte contiene latte: guarda tra parentesi'],
    ['proteine animali', 'potrebbero venire dal latte'],
    ['aroma (di )?(latte|burro|formaggio|panna)', 'potrebbe contenere derivati del latte'],
    ['tagatosio', 'zucchero che si ricava dal lattosio'],
    ['crema spalmabile', 'spesso contiene latte in polvere'],
    ['caramello', 'a volte fatto con latte o panna'],
  ];

  // Parole per la ricerca "tollerante" (errori di lettura della fotocamera)
  const FUZZY = ['latte', 'lattosio', 'siero', 'caseina', 'caseinato', 'burro', 'panna', 'formaggio',
    'formaggi', 'ricotta', 'mozzarella', 'yogurt', 'latticello', 'mascarpone', 'parmigiano', 'latticini',
    'sieroproteine', 'lattoproteine', 'besciamella'];
  const FUZZY_NO = new Set(['batte', 'matte', 'gatte', 'latta', 'lotte', 'lotto', 'manna', 'penna', 'penne',
    'serio', 'siera', 'burri', 'birra', 'birre', 'lette', 'tatte', 'patte', 'parte', 'carta', 'paste',
    'pasta', 'patate', 'latino', 'lattina', 'lettino', 'lattuga', 'rotto', 'forma', 'formati', 'formato',
    'piero', 'zero', 'fiero', 'vero', 'nero', 'caseine', 'cotta', 'torta']);

  // ---------------------------------------------------------------------------
  // Strumenti
  // ---------------------------------------------------------------------------
  // minuscolo + niente accenti, stessa lunghezza del testo originale
  function normalizza(s) {
    let o = '';
    for (let i = 0; i < s.length; i++) {
      let c = s[i].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (c === '’' || c === '`' || c === '´') c = "'";
      if (c.length !== 1) c = ' ';
      o += c;
    }
    return o;
  }

  // sistema il testo grezzo: unisce parole spezzate a capo, toglie spazi doppi
  function pulisci(t) {
    return String(t || '')
      .replace(/\r/g, '')
      .replace(/([a-zà-ü])[-‐‑]\s*\n\s*([a-zà-ü])/gi, '$1$2')
      .replace(/[|]/g, 'l')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const re = (src) => new RegExp('\\b(?:' + src + ')\\b', 'g');
  const COMPILATI = {
    nonLatte: NON_LATTE.map(([s, nota]) => ({ r: re(s), nota })),
    senzaLatte: re(SENZA_LATTE.map(s => s.replace(/[%]/g, '%')).join('|')),
    senzaLattosio: re(SENZA_LATTOSIO.join('|')),
    // la frase finisce al punto, al punto e virgola o dove ricomincia "ingredienti"
    tracce: new RegExp('\\b' + INIZIO_TRACCE + '(?:(?!ingredient)[^.;]){0,170}', 'g'),
    rosso: ROSSO.map(([s, nota, stag]) => ({ r: re(s), nota, stag: !!stag })),
    giallo: GIALLO.map(([s, nota]) => ({ r: re(s), nota })),
  };
  const QUALSIASI_LATTE = new RegExp('\\b(?:' + ROSSO.map(x => x[0]).join('|') + ')\\b');

  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 9;
    const d = [];
    for (let i = 0; i <= a.length; i++) d[i] = [i];
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }

  // ---------------------------------------------------------------------------
  // ANALISI
  // ---------------------------------------------------------------------------
  function analizza(testoGrezzo, opzioni) {
    const opz = Object.assign({ fuzzy: false }, opzioni || {});
    const testo = pulisci(testoGrezzo);
    let lav = normalizza(testo);           // copia di lavoro che viene "cancellata" man mano
    const parti = [];                       // {da, a, tipo}
    const out = { testo, rosso: [], giallo: [], tracce: [], nonLatte: [], senzaLattosio: false,
      senzaLatte: false, soloStagionati: false, parole: 0, haIngredienti: false, parti };

    const cancella = (da, a) => { lav = lav.slice(0, da) + ' '.repeat(a - da) + lav.slice(a); };
    const trova = (regex, cb) => {
      regex.lastIndex = 0;
      const trovati = [];
      let m;
      while ((m = regex.exec(lav)) !== null) {
        if (m[0].length === 0) { regex.lastIndex++; continue; }
        trovati.push([m.index, m.index + m[0].length, m]);
      }
      for (const [da, a, m2] of trovati) { if (cb(da, a, m2) !== false) cancella(da, a); }
    };
    const aggiungi = (lista, chiave, voce) => {
      const k = chiave.toLowerCase();
      if (!lista.some(x => x.chiave === k)) lista.push(Object.assign({ chiave: k }, voce));
    };

    out.parole = (lav.match(/\b[a-z]{3,}\b/g) || []).filter(w => /[aeiou]/.test(w)).length;
    out.haIngredienti = /\bingredient|\bzutaten|\bingredients|\bingredientes/.test(lav);

    // 1. non latte
    for (const { r, nota } of COMPILATI.nonLatte) {
      trova(r, (da, a) => { aggiungi(out.nonLatte, testo.slice(da, a), { testo: testo.slice(da, a), nota }); parti.push({ da, a, tipo: 'ok' }); });
    }
    // 2. senza lattosio / senza latte
    trova(COMPILATI.senzaLattosio, (da, a) => { out.senzaLattosio = true; parti.push({ da, a, tipo: 'blu' }); });
    trova(COMPILATI.senzaLatte, (da, a) => { out.senzaLatte = true; parti.push({ da, a, tipo: 'ok' }); });
    // 3. tracce
    trova(COMPILATI.tracce, (da, a, m) => {
      const frase = m[0];
      if (!QUALSIASI_LATTE.test(frase)) return false;   // tracce di altro (es. nocciole): lascia stare
      aggiungi(out.tracce, testo.slice(da, a), { testo: testo.slice(da, a).trim() });
      parti.push({ da, a, tipo: 'arancio' });
    });
    // 4. latte e derivati
    for (const { r, nota, stag } of COMPILATI.rosso) {
      trova(r, (da, a) => { const t = testo.slice(da, a); aggiungi(out.rosso, t, { testo: t, nota, stag }); parti.push({ da, a, tipo: 'rosso' }); });
    }
    // 5. da controllare
    for (const { r, nota } of COMPILATI.giallo) {
      trova(r, (da, a) => { const t = testo.slice(da, a); aggiungi(out.giallo, t, { testo: t, nota }); parti.push({ da, a, tipo: 'giallo' }); });
    }
    // 6. ricerca tollerante (solo testo letto dalla fotocamera)
    if (opz.fuzzy) {
      const parolaRe = /\b[a-z]{5,}\b/g;
      let m;
      while ((m = parolaRe.exec(lav)) !== null) {
        const w = m[0];
        if (FUZZY_NO.has(w)) continue;
        for (const k of FUZZY) {
          const soglia = k.length >= 8 ? 2 : 1;
          if (w !== k && lev(w, k) <= soglia) {
            const t = testo.slice(m.index, m.index + w.length);
            aggiungi(out.rosso, t, { testo: t, nota: 'letto male? forse «' + k + '»', forse: true });
            parti.push({ da: m.index, a: m.index + w.length, tipo: 'rosso' });
            break;
          }
        }
      }
    }
    out.soloStagionati = out.rosso.length > 0 && out.rosso.every(x => x.stag);
    parti.sort((x, y) => x.da - y.da);
    return out;
  }

  // ---------------------------------------------------------------------------
  // VERDETTO
  // ---------------------------------------------------------------------------
  // fonte: 'codice' (Open Food Facts) oppure 'testo' (fotocamera)
  function verdetto(a, fonte, abbastanza) {
    const certi = a.rosso.filter(x => !x.forse);
    if (a.rosso.length && (a.senzaLattosio || a.soloStagionati)) {
      return { livello: 'blu', titolo: 'Senza lattosio',
        sotto: a.senzaLattosio ? 'Contiene latte, ma è dichiarato senza lattosio.'
          : 'Contiene formaggio stagionato (Parmigiano/Grana): è naturalmente senza lattosio.' };
    }
    if (certi.length) return { livello: 'rosso', titolo: 'Contiene latte', sotto: 'Ci sono latte o derivati del latte.' };
    if (a.rosso.length) return { livello: 'rosso', titolo: 'Forse contiene latte', sotto: 'Ho letto una parola simile a un derivato del latte: controlla.' };
    if (a.tracce.length) return { livello: 'arancio', titolo: 'Può contenere latte', sotto: 'Possibili tracce (lavorato vicino a prodotti con latte).' };
    if (a.giallo.length) return { livello: 'giallo', titolo: 'Da controllare', sotto: 'Alcuni ingredienti a volte contengono latte.' };
    if (!abbastanza) return { livello: 'grigio', titolo: fonte === 'testo' ? 'Sto leggendo…' : 'Non lo so',
      sotto: fonte === 'testo' ? 'Avvicina il telefono agli ingredienti e tienilo fermo.' : 'Mancano gli ingredienti di questo prodotto.' };
    return { livello: 'verde', titolo: 'Senza latte',
      sotto: fonte === 'testo' ? 'Non ho trovato latte nel testo letto.' : 'Nessun latte negli ingredienti né negli allergeni.' };
  }

  window.Latte = { analizza, verdetto, normalizza, pulisci,
    liste: { NON_LATTE, SENZA_LATTE, SENZA_LATTOSIO, ROSSO, GIALLO } };
})();
