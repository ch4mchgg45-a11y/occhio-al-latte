# Occhio al Latte

Web app per iPhone (e Android): inquadri il **codice a barre** o gli **ingredienti** e ti dice se c'è latte.

## Cosa fa
- **Codice a barre** → cerca il prodotto su Open Food Facts (archivio gratuito) e guarda allergeni, tracce e ingredienti.
- **Ingredienti** → legge il testo dalla fotocamera (Tesseract, gira sul telefono, gratis) e cerca le parole del latte.
  Si può "passare" sull'etichetta: quello che legge si somma finché non premi *Ricomincia*.
- Risultati: 🚫 Contiene latte · 💙 Senza lattosio (latte delattosato, Parmigiano/Grana) · ⚠️ Può contenere tracce · 🔎 Da controllare · ✅ Senza latte.
- Esclude i falsi allarmi: burro di cacao, latte di cocco/soia/mandorla, acido lattico, lattati, lattuga…

## File
- `index.html`, `style.css` — pagina e grafica
- `js/analisi.js` — **la lista delle parole** (latte, derivati, formaggi, parole in altre lingue, tracce, "senza lattosio", eccezioni). Per aggiungere una parola si modifica qui.
- `js/app.js` — fotocamera, lettore codici (ZXing), lettura testo, schermate

## Provarla sul computer
Server di prova "occhio-al-latte" (porta 8767) in `.claude/launch.json`.

## Nota
La fotocamera funziona solo da un indirizzo https (es. GitHub Pages). È un aiuto, non una garanzia.
