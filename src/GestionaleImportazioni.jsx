import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { FileSpreadsheet, Search, Trash2, Download, Plus, Check, X, Upload, Package, Truck, Database, List, ShoppingCart, Settings, FolderOpen, AlertCircle, Ship, FileText, Calculator, Printer, Globe2, Anchor } from 'lucide-react';

// Helper format
const _fmtE = (n) => {
  const num = parseFloat(n) || 0;
  return num.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
};

// === HELPER MISURE PNEUMATICI ===
// Estrae i 3 numeri chiave (larghezza, spalla, diametro) da una stringa misura
// Funziona con: 205/55R16, 205/55 R16, 205/55r16, 205-55-16, 2055516, "205 55 16", ecc.
function parseMisura(raw) {
  if (!raw) return null;
  const s = String(raw).toUpperCase().trim();
  // Tentativo 1: pattern standard XXX/YY*ZZ con qualsiasi separatore
  let m = s.match(/(\d{3})\s*[\/\-\.\s]?\s*(\d{2})\s*[\/\-\.\sRZF]*\s*(\d{2})/);
  if (m) {
    return { width: parseInt(m[1]), aspect: parseInt(m[2]), rim: parseInt(m[3]) };
  }
  // Tentativo 2: stringa di soli numeri "2055516" (3+2+2 = 7 cifre)
  const onlyDigits = s.replace(/\D/g, '');
  if (onlyDigits.length === 7) {
    return { width: parseInt(onlyDigits.slice(0, 3)), aspect: parseInt(onlyDigits.slice(3, 5)), rim: parseInt(onlyDigits.slice(5, 7)) };
  }
  // 6 cifre? potrebbe essere XXX/YY/ZZ con larghezza < 200 (es 165/65 R14 → 1656514)
  if (onlyDigits.length === 6) {
    // ambiguo; non risolviamo
    return null;
  }
  return null;
}

// Forma normalizzata univoca per ricerca: solo cifre 7-digit (205551 6)
function normalizeMisuraForSearch(raw) {
  const p = parseMisura(raw);
  if (!p) return String(raw || '').toUpperCase().replace(/\s+/g, '');
  // Padding: width 3 cifre, aspect 2, rim 2
  const w = String(p.width).padStart(3, '0');
  const a = String(p.aspect).padStart(2, '0');
  const r = String(p.rim).padStart(2, '0');
  return w + a + r;
}

// Forma display standard: "205/55 R16"
function formatMisuraDisplay(raw) {
  if (!raw) return '';
  const s = String(raw).toUpperCase().trim();
  const p = parseMisura(s);
  if (!p) return s;
  const base = `${p.width}/${p.aspect} R${p.rim}`;
  // Mantengo eventuali indicatori extra dopo la misura (es. 91V, XL, *, 87H ecc.)
  // Cerco quello che sta dopo l'ultimo numero del rim
  const rimStr = String(p.rim);
  const idxAfter = s.lastIndexOf(rimStr);
  if (idxAfter >= 0) {
    let extra = s.substring(idxAfter + rimStr.length).trim();
    // Pulisco caratteri di separazione iniziali
    extra = extra.replace(/^[\s\-\/]+/, '').trim();
    if (extra && extra.length <= 12) {
      return base + ' ' + extra;
    }
  }
  return base;
}

// === COMPONENTI SIMULATORE ===
function SimInputGroup({ title, children }) {
  return (
    <div className="sim-group">
      <div className="sim-group-title">{title}</div>
      <div className="sim-group-body">{children}</div>
    </div>
  );
}

function SimInput({ label, value, baseline, step, onChange, unit, hint }) {
  const changed = Math.abs((parseFloat(value) || 0) - (parseFloat(baseline) || 0)) > 0.00001;
  const higher = (parseFloat(value) || 0) > (parseFloat(baseline) || 0);
  return (
    <div className={`sim-input-row ${changed ? (higher ? 'changed-up' : 'changed-down') : ''}`}>
      <div className="sim-input-label">
        <span>{label}</span>
        {hint && <span className="sim-hint">{hint}</span>}
      </div>
      <div className="sim-input-ctrl">
        <input type="number" step={step} value={value} onChange={e => onChange(parseFloat(e.target.value) || 0)} className="sim-input" />
        {unit && <span className="sim-unit">{unit}</span>}
      </div>
      {changed && (
        <div className="sim-input-diff">
          <span className="sim-input-baseline">era: {_fmtE(baseline)}{unit}</span>
          <span className={`sim-input-arrow ${higher ? 'up' : 'down'}`}>
            {higher ? '▲' : '▼'} {_fmtE(Math.abs((parseFloat(value) || 0) - (parseFloat(baseline) || 0)))}
          </span>
        </div>
      )}
    </div>
  );
}

function SimFormula({ label, formula, resultBase, resultSim, highlight, big }) {
  const diff = (resultSim || 0) - (resultBase || 0);
  const changed = Math.abs(diff) > 0.00001;
  const cls = diff < -0.001 ? 'better' : diff > 0.001 ? 'worse' : 'same';
  return (
    <div className={`sim-formula ${highlight ? 'highlight' : ''} ${big ? 'big' : ''}`}>
      <div className="sim-formula-head">
        <span className="sim-formula-label">{label}</span>
        <span className="sim-formula-value">
          {changed && <span className="sim-formula-base">era € {_fmtE(resultBase)}</span>}
          <span className={`sim-formula-sim ${cls}`}>€ {_fmtE(resultSim)}</span>
          {changed && <span className={`sim-formula-diff ${cls}`}>{diff >= 0 ? '+' : ''}{_fmtE(diff)}</span>}
        </span>
      </div>
      {formula && <div className="sim-formula-expr">{formula}</div>}
    </div>
  );
}

function SimChart({ scom, baselineScom }) {
  if (!scom) return null;
  // Componenti del costo da mostrare nel grafico
  const components = [
    { label: 'FOB (USD→EUR)', sim: scom.fobEur, base: baselineScom.fobEur, color: '#1976d2' },
    { label: 'Nolo marittimo', sim: scom.noloPerPezzo, base: baselineScom.noloPerPezzo, color: '#0288d1' },
    { label: 'Aggiust. (v.45)', sim: scom.aggPerPezzo, base: baselineScom.aggPerPezzo, color: '#00acc1' },
    { label: 'Dazio A00', sim: scom.dazio, base: baselineScom.dazio, color: '#d32f2f' },
    { label: 'Antidumping A30', sim: scom.antidumping, base: baselineScom.antidumping, color: '#b71c1c' },
    { label: '9AJ', sim: scom.tassePerPezzo, base: baselineScom.tassePerPezzo, color: '#7b1fa2' },
    { label: 'IVA B00', sim: scom.iva, base: baselineScom.iva, color: '#f57c00' },
    { label: 'Extra nolo (art.74)', sim: scom.extraNoloPerPezzo, base: baselineScom.extraNoloPerPezzo, color: '#0097a7' },
    { label: 'Servizi + IVA', sim: scom.serviziIvaPerPezzo, base: baselineScom.serviziIvaPerPezzo, color: '#388e3c' },
    { label: 'Commissioni', sim: scom.commissioniPerPezzo, base: baselineScom.commissioniPerPezzo, color: '#5d4037' },
    { label: 'PFU', sim: scom.pfuPezzo, base: baselineScom.pfuPezzo, color: '#689f38' }
  ];
  const maxVal = Math.max(...components.map(c => Math.max(c.sim, c.base)), 0.01);
  const totSim = scom.costoFinale;
  return (
    <div className="sim-chart">
      {components.map((c, i) => {
        if (c.sim < 0.001 && c.base < 0.001) return null;
        const wBase = (c.base / maxVal * 100);
        const wSim = (c.sim / maxVal * 100);
        const pctTot = totSim > 0 ? (c.sim / totSim * 100) : 0;
        const changed = Math.abs(c.sim - c.base) > 0.001;
        return (
          <div key={i} className="sim-chart-row">
            <div className="sim-chart-label">
              <span className="sim-chart-dot" style={{ background: c.color }}></span>
              {c.label}
              <span className="sim-chart-pct">{pctTot.toFixed(1)}%</span>
            </div>
            <div className="sim-chart-bars">
              {changed && <div className="sim-chart-bar baseline-bar" style={{ width: `${wBase}%` }} title={`Baseline: €${_fmtE(c.base)}`}></div>}
              <div className="sim-chart-bar sim-bar" style={{ width: `${wSim}%`, background: c.color }} title={`Simulato: €${_fmtE(c.sim)}`}></div>
            </div>
            <div className="sim-chart-val">
              €{_fmtE(c.sim)}
              {changed && <span className={`sim-chart-diff ${c.sim > c.base ? 'worse' : 'better'}`}>
                {c.sim > c.base ? '▲' : '▼'}{_fmtE(Math.abs(c.sim - c.base))}
              </span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function GestionaleImportazioni() {
  // ===== STATO BASE =====
  const [suppliers, setSuppliers] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [selectedItems, setSelectedItems] = useState([]);
  const [bolle, setBolle] = useState([]); // bolle doganali Cina
  const [exchangeRate, setExchangeRate] = useState(0.92);
  const [loading, setLoading] = useState(true);

  // ===== IMPORT EUROPA =====
  const [importStep, setImportStep] = useState('idle');
  const [rawData, setRawData] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({ marca: '', modello: '', misura: '', prezzo: '', qty: '', currency: 'EUR' });
  const [supplierName, setSupplierName] = useState('');
  const [pfuValue, setPfuValue] = useState('');
  const [trasportoValue, setTrasportoValue] = useState('');
  const [qtyValue, setQtyValue] = useState('');
  const [fileName, setFileName] = useState('');
  const [importMode, setImportMode] = useState('europa'); // europa | cina

  // ===== IMPORT CINA (bolla doganale) =====
  // Preset nolo Savino Del Bene (aggiornati Apr 2026, validità 01/05-14/05)
  const NOLO_PRESETS = {
    'hcm_20': { label: 'HoChiMin 1×20\' BOX', noloMare: 2750, fuelSurcharge: 52, ics2Usd: 35, ecaSurcharge: 15 },
    'hcm_40': { label: 'HoChiMin 1×40\' HC',  noloMare: 3700, fuelSurcharge: 104, ics2Usd: 35, ecaSurcharge: 15 },
    'cn_20':  { label: 'Cina base 1×20\' BOX', noloMare: 2650, fuelSurcharge: 52, ics2Usd: 35, ecaSurcharge: 15 },
    'cn_40':  { label: 'Cina base 1×40\' HC',  noloMare: 3550, fuelSurcharge: 104, ics2Usd: 35, ecaSurcharge: 15 }
  };
  // Costi fissi Savino Del Bene (EUR)
  const COSTI_SDB = {
    thcSbarco: 210,         // THC sbarco container EUR
    addizionaliCompMar: 130, // Addizionali Compagnia Marittima Catania
    deliveryOrder: 70,       // Svincolo polizza
    doganaImport: 95,        // Sdoganamento per fornitore
    trasportoInterno: 315,   // Augusta->Catania
    fuelTrasportoPct: 10     // +10% fuel sul trasporto interno
  };

  const [chinaParams, setChinaParams] = useState({
    // Tassi
    tassoEurUsd: 1.1787, // EUR/USD come da bolla (1 USD = 1/1.1787 EUR)
    qtyTotale: 0,
    // Nolo USD
    noloMare: 0, ecaSurcharge: 0, ics2Usd: 0, localChargeUsd: 0,
    // Extra nolo EUR (art 74)
    costiSbarco: 0, doganaImport: 0, fuelSurcharge: 0,
    ecaEur: 0, ics2Eur: 0, localChargeEur: 0,
    // Addizionali separate (Compagnia Marittima)
    addizionaliCompMar: 0,
    // Servizi con IVA 22%
    deliveryOrder: 0, trasportoInterno: 0, ivaSpedizioniere: 0,
    // Fuel trasporto interno in %
    fuelTrasportoPct: 0,
    // Fisse
    commissioni: 0,
    // 9AJ: è un diritto fisso calcolato su "unità 9AJ" (es. 4 unità x 1,0908 = 4,36 €)
    // Nel DAU di riferimento: 4 unità supplementari 9AJ (non coincide con il numero di pneumatici)
    dirittoDoganale9AJ: 4.36, unita9AJ: 4,
    // Aggiustamento (voce 45 DAU) - es. 5,00 € fisso
    aggiustamento: 5,
    // Aliquote
    dazioPct: 4.5, ivaPct: 22, antidumpingPct: 0,
    // PFU per fascia
    pfuFino7: 1.95, pfu7_15: 2.9, pfu15_30: 3.7, pfu30_60: 6.35, pfuOltre60: 13.2,
    // Markup
    markup: 1.45,
    // Dati spedizione
    fornitore: '', indirizzoFornitore: 'ROOM 2206, BAI TONG BUILDING - QINGDAO CITY',
    fattura: '', portoImbarco: 'QINGDAO', portoSbarco: 'AUGUSTA',
    nave: '', container: '', incoterm: 'FOB', dataSpedizione: '',
    importatore: 'VENTURA NICOLA', importatorePiva: 'IT05495120874',
    importatoreIndirizzo: 'VIA ZIA LISA 374 - 95121 CATANIA (CT)',
    importatoreAttivita: 'RIPARAZ.NE E SOST.NE PNEUMATICI',
    spedizioniere: 'Savino Del Bene',
    dichiarante: 'DIOLOSA\' ROSSELLA', dichiaranteCf: 'ITDLSRSL74D55C351A',
    dichiaranteIndirizzo: 'VIA DUSMET, 131 - 95131 CATANIA',
    codiceTaric: '40111000 00',
    // Pesi (voce 35 e 38)
    massaLorda: 0, massaNetta: 0,
    // Nr riferimento (voce 7)
    nrRiferimento: '',
    // Documento precedente (voce 40)
    docPrecedente: '',
    // Menzioni speciali (voce 44) - documenti certificati autorizzazioni
    menzioniSpeciali: 'Y923 - CN\nY160\n39YY - ITAUG\nN380 - CN\nN705 - CN',
    // Regime doganale (voce 37) e preferenze (voce 36)
    regime: '4000', preferenze: '100',
    // Ufficio dogana
    ufficioDogana: 'IT099101',
    localizzazioneMerci: '-FE',
    // Dilazione pagamento (voce 48)
    dilazionePagamento: 'ITDPOIT057000-2018-DVM14567'
  });
  const [chinaItems, setChinaItems] = useState([]); // [{modello, misura, qty, prezzoUsd, pfuFascia}]
  const [chinaStep, setChinaStep] = useState('upload'); // upload | mapping | parameters | preview
  const [chinaMapping, setChinaMapping] = useState({ marca: '', modello: '', misura: '', prezzo: '', qty: '' });
  const [chinaRawData, setChinaRawData] = useState([]);
  const [chinaHeaders, setChinaHeaders] = useState([]);
  const [chinaFileName, setChinaFileName] = useState('');
  const [chinaFornitoreSelected, setChinaFornitoreSelected] = useState('');
  const [currentBolla, setCurrentBolla] = useState(null); // bolla in preview
  const [bollaMode, setBollaMode] = useState('file'); // 'file' = import listino | 'selection' = bolla dalla selezione
  const [noloPreset, setNoloPreset] = useState('hcm_40'); // preset nolo attivo
  const [updateCatalogOnConfirm, setUpdateCatalogOnConfirm] = useState(true); // aggiorna prezzi articoli selezionati con costi reali

  // ===== RICERCA / FILTRI =====
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('');
  const [filterMarca, setFilterMarca] = useState('');
  const [filterOrigine, setFilterOrigine] = useState(''); // '' | 'EU' | 'CN'
  const [sortBy, setSortBy] = useState({ field: 'marca', dir: 'asc' });
  const [activeSection, setActiveSection] = useState('catalogo');
  const [compactView, setCompactView] = useState(false); // vista compatta catalogo
  const [compareMisuraQuery, setCompareMisuraQuery] = useState(''); // ricerca misura nel confronto
  const [openMenu, setOpenMenu] = useState(null); // 'archivio'|'modifica'|'visualizza'|'strumenti'|'help'
  const [showGuideModal, setShowGuideModal] = useState(false);
  const paramsFileInputRef = useRef(null);
  // Tab fornitore attiva nel catalogo: 'all' | 'eu' | supplier.id
  const [activeCatalogTab, setActiveCatalogTab] = useState('all');
  // Parametri per-fornitore (override dei globali chinaParams)
  // Struttura: { [supplierId]: { useGlobal: bool, params: {...} } }
  const [supplierParams, setSupplierParams] = useState({});

  // ===== LISTINI MISURE =====
  // Struttura: { id, name, items: [{ misura, percentuale }], qtyTotale, createdAt }
  const [sizeLists, setSizeLists] = useState([]);
  const [activeSizeListId, setActiveSizeListId] = useState(null);
  const [showSizeListBuilder, setShowSizeListBuilder] = useState(false);
  const [editingSizeList, setEditingSizeList] = useState(null);
  // Colonne nascoste nel catalogo
  const [hiddenColumns, setHiddenColumns] = useState([]);
  const [columnMenuFor, setColumnMenuFor] = useState(null);

  // ===== EDIT ARTICOLO =====
  // Modale completa per modifica articolo
  const [editingItem, setEditingItem] = useState(null);
  // Inline editing: { itemId, field } per evidenziare la cella in editing
  const [inlineEdit, setInlineEdit] = useState(null);

  // ===== PANNELLO CONFRONTO LATERALE =====
  const [comparePanelOpen, setComparePanelOpen] = useState(false);
  const [compareItemIds, setCompareItemIds] = useState([]); // array di item.id agganciati

  // ===== SIMULAZIONE SELEZIONE =====
  // Parametri attivi nella simulazione della selezione (override su quelli del fornitore)
  const [selSimParams, setSelSimParams] = useState(null); // null = usa fornitore
  // Scenari salvati per la sessione: [{ name, params, totale, savedAt }]
  const [selScenarios, setSelScenarios] = useState([]);
  // Pannello simulazione aperto/chiuso
  const [selSimPanelOpen, setSelSimPanelOpen] = useState(false);

  // ===== SIMULATORE WHAT-IF =====
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [simulatorTarget, setSimulatorTarget] = useState(null); // { type: 'item'|'bolla', data: ... }
  const [simParams, setSimParams] = useState(null); // parametri modificati
  const [simBaseline, setSimBaseline] = useState(null); // parametri originali (per confronto)

  // Funzione PURA: calcola tutte le componenti di un pneumatico dato un set di parametri
  // Ritorna un oggetto con tutti i "passaggi" del calcolo, formule incluse
  const calcolaScomposizione = (item, params, contestoBolla = null) => {
    // item: { prezzoUsd, qty, pfuFascia }
    // params: { tassoEurUsd, noloMare, ecaSurcharge, ics2Usd, localChargeUsd,
    //          costiSbarco, addizionaliCompMar, doganaImport, fuelSurcharge, ecaEur, ics2Eur, localChargeEur,
    //          deliveryOrder, trasportoInterno, fuelTrasportoPct, ivaSpedizioniere,
    //          commissioni, aggiustamento, unita9AJ, dirittoDoganale9AJ,
    //          dazioPct, ivaPct, antidumpingPct, markup,
    //          pfuFino7, pfu7_15, pfu15_30, pfu30_60, pfuOltre60,
    //          qtyTotale }
    // contestoBolla: se presente, usa qtyTotale della bolla per ripartizione, altrimenti usa item.qty o 1
    const qtyTot = contestoBolla?.qtyTot || params.qtyTotale || item.qty || 1;

    // 1) FOB
    const fobUsd = parseFloat(item.prezzoUsd) || 0;
    const fobEur = fobUsd / (parseFloat(params.tassoEurUsd) || 1);

    // 2) Nolo USD → EUR per pezzo
    const noloTotUsd = (parseFloat(params.noloMare) || 0) + (parseFloat(params.ecaSurcharge) || 0) + (parseFloat(params.ics2Usd) || 0) + (parseFloat(params.localChargeUsd) || 0);
    const noloTotEur = noloTotUsd / (parseFloat(params.tassoEurUsd) || 1);
    const noloPerPezzo = noloTotEur / qtyTot;

    // 3) Aggiustamento per pezzo
    const aggTot = parseFloat(params.aggiustamento) || 0;
    const aggPerPezzo = aggTot / qtyTot;

    // 4) Valore statistico (CIF + aggiust)
    const valoreStatistico = fobEur + noloPerPezzo + aggPerPezzo;

    // 5) Dazio + antidumping
    const dazio = valoreStatistico * (parseFloat(params.dazioPct) || 0) / 100;
    const antidumping = valoreStatistico * (parseFloat(params.antidumpingPct) || 0) / 100;

    // 6) 9AJ per pezzo
    const dirittoTotale9AJ = parseFloat(params.dirittoDoganale9AJ) || ((parseFloat(params.unita9AJ) || 0) * 1.0908);
    const tassePerPezzo = dirittoTotale9AJ / qtyTot;

    // 7) Base IVA e IVA
    const baseIva = valoreStatistico + dazio + antidumping + tassePerPezzo;
    const iva = baseIva * (parseFloat(params.ivaPct) || 0) / 100;

    // 8) Extra nolo (art.74)
    const extraNoloTot = (parseFloat(params.costiSbarco) || 0) + (parseFloat(params.addizionaliCompMar) || 0) + (parseFloat(params.doganaImport) || 0) + (parseFloat(params.fuelSurcharge) || 0) + (parseFloat(params.ecaEur) || 0) + (parseFloat(params.ics2Eur) || 0) + (parseFloat(params.localChargeEur) || 0);
    const extraNoloPerPezzo = extraNoloTot / qtyTot;

    // 9) Servizi con IVA 22%
    const trasportoBase = parseFloat(params.trasportoInterno) || 0;
    const fuelTrasporto = trasportoBase * (parseFloat(params.fuelTrasportoPct) || 0) / 100;
    const serviziIvaTot = (parseFloat(params.deliveryOrder) || 0) + trasportoBase + fuelTrasporto + (parseFloat(params.ivaSpedizioniere) || 0);
    const serviziIvaPerPezzo = serviziIvaTot / qtyTot;

    // 10) Commissioni per pezzo
    const commissioniPerPezzo = (parseFloat(params.commissioni) || 0) / qtyTot;

    // 11) PFU
    const pfuMap = { fino7: params.pfuFino7, '7_15': params.pfu7_15, '15_30': params.pfu15_30, '30_60': params.pfu30_60, oltre60: params.pfuOltre60 };
    const pfuPezzo = parseFloat(pfuMap[item.pfuFascia]) || parseFloat(params.pfu7_15) || 0;

    // 12) Costo finale
    const costoFinale = valoreStatistico + dazio + antidumping + tassePerPezzo + iva + extraNoloPerPezzo + serviziIvaPerPezzo + commissioniPerPezzo + pfuPezzo;
    const prezzoVendita = costoFinale * (parseFloat(params.markup) || 1);

    return {
      // Input
      fobUsd, qtyTot,
      // Passo 1: conversione
      tassoEurUsd: params.tassoEurUsd, fobEur,
      // Passo 2: nolo
      noloTotUsd, noloTotEur, noloPerPezzo,
      // Passo 3: aggiustamento
      aggTot, aggPerPezzo,
      // Passo 4: valore statistico
      valoreStatistico,
      // Passo 5: dazi
      dazioPct: params.dazioPct, dazio,
      antidumpingPct: params.antidumpingPct, antidumping,
      // Passo 6: 9AJ
      unita9AJ: params.unita9AJ, dirittoTotale9AJ, tassePerPezzo,
      // Passo 7: IVA
      baseIva, ivaPct: params.ivaPct, iva,
      // Passo 8: extra nolo
      extraNoloTot, extraNoloPerPezzo,
      // Passo 9: servizi IVA
      trasportoBase, fuelTrasporto, fuelTrasportoPct: params.fuelTrasportoPct,
      serviziIvaTot, serviziIvaPerPezzo,
      // Passo 10: commissioni
      commissioniPerPezzo,
      // Passo 11: PFU
      pfuPezzo, pfuFascia: item.pfuFascia,
      // Output finale
      costoFinale, markup: params.markup, prezzoVendita
    };
  };

  // Apre il simulatore per un articolo del catalogo
  const openSimulatorFromItem = (item) => {
    // Costruisco i parametri baseline dai dati attuali + valori di default chinaParams
    // Se l'articolo ha origine CN, uso chinaParams; altrimenti uso dati "europei"
    let baselineParams;
    let simItem;
    if (item.origine === 'CN') {
      // Derivo prezzoUsd dal prezzoOriginale
      simItem = {
        prezzoUsd: item.prezzoOriginale || (item.prezzoEur * chinaParams.tassoEurUsd),
        qty: item.qtyRichiesta || 1,
        pfuFascia: item.pfuFascia || '7_15'
      };
      baselineParams = { ...chinaParams, qtyTotale: chinaParams.qtyTotale || simItem.qty };
    } else {
      // Articolo europeo: creo params compatibili con pneumatico singolo
      simItem = {
        prezzoUsd: item.prezzoOriginale, // in realtà è EUR ma la formula ci lavora uguale
        qty: item.qtyRichiesta || 1,
        pfuFascia: item.pfuFascia || '7_15'
      };
      baselineParams = {
        ...chinaParams,
        tassoEurUsd: 1, // EU = già EUR
        // azzero tutti i costi cinesi per EU
        noloMare: 0, ecaSurcharge: 0, ics2Usd: 0, localChargeUsd: 0,
        costiSbarco: 0, addizionaliCompMar: 0, doganaImport: 0, fuelSurcharge: 0,
        ecaEur: 0, ics2Eur: 0, localChargeEur: 0, deliveryOrder: 0,
        trasportoInterno: 0, fuelTrasportoPct: 0, ivaSpedizioniere: 0,
        commissioni: 0, aggiustamento: 0, unita9AJ: 0, dirittoDoganale9AJ: 0,
        dazioPct: 0, ivaPct: 22, antidumpingPct: 0,
        qtyTotale: simItem.qty
      };
    }
    setSimulatorTarget({ type: 'item', data: item, simItem });
    setSimBaseline({ ...baselineParams });
    setSimParams({ ...baselineParams });
    setSimulatorOpen(true);
  };

  // Apre il simulatore per una bolla intera (usa il primo articolo come campione)
  const openSimulatorFromBolla = (bolla) => {
    if (!bolla.calcolo || !bolla.calcolo.righe || bolla.calcolo.righe.length === 0) {
      alert('Bolla senza articoli');
      return;
    }
    const firstRiga = bolla.calcolo.righe[0];
    const simItem = {
      prezzoUsd: firstRiga.prezzoUsd,
      qty: firstRiga.qty,
      pfuFascia: firstRiga.pfuFascia
    };
    const baselineParams = { ...bolla.params, qtyTotale: bolla.calcolo.qtyTot };
    setSimulatorTarget({ type: 'bolla', data: bolla, simItem });
    setSimBaseline({ ...baselineParams });
    setSimParams({ ...baselineParams });
    setSimulatorOpen(true);
  };

  const closeSimulator = () => {
    setSimulatorOpen(false);
    setSimulatorTarget(null);
    setSimParams(null);
    setSimBaseline(null);
  };

  // Reset: riporta i simParams allo stato baseline
  const resetSimulator = () => {
    if (simBaseline) setSimParams({ ...simBaseline });
  };

  // Salva le modifiche del simulatore nei parametri reali
  const saveSimulatorChanges = () => {
    if (!simParams || !simulatorTarget) return;
    if (simulatorTarget.type === 'item') {
      // Aggiorno chinaParams con i nuovi valori (per articoli CN)
      if (simulatorTarget.data.origine === 'CN') {
        setChinaParams(prev => ({ ...prev, ...simParams }));
        alert('Parametri salvati in "Import Cina". Le future bolle useranno questi valori.');
      }
    } else if (simulatorTarget.type === 'bolla') {
      // Aggiorno la bolla specifica con i nuovi parametri e ricalcolo
      const bolla = simulatorTarget.data;
      // Ricalcolo la bolla intera con i nuovi parametri
      const newRighe = bolla.calcolo.righe.map(r => {
        const sc = calcolaScomposizione(
          { prezzoUsd: r.prezzoUsd, qty: r.qty, pfuFascia: r.pfuFascia },
          simParams,
          { qtyTot: bolla.calcolo.qtyTot }
        );
        return {
          ...r,
          cifPerPezzo: sc.valoreStatistico,
          dazioPerPezzo: sc.dazio,
          antidumpingPerPezzo: sc.antidumping,
          baseIva: sc.baseIva,
          ivaPerPezzo: sc.iva,
          extraNoloPerPezzo: sc.extraNoloPerPezzo,
          serviziIvaPerPezzo: sc.serviziIvaPerPezzo,
          commissioniPerPezzo: sc.commissioniPerPezzo,
          tasseFissePerPezzo: sc.tassePerPezzo,
          aggiustamentoPerPezzo: sc.aggPerPezzo,
          pfuPezzo: sc.pfuPezzo,
          costoFinale: sc.costoFinale,
          prezzoVendita: sc.prezzoVendita,
          cifTot: sc.valoreStatistico * r.qty,
          dazioTot: sc.dazio * r.qty,
          ivaTot: sc.iva * r.qty
        };
      });
      // Ricalcolo aggregati bolla
      const newCalcolo = {
        ...bolla.calcolo,
        righe: newRighe,
        valoreStatistico: newRighe.reduce((s, r) => s + r.cifTot, 0),
        dazioTotale: newRighe.reduce((s, r) => s + r.dazioTot, 0),
        antidumpingTotale: newRighe.reduce((s, r) => s + r.antidumpingPerPezzo * r.qty, 0),
        ivaTotale: newRighe.reduce((s, r) => s + r.ivaTot, 0),
        costoTotaleImport: newRighe.reduce((s, r) => s + r.costoFinale * r.qty, 0),
        dirittoTotale9AJ: parseFloat(simParams.dirittoDoganale9AJ) || 0
      };
      newCalcolo.totaleImposizioni = newCalcolo.dazioTotale + newCalcolo.antidumpingTotale + newCalcolo.dirittoTotale9AJ + newCalcolo.ivaTotale;
      // Aggiorno lista bolle
      setBolle(prev => prev.map(b => b.id === bolla.id ? { ...b, params: { ...simParams }, calcolo: newCalcolo } : b));
      alert('Bolla aggiornata con i nuovi parametri');
    }
    closeSimulator();
  };

  const fileInputRef = useRef(null);
  const chinaFileInputRef = useRef(null);

  // ===== PERSISTENZA =====
  useEffect(() => {
    (async () => {
      try { const s = await window.storage.get('suppliers'); if (s) setSuppliers(JSON.parse(s.value)); } catch (e) {}
      try { const i = await window.storage.get('allItems'); if (i) setAllItems(JSON.parse(i.value)); } catch (e) {}
      try { const sel = await window.storage.get('selectedItems'); if (sel) setSelectedItems(JSON.parse(sel.value)); } catch (e) {}
      try { const ex = await window.storage.get('exchangeRate'); if (ex) setExchangeRate(parseFloat(ex.value)); } catch (e) {}
      try { const b = await window.storage.get('bolle'); if (b) setBolle(JSON.parse(b.value)); } catch (e) {}
      try { const cp = await window.storage.get('chinaParams'); if (cp) setChinaParams(prev => ({ ...prev, ...JSON.parse(cp.value) })); } catch (e) {}
      try { const cv = await window.storage.get('compactView'); if (cv) setCompactView(cv.value === 'true'); } catch (e) {}
      try { const sp = await window.storage.get('supplierParams'); if (sp) setSupplierParams(JSON.parse(sp.value)); } catch (e) {}
      try { const sl = await window.storage.get('sizeLists'); if (sl) setSizeLists(JSON.parse(sl.value)); } catch (e) {}
      try { const al = await window.storage.get('activeSizeListId'); if (al) setActiveSizeListId(al.value === 'null' ? null : al.value); } catch (e) {}
      try { const hc = await window.storage.get('hiddenColumns'); if (hc) setHiddenColumns(JSON.parse(hc.value)); } catch (e) {}
      try { const ci = await window.storage.get('compareItemIds'); if (ci) setCompareItemIds(JSON.parse(ci.value)); } catch (e) {}
      setLoading(false);
    })();
  }, []);

  useEffect(() => { if (!loading) window.storage.set('suppliers', JSON.stringify(suppliers)).catch(() => {}); }, [suppliers, loading]);
  useEffect(() => { if (!loading) window.storage.set('allItems', JSON.stringify(allItems)).catch(() => {}); }, [allItems, loading]);
  useEffect(() => { if (!loading) window.storage.set('selectedItems', JSON.stringify(selectedItems)).catch(() => {}); }, [selectedItems, loading]);
  useEffect(() => { if (!loading) window.storage.set('exchangeRate', String(exchangeRate)).catch(() => {}); }, [exchangeRate, loading]);
  useEffect(() => { if (!loading) window.storage.set('bolle', JSON.stringify(bolle)).catch(() => {}); }, [bolle, loading]);
  useEffect(() => { if (!loading) window.storage.set('chinaParams', JSON.stringify(chinaParams)).catch(() => {}); }, [chinaParams, loading]);
  useEffect(() => { if (!loading) window.storage.set('compactView', String(compactView)).catch(() => {}); }, [compactView, loading]);
  useEffect(() => { if (!loading) window.storage.set('supplierParams', JSON.stringify(supplierParams)).catch(() => {}); }, [supplierParams, loading]);
  useEffect(() => { if (!loading) window.storage.set('sizeLists', JSON.stringify(sizeLists)).catch(() => {}); }, [sizeLists, loading]);
  useEffect(() => { if (!loading) window.storage.set('activeSizeListId', String(activeSizeListId)).catch(() => {}); }, [activeSizeListId, loading]);
  useEffect(() => { if (!loading) window.storage.set('hiddenColumns', JSON.stringify(hiddenColumns)).catch(() => {}); }, [hiddenColumns, loading]);
  useEffect(() => { if (!loading) window.storage.set('compareItemIds', JSON.stringify(compareItemIds)).catch(() => {}); }, [compareItemIds, loading]);

  // Auto-ricalcola 9AJ quando cambiano le unità (solo se le unità sono > 0)
  useEffect(() => {
    const u = parseInt(chinaParams.unita9AJ) || 0;
    if (u > 0) {
      const calc = Math.round(u * 1.0908 * 100) / 100;
      if (Math.abs(calc - parseFloat(chinaParams.dirittoDoganale9AJ)) > 0.005) {
        setChinaParams(prev => ({ ...prev, dirittoDoganale9AJ: calc }));
      }
    }
  }, [chinaParams.unita9AJ]);

  // ===================================================================
  // IMPORT EUROPA
  // ===================================================================
  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });
      if (json.length === 0) { alert('Il file è vuoto'); return; }
      const cleaned = json.filter(row => row.some(c => String(c).trim() !== ''));
      if (cleaned.length === 0) { alert('Nessun dato trovato'); return; }
      const headerRow = cleaned[0].map((h, i) => String(h || `Colonna ${i + 1}`));
      setHeaders(headerRow);
      setRawData(cleaned);
      setSupplierName(file.name.replace(/\.(xlsx|xls|csv)$/i, ''));
      setImportStep('preview');
    } catch (err) {
      alert('Errore nel leggere il file: ' + err.message);
    }
  };

  const confirmImport = () => {
    if (!mapping.marca || !mapping.prezzo || !supplierName.trim()) {
      alert('Compilare: Ragione sociale, Colonna Marca e Colonna Prezzo');
      return;
    }
    const pfu = parseFloat(pfuValue) || 0;
    const trasporto = parseFloat(trasportoValue) || 0;
    const qty = parseFloat(qtyValue) || 0;
    const trasportoPerUnit = qty > 0 ? trasporto / qty : 0;
    const colIdx = (c) => headers.indexOf(c);
    const mIdx = colIdx(mapping.marca), modIdx = colIdx(mapping.modello);
    const misIdx = colIdx(mapping.misura), prIdx = colIdx(mapping.prezzo);
    const supplierId = 'sup_' + Date.now();
    const items = [];

    for (let i = 1; i < rawData.length; i++) {
      const row = rawData[i];
      const rawPrezzo = row[prIdx];
      const prezzoNum = parseFloat(String(rawPrezzo).replace(/[^\d.,\-]/g, '').replace(',', '.'));
      if (isNaN(prezzoNum) || prezzoNum <= 0) continue;
      const prezzoEur = mapping.currency === 'USD' ? prezzoNum * exchangeRate : prezzoNum;
      const prezzoFinale = prezzoEur + pfu + trasportoPerUnit;
      const misuraRaw = misIdx >= 0 ? String(row[misIdx] || '').trim() : '';
      const misuraDisplay = formatMisuraDisplay(misuraRaw);
      const misuraNorm = normalizeMisuraForSearch(misuraRaw);
      items.push({
        id: supplierId + '_' + i, supplierId, supplierName: supplierName.trim(),
        origine: 'EU',
        marca: String(row[mIdx] || '').trim(),
        modello: modIdx >= 0 ? String(row[modIdx] || '').trim() : '',
        misura: misuraDisplay,
        misuraNorm,
        prezzoOriginale: prezzoNum, currency: mapping.currency,
        prezzoEur: Math.round(prezzoEur * 100) / 100,
        pfu, trasportoPerUnit: Math.round(trasportoPerUnit * 100) / 100,
        prezzoFinale: Math.round(prezzoFinale * 100) / 100,
        qtyDisponibile: qty || 0
      });
    }

    if (items.length === 0) { alert('Nessuna riga valida trovata'); return; }
    setSuppliers([...suppliers, {
      id: supplierId, name: supplierName.trim(), origine: 'EU',
      importDate: new Date().toISOString(), itemCount: items.length,
      pfu, trasporto, qty, currency: mapping.currency
    }]);
    setAllItems([...allItems, ...items]);
    cancelImport();
  };

  const cancelImport = () => {
    setImportStep('idle'); setRawData([]); setHeaders([]);
    setMapping({ marca: '', modello: '', misura: '', prezzo: '', qty: '', currency: 'EUR' });
    setSupplierName(''); setPfuValue(''); setTrasportoValue(''); setQtyValue(''); setFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ===================================================================
  // IMPORT CINA - BOLLA DOGANALE
  // ===================================================================
  const handleChinaFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setChinaFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      // Cerca il foglio con i dati articoli (può essere "Calcolo Costi" o il primo)
      let targetSheet = workbook.SheetNames[0];
      for (const name of workbook.SheetNames) {
        if (name.toLowerCase().includes('calcolo') || name.toLowerCase().includes('costi') || name.toLowerCase().includes('articoli')) {
          targetSheet = name; break;
        }
      }
      const sheet = workbook.Sheets[targetSheet];
      const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (json.length === 0) { alert('Foglio vuoto'); return; }
      const cleaned = json.filter(row => row.some(c => String(c).trim() !== ''));
      // Trova la riga di intestazione (cerca riga con "Modello" o "Misura")
      let headerRowIdx = 0;
      for (let i = 0; i < Math.min(10, cleaned.length); i++) {
        const rowStr = cleaned[i].map(c => String(c).toLowerCase()).join('|');
        if (rowStr.includes('modello') || rowStr.includes('misura') || rowStr.includes('marca')) {
          headerRowIdx = i; break;
        }
      }
      const headerRow = cleaned[headerRowIdx].map((h, i) => String(h || `Colonna ${i + 1}`));
      setChinaHeaders(headerRow);
      setChinaRawData(cleaned.slice(headerRowIdx));
      // Pre-setta nome fornitore dal file
      if (!chinaParams.fornitore) {
        setChinaParams(prev => ({ ...prev, fornitore: file.name.replace(/\.(xlsx|xls|csv)$/i, '').toUpperCase() }));
      }
      setChinaStep('mapping');
    } catch (err) {
      alert('Errore: ' + err.message);
    }
  };

  const confirmChinaMapping = () => {
    if (!chinaMapping.prezzo || !chinaMapping.qty) {
      alert('Mappare almeno Prezzo USD e Quantità');
      return;
    }
    if (!chinaParams.fornitore.trim()) {
      alert('Inserire nome fornitore');
      return;
    }
    const colIdx = (c) => chinaHeaders.indexOf(c);
    const brandIdx = colIdx(chinaMapping.marca);
    const modIdx = colIdx(chinaMapping.modello);
    const misIdx = colIdx(chinaMapping.misura);
    const prIdx = colIdx(chinaMapping.prezzo);
    const qtyIdx = colIdx(chinaMapping.qty);

    const items = [];
    let totalQty = 0;
    for (let i = 1; i < chinaRawData.length; i++) {
      const row = chinaRawData[i];
      const rawPrezzo = row[prIdx];
      const rawQty = row[qtyIdx];
      const prezzo = parseFloat(String(rawPrezzo).replace(/[^\d.,\-]/g, '').replace(',', '.'));
      const qty = parseInt(String(rawQty).replace(/[^\d]/g, ''));
      if (isNaN(prezzo) || prezzo <= 0) continue;
      const misura = misIdx >= 0 ? String(row[misIdx] || '').trim() : '';
      // Determina fascia PFU dal diametro (pollici) se riesce a ricavarlo
      let pfuFascia = '7_15';
      const diametroMatch = misura.match(/R(\d+)/i);
      if (diametroMatch) {
        const pollici = parseInt(diametroMatch[1]);
        if (pollici <= 14) pfuFascia = 'fino7';
        else if (pollici <= 17) pfuFascia = '7_15';
        else if (pollici <= 21) pfuFascia = '15_30';
        else pfuFascia = '30_60';
      }
      items.push({
        idx: i,
        marca: brandIdx >= 0 ? String(row[brandIdx] || '').trim() : chinaParams.fornitore,
        modello: modIdx >= 0 ? String(row[modIdx] || '').trim() : '',
        misura, qty: qty || 1, prezzoUsd: prezzo, pfuFascia
      });
      totalQty += (qty || 1);
    }
    if (items.length === 0) { alert('Nessuna riga valida'); return; }
    setChinaItems(items);
    setChinaParams(prev => ({ ...prev, qtyTotale: totalQty }));
    // Salta direttamente al salvataggio nel catalogo (non apre wizard bolla)
    saveChinaListino(items);
  };

  // Salva il listino Cina nel catalogo (prezzo EUR stimato con dazi+IVA+PFU standard)
  const saveChinaListino = (items) => {
    const p = chinaParams;
    const pfuMap = { fino7: p.pfuFino7, '7_15': p.pfu7_15, '15_30': p.pfu15_30, '30_60': p.pfu30_60, oltre60: p.pfuOltre60 };
    // Stima: prezzo EUR = (USD / cambio) + dazio% + IVA% + PFU fascia
    // Nota: questa è una STIMA per il catalogo. Il calcolo reale si fa in bolla con costi accessori noti.
    const supplierId = 'cn_' + Date.now();
    const listino = items.map((item, i) => {
      const pfuPezzo = parseFloat(pfuMap[item.pfuFascia]) || p.pfu7_15;
      const prezzoEurBase = item.prezzoUsd / p.tassoEurUsd;
      const dazioStimato = prezzoEurBase * (p.dazioPct / 100);
      const ivaStimata = (prezzoEurBase + dazioStimato) * (p.ivaPct / 100);
      const prezzoStimato = prezzoEurBase + dazioStimato + ivaStimata + pfuPezzo;
      const misuraDisplay = formatMisuraDisplay(item.misura);
      const misuraNorm = normalizeMisuraForSearch(item.misura);
      return {
        id: supplierId + '_' + i, supplierId, supplierName: p.fornitore,
        origine: 'CN',
        marca: item.marca || p.fornitore,
        modello: item.modello,
        misura: misuraDisplay,
        misuraNorm,
        prezzoOriginale: item.prezzoUsd, currency: 'USD',
        prezzoEur: Math.round(prezzoEurBase * 100) / 100,
        pfu: Math.round(pfuPezzo * 100) / 100,
        trasportoPerUnit: 0,
        dazio: Math.round(dazioStimato * 100) / 100,
        iva: Math.round(ivaStimata * 100) / 100,
        prezzoFinale: Math.round(prezzoStimato * 100) / 100, // STIMA indicativa
        pfuFascia: item.pfuFascia,
        qtyDisponibile: item.qty
      };
    });
    setSuppliers([...suppliers, {
      id: supplierId, name: p.fornitore, origine: 'CN',
      importDate: new Date().toISOString(), itemCount: listino.length,
      currency: 'USD', qty: items.reduce((s, i) => s + i.qty, 0)
    }]);
    setAllItems([...allItems, ...listino]);
    cancelChinaImport();
    setActiveSection('catalogo');
  };

  // === CALCOLI BOLLA DOGANALE ===
  const chinaCalcolo = useMemo(() => {
    if (chinaItems.length === 0) return null;
    const p = chinaParams;
    const qtyTot = p.qtyTotale || chinaItems.reduce((s, i) => s + i.qty, 0);
    if (qtyTot === 0) return null;

    // 1) Valore FOB totale USD
    const fobTotUsd = chinaItems.reduce((s, i) => s + i.prezzoUsd * i.qty, 0);
    const fobTotEur = fobTotUsd / p.tassoEurUsd;

    // 2) Nolo USD totale + per pezzo EUR
    const noloTotUsd = (parseFloat(p.noloMare) || 0) + (parseFloat(p.ecaSurcharge) || 0) + (parseFloat(p.ics2Usd) || 0) + (parseFloat(p.localChargeUsd) || 0);
    const noloTotEur = noloTotUsd / p.tassoEurUsd;
    const noloPerPezzo = noloTotEur / qtyTot;

    // 3) Aggiustamento (voce 45 DAU) - fisso totale ripartito per pezzo
    const aggiustamentoTot = parseFloat(p.aggiustamento) || 0;
    const aggiustamentoPerPezzo = aggiustamentoTot / qtyTot;

    // 4) CIF EUR = FOB EUR + Nolo EUR per pezzo (per ogni gomma)

    // 5) Extra Nolo (art.74 non imponibile IVA) - EUR locali
    // Include: costi sbarco/THC, dogana, fuel mare, ECA/ICS2 EUR, local charge, addizionali compagnia marittima
    const extraNoloTot = (parseFloat(p.costiSbarco) || 0) + (parseFloat(p.doganaImport) || 0) + (parseFloat(p.fuelSurcharge) || 0) + (parseFloat(p.ecaEur) || 0) + (parseFloat(p.ics2Eur) || 0) + (parseFloat(p.localChargeEur) || 0) + (parseFloat(p.addizionaliCompMar) || 0);
    const extraNoloPerPezzo = extraNoloTot / qtyTot;

    // 6) Servizi con IVA 22% (delivery order + trasporto interno + fuel trasporto + iva spedizioniere)
    const trasportoBase = parseFloat(p.trasportoInterno) || 0;
    const fuelTrasportoImporto = trasportoBase * (parseFloat(p.fuelTrasportoPct) || 0) / 100;
    const serviziIvaTot = (parseFloat(p.deliveryOrder) || 0) + trasportoBase + fuelTrasportoImporto + (parseFloat(p.ivaSpedizioniere) || 0);
    const serviziIvaPerPezzo = serviziIvaTot / qtyTot;

    // 7) Commissioni e tasse fisse (9AJ totale ripartito)
    const commissioniPerPezzo = (parseFloat(p.commissioni) || 0) / qtyTot;
    const dirittoTotale9AJ = parseFloat(p.dirittoDoganale9AJ) || 0;
    const tasseFissePerPezzo = dirittoTotale9AJ / qtyTot;

    // 8) Calcolo per ogni articolo
    const righe = chinaItems.map(item => {
      const cifPerPezzoBase = (item.prezzoUsd / p.tassoEurUsd) + noloPerPezzo;
      const cifPerPezzo = cifPerPezzoBase + aggiustamentoPerPezzo; // valore statistico per pezzo
      const dazioPerPezzo = cifPerPezzo * (p.dazioPct / 100);
      const antidumpingPerPezzo = cifPerPezzo * (p.antidumpingPct / 100);
      const baseIva = cifPerPezzo + dazioPerPezzo + antidumpingPerPezzo + tasseFissePerPezzo;
      const ivaPerPezzo = baseIva * (p.ivaPct / 100);

      // PFU in base alla fascia
      const pfuMap = { fino7: p.pfuFino7, '7_15': p.pfu7_15, '15_30': p.pfu15_30, '30_60': p.pfu30_60, oltre60: p.pfuOltre60 };
      const pfuPezzo = parseFloat(pfuMap[item.pfuFascia]) || p.pfu7_15;

      const costoSenzaPfu = cifPerPezzo + dazioPerPezzo + antidumpingPerPezzo + tasseFissePerPezzo + ivaPerPezzo + extraNoloPerPezzo + serviziIvaPerPezzo + commissioniPerPezzo;
      const costoFinale = costoSenzaPfu + pfuPezzo;
      const prezzoVendita = costoFinale * (parseFloat(p.markup) || 1);

      return {
        ...item,
        cifPerPezzo, dazioPerPezzo, antidumpingPerPezzo, baseIva, ivaPerPezzo,
        extraNoloPerPezzo, serviziIvaPerPezzo, commissioniPerPezzo, tasseFissePerPezzo,
        aggiustamentoPerPezzo,
        pfuPezzo, costoSenzaPfu, costoFinale, prezzoVendita,
        // Totali riga
        cifTot: cifPerPezzo * item.qty,
        dazioTot: dazioPerPezzo * item.qty,
        ivaTot: ivaPerPezzo * item.qty
      };
    });

    // 9) Totali bolla
    // Valore statistico = somma CIF per pezzo × qty (già include aggiustamento)
    const valoreStatistico = righe.reduce((s, r) => s + r.cifTot, 0);
    const dazioTotale = righe.reduce((s, r) => s + r.dazioTot, 0);
    const antidumpingTotale = righe.reduce((s, r) => s + r.antidumpingPerPezzo * r.qty, 0);
    const ivaTotale = righe.reduce((s, r) => s + r.ivaTot, 0);
    const totaleImposizioni = dazioTotale + antidumpingTotale + dirittoTotale9AJ + ivaTotale;
    const costoTotaleImport = righe.reduce((s, r) => s + r.costoFinale * r.qty, 0);

    // Prezzo articolo (voce 42) = FOB EUR
    const prezzoArticolo = fobTotEur;

    return {
      qtyTot, fobTotUsd, fobTotEur, noloTotUsd, noloTotEur, noloPerPezzo,
      aggiustamentoTot, aggiustamentoPerPezzo,
      extraNoloTot, extraNoloPerPezzo, serviziIvaTot, serviziIvaPerPezzo,
      fuelTrasportoImporto, trasportoBase,
      commissioniPerPezzo, tasseFissePerPezzo, valoreStatistico,
      dazioTotale, antidumpingTotale, dirittoTotale9AJ, ivaTotale,
      totaleImposizioni, costoTotaleImport, prezzoArticolo,
      righe
    };
  }, [chinaItems, chinaParams]);

  const confirmChinaImport = () => {
    if (!chinaCalcolo) { alert('Calcolo non disponibile'); return; }
    if (!chinaParams.fornitore.trim()) { alert('Inserire nome fornitore'); return; }

    const bollaId = 'bolla_' + Date.now();

    if (bollaMode === 'selection') {
      // MODALITÀ SELEZIONE: non aggiungere articoli al catalogo, salva solo la bolla
      const cnSelected = selectedItems.filter(i => i.origine === 'CN');
      const newItems = chinaCalcolo.righe.map((r, i) => ({
        id: 'bolla_' + bollaId + '_' + i,
        bollaId,
        // Mantengo riferimento all'articolo originale del catalogo (se presente)
        originalId: cnSelected[i]?.id || null,
        marca: r.marca, modello: r.modello, misura: r.misura,
        supplierName: chinaParams.fornitore,
        origine: 'CN',
        prezzoOriginale: r.prezzoUsd, currency: 'USD',
        prezzoEur: Math.round((r.prezzoUsd / chinaParams.tassoEurUsd) * 100) / 100,
        pfu: Math.round(r.pfuPezzo * 100) / 100,
        trasportoPerUnit: Math.round((r.extraNoloPerPezzo + chinaCalcolo.noloPerPezzo) * 100) / 100,
        dazio: Math.round(r.dazioPerPezzo * 100) / 100,
        iva: Math.round(r.ivaPerPezzo * 100) / 100,
        prezzoFinale: Math.round(r.costoFinale * 100) / 100,
        prezzoVendita: Math.round(r.prezzoVendita * 100) / 100,
        qtyImportata: r.qty
      }));
      setBolle([...bolle, {
        id: bollaId, supplierId: 'selection', data: new Date().toISOString(),
        params: { ...chinaParams }, calcolo: chinaCalcolo, items: newItems,
        fromSelection: true
      }]);

      // Se richiesto, aggiorno i prezzi degli articoli nel catalogo con i costi reali
      if (updateCatalogOnConfirm) {
        const updatedItems = allItems.map(it => {
          if (it.origine !== 'CN') return it;
          const match = cnSelected.findIndex(s => s.id === it.id);
          if (match < 0) return it;
          const r = chinaCalcolo.righe[match];
          if (!r) return it;
          return {
            ...it,
            pfu: Math.round(r.pfuPezzo * 100) / 100,
            trasportoPerUnit: Math.round((r.extraNoloPerPezzo + chinaCalcolo.noloPerPezzo) * 100) / 100,
            dazio: Math.round(r.dazioPerPezzo * 100) / 100,
            iva: Math.round(r.ivaPerPezzo * 100) / 100,
            prezzoFinale: Math.round(r.costoFinale * 100) / 100,
            prezzoVendita: Math.round(r.prezzoVendita * 100) / 100,
            lastBollaId: bollaId
          };
        });
        setAllItems(updatedItems);
      }

      // Svuoto la selezione dopo la generazione della bolla
      setSelectedItems([]);
      cancelChinaImport();
      setActiveSection('bolle');
      return;
    }

    // MODALITÀ FILE: aggiunge gli articoli nel catalogo (legacy, ora gestita da saveChinaListino)
    const supplierId = 'cn_' + Date.now();
    const items = chinaCalcolo.righe.map((r, i) => ({
      id: supplierId + '_' + i, supplierId, supplierName: chinaParams.fornitore,
      origine: 'CN', bollaId,
      marca: r.marca || chinaParams.fornitore,
      modello: r.modello, misura: r.misura,
      prezzoOriginale: r.prezzoUsd, currency: 'USD',
      prezzoEur: Math.round((r.prezzoUsd / chinaParams.tassoEurUsd) * 100) / 100,
      pfu: Math.round(r.pfuPezzo * 100) / 100,
      trasportoPerUnit: Math.round((r.extraNoloPerPezzo + chinaCalcolo.noloPerPezzo) * 100) / 100,
      dazio: Math.round(r.dazioPerPezzo * 100) / 100,
      iva: Math.round(r.ivaPerPezzo * 100) / 100,
      prezzoFinale: Math.round(r.costoFinale * 100) / 100,
      prezzoVendita: Math.round(r.prezzoVendita * 100) / 100,
      qtyImportata: r.qty
    }));

    setSuppliers([...suppliers, {
      id: supplierId, name: chinaParams.fornitore, origine: 'CN',
      importDate: new Date().toISOString(), itemCount: items.length,
      qty: chinaCalcolo.qtyTot, currency: 'USD', bollaId
    }]);
    setAllItems([...allItems, ...items]);
    setBolle([...bolle, {
      id: bollaId, supplierId, data: new Date().toISOString(),
      params: { ...chinaParams }, calcolo: chinaCalcolo, items: items.map(i => ({ ...i }))
    }]);
    cancelChinaImport();
    setActiveSection('bolle');
  };

  const cancelChinaImport = () => {
    setChinaStep('upload'); setChinaRawData([]); setChinaHeaders([]);
    setChinaMapping({ marca: '', modello: '', misura: '', prezzo: '', qty: '' });
    setChinaItems([]); setChinaFileName(''); setCurrentBolla(null);
    setBollaMode('file');
    if (chinaFileInputRef.current) chinaFileInputRef.current.value = '';
  };

  // Applica un preset nolo Savino Del Bene
  const applicaNoloPreset = (presetKey) => {
    const preset = NOLO_PRESETS[presetKey];
    if (!preset) return;
    setNoloPreset(presetKey);
    setChinaParams(prev => ({
      ...prev,
      noloMare: preset.noloMare,
      fuelSurcharge: preset.fuelSurcharge,
      ics2Usd: preset.ics2Usd,
      ecaSurcharge: preset.ecaSurcharge
    }));
  };

  // Applica tutti i costi fissi Savino Del Bene
  const applicaCostiSdb = () => {
    setChinaParams(prev => ({
      ...prev,
      costiSbarco: COSTI_SDB.thcSbarco,
      addizionaliCompMar: COSTI_SDB.addizionaliCompMar,
      deliveryOrder: COSTI_SDB.deliveryOrder,
      doganaImport: COSTI_SDB.doganaImport,
      trasportoInterno: COSTI_SDB.trasportoInterno,
      fuelTrasportoPct: COSTI_SDB.fuelTrasportoPct
    }));
  };

  // Apre il wizard bolla con gli articoli Cina selezionati
  const openBollaFromSelection = () => {
    const cnSelected = selectedItems.filter(i => i.origine === 'CN');
    if (cnSelected.length === 0) {
      alert('Selezionare almeno un articolo di origine Cina dal catalogo');
      return;
    }
    // Se tutti gli articoli sono dello stesso fornitore, uso i suoi parametri
    const supplierIds = [...new Set(cnSelected.map(i => i.supplierId))];
    let baseParams = { ...chinaParams };
    let supplierName = chinaParams.fornitore;
    if (supplierIds.length === 1) {
      // Un solo fornitore: uso i suoi parametri specifici
      const eff = getEffectiveParams(supplierIds[0]);
      baseParams = { ...eff };
      const sup = suppliers.find(s => s.id === supplierIds[0]);
      if (sup) supplierName = sup.name;
    } else if (supplierIds.length > 1) {
      const ok = confirm(`Selezione da ${supplierIds.length} fornitori diversi: ${supplierIds.map(id => suppliers.find(s => s.id === id)?.name || id).join(', ')}\n\nI parametri bolla usati saranno quelli del primo fornitore. Continuare?`);
      if (!ok) return;
      const eff = getEffectiveParams(supplierIds[0]);
      baseParams = { ...eff };
      const sup = suppliers.find(s => s.id === supplierIds[0]);
      if (sup) supplierName = sup.name;
    }

    // Converto gli item selezionati nel formato chinaItems
    const items = cnSelected.map((it, idx) => {
      const qty = it.qtyRichiesta || 1;
      // Determina fascia PFU se non presente
      let pfuFascia = it.pfuFascia || '7_15';
      if (!it.pfuFascia && it.misura) {
        const m = it.misura.match(/R(\d+)/i);
        if (m) {
          const p = parseInt(m[1]);
          if (p <= 14) pfuFascia = 'fino7';
          else if (p <= 17) pfuFascia = '7_15';
          else if (p <= 21) pfuFascia = '15_30';
          else pfuFascia = '30_60';
        }
      }
      return {
        idx, marca: it.marca, modello: it.modello, misura: it.misura,
        qty, prezzoUsd: it.prezzoOriginale || (it.prezzoEur * baseParams.tassoEurUsd),
        pfuFascia
      };
    });
    const totalQty = items.reduce((s, i) => s + i.qty, 0);

    setBollaMode('selection');
    setNoloPreset(baseParams.noloPreset || 'hcm_40');
    setChinaItems(items);

    // Uso i parametri del fornitore come base
    setChinaParams(prev => ({
      ...baseParams,
      fornitore: supplierName,
      qtyTotale: totalQty,
      unita9AJ: baseParams.unita9AJ || 4
    }));
    setChinaStep('parameters');
  };

  // ===================================================================
  // HELPER
  // ===================================================================
  const deleteSupplier = (supplierId) => {
    if (!confirm('Confermare eliminazione fornitore e articoli collegati?')) return;
    setSuppliers(suppliers.filter(s => s.id !== supplierId));
    setAllItems(allItems.filter(i => i.supplierId !== supplierId));
    setSelectedItems(selectedItems.filter(i => i.supplierId !== supplierId));
    setBolle(bolle.filter(b => b.supplierId !== supplierId));
  };

  const deleteBolla = (bollaId) => {
    if (!confirm('Eliminare la bolla doganale?')) return;
    setBolle(bolle.filter(b => b.id !== bollaId));
  };

  const toggleSelect = (item) => {
    const exists = selectedItems.find(i => i.id === item.id);
    if (exists) setSelectedItems(selectedItems.filter(i => i.id !== item.id));
    else setSelectedItems([...selectedItems, { ...item, qtyRichiesta: 1 }]);
  };

  const updateSelectedQty = (id, qty) => {
    const q = Math.max(1, parseInt(qty) || 1);
    setSelectedItems(selectedItems.map(i => i.id === id ? { ...i, qtyRichiesta: q } : i));
  };

  const removeSelected = (id) => setSelectedItems(selectedItems.filter(i => i.id !== id));
  const clearSelected = () => { if (selectedItems.length > 0 && confirm('Svuotare la selezione?')) setSelectedItems([]); };

  const uniqueMarche = useMemo(() => Array.from(new Set(allItems.map(i => i.marca).filter(Boolean))).sort(), [allItems]);

  // ===== HELPER LISTINI MISURE =====
  // Arrotonda al pari più vicino (per gomme che si vendono in coppie)
  const arrotondaAlPari = (n) => {
    const r = Math.round(n);
    return r % 2 === 0 ? r : r + 1;
  };

  // Calcola le quantità per ogni misura del listino in base alla qty totale
  const calcolaQtyListino = (sizeList) => {
    if (!sizeList || !sizeList.items) return [];
    const qtyTot = parseInt(sizeList.qtyTotale) || 0;
    if (qtyTot === 0) return sizeList.items.map(i => ({ ...i, qty: 0 }));
    // Sommo percentuali per normalizzare se non fanno 100
    const sommaPct = sizeList.items.reduce((s, i) => s + (parseFloat(i.percentuale) || 0), 0) || 1;
    let result = sizeList.items.map(i => {
      const pctNorm = (parseFloat(i.percentuale) || 0) / sommaPct;
      const qtyRaw = qtyTot * pctNorm;
      return { ...i, qty: arrotondaAlPari(qtyRaw) };
    });
    // Aggiusta la differenza arrotondamento sull'ultima riga (deve fare quadrare il totale)
    const sommaQty = result.reduce((s, i) => s + i.qty, 0);
    const diff = qtyTot - sommaQty;
    if (diff !== 0 && result.length > 0) {
      const lastIdx = result.length - 1;
      const newQty = arrotondaAlPari(result[lastIdx].qty + diff);
      result[lastIdx] = { ...result[lastIdx], qty: Math.max(0, newQty) };
    }
    return result;
  };

  // Crea un nuovo listino misure
  const createSizeList = () => {
    const name = prompt('Nome del listino (es. "Estive 2026"):');
    if (!name || !name.trim()) return;
    const newList = {
      id: 'sl_' + Date.now(),
      name: name.trim(),
      qtyTotale: 500,
      items: [],
      createdAt: new Date().toISOString()
    };
    setSizeLists(prev => [...prev, newList]);
    setActiveSizeListId(newList.id);
    setEditingSizeList(newList);
    setShowSizeListBuilder(true);
  };

  // Elimina un listino
  const deleteSizeList = (id) => {
    if (!confirm('Eliminare questo listino misure?')) return;
    setSizeLists(prev => prev.filter(l => l.id !== id));
    if (activeSizeListId === id) setActiveSizeListId(null);
  };

  // Aggiorna un listino esistente
  const updateSizeList = (id, updates) => {
    setSizeLists(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
  };

  // Aggiunge una misura al listino in editing
  const addSizeToList = (misura) => {
    if (!editingSizeList) return;
    const m = misura.trim().toUpperCase();
    if (!m) return;
    if (editingSizeList.items.some(i => i.misura === m)) {
      alert('Misura già presente nel listino');
      return;
    }
    const newItems = [...editingSizeList.items, { misura: m, percentuale: 0 }];
    setEditingSizeList({ ...editingSizeList, items: newItems });
  };

  // Rimuove una misura dal listino in editing
  const removeSizeFromList = (idx) => {
    if (!editingSizeList) return;
    const newItems = editingSizeList.items.filter((_, i) => i !== idx);
    setEditingSizeList({ ...editingSizeList, items: newItems });
  };

  // Aggiorna percentuale o qty di una riga del listino
  const updateSizeRow = (idx, key, value) => {
    if (!editingSizeList) return;
    const newItems = editingSizeList.items.map((it, i) => i === idx ? { ...it, [key]: value } : it);
    setEditingSizeList({ ...editingSizeList, items: newItems });
  };

  // Salva il listino in editing
  const saveEditingSizeList = () => {
    if (!editingSizeList) return;
    // Verifica somma percentuali
    const somma = editingSizeList.items.reduce((s, i) => s + (parseFloat(i.percentuale) || 0), 0);
    if (Math.abs(somma - 100) > 0.5 && editingSizeList.items.length > 0) {
      if (!confirm(`Le percentuali sommano a ${somma.toFixed(1)}% (non 100%). Salvare comunque? Le quantità saranno calcolate proporzionalmente.`)) return;
    }
    updateSizeList(editingSizeList.id, {
      name: editingSizeList.name,
      qtyTotale: editingSizeList.qtyTotale,
      items: editingSizeList.items
    });
    setShowSizeListBuilder(false);
    setEditingSizeList(null);
  };

  // Listino attivo (oggetto)
  const activeSizeList = useMemo(() => sizeLists.find(l => l.id === activeSizeListId) || null, [sizeLists, activeSizeListId]);

  // Misure del listino attivo (Set per filtraggio veloce)
  const activeSizeSet = useMemo(() => {
    if (!activeSizeList) return null;
    return new Set(activeSizeList.items.map(i => (i.misura || '').toUpperCase().trim()));
  }, [activeSizeList]);

  // ===== HELPER COLONNE NASCOSTE =====
  const toggleColumnVisibility = (key) => {
    setHiddenColumns(prev => prev.includes(key) ? prev.filter(c => c !== key) : [...prev, key]);
    setColumnMenuFor(null);
  };
  const showAllColumns = () => setHiddenColumns([]);
  const hideAllExtraColumns = () => setHiddenColumns(['fobEur', 'noloPerPezzo', 'aggPerPezzo', 'valoreStatistico', 'dazio', 'tassePerPezzo', 'iva', 'extraNoloPerPezzo', 'serviziIvaPerPezzo', 'commissioniPerPezzo', 'pfu']);

  // ===== MODIFICA ARTICOLO =====
  // Aggiorna un singolo campo di un articolo (per editing inline)
  const updateItemField = (itemId, field, value) => {
    setAllItems(prev => prev.map(it => it.id === itemId ? { ...it, [field]: value } : it));
  };

  // Salva l'articolo modificato dalla modale completa
  const saveEditingItem = () => {
    if (!editingItem) return;
    // Ricalcolo fascia PFU se la misura è cambiata
    let pfuFascia = editingItem.pfuFascia || '7_15';
    const m = (editingItem.misura || '').match(/R(\d+)/i);
    if (m) {
      const p = parseInt(m[1]);
      if (p <= 14) pfuFascia = 'fino7';
      else if (p <= 17) pfuFascia = '7_15';
      else if (p <= 21) pfuFascia = '15_30';
      else pfuFascia = '30_60';
    }
    // Normalizzo la misura (la salvo nel formato display, e la cifra normalizzata in misuraNorm)
    const misuraDisplay = formatMisuraDisplay(editingItem.misura);
    const misuraNorm = normalizeMisuraForSearch(editingItem.misura);
    setAllItems(prev => prev.map(it => it.id === editingItem.id ? {
      ...it,
      marca: editingItem.marca,
      modello: editingItem.modello,
      misura: misuraDisplay,
      misuraNorm,
      prezzoOriginale: parseFloat(editingItem.prezzoOriginale) || 0,
      qtyDisponibile: parseInt(editingItem.qtyDisponibile) || 0,
      pfu: parseFloat(editingItem.pfu) || it.pfu,
      pfuFascia
    } : it));
    setEditingItem(null);
  };

  // Apre la modale di modifica
  const openEditItemModal = (item) => {
    setEditingItem({ ...item });
  };

  // ===== PANNELLO CONFRONTO =====
  const addToCompare = (item) => {
    setCompareItemIds(prev => prev.includes(item.id) ? prev : [...prev, item.id]);
    setComparePanelOpen(true);
  };
  const removeFromCompare = (itemId) => {
    setCompareItemIds(prev => prev.filter(id => id !== itemId));
  };
  const clearCompare = () => {
    setCompareItemIds([]);
    setComparePanelOpen(false);
  };
  // Articoli effettivamente presenti nel pannello (filtra quelli rimossi nel frattempo)
  const compareItems = useMemo(() => {
    return compareItemIds.map(id => allItems.find(it => it.id === id)).filter(Boolean);
  }, [compareItemIds, allItems]);

  // ===== SCOMPOSIZIONE LIVE PER SELEZIONE =====
  // Usa selSimParams se presente, altrimenti i parametri del fornitore di ogni articolo
  const scomposizioneSelezione = useMemo(() => {
    const result = {};
    for (const it of selectedItems) {
      let effParams;
      if (selSimParams) {
        // Modalità simulazione: uso i parametri attivi della sim
        effParams = { ...selSimParams };
      } else if (it.origine === 'CN') {
        // Default: parametri del fornitore CN
        const sp = supplierParams[it.supplierId];
        effParams = (!sp || sp.useGlobal) ? chinaParams : { ...chinaParams, ...sp.params };
      } else {
        // Articolo EU: niente scomposizione completa (solo prezzoFinale)
        continue;
      }
      const simItem = {
        prezzoUsd: it.prezzoOriginale,
        qty: it.qtyRichiesta || 1,
        pfuFascia: it.pfuFascia || '7_15'
      };
      // Per la simulazione uso la qty totale come somma delle qty richieste
      const qtyRif = parseFloat(effParams.qtyTotale) || selectedItems.reduce((s, x) => s + (x.qtyRichiesta || 1), 0);
      result[it.id] = calcolaScomposizione(simItem, { ...effParams, qtyTotale: qtyRif });
    }
    return result;
  }, [selectedItems, selSimParams, supplierParams, chinaParams]);

  // Totali aggregati della selezione (con prezzo simulato se attivo)
  const totaliSelezione = useMemo(() => {
    let totFobEur = 0, totNolo = 0, totCif = 0, totDazio = 0, totIva = 0;
    let totExtra = 0, totServizi = 0, totPfu = 0, totCosto = 0, totVendita = 0;
    let totQty = 0;
    for (const it of selectedItems) {
      const qty = it.qtyRichiesta || 1;
      totQty += qty;
      const sc = scomposizioneSelezione[it.id];
      if (sc) {
        totFobEur += sc.fobEur * qty;
        totNolo += sc.noloPerPezzo * qty;
        totCif += sc.valoreStatistico * qty;
        totDazio += sc.dazio * qty;
        totIva += sc.iva * qty;
        totExtra += sc.extraNoloPerPezzo * qty;
        totServizi += sc.serviziIvaPerPezzo * qty;
        totPfu += sc.pfuPezzo * qty;
        totCosto += sc.costoFinale * qty;
        totVendita += sc.prezzoVendita * qty;
      } else {
        // Articolo EU: uso prezzoFinale statico
        const p = parseFloat(it.prezzoFinale) || 0;
        totCosto += p * qty;
        totVendita += p * qty;
      }
    }
    const margine = totVendita - totCosto;
    const marginePct = totCosto > 0 ? (margine / totCosto * 100) : 0;
    return { totFobEur, totNolo, totCif, totDazio, totIva, totExtra, totServizi, totPfu, totCosto, totVendita, totQty, margine, marginePct };
  }, [selectedItems, scomposizioneSelezione]);

  // ===== HELPER SIMULAZIONE SELEZIONE =====
  // Carica i parametri di un fornitore CN nella simulazione
  const loadSupplierParamsToSim = (supplierId) => {
    const sp = supplierParams[supplierId];
    const params = (!sp || sp.useGlobal) ? { ...chinaParams } : { ...chinaParams, ...sp.params };
    // Imposto qtyTotale dalla selezione
    params.qtyTotale = selectedItems.reduce((s, x) => s + (x.qtyRichiesta || 1), 0);
    setSelSimParams(params);
    setSelSimPanelOpen(true);
  };

  // Reset simulazione (torna ai parametri originali del fornitore)
  const resetSelSim = () => {
    setSelSimParams(null);
  };

  // Aggiorna un parametro della simulazione
  const updateSelSimParam = (key, value) => {
    setSelSimParams(prev => prev ? { ...prev, [key]: value } : prev);
  };

  // Applica un preset nolo alla simulazione
  const applyPresetToSelSim = (presetKey) => {
    const preset = NOLO_PRESETS[presetKey];
    if (!preset || !selSimParams) return;
    setSelSimParams(prev => ({
      ...prev,
      noloMare: preset.noloMare,
      fuelSurcharge: preset.fuelSurcharge,
      ics2Usd: preset.ics2Usd,
      ecaSurcharge: preset.ecaSurcharge,
      noloPreset: presetKey
    }));
  };

  // Salva lo scenario corrente per confronti
  const saveScenario = () => {
    if (!selSimParams) { alert('Attiva prima la simulazione cliccando "Carica da fornitore"'); return; }
    const name = prompt('Nome scenario (es. "Cina 40\' HC", "HoChiMin 20\' base"):');
    if (!name || !name.trim()) return;
    setSelScenarios(prev => [...prev, {
      id: 'scen_' + Date.now(),
      name: name.trim(),
      params: { ...selSimParams },
      totali: { ...totaliSelezione },
      savedAt: new Date().toISOString()
    }]);
  };

  // Elimina uno scenario salvato
  const deleteScenario = (id) => {
    setSelScenarios(prev => prev.filter(s => s.id !== id));
  };

  // Carica uno scenario salvato
  const loadScenario = (id) => {
    const sc = selScenarios.find(s => s.id === id);
    if (sc) setSelSimParams({ ...sc.params });
  };

  // Pulisce tutti gli scenari salvati
  const clearScenarios = () => {
    if (selScenarios.length === 0) return;
    if (confirm('Eliminare tutti gli scenari salvati?')) setSelScenarios([]);
  };

  // ===== TOTALE FILTRATO PER COLONNE NASCOSTE =====
  // Ricalcola il "totale visibile" di un articolo escludendo le voci nascoste
  // Mappatura colonna → componente della scomposizione
  const COLONNE_TO_COMPONENT = {
    fobEur: 'fobEur',
    noloPerPezzo: 'noloPerPezzo',
    aggPerPezzo: 'aggPerPezzo',
    dazio: 'dazio',
    tassePerPezzo: 'tassePerPezzo',
    iva: 'iva',
    extraNoloPerPezzo: 'extraNoloPerPezzo',
    serviziIvaPerPezzo: 'serviziIvaPerPezzo',
    commissioniPerPezzo: 'commissioniPerPezzo',
    pfu: 'pfuPezzo'
  };
  // Etichette colonne (per badge avviso)
  const COLONNE_LABELS = {
    fobEur: 'FOB',
    noloPerPezzo: 'Nolo',
    aggPerPezzo: 'Aggiust.',
    dazio: 'Dazio',
    tassePerPezzo: '9AJ',
    iva: 'IVA',
    extraNoloPerPezzo: 'ExtraNolo',
    serviziIvaPerPezzo: 'Servizi',
    commissioniPerPezzo: 'Commissioni',
    pfu: 'PFU',
    valoreStatistico: 'CIF (display)'
  };

  // Calcola il "totale visibile" considerando le colonne nascoste
  const calcTotaleFiltrato = (sc) => {
    if (!sc) return 0;
    let totale = sc.costoFinale; // baseline = totale completo
    // Sottrai ogni componente di una colonna nascosta
    for (const colKey of hiddenColumns) {
      const compKey = COLONNE_TO_COMPONENT[colKey];
      if (!compKey) continue;
      const valToSubtract = parseFloat(sc[compKey]) || 0;
      totale -= valToSubtract;
    }
    return totale;
  };

  // Etichette voci escluse (per badge)
  const voci_escluse_labels = useMemo(() => {
    return hiddenColumns
      .filter(k => COLONNE_LABELS[k] && k !== 'valoreStatistico')
      .map(k => COLONNE_LABELS[k]);
  }, [hiddenColumns]);

  // Calcola il prezzo finale per una misura del listino, dato un fornitore
  const getPrezzoListino = (misura, supplierId) => {
    const m = misura.toUpperCase().trim();
    const cands = allItems.filter(i => (i.misura || '').toUpperCase().trim() === m && (supplierId === 'all' || i.supplierId === supplierId));
    if (cands.length === 0) return null;
    // Per CN uso scomposizione live, per EU prezzoFinale statico, prendo il più economico
    let best = null;
    for (const c of cands) {
      const p = c.origine === 'CN' && scomposizioneCatalogo[c.id] ? scomposizioneCatalogo[c.id].costoFinale : (parseFloat(c.prezzoFinale) || 0);
      if (best === null || p < best.prezzo) {
        best = { item: c, prezzo: p };
      }
    }
    return best;
  };

  // Export listino misure in PDF (per inviarlo al fornitore)
  const exportListinoPdf = (sizeList, supplierId = 'all') => {
    if (!sizeList) return;
    const rows = calcolaQtyListino(sizeList);
    const win = window.open('', '_blank');
    if (!win) { alert('Abilita popup'); return; }
    const sup = suppliers.find(s => s.id === supplierId);
    const titolo = sup ? `Richiesta ${sup.name}` : 'Richiesta Multi-Fornitore';
    const dataStr = new Date().toLocaleDateString('it-IT');
    let totale = 0;
    const rowsHtml = rows.map((r, i) => {
      const best = getPrezzoListino(r.misura, supplierId);
      const prezzoUnit = best?.prezzo || 0;
      const prezzoOrig = best?.item?.prezzoOriginale || 0;
      const valuta = best?.item?.currency || 'EUR';
      const subtot = prezzoUnit * r.qty;
      totale += subtot;
      return `<tr>
        <td>${i + 1}</td>
        <td><b>${r.misura}</b></td>
        <td class="num">${r.percentuale}%</td>
        <td class="num"><b>${r.qty}</b></td>
        <td>${best?.item?.marca || '—'} ${best?.item?.modello || ''}</td>
        <td class="num">${prezzoOrig ? valuta + ' ' + prezzoOrig.toFixed(2) : '—'}</td>
        <td class="num"><b>€ ${prezzoUnit.toFixed(2)}</b></td>
        <td class="num"><b>€ ${subtot.toFixed(2)}</b></td>
      </tr>`;
    }).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${titolo}</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #263238; padding: 10px; }
  h1 { color: #0d47a1; border-bottom: 2px solid #0d47a1; padding-bottom: 6px; margin: 0 0 8px 0; }
  .info { background: #e3f2fd; padding: 8px; margin-bottom: 12px; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #37474f; color: #fff; padding: 6px 8px; text-align: left; font-size: 11px; }
  td { padding: 5px 8px; border-bottom: 1px solid #cfd8dc; }
  tr:nth-child(even) td { background: #f5f7fa; }
  .num { text-align: right; font-family: 'Consolas', monospace; }
  .tot { background: #1976d2 !important; color: #fff; font-weight: bold; font-size: 13px; }
  .tot td { color: #fff; }
  .no-print-btn { position: fixed; bottom: 15px; right: 15px; background: #1976d2; color: #fff; border: none; padding: 10px 20px; cursor: pointer; font-weight: bold; }
  @media print { .no-print-btn { display: none; } }
</style></head><body>
<h1>${titolo} — Listino "${sizeList.name}"</h1>
<div class="info">
  <b>Data:</b> ${dataStr} &nbsp;·&nbsp;
  <b>Quantità totale:</b> ${sizeList.qtyTotale} pezzi &nbsp;·&nbsp;
  <b>Misure richieste:</b> ${rows.length}
</div>
<table>
  <thead>
    <tr><th>#</th><th>Misura</th><th class="num">%</th><th class="num">Q.tà</th><th>Articolo</th><th class="num">Prezzo orig.</th><th class="num">Prezzo finito €</th><th class="num">Subtotale €</th></tr>
  </thead>
  <tbody>${rowsHtml}</tbody>
  <tfoot>
    <tr class="tot"><td colspan="3"></td><td class="num">${rows.reduce((s, r) => s + r.qty, 0)}</td><td colspan="3">TOTALE</td><td class="num">€ ${totale.toFixed(2)}</td></tr>
  </tfoot>
</table>
<button class="no-print-btn" onclick="window.print()">🖨 STAMPA / SALVA PDF</button>
</body></html>`;
    win.document.write(html);
    win.document.close();
  };

  // Export listino misure in Excel
  const exportListinoExcel = (sizeList, supplierId = 'all') => {
    if (!sizeList) return;
    const rows = calcolaQtyListino(sizeList);
    const wb = XLSX.utils.book_new();
    const data = rows.map((r, i) => {
      const best = getPrezzoListino(r.misura, supplierId);
      return {
        '#': i + 1,
        'Misura': r.misura,
        'Percentuale %': r.percentuale,
        'Quantità': r.qty,
        'Marca': best?.item?.marca || '',
        'Modello': best?.item?.modello || '',
        'Fornitore': best?.item?.supplierName || '',
        'Prezzo originale': best?.item?.prezzoOriginale || '',
        'Valuta': best?.item?.currency || '',
        'Prezzo finito €': best?.prezzo || 0,
        'Subtotale €': (best?.prezzo || 0) * r.qty
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [{ wch: 5 }, { wch: 14 }, { wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 8 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Listino');
    XLSX.writeFile(wb, `listino_${sizeList.name.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // ===== GESTIONE PARAMETRI PER-FORNITORE =====
  // Ritorna i parametri effettivi di un fornitore (suoi o globali se useGlobal)
  const getEffectiveParams = (supplierId) => {
    const sp = supplierParams[supplierId];
    if (!sp || sp.useGlobal) return chinaParams;
    return { ...chinaParams, ...sp.params };
  };

  // Aggiorna un singolo parametro per un fornitore (disattiva useGlobal)
  const updateSupplierParam = (supplierId, key, value) => {
    setSupplierParams(prev => ({
      ...prev,
      [supplierId]: {
        useGlobal: false,
        params: { ...(prev[supplierId]?.params || chinaParams), [key]: value }
      }
    }));
  };

  // Ripristina un fornitore ai parametri globali
  const resetSupplierToGlobal = (supplierId) => {
    if (!confirm('Ripristinare i parametri globali per questo fornitore?')) return;
    setSupplierParams(prev => ({
      ...prev,
      [supplierId]: { useGlobal: true, params: {} }
    }));
  };

  // Applica preset nolo a un fornitore specifico
  const applyPresetToSupplier = (supplierId, presetKey) => {
    const preset = NOLO_PRESETS[presetKey];
    if (!preset) return;
    const base = supplierParams[supplierId]?.useGlobal === false
      ? { ...supplierParams[supplierId].params }
      : { ...chinaParams };
    const newParams = {
      ...base,
      noloMare: preset.noloMare,
      fuelSurcharge: preset.fuelSurcharge,
      ics2Usd: preset.ics2Usd,
      ecaSurcharge: preset.ecaSurcharge,
      noloPreset: presetKey,
      costiSbarco: COSTI_SDB.thcSbarco,
      addizionaliCompMar: COSTI_SDB.addizionaliCompMar,
      deliveryOrder: COSTI_SDB.deliveryOrder,
      doganaImport: COSTI_SDB.doganaImport,
      trasportoInterno: COSTI_SDB.trasportoInterno,
      fuelTrasportoPct: COSTI_SDB.fuelTrasportoPct
    };
    setSupplierParams(prev => ({
      ...prev,
      [supplierId]: { useGlobal: false, params: newParams }
    }));
  };

  // ===== SCOMPOSIZIONE LIVE PER CATALOGO =====
  // Per ogni articolo CN, calcola la scomposizione usando i parametri del suo fornitore
  const scomposizioneCatalogo = useMemo(() => {
    const result = {};
    for (const it of allItems) {
      if (it.origine !== 'CN') continue;
      const sp = supplierParams[it.supplierId];
      const effParams = (!sp || sp.useGlobal) ? chinaParams : { ...chinaParams, ...sp.params };
      const simItem = {
        prezzoUsd: it.prezzoOriginale,
        qty: it.qtyImportata || it.qtyDisponibile || 1,
        pfuFascia: it.pfuFascia || '7_15'
      };
      const qtyRif = parseFloat(effParams.qtyTotale) || simItem.qty || 1;
      result[it.id] = calcolaScomposizione(simItem, { ...effParams, qtyTotale: qtyRif });
    }
    return result;
  }, [allItems, supplierParams, chinaParams]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    // Estraggo la versione "solo cifre" della query
    const qDigits = q.replace(/\D/g, '');
    // Considero ricerca-misura quando la query è composta principalmente da cifre (con eventuali R, /, spazi, -)
    // e ha almeno 3 cifre per essere significativa
    const isMisuraSearch = qDigits.length >= 3 && q.length > 0 && /^[\d\s\/\-rRzZ\.]+$/.test(q);
    let list = allItems.filter(i => {
      // Filtro listino misure attivo
      if (activeSizeSet && activeSizeSet.size > 0) {
        const m = (i.misura || '').toUpperCase().trim();
        const mNorm = normalizeMisuraForSearch(m);
        let inSet = activeSizeSet.has(m) || activeSizeSet.has(mNorm);
        if (!inSet) {
          for (const s of activeSizeSet) {
            if (normalizeMisuraForSearch(s) === mNorm) { inSet = true; break; }
          }
        }
        if (!inSet) return false;
      }
      // Filtro tab attiva
      if (activeCatalogTab === 'eu' && i.origine !== 'EU') return false;
      if (activeCatalogTab !== 'all' && activeCatalogTab !== 'eu' && i.supplierId !== activeCatalogTab) return false;
      // Filtri normali
      if (filterOrigine && i.origine !== filterOrigine) return false;
      if (filterSupplier && i.supplierId !== filterSupplier) return false;
      if (filterMarca && i.marca !== filterMarca) return false;
      if (!q) return true;
      // Ricerca testuale
      const inMarca = i.marca.toLowerCase().includes(q);
      const inModello = (i.modello || '').toLowerCase().includes(q);
      const inMisura = (i.misura || '').toLowerCase().includes(q);
      // Ricerca permissiva su misura
      let inMisuraNorm = false;
      if (isMisuraSearch) {
        const itemNorm = i.misuraNorm || normalizeMisuraForSearch(i.misura || '');
        // Match se: la query normalizzata è un PREFISSO della misura normalizzata
        // Esempio: query "20555" → trova "2055516", "2055517", "2055518" (tutti i 205/55 di qualsiasi diametro)
        // Esempio: query "205" → trova tutti i 205/* (es. 2055516, 2056017, 2057016, ecc.)
        if (itemNorm.startsWith(qDigits)) inMisuraNorm = true;
        // Match anche se la query è uguale al normalizzato completo (es. "2055516" == "2055516")
        if (itemNorm === qDigits) inMisuraNorm = true;
      }
      return inMarca || inModello || inMisura || inMisuraNorm;
    });
    list.sort((a, b) => {
      let av, bv;
      if (sortBy.field === 'prezzoFinale' && a.origine === 'CN' && scomposizioneCatalogo[a.id]) {
        av = scomposizioneCatalogo[a.id].costoFinale;
      } else {
        av = a[sortBy.field];
      }
      if (sortBy.field === 'prezzoFinale' && b.origine === 'CN' && scomposizioneCatalogo[b.id]) {
        bv = scomposizioneCatalogo[b.id].costoFinale;
      } else {
        bv = b[sortBy.field];
      }
      if (typeof av === 'string') { av = av.toLowerCase(); bv = (bv || '').toLowerCase(); }
      if (av < bv) return sortBy.dir === 'asc' ? -1 : 1;
      if (av > bv) return sortBy.dir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [allItems, searchQuery, filterSupplier, filterMarca, filterOrigine, sortBy, activeCatalogTab, scomposizioneCatalogo, activeSizeSet]);

  const totaleSelezione = useMemo(() => selectedItems.reduce((s, i) => s + i.prezzoFinale * i.qtyRichiesta, 0), [selectedItems]);
  const qtyTotale = useMemo(() => selectedItems.reduce((s, i) => s + i.qtyRichiesta, 0), [selectedItems]);

  // Confronto fornitori: raggruppa per misura, ordina per prezzo finale LIVE crescente
  const comparisonData = useMemo(() => {
    if (allItems.length === 0) return [];
    const map = new Map();
    const q = compareMisuraQuery.toLowerCase().trim();
    // Prezzo "effettivo": per CN usa scomposizione live, per EU usa prezzoFinale
    const getPrezzo = (it) => {
      if (it.origine === 'CN' && scomposizioneCatalogo[it.id]) {
        return scomposizioneCatalogo[it.id].costoFinale;
      }
      return parseFloat(it.prezzoFinale) || 0;
    };
    for (const it of allItems) {
      const mis = (it.misura || '').trim();
      if (!mis) continue;
      if (q && !mis.toLowerCase().includes(q) && !(it.marca || '').toLowerCase().includes(q)) continue;
      if (!map.has(mis)) map.set(mis, []);
      map.get(mis).push({ ...it, _prezzoEffettivo: getPrezzo(it) });
    }
    // Ordina ogni gruppo per prezzo effettivo crescente
    const groups = [];
    for (const [misura, items] of map.entries()) {
      items.sort((a, b) => a._prezzoEffettivo - b._prezzoEffettivo);
      const min = items[0]?._prezzoEffettivo || 0;
      const max = items[items.length - 1]?._prezzoEffettivo || 0;
      const savings = min > 0 ? ((max - min) / max * 100) : 0;
      const suppliers = new Set(items.map(i => i.supplierName));
      groups.push({
        misura, items, min, max, savings,
        suppliersCount: suppliers.size,
        hasEU: items.some(i => i.origine !== 'CN'),
        hasCN: items.some(i => i.origine === 'CN')
      });
    }
    // Ordina gruppi per numero di fornitori (più fornitori = più scelta) e poi per misura
    groups.sort((a, b) => b.suppliersCount - a.suppliersCount || a.misura.localeCompare(b.misura));
    return groups;
  }, [allItems, compareMisuraQuery, scomposizioneCatalogo]);

  const toggleSort = (field) => setSortBy(s => ({ field, dir: s.field === field && s.dir === 'asc' ? 'desc' : 'asc' }));

  // Export intero catalogo in Excel (tutti gli articoli)
  const exportCatalogoExcel = () => {
    if (allItems.length === 0) { alert('Catalogo vuoto'); return; }
    const wb = XLSX.utils.book_new();
    const rows = allItems.map((it, i) => ({
      '#': i + 1,
      'Origine': it.origine,
      'Fornitore': it.supplierName,
      'Marca': it.marca,
      'Modello': it.modello || '',
      'Misura': it.misura || '',
      'Prezzo originale': it.prezzoOriginale,
      'Valuta': it.currency,
      'Prezzo EUR': it.prezzoEur,
      'PFU €': it.pfu,
      'Trasporto/U €': it.trasportoPerUnit,
      'Dazio €': it.dazio,
      'IVA €': it.iva,
      'Prezzo Finale €': it.prezzoFinale,
      'Prezzo Vendita €': it.prezzoVendita || '',
      'Qtà disponibile': it.qtyDisponibile || it.qtyImportata || '',
      'Tipo prezzo': it.lastBollaId ? 'REALE' : (it.origine === 'CN' ? 'STIMA' : 'REALE')
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 5 }, { wch: 8 }, { wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 14 },
      { wch: 14 }, { wch: 6 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 10 },
      { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Catalogo');
    XLSX.writeFile(wb, `catalogo_completo_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // Export parametri (chinaParams) in JSON
  const exportParams = () => {
    const data = {
      version: '1.6',
      exportDate: new Date().toISOString(),
      chinaParams: chinaParams
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `parametri_gestionale_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import parametri da JSON
  const importParams = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.chinaParams) {
          if (confirm('Sovrascrivere i parametri attuali con quelli del file?')) {
            setChinaParams(prev => ({ ...prev, ...data.chinaParams }));
            alert('Parametri importati con successo');
          }
        } else {
          alert('File non valido: non contiene parametri riconosciuti');
        }
      } catch (err) {
        alert('Errore nella lettura del file JSON: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Svuota archivio completo (con conferma)
  const clearAllArchive = () => {
    if (!confirm('ATTENZIONE: questa azione elimina TUTTI gli articoli, fornitori, selezioni e bolle. Vuoi davvero procedere?')) return;
    if (!confirm('Ultima conferma: tutti i dati saranno persi definitivamente. Procedere?')) return;
    setAllItems([]);
    setSuppliers([]);
    setSelectedItems([]);
    setBolle([]);
    setSearchQuery(''); setFilterMarca(''); setFilterSupplier(''); setFilterOrigine('');
    alert('Archivio svuotato.');
  };

  // Apri simulatore dal menu strumenti: usa primo articolo selezionato o primo del catalogo
  const openSimulatorFromMenu = () => {
    if (selectedItems.length > 0) {
      openSimulatorFromItem(selectedItems[0]);
    } else if (allItems.length > 0) {
      openSimulatorFromItem(allItems[0]);
    } else {
      alert('Nessun articolo disponibile. Importa prima un listino.');
    }
  };

  // Menu click handler: chiude menu dopo azione
  const menuAction = (fn) => {
    setOpenMenu(null);
    if (typeof fn === 'function') setTimeout(fn, 50);
  };

  // Calcolo LIVE della scomposizione: baseline e simulata
  const simScomposizioneBaseline = useMemo(() => {
    if (!simulatorOpen || !simBaseline || !simulatorTarget) return null;
    return calcolaScomposizione(simulatorTarget.simItem, simBaseline);
  }, [simulatorOpen, simBaseline, simulatorTarget]);

  const simScomposizioneSimulata = useMemo(() => {
    if (!simulatorOpen || !simParams || !simulatorTarget) return null;
    return calcolaScomposizione(simulatorTarget.simItem, simParams);
  }, [simulatorOpen, simParams, simulatorTarget]);

  const fmtEur = (n) => new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
  const fmtInt = (n) => new Intl.NumberFormat('it-IT').format(n || 0);

  // ===================================================================
  // EXPORT
  // ===================================================================
  const exportSelection = () => {
    if (selectedItems.length === 0) { alert('Nessun articolo selezionato'); return; }
    const rows = selectedItems.map(i => ({
      'Origine': i.origine, 'Fornitore': i.supplierName, 'Marca': i.marca, 'Modello': i.modello, 'Misura': i.misura,
      'Prezzo Orig.': i.prezzoOriginale, 'Valuta': i.currency, 'Prezzo EUR': i.prezzoEur,
      'PFU': i.pfu, 'Trasp./u': i.trasportoPerUnit,
      'Dazio': i.dazio || 0, 'IVA': i.iva || 0,
      'Prezzo Finale': i.prezzoFinale, 'Q.tà': i.qtyRichiesta,
      'Totale': Math.round(i.prezzoFinale * i.qtyRichiesta * 100) / 100
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Selezione');
    XLSX.writeFile(wb, `selezione_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportAll = () => {
    if (allItems.length === 0) { alert('Archivio vuoto'); return; }
    const rows = allItems.map(i => ({
      'Origine': i.origine, 'Fornitore': i.supplierName, 'Marca': i.marca, 'Modello': i.modello, 'Misura': i.misura,
      'Prezzo EUR': i.prezzoEur, 'PFU': i.pfu, 'Dazio': i.dazio || 0, 'IVA': i.iva || 0,
      'Prezzo Finale': i.prezzoFinale
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Database');
    XLSX.writeFile(wb, `database_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // Export Excel della bolla con calcoli dettagliati (4 fogli)
  const exportBollaExcel = (bolla) => {
    const c = bolla.calcolo;
    const p = bolla.params;
    // Fallback retro-compatibilità
    const dirittoTotale9AJ = c.dirittoTotale9AJ !== undefined ? c.dirittoTotale9AJ : (parseFloat(p.dirittoDoganale9AJ) || 0);
    const antidumpingTotale = c.antidumpingTotale !== undefined ? c.antidumpingTotale : c.valoreStatistico * (p.antidumpingPct || 0) / 100;
    const wb = XLSX.utils.book_new();

    // FOGLIO 1 — Riepilogo Spedizione
    const riepilogo = [
      ['RIEPILOGO BOLLA DOGANALE', ''],
      ['ID Bolla', bolla.id],
      ['Data', new Date(bolla.data).toLocaleString('it-IT')],
      [],
      ['— DATI SPEDIZIONE —', ''],
      ['Fornitore', p.fornitore],
      ['Indirizzo fornitore', p.indirizzoFornitore || ''],
      ['Fattura n°', p.fattura || ''],
      ['Nr. riferimento', p.nrRiferimento || ''],
      ['Incoterm', p.incoterm],
      ['Porto imbarco', p.portoImbarco],
      ['Porto sbarco', p.portoSbarco],
      ['Nave', p.nave || ''],
      ['Container', p.container || ''],
      ['Data spedizione', p.dataSpedizione || ''],
      ['Codice TARIC', p.codiceTaric],
      ['Regime (37)', p.regime || '4000'],
      ['Doc. precedente (40)', p.docPrecedente || ''],
      ['Massa lorda kg', p.massaLorda || 0],
      ['Massa netta kg', p.massaNetta || 0],
      [],
      ['— IMPORTATORE / DICHIARANTE —', ''],
      ['Importatore', p.importatore],
      ['P.IVA importatore', p.importatorePiva || ''],
      ['Indirizzo', p.importatoreIndirizzo || ''],
      ['Attività', p.importatoreAttivita || ''],
      ['Dichiarante', p.dichiarante],
      ['CF dichiarante', p.dichiaranteCf || ''],
      ['Spedizioniere', p.spedizioniere],
      [],
      ['— VALORI BASE —', ''],
      ['Cambio EUR/USD', p.tassoEurUsd],
      ['Cambio USD/EUR (calc.)', (1 / p.tassoEurUsd)],
      ['Totale FOB USD', c.fobTotUsd],
      ['Totale FOB EUR', c.fobTotEur],
      ['Aggiustamento (v.45) €', parseFloat(p.aggiustamento) || 0],
      ['Valore statistico (v.46) €', c.valoreStatistico],
      ['Quantità totale pezzi', c.qtyTot]
    ];
    const wsRiepilogo = XLSX.utils.aoa_to_sheet(riepilogo);
    wsRiepilogo['!cols'] = [{ wch: 32 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsRiepilogo, 'Riepilogo');

    // FOGLIO 2 — Imposizioni Doganali (voce 47)
    const imposizioni = [
      ['CALCOLO IMPOSIZIONI DOGANALI (voce 47)', '', '', '', ''],
      ['Tipo', 'Descrizione', 'Base Imponibile €', 'Aliquota %', 'Importo €'],
      ['A00', 'Dazio Doganale', c.valoreStatistico, p.dazioPct, c.dazioTotale]
    ];
    if (p.antidumpingPct > 0) {
      imposizioni.push(['A30', 'Dazio Antidumping', c.valoreStatistico, p.antidumpingPct, antidumpingTotale]);
    }
    imposizioni.push(
      ['9AJ', `Diritto Doganale Marittimo (${p.unita9AJ || 4} × 1,0908 €)`, p.unita9AJ || 4, 1.0908, dirittoTotale9AJ],
      ['B00', 'IVA Importazione', c.valoreStatistico + c.dazioTotale + antidumpingTotale + dirittoTotale9AJ, p.ivaPct, c.ivaTotale],
      [],
      ['', '', '', 'TOTALE IMPOSIZIONI BOLLA', c.totaleImposizioni]
    );
    const wsImposizioni = XLSX.utils.aoa_to_sheet(imposizioni);
    wsImposizioni['!cols'] = [{ wch: 8 }, { wch: 38 }, { wch: 20 }, { wch: 14 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, wsImposizioni, 'Imposizioni');

    // FOGLIO 3 — Articoli con costi dettagliati
    const articoli = c.righe.map((r, i) => ({
      '#': i + 1,
      'Marca': r.marca || '',
      'Modello': r.modello || '',
      'Misura': r.misura || '',
      'Fascia PFU': r.pfuFascia,
      'Qty': r.qty,
      'Prezzo USD/pz': r.prezzoUsd,
      'Prezzo EUR/pz (FOB)': r.prezzoUsd / p.tassoEurUsd,
      'Nolo EUR/pz': c.noloPerPezzo,
      'Aggiustamento/pz': c.aggiustamentoPerPezzo || 0,
      'CIF EUR/pz (v.stat.)': r.cifPerPezzo,
      'Dazio A00/pz': r.dazioPerPezzo,
      'Antidumping/pz': r.antidumpingPerPezzo,
      '9AJ/pz': r.tasseFissePerPezzo,
      'Base IVA/pz': r.baseIva,
      'IVA B00/pz': r.ivaPerPezzo,
      'Extra nolo art.74/pz': r.extraNoloPerPezzo,
      'Servizi IVA/pz': r.serviziIvaPerPezzo,
      'Commissioni/pz': r.commissioniPerPezzo,
      'PFU/pz': r.pfuPezzo,
      'COSTO FINALE/pz': r.costoFinale,
      'Prezzo vendita/pz': r.prezzoVendita,
      'Totale riga (costo × qty)': r.costoFinale * r.qty,
      'Totale riga (vendita × qty)': r.prezzoVendita * r.qty
    }));
    const wsArticoli = XLSX.utils.json_to_sheet(articoli);
    // Larghezze colonne ragionevoli
    wsArticoli['!cols'] = [
      { wch: 4 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 6 },
      { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 12 },
      { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 12 },
      { wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 18 }
    ];
    XLSX.utils.book_append_sheet(wb, wsArticoli, 'Articoli');

    // FOGLIO 4 — Costi Accessori Ripartiti
    const costi = [
      ['COSTI ACCESSORI RIPARTIZIONE', '', ''],
      ['Voce', 'Totale €', 'Per pezzo €'],
      [],
      ['— NOLO MARITTIMO (USD→EUR) —', '', ''],
      ['Nolo mare USD', parseFloat(p.noloMare) || 0, ''],
      ['ECA Surcharge USD', parseFloat(p.ecaSurcharge) || 0, ''],
      ['ICS2 USD', parseFloat(p.ics2Usd) || 0, ''],
      ['Local Charge orig. USD', parseFloat(p.localChargeUsd) || 0, ''],
      ['TOT Nolo USD', c.noloTotUsd, ''],
      ['TOT Nolo EUR (cambio)', c.noloTotEur, c.noloPerPezzo],
      [],
      ['— EXTRA NOLO EUR (art.74) —', '', ''],
      ['THC Sbarco', parseFloat(p.costiSbarco) || 0, ''],
      ['Addizionali Comp. Marittima', parseFloat(p.addizionaliCompMar) || 0, ''],
      ['Dogana Import', parseFloat(p.doganaImport) || 0, ''],
      ['Fuel Surcharge EUR', parseFloat(p.fuelSurcharge) || 0, ''],
      ['ECA EUR', parseFloat(p.ecaEur) || 0, ''],
      ['ICS2 EUR', parseFloat(p.ics2Eur) || 0, ''],
      ['Local Charge EUR', parseFloat(p.localChargeEur) || 0, ''],
      ['TOT Extra Nolo EUR', c.extraNoloTot, c.extraNoloPerPezzo],
      [],
      ['— SERVIZI CON IVA 22% —', '', ''],
      ['Delivery Order', parseFloat(p.deliveryOrder) || 0, ''],
      ['Trasporto Interno', c.trasportoBase || parseFloat(p.trasportoInterno) || 0, ''],
      [`Fuel Trasporto (${p.fuelTrasportoPct || 0}%)`, c.fuelTrasportoImporto || 0, ''],
      ['IVA Spedizioniere', parseFloat(p.ivaSpedizioniere) || 0, ''],
      ['TOT Servizi IVA', c.serviziIvaTot, c.serviziIvaPerPezzo],
      [],
      ['— VOCI FISSE —', '', ''],
      ['Aggiustamento (v.45)', parseFloat(p.aggiustamento) || 0, c.aggiustamentoPerPezzo || 0],
      ['9AJ Diritto Marittimo', dirittoTotale9AJ, c.tasseFissePerPezzo],
      ['Commissioni', parseFloat(p.commissioni) || 0, c.commissioniPerPezzo],
      [],
      ['— IMPOSIZIONI DOGANALI —', '', ''],
      ['Dazio A00', c.dazioTotale, c.dazioTotale / c.qtyTot],
      ['Antidumping A30', antidumpingTotale, antidumpingTotale / c.qtyTot],
      ['9AJ', dirittoTotale9AJ, dirittoTotale9AJ / c.qtyTot],
      ['IVA B00', c.ivaTotale, c.ivaTotale / c.qtyTot],
      ['TOT Imposizioni', c.totaleImposizioni, c.totaleImposizioni / c.qtyTot],
      [],
      ['— TOTALI FINALI —', '', ''],
      ['Valore FOB EUR', c.fobTotEur, c.fobTotEur / c.qtyTot],
      ['Valore statistico', c.valoreStatistico, c.valoreStatistico / c.qtyTot],
      ['Totale costi accessori', c.extraNoloTot + c.serviziIvaTot + (parseFloat(p.commissioni) || 0), ''],
      ['COSTO TOTALE IMPORT', c.costoTotaleImport, c.costoTotaleImport / c.qtyTot],
      ['Markup vendita', p.markup, ''],
      ['TOTALE VENDITA STIMATO', c.costoTotaleImport * (parseFloat(p.markup) || 1), (c.costoTotaleImport * (parseFloat(p.markup) || 1)) / c.qtyTot]
    ];
    const wsCosti = XLSX.utils.aoa_to_sheet(costi);
    wsCosti['!cols'] = [{ wch: 38 }, { wch: 16 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, wsCosti, 'Costi');

    const fileName = `bolla_${p.fornitore.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  // Genera PDF bolla DAU (stile ufficiale - fedele al DAU H1)
  const generaPdfBolla = (bolla, modalita = 'ufficiale') => {
    const c = bolla.calcolo;
    const p = bolla.params;
    const win = window.open('', '_blank');
    if (!win) { alert('Abilita popup per generare il PDF'); return; }

    // Retrocompatibilità: le vecchie bolle potrebbero non avere questi campi
    if (c.dirittoTotale9AJ === undefined) c.dirittoTotale9AJ = parseFloat(p.dirittoDoganale9AJ) || 0;
    if (c.antidumpingTotale === undefined) c.antidumpingTotale = c.valoreStatistico * (p.antidumpingPct || 0) / 100;
    if (c.prezzoArticolo === undefined) c.prezzoArticolo = c.fobTotEur;

    const tassoUsdEur = 1 / p.tassoEurUsd;
    const dataOggi = new Date().toLocaleDateString('it-IT');
    const dataSpedFmt = p.dataSpedizione ? new Date(p.dataSpedizione).toLocaleDateString('it-IT') : dataOggi;
    const antidumpingImporto = c.antidumpingTotale;

    const htmlUfficiale = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>DAU H1 - ${p.fornitore}</title>
<style>
  @page { size: A4 portrait; margin: 5mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Arial', sans-serif; font-size: 8px; color: #000; background: #fff; padding: 2px; }

  .dau-header { text-align: center; font-weight: bold; font-size: 10px; padding: 3px; border: 1.5px solid #000; margin-bottom: 2px; background: #f0f0f0; }
  .dau-subheader { text-align: center; font-size: 9px; padding: 2px 0 4px; font-weight: bold; }

  .dau-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .dau-table td { border: 1px solid #000; padding: 2px 3px; vertical-align: top; font-size: 8px; line-height: 1.15; }
  .cell-num { display: inline-block; background: #000; color: #fff; font-weight: bold; padding: 1px 3px; font-size: 7px; margin-right: 2px; min-width: 14px; text-align: center; }
  .cell-label { font-size: 7px; color: #333; font-weight: 600; text-transform: uppercase; }
  .cell-val { font-size: 9px; font-weight: bold; color: #000; }
  .cell-val.big { font-size: 10px; }
  .small-label { font-size: 6.5px; color: #555; display: block; }

  .party-block { min-height: 50px; }
  .party-name { font-size: 9px; font-weight: bold; margin-top: 1px; }
  .party-addr { font-size: 7.5px; color: #222; line-height: 1.3; }

  .dau-section-title { background: #333; color: #fff; padding: 2px 5px; font-size: 8px; font-weight: bold; margin-top: 3px; text-transform: uppercase; letter-spacing: 0.5px; }

  /* Tabella imposizioni */
  .imposte-tab { width: 100%; border-collapse: collapse; margin-top: 2px; }
  .imposte-tab th { background: #333; color: #fff; padding: 3px 5px; font-size: 8px; text-align: left; border: 1px solid #000; }
  .imposte-tab td { border: 1px solid #000; padding: 3px 5px; font-size: 8px; font-family: 'Consolas', monospace; }
  .imposte-tab td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .imposte-tab .total-row { background: #222; color: #fff; font-weight: bold; }
  .imposte-tab .total-row td { color: #fff; border-color: #000; }

  /* Firma */
  .signature { margin-top: 8px; display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
  .sig-box { border: 1px solid #000; padding: 4px 6px; min-height: 45px; font-size: 8px; }
  .sig-box b { font-size: 8.5px; }

  /* Menzioni speciali - formato pre */
  .menzioni-txt { font-family: 'Consolas', monospace; font-size: 7.5px; white-space: pre-line; color: #222; line-height: 1.3; }

  /* Utility */
  .txt-right { text-align: right; }
  .txt-center { text-align: center; }
  .bold { font-weight: bold; }
  .bg-yellow { background: #fffde7; }

  @media print {
    body { padding: 0; }
    .no-print { display: none !important; }
  }
  .no-print-btn { position: fixed; bottom: 15px; right: 15px; background: #1976d2; color: #fff; border: none; padding: 10px 20px; font-size: 12px; font-weight: bold; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.25); border-radius: 3px; z-index: 1000; }
  .no-print-btn:hover { background: #0d47a1; }
</style></head><body>

<div class="dau-header">DATI TRASMESSI ALLA DOGANA IN H1 A UFFICIO DI SPEDIZIONE/ESPORTAZIONE/DESTINATARIO</div>
<div class="dau-subheader">DOGANA DI AUGUSTA — SOT AUGUSTA — TRASMESSI DA</div>

<!-- PRIMA RIGA: Speditore + Formulari/Dichiarazione -->
<table class="dau-table">
  <colgroup>
    <col style="width:40%"><col style="width:12%"><col style="width:13%"><col style="width:10%"><col style="width:12%"><col style="width:13%">
  </colgroup>
  <tr>
    <td rowspan="2" class="party-block">
      <span class="cell-num">2</span><span class="cell-label">Speditore/Esportatore  N. CN0</span>
      <div class="party-name">${p.fornitore || '—'}</div>
      <div class="party-addr">${p.indirizzoFornitore || ''}</div>
      <div style="margin-top:2px;font-size:7px;color:#666;"><b>IM</b></div>
    </td>
    <td><span class="cell-num">3</span><span class="cell-label">Formulari</span><div class="cell-val">1  1</div></td>
    <td><span class="cell-num">1</span><span class="cell-label">DICHIARAZIONE</span><div class="cell-val">Altro ICS (S32)</div></td>
    <td><span class="cell-num">4</span><span class="cell-label">Dati Carico</span></td>
    <td><span class="cell-num">5</span><span class="cell-label">Articoli</span><div class="cell-val">1</div></td>
    <td><span class="cell-num">6</span><span class="cell-label">Totale Colli</span><div class="cell-val">${c.qtyTot}</div></td>
  </tr>
  <tr>
    <td colspan="5"><span class="cell-num">7</span><span class="cell-label">Numeri di Riferimento</span><div class="cell-val" style="font-family:'Consolas',monospace;font-size:8px;">${p.nrRiferimento || '—'}</div></td>
  </tr>
</table>

<!-- Importatore + Dichiarante -->
<table class="dau-table">
  <colgroup><col style="width:50%"><col style="width:50%"></colgroup>
  <tr>
    <td class="party-block">
      <span class="cell-num">8</span><span class="cell-label">Importatore N. ${p.importatorePiva || ''}</span>
      <div class="party-name">${p.importatore || '—'}</div>
      <div class="party-addr">${p.importatoreAttivita || ''}<br>${p.importatoreIndirizzo || ''}</div>
    </td>
    <td class="party-block">
      <span class="cell-num">14</span><span class="cell-label">Dichiarante/Rappresentante N. ${p.dichiaranteCf || ''}  2</span>
      <div class="party-name">${p.dichiarante || '—'}</div>
      <div class="party-addr">${p.dichiaranteIndirizzo || ''}</div>
    </td>
  </tr>
</table>

<!-- Riga trasporto e paese -->
<table class="dau-table">
  <colgroup>
    <col style="width:25%"><col style="width:8%"><col style="width:10%"><col style="width:10%"><col style="width:8%"><col style="width:13%"><col style="width:13%"><col style="width:13%">
  </colgroup>
  <tr>
    <td><span class="cell-num">18</span><span class="cell-label">Identità e nazionalità mezzo di trasporto all'arrivo</span>
      <div class="cell-val">${p.nave ? 'NAVE ' + p.nave : 'NAVE'} ${dataSpedFmt} IT</div>
    </td>
    <td><span class="cell-num">19</span><span class="cell-label">Ctr.</span><div class="cell-val">1</div></td>
    <td><span class="cell-num">21</span><span class="cell-label">Ident. mezzo frontiera</span><div class="cell-val">&nbsp;</div></td>
    <td><span class="cell-num">25</span><span class="cell-label">Modo trasp. frontiera</span><div class="cell-val">1</div></td>
    <td><span class="cell-num">26</span><span class="cell-label">Modo interno</span><div class="cell-val">1</div></td>
    <td><span class="cell-num">29</span><span class="cell-label">Uff. Dichiarazione</span><div class="cell-val" style="font-size:8px;">${p.ufficioDogana || 'IT099101'}</div></td>
    <td><span class="cell-num">30</span><span class="cell-label">Localizz. merci</span><div class="cell-val">${p.localizzazioneMerci || '-FE'}</div></td>
    <td><span class="cell-num">9</span><span class="cell-label">Nulla Osta</span><div class="cell-val">&nbsp;</div></td>
  </tr>
</table>

<!-- Paesi e condizioni -->
<table class="dau-table">
  <colgroup>
    <col style="width:15%"><col style="width:15%"><col style="width:20%"><col style="width:20%"><col style="width:15%"><col style="width:15%">
  </colgroup>
  <tr>
    <td><span class="cell-num">15</span><span class="cell-label">Paese spedizione/export</span><div class="cell-val">CINA</div><span class="small-label">CN</span></td>
    <td><span class="cell-num">16</span><span class="cell-label">Paese origine</span><div class="cell-val">CINA</div><span class="small-label">CN</span></td>
    <td><span class="cell-num">17</span><span class="cell-label">Paese destinazione</span><div class="cell-val">ITALIA</div><span class="small-label">IT — CT</span></td>
    <td><span class="cell-num">20</span><span class="cell-label">Condizioni di consegna</span><div class="cell-val">${p.incoterm || 'FOB'} ${p.portoImbarco || 'QINGDAO'}</div><span class="small-label">3</span></td>
    <td><span class="cell-num">22</span><span class="cell-label">Moneta ed importo fatturato</span><div class="cell-val">USD ${fmtEur(c.fobTotUsd)}</div></td>
    <td><span class="cell-num">24</span><span class="cell-label">Nat. transaz.</span><div class="cell-val">1 1</div></td>
  </tr>
  <tr>
    <td colspan="2"><span class="cell-num">23</span><span class="cell-label">Tasso di cambio</span><div class="cell-val">${p.tassoEurUsd.toFixed(6)}</div></td>
    <td colspan="2"><span class="cell-num">12</span><span class="cell-label">Elementi del valore</span><div class="cell-val">${fmtEur(c.fobTotEur)}</div></td>
    <td><span class="cell-num">10</span><span class="cell-label">Paese ult. destin.</span><div class="cell-val">&nbsp;</div></td>
    <td><span class="cell-num">11</span><span class="cell-label">Paese transaz./produz.</span><div class="cell-val">&nbsp;</div></td>
  </tr>
</table>

<!-- Colli e descrizione merci -->
<table class="dau-table">
  <colgroup><col style="width:100%"></colgroup>
  <tr>
    <td>
      <span class="cell-num">31</span><span class="cell-label">Colli e designazione delle merci — Marchi e numeri / N contenitori / Quantità e natura</span>
      <div class="cell-val" style="margin-top:2px;">${p.container || '—'}</div>
      <div style="font-family:'Consolas',monospace;font-size:8px;margin-top:1px;">PP PEZZI ${c.qtyTot} — VAL.FATT ${fmtEur(c.fobTotUsd)} USD</div>
      <div class="bold" style="font-size:9px;margin-top:2px;">PNEUMATICI NUOVI PER AUTOVETTURE, ETC.</div>
    </td>
  </tr>
</table>

<!-- Articolo 1 - Blocco dettaglio articolo -->
<table class="dau-table">
  <colgroup>
    <col style="width:8%"><col style="width:17%"><col style="width:10%"><col style="width:13%"><col style="width:10%"><col style="width:13%"><col style="width:13%"><col style="width:16%">
  </colgroup>
  <tr>
    <td><span class="cell-num">32</span><span class="cell-label">Articolo N.</span><div class="cell-val">1</div></td>
    <td><span class="cell-num">33</span><span class="cell-label">Codice delle merci</span><div class="cell-val bg-yellow">${p.codiceTaric}</div></td>
    <td><span class="cell-num">34</span><span class="cell-label">Cod. P. origine</span><div class="cell-val">a CN b</div></td>
    <td><span class="cell-num">35</span><span class="cell-label">Massa Lorda (kg)</span><div class="cell-val">${p.massaLorda ? fmtEur(p.massaLorda) : '—'}</div></td>
    <td><span class="cell-num">36</span><span class="cell-label">Preferenze</span><div class="cell-val">${p.preferenze || '100'}</div></td>
    <td><span class="cell-num">37</span><span class="cell-label">REGIME</span><div class="cell-val bg-yellow">${p.regime || '4000'}</div></td>
    <td><span class="cell-num">38</span><span class="cell-label">Massa Netta (kg)</span><div class="cell-val">${p.massaNetta ? fmtEur(p.massaNetta) : '—'}</div></td>
    <td><span class="cell-num">39</span><span class="cell-label">Contingenti</span><div class="cell-val">&nbsp;</div></td>
  </tr>
  <tr>
    <td colspan="4"><span class="cell-num">40</span><span class="cell-label">Dichiarazione sommaria / Documento precedente</span><div class="cell-val" style="font-family:'Consolas',monospace;font-size:8px;">337  ${p.docPrecedente || '—'}</div></td>
    <td colspan="2"><span class="cell-num">41</span><span class="cell-label">Unità supplementari</span><div class="cell-val">SI ${fmtEur(c.qtyTot)}</div></td>
    <td colspan="2"><span class="cell-num">42</span><span class="cell-label">Prezzo dell'articolo</span><div class="cell-val">${fmtEur(c.prezzoArticolo)} 1</div></td>
  </tr>
  <tr>
    <td colspan="2"><span class="cell-num">43</span><span class="cell-label">Cod. M.V.</span><div class="cell-val">Codice MS</div></td>
    <td colspan="2"><span class="cell-num">45</span><span class="cell-label">Aggiustamento</span><div class="cell-val">${fmtEur(p.aggiustamento || 0)}</div></td>
    <td colspan="4"><span class="cell-num">46</span><span class="cell-label">Valore statistico</span><div class="cell-val big bg-yellow">${fmtEur(c.valoreStatistico)}</div></td>
  </tr>
</table>

<!-- Menzioni speciali 44 -->
<table class="dau-table">
  <colgroup><col style="width:100%"></colgroup>
  <tr>
    <td>
      <span class="cell-num">44</span><span class="cell-label">Menzioni speciali / Documenti presentati / Certificati ed autorizzazioni</span>
      <div class="menzioni-txt">${p.menzioniSpeciali || '—'}</div>
    </td>
  </tr>
</table>

<!-- 47 IMPOSIZIONI -->
<div class="dau-section-title">47 — CALCOLO DELLE IMPOSIZIONI</div>
<table class="imposte-tab">
  <thead>
    <tr>
      <th style="width:8%">Tipo</th>
      <th>Descrizione</th>
      <th class="num" style="width:18%">Base Imponibile</th>
      <th class="num" style="width:15%">Aliquota %</th>
      <th class="num" style="width:18%">Importo €</th>
      <th style="width:5%">MP</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td class="bold">A00</td><td>Dazio Doganale</td>
      <td class="num">${fmtEur(c.valoreStatistico)}</td>
      <td class="num">${p.dazioPct.toFixed(4).replace('.', ',')}</td>
      <td class="num bold">${fmtEur(c.dazioTotale)}</td>
      <td class="txt-center">E</td>
    </tr>
    ${p.antidumpingPct > 0 ? `<tr>
      <td class="bold">A30</td><td>Dazio Antidumping</td>
      <td class="num">${fmtEur(c.valoreStatistico)}</td>
      <td class="num">${p.antidumpingPct.toFixed(4).replace('.', ',')}</td>
      <td class="num bold">${fmtEur(antidumpingImporto)}</td>
      <td class="txt-center">E</td>
    </tr>` : ''}
    <tr>
      <td class="bold">9AJ</td><td>Diritto Doganale Marittimo</td>
      <td class="num">${fmtEur(p.unita9AJ || 4)}</td>
      <td class="num">1,0908000</td>
      <td class="num bold">${fmtEur(c.dirittoTotale9AJ)}</td>
      <td class="txt-center">G</td>
    </tr>
    <tr>
      <td class="bold">B00</td><td>IVA Importazione</td>
      <td class="num">${fmtEur(c.valoreStatistico + c.dazioTotale + antidumpingImporto + c.dirittoTotale9AJ)}</td>
      <td class="num">${p.ivaPct.toFixed(4).replace('.', ',')}</td>
      <td class="num bold">${fmtEur(c.ivaTotale)}</td>
      <td class="txt-center">G</td>
    </tr>
    <tr class="total-row">
      <td colspan="4" class="bold txt-right">TOTALE IMPOSIZIONI BOLLA</td>
      <td class="num bold">${fmtEur(c.totaleImposizioni)}</td>
      <td></td>
    </tr>
  </tbody>
</table>

<!-- Dilazione e firme -->
<table class="dau-table" style="margin-top:3px;">
  <colgroup><col style="width:50%"><col style="width:50%"></colgroup>
  <tr>
    <td><span class="cell-num">48</span><span class="cell-label">Dilazione di pagamento</span><div class="cell-val" style="font-family:'Consolas',monospace;font-size:8px;">${p.dilazionePagamento || '—'}</div></td>
    <td><span class="cell-num">49</span><span class="cell-label">Identificazione del deposito</span><div class="cell-val">B Dati contabili</div></td>
  </tr>
</table>

<div class="signature">
  <div class="sig-box">
    <b>C — UFFICIO DI PARTENZA</b><br>
    DOGANA DI AUGUSTA — SOT AUGUSTA
    <div style="margin-top:8px;"><b>52</b> Garanzia — Codice __________</div>
    <div><b>53</b> Ufficio di destinazione (e paese) __________</div>
    <div style="margin-top:6px;"><b>CONTROLLO UFFICIO DESTINAZIONE</b>: Risultato __________</div>
    <div>Suggelli apposti: Numero __________  marche __________</div>
    <div>Termine (data limite): __________   Firma: __________</div>
  </div>
  <div class="sig-box">
    <b>54 — LUOGO E DATA</b><br>
    AUGUSTA ${dataOggi}<br><br>
    Firma e nome del dichiarante/rappresentante:<br>
    <div style="margin-top:15px; border-top: 1px solid #000; padding-top:3px;">
      <b>${p.dichiarante || 'DIOLOSA\' ROSSELLA ADELE'}</b><br>
      <span style="font-size:7.5px;">DOGANALISTA</span>
    </div>
  </div>
</div>

<button class="no-print-btn no-print" onclick="window.print()">🖨 STAMPA / SALVA PDF</button>

</body></html>`;

    const htmlSemplificato = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Riepilogo Importazione ${p.fornitore}</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #263238; margin: 0; padding: 12px; }
  h1 { font-size: 18px; color: #0d47a1; border-bottom: 2px solid #0d47a1; padding-bottom: 6px; margin: 0 0 12px 0; }
  h2 { font-size: 13px; color: #37474f; background: #eceff1; padding: 5px 8px; margin: 12px 0 6px 0; border-left: 3px solid #1976d2; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; margin-bottom: 10px; font-size: 10px; }
  .info-grid .lbl { color: #546e7a; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 10px; font-size: 10px; }
  th { background: #37474f; color: white; text-align: left; padding: 5px 8px; font-weight: 600; }
  td { padding: 4px 8px; border-bottom: 1px solid #cfd8dc; }
  tr:nth-child(even) td { background: #f5f7fa; }
  .num { text-align: right; font-variant-numeric: tabular-nums; font-family: 'Consolas', monospace; }
  .tot-row { background: #1976d2 !important; color: white; font-weight: bold; }
  .tot-row td { background: #1976d2 !important; color: white; }
  .summary-box { background: #e3f2fd; border: 1px solid #1976d2; padding: 10px; margin-top: 15px; }
  .summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 20px; font-size: 11px; }
  .summary-grid b { color: #0d47a1; }
  .price-final { color: #0d47a1; font-weight: bold; }
  @media print { .no-print { display: none; } body { padding: 0; } }
  .no-print-btn { position: fixed; bottom: 15px; right: 15px; background: #1976d2; color: #fff; border: none; padding: 10px 20px; font-size: 12px; font-weight: bold; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.25); border-radius: 3px; z-index: 1000; }
</style></head><body>

<h1>Riepilogo Importazione Doganale</h1>

<h2>Dati Spedizione</h2>
<div class="info-grid">
  <div><span class="lbl">Fornitore:</span> ${p.fornitore}</div>
  <div><span class="lbl">Fattura n°:</span> ${p.fattura || '—'}</div>
  <div><span class="lbl">Porto imbarco:</span> ${p.portoImbarco || '—'}</div>
  <div><span class="lbl">Porto sbarco:</span> ${p.portoSbarco || '—'}</div>
  <div><span class="lbl">Nave:</span> ${p.nave || '—'}</div>
  <div><span class="lbl">Container:</span> ${p.container || '—'}</div>
  <div><span class="lbl">Incoterm:</span> ${p.incoterm}</div>
  <div><span class="lbl">Data:</span> ${dataSpedFmt}</div>
  <div><span class="lbl">Spedizioniere:</span> ${p.spedizioniere}</div>
  <div><span class="lbl">Importatore:</span> ${p.importatore} (${p.importatorePiva || ''})</div>
</div>

<h2>Parametri Valutari</h2>
<div class="info-grid">
  <div><span class="lbl">Tasso EUR/USD:</span> ${p.tassoEurUsd.toFixed(6)}</div>
  <div><span class="lbl">Tasso USD/EUR:</span> ${tassoUsdEur.toFixed(6)}</div>
  <div><span class="lbl">Totale FOB USD:</span> $ ${fmtEur(c.fobTotUsd)}</div>
  <div><span class="lbl">Totale FOB EUR:</span> € ${fmtEur(c.fobTotEur)}</div>
  <div><span class="lbl">Aggiustamento (v.45):</span> € ${fmtEur(p.aggiustamento || 0)}</div>
  <div><span class="lbl">Valore Statistico (v.46):</span> € ${fmtEur(c.valoreStatistico)}</div>
  <div><span class="lbl">Quantità totale:</span> ${c.qtyTot} pz</div>
  <div><span class="lbl">Codice TARIC:</span> ${p.codiceTaric}</div>
</div>

<h2>Costi Accessori</h2>
<table>
  <thead><tr><th>Voce</th><th class="num">Totale</th><th class="num">Per pezzo</th></tr></thead>
  <tbody>
    <tr><td>Nolo marittimo USD (convertito EUR)</td><td class="num">€ ${fmtEur(c.noloTotEur)}</td><td class="num">€ ${fmtEur(c.noloPerPezzo)}</td></tr>
    <tr><td>Extra Nolo locale (art.74)</td><td class="num">€ ${fmtEur(c.extraNoloTot)}</td><td class="num">€ ${fmtEur(c.extraNoloPerPezzo)}</td></tr>
    <tr><td>Servizi con IVA 22%</td><td class="num">€ ${fmtEur(c.serviziIvaTot)}</td><td class="num">€ ${fmtEur(c.serviziIvaPerPezzo)}</td></tr>
    <tr><td>Commissioni</td><td class="num">€ ${fmtEur(parseFloat(p.commissioni) || 0)}</td><td class="num">€ ${fmtEur(c.commissioniPerPezzo)}</td></tr>
  </tbody>
</table>

<h2>Imposizioni Doganali</h2>
<table>
  <thead><tr><th>Codice</th><th>Descrizione</th><th class="num">Base Imp.</th><th class="num">Aliquota</th><th class="num">Importo</th></tr></thead>
  <tbody>
    <tr><td>A00</td><td>Dazio Doganale</td><td class="num">€ ${fmtEur(c.valoreStatistico)}</td><td class="num">${p.dazioPct}%</td><td class="num">€ ${fmtEur(c.dazioTotale)}</td></tr>
    ${p.antidumpingPct > 0 ? `<tr><td>A30</td><td>Antidumping</td><td class="num">€ ${fmtEur(c.valoreStatistico)}</td><td class="num">${p.antidumpingPct}%</td><td class="num">€ ${fmtEur(antidumpingImporto)}</td></tr>` : ''}
    <tr><td>9AJ</td><td>Diritto Doganale Marittimo (${p.unita9AJ || 4} unità × 1,0908 €)</td><td class="num">${fmtEur(p.unita9AJ || 4)}</td><td class="num">1,0908</td><td class="num">€ ${fmtEur(c.dirittoTotale9AJ)}</td></tr>
    <tr><td>B00</td><td>IVA Importazione</td><td class="num">€ ${fmtEur(c.valoreStatistico + c.dazioTotale + antidumpingImporto + c.dirittoTotale9AJ)}</td><td class="num">${p.ivaPct}%</td><td class="num">€ ${fmtEur(c.ivaTotale)}</td></tr>
    <tr class="tot-row"><td colspan="4">TOTALE IMPOSIZIONI BOLLA</td><td class="num">€ ${fmtEur(c.totaleImposizioni)}</td></tr>
  </tbody>
</table>

<h2>Dettaglio Articoli</h2>
<table>
  <thead>
    <tr>
      <th>#</th><th>Modello</th><th>Misura</th><th class="num">Qty</th>
      <th class="num">USD/pz</th><th class="num">CIF €</th><th class="num">Dazio €</th>
      <th class="num">IVA €</th><th class="num">PFU €</th>
      <th class="num">Costo finale €</th><th class="num">Prezzo vend. €</th>
    </tr>
  </thead>
  <tbody>
    ${c.righe.map((r, i) => `
      <tr>
        <td>${i + 1}</td><td>${r.modello || '—'}</td><td>${r.misura || '—'}</td>
        <td class="num">${r.qty}</td><td class="num">${fmtEur(r.prezzoUsd)}</td>
        <td class="num">${fmtEur(r.cifPerPezzo)}</td><td class="num">${fmtEur(r.dazioPerPezzo)}</td>
        <td class="num">${fmtEur(r.ivaPerPezzo)}</td><td class="num">${fmtEur(r.pfuPezzo)}</td>
        <td class="num price-final">${fmtEur(r.costoFinale)}</td>
        <td class="num price-final">${fmtEur(r.prezzoVendita)}</td>
      </tr>
    `).join('')}
  </tbody>
</table>

<div class="summary-box">
  <h2 style="margin-top:0; background:transparent; color:#0d47a1; border:none; padding:0;">RIEPILOGO FINALE</h2>
  <div class="summary-grid">
    <div>Valore FOB Totale: <b>€ ${fmtEur(c.fobTotEur)}</b></div>
    <div>Valore Statistico (CIF + aggiust.): <b>€ ${fmtEur(c.valoreStatistico)}</b></div>
    <div>Totale Dazio + IVA + Diritti: <b>€ ${fmtEur(c.totaleImposizioni)}</b></div>
    <div>Totale Costi Accessori: <b>€ ${fmtEur(c.extraNoloTot + c.serviziIvaTot + (parseFloat(p.commissioni) || 0))}</b></div>
    <div style="grid-column: 1 / -1; border-top: 1px solid #0d47a1; padding-top: 6px; margin-top: 4px; font-size: 13px;">
      <b>COSTO TOTALE IMPORTAZIONE: € ${fmtEur(c.costoTotaleImport)}</b>
    </div>
    <div style="grid-column: 1 / -1; font-size: 12px;">
      Costo medio per pneumatico: <b>€ ${fmtEur(c.costoTotaleImport / c.qtyTot)}</b>
    </div>
  </div>
</div>

<div style="margin-top: 20px; font-size: 9px; color: #78909c; text-align: center;">
  Documento generato il ${dataOggi} — Gestionale EU-Import v1.2
</div>

<button class="no-print-btn no-print" onclick="window.print()">🖨 STAMPA / SALVA PDF</button>

</body></html>`;

    win.document.write(modalita === 'ufficiale' ? htmlUfficiale : htmlSemplificato);
    win.document.close();
  };

  // ===================================================================
  // RENDER
  // ===================================================================
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#eceff1', color: '#37474f', fontFamily: 'Segoe UI, Tahoma, sans-serif', fontSize: 12 }}>
        Caricamento archivio in corso...
      </div>
    );
  }

  const previewRows = rawData.slice(1, 6);
  const chinaPreviewRows = chinaRawData.slice(1, 6);
  const today = new Date().toLocaleDateString('it-IT');
  const now = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

  // Aggiorna parametro Cina
  const setP = (k, v) => setChinaParams(prev => ({ ...prev, [k]: v }));

  return (
    <div className="erp">
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .erp { min-height: 100vh; background: #eceff1; color: #263238; font-family: 'Segoe UI', Tahoma, 'Liberation Sans', sans-serif; font-size: 12px; line-height: 1.4; -webkit-font-smoothing: antialiased; }

        .menubar { background: linear-gradient(to bottom, #455a64 0%, #37474f 100%); color: #eceff1; padding: 0; display: flex; align-items: center; border-bottom: 1px solid #263238; font-size: 12px; height: 28px; }
        .menubar-brand { padding: 0 14px; font-weight: 700; letter-spacing: 0.3px; height: 100%; display: flex; align-items: center; gap: 8px; background: #263238; border-right: 1px solid #1c262a; }
        .menubar-item { padding: 0 12px; height: 100%; display: flex; align-items: center; cursor: pointer; border-right: 1px solid rgba(255,255,255,0.08); color: #cfd8dc; }
        .menubar-item:hover { background: rgba(255,255,255,0.1); color: #fff; }
        .menubar-right { margin-left: auto; display: flex; align-items: center; gap: 0; height: 100%; }
        .menubar-right-item { padding: 0 12px; height: 100%; display: flex; align-items: center; gap: 6px; color: #b0bec5; border-left: 1px solid rgba(255,255,255,0.08); font-size: 11px; }
        .menubar-right-item.status { color: #81c784; }
        .menubar-right-item .dot { width: 7px; height: 7px; border-radius: 50%; background: #4caf50; box-shadow: 0 0 4px rgba(76,175,80,0.8); }

        .toolbar { background: #cfd8dc; border-bottom: 1px solid #90a4ae; padding: 6px 10px; display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
        .tbtn { background: linear-gradient(to bottom, #fafafa 0%, #e0e0e0 100%); border: 1px solid #90a4ae; padding: 5px 10px; font-family: inherit; font-size: 11px; color: #263238; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; border-radius: 2px; height: 26px; }
        .tbtn:hover { background: linear-gradient(to bottom, #fff 0%, #eceff1 100%); border-color: #546e7a; }
        .tbtn:active { background: #cfd8dc; box-shadow: inset 0 1px 2px rgba(0,0,0,0.15); }
        .tbtn:disabled { opacity: 0.5; cursor: not-allowed; }
        .tbtn.primary { background: linear-gradient(to bottom, #42a5f5 0%, #1976d2 100%); color: #fff; border-color: #1565c0; font-weight: 600; }
        .tbtn.primary:hover { background: linear-gradient(to bottom, #64b5f6 0%, #1e88e5 100%); }
        .tbtn.china { background: linear-gradient(to bottom, #ef5350 0%, #c62828 100%); color: #fff; border-color: #b71c1c; font-weight: 600; }
        .tbtn.china:hover { background: linear-gradient(to bottom, #e57373 0%, #d32f2f 100%); }
        .tbtn.success { background: linear-gradient(to bottom, #66bb6a 0%, #388e3c 100%); color: #fff; border-color: #2e7d32; font-weight: 600; }
        .tbtn.success:hover { background: linear-gradient(to bottom, #81c784 0%, #43a047 100%); }
        .tbtn.danger { color: #c62828; }
        .tbtn.danger:hover { background: #ffebee; border-color: #c62828; }
        .tb-sep { width: 1px; height: 20px; background: #90a4ae; margin: 0 4px; }
        .tb-label { font-size: 11px; color: #455a64; font-weight: 600; margin: 0 6px 0 2px; }
        .tb-input { background: #fff; border: 1px solid #90a4ae; padding: 3px 6px; font-family: inherit; font-size: 11px; height: 26px; width: 70px; border-radius: 2px; }
        .tb-input:focus { outline: none; border-color: #1976d2; box-shadow: 0 0 0 2px rgba(25,118,210,0.2); }

        .workspace { display: grid; grid-template-columns: 220px 1fr; height: calc(100vh - 56px); }
        @media (max-width: 900px) { .workspace { grid-template-columns: 1fr; height: auto; } }

        .sidenav { background: #fff; border-right: 1px solid #b0bec5; display: flex; flex-direction: column; overflow-y: auto; }
        .sidenav-header { background: #eceff1; border-bottom: 1px solid #b0bec5; padding: 8px 12px; font-size: 10px; font-weight: 700; color: #546e7a; text-transform: uppercase; letter-spacing: 0.8px; }
        .sidenav-item { padding: 8px 12px; font-size: 12px; color: #37474f; cursor: pointer; display: flex; align-items: center; gap: 8px; border-left: 3px solid transparent; border-bottom: 1px solid #f5f5f5; }
        .sidenav-item:hover { background: #f5f7fa; }
        .sidenav-item.active { background: #e3f2fd; border-left-color: #1976d2; color: #0d47a1; font-weight: 600; }
        .sidenav-item .badge { margin-left: auto; background: #eceff1; color: #546e7a; font-size: 10px; padding: 1px 6px; border-radius: 8px; font-weight: 600; }
        .sidenav-item.active .badge { background: #1976d2; color: #fff; }
        .sidenav-stats { padding: 10px 12px; border-top: 1px solid #b0bec5; background: #f5f7fa; font-size: 11px; }
        .sidenav-stat { display: flex; justify-content: space-between; padding: 3px 0; color: #546e7a; }
        .sidenav-stat b { color: #263238; font-weight: 700; }

        .content { background: #eceff1; overflow-y: auto; display: flex; flex-direction: column; }

        .window { background: #fff; border: 1px solid #90a4ae; margin: 8px; display: flex; flex-direction: column; flex: 1; }
        .window-title { background: linear-gradient(to bottom, #546e7a 0%, #455a64 100%); color: #fff; padding: 5px 10px; font-size: 11px; font-weight: 700; letter-spacing: 0.3px; display: flex; align-items: center; justify-content: space-between; text-transform: uppercase; }
        .window-title.china-title { background: linear-gradient(to bottom, #c62828 0%, #b71c1c 100%); }
        .window-title .breadcrumb { font-weight: 400; font-size: 10px; color: #cfd8dc; text-transform: none; letter-spacing: 0; }

        .filters { background: #f5f7fa; border-bottom: 1px solid #cfd8dc; padding: 8px 10px; display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; align-items: end; }
        .fld { display: flex; flex-direction: column; gap: 3px; }
        .fld label { font-size: 10px; color: #546e7a; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; }
        .fld label .req { color: #d32f2f; margin-left: 2px; }
        .fld .ctl { background: #fff; border: 1px solid #90a4ae; padding: 5px 8px; font-family: inherit; font-size: 12px; color: #263238; height: 28px; border-radius: 2px; }
        .fld .ctl:focus { outline: none; border-color: #1976d2; box-shadow: 0 0 0 2px rgba(25,118,210,0.2); }
        .fld .ctl[readonly] { background: #eceff1; color: #546e7a; }
        .fld .ctl.calc { background: #e8f5e9; color: #1b5e20; font-weight: 600; font-family: 'Consolas', monospace; }

        .grid-wrap { flex: 1; overflow: auto; background: #fff; border-top: 1px solid #cfd8dc; }
        table.grid { width: 100%; border-collapse: collapse; font-size: 12px; }
        table.grid thead th { background: linear-gradient(to bottom, #eceff1 0%, #cfd8dc 100%); color: #263238; font-size: 11px; font-weight: 700; text-align: left; padding: 6px 8px; border: 1px solid #90a4ae; border-top: none; position: sticky; top: 0; z-index: 1; cursor: pointer; user-select: none; white-space: nowrap; text-transform: uppercase; letter-spacing: 0.3px; }
        table.grid thead th:hover { background: linear-gradient(to bottom, #f5f7fa 0%, #b0bec5 100%); }
        table.grid thead th.num { text-align: right; }
        table.grid thead th .si { color: #1976d2; margin-left: 3px; font-size: 10px; }
        table.grid tbody td { padding: 4px 8px; border: 1px solid #e0e0e0; color: #263238; vertical-align: middle; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 280px; }
        table.grid.compact tbody td { padding: 1px 6px; font-size: 11px; }
        table.grid.compact thead th { padding: 3px 6px; font-size: 10px; }
        table.grid tbody td.num { text-align: right; font-variant-numeric: tabular-nums; font-family: 'Consolas', 'Courier New', monospace; }
        table.grid tbody tr { cursor: pointer; background: #fff; }
        table.grid tbody tr:nth-child(even) { background: #fafafa; }
        table.grid tbody tr:hover { background: #e3f2fd !important; }
        table.grid tbody tr.selected { background: #fff9c4 !important; }
        table.grid tbody tr.selected:hover { background: #fff59d !important; }

        .chk { display: inline-block; width: 13px; height: 13px; border: 1px solid #607d8b; background: #fff; vertical-align: middle; text-align: center; line-height: 11px; color: #2e7d32; font-weight: 900; font-size: 11px; }
        .chk.on { background: #c8e6c9; border-color: #2e7d32; }

        .tag-sup { background: #eceff1; border: 1px solid #b0bec5; padding: 1px 6px; font-size: 10px; font-family: 'Consolas', monospace; color: #37474f; border-radius: 2px; }
        .tag-mis { background: #fff; border: 1px solid #90a4ae; padding: 1px 6px; font-size: 11px; font-family: 'Consolas', monospace; color: #263238; font-weight: 600; border-radius: 2px; }
        .tag-cur { background: #fff3e0; border: 1px solid #ffb74d; padding: 0 5px; font-size: 9px; font-family: 'Consolas', monospace; color: #e65100; margin-left: 4px; border-radius: 2px; font-weight: 700; }
        .tag-origine { display: inline-block; padding: 1px 6px; font-size: 9px; font-weight: 700; border-radius: 2px; font-family: 'Consolas', monospace; letter-spacing: 0.5px; }
        .tag-origine.EU { background: #e3f2fd; color: #0d47a1; border: 1px solid #64b5f6; }
        .tag-origine.CN { background: #ffebee; color: #b71c1c; border: 1px solid #ef9a9a; }

        .price-final { font-weight: 700; color: #1565c0; }
        .price-orig { color: #78909c; }

        .statusbar { background: linear-gradient(to bottom, #cfd8dc 0%, #b0bec5 100%); border-top: 1px solid #90a4ae; padding: 4px 10px; display: flex; gap: 16px; font-size: 11px; color: #263238; align-items: center; height: 24px; }
        .statusbar .sb-item { display: flex; align-items: center; gap: 5px; padding: 0 8px; border-right: 1px solid #90a4ae; height: 100%; }
        .statusbar .sb-item:last-child { border-right: none; margin-left: auto; }
        .statusbar b { font-weight: 700; color: #0d47a1; }
        .statusbar .total { background: #1565c0; color: #fff; padding: 2px 10px; border-radius: 2px; font-weight: 700; font-size: 12px; font-family: 'Consolas', monospace; }

        .modal-ov { position: fixed; inset: 0; background: rgba(38, 50, 56, 0.55); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 16px; }
        .modal { background: #eceff1; max-width: 1100px; width: 100%; max-height: 94vh; border: 1px solid #263238; box-shadow: 0 6px 30px rgba(0,0,0,0.35); display: flex; flex-direction: column; }
        .modal.wide { max-width: 1300px; }
        .modal-title { background: linear-gradient(to bottom, #1976d2 0%, #0d47a1 100%); color: #fff; padding: 7px 12px; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: space-between; text-transform: uppercase; letter-spacing: 0.3px; }
        .modal-title.china-modal { background: linear-gradient(to bottom, #c62828 0%, #b71c1c 100%); }
        .modal-title .close-btn { background: transparent; border: 1px solid rgba(255,255,255,0.3); color: #fff; width: 22px; height: 22px; font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; border-radius: 2px; }
        .modal-title .close-btn:hover { background: #c62828; border-color: #c62828; }
        .modal-body { padding: 10px 14px; overflow-y: auto; flex: 1; }
        .modal-foot { background: #cfd8dc; border-top: 1px solid #90a4ae; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; }

        .wizard-steps { display: flex; background: #fff; border-bottom: 1px solid #b0bec5; padding: 0; margin: -10px -14px 10px; }
        .wiz-step { flex: 1; padding: 8px 12px; text-align: center; font-size: 11px; color: #78909c; border-right: 1px solid #eceff1; position: relative; font-weight: 600; }
        .wiz-step.active { background: #e3f2fd; color: #0d47a1; }
        .wiz-step.done { background: #e8f5e9; color: #2e7d32; }
        .wiz-step .num { display: inline-block; width: 18px; height: 18px; border-radius: 50%; background: #cfd8dc; color: white; text-align: center; line-height: 18px; font-size: 10px; margin-right: 6px; font-weight: 700; }
        .wiz-step.active .num { background: #1976d2; }
        .wiz-step.done .num { background: #4caf50; }

        .fieldset { border: 1px solid #b0bec5; background: #fff; margin-bottom: 10px; }
        .fieldset-head { background: linear-gradient(to bottom, #eceff1 0%, #cfd8dc 100%); border-bottom: 1px solid #b0bec5; padding: 5px 10px; font-size: 11px; font-weight: 700; color: #263238; text-transform: uppercase; letter-spacing: 0.4px; display: flex; align-items: center; gap: 6px; }
        .fieldset-head.china-fs { background: linear-gradient(to bottom, #ffebee 0%, #ffcdd2 100%); color: #b71c1c; }
        .fieldset-body { padding: 10px; display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; }
        .fieldset-body.cols-4 { grid-template-columns: repeat(4, 1fr); }
        @media (max-width: 800px) { .fieldset-body.cols-4 { grid-template-columns: repeat(2, 1fr); } }

        .notice { background: #fff8e1; border: 1px solid #ffca28; border-left: 4px solid #f9a825; padding: 7px 10px; font-size: 11px; color: #5d4037; margin-bottom: 10px; display: flex; gap: 8px; align-items: flex-start; }
        .notice svg { color: #f9a825; flex-shrink: 0; margin-top: 1px; }

        .calc-box { background: #e8eaf6; border: 1px solid #9fa8da; padding: 8px 10px; font-size: 11px; color: #283593; display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
        .calc-box .calc-result { background: #1a237e; color: #fff; padding: 3px 10px; font-family: 'Consolas', monospace; font-weight: 700; font-size: 13px; border-radius: 2px; }

        .preview-box { border: 1px solid #b0bec5; background: #fff; max-height: 200px; overflow: auto; }
        .preview-box table { width: 100%; border-collapse: collapse; font-size: 11px; }
        .preview-box th { background: #eceff1; padding: 4px 6px; border: 1px solid #b0bec5; font-size: 10px; color: #37474f; font-weight: 700; text-align: left; white-space: nowrap; position: sticky; top: 0; }
        .preview-box th.mapped { background: #1565c0; color: #fff; border-color: #0d47a1; }
        .preview-box th.mapped .role { display: block; font-size: 9px; color: #bbdefb; font-weight: 600; margin-top: 1px; }
        .preview-box td { padding: 3px 6px; border: 1px solid #eceff1; font-size: 11px; color: #455a64; white-space: nowrap; max-width: 150px; overflow: hidden; text-overflow: ellipsis; }

        .qty-inp { width: 55px; text-align: center; background: #fffde7; border: 1px solid #90a4ae; padding: 3px; font-family: 'Consolas', monospace; font-size: 12px; font-weight: 700; border-radius: 2px; }
        .qty-inp:focus { outline: none; border-color: #1976d2; background: #fff; }

        .empty { padding: 60px 20px; text-align: center; color: #78909c; font-size: 12px; }
        .empty .em-ttl { font-size: 14px; color: #37474f; font-weight: 600; margin-bottom: 4px; }

        .sup-card { background: #fff; border: 1px solid #cfd8dc; margin: 8px; display: flex; flex-direction: column; }
        .sup-card .sc-head { background: #eceff1; border-bottom: 1px solid #cfd8dc; padding: 4px 10px; font-size: 11px; font-weight: 700; color: #263238; text-transform: uppercase; display: flex; justify-content: space-between; }
        .sup-card.china-card .sc-head { background: #ffebee; color: #b71c1c; }
        .sup-card .sc-body { padding: 8px 10px; font-size: 12px; }
        .sup-row-item { display: grid; grid-template-columns: 140px 1fr; padding: 3px 0; border-bottom: 1px dotted #cfd8dc; }
        .sup-row-item .lbl { color: #546e7a; font-weight: 600; font-size: 11px; }
        .sup-row-item .val { color: #263238; font-family: 'Consolas', monospace; }

        /* Bolla doganale preview */
        .bolla-preview { background: #fff; padding: 12px; }
        .bolla-header { text-align: center; border: 2px solid #000; padding: 6px; margin-bottom: 10px; font-family: 'Courier New', monospace; font-weight: bold; font-size: 11px; }
        .bolla-grid-big { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
        .bolla-tab { width: 100%; border-collapse: collapse; font-family: 'Courier New', monospace; margin-bottom: 10px; }
        .bolla-tab th { background: #263238; color: #fff; padding: 5px 8px; font-size: 11px; text-align: left; }
        .bolla-tab td { border: 1px solid #cfd8dc; padding: 4px 8px; font-size: 11px; }
        .bolla-tab td.num { text-align: right; font-variant-numeric: tabular-nums; }
        .bolla-tab .tot-row { background: #1a237e; color: #fff; font-weight: 700; }
        .bolla-tab .tot-row td { color: #fff; }

        .bolla-card { background: #fff; border: 1px solid #90a4ae; margin: 8px; padding: 0; }
        .bolla-card-head { background: linear-gradient(to bottom, #c62828 0%, #b71c1c 100%); color: #fff; padding: 6px 10px; display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 11px; }
        .bolla-card-body { padding: 10px; }
        .bolla-stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 8px; }
        @media (max-width: 700px) { .bolla-stat-grid { grid-template-columns: repeat(2, 1fr); } }
        .bolla-stat { background: #f5f7fa; border: 1px solid #cfd8dc; padding: 6px 8px; }
        .bolla-stat .lbl { font-size: 9px; color: #78909c; text-transform: uppercase; font-weight: 600; }
        .bolla-stat .val { font-size: 14px; color: #0d47a1; font-weight: 700; font-family: 'Consolas', monospace; }
        .bolla-stat.total { background: #0d47a1; border-color: #0d47a1; }
        .bolla-stat.total .lbl { color: #bbdefb; }
        .bolla-stat.total .val { color: #fff; font-size: 16px; }

        .kpi-row-china { background: #ffebee; border: 1px solid #ef9a9a; padding: 10px; margin-bottom: 10px; display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
        @media (max-width: 800px) { .kpi-row-china { grid-template-columns: repeat(2, 1fr); } }
        .kpi-box { background: #fff; border: 1px solid #ffcdd2; padding: 6px 10px; }
        .kpi-box .lbl { font-size: 9px; color: #b71c1c; text-transform: uppercase; font-weight: 700; letter-spacing: 0.3px; }
        .kpi-box .val { font-size: 16px; color: #263238; font-weight: 700; font-family: 'Consolas', monospace; margin-top: 2px; }
        .kpi-box.accent .val { color: #b71c1c; }
        .kpi-box.success .val { color: #2e7d32; }

        /* ===== SIMULATORE WHAT-IF ===== */
        .sim-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.65); z-index: 200; display: flex; align-items: stretch; justify-content: stretch; padding: 12px; }
        .sim-modal { flex: 1; background: #f5f7fa; border: 2px solid #0d47a1; box-shadow: 0 8px 40px rgba(0,0,0,0.5); display: flex; flex-direction: column; overflow: hidden; }

        /* HEADER */
        .sim-header { background: linear-gradient(to bottom, #1976d2, #0d47a1); color: #fff; padding: 10px 16px; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
        .sim-title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .sim-title { font-weight: 700; font-size: 14px; letter-spacing: 0.3px; }
        .sim-subtitle { font-size: 12px; color: #bbdefb; display: flex; align-items: center; gap: 6px; }
        .sim-hero { display: flex; gap: 20px; margin-top: 10px; align-items: center; }
        .sim-hero-col { display: flex; flex-direction: column; gap: 1px; }
        .sim-hero-lbl { font-size: 10px; color: #bbdefb; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
        .sim-hero-val { font-size: 22px; font-weight: 800; font-family: 'Consolas', monospace; color: #fff; }
        .sim-hero-val.baseline { color: #e3f2fd; }
        .sim-hero-val.better { color: #a5d6a7; }
        .sim-hero-val.worse { color: #ffab91; }
        .sim-hero-val.same { color: #fff; }
        .sim-hero-sub { font-size: 10px; color: #bbdefb; }
        .sim-hero-sub.better { color: #a5d6a7; font-weight: 700; }
        .sim-hero-sub.worse { color: #ffab91; font-weight: 700; }
        .sim-hero-arrow { font-size: 28px; color: #90caf9; margin: 0 10px; }
        .sim-close { background: #b71c1c; color: #fff; border: none; width: 32px; height: 32px; font-size: 16px; cursor: pointer; font-weight: 700; }
        .sim-close:hover { background: #d32f2f; }

        /* BODY */
        .sim-body { flex: 1; display: grid; grid-template-columns: 400px 1fr; gap: 0; overflow: hidden; }
        .sim-left, .sim-right { overflow-y: auto; padding: 10px; }
        .sim-left { background: #eceff1; border-right: 2px solid #b0bec5; }
        .sim-right { background: #fafafa; }
        .sim-section-title { font-size: 11px; font-weight: 700; color: #0d47a1; text-transform: uppercase; letter-spacing: 0.5px; padding: 4px 6px; background: #e3f2fd; border-left: 3px solid #1976d2; margin-bottom: 8px; }

        /* SIM GROUP (parametri) */
        .sim-group { background: #fff; border: 1px solid #cfd8dc; margin-bottom: 8px; }
        .sim-group-title { background: linear-gradient(to bottom, #eceff1, #cfd8dc); padding: 4px 8px; font-size: 10px; font-weight: 700; color: #37474f; text-transform: uppercase; border-bottom: 1px solid #90a4ae; }
        .sim-group-body { padding: 4px; }

        /* SIM INPUT */
        .sim-input-row { display: grid; grid-template-columns: 1fr 120px; gap: 6px; padding: 4px 6px; border-bottom: 1px dashed #eceff1; align-items: center; }
        .sim-input-row:last-child { border-bottom: none; }
        .sim-input-row.changed-up { background: #ffebee; }
        .sim-input-row.changed-down { background: #e8f5e9; }
        .sim-input-label { font-size: 11px; color: #37474f; display: flex; flex-direction: column; gap: 1px; }
        .sim-hint { font-size: 9px; color: #78909c; font-style: italic; }
        .sim-input-ctrl { display: flex; align-items: center; gap: 3px; }
        .sim-input { width: 80px; height: 22px; border: 1px solid #b0bec5; padding: 0 4px; font-size: 11px; font-family: 'Consolas', monospace; text-align: right; }
        .sim-input:focus { outline: 2px solid #1976d2; border-color: #1976d2; }
        .sim-unit { font-size: 10px; color: #546e7a; font-weight: 600; min-width: 16px; }
        .sim-input-diff { grid-column: 1 / -1; display: flex; justify-content: space-between; font-size: 9px; padding: 2px 0 0 0; border-top: 1px dotted #b0bec5; }
        .sim-input-baseline { color: #78909c; font-style: italic; }
        .sim-input-arrow { font-weight: 700; font-family: 'Consolas', monospace; }
        .sim-input-arrow.up { color: #c62828; }
        .sim-input-arrow.down { color: #2e7d32; }

        /* SIM FORMULA */
        .sim-formula { background: #fff; border-left: 3px solid #cfd8dc; padding: 6px 10px; margin-bottom: 4px; border-top: 1px solid #eceff1; border-right: 1px solid #eceff1; border-bottom: 1px solid #eceff1; }
        .sim-formula.highlight { border-left-color: #1976d2; background: #e3f2fd; }
        .sim-formula.big { border-left-color: #2e7d32; background: #e8f5e9; border-width: 2px; padding: 8px 12px; }
        .sim-formula-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; flex-wrap: wrap; }
        .sim-formula-label { font-weight: 700; font-size: 12px; color: #37474f; }
        .sim-formula.big .sim-formula-label { font-size: 14px; color: #1b5e20; }
        .sim-formula-value { display: flex; align-items: baseline; gap: 8px; font-family: 'Consolas', monospace; }
        .sim-formula-base { font-size: 10px; color: #90a4ae; text-decoration: line-through; }
        .sim-formula-sim { font-size: 14px; font-weight: 700; color: #263238; }
        .sim-formula.big .sim-formula-sim { font-size: 20px; }
        .sim-formula-sim.better { color: #2e7d32; }
        .sim-formula-sim.worse { color: #c62828; }
        .sim-formula-diff { font-size: 11px; font-weight: 700; padding: 1px 5px; border-radius: 2px; }
        .sim-formula-diff.better { background: #c8e6c9; color: #1b5e20; }
        .sim-formula-diff.worse { background: #ffcdd2; color: #b71c1c; }
        .sim-formula-expr { font-size: 10px; color: #546e7a; font-family: 'Consolas', monospace; margin-top: 3px; padding: 2px 4px; background: #f5f5f5; border: 1px solid #eceff1; word-break: break-word; }

        /* SIM CHART */
        .sim-chart { background: #fff; border: 1px solid #cfd8dc; padding: 8px; }
        .sim-chart-row { display: grid; grid-template-columns: 180px 1fr 110px; gap: 8px; align-items: center; padding: 3px 4px; border-bottom: 1px dashed #eceff1; }
        .sim-chart-row:last-child { border-bottom: none; }
        .sim-chart-label { font-size: 11px; color: #37474f; display: flex; align-items: center; gap: 6px; font-weight: 600; }
        .sim-chart-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
        .sim-chart-pct { font-size: 9px; color: #90a4ae; margin-left: auto; font-weight: 500; }
        .sim-chart-bars { position: relative; height: 18px; background: #f5f5f5; border: 1px solid #eceff1; overflow: hidden; }
        .sim-chart-bar { position: absolute; left: 0; top: 0; bottom: 0; transition: width 0.3s ease; }
        .sim-chart-bar.baseline-bar { background: repeating-linear-gradient(45deg, #90a4ae, #90a4ae 4px, #b0bec5 4px, #b0bec5 8px); opacity: 0.5; z-index: 1; }
        .sim-chart-bar.sim-bar { opacity: 0.9; z-index: 2; }
        .sim-chart-val { font-size: 11px; font-family: 'Consolas', monospace; font-weight: 700; text-align: right; color: #263238; display: flex; flex-direction: column; align-items: flex-end; gap: 1px; }
        .sim-chart-diff { font-size: 9px; padding: 0 3px; }
        .sim-chart-diff.worse { color: #c62828; }
        .sim-chart-diff.better { color: #2e7d32; }

        /* FOOTER */
        .sim-footer { background: #eceff1; padding: 8px 14px; border-top: 1px solid #b0bec5; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px; }

        /* Responsive */
        @media (max-width: 1100px) {
          .sim-body { grid-template-columns: 1fr; }
          .sim-left { max-height: 40vh; }
        }

        /* ===== MENU DROPDOWN ===== */
        .menubar-item { position: relative; cursor: pointer; user-select: none; }
        .menubar-item.open { background: #1976d2; color: #fff; }
        .menu-dropdown { position: absolute; top: 100%; left: 0; min-width: 240px; background: #fff; border: 1px solid #0d47a1; box-shadow: 4px 4px 12px rgba(0,0,0,0.25); z-index: 150; padding: 3px 0; cursor: default; }
        .menu-dropdown-right { left: auto; right: 0; }
        .menu-dd-item { display: flex; align-items: center; gap: 6px; padding: 5px 12px; font-size: 11px; color: #263238; cursor: pointer; transition: background 0.1s; white-space: nowrap; }
        .menu-dd-item:hover { background: #e3f2fd; color: #0d47a1; }
        .menu-dd-item.active { background: #bbdefb; color: #0d47a1; font-weight: 700; }
        .menu-dd-item.danger:hover { background: #ffcdd2; color: #b71c1c; }
        .menu-dd-sep { height: 1px; background: #cfd8dc; margin: 3px 0; }
        .menu-dd-badge { margin-left: auto; background: #eceff1; color: #546e7a; padding: 1px 6px; border-radius: 8px; font-size: 9px; font-weight: 700; }
        .menu-dd-item:hover .menu-dd-badge { background: #1976d2; color: #fff; }
        .menu-dd-hint { margin-left: auto; font-size: 9px; color: #90a4ae; font-style: italic; }

        /* ===== MODALE GUIDA ===== */
        .guide-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.65); z-index: 200; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .guide-modal { background: #fff; border: 2px solid #0d47a1; max-width: 800px; max-height: 90vh; width: 100%; display: flex; flex-direction: column; }
        .guide-header { background: linear-gradient(to bottom, #1976d2, #0d47a1); color: #fff; padding: 10px 16px; display: flex; justify-content: space-between; align-items: center; }
        .guide-header h2 { margin: 0; font-size: 15px; }
        .guide-body { padding: 16px 22px; overflow-y: auto; font-size: 13px; line-height: 1.5; color: #263238; }
        .guide-body h3 { color: #0d47a1; font-size: 14px; margin: 16px 0 6px 0; border-bottom: 1px solid #bbdefb; padding-bottom: 3px; }
        .guide-body h3:first-child { margin-top: 0; }
        .guide-body ul { margin: 4px 0 8px 0; padding-left: 22px; }
        .guide-body li { margin-bottom: 3px; }
        .guide-body code { background: #eceff1; padding: 1px 4px; border-radius: 2px; font-size: 12px; color: #b71c1c; }
        .guide-body b { color: #0d47a1; }
        .guide-footer { background: #eceff1; padding: 8px 16px; border-top: 1px solid #cfd8dc; display: flex; justify-content: flex-end; }

        /* ===== TAB FORNITORI CATALOGO ===== */
        .supplier-tabs { display: flex; background: linear-gradient(to bottom, #eceff1, #cfd8dc); border-bottom: 2px solid #546e7a; padding: 4px 4px 0 4px; gap: 2px; overflow-x: auto; }
        .sup-tab { padding: 6px 12px; background: #b0bec5; color: #37474f; font-size: 11px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; border: 1px solid #90a4ae; border-bottom: none; border-radius: 3px 3px 0 0; user-select: none; white-space: nowrap; transition: background 0.15s; }
        .sup-tab:hover { background: #cfd8dc; }
        .sup-tab.active { background: #fff; color: #0d47a1; border-color: #0d47a1; border-bottom: 2px solid #fff; margin-bottom: -2px; box-shadow: 0 -2px 4px rgba(0,0,0,0.08); z-index: 2; }
        .sup-tab.eu-tab.active { color: #1b5e20; border-color: #2e7d32; }
        .sup-tab.cn-tab.active { color: #b71c1c; border-color: #c62828; }
        .sup-tab-count { background: rgba(0,0,0,0.15); padding: 1px 6px; border-radius: 8px; font-size: 9px; font-weight: 700; }
        .sup-tab.active .sup-tab-count { background: rgba(13, 71, 161, 0.15); color: #0d47a1; }
        .sup-tab-custom { background: #fff59d; color: #f57f17; padding: 1px 4px; border-radius: 2px; font-size: 10px; border: 1px solid #ffb300; }

        /* ===== PANNELLO PARAMETRI FORNITORE ===== */
        .sup-params-panel { background: #fff3e0; border: 1px solid #ffb74d; border-radius: 2px; margin: 6px; overflow: hidden; }
        .sup-params-head { background: linear-gradient(to bottom, #ffcc80, #ffb74d); padding: 5px 10px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #ff9800; }
        .sup-params-title { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #bf360c; font-weight: 600; }
        .sup-params-mode { font-size: 9px; padding: 1px 6px; border-radius: 2px; font-weight: 700; margin-left: 4px; }
        .sup-params-mode.global { background: #e3f2fd; color: #0d47a1; border: 1px solid #1976d2; }
        .sup-params-mode.custom { background: #fff59d; color: #bf360c; border: 1px solid #f57f17; }
        .sup-params-actions { display: flex; gap: 8px; align-items: center; }
        .sup-params-toggle { font-size: 11px; color: #37474f; display: flex; align-items: center; gap: 4px; cursor: pointer; font-weight: 600; }
        .sup-params-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; padding: 8px; }
        @media (max-width: 1400px) { .sup-params-grid { grid-template-columns: repeat(4, 1fr); } }
        @media (max-width: 900px) { .sup-params-grid { grid-template-columns: repeat(2, 1fr); } }
        .sup-fld { display: flex; flex-direction: column; gap: 2px; }
        .sup-fld label { font-size: 9px; color: #5d4037; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; }
        .sup-fld .ctl { height: 22px; font-size: 11px; background: #fff; border: 1px solid #d7ccc8; }
        .sup-fld .ctl:focus { border-color: #ff9800; outline: 1px solid #ff9800; }

        /* ===== COLONNE SCOMPOSTE CATALOGO ===== */
        table.grid.scomposto { min-width: 1600px; }
        table.grid.scomposto th.col-cn { background: #1976d2 !important; color: #fff !important; font-size: 10px; border-color: #0d47a1 !important; }
        table.grid.scomposto th.col-cn.col-extra { background: #f57c00 !important; border-color: #e65100 !important; }
        table.grid.scomposto th.col-finale { background: #2e7d32 !important; color: #fff !important; border-color: #1b5e20 !important; }
        table.grid.scomposto td.col-cn { background: #f3f8ff; border-color: #cfd8dc; font-family: 'Consolas', monospace; }
        table.grid.scomposto td.col-cn.col-extra { background: #fff8e1; }
        table.grid.scomposto td.col-cn.col-cif { background: #e3f2fd; font-weight: 700; color: #0d47a1; }
        table.grid.scomposto td.col-finale { background: #e8f5e9; font-weight: 700; color: #1b5e20; border-color: #a5d6a7; }
        table.grid.scomposto tr:hover td.col-cn { background: #e3f2fd; }
        table.grid.scomposto tr.selected td.col-cn { background: #bbdefb !important; }
        /* Colonne cliccabili nascondibili */
        th.col-clickable { cursor: pointer; user-select: none; position: relative; }
        th.col-clickable:hover { background: rgba(255,255,255,0.15) !important; }
        th.col-clickable .hide-x { display: none; margin-left: 4px; color: #ffcdd2; font-weight: 700; }
        th.col-clickable:hover .hide-x { display: inline; }

        /* Input inline edit nel catalogo */
        .inline-edit-inp { width: 70px; height: 22px; border: 1px solid transparent; padding: 0 4px; font-size: 11px; font-family: 'Consolas', monospace; text-align: right; background: transparent; color: inherit; transition: background 0.15s, border-color 0.15s; }
        .inline-edit-inp:hover { background: #fff9c4; border-color: #ffd54f; }
        .inline-edit-inp:focus { background: #fff; border-color: #1976d2; outline: 1px solid #1976d2; }

        /* ===== PANNELLO CONFRONTO LATERALE ===== */
        .compare-panel { position: fixed; top: 0; right: 0; bottom: 0; width: 420px; background: #f5f7fa; border-left: 2px solid #1976d2; box-shadow: -4px 0 16px rgba(0,0,0,0.2); z-index: 150; display: flex; flex-direction: column; animation: slideInRight 0.2s ease; }
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .compare-panel-head { background: linear-gradient(to bottom, #1976d2, #0d47a1); color: #fff; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
        .compare-panel-body { flex: 1; overflow-y: auto; padding: 8px; }
        .compare-card { background: #fff; border: 1px solid #cfd8dc; padding: 8px; margin-bottom: 8px; }
        .compare-card.best { border-color: #2e7d32; border-width: 2px; background: linear-gradient(to bottom, #e8f5e9, #fff); }
        .compare-card-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
        .compare-meta { font-size: 11px; color: #546e7a; margin-bottom: 2px; }
        .compare-prices { background: #f5f7fa; border: 1px solid #eceff1; padding: 6px; margin-top: 4px; }
        .compare-row { display: flex; justify-content: space-between; padding: 2px 4px; font-size: 11px; }
        .compare-row .lbl { color: #546e7a; }
        .compare-row .val { font-family: 'Consolas', monospace; font-weight: 600; }
        .compare-row.total { background: #e3f2fd; padding: 4px; margin-top: 4px; font-size: 13px; }
        .compare-row.total .lbl { color: #0d47a1; font-weight: 700; }
        .compare-row.total .val { color: #0d47a1; font-size: 14px; }
        .compare-row.delta { background: #ffebee; padding: 3px 4px; margin-top: 2px; }
        .compare-row.delta .val { color: #c62828; font-weight: 700; }
        .compare-row.best-row { background: #c8e6c9; padding: 4px; margin-top: 2px; font-size: 11px; }

        /* ===== SIMULAZIONE SELEZIONE ===== */
        .sel-sim-panel { background: #fff8e1; border: 1px solid #ffb74d; margin: 6px 8px; }
        .sel-sim-head { background: linear-gradient(to bottom, #ffcc80, #ffb74d); padding: 6px 10px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; user-select: none; font-size: 12px; color: #bf360c; }
        .sel-sim-head:hover { background: linear-gradient(to bottom, #ffd180, #ffb74d); }
        .sel-sim-active { background: #2e7d32; color: #fff; padding: 1px 6px; border-radius: 2px; font-size: 9px; font-weight: 700; margin-left: 4px; }
        .sel-sim-inactive { color: #5d4037; font-size: 10px; font-style: italic; margin-left: 4px; }
        .sel-sim-body { padding: 8px; background: #fff; border-top: 1px solid #ffb74d; }
        .sel-sim-load { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; padding-bottom: 8px; border-bottom: 1px solid #eceff1; margin-bottom: 8px; }
        .sel-sim-params { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; padding: 4px 0; }
        @media (max-width: 1400px) { .sel-sim-params { grid-template-columns: repeat(4, 1fr); } }
        @media (max-width: 900px) { .sel-sim-params { grid-template-columns: repeat(2, 1fr); } }
        .sel-sim-scenarios { display: flex; gap: 4px; padding: 8px 0 4px 0; border-top: 1px solid #eceff1; margin-top: 8px; }
        .sel-sim-scen-table { background: #f5f7fa; padding: 4px; border: 1px solid #cfd8dc; }
        .sel-sim-scen-table table { margin: 0; }

        /* Riga totali in fondo a tabella selezione */
        tr.sel-totals-row td { background: #eceff1; border-top: 2px solid #1976d2; font-size: 11px; padding: 6px 4px; }

        /* KPI box riga */
        .sel-kpi-row { display: flex; gap: 8px; padding: 8px; background: #f5f7fa; border-top: 1px solid #cfd8dc; flex-wrap: wrap; }
        .sel-kpi-box { background: #fff; border: 1px solid #cfd8dc; padding: 8px 12px; flex: 1; min-width: 130px; display: flex; flex-direction: column; gap: 2px; }
        .sel-kpi-box .lbl { font-size: 10px; color: #546e7a; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
        .sel-kpi-box .val { font-size: 16px; font-weight: 700; color: #263238; font-family: 'Consolas', monospace; }
        .sel-kpi-box.cost { border-color: #1976d2; background: #e3f2fd; }
        .sel-kpi-box.cost .val { color: #0d47a1; }
        .sel-kpi-box.revenue { border-color: #2e7d32; background: #e8f5e9; }
        .sel-kpi-box.revenue .val { color: #1b5e20; }
        .sel-kpi-box.margin { border-color: #ff9800; background: #fff3e0; }
        .sel-kpi-box.margin .val { color: #bf360c; }
      `}</style>

      {/* MENU BAR */}
      <div className="menubar" onMouseLeave={() => setOpenMenu(null)}>
        <div className="menubar-brand"><Database size={14} /> GESTIONALE IMPORT v2.1</div>

        {/* ARCHIVIO */}
        <div className={`menubar-item ${openMenu === 'archivio' ? 'open' : ''}`} onClick={() => setOpenMenu(openMenu === 'archivio' ? null : 'archivio')}>
          Archivio
          {openMenu === 'archivio' && (
            <div className="menu-dropdown" onClick={e => e.stopPropagation()}>
              <div className="menu-dd-item" onClick={() => menuAction(() => fileInputRef.current?.click())}>
                <Globe2 size={12} /> Nuovo Import Europa
              </div>
              <div className="menu-dd-item" onClick={() => menuAction(() => { cancelChinaImport(); setBollaMode('file'); setChinaStep('upload'); chinaFileInputRef.current?.click(); })}>
                <Ship size={12} /> Nuovo Import Cina
              </div>
              <div className="menu-dd-sep"></div>
              <div className="menu-dd-item" onClick={() => menuAction(exportCatalogoExcel)}>
                <FileSpreadsheet size={12} /> Esporta Catalogo Excel
              </div>
              <div className="menu-dd-item" onClick={() => menuAction(exportParams)}>
                <Download size={12} /> Esporta Parametri (JSON)
              </div>
              <div className="menu-dd-item" onClick={() => menuAction(() => paramsFileInputRef.current?.click())}>
                <Upload size={12} /> Importa Parametri (JSON)
              </div>
              <div className="menu-dd-sep"></div>
              <div className="menu-dd-item danger" onClick={() => menuAction(clearAllArchive)}>
                <Trash2 size={12} /> Svuota Archivio Completo
              </div>
            </div>
          )}
        </div>

        {/* MODIFICA */}
        <div className={`menubar-item ${openMenu === 'modifica' ? 'open' : ''}`} onClick={() => setOpenMenu(openMenu === 'modifica' ? null : 'modifica')}>
          Modifica
          {openMenu === 'modifica' && (
            <div className="menu-dropdown" onClick={e => e.stopPropagation()}>
              <div className="menu-dd-item" onClick={() => menuAction(() => setSelectedItems([]))}>
                <X size={12} /> Svuota Selezione ({selectedItems.length})
              </div>
              <div className="menu-dd-item" onClick={() => menuAction(() => { setSearchQuery(''); setFilterMarca(''); setFilterSupplier(''); setFilterOrigine(''); })}>
                <Search size={12} /> Azzera Filtri Catalogo
              </div>
              <div className="menu-dd-sep"></div>
              <div className="menu-dd-item" onClick={() => menuAction(() => setCompactView(!compactView))}>
                <List size={12} /> Vista Compatta: {compactView ? 'ON' : 'OFF'}
              </div>
            </div>
          )}
        </div>

        {/* VISUALIZZA */}
        <div className={`menubar-item ${openMenu === 'visualizza' ? 'open' : ''}`} onClick={() => setOpenMenu(openMenu === 'visualizza' ? null : 'visualizza')}>
          Visualizza
          {openMenu === 'visualizza' && (
            <div className="menu-dropdown" onClick={e => e.stopPropagation()}>
              <div className={`menu-dd-item ${activeSection === 'catalogo' ? 'active' : ''}`} onClick={() => menuAction(() => setActiveSection('catalogo'))}>
                <Database size={12} /> Catalogo <span className="menu-dd-badge">{allItems.length}</span>
              </div>
              <div className={`menu-dd-item ${activeSection === 'selezione' ? 'active' : ''}`} onClick={() => menuAction(() => setActiveSection('selezione'))}>
                <ShoppingCart size={12} /> Selezione <span className="menu-dd-badge">{selectedItems.length}</span>
              </div>
              <div className={`menu-dd-item ${activeSection === 'fornitori' ? 'active' : ''}`} onClick={() => menuAction(() => setActiveSection('fornitori'))}>
                <FolderOpen size={12} /> Fornitori <span className="menu-dd-badge">{suppliers.length}</span>
              </div>
              <div className={`menu-dd-item ${activeSection === 'sizelists' ? 'active' : ''}`} onClick={() => menuAction(() => setActiveSection('sizelists'))}>
                <List size={12} /> Listini Misure <span className="menu-dd-badge">{sizeLists.length}</span>
              </div>
              <div className={`menu-dd-item ${activeSection === 'confronto' ? 'active' : ''}`} onClick={() => menuAction(() => setActiveSection('confronto'))}>
                <Search size={12} /> Confronto Prezzi <span className="menu-dd-badge">{comparisonData.length}</span>
              </div>
              <div className={`menu-dd-item ${activeSection === 'bolle' ? 'active' : ''}`} onClick={() => menuAction(() => setActiveSection('bolle'))}>
                <FileText size={12} /> Bolle Doganali <span className="menu-dd-badge">{bolle.length}</span>
              </div>
              <div className="menu-dd-sep"></div>
              <div className="menu-dd-item" onClick={() => menuAction(() => setCompactView(!compactView))}>
                <List size={12} /> {compactView ? '☑' : '☐'} Vista Compatta
              </div>
            </div>
          )}
        </div>

        {/* STRUMENTI */}
        <div className={`menubar-item ${openMenu === 'strumenti' ? 'open' : ''}`} onClick={() => setOpenMenu(openMenu === 'strumenti' ? null : 'strumenti')}>
          Strumenti
          {openMenu === 'strumenti' && (
            <div className="menu-dropdown" onClick={e => e.stopPropagation()}>
              <div className="menu-dd-item" onClick={() => menuAction(openSimulatorFromMenu)}>
                <Search size={12} /> Simulatore What-If
                <span className="menu-dd-hint">{selectedItems.length > 0 ? 'usa primo selezionato' : 'usa primo del catalogo'}</span>
              </div>
              <div className="menu-dd-item" onClick={() => menuAction(openBollaFromSelection)}>
                <FileText size={12} /> Genera Bolla da Selezione
                <span className="menu-dd-badge">{selectedItems.filter(i => i.origine === 'CN').length}</span>
              </div>
              <div className="menu-dd-sep"></div>
              <div className="menu-dd-item" onClick={() => menuAction(exportCatalogoExcel)}>
                <FileSpreadsheet size={12} /> Export Catalogo Excel
              </div>
              <div className="menu-dd-item" onClick={() => menuAction(exportParams)}>
                <Download size={12} /> Backup Parametri
              </div>
              <div className="menu-dd-item" onClick={() => menuAction(() => paramsFileInputRef.current?.click())}>
                <Upload size={12} /> Ripristina Parametri
              </div>
            </div>
          )}
        </div>

        {/* ? HELP */}
        <div className={`menubar-item ${openMenu === 'help' ? 'open' : ''}`} onClick={() => setOpenMenu(openMenu === 'help' ? null : 'help')}>
          ?
          {openMenu === 'help' && (
            <div className="menu-dropdown menu-dropdown-right" onClick={e => e.stopPropagation()}>
              <div className="menu-dd-item" onClick={() => menuAction(() => setShowGuideModal(true))}>
                <FileText size={12} /> Guida Rapida
              </div>
              <div className="menu-dd-item" onClick={() => menuAction(() => alert('Gestionale Import v1.6\n\nSviluppato per gestione:\n• Import listini Europa/Cina\n• Bolle doganali DAU\n• Simulazione costi\n\nVentura Nicola — IT05495120874'))}>
                <AlertCircle size={12} /> Info / Versione
              </div>
            </div>
          )}
        </div>

        <div className="menubar-right">
          <div className="menubar-right-item">UTENTE: operatore01</div>
          <div className="menubar-right-item">{today} · {now}</div>
          <div className="menubar-right-item status"><span className="dot"></span>CONNESSO</div>
        </div>
      </div>

      {/* Input invisibile per import parametri */}
      <input ref={paramsFileInputRef} type="file" accept=".json" onChange={importParams} style={{ display: 'none' }} />

      {/* TOOLBAR */}
      <div className="toolbar">
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileSelect} style={{ display: 'none' }} />
        <input ref={chinaFileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleChinaFileSelect} style={{ display: 'none' }} />

        <button className="tbtn primary" onClick={() => fileInputRef.current?.click()} title="Importa listino Europa">
          <Globe2 size={13} /> Import Europa
        </button>
        <button className="tbtn china" onClick={() => { cancelChinaImport(); setBollaMode('file'); setChinaStep('upload'); chinaFileInputRef.current?.click(); }} title="Importa listino Cina nel catalogo">
          <Ship size={13} /> Import Cina
        </button>
        <button className="tbtn china" onClick={openBollaFromSelection} disabled={selectedItems.filter(i => i.origine === 'CN').length === 0} title="Genera bolla doganale DAU dagli articoli Cina selezionati">
          <FileText size={13} /> Genera Bolla DAU {selectedItems.filter(i => i.origine === 'CN').length > 0 && <span style={{ background: '#fff', color: '#b71c1c', padding: '0 5px', borderRadius: 3, fontSize: 10, marginLeft: 2 }}>{selectedItems.filter(i => i.origine === 'CN').length}</span>}
        </button>

        <div className="tb-sep"></div>
        <button className="tbtn" onClick={exportAll}><Download size={13} /> Esporta DB</button>
        <button className="tbtn success" onClick={exportSelection} disabled={selectedItems.length === 0}>
          <FileSpreadsheet size={13} /> Esporta Selezione
        </button>
        <div className="tb-sep"></div>
        <button className="tbtn danger" onClick={clearSelected} disabled={selectedItems.length === 0}>
          <Trash2 size={13} /> Svuota Sel.
        </button>
        <div className="tb-sep"></div>
        <span className="tb-label">Cambio USD/EUR:</span>
        <input className="tb-input" type="number" step="0.001" value={exchangeRate} onChange={e => setExchangeRate(parseFloat(e.target.value) || 0)} />
      </div>

      <div className="workspace">
        {/* SIDEBAR */}
        <div className="sidenav">
          <div className="sidenav-header">Moduli</div>
          <div className={`sidenav-item ${activeSection === 'catalogo' ? 'active' : ''}`} onClick={() => setActiveSection('catalogo')}>
            <List size={14} /> Catalogo Articoli <span className="badge">{fmtInt(allItems.length)}</span>
          </div>
          <div className={`sidenav-item ${activeSection === 'selezione' ? 'active' : ''}`} onClick={() => setActiveSection('selezione')}>
            <ShoppingCart size={14} /> Selezione <span className="badge">{selectedItems.length}</span>
          </div>
          <div className={`sidenav-item ${activeSection === 'fornitori' ? 'active' : ''}`} onClick={() => setActiveSection('fornitori')}>
            <FolderOpen size={14} /> Fornitori <span className="badge">{suppliers.length}</span>
          </div>
          <div className={`sidenav-item ${activeSection === 'sizelists' ? 'active' : ''}`} onClick={() => setActiveSection('sizelists')}>
            <List size={14} /> Listini Misure <span className="badge">{sizeLists.length}</span>
          </div>
          <div className={`sidenav-item ${activeSection === 'confronto' ? 'active' : ''}`} onClick={() => setActiveSection('confronto')}>
            <Search size={14} /> Confronto Prezzi <span className="badge">{comparisonData.length}</span>
          </div>
          <div className={`sidenav-item ${activeSection === 'bolle' ? 'active' : ''}`} onClick={() => setActiveSection('bolle')}>
            <FileText size={14} /> Bolle Doganali <span className="badge">{bolle.length}</span>
          </div>

          <div className="sidenav-header" style={{ marginTop: 8 }}>Riepilogo</div>
          <div className="sidenav-stats">
            <div className="sidenav-stat"><span>Referenze sel.</span><b>{selectedItems.length}</b></div>
            <div className="sidenav-stat"><span>Pezzi totali</span><b>{qtyTotale}</b></div>
            <div className="sidenav-stat"><span>Valore</span><b>€ {fmtEur(totaleSelezione)}</b></div>
          </div>
          <div className="sidenav-stats">
            <div className="sidenav-stat"><span>Fornitori EU</span><b>{suppliers.filter(s => s.origine !== 'CN').length}</b></div>
            <div className="sidenav-stat"><span>Fornitori CN</span><b>{suppliers.filter(s => s.origine === 'CN').length}</b></div>
            <div className="sidenav-stat"><span>Marche</span><b>{uniqueMarche.length}</b></div>
          </div>
        </div>

        <div className="content">
          {/* ===== CATALOGO ===== */}
          {activeSection === 'catalogo' && (
            <div className="window">
              <div className="window-title">
                <span>Catalogo Articoli</span>
                <span className="breadcrumb">Home › Catalogo</span>
              </div>
              {allItems.length === 0 ? (
                <div className="empty">
                  <div className="em-ttl">Catalogo vuoto</div>
                  Usare "Import Europa" o "Import Cina (DAU)" per caricare i listini.
                </div>
              ) : (
                <>
                  {/* TAB FORNITORI */}
                  <div className="supplier-tabs">
                    <div className={`sup-tab ${activeCatalogTab === 'all' ? 'active' : ''}`} onClick={() => setActiveCatalogTab('all')}>
                      🌍 Tutti <span className="sup-tab-count">{allItems.length}</span>
                    </div>
                    {suppliers.filter(s => s.origine === 'EU').length > 0 && (
                      <div className={`sup-tab eu-tab ${activeCatalogTab === 'eu' ? 'active' : ''}`} onClick={() => setActiveCatalogTab('eu')}>
                        🇪🇺 Europa <span className="sup-tab-count">{allItems.filter(i => i.origine === 'EU').length}</span>
                      </div>
                    )}
                    {suppliers.filter(s => s.origine === 'CN').map(s => {
                      const count = allItems.filter(i => i.supplierId === s.id).length;
                      const sp = supplierParams[s.id];
                      const useGlobal = !sp || sp.useGlobal;
                      return (
                        <div key={s.id} className={`sup-tab cn-tab ${activeCatalogTab === s.id ? 'active' : ''}`} onClick={() => setActiveCatalogTab(s.id)}>
                          🇨🇳 {s.name}
                          <span className="sup-tab-count">{count}</span>
                          {!useGlobal && <span className="sup-tab-custom" title="Ha parametri personalizzati">⚙</span>}
                        </div>
                      );
                    })}
                  </div>

                  {/* PANNELLO PARAMETRI FORNITORE ATTIVO (solo CN) */}
                  {activeCatalogTab !== 'all' && activeCatalogTab !== 'eu' && (() => {
                    const sup = suppliers.find(s => s.id === activeCatalogTab);
                    if (!sup || sup.origine !== 'CN') return null;
                    const sp = supplierParams[sup.id];
                    const useGlobal = !sp || sp.useGlobal;
                    const effParams = getEffectiveParams(sup.id);
                    return (
                      <div className="sup-params-panel">
                        <div className="sup-params-head">
                          <div className="sup-params-title">
                            <Package size={12} /> Parametri <b>{sup.name}</b>
                            {useGlobal ? (
                              <span className="sup-params-mode global">usa GLOBALI</span>
                            ) : (
                              <span className="sup-params-mode custom">PERSONALIZZATI</span>
                            )}
                          </div>
                          <div className="sup-params-actions">
                            <label className="sup-params-toggle">
                              <input type="checkbox" checked={useGlobal} onChange={e => {
                                if (e.target.checked) {
                                  setSupplierParams(prev => ({ ...prev, [sup.id]: { useGlobal: true, params: {} } }));
                                } else {
                                  setSupplierParams(prev => ({ ...prev, [sup.id]: { useGlobal: false, params: { ...chinaParams } } }));
                                }
                              }} /> Eredita globali
                            </label>
                            {!useGlobal && <button className="tbtn" style={{ fontSize: 10, padding: '2px 6px', height: 20 }} onClick={() => resetSupplierToGlobal(sup.id)}>Reset</button>}
                          </div>
                        </div>
                        <div className="sup-params-grid">
                          <div className="sup-fld">
                            <label>Rotta / Container</label>
                            <select className="ctl" value={effParams.noloPreset || 'hcm_40'} onChange={e => applyPresetToSupplier(sup.id, e.target.value)}>
                              {Object.entries(NOLO_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                            </select>
                          </div>
                          <div className="sup-fld">
                            <label>Qty totale rif.</label>
                            <input className="ctl" type="number" step="1" value={effParams.qtyTotale || 0} onChange={e => updateSupplierParam(sup.id, 'qtyTotale', parseInt(e.target.value) || 0)} />
                          </div>
                          <div className="sup-fld">
                            <label>Cambio EUR/USD</label>
                            <input className="ctl" type="number" step="0.0001" value={effParams.tassoEurUsd} onChange={e => updateSupplierParam(sup.id, 'tassoEurUsd', parseFloat(e.target.value) || 1)} />
                          </div>
                          <div className="sup-fld">
                            <label>Nolo mare $</label>
                            <input className="ctl" type="number" value={effParams.noloMare} onChange={e => updateSupplierParam(sup.id, 'noloMare', parseFloat(e.target.value) || 0)} />
                          </div>
                          <div className="sup-fld">
                            <label>Fuel mare €</label>
                            <input className="ctl" type="number" value={effParams.fuelSurcharge} onChange={e => updateSupplierParam(sup.id, 'fuelSurcharge', parseFloat(e.target.value) || 0)} />
                          </div>
                          <div className="sup-fld">
                            <label>ICS2 $</label>
                            <input className="ctl" type="number" value={effParams.ics2Usd} onChange={e => updateSupplierParam(sup.id, 'ics2Usd', parseFloat(e.target.value) || 0)} />
                          </div>
                          <div className="sup-fld">
                            <label>ECA $</label>
                            <input className="ctl" type="number" value={effParams.ecaSurcharge} onChange={e => updateSupplierParam(sup.id, 'ecaSurcharge', parseFloat(e.target.value) || 0)} />
                          </div>
                          <div className="sup-fld">
                            <label>THC Sbarco €</label>
                            <input className="ctl" type="number" value={effParams.costiSbarco} onChange={e => updateSupplierParam(sup.id, 'costiSbarco', parseFloat(e.target.value) || 0)} />
                          </div>
                          <div className="sup-fld">
                            <label>Addiz. Comp.Mar. €</label>
                            <input className="ctl" type="number" value={effParams.addizionaliCompMar} onChange={e => updateSupplierParam(sup.id, 'addizionaliCompMar', parseFloat(e.target.value) || 0)} />
                          </div>
                          <div className="sup-fld">
                            <label>Dogana €</label>
                            <input className="ctl" type="number" value={effParams.doganaImport} onChange={e => updateSupplierParam(sup.id, 'doganaImport', parseFloat(e.target.value) || 0)} />
                          </div>
                          <div className="sup-fld">
                            <label>Delivery Order €</label>
                            <input className="ctl" type="number" value={effParams.deliveryOrder} onChange={e => updateSupplierParam(sup.id, 'deliveryOrder', parseFloat(e.target.value) || 0)} />
                          </div>
                          <div className="sup-fld">
                            <label>Trasp. Interno €</label>
                            <input className="ctl" type="number" value={effParams.trasportoInterno} onChange={e => updateSupplierParam(sup.id, 'trasportoInterno', parseFloat(e.target.value) || 0)} />
                          </div>
                          <div className="sup-fld">
                            <label>Fuel trasp. %</label>
                            <input className="ctl" type="number" step="0.1" value={effParams.fuelTrasportoPct} onChange={e => updateSupplierParam(sup.id, 'fuelTrasportoPct', parseFloat(e.target.value) || 0)} />
                          </div>
                          <div className="sup-fld">
                            <label>Commissioni €</label>
                            <input className="ctl" type="number" value={effParams.commissioni} onChange={e => updateSupplierParam(sup.id, 'commissioni', parseFloat(e.target.value) || 0)} />
                          </div>
                          <div className="sup-fld">
                            <label>Dazio %</label>
                            <input className="ctl" type="number" step="0.1" value={effParams.dazioPct} onChange={e => updateSupplierParam(sup.id, 'dazioPct', parseFloat(e.target.value) || 0)} />
                          </div>
                          <div className="sup-fld">
                            <label>IVA %</label>
                            <input className="ctl" type="number" step="0.5" value={effParams.ivaPct} onChange={e => updateSupplierParam(sup.id, 'ivaPct', parseFloat(e.target.value) || 0)} />
                          </div>
                          <div className="sup-fld">
                            <label>9AJ unità</label>
                            <input className="ctl" type="number" value={effParams.unita9AJ} onChange={e => updateSupplierParam(sup.id, 'unita9AJ', parseInt(e.target.value) || 0)} />
                          </div>
                          <div className="sup-fld">
                            <label>Aggiust. v.45 €</label>
                            <input className="ctl" type="number" value={effParams.aggiustamento} onChange={e => updateSupplierParam(sup.id, 'aggiustamento', parseFloat(e.target.value) || 0)} />
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="filters">
                    <div className="fld">
                      <label>Ricerca</label>
                      <input className="ctl" placeholder="Marca, modello, misura..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                    </div>
                    <div className="fld">
                      <label>Origine</label>
                      <select className="ctl" value={filterOrigine} onChange={e => setFilterOrigine(e.target.value)}>
                        <option value="">-- TUTTE --</option>
                        <option value="EU">Europa</option>
                        <option value="CN">Cina</option>
                      </select>
                    </div>
                    <div className="fld">
                      <label>Marca</label>
                      <select className="ctl" value={filterMarca} onChange={e => setFilterMarca(e.target.value)}>
                        <option value="">-- TUTTE --</option>
                        {uniqueMarche.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div className="fld">
                      <label>Fornitore</label>
                      <select className="ctl" value={filterSupplier} onChange={e => setFilterSupplier(e.target.value)}>
                        <option value="">-- TUTTI --</option>
                        {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                    <div className="fld">
                      <label>&nbsp;</label>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <button className="tbtn" onClick={() => { setSearchQuery(''); setFilterMarca(''); setFilterSupplier(''); setFilterOrigine(''); }}>
                          <X size={12} /> Azzera
                        </button>
                        <button className={`tbtn ${compactView ? 'primary' : ''}`} onClick={() => setCompactView(!compactView)} title="Alterna vista compatta/normale">
                          {compactView ? '≡ Normale' : '≡ Compatta'}
                        </button>
                        {hiddenColumns.length > 0 && (
                          <button className="tbtn" onClick={showAllColumns} title="Riporta tutte le colonne visibili" style={{ background: '#fff59d', borderColor: '#f57f17', color: '#bf360c' }}>
                            👁 Mostra tutte ({hiddenColumns.length} nascoste)
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Banner listino attivo */}
                  {activeSizeList && (
                    <div style={{ background: '#fff8e1', border: '1px solid #ffb74d', padding: 8, margin: '0 8px 6px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div style={{ fontSize: 12, color: '#bf360c' }}>
                        🎯 <b>Listino attivo:</b> "{activeSizeList.name}" — il catalogo mostra solo le {activeSizeList.items.length} misure di questo listino. Trovati {filteredItems.length} articoli compatibili.
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="tbtn" onClick={() => setActiveSection('sizelists')} style={{ fontSize: 10 }}>
                          <Settings size={11} /> Gestisci listini
                        </button>
                        <button className="tbtn" onClick={() => setActiveSizeListId(null)} style={{ fontSize: 10 }}>
                          <X size={11} /> Disattiva filtro
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Banner vista filtrata (colonne nascoste = totale ricalcolato) */}
                  {voci_escluse_labels.length > 0 && (
                    <div style={{ background: '#fff3e0', border: '1px solid #ff9800', padding: 8, margin: '0 8px 6px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div style={{ fontSize: 12, color: '#bf360c' }}>
                        ⚠ <b>Vista TOTALE filtrata</b> — il totale di ogni riga ESCLUDE: <b>{voci_escluse_labels.join(', ')}</b>. I prezzi mostrati sono inferiori a quelli reali e servono solo per simulazioni.
                      </div>
                      <button className="tbtn" onClick={showAllColumns} style={{ fontSize: 10, background: '#fff3e0', borderColor: '#ff9800', color: '#bf360c' }}>
                        ↺ Ripristina vista completa
                      </button>
                    </div>
                  )}

                  {/* Barra pannello confronto */}
                  {compareItemIds.length > 0 && (
                    <div style={{ background: '#e3f2fd', border: '1px solid #1976d2', padding: 8, margin: '0 8px 6px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div style={{ fontSize: 12, color: '#0d47a1' }}>
                        📊 <b>{compareItems.length} articol{compareItems.length === 1 ? 'o' : 'i'} nel pannello confronto</b>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="tbtn primary" onClick={() => setComparePanelOpen(!comparePanelOpen)} style={{ fontSize: 10 }}>
                          {comparePanelOpen ? '◀ Chiudi pannello' : '▶ Apri pannello'}
                        </button>
                        <button className="tbtn" onClick={clearCompare} style={{ fontSize: 10 }}>
                          <X size={11} /> Svuota
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="grid-wrap">
                    <table className={`grid ${compactView ? 'compact' : ''} ${activeCatalogTab !== 'eu' ? 'scomposto' : ''}`}>
                      <thead>
                        <tr>
                          <th style={{ width: 26, textAlign: 'center', cursor: 'default' }}>Sel</th>
                          <th style={{ width: 50 }}>Orig.</th>
                          <th onClick={() => toggleSort('marca')}>Marca {sortBy.field === 'marca' && <span className="si">{sortBy.dir === 'asc' ? '▲' : '▼'}</span>}</th>
                          <th onClick={() => toggleSort('modello')}>Modello</th>
                          <th onClick={() => toggleSort('misura')}>Misura</th>
                          {activeCatalogTab === 'all' && <th>Fornitore</th>}
                          <th className="num" onClick={() => toggleSort('qtyDisponibile')} title="Quantità disponibile (editabile cliccando)">Q.tà</th>
                          <th className="num" onClick={() => toggleSort('prezzoOriginale')} title="Prezzo originale (editabile cliccando)">Prezzo Orig.</th>
                          {/* Colonne scomposte — solo se stiamo mostrando CN */}
                          {activeCatalogTab !== 'eu' && <>
                            {!hiddenColumns.includes('fobEur') && <th className="num col-cn col-clickable" title="Click per nascondere · FOB EUR = USD / cambio" onClick={() => toggleColumnVisibility('fobEur')}>FOB € <span className="hide-x">×</span></th>}
                            {!hiddenColumns.includes('noloPerPezzo') && <th className="num col-cn col-clickable" title="Click per nascondere · Nolo per pezzo" onClick={() => toggleColumnVisibility('noloPerPezzo')}>Nolo € <span className="hide-x">×</span></th>}
                            {!hiddenColumns.includes('aggPerPezzo') && <th className="num col-cn col-clickable" title="Click per nascondere · Aggiustamento v.45" onClick={() => toggleColumnVisibility('aggPerPezzo')}>Aggiust € <span className="hide-x">×</span></th>}
                            {!hiddenColumns.includes('valoreStatistico') && <th className="num col-cn col-clickable" title="Click per nascondere · Valore Statistico CIF" onClick={() => toggleColumnVisibility('valoreStatistico')}>CIF € <span className="hide-x">×</span></th>}
                            {!hiddenColumns.includes('dazio') && <th className="num col-cn col-clickable" title="Click per nascondere · Dazio A00 (4,5%)" onClick={() => toggleColumnVisibility('dazio')}>Dazio € <span className="hide-x">×</span></th>}
                            {!hiddenColumns.includes('tassePerPezzo') && <th className="num col-cn col-clickable" title="Click per nascondere · 9AJ Diritto Marittimo" onClick={() => toggleColumnVisibility('tassePerPezzo')}>9AJ € <span className="hide-x">×</span></th>}
                            {!hiddenColumns.includes('iva') && <th className="num col-cn col-clickable" title="Click per nascondere · IVA B00 (22%)" onClick={() => toggleColumnVisibility('iva')}>IVA € <span className="hide-x">×</span></th>}
                            {!hiddenColumns.includes('extraNoloPerPezzo') && <th className="num col-cn col-extra col-clickable" title="Click per nascondere · Extra Nolo art.74" onClick={() => toggleColumnVisibility('extraNoloPerPezzo')}>ExtraNolo € <span className="hide-x">×</span></th>}
                            {!hiddenColumns.includes('serviziIvaPerPezzo') && <th className="num col-cn col-extra col-clickable" title="Click per nascondere · Servizi con IVA" onClick={() => toggleColumnVisibility('serviziIvaPerPezzo')}>Servizi € <span className="hide-x">×</span></th>}
                            {!hiddenColumns.includes('commissioniPerPezzo') && <th className="num col-cn col-extra col-clickable" title="Click per nascondere · Commissioni" onClick={() => toggleColumnVisibility('commissioniPerPezzo')}>Comm € <span className="hide-x">×</span></th>}
                          </>}
                          {!hiddenColumns.includes('pfu') && <th className="num col-clickable" title="Click per nascondere · PFU" onClick={() => toggleColumnVisibility('pfu')}>PFU € <span className="hide-x">×</span></th>}
                          <th className="num col-finale" onClick={() => toggleSort('prezzoFinale')}>TOTALE €</th>
                          <th style={{ width: 28, cursor: 'default' }} title="Aggiungi al pannello confronto">⊕</th>
                          <th style={{ width: 28, cursor: 'default' }} title="Modifica completa">✏️</th>
                          <th style={{ width: 28, cursor: 'default' }} title="Simulatore">🔍</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredItems.slice(0, compactView ? 1500 : 500).map(item => {
                          const isSelected = selectedItems.some(i => i.id === item.id);
                          // Per articoli CN uso la scomposizione live, per EU i valori statici
                          const sc = item.origine === 'CN' ? scomposizioneCatalogo[item.id] : null;
                          const prezzoFinale = sc ? sc.costoFinale : (parseFloat(item.prezzoFinale) || 0);
                          return (
                            <tr key={item.id} className={isSelected ? 'selected' : ''} onClick={() => toggleSelect(item)}>
                              <td style={{ textAlign: 'center' }}>
                                <span className={`chk ${isSelected ? 'on' : ''}`}>{isSelected ? '✓' : ''}</span>
                              </td>
                              <td><span className={`tag-origine ${item.origine}`}>{item.origine}</span></td>
                              <td style={{ fontWeight: 600 }}>{item.marca}</td>
                              <td>{item.modello || '—'}</td>
                              <td><span className="tag-mis">{item.misura || '—'}</span></td>
                              {activeCatalogTab === 'all' && <td><span className="tag-sup">{item.supplierName}</span></td>}
                              <td className="num" onClick={e => e.stopPropagation()}>
                                <input
                                  type="number"
                                  min="0"
                                  step="2"
                                  value={item.qtyDisponibile || 0}
                                  onChange={e => updateItemField(item.id, 'qtyDisponibile', parseInt(e.target.value) || 0)}
                                  className="inline-edit-inp"
                                  title="Modifica quantità disponibile"
                                />
                              </td>
                              <td className="num price-orig" onClick={e => e.stopPropagation()}>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={item.prezzoOriginale || 0}
                                  onChange={e => updateItemField(item.id, 'prezzoOriginale', parseFloat(e.target.value) || 0)}
                                  className="inline-edit-inp"
                                  title="Modifica prezzo originale"
                                />
                                {item.currency !== 'EUR' && <span className="tag-cur">{item.currency}</span>}
                              </td>
                              {/* Colonne scomposte */}
                              {activeCatalogTab !== 'eu' && <>
                                {item.origine === 'CN' && sc ? <>
                                  {!hiddenColumns.includes('fobEur') && <td className="num col-cn">{fmtEur(sc.fobEur)}</td>}
                                  {!hiddenColumns.includes('noloPerPezzo') && <td className="num col-cn">{fmtEur(sc.noloPerPezzo)}</td>}
                                  {!hiddenColumns.includes('aggPerPezzo') && <td className="num col-cn">{fmtEur(sc.aggPerPezzo)}</td>}
                                  {!hiddenColumns.includes('valoreStatistico') && <td className="num col-cn col-cif"><b>{fmtEur(sc.valoreStatistico)}</b></td>}
                                  {!hiddenColumns.includes('dazio') && <td className="num col-cn">{fmtEur(sc.dazio)}</td>}
                                  {!hiddenColumns.includes('tassePerPezzo') && <td className="num col-cn">{fmtEur(sc.tassePerPezzo)}</td>}
                                  {!hiddenColumns.includes('iva') && <td className="num col-cn">{fmtEur(sc.iva)}</td>}
                                  {!hiddenColumns.includes('extraNoloPerPezzo') && <td className="num col-cn col-extra">{fmtEur(sc.extraNoloPerPezzo)}</td>}
                                  {!hiddenColumns.includes('serviziIvaPerPezzo') && <td className="num col-cn col-extra">{fmtEur(sc.serviziIvaPerPezzo)}</td>}
                                  {!hiddenColumns.includes('commissioniPerPezzo') && <td className="num col-cn col-extra">{fmtEur(sc.commissioniPerPezzo)}</td>}
                                </> : <>
                                  {/* Articolo EU: colonne CN vuote */}
                                  {!hiddenColumns.includes('fobEur') && <td className="num col-cn">—</td>}
                                  {!hiddenColumns.includes('noloPerPezzo') && <td className="num col-cn">—</td>}
                                  {!hiddenColumns.includes('aggPerPezzo') && <td className="num col-cn">—</td>}
                                  {!hiddenColumns.includes('valoreStatistico') && <td className="num col-cn">—</td>}
                                  {!hiddenColumns.includes('dazio') && <td className="num col-cn">—</td>}
                                  {!hiddenColumns.includes('tassePerPezzo') && <td className="num col-cn">—</td>}
                                  {!hiddenColumns.includes('iva') && <td className="num col-cn">—</td>}
                                  {!hiddenColumns.includes('extraNoloPerPezzo') && <td className="num col-cn col-extra">—</td>}
                                  {!hiddenColumns.includes('serviziIvaPerPezzo') && <td className="num col-cn col-extra">—</td>}
                                  {!hiddenColumns.includes('commissioniPerPezzo') && <td className="num col-cn col-extra">—</td>}
                                </>}
                              </>}
                              {!hiddenColumns.includes('pfu') && <td className="num">{fmtEur(sc ? sc.pfuPezzo : item.pfu)}</td>}
                              <td className="num price-final col-finale">
                                {(() => {
                                  // Per articoli CN con scomposizione, calcolo il totale filtrato
                                  let totVisible, totFull;
                                  if (sc) {
                                    totFull = sc.costoFinale;
                                    totVisible = calcTotaleFiltrato(sc);
                                  } else {
                                    totFull = parseFloat(item.prezzoFinale) || 0;
                                    totVisible = totFull; // EU: nessun filtro
                                  }
                                  const filtered = Math.abs(totVisible - totFull) > 0.001;
                                  return (
                                    <>
                                      <span style={{ color: filtered ? '#bf360c' : undefined }}>€ {fmtEur(totVisible)}</span>
                                      {filtered && (
                                        <span title={`Totale filtrato: voci escluse: ${voci_escluse_labels.join(', ')}\nTotale completo: € ${fmtEur(totFull)}`}
                                              style={{ fontSize: 8, marginLeft: 4, background: '#fff3e0', color: '#bf360c', padding: '1px 4px', border: '1px solid #ff9800', borderRadius: 2, fontWeight: 700 }}>
                                          ⚠ FILTRATO
                                        </span>
                                      )}
                                      {!filtered && item.origine === 'CN' && !item.lastBollaId && (
                                        <span title="Prezzo stimato con parametri attuali" style={{ fontSize: 8, marginLeft: 4, background: '#fff3e0', color: '#e65100', padding: '1px 4px', border: '1px solid #ffb74d', borderRadius: 2, fontWeight: 700 }}>LIVE</span>
                                      )}
                                      {!filtered && item.lastBollaId && (
                                        <span title="Prezzo aggiornato con bolla reale" style={{ fontSize: 8, marginLeft: 4, background: '#e8f5e9', color: '#1b5e20', padding: '1px 4px', border: '1px solid #66bb6a', borderRadius: 2, fontWeight: 700 }}>REALE</span>
                                      )}
                                    </>
                                  );
                                })()}
                              </td>
                              <td style={{ textAlign: 'center', padding: 2 }} onClick={e => e.stopPropagation()}>
                                <button className={`tbtn ${compareItemIds.includes(item.id) ? 'primary' : ''}`} onClick={() => compareItemIds.includes(item.id) ? removeFromCompare(item.id) : addToCompare(item)} title={compareItemIds.includes(item.id) ? 'Rimuovi dal confronto' : 'Aggiungi al pannello confronto'} style={{ padding: '1px 5px', height: 20, fontSize: 10 }}>
                                  {compareItemIds.includes(item.id) ? '⊖' : '⊕'}
                                </button>
                              </td>
                              <td style={{ textAlign: 'center', padding: 2 }} onClick={e => e.stopPropagation()}>
                                <button className="tbtn" onClick={() => openEditItemModal(item)} title="Modifica articolo (tutti i campi)" style={{ padding: '1px 5px', height: 20, fontSize: 10 }}>
                                  ✏️
                                </button>
                              </td>
                              <td style={{ textAlign: 'center', padding: 2 }} onClick={e => e.stopPropagation()}>
                                <button className="tbtn" onClick={() => openSimulatorFromItem(item)} title="Apri simulatore What-If per vedere la scomposizione prezzo" style={{ padding: '1px 5px', height: 20, fontSize: 10 }}>
                                  <Search size={10} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {filteredItems.length > (compactView ? 1500 : 500) && (
                      <div style={{ padding: 8, textAlign: 'center', fontSize: 11, color: '#78909c', background: '#f5f7fa', borderTop: '1px solid #cfd8dc' }}>
                        Visualizzati primi {compactView ? 1500 : 500} di {fmtInt(filteredItems.length)} — {compactView ? 'affinare filtri' : 'passa a vista compatta per più righe'}
                      </div>
                    )}
                    {filteredItems.length === 0 && <div className="empty"><div className="em-ttl">Nessun record</div>Modificare i filtri.</div>}
                  </div>

                  <div className="statusbar">
                    <div className="sb-item">Record: <b>{filteredItems.length}</b> / {fmtInt(allItems.length)}</div>
                    <div className="sb-item">Selezionati: <b>{selectedItems.length}</b></div>
                    <div className="sb-item">Valore selezione: <span className="total">€ {fmtEur(totaleSelezione)}</span></div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ===== SELEZIONE ===== */}
          {activeSection === 'selezione' && (
            <div className="window">
              <div className="window-title">
                <span>Selezione Corrente — Foglio di Lavoro Vivo</span>
                <span className="breadcrumb">Home › Selezione</span>
              </div>
              {selectedItems.length === 0 ? (
                <div className="empty"><div className="em-ttl">Nessun articolo selezionato</div>Accedere al Catalogo e cliccare sulle righe (oppure cliccare ⊕ per aggiungere al confronto).</div>
              ) : (
                <>
                  {/* ===== PANNELLO SIMULAZIONE ===== */}
                  <div className="sel-sim-panel">
                    <div className="sel-sim-head" onClick={() => setSelSimPanelOpen(!selSimPanelOpen)}>
                      <span>⚙️ <b>Simulazione Selezione</b> {selSimParams ? <span className="sel-sim-active">ATTIVA</span> : <span className="sel-sim-inactive">non attiva (uso parametri di ogni fornitore)</span>}</span>
                      <span style={{ fontSize: 11 }}>{selSimPanelOpen ? '▼ chiudi' : '▶ apri'}</span>
                    </div>
                    {selSimPanelOpen && (
                      <div className="sel-sim-body">
                        {/* Bottoni "carica da fornitore" */}
                        <div className="sel-sim-load">
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#0d47a1' }}>📥 Carica parametri da:</span>
                          {suppliers.filter(s => s.origine === 'CN').map(s => (
                            <button key={s.id} className="tbtn" onClick={() => loadSupplierParamsToSim(s.id)} style={{ fontSize: 10 }}>
                              🇨🇳 {s.name}
                            </button>
                          ))}
                          <button className="tbtn" onClick={() => { setSelSimParams({ ...chinaParams, qtyTotale: selectedItems.reduce((s, x) => s + (x.qtyRichiesta || 1), 0) }); setSelSimPanelOpen(true); }} style={{ fontSize: 10 }}>
                            🌐 Globali
                          </button>
                          {selSimParams && <button className="tbtn danger" onClick={resetSelSim} style={{ fontSize: 10 }}>↺ Reset (usa fornitore)</button>}
                        </div>

                        {/* Parametri editabili (visibile solo se sim attiva) */}
                        {selSimParams && (
                          <>
                            <div className="sel-sim-params">
                              <div className="sup-fld">
                                <label>Rotta/Container</label>
                                <select className="ctl" value={selSimParams.noloPreset || 'hcm_40'} onChange={e => applyPresetToSelSim(e.target.value)}>
                                  {Object.entries(NOLO_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                                </select>
                              </div>
                              <div className="sup-fld"><label>Cambio €/$</label><input className="ctl" type="number" step="0.0001" value={selSimParams.tassoEurUsd} onChange={e => updateSelSimParam('tassoEurUsd', parseFloat(e.target.value) || 1)} /></div>
                              <div className="sup-fld"><label>Qty rif.</label><input className="ctl" type="number" value={selSimParams.qtyTotale} onChange={e => updateSelSimParam('qtyTotale', parseInt(e.target.value) || 0)} /></div>
                              <div className="sup-fld"><label>Nolo $</label><input className="ctl" type="number" value={selSimParams.noloMare} onChange={e => updateSelSimParam('noloMare', parseFloat(e.target.value) || 0)} /></div>
                              <div className="sup-fld"><label>Fuel mare €</label><input className="ctl" type="number" value={selSimParams.fuelSurcharge} onChange={e => updateSelSimParam('fuelSurcharge', parseFloat(e.target.value) || 0)} /></div>
                              <div className="sup-fld"><label>THC €</label><input className="ctl" type="number" value={selSimParams.costiSbarco} onChange={e => updateSelSimParam('costiSbarco', parseFloat(e.target.value) || 0)} /></div>
                              <div className="sup-fld"><label>Dogana €</label><input className="ctl" type="number" value={selSimParams.doganaImport} onChange={e => updateSelSimParam('doganaImport', parseFloat(e.target.value) || 0)} /></div>
                              <div className="sup-fld"><label>Trasp. int. €</label><input className="ctl" type="number" value={selSimParams.trasportoInterno} onChange={e => updateSelSimParam('trasportoInterno', parseFloat(e.target.value) || 0)} /></div>
                              <div className="sup-fld"><label>Dazio %</label><input className="ctl" type="number" step="0.1" value={selSimParams.dazioPct} onChange={e => updateSelSimParam('dazioPct', parseFloat(e.target.value) || 0)} /></div>
                              <div className="sup-fld"><label>IVA %</label><input className="ctl" type="number" step="0.5" value={selSimParams.ivaPct} onChange={e => updateSelSimParam('ivaPct', parseFloat(e.target.value) || 0)} /></div>
                              <div className="sup-fld"><label>Markup ×</label><input className="ctl" type="number" step="0.05" value={selSimParams.markup} onChange={e => updateSelSimParam('markup', parseFloat(e.target.value) || 1)} /></div>
                              <div className="sup-fld"><label>Aggiust. €</label><input className="ctl" type="number" step="0.5" value={selSimParams.aggiustamento} onChange={e => updateSelSimParam('aggiustamento', parseFloat(e.target.value) || 0)} /></div>
                            </div>

                            {/* Salva scenario + scenari salvati */}
                            <div className="sel-sim-scenarios">
                              <button className="tbtn primary" onClick={saveScenario} style={{ fontSize: 10 }}>
                                💾 Salva scenario corrente
                              </button>
                              {selScenarios.length > 0 && (
                                <button className="tbtn" onClick={clearScenarios} style={{ fontSize: 10 }}>
                                  <X size={11} /> Cancella tutti gli scenari ({selScenarios.length})
                                </button>
                              )}
                            </div>

                            {/* Tabella confronto scenari */}
                            {selScenarios.length > 0 && (
                              <div className="sel-sim-scen-table">
                                <table className="grid compact">
                                  <thead>
                                    <tr>
                                      <th>Scenario</th>
                                      <th className="num">Cambio</th>
                                      <th className="num">Nolo $</th>
                                      <th className="num">Dazio %</th>
                                      <th className="num">Costo Tot.</th>
                                      <th className="num">Vendita Tot.</th>
                                      <th className="num">Δ vs corrente</th>
                                      <th></th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {selScenarios.map(sc => {
                                      const delta = sc.totali.totCosto - totaliSelezione.totCosto;
                                      const deltaPct = totaliSelezione.totCosto > 0 ? (delta / totaliSelezione.totCosto * 100) : 0;
                                      return (
                                        <tr key={sc.id}>
                                          <td><b>{sc.name}</b></td>
                                          <td className="num">{sc.params.tassoEurUsd?.toFixed(4) || '—'}</td>
                                          <td className="num">{fmtEur(sc.params.noloMare)}</td>
                                          <td className="num">{sc.params.dazioPct}%</td>
                                          <td className="num"><b>€ {fmtEur(sc.totali.totCosto)}</b></td>
                                          <td className="num"><b>€ {fmtEur(sc.totali.totVendita)}</b></td>
                                          <td className="num" style={{ color: delta < 0 ? '#1b5e20' : (delta > 0 ? '#c62828' : '#546e7a'), fontWeight: 700 }}>
                                            {delta >= 0 ? '+' : ''}{fmtEur(delta)} € ({deltaPct >= 0 ? '+' : ''}{deltaPct.toFixed(1)}%)
                                          </td>
                                          <td>
                                            <button className="tbtn" onClick={() => loadScenario(sc.id)} style={{ fontSize: 9, padding: '1px 4px' }}>↻ Carica</button>
                                            <button className="tbtn danger" onClick={() => deleteScenario(sc.id)} style={{ fontSize: 9, padding: '1px 4px', marginLeft: 2 }}><X size={9} /></button>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ===== TABELLA SCOMPOSTA ===== */}
                  <div className="grid-wrap">
                    <table className="grid scomposto">
                      <thead>
                        <tr>
                          <th>Orig.</th>
                          <th>Marca</th>
                          <th>Misura</th>
                          <th>Fornitore</th>
                          <th className="num" style={{ width: 60 }}>Q.tà</th>
                          <th className="num">P.Orig.</th>
                          <th className="num col-cn">FOB €</th>
                          <th className="num col-cn">Nolo €</th>
                          <th className="num col-cn">CIF €</th>
                          <th className="num col-cn">Dazio €</th>
                          <th className="num col-cn">IVA €</th>
                          <th className="num col-cn col-extra">Extra €</th>
                          <th className="num col-cn col-extra">Servizi €</th>
                          <th className="num">PFU €</th>
                          <th className="num col-finale">Costo /pz</th>
                          <th className="num col-finale">Subtotale</th>
                          <th className="num col-finale">Vendita /pz</th>
                          <th className="num col-finale">Vend. tot.</th>
                          <th style={{ width: 32 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedItems.map(item => {
                          const sc = scomposizioneSelezione[item.id];
                          const qty = item.qtyRichiesta || 1;
                          const costoUnit = sc ? sc.costoFinale : (parseFloat(item.prezzoFinale) || 0);
                          const venditaUnit = sc ? sc.prezzoVendita : costoUnit;
                          return (
                            <tr key={item.id}>
                              <td><span className={`tag-origine ${item.origine}`}>{item.origine}</span></td>
                              <td style={{ fontWeight: 600 }}>{item.marca} {item.modello && <span style={{ color: '#90a4ae', fontWeight: 400 }}>· {item.modello}</span>}</td>
                              <td><span className="tag-mis">{item.misura || '—'}</span></td>
                              <td><span className="tag-sup">{item.supplierName}</span></td>
                              <td className="num">
                                <input type="number" min="1" className="qty-inp" value={qty} onChange={e => updateSelectedQty(item.id, e.target.value)} />
                              </td>
                              <td className="num price-orig">{fmtEur(item.prezzoOriginale)}{item.currency !== 'EUR' && <span className="tag-cur">{item.currency}</span>}</td>
                              <td className="num col-cn">{sc ? fmtEur(sc.fobEur) : '—'}</td>
                              <td className="num col-cn">{sc ? fmtEur(sc.noloPerPezzo) : '—'}</td>
                              <td className="num col-cn col-cif">{sc ? <b>{fmtEur(sc.valoreStatistico)}</b> : '—'}</td>
                              <td className="num col-cn">{sc ? fmtEur(sc.dazio) : '—'}</td>
                              <td className="num col-cn">{sc ? fmtEur(sc.iva) : '—'}</td>
                              <td className="num col-cn col-extra">{sc ? fmtEur(sc.extraNoloPerPezzo) : '—'}</td>
                              <td className="num col-cn col-extra">{sc ? fmtEur(sc.serviziIvaPerPezzo) : '—'}</td>
                              <td className="num">{fmtEur(sc ? sc.pfuPezzo : item.pfu)}</td>
                              <td className="num col-finale price-final">€ {fmtEur(costoUnit)}</td>
                              <td className="num col-finale price-final">€ {fmtEur(costoUnit * qty)}</td>
                              <td className="num col-finale" style={{ color: '#2e7d32' }}>€ {fmtEur(venditaUnit)}</td>
                              <td className="num col-finale" style={{ color: '#2e7d32', fontWeight: 700 }}>€ {fmtEur(venditaUnit * qty)}</td>
                              <td style={{ textAlign: 'center' }}>
                                <button className="tbtn danger" style={{ padding: '2px 6px', height: 22 }} onClick={() => removeSelected(item.id)}><X size={11} /></button>
                              </td>
                            </tr>
                          );
                        })}
                        {/* RIGA TOTALI */}
                        <tr className="sel-totals-row">
                          <td colSpan="4" style={{ textAlign: 'right', fontWeight: 700 }}>TOTALI ORDINE →</td>
                          <td className="num"><b>{totaliSelezione.totQty}</b></td>
                          <td colSpan="1"></td>
                          <td className="num col-cn"><b>{fmtEur(totaliSelezione.totFobEur)}</b></td>
                          <td className="num col-cn"><b>{fmtEur(totaliSelezione.totNolo)}</b></td>
                          <td className="num col-cn col-cif"><b>{fmtEur(totaliSelezione.totCif)}</b></td>
                          <td className="num col-cn"><b>{fmtEur(totaliSelezione.totDazio)}</b></td>
                          <td className="num col-cn"><b>{fmtEur(totaliSelezione.totIva)}</b></td>
                          <td className="num col-cn col-extra"><b>{fmtEur(totaliSelezione.totExtra)}</b></td>
                          <td className="num col-cn col-extra"><b>{fmtEur(totaliSelezione.totServizi)}</b></td>
                          <td className="num"><b>{fmtEur(totaliSelezione.totPfu)}</b></td>
                          <td className="num col-finale" colSpan="2" style={{ background: '#1976d2', color: '#fff' }}><b>COSTO: € {fmtEur(totaliSelezione.totCosto)}</b></td>
                          <td className="num col-finale" colSpan="2" style={{ background: '#2e7d32', color: '#fff' }}><b>VENDITA: € {fmtEur(totaliSelezione.totVendita)}</b></td>
                          <td></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* ===== KPI MARGINE ===== */}
                  <div className="sel-kpi-row">
                    <div className="sel-kpi-box">
                      <span className="lbl">Pezzi totali</span>
                      <span className="val">{totaliSelezione.totQty}</span>
                    </div>
                    <div className="sel-kpi-box">
                      <span className="lbl">Costo medio /pz</span>
                      <span className="val">€ {fmtEur(totaliSelezione.totQty > 0 ? totaliSelezione.totCosto / totaliSelezione.totQty : 0)}</span>
                    </div>
                    <div className="sel-kpi-box cost">
                      <span className="lbl">Costo totale ordine</span>
                      <span className="val">€ {fmtEur(totaliSelezione.totCosto)}</span>
                    </div>
                    <div className="sel-kpi-box revenue">
                      <span className="lbl">Vendita totale</span>
                      <span className="val">€ {fmtEur(totaliSelezione.totVendita)}</span>
                    </div>
                    <div className="sel-kpi-box margin">
                      <span className="lbl">Margine</span>
                      <span className="val">€ {fmtEur(totaliSelezione.margine)} ({totaliSelezione.marginePct.toFixed(1)}%)</span>
                    </div>
                  </div>

                  {/* CTA Bolla doganale */}
                  {selectedItems.filter(i => i.origine === 'CN').length > 0 && (
                    <div style={{ background: '#ffebee', border: '1px solid #ef9a9a', padding: 10, margin: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ fontSize: 12, color: '#b71c1c' }}>
                        <b>📄 {selectedItems.filter(i => i.origine === 'CN').length} articoli Cina selezionati</b> — Pronto per generare la bolla doganale DAU.
                      </div>
                      <button className="tbtn china" onClick={openBollaFromSelection} style={{ fontWeight: 700 }}>
                        <FileText size={13} /> Genera Bolla Doganale ▸
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ===== FORNITORI ===== */}
          {activeSection === 'fornitori' && (
            <div className="window">
              <div className="window-title"><span>Anagrafica Fornitori</span><span className="breadcrumb">Home › Fornitori</span></div>
              {suppliers.length === 0 ? (
                <div className="empty"><div className="em-ttl">Nessun fornitore</div>Si popola automaticamente ad ogni importazione.</div>
              ) : (
                <div style={{ overflowY: 'auto', flex: 1 }}>
                  {suppliers.map(s => (
                    <div key={s.id} className={`sup-card ${s.origine === 'CN' ? 'china-card' : ''}`}>
                      <div className="sc-head">
                        <span>▸ {s.name} <span className={`tag-origine ${s.origine || 'EU'}`} style={{ marginLeft: 8 }}>{s.origine || 'EU'}</span></span>
                        <button className="tbtn danger" style={{ padding: '2px 8px', height: 20, fontSize: 10 }} onClick={() => deleteSupplier(s.id)}>
                          <Trash2 size={10} /> Elimina
                        </button>
                      </div>
                      <div className="sc-body">
                        <div className="sup-row-item"><span className="lbl">Codice fornitore</span><span className="val">{s.id}</span></div>
                        <div className="sup-row-item"><span className="lbl">Data importazione</span><span className="val">{new Date(s.importDate).toLocaleString('it-IT')}</span></div>
                        <div className="sup-row-item"><span className="lbl">Articoli caricati</span><span className="val">{fmtInt(s.itemCount)}</span></div>
                        <div className="sup-row-item"><span className="lbl">Valuta</span><span className="val">{s.currency}</span></div>
                        {s.origine !== 'CN' && (<>
                          <div className="sup-row-item"><span className="lbl">PFU applicato</span><span className="val">€ {fmtEur(s.pfu)} / pz</span></div>
                          <div className="sup-row-item"><span className="lbl">Trasporto totale</span><span className="val">€ {fmtEur(s.trasporto)}</span></div>
                          <div className="sup-row-item"><span className="lbl">Q.tà di carico</span><span className="val">{s.qty} pz</span></div>
                        </>)}
                        {s.origine === 'CN' && s.bollaId && (
                          <div className="sup-row-item"><span className="lbl">Bolla doganale</span><span className="val">{s.bollaId}</span></div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ===== LISTINI MISURE ===== */}
          {activeSection === 'sizelists' && (
            <div className="window">
              <div className="window-title">
                <span>Listini Misure — Definisci cosa ti serve davvero</span>
                <span className="breadcrumb">Home › Listini Misure</span>
              </div>
              <div className="filters" style={{ background: '#fff8e1', borderColor: '#ffb74d' }}>
                <div className="fld" style={{ gridColumn: 'span 2' }}>
                  <label>Listino attivo (filtra il catalogo)</label>
                  <select className="ctl" value={activeSizeListId || ''} onChange={e => setActiveSizeListId(e.target.value || null)}>
                    <option value="">— NESSUNO (mostra tutto) —</option>
                    {sizeLists.map(l => <option key={l.id} value={l.id}>{l.name} ({l.items.length} misure, {l.qtyTotale} pz)</option>)}
                  </select>
                </div>
                <div className="fld">
                  <label>&nbsp;</label>
                  <button className="tbtn primary" onClick={createSizeList}><Plus size={12} /> Nuovo Listino</button>
                </div>
                <div className="fld" style={{ gridColumn: 'span 2', alignSelf: 'end' }}>
                  <div style={{ fontSize: 11, color: '#5d4037', padding: '4px 8px', background: '#ffe0b2', border: '1px solid #ffb74d' }}>
                    💡 Imposta percentuali e quantità totale: il sistema calcola le qty per misura (sempre numeri pari).
                  </div>
                </div>
              </div>

              {sizeLists.length === 0 ? (
                <div className="empty">
                  <div className="em-ttl">Nessun listino misure</div>
                  Crea un listino con le misure che ti interessano per filtrare il catalogo automaticamente.
                </div>
              ) : (
                <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
                  {sizeLists.map(list => {
                    const calcRows = calcolaQtyListino(list);
                    const isActive = list.id === activeSizeListId;
                    const sommaPct = list.items.reduce((s, i) => s + (parseFloat(i.percentuale) || 0), 0);
                    const sommaQty = calcRows.reduce((s, r) => s + r.qty, 0);
                    return (
                      <div key={list.id} style={{ background: '#fff', border: isActive ? '2px solid #ff9800' : '1px solid #cfd8dc', marginBottom: 10 }}>
                        <div style={{ background: isActive ? 'linear-gradient(to bottom,#ffcc80,#ffb74d)' : 'linear-gradient(to bottom,#eceff1,#cfd8dc)', padding: '6px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <List size={14} />
                            <b style={{ fontSize: 14 }}>{list.name}</b>
                            <span style={{ fontSize: 10, color: '#5d4037' }}>({list.items.length} misure · {list.qtyTotale} pz tot · {sommaPct.toFixed(0)}%)</span>
                            {isActive && <span style={{ background: '#ff9800', color: '#fff', padding: '1px 6px', fontSize: 9, fontWeight: 700 }}>ATTIVO</span>}
                          </div>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="tbtn" onClick={() => { setActiveSizeListId(isActive ? null : list.id); }} style={{ fontSize: 10 }}>
                              {isActive ? '◯ Disattiva' : '✓ Attiva'}
                            </button>
                            <button className="tbtn primary" onClick={() => { setEditingSizeList({ ...list }); setShowSizeListBuilder(true); }} style={{ fontSize: 10 }}>
                              <Settings size={11} /> Modifica
                            </button>
                            <button className="tbtn" onClick={() => exportListinoPdf(list)} style={{ fontSize: 10 }}>
                              <Printer size={11} /> PDF
                            </button>
                            <button className="tbtn" onClick={() => exportListinoExcel(list)} style={{ fontSize: 10, background: 'linear-gradient(to bottom,#66bb6a,#388e3c)', color: '#fff' }}>
                              <FileSpreadsheet size={11} /> Excel
                            </button>
                            <button className="tbtn danger" onClick={() => deleteSizeList(list.id)} style={{ fontSize: 10 }}>
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </div>
                        {list.items.length > 0 && (
                          <table className="grid compact" style={{ margin: 0 }}>
                            <thead>
                              <tr>
                                <th style={{ width: 30 }}>#</th>
                                <th>Misura</th>
                                <th className="num" style={{ width: 70 }}>%</th>
                                <th className="num" style={{ width: 80 }}>Q.tà calc.</th>
                                <th>Miglior fornitore</th>
                                <th className="num">Prezzo finito €</th>
                                <th className="num">Subtotale €</th>
                              </tr>
                            </thead>
                            <tbody>
                              {calcRows.map((r, i) => {
                                const best = getPrezzoListino(r.misura, 'all');
                                const subtot = (best?.prezzo || 0) * r.qty;
                                return (
                                  <tr key={i}>
                                    <td>{i + 1}</td>
                                    <td><span className="tag-mis">{r.misura}</span></td>
                                    <td className="num">{r.percentuale}%</td>
                                    <td className="num"><b>{r.qty}</b></td>
                                    <td>{best ? <><span className={`tag-origine ${best.item.origine}`}>{best.item.origine}</span> {best.item.marca} {best.item.modello && '· ' + best.item.modello} <span className="tag-sup">{best.item.supplierName}</span></> : <span style={{ color: '#c62828', fontStyle: 'italic' }}>misura non trovata nei fornitori</span>}</td>
                                    <td className="num price-final">{best ? '€ ' + fmtEur(best.prezzo) : '—'}</td>
                                    <td className="num price-final">{best ? '€ ' + fmtEur(subtot) : '—'}</td>
                                  </tr>
                                );
                              })}
                              <tr style={{ background: '#1976d2', color: '#fff', fontWeight: 700 }}>
                                <td colSpan="3" style={{ color: '#fff' }}>TOTALI</td>
                                <td className="num" style={{ color: '#fff' }}>{sommaQty}</td>
                                <td colSpan="2" style={{ color: '#fff' }}>—</td>
                                <td className="num" style={{ color: '#fff' }}>€ {fmtEur(calcRows.reduce((s, r) => { const b = getPrezzoListino(r.misura, 'all'); return s + (b?.prezzo || 0) * r.qty; }, 0))}</td>
                              </tr>
                            </tbody>
                          </table>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* MODALE BUILDER */}
              {showSizeListBuilder && editingSizeList && (
                <div className="guide-overlay" onClick={() => { setShowSizeListBuilder(false); setEditingSizeList(null); }}>
                  <div className="guide-modal" style={{ maxWidth: 900 }} onClick={e => e.stopPropagation()}>
                    <div className="guide-header" style={{ background: 'linear-gradient(to bottom, #ff9800, #e65100)' }}>
                      <h2>📋 Modifica Listino Misure</h2>
                      <button className="sim-close" onClick={() => { setShowSizeListBuilder(false); setEditingSizeList(null); }}>✕</button>
                    </div>
                    <div className="guide-body">
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                        <div className="fld">
                          <label>Nome</label>
                          <input className="ctl" value={editingSizeList.name} onChange={e => setEditingSizeList({ ...editingSizeList, name: e.target.value })} />
                        </div>
                        <div className="fld">
                          <label>Quantità totale (pezzi)</label>
                          <input className="ctl" type="number" min="0" step="2" value={editingSizeList.qtyTotale} onChange={e => setEditingSizeList({ ...editingSizeList, qtyTotale: parseInt(e.target.value) || 0 })} />
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <input id="newSizeInp" className="ctl" placeholder="Es. 205/55R16" style={{ flex: 1 }} onKeyDown={e => { if (e.key === 'Enter') { addSizeToList(e.target.value); e.target.value = ''; } }} />
                        <button className="tbtn primary" onClick={() => { const inp = document.getElementById('newSizeInp'); addSizeToList(inp.value); inp.value = ''; }}>
                          <Plus size={12} /> Aggiungi misura
                        </button>
                      </div>

                      {editingSizeList.items.length === 0 ? (
                        <div style={{ padding: 30, textAlign: 'center', color: '#90a4ae', background: '#f5f7fa', border: '1px dashed #cfd8dc' }}>
                          Nessuna misura. Aggiungine sopra.
                        </div>
                      ) : (
                        <table className="grid">
                          <thead>
                            <tr>
                              <th style={{ width: 30 }}>#</th>
                              <th>Misura</th>
                              <th className="num" style={{ width: 100 }}>Percentuale %</th>
                              <th className="num" style={{ width: 100 }}>Q.tà calcolata</th>
                              <th style={{ width: 40 }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {editingSizeList.items.map((it, i) => {
                              const sommaPct = editingSizeList.items.reduce((s, x) => s + (parseFloat(x.percentuale) || 0), 0) || 1;
                              const pctNorm = (parseFloat(it.percentuale) || 0) / sommaPct;
                              const qtyCalc = arrotondaAlPari((editingSizeList.qtyTotale || 0) * pctNorm);
                              return (
                                <tr key={i}>
                                  <td>{i + 1}</td>
                                  <td>
                                    <input className="ctl" value={it.misura} onChange={e => updateSizeRow(i, 'misura', e.target.value.toUpperCase())} />
                                  </td>
                                  <td className="num">
                                    <input className="ctl qty-inp" type="number" min="0" max="100" step="1" value={it.percentuale} onChange={e => updateSizeRow(i, 'percentuale', parseFloat(e.target.value) || 0)} style={{ width: 80 }} />
                                  </td>
                                  <td className="num"><b>{qtyCalc}</b></td>
                                  <td>
                                    <button className="tbtn danger" onClick={() => removeSizeFromList(i)} style={{ padding: '2px 6px', height: 22 }}><X size={11} /></button>
                                  </td>
                                </tr>
                              );
                            })}
                            <tr style={{ background: '#fff3e0', fontWeight: 700 }}>
                              <td colSpan="2">SOMMA</td>
                              <td className="num">{editingSizeList.items.reduce((s, i) => s + (parseFloat(i.percentuale) || 0), 0).toFixed(1)}%</td>
                              <td className="num">{editingSizeList.items.reduce((s, i) => {
                                const sommaPct = editingSizeList.items.reduce((ss, x) => ss + (parseFloat(x.percentuale) || 0), 0) || 1;
                                return s + arrotondaAlPari((editingSizeList.qtyTotale || 0) * ((parseFloat(i.percentuale) || 0) / sommaPct));
                              }, 0)}</td>
                              <td></td>
                            </tr>
                          </tbody>
                        </table>
                      )}

                      <div style={{ marginTop: 12, padding: 8, background: '#e3f2fd', fontSize: 11, color: '#0d47a1' }}>
                        💡 Le quantità sono sempre arrotondate al numero pari più vicino (le gomme si vendono in coppie). Le percentuali possono non sommare a 100, il sistema le normalizza.
                      </div>
                    </div>
                    <div className="guide-footer" style={{ justifyContent: 'space-between' }}>
                      <button className="tbtn" onClick={() => { setShowSizeListBuilder(false); setEditingSizeList(null); }}>Annulla</button>
                      <button className="tbtn success" onClick={saveEditingSizeList}><Check size={12} /> Salva Listino</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===== CONFRONTO PREZZI ===== */}
          {activeSection === 'confronto' && (
            <div className="window">
              <div className="window-title">
                <span>Confronto Prezzi Fornitori per Misura</span>
                <span className="breadcrumb">Home › Confronto</span>
              </div>
              {allItems.length === 0 ? (
                <div className="empty"><div className="em-ttl">Catalogo vuoto</div>Importare almeno un listino per usare il confronto.</div>
              ) : (
                <>
                  <div className="filters">
                    <div className="fld" style={{ gridColumn: 'span 2' }}>
                      <label>Cerca misura o marca</label>
                      <input className="ctl" placeholder="Es. 205/55R16 oppure Michelin" value={compareMisuraQuery} onChange={e => setCompareMisuraQuery(e.target.value)} />
                    </div>
                    <div className="fld">
                      <label>&nbsp;</label>
                      <button className="tbtn" onClick={() => setCompareMisuraQuery('')}><X size={12} /> Azzera</button>
                    </div>
                    <div className="fld" style={{ gridColumn: 'span 2' }}>
                      <label>&nbsp;</label>
                      <div style={{ fontSize: 11, color: '#546e7a' }}>
                        <b>{comparisonData.length}</b> misure trovate · 
                        <b style={{ color: '#2e7d32', marginLeft: 4 }}>{comparisonData.filter(g => g.suppliersCount >= 2).length}</b> con 2+ fornitori
                      </div>
                    </div>
                  </div>

                  <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
                    {comparisonData.length === 0 && (
                      <div className="empty"><div className="em-ttl">Nessuna misura</div>Modificare la ricerca.</div>
                    )}
                    {comparisonData.slice(0, 100).map(group => (
                      <div key={group.misura} style={{ background: '#fff', border: '1px solid #cfd8dc', marginBottom: 8 }}>
                        <div style={{ background: 'linear-gradient(to bottom,#eceff1,#cfd8dc)', padding: '6px 10px', borderBottom: '1px solid #90a4ae', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, fontSize: 13, fontFamily: 'Consolas,monospace', color: '#0d47a1' }}>{group.misura}</span>
                          <span className="tag-mis" style={{ background: '#fff' }}>{group.suppliersCount} fornitor{group.suppliersCount === 1 ? 'e' : 'i'}</span>
                          <span className="tag-mis" style={{ background: '#fff' }}>{group.items.length} referenz{group.items.length === 1 ? 'a' : 'e'}</span>
                          {group.hasEU && <span className="tag-origine EU">EU</span>}
                          {group.hasCN && <span className="tag-origine CN">CN</span>}
                          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#546e7a' }}>
                            Min <b style={{ color: '#2e7d32' }}>€ {fmtEur(group.min)}</b> · Max <b style={{ color: '#c62828' }}>€ {fmtEur(group.max)}</b>
                            {group.savings > 0 && <span style={{ marginLeft: 8, background: '#e8f5e9', color: '#1b5e20', padding: '1px 6px', borderRadius: 2, fontWeight: 700, fontSize: 10 }}>Risparmio fino a {group.savings.toFixed(1)}%</span>}
                          </span>
                        </div>
                        <table className="grid compact" style={{ margin: 0 }}>
                          <thead>
                            <tr>
                              <th style={{ width: 40 }}>#</th>
                              <th style={{ width: 50 }}>Orig.</th>
                              <th>Marca</th>
                              <th>Modello</th>
                              <th>Fornitore</th>
                              <th className="num">Prezzo Orig.</th>
                              <th className="num">PFU</th>
                              <th className="num">Dazio</th>
                              <th className="num">IVA</th>
                              <th className="num">Prezzo Finale</th>
                              <th className="num">Δ vs min</th>
                              <th style={{ width: 40 }}>Sel</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.items.map((item, idx) => {
                              const isSelected = selectedItems.some(i => i.id === item.id);
                              const deltaPct = group.min > 0 ? ((item.prezzoFinale - group.min) / group.min * 100) : 0;
                              return (
                                <tr key={item.id} className={isSelected ? 'selected' : ''} style={{ cursor: 'pointer' }} onClick={() => toggleSelect(item)}>
                                  <td style={{ fontWeight: 700, color: idx === 0 ? '#2e7d32' : '#546e7a' }}>
                                    {idx === 0 ? '🏆' : `#${idx + 1}`}
                                  </td>
                                  <td><span className={`tag-origine ${item.origine}`}>{item.origine}</span></td>
                                  <td style={{ fontWeight: 600 }}>{item.marca}</td>
                                  <td>{item.modello || '—'}</td>
                                  <td><span className="tag-sup">{item.supplierName}</span></td>
                                  <td className="num price-orig">
                                    {fmtEur(item.prezzoOriginale)}
                                    {item.currency !== 'EUR' && <span className="tag-cur">{item.currency}</span>}
                                  </td>
                                  <td className="num">{fmtEur(item.pfu)}</td>
                                  <td className="num">{item.dazio ? fmtEur(item.dazio) : '—'}</td>
                                  <td className="num">{item.iva ? fmtEur(item.iva) : '—'}</td>
                                  <td className="num price-final" style={{ color: idx === 0 ? '#1b5e20' : '#1565c0' }}>€ {fmtEur(item.prezzoFinale)}</td>
                                  <td className="num" style={{ color: deltaPct > 0 ? '#c62828' : '#2e7d32', fontWeight: 600 }}>
                                    {deltaPct > 0 ? `+${deltaPct.toFixed(1)}%` : '—'}
                                  </td>
                                  <td style={{ textAlign: 'center' }}>
                                    <span className={`chk ${isSelected ? 'on' : ''}`}>{isSelected ? '✓' : ''}</span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ))}
                    {comparisonData.length > 100 && (
                      <div style={{ padding: 8, textAlign: 'center', fontSize: 11, color: '#78909c' }}>
                        Visualizzate prime 100 misure di {comparisonData.length} — affinare la ricerca
                      </div>
                    )}
                  </div>

                  <div className="statusbar">
                    <div className="sb-item">Misure: <b>{comparisonData.length}</b></div>
                    <div className="sb-item">Con più fornitori: <b>{comparisonData.filter(g => g.suppliersCount >= 2).length}</b></div>
                    <div className="sb-item">Referenze totali: <b>{comparisonData.reduce((s, g) => s + g.items.length, 0)}</b></div>
                    <div className="sb-item">Selezionati: <b>{selectedItems.length}</b></div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ===== BOLLE DOGANALI ===== */}
          {activeSection === 'bolle' && (
            <div className="window">
              <div className="window-title china-title">
                <span>Bolle Doganali — Archivio</span>
                <span className="breadcrumb">Home › Bolle</span>
              </div>
              {bolle.length === 0 ? (
                <div className="empty">
                  <div className="em-ttl">Nessuna bolla doganale</div>
                  Usare "Import Cina (DAU)" dalla toolbar per creare la prima bolla.
                </div>
              ) : (
                <div style={{ overflowY: 'auto', flex: 1 }}>
                  {bolle.map(b => {
                    const supplier = suppliers.find(s => s.id === b.supplierId);
                    return (
                      <div key={b.id} className="bolla-card">
                        <div className="bolla-card-head">
                          <span>▸ BOLLA {b.id.toUpperCase()} — {b.params.fornitore}</span>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="tbtn success" style={{ padding: '2px 8px', height: 22, fontSize: 10 }} onClick={() => generaPdfBolla(b, 'ufficiale')}>
                              <Printer size={11} /> PDF DAU Ufficiale
                            </button>
                            <button className="tbtn" style={{ padding: '2px 8px', height: 22, fontSize: 10 }} onClick={() => generaPdfBolla(b, 'semplificato')}>
                              <FileText size={11} /> PDF Riepilogo
                            </button>
                            <button className="tbtn" style={{ padding: '2px 8px', height: 22, fontSize: 10, background: 'linear-gradient(to bottom,#66bb6a,#388e3c)', color: '#fff', borderColor: '#2e7d32', fontWeight: 600 }} onClick={() => exportBollaExcel(b)}>
                              <FileSpreadsheet size={11} /> Excel Dettaglio
                            </button>
                            <button className="tbtn" style={{ padding: '2px 8px', height: 22, fontSize: 10, background: 'linear-gradient(to bottom,#42a5f5,#1565c0)', color: '#fff', borderColor: '#0d47a1', fontWeight: 600 }} onClick={() => openSimulatorFromBolla(b)} title="Simulatore What-If: modifica valori e vedi impatto">
                              <Search size={11} /> Simulatore What-If
                            </button>
                            <button className="tbtn danger" style={{ padding: '2px 8px', height: 22, fontSize: 10 }} onClick={() => deleteBolla(b.id)}>
                              <Trash2 size={10} />
                            </button>
                          </div>
                        </div>
                        <div className="bolla-card-body">
                          <div className="bolla-stat-grid">
                            <div className="bolla-stat"><div className="lbl">Fattura USD</div><div className="val">$ {fmtEur(b.calcolo.fobTotUsd)}</div></div>
                            <div className="bolla-stat"><div className="lbl">Valore Statistico</div><div className="val">€ {fmtEur(b.calcolo.valoreStatistico)}</div></div>
                            <div className="bolla-stat"><div className="lbl">Quantità</div><div className="val">{b.calcolo.qtyTot} pz</div></div>
                            <div className="bolla-stat total"><div className="lbl">Imposizioni</div><div className="val">€ {fmtEur(b.calcolo.totaleImposizioni)}</div></div>
                          </div>
                          <div style={{ fontSize: 11, color: '#546e7a', marginTop: 6 }}>
                            <b>Data import:</b> {new Date(b.data).toLocaleString('it-IT')} · 
                            <b> Articoli:</b> {b.items.length} · 
                            <b> Tasso:</b> {b.params.tassoEurUsd} · 
                            <b> Dazio:</b> {b.params.dazioPct}% · 
                            <b> IVA:</b> {b.params.ivaPct}%
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ===== MODALE IMPORT EUROPA ===== */}
      {importStep === 'preview' && (
        <div className="modal-ov" onClick={cancelImport}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">
              <span>▸ Nuova Importazione Europa — {fileName}</span>
              <button className="close-btn" onClick={cancelImport}>✕</button>
            </div>
            <div className="modal-body">
              <div className="notice">
                <AlertCircle size={14} />
                <div>Mappare le colonne del file Excel. Impostare PFU e trasporto che saranno ripartiti su ogni articolo.</div>
              </div>

              <div className="fieldset">
                <div className="fieldset-head"><Package size={12} /> Dati Fornitore</div>
                <div className="fieldset-body">
                  <div className="fld">
                    <label>Ragione sociale<span className="req">*</span></label>
                    <input className="ctl" value={supplierName} onChange={e => setSupplierName(e.target.value)} />
                  </div>
                  <div className="fld">
                    <label>Valuta</label>
                    <select className="ctl" value={mapping.currency} onChange={e => setMapping({ ...mapping, currency: e.target.value })}>
                      <option value="EUR">EUR — Euro</option>
                      <option value="USD">USD — Dollaro</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="fieldset">
                <div className="fieldset-head"><Settings size={12} /> Mappatura Colonne</div>
                <div className="fieldset-body">
                  <div className="fld"><label>Marca<span className="req">*</span></label>
                    <select className="ctl" value={mapping.marca} onChange={e => setMapping({ ...mapping, marca: e.target.value })}>
                      <option value="">-- Seleziona --</option>
                      {headers.map((h, i) => <option key={i} value={h}>{h}</option>)}
                    </select>
                  </div>
                  <div className="fld"><label>Modello</label>
                    <select className="ctl" value={mapping.modello} onChange={e => setMapping({ ...mapping, modello: e.target.value })}>
                      <option value="">-- Nessuna --</option>
                      {headers.map((h, i) => <option key={i} value={h}>{h}</option>)}
                    </select>
                  </div>
                  <div className="fld"><label>Misura</label>
                    <select className="ctl" value={mapping.misura} onChange={e => setMapping({ ...mapping, misura: e.target.value })}>
                      <option value="">-- Nessuna --</option>
                      {headers.map((h, i) => <option key={i} value={h}>{h}</option>)}
                    </select>
                  </div>
                  <div className="fld"><label>Prezzo<span className="req">*</span></label>
                    <select className="ctl" value={mapping.prezzo} onChange={e => setMapping({ ...mapping, prezzo: e.target.value })}>
                      <option value="">-- Seleziona --</option>
                      {headers.map((h, i) => <option key={i} value={h}>{h}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="fieldset">
                <div className="fieldset-head"><Truck size={12} /> Costi Aggiuntivi</div>
                <div className="fieldset-body">
                  <div className="fld"><label>PFU per pz (€)</label>
                    <input className="ctl" type="number" step="0.01" value={pfuValue} onChange={e => setPfuValue(e.target.value)} placeholder="0,00" />
                  </div>
                  <div className="fld"><label>Trasporto totale (€)</label>
                    <input className="ctl" type="number" step="0.01" value={trasportoValue} onChange={e => setTrasportoValue(e.target.value)} placeholder="0,00" />
                  </div>
                  <div className="fld"><label>Q.tà totale</label>
                    <input className="ctl" type="number" value={qtyValue} onChange={e => setQtyValue(e.target.value)} placeholder="0" />
                  </div>
                  <div className="fld"><label>Trasp./unità (calc.)</label>
                    <input className="ctl" readOnly value={(() => { const t = parseFloat(trasportoValue) || 0, q = parseFloat(qtyValue) || 0; return q > 0 ? (t / q).toFixed(2) + ' €' : '—'; })()} />
                  </div>
                </div>
              </div>

              <div className="fieldset" style={{ marginTop: 10 }}>
                <div className="fieldset-head"><Search size={12} /> Anteprima Dati</div>
                <div style={{ padding: 6 }}>
                  <div className="preview-box">
                    <table>
                      <thead>
                        <tr>
                          {headers.map((h, i) => {
                            const role = mapping.marca === h ? 'MARCA' : mapping.modello === h ? 'MODELLO' : mapping.misura === h ? 'MISURA' : mapping.prezzo === h ? 'PREZZO' : null;
                            return (<th key={i} className={role ? 'mapped' : ''}>{h}{role && <span className="role">→ {role}</span>}</th>);
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, ri) => (<tr key={ri}>{headers.map((_, ci) => <td key={ci}>{String(row[ci] ?? '')}</td>)}</tr>))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <span style={{ fontSize: 11, color: '#455a64' }}>Righe nel file: <b>{rawData.length - 1}</b></span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="tbtn" onClick={cancelImport}>Annulla</button>
                <button className="tbtn success" onClick={confirmImport}><Check size={12} /> Conferma e Importa</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== MODALE IMPORT CINA ===== */}
      {chinaStep !== 'upload' && chinaStep !== 'idle' && (
        <div className="modal-ov" onClick={cancelChinaImport}>
          <div className="modal wide" onClick={e => e.stopPropagation()}>
            <div className="modal-title china-modal">
              <span>▸ {bollaMode === 'selection' ? 'GENERA BOLLA DAU — DA SELEZIONE CATALOGO' : 'IMPORT LISTINO CINA → CATALOGO'} {chinaFileName && `— ${chinaFileName}`}</span>
              <button className="close-btn" onClick={cancelChinaImport}>✕</button>
            </div>
            <div className="modal-body">
              {bollaMode === 'file' ? (
                <div className="wizard-steps">
                  <div className={`wiz-step ${chinaStep === 'mapping' ? 'active' : 'done'}`}>
                    <span className="num">1</span>Mappatura Colonne + Import Catalogo
                  </div>
                </div>
              ) : (
                <div className="wizard-steps">
                  <div className={`wiz-step ${chinaStep === 'parameters' ? 'active' : (chinaStep === 'preview' ? 'done' : '')}`}>
                    <span className="num">1</span>Parametri Bolla + Costi Reali
                  </div>
                  <div className={`wiz-step ${chinaStep === 'preview' ? 'active' : ''}`}>
                    <span className="num">2</span>Anteprima DAU + PDF
                  </div>
                </div>
              )}

              {/* STEP 1 - Mappatura */}
              {chinaStep === 'mapping' && (
                <>
                  <div className="notice">
                    <AlertCircle size={14} />
                    <div><b>Import Listino Cina:</b> gli articoli vengono caricati nel Catalogo con un <b>prezzo EUR stimato</b> (FOB × cambio + dazio + IVA + PFU). Dal Catalogo selezionerai quali ordinare e quante quantità, poi userai <b>"Genera Bolla da Selezione"</b> per la bolla doganale reale.</div>
                  </div>

                  <div className="fieldset">
                    <div className="fieldset-head china-fs"><Package size={12} /> Dati Fornitore + Parametri Stima</div>
                    <div className="fieldset-body cols-4">
                      <div className="fld"><label>Fornitore<span className="req">*</span></label>
                        <input className="ctl" value={chinaParams.fornitore} onChange={e => setP('fornitore', e.target.value)} placeholder="Es. ARIVO TYRE GROUP" />
                      </div>
                      <div className="fld"><label>Cambio EUR/USD</label>
                        <input className="ctl" type="number" step="0.0001" value={chinaParams.tassoEurUsd} onChange={e => setP('tassoEurUsd', parseFloat(e.target.value) || 1)} />
                      </div>
                      <div className="fld"><label>Dazio stima %</label>
                        <input className="ctl" type="number" step="0.01" value={chinaParams.dazioPct} onChange={e => setP('dazioPct', parseFloat(e.target.value) || 0)} />
                      </div>
                      <div className="fld"><label>IVA stima %</label>
                        <input className="ctl" type="number" step="0.01" value={chinaParams.ivaPct} onChange={e => setP('ivaPct', parseFloat(e.target.value) || 0)} />
                      </div>
                    </div>
                  </div>

                  <div className="fieldset">
                    <div className="fieldset-head china-fs"><Settings size={12} /> Mappatura Colonne File Articoli</div>
                    <div className="fieldset-body cols-4">
                      <div className="fld"><label>Marca / Brand</label>
                        <select className="ctl" value={chinaMapping.marca} onChange={e => setChinaMapping({ ...chinaMapping, marca: e.target.value })}>
                          <option value="">-- Usa nome fornitore --</option>
                          {chinaHeaders.map((h, i) => <option key={i} value={h}>{h}</option>)}
                        </select>
                      </div>
                      <div className="fld"><label>Modello</label>
                        <select className="ctl" value={chinaMapping.modello} onChange={e => setChinaMapping({ ...chinaMapping, modello: e.target.value })}>
                          <option value="">-- Nessuna --</option>
                          {chinaHeaders.map((h, i) => <option key={i} value={h}>{h}</option>)}
                        </select>
                      </div>
                      <div className="fld"><label>Misura</label>
                        <select className="ctl" value={chinaMapping.misura} onChange={e => setChinaMapping({ ...chinaMapping, misura: e.target.value })}>
                          <option value="">-- Nessuna --</option>
                          {chinaHeaders.map((h, i) => <option key={i} value={h}>{h}</option>)}
                        </select>
                      </div>
                      <div className="fld"><label>Q.tà disp.</label>
                        <select className="ctl" value={chinaMapping.qty} onChange={e => setChinaMapping({ ...chinaMapping, qty: e.target.value })}>
                          <option value="">-- Nessuna (usa 1) --</option>
                          {chinaHeaders.map((h, i) => <option key={i} value={h}>{h}</option>)}
                        </select>
                      </div>
                      <div className="fld"><label>Prezzo USD<span className="req">*</span></label>
                        <select className="ctl" value={chinaMapping.prezzo} onChange={e => setChinaMapping({ ...chinaMapping, prezzo: e.target.value })}>
                          <option value="">-- Seleziona --</option>
                          {chinaHeaders.map((h, i) => <option key={i} value={h}>{h}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="fieldset">
                    <div className="fieldset-head"><Search size={12} /> Anteprima Dati File</div>
                    <div style={{ padding: 6 }}>
                      <div className="preview-box">
                        <table>
                          <thead>
                            <tr>
                              {chinaHeaders.map((h, i) => {
                                const role = chinaMapping.marca === h ? 'MARCA' : chinaMapping.modello === h ? 'MODELLO' : chinaMapping.misura === h ? 'MISURA' : chinaMapping.prezzo === h ? 'PREZZO USD' : chinaMapping.qty === h ? 'QTY' : null;
                                return (<th key={i} className={role ? 'mapped' : ''}>{h}{role && <span className="role">→ {role}</span>}</th>);
                              })}
                            </tr>
                          </thead>
                          <tbody>
                            {chinaPreviewRows.map((row, ri) => (<tr key={ri}>{chinaHeaders.map((_, ci) => <td key={ci}>{String(row[ci] ?? '')}</td>)}</tr>))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* STEP 2 - Parametri Bolla */}
              {chinaStep === 'parameters' && (
                <>
                  <div className="notice" style={{ background: '#e3f2fd', borderColor: '#1976d2', color: '#0d47a1' }}>
                    <AlertCircle size={14} style={{ color: '#1976d2' }} />
                    <div><b>Bolla Doganale DAU</b> — Compila i parametri reali di questa spedizione. Usa i preset Savino Del Bene qui sotto per caricare automaticamente nolo + costi sbarco + trasporto interno.</div>
                  </div>

                  <div className="fieldset" style={{ borderColor: '#1976d2' }}>
                    <div className="fieldset-head" style={{ background: 'linear-gradient(to bottom,#e3f2fd,#bbdefb)', color: '#0d47a1' }}>
                      <Truck size={12} /> Preset Nolo Savino Del Bene (val. 01/05 → 14/05)
                    </div>
                    <div style={{ padding: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: '#37474f' }}>Rotta / Container:</label>
                      <select className="ctl" style={{ width: 240 }} value={noloPreset} onChange={e => applicaNoloPreset(e.target.value)}>
                        {Object.entries(NOLO_PRESETS).map(([k, v]) => (
                          <option key={k} value={k}>{v.label} — USD {v.noloMare}</option>
                        ))}
                      </select>
                      <button className="tbtn primary" onClick={() => applicaNoloPreset(noloPreset)} style={{ fontSize: 11 }}>
                        <Download size={11} /> Ricarica Preset Nolo
                      </button>
                      <button className="tbtn success" onClick={applicaCostiSdb} style={{ fontSize: 11 }}>
                        <Check size={11} /> Applica Costi SDB (THC, Dogana, Trasporto)
                      </button>
                      <span style={{ fontSize: 10, color: '#78909c', marginLeft: 'auto' }}>
                        THC €{COSTI_SDB.thcSbarco} · Add. €{COSTI_SDB.addizionaliCompMar} · Del.Order €{COSTI_SDB.deliveryOrder} · Dog. €{COSTI_SDB.doganaImport} · Trasp. €{COSTI_SDB.trasportoInterno} +{COSTI_SDB.fuelTrasportoPct}%
                      </span>
                    </div>
                  </div>

                  <div className="fieldset">
                    <div className="fieldset-head china-fs"><Ship size={12} /> Dati Spedizione</div>
                    <div className="fieldset-body cols-4">
                      <div className="fld"><label>Fornitore<span className="req">*</span></label>
                        <input className="ctl" value={chinaParams.fornitore} onChange={e => setP('fornitore', e.target.value)} />
                      </div>
                      <div className="fld"><label>Indirizzo Fornitore</label>
                        <input className="ctl" value={chinaParams.indirizzoFornitore} onChange={e => setP('indirizzoFornitore', e.target.value)} />
                      </div>
                      <div className="fld"><label>Fattura n°</label>
                        <input className="ctl" value={chinaParams.fattura} onChange={e => setP('fattura', e.target.value)} />
                      </div>
                      <div className="fld"><label>Nr. Riferimento (7)</label>
                        <input className="ctl" value={chinaParams.nrRiferimento} onChange={e => setP('nrRiferimento', e.target.value)} placeholder="1/161/1/SDB/461007465" />
                      </div>
                      <div className="fld"><label>Codice TARIC</label>
                        <input className="ctl" value={chinaParams.codiceTaric} onChange={e => setP('codiceTaric', e.target.value)} />
                      </div>
                      <div className="fld"><label>Incoterm</label>
                        <input className="ctl" value={chinaParams.incoterm} onChange={e => setP('incoterm', e.target.value)} />
                      </div>
                      <div className="fld"><label>Porto Imbarco</label>
                        <input className="ctl" value={chinaParams.portoImbarco} onChange={e => setP('portoImbarco', e.target.value)} placeholder="QINGDAO" />
                      </div>
                      <div className="fld"><label>Porto Sbarco</label>
                        <input className="ctl" value={chinaParams.portoSbarco} onChange={e => setP('portoSbarco', e.target.value)} placeholder="AUGUSTA" />
                      </div>
                      <div className="fld"><label>Nave</label>
                        <input className="ctl" value={chinaParams.nave} onChange={e => setP('nave', e.target.value)} />
                      </div>
                      <div className="fld"><label>Container</label>
                        <input className="ctl" value={chinaParams.container} onChange={e => setP('container', e.target.value)} placeholder="CXDU1036272" />
                      </div>
                      <div className="fld"><label>Data Spedizione</label>
                        <input className="ctl" type="date" value={chinaParams.dataSpedizione} onChange={e => setP('dataSpedizione', e.target.value)} />
                      </div>
                      <div className="fld"><label>Regime (37)</label>
                        <input className="ctl" value={chinaParams.regime} onChange={e => setP('regime', e.target.value)} />
                      </div>
                      <div className="fld"><label>Massa Lorda (kg)</label>
                        <input className="ctl" type="number" step="0.01" value={chinaParams.massaLorda} onChange={e => setP('massaLorda', parseFloat(e.target.value) || 0)} />
                      </div>
                      <div className="fld"><label>Massa Netta (kg)</label>
                        <input className="ctl" type="number" step="0.01" value={chinaParams.massaNetta} onChange={e => setP('massaNetta', parseFloat(e.target.value) || 0)} />
                      </div>
                      <div className="fld"><label>Doc. Precedente (40)</label>
                        <input className="ctl" value={chinaParams.docPrecedente} onChange={e => setP('docPrecedente', e.target.value)} placeholder="26ITQUH33" />
                      </div>
                      <div className="fld"><label>Dilazione Pag. (48)</label>
                        <input className="ctl" value={chinaParams.dilazionePagamento} onChange={e => setP('dilazionePagamento', e.target.value)} />
                      </div>
                    </div>
                  </div>

                  <div className="fieldset">
                    <div className="fieldset-head china-fs"><Package size={12} /> Dati Importatore e Dichiarante</div>
                    <div className="fieldset-body cols-4">
                      <div className="fld"><label>Importatore</label>
                        <input className="ctl" value={chinaParams.importatore} onChange={e => setP('importatore', e.target.value)} />
                      </div>
                      <div className="fld"><label>P.IVA Importatore</label>
                        <input className="ctl" value={chinaParams.importatorePiva} onChange={e => setP('importatorePiva', e.target.value)} />
                      </div>
                      <div className="fld"><label>Attività Importatore</label>
                        <input className="ctl" value={chinaParams.importatoreAttivita} onChange={e => setP('importatoreAttivita', e.target.value)} />
                      </div>
                      <div className="fld"><label>Indirizzo Importatore</label>
                        <input className="ctl" value={chinaParams.importatoreIndirizzo} onChange={e => setP('importatoreIndirizzo', e.target.value)} />
                      </div>
                      <div className="fld"><label>Dichiarante</label>
                        <input className="ctl" value={chinaParams.dichiarante} onChange={e => setP('dichiarante', e.target.value)} />
                      </div>
                      <div className="fld"><label>CF Dichiarante</label>
                        <input className="ctl" value={chinaParams.dichiaranteCf} onChange={e => setP('dichiaranteCf', e.target.value)} />
                      </div>
                      <div className="fld"><label>Indirizzo Dichiarante</label>
                        <input className="ctl" value={chinaParams.dichiaranteIndirizzo} onChange={e => setP('dichiaranteIndirizzo', e.target.value)} />
                      </div>
                      <div className="fld"><label>Spedizioniere</label>
                        <input className="ctl" value={chinaParams.spedizioniere} onChange={e => setP('spedizioniere', e.target.value)} />
                      </div>
                    </div>
                    <div style={{ padding: '0 10px 10px' }}>
                      <label style={{ fontSize: 10, color: '#546e7a', fontWeight: 600, textTransform: 'uppercase' }}>Menzioni speciali / Documenti (44)</label>
                      <textarea className="ctl" style={{ width: '100%', minHeight: 60, fontFamily: 'Consolas, monospace', fontSize: 10, padding: 6, resize: 'vertical' }} value={chinaParams.menzioniSpeciali} onChange={e => setP('menzioniSpeciali', e.target.value)} placeholder="Un documento per riga (es. Y923 - CN)" />
                    </div>
                  </div>

                  <div className="fieldset">
                    <div className="fieldset-head china-fs"><Calculator size={12} /> Cambio e Quantità</div>
                    <div className="fieldset-body cols-4">
                      <div className="fld"><label>Tasso EUR/USD<span className="req">*</span></label>
                        <input className="ctl" type="number" step="0.0001" value={chinaParams.tassoEurUsd} onChange={e => setP('tassoEurUsd', parseFloat(e.target.value) || 1)} />
                      </div>
                      <div className="fld"><label>Tasso USD/EUR (calc.)</label>
                        <input className="ctl calc" readOnly value={(1 / chinaParams.tassoEurUsd).toFixed(6)} />
                      </div>
                      <div className="fld"><label>Q.tà totale pz</label>
                        <input className="ctl calc" readOnly value={chinaParams.qtyTotale} />
                      </div>
                      <div className="fld"><label>Valore FOB USD (calc.)</label>
                        <input className="ctl calc" readOnly value={chinaCalcolo ? '$ ' + fmtEur(chinaCalcolo.fobTotUsd) : '—'} />
                      </div>
                    </div>
                  </div>

                  <div className="fieldset">
                    <div className="fieldset-head china-fs"><Anchor size={12} /> Nolo Marittimo (USD)</div>
                    <div className="fieldset-body cols-4">
                      <div className="fld"><label>Nolo Mare</label><input className="ctl" type="number" step="0.01" value={chinaParams.noloMare} onChange={e => setP('noloMare', parseFloat(e.target.value) || 0)} /></div>
                      <div className="fld"><label>ECA Surcharge</label><input className="ctl" type="number" step="0.01" value={chinaParams.ecaSurcharge} onChange={e => setP('ecaSurcharge', parseFloat(e.target.value) || 0)} /></div>
                      <div className="fld"><label>ICS2</label><input className="ctl" type="number" step="0.01" value={chinaParams.ics2Usd} onChange={e => setP('ics2Usd', parseFloat(e.target.value) || 0)} /></div>
                      <div className="fld"><label>Local Charge Orig.</label><input className="ctl" type="number" step="0.01" value={chinaParams.localChargeUsd} onChange={e => setP('localChargeUsd', parseFloat(e.target.value) || 0)} /></div>
                    </div>
                  </div>

                  <div className="fieldset">
                    <div className="fieldset-head china-fs"><Truck size={12} /> Extra Nolo EUR (art.74 non imp. IVA)</div>
                    <div className="fieldset-body cols-4">
                      <div className="fld"><label>THC Sbarco</label><input className="ctl" type="number" step="0.01" value={chinaParams.costiSbarco} onChange={e => setP('costiSbarco', parseFloat(e.target.value) || 0)} /></div>
                      <div className="fld"><label>Addiz. Comp. Marittima</label><input className="ctl" type="number" step="0.01" value={chinaParams.addizionaliCompMar} onChange={e => setP('addizionaliCompMar', parseFloat(e.target.value) || 0)} /></div>
                      <div className="fld"><label>Dogana Import</label><input className="ctl" type="number" step="0.01" value={chinaParams.doganaImport} onChange={e => setP('doganaImport', parseFloat(e.target.value) || 0)} /></div>
                      <div className="fld"><label>Fuel Surcharge (EUR)</label><input className="ctl" type="number" step="0.01" value={chinaParams.fuelSurcharge} onChange={e => setP('fuelSurcharge', parseFloat(e.target.value) || 0)} /></div>
                      <div className="fld"><label>ECA EUR</label><input className="ctl" type="number" step="0.01" value={chinaParams.ecaEur} onChange={e => setP('ecaEur', parseFloat(e.target.value) || 0)} /></div>
                      <div className="fld"><label>ICS2 EUR</label><input className="ctl" type="number" step="0.01" value={chinaParams.ics2Eur} onChange={e => setP('ics2Eur', parseFloat(e.target.value) || 0)} /></div>
                      <div className="fld"><label>Local Charge EUR</label><input className="ctl" type="number" step="0.01" value={chinaParams.localChargeEur} onChange={e => setP('localChargeEur', parseFloat(e.target.value) || 0)} /></div>
                    </div>
                  </div>

                  <div className="fieldset">
                    <div className="fieldset-head china-fs"><FileText size={12} /> Servizi con IVA 22% e Voci Fisse</div>
                    <div className="fieldset-body cols-4">
                      <div className="fld"><label>Delivery Order</label><input className="ctl" type="number" step="0.01" value={chinaParams.deliveryOrder} onChange={e => setP('deliveryOrder', parseFloat(e.target.value) || 0)} /></div>
                      <div className="fld"><label>Trasporto Interno</label><input className="ctl" type="number" step="0.01" value={chinaParams.trasportoInterno} onChange={e => setP('trasportoInterno', parseFloat(e.target.value) || 0)} /></div>
                      <div className="fld"><label>Fuel Trasporto %</label><input className="ctl" type="number" step="0.1" value={chinaParams.fuelTrasportoPct} onChange={e => setP('fuelTrasportoPct', parseFloat(e.target.value) || 0)} /></div>
                      <div className="fld"><label>Fuel Trasporto €</label><input className="ctl calc" readOnly value={'€ ' + fmtEur((chinaParams.trasportoInterno || 0) * (chinaParams.fuelTrasportoPct || 0) / 100)} /></div>
                      <div className="fld"><label>IVA Spedizioniere</label><input className="ctl" type="number" step="0.01" value={chinaParams.ivaSpedizioniere} onChange={e => setP('ivaSpedizioniere', parseFloat(e.target.value) || 0)} /></div>
                      <div className="fld"><label>Commissioni</label><input className="ctl" type="number" step="0.01" value={chinaParams.commissioni} onChange={e => setP('commissioni', parseFloat(e.target.value) || 0)} /></div>
                      <div className="fld"><label>Aggiustamento (v.45) €</label><input className="ctl" type="number" step="0.01" value={chinaParams.aggiustamento} onChange={e => setP('aggiustamento', parseFloat(e.target.value) || 0)} /></div>
                      <div className="fld"><label>Unità 9AJ (pz)</label><input className="ctl" type="number" step="1" value={chinaParams.unita9AJ} onChange={e => setP('unita9AJ', parseInt(e.target.value) || 0)} /></div>
                      <div className="fld"><label>9AJ Totale €</label><input className="ctl calc" readOnly value={'€ ' + fmtEur((chinaParams.unita9AJ || 0) * 1.0908)} /></div>
                      <div className="fld"><label>9AJ Manuale (override)</label><input className="ctl" type="number" step="0.01" value={chinaParams.dirittoDoganale9AJ} onChange={e => setP('dirittoDoganale9AJ', parseFloat(e.target.value) || 0)} /></div>
                    </div>
                  </div>

                  <div className="fieldset">
                    <div className="fieldset-head china-fs"><Calculator size={12} /> Aliquote Fiscali e Markup</div>
                    <div className="fieldset-body cols-4">
                      <div className="fld"><label>Dazio A00 (%)</label><input className="ctl" type="number" step="0.01" value={chinaParams.dazioPct} onChange={e => setP('dazioPct', parseFloat(e.target.value) || 0)} /></div>
                      <div className="fld"><label>IVA B00 (%)</label><input className="ctl" type="number" step="0.01" value={chinaParams.ivaPct} onChange={e => setP('ivaPct', parseFloat(e.target.value) || 0)} /></div>
                      <div className="fld"><label>Antidumping (%)</label><input className="ctl" type="number" step="0.01" value={chinaParams.antidumpingPct} onChange={e => setP('antidumpingPct', parseFloat(e.target.value) || 0)} /></div>
                      <div className="fld"><label>Markup vendita</label><input className="ctl" type="number" step="0.01" value={chinaParams.markup} onChange={e => setP('markup', parseFloat(e.target.value) || 1)} /></div>
                    </div>
                  </div>

                  <div className="fieldset">
                    <div className="fieldset-head china-fs"><Package size={12} /> PFU per Fascia Peso (€/pz)</div>
                    <div className="fieldset-body cols-4">
                      <div className="fld"><label>Fino 7kg (13-14")</label><input className="ctl" type="number" step="0.01" value={chinaParams.pfuFino7} onChange={e => setP('pfuFino7', parseFloat(e.target.value) || 0)} /></div>
                      <div className="fld"><label>7-15kg (15-17")</label><input className="ctl" type="number" step="0.01" value={chinaParams.pfu7_15} onChange={e => setP('pfu7_15', parseFloat(e.target.value) || 0)} /></div>
                      <div className="fld"><label>15-30kg (SUV)</label><input className="ctl" type="number" step="0.01" value={chinaParams.pfu15_30} onChange={e => setP('pfu15_30', parseFloat(e.target.value) || 0)} /></div>
                      <div className="fld"><label>30-60kg</label><input className="ctl" type="number" step="0.01" value={chinaParams.pfu30_60} onChange={e => setP('pfu30_60', parseFloat(e.target.value) || 0)} /></div>
                      <div className="fld"><label>Oltre 60kg</label><input className="ctl" type="number" step="0.01" value={chinaParams.pfuOltre60} onChange={e => setP('pfuOltre60', parseFloat(e.target.value) || 0)} /></div>
                    </div>
                  </div>

                  {chinaCalcolo && (
                    <div className="kpi-row-china">
                      <div className="kpi-box"><div className="lbl">FOB Totale</div><div className="val">€ {fmtEur(chinaCalcolo.fobTotEur)}</div></div>
                      <div className="kpi-box"><div className="lbl">Valore Statistico</div><div className="val">€ {fmtEur(chinaCalcolo.valoreStatistico)}</div></div>
                      <div className="kpi-box accent"><div className="lbl">Dazio A00</div><div className="val">€ {fmtEur(chinaCalcolo.dazioTotale)}</div></div>
                      <div className="kpi-box accent"><div className="lbl">IVA B00</div><div className="val">€ {fmtEur(chinaCalcolo.ivaTotale)}</div></div>
                      <div className="kpi-box success"><div className="lbl">Tot. Imposizioni</div><div className="val">€ {fmtEur(chinaCalcolo.totaleImposizioni)}</div></div>
                    </div>
                  )}
                </>
              )}

              {/* STEP 3 - Preview */}
              {chinaStep === 'preview' && chinaCalcolo && (
                <>
                  <div className="notice">
                    <AlertCircle size={14} />
                    <div>Questa è l'anteprima della <b>Bolla Doganale (DAU)</b>. Verifica i valori. Una volta confermata, gli articoli verranno caricati nel Catalogo con il costo finale calcolato, e potrai generare il PDF dall'archivio Bolle Doganali.</div>
                  </div>

                  <div className="bolla-preview">
                    <div className="bolla-header">
                      DATI TRASMESSI ALLA DOGANA IN H1 — DOGANA DI AUGUSTA / SOT AUGUSTA<br/>
                      {chinaParams.fornitore} — {chinaParams.fattura || 'Fattura n/a'}
                    </div>

                    <div className="bolla-grid-big">
                      <div className="fieldset" style={{ margin: 0 }}>
                        <div className="fieldset-head">Dati Generali</div>
                        <div style={{ padding: 8, fontSize: 11 }}>
                          <div className="sup-row-item"><span className="lbl">Speditore</span><span className="val">{chinaParams.fornitore}</span></div>
                          <div className="sup-row-item"><span className="lbl">Importatore</span><span className="val">{chinaParams.importatore}</span></div>
                          <div className="sup-row-item"><span className="lbl">Paese origine</span><span className="val">CINA</span></div>
                          <div className="sup-row-item"><span className="lbl">Incoterm</span><span className="val">{chinaParams.incoterm}</span></div>
                          <div className="sup-row-item"><span className="lbl">Container</span><span className="val">{chinaParams.container || '—'}</span></div>
                          <div className="sup-row-item"><span className="lbl">Cambio</span><span className="val">{chinaParams.tassoEurUsd.toFixed(4)} EUR/USD</span></div>
                          <div className="sup-row-item"><span className="lbl">Tot. colli</span><span className="val">{chinaCalcolo.qtyTot}</span></div>
                          <div className="sup-row-item"><span className="lbl">Cod. TARIC</span><span className="val">{chinaParams.codiceTaric}</span></div>
                        </div>
                      </div>
                      <div className="fieldset" style={{ margin: 0 }}>
                        <div className="fieldset-head">Valori Base</div>
                        <div style={{ padding: 8, fontSize: 11 }}>
                          <div className="sup-row-item"><span className="lbl">FOB USD</span><span className="val">$ {fmtEur(chinaCalcolo.fobTotUsd)}</span></div>
                          <div className="sup-row-item"><span className="lbl">FOB EUR</span><span className="val">€ {fmtEur(chinaCalcolo.fobTotEur)}</span></div>
                          <div className="sup-row-item"><span className="lbl">Nolo totale EUR</span><span className="val">€ {fmtEur(chinaCalcolo.noloTotEur)}</span></div>
                          <div className="sup-row-item"><span className="lbl">Nolo per pezzo</span><span className="val">€ {fmtEur(chinaCalcolo.noloPerPezzo)}</span></div>
                          <div className="sup-row-item"><span className="lbl">Extra nolo art.74</span><span className="val">€ {fmtEur(chinaCalcolo.extraNoloTot)}</span></div>
                          <div className="sup-row-item"><span className="lbl">Servizi IVA 22%</span><span className="val">€ {fmtEur(chinaCalcolo.serviziIvaTot)}</span></div>
                          <div className="sup-row-item"><span className="lbl" style={{ color: '#b71c1c', fontWeight: 700 }}>Valore Statistico</span><span className="val" style={{ color: '#b71c1c', fontWeight: 700 }}>€ {fmtEur(chinaCalcolo.valoreStatistico)}</span></div>
                        </div>
                      </div>
                    </div>

                    <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 12 }}>47 — CALCOLO DELLE IMPOSIZIONI</div>
                    <table className="bolla-tab">
                      <thead>
                        <tr><th>Tipo</th><th>Descrizione</th><th style={{textAlign:'right'}}>Base Imp. €</th><th style={{textAlign:'right'}}>Aliquota %</th><th style={{textAlign:'right'}}>Importo €</th></tr>
                      </thead>
                      <tbody>
                        <tr><td><b>A00</b></td><td>Dazio Doganale</td><td className="num">{fmtEur(chinaCalcolo.valoreStatistico)}</td><td className="num">{chinaParams.dazioPct.toFixed(4)}</td><td className="num"><b>{fmtEur(chinaCalcolo.dazioTotale)}</b></td></tr>
                        {chinaParams.antidumpingPct > 0 && <tr><td><b>A30</b></td><td>Antidumping</td><td className="num">{fmtEur(chinaCalcolo.valoreStatistico)}</td><td className="num">{chinaParams.antidumpingPct.toFixed(4)}</td><td className="num"><b>{fmtEur(chinaCalcolo.antidumpingTotale)}</b></td></tr>}
                        <tr><td><b>9AJ</b></td><td>Diritto Doganale Marittimo ({chinaParams.unita9AJ || 4} × 1,0908 €)</td><td className="num">{fmtEur(chinaParams.unita9AJ || 4)}</td><td className="num">1,0908</td><td className="num"><b>{fmtEur(chinaCalcolo.dirittoTotale9AJ)}</b></td></tr>
                        <tr><td><b>B00</b></td><td>IVA Importazione</td><td className="num">{fmtEur(chinaCalcolo.valoreStatistico + chinaCalcolo.dazioTotale + chinaCalcolo.antidumpingTotale + chinaCalcolo.dirittoTotale9AJ)}</td><td className="num">{chinaParams.ivaPct.toFixed(4)}</td><td className="num"><b>{fmtEur(chinaCalcolo.ivaTotale)}</b></td></tr>
                        <tr className="tot-row"><td colSpan="4"><b>TOTALE IMPOSIZIONI BOLLA</b></td><td className="num"><b>€ {fmtEur(chinaCalcolo.totaleImposizioni)}</b></td></tr>
                      </tbody>
                    </table>

                    <div style={{ fontWeight: 700, marginTop: 12, marginBottom: 4, fontSize: 12 }}>DETTAGLIO ARTICOLI — COSTO FINALE PER PNEUMATICO</div>
                    <div className="preview-box" style={{ maxHeight: 300 }}>
                      <table>
                        <thead>
                          <tr>
                            <th>#</th><th>Modello</th><th>Misura</th><th className="num">Qty</th>
                            <th className="num">USD/pz</th><th className="num">CIF €</th>
                            <th className="num">Dazio</th><th className="num">IVA</th><th className="num">PFU</th>
                            <th className="num" style={{ background: '#0d47a1', color: '#fff' }}>Costo Fin.</th>
                            <th className="num" style={{ background: '#2e7d32', color: '#fff' }}>P. Vendita</th>
                          </tr>
                        </thead>
                        <tbody>
                          {chinaCalcolo.righe.map((r, i) => (
                            <tr key={i}>
                              <td>{i + 1}</td>
                              <td>{r.modello || '—'}</td>
                              <td>{r.misura || '—'}</td>
                              <td className="num">{r.qty}</td>
                              <td className="num">{fmtEur(r.prezzoUsd)}</td>
                              <td className="num">{fmtEur(r.cifPerPezzo)}</td>
                              <td className="num">{fmtEur(r.dazioPerPezzo)}</td>
                              <td className="num">{fmtEur(r.ivaPerPezzo)}</td>
                              <td className="num">{fmtEur(r.pfuPezzo)}</td>
                              <td className="num" style={{ background: '#e3f2fd', fontWeight: 700 }}>€ {fmtEur(r.costoFinale)}</td>
                              <td className="num" style={{ background: '#e8f5e9', fontWeight: 700, color: '#1b5e20' }}>€ {fmtEur(r.prezzoVendita)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div style={{ marginTop: 10, background: '#e8eaf6', border: '1px solid #7986cb', padding: 10, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontSize: 12 }}>
                      <div><span style={{ color: '#546e7a' }}>Costo totale import:</span><br/><b style={{ fontSize: 15, color: '#0d47a1' }}>€ {fmtEur(chinaCalcolo.costoTotaleImport)}</b></div>
                      <div><span style={{ color: '#546e7a' }}>Costo medio/pz:</span><br/><b style={{ fontSize: 15, color: '#0d47a1' }}>€ {fmtEur(chinaCalcolo.costoTotaleImport / chinaCalcolo.qtyTot)}</b></div>
                      <div><span style={{ color: '#546e7a' }}>Ricarico vendita:</span><br/><b style={{ fontSize: 15, color: '#2e7d32' }}>× {chinaParams.markup}</b></div>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="modal-foot">
              <span style={{ fontSize: 11, color: '#455a64' }}>
                {chinaStep === 'mapping' && `Righe file: ${chinaRawData.length - 1} · Modalità: Import Listino`}
                {chinaStep === 'parameters' && chinaCalcolo && `Articoli: ${chinaItems.length} · Pezzi: ${chinaCalcolo.qtyTot} · Modalità: Bolla Doganale`}
                {chinaStep === 'preview' && chinaCalcolo && `Pronto alla generazione bolla`}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="tbtn" onClick={cancelChinaImport}>Annulla</button>
                {chinaStep === 'mapping' && (
                  <button className="tbtn success" onClick={confirmChinaMapping}>
                    <Check size={12} /> Importa Listino nel Catalogo
                  </button>
                )}
                {chinaStep === 'parameters' && <>
                  <button className="tbtn primary" onClick={() => setChinaStep('preview')} disabled={!chinaCalcolo}>Anteprima DAU ▸</button>
                </>}
                {chinaStep === 'preview' && <>
                  <button className="tbtn" onClick={() => setChinaStep('parameters')}>◂ Indietro</button>
                  <button className="tbtn" onClick={() => {
                    if (!chinaCalcolo) return;
                    const fakeBolla = { id: 'preview_' + Date.now(), supplierId: 'preview', data: new Date().toISOString(), params: { ...chinaParams }, calcolo: chinaCalcolo, items: [] };
                    generaPdfBolla(fakeBolla, 'ufficiale');
                  }}><Printer size={12} /> Anteprima PDF DAU</button>
                  <button className="tbtn" onClick={() => {
                    if (!chinaCalcolo) return;
                    const fakeBolla = { id: 'preview_' + Date.now(), supplierId: 'preview', data: new Date().toISOString(), params: { ...chinaParams }, calcolo: chinaCalcolo, items: [] };
                    generaPdfBolla(fakeBolla, 'semplificato');
                  }}><FileText size={12} /> Anteprima Riepilogo</button>
                  {bollaMode === 'selection' && (
                    <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px', color: '#0d47a1', background: '#e3f2fd', border: '1px solid #90caf9', borderRadius: 2, height: 26 }}>
                      <input type="checkbox" checked={updateCatalogOnConfirm} onChange={e => setUpdateCatalogOnConfirm(e.target.checked)} />
                      Aggiorna prezzi Catalogo
                    </label>
                  )}
                  <button className="tbtn success" onClick={confirmChinaImport}><Check size={12} /> Conferma e Salva Bolla</button>
                </>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== SIMULATORE WHAT-IF ===== */}
      {simulatorOpen && simScomposizioneBaseline && simScomposizioneSimulata && (
        <div className="sim-overlay" onClick={closeSimulator}>
          <div className="sim-modal" onClick={e => e.stopPropagation()}>
            {/* HEADER */}
            <div className="sim-header">
              <div>
                <div className="sim-title-row">
                  <Search size={16} style={{ color: '#1976d2' }} />
                  <span className="sim-title">SIMULATORE WHAT-IF — Scomposizione Prezzo</span>
                  {simulatorTarget.type === 'item' && (
                    <span className="sim-subtitle">
                      {simulatorTarget.data.marca} {simulatorTarget.data.modello && '· ' + simulatorTarget.data.modello} {simulatorTarget.data.misura && '· ' + simulatorTarget.data.misura}
                      <span className={`tag-origine ${simulatorTarget.data.origine}`} style={{ marginLeft: 8 }}>{simulatorTarget.data.origine}</span>
                    </span>
                  )}
                  {simulatorTarget.type === 'bolla' && (
                    <span className="sim-subtitle">Bolla Doganale · {simulatorTarget.data.params.fornitore} · {simulatorTarget.data.calcolo.qtyTot} pz</span>
                  )}
                </div>
                <div className="sim-hero">
                  <div className="sim-hero-col">
                    <span className="sim-hero-lbl">Costo BASELINE</span>
                    <span className="sim-hero-val baseline">€ {fmtEur(simScomposizioneBaseline.costoFinale)}</span>
                    <span className="sim-hero-sub">× {simulatorTarget.simItem.qty} pz = € {fmtEur(simScomposizioneBaseline.costoFinale * simulatorTarget.simItem.qty)}</span>
                  </div>
                  <div className="sim-hero-arrow">→</div>
                  <div className="sim-hero-col">
                    <span className="sim-hero-lbl">Costo SIMULATO</span>
                    <span className={`sim-hero-val ${simScomposizioneSimulata.costoFinale < simScomposizioneBaseline.costoFinale ? 'better' : simScomposizioneSimulata.costoFinale > simScomposizioneBaseline.costoFinale ? 'worse' : 'same'}`}>
                      € {fmtEur(simScomposizioneSimulata.costoFinale)}
                    </span>
                    <span className="sim-hero-sub">× {simulatorTarget.simItem.qty} pz = € {fmtEur(simScomposizioneSimulata.costoFinale * simulatorTarget.simItem.qty)}</span>
                  </div>
                  <div className="sim-hero-col">
                    <span className="sim-hero-lbl">DIFFERENZA</span>
                    {(() => {
                      const diff = simScomposizioneSimulata.costoFinale - simScomposizioneBaseline.costoFinale;
                      const pct = simScomposizioneBaseline.costoFinale > 0 ? (diff / simScomposizioneBaseline.costoFinale * 100) : 0;
                      const cls = diff < -0.001 ? 'better' : diff > 0.001 ? 'worse' : 'same';
                      return (
                        <>
                          <span className={`sim-hero-val ${cls}`}>{diff >= 0 ? '+' : ''}€ {fmtEur(Math.abs(diff))}</span>
                          <span className={`sim-hero-sub ${cls}`}>{diff >= 0 ? '+' : '-'}{Math.abs(pct).toFixed(2)}%</span>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
              <button className="sim-close" onClick={closeSimulator}>✕</button>
            </div>

            {/* BODY: 2 colonne */}
            <div className="sim-body">
              {/* COLONNA SX: Parametri */}
              <div className="sim-left">
                <div className="sim-section-title">⚙️ PARAMETRI MODIFICABILI</div>

                <SimInputGroup title="Cambio & Quantità">
                  <SimInput label="Tasso EUR/USD" value={simParams.tassoEurUsd} baseline={simBaseline.tassoEurUsd} step={0.0001} onChange={v => setSimParams(p => ({ ...p, tassoEurUsd: v }))} unit="" hint="Cambio doganale USD→EUR" />
                  <SimInput label="Qtà totale bolla" value={simParams.qtyTotale} baseline={simBaseline.qtyTotale} step={1} onChange={v => setSimParams(p => ({ ...p, qtyTotale: v }))} unit="pz" hint="Ripartisce costi fissi" />
                </SimInputGroup>

                <SimInputGroup title="Nolo Marittimo (USD)">
                  <SimInput label="Nolo mare USD" value={simParams.noloMare} baseline={simBaseline.noloMare} step={10} onChange={v => setSimParams(p => ({ ...p, noloMare: v }))} unit="$" />
                  <SimInput label="ECA Surcharge USD" value={simParams.ecaSurcharge} baseline={simBaseline.ecaSurcharge} step={1} onChange={v => setSimParams(p => ({ ...p, ecaSurcharge: v }))} unit="$" />
                  <SimInput label="ICS2 USD" value={simParams.ics2Usd} baseline={simBaseline.ics2Usd} step={1} onChange={v => setSimParams(p => ({ ...p, ics2Usd: v }))} unit="$" />
                </SimInputGroup>

                <SimInputGroup title="Extra Nolo EUR (art.74)">
                  <SimInput label="THC Sbarco" value={simParams.costiSbarco} baseline={simBaseline.costiSbarco} step={5} onChange={v => setSimParams(p => ({ ...p, costiSbarco: v }))} unit="€" />
                  <SimInput label="Addizionali Comp.Mar." value={simParams.addizionaliCompMar} baseline={simBaseline.addizionaliCompMar} step={5} onChange={v => setSimParams(p => ({ ...p, addizionaliCompMar: v }))} unit="€" />
                  <SimInput label="Dogana Import" value={simParams.doganaImport} baseline={simBaseline.doganaImport} step={5} onChange={v => setSimParams(p => ({ ...p, doganaImport: v }))} unit="€" />
                  <SimInput label="Fuel Surcharge EUR" value={simParams.fuelSurcharge} baseline={simBaseline.fuelSurcharge} step={1} onChange={v => setSimParams(p => ({ ...p, fuelSurcharge: v }))} unit="€" />
                </SimInputGroup>

                <SimInputGroup title="Trasporto Interno (IVA 22%)">
                  <SimInput label="Delivery Order" value={simParams.deliveryOrder} baseline={simBaseline.deliveryOrder} step={5} onChange={v => setSimParams(p => ({ ...p, deliveryOrder: v }))} unit="€" />
                  <SimInput label="Trasporto Interno" value={simParams.trasportoInterno} baseline={simBaseline.trasportoInterno} step={10} onChange={v => setSimParams(p => ({ ...p, trasportoInterno: v }))} unit="€" hint="Base, senza fuel" />
                  <SimInput label="Fuel Trasporto" value={simParams.fuelTrasportoPct} baseline={simBaseline.fuelTrasportoPct} step={0.5} onChange={v => setSimParams(p => ({ ...p, fuelTrasportoPct: v }))} unit="%" />
                </SimInputGroup>

                <SimInputGroup title="Imposizioni Doganali">
                  <SimInput label="Dazio" value={simParams.dazioPct} baseline={simBaseline.dazioPct} step={0.1} onChange={v => setSimParams(p => ({ ...p, dazioPct: v }))} unit="%" hint="A00 – TARIC 4011.10" />
                  <SimInput label="Antidumping" value={simParams.antidumpingPct} baseline={simBaseline.antidumpingPct} step={0.5} onChange={v => setSimParams(p => ({ ...p, antidumpingPct: v }))} unit="%" hint="A30 (se applicabile)" />
                  <SimInput label="IVA" value={simParams.ivaPct} baseline={simBaseline.ivaPct} step={0.5} onChange={v => setSimParams(p => ({ ...p, ivaPct: v }))} unit="%" hint="B00" />
                  <SimInput label="Unità 9AJ" value={simParams.unita9AJ} baseline={simBaseline.unita9AJ} step={1} onChange={v => setSimParams(p => ({ ...p, unita9AJ: v, dirittoDoganale9AJ: Math.round(v * 1.0908 * 100) / 100 }))} unit="pz" hint={`× 1,0908 = € ${fmtEur((simParams.unita9AJ || 0) * 1.0908)}`} />
                  <SimInput label="Aggiustamento v.45" value={simParams.aggiustamento} baseline={simBaseline.aggiustamento} step={1} onChange={v => setSimParams(p => ({ ...p, aggiustamento: v }))} unit="€" />
                </SimInputGroup>

                <SimInputGroup title="PFU & Markup">
                  <SimInput label="PFU fino 7'' (auto piccole)" value={simParams.pfuFino7} baseline={simBaseline.pfuFino7} step={0.05} onChange={v => setSimParams(p => ({ ...p, pfuFino7: v }))} unit="€" />
                  <SimInput label="PFU 7-15'' (auto medie)" value={simParams.pfu7_15} baseline={simBaseline.pfu7_15} step={0.05} onChange={v => setSimParams(p => ({ ...p, pfu7_15: v }))} unit="€" />
                  <SimInput label="PFU 15-30'' (SUV)" value={simParams.pfu15_30} baseline={simBaseline.pfu15_30} step={0.05} onChange={v => setSimParams(p => ({ ...p, pfu15_30: v }))} unit="€" />
                  <SimInput label="Markup vendita" value={simParams.markup} baseline={simBaseline.markup} step={0.05} onChange={v => setSimParams(p => ({ ...p, markup: v }))} unit="×" hint="1,45 = +45% ricarico" />
                  <SimInput label="Commissioni tot" value={simParams.commissioni} baseline={simBaseline.commissioni} step={10} onChange={v => setSimParams(p => ({ ...p, commissioni: v }))} unit="€" />
                </SimInputGroup>
              </div>

              {/* COLONNA DX: Scomposizione con formule e grafico */}
              <div className="sim-right">
                <div className="sim-section-title">📊 SCOMPOSIZIONE COSTO / PEZZO</div>

                <SimFormula
                  label="1. FOB USD → EUR"
                  formula={`$${fmtEur(simScomposizioneSimulata.fobUsd)} ÷ ${parseFloat(simParams.tassoEurUsd).toFixed(4)}`}
                  resultBase={simScomposizioneBaseline.fobEur}
                  resultSim={simScomposizioneSimulata.fobEur}
                />

                <SimFormula
                  label="2. Nolo /pz"
                  formula={`($${fmtEur(simScomposizioneSimulata.noloTotUsd)} ÷ ${parseFloat(simParams.tassoEurUsd).toFixed(4)}) ÷ ${simScomposizioneSimulata.qtyTot} pz`}
                  resultBase={simScomposizioneBaseline.noloPerPezzo}
                  resultSim={simScomposizioneSimulata.noloPerPezzo}
                />

                <SimFormula
                  label="3. Aggiustamento /pz"
                  formula={`€${fmtEur(simScomposizioneSimulata.aggTot)} ÷ ${simScomposizioneSimulata.qtyTot} pz`}
                  resultBase={simScomposizioneBaseline.aggPerPezzo}
                  resultSim={simScomposizioneSimulata.aggPerPezzo}
                />

                <SimFormula
                  label="= VALORE STATISTICO (v.46)"
                  formula={`FOB + Nolo + Aggiust = ${fmtEur(simScomposizioneSimulata.fobEur)} + ${fmtEur(simScomposizioneSimulata.noloPerPezzo)} + ${fmtEur(simScomposizioneSimulata.aggPerPezzo)}`}
                  resultBase={simScomposizioneBaseline.valoreStatistico}
                  resultSim={simScomposizioneSimulata.valoreStatistico}
                  highlight
                />

                <SimFormula
                  label={`4. Dazio A00 (${simParams.dazioPct}%)`}
                  formula={`${fmtEur(simScomposizioneSimulata.valoreStatistico)} × ${simParams.dazioPct}%`}
                  resultBase={simScomposizioneBaseline.dazio}
                  resultSim={simScomposizioneSimulata.dazio}
                />

                {simParams.antidumpingPct > 0 && (
                  <SimFormula
                    label={`5. Antidumping A30 (${simParams.antidumpingPct}%)`}
                    formula={`${fmtEur(simScomposizioneSimulata.valoreStatistico)} × ${simParams.antidumpingPct}%`}
                    resultBase={simScomposizioneBaseline.antidumping}
                    resultSim={simScomposizioneSimulata.antidumping}
                  />
                )}

                <SimFormula
                  label="6. 9AJ /pz"
                  formula={`${simParams.unita9AJ || 0} × 1,0908€ ÷ ${simScomposizioneSimulata.qtyTot} pz`}
                  resultBase={simScomposizioneBaseline.tassePerPezzo}
                  resultSim={simScomposizioneSimulata.tassePerPezzo}
                />

                <SimFormula
                  label={`7. IVA B00 (${simParams.ivaPct}%)`}
                  formula={`(${fmtEur(simScomposizioneSimulata.valoreStatistico)} + ${fmtEur(simScomposizioneSimulata.dazio)} + ${fmtEur(simScomposizioneSimulata.antidumping)} + ${fmtEur(simScomposizioneSimulata.tassePerPezzo)}) × ${simParams.ivaPct}%`}
                  resultBase={simScomposizioneBaseline.iva}
                  resultSim={simScomposizioneSimulata.iva}
                />

                <SimFormula
                  label="8. Extra nolo art.74 /pz"
                  formula={`€${fmtEur(simScomposizioneSimulata.extraNoloTot)} ÷ ${simScomposizioneSimulata.qtyTot} pz (THC + Dogana + Fuel + Addiz.)`}
                  resultBase={simScomposizioneBaseline.extraNoloPerPezzo}
                  resultSim={simScomposizioneSimulata.extraNoloPerPezzo}
                />

                <SimFormula
                  label="9. Servizi con IVA /pz"
                  formula={`(€${fmtEur(simParams.deliveryOrder)} + €${fmtEur(simParams.trasportoInterno)} + €${fmtEur(simScomposizioneSimulata.fuelTrasporto)} fuel${simParams.fuelTrasportoPct}% + €${fmtEur(simParams.ivaSpedizioniere || 0)}) ÷ ${simScomposizioneSimulata.qtyTot}`}
                  resultBase={simScomposizioneBaseline.serviziIvaPerPezzo}
                  resultSim={simScomposizioneSimulata.serviziIvaPerPezzo}
                />

                <SimFormula
                  label="10. Commissioni /pz"
                  formula={`€${fmtEur(simParams.commissioni || 0)} ÷ ${simScomposizioneSimulata.qtyTot} pz`}
                  resultBase={simScomposizioneBaseline.commissioniPerPezzo}
                  resultSim={simScomposizioneSimulata.commissioniPerPezzo}
                />

                <SimFormula
                  label={`11. PFU (${simulatorTarget.simItem.pfuFascia})`}
                  formula={`Fisso per fascia diametro`}
                  resultBase={simScomposizioneBaseline.pfuPezzo}
                  resultSim={simScomposizioneSimulata.pfuPezzo}
                />

                <SimFormula
                  label="= COSTO FINALE /pz"
                  formula="Somma di tutte le voci"
                  resultBase={simScomposizioneBaseline.costoFinale}
                  resultSim={simScomposizioneSimulata.costoFinale}
                  big
                />

                <SimFormula
                  label={`= PREZZO VENDITA (×${simParams.markup})`}
                  formula={`Costo finale × markup ${simParams.markup}`}
                  resultBase={simScomposizioneBaseline.prezzoVendita}
                  resultSim={simScomposizioneSimulata.prezzoVendita}
                  big
                />

                {/* GRAFICO a barre orizzontali: componenti del costo */}
                <div className="sim-section-title" style={{ marginTop: 12 }}>📈 COMPOSIZIONE COSTO — grafico a barre</div>
                <SimChart scom={simScomposizioneSimulata} baselineScom={simScomposizioneBaseline} />
              </div>
            </div>

            {/* FOOTER */}
            <div className="sim-footer">
              <div style={{ fontSize: 11, color: '#546e7a' }}>
                💡 <b>Valori temporanei</b>: modifiche attive solo in questa finestra. Per applicarle definitivamente usa "Salva Modifiche".
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="tbtn" onClick={resetSimulator}><X size={12} /> Reset Baseline</button>
                <button className="tbtn" onClick={closeSimulator}>Chiudi senza salvare</button>
                <button className="tbtn success" onClick={saveSimulatorChanges}>
                  <Check size={12} /> Salva Modifiche {simulatorTarget.type === 'bolla' ? 'nella Bolla' : 'nei Parametri'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== PANNELLO CONFRONTO LATERALE ===== */}
      {comparePanelOpen && compareItems.length > 0 && (
        <div className="compare-panel">
          <div className="compare-panel-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>📊 Pannello Confronto</span>
              <span style={{ background: '#fff', color: '#0d47a1', padding: '1px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700 }}>{compareItems.length}</span>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="tbtn" onClick={clearCompare} style={{ fontSize: 10, padding: '2px 6px' }}><X size={11} /> Svuota tutto</button>
              <button className="sim-close" onClick={() => setComparePanelOpen(false)}>✕</button>
            </div>
          </div>
          <div className="compare-panel-body">
            {(() => {
              // Calcolo prezzo "effettivo" filtrato per ogni item
              const itemsWithPrice = compareItems.map(it => {
                const sc = it.origine === 'CN' ? scomposizioneCatalogo[it.id] : null;
                const totFull = sc ? sc.costoFinale : (parseFloat(it.prezzoFinale) || 0);
                const totVisible = sc ? calcTotaleFiltrato(sc) : totFull;
                return { ...it, _sc: sc, _totFull: totFull, _totVisible: totVisible };
              });
              // Min e max per calcolare differenze
              const minPrice = itemsWithPrice.length > 0 ? Math.min(...itemsWithPrice.map(i => i._totVisible)) : 0;
              return itemsWithPrice.map((it, idx) => {
                const deltaPct = minPrice > 0 ? ((it._totVisible - minPrice) / minPrice * 100) : 0;
                const isMin = Math.abs(it._totVisible - minPrice) < 0.001;
                return (
                  <div key={it.id} className={`compare-card ${isMin ? 'best' : ''}`}>
                    <div className="compare-card-head">
                      <span className={`tag-origine ${it.origine}`}>{it.origine}</span>
                      <b style={{ flex: 1 }}>{it.marca}</b>
                      <button className="tbtn danger" onClick={() => removeFromCompare(it.id)} style={{ padding: '0 4px', height: 18, fontSize: 10 }}><X size={9} /></button>
                    </div>
                    {it.modello && <div className="compare-meta">{it.modello}</div>}
                    <div className="compare-meta">
                      <span className="tag-mis">{it.misura || '—'}</span>
                      <span className="tag-sup" style={{ marginLeft: 4 }}>{it.supplierName}</span>
                    </div>
                    <div className="compare-prices">
                      <div className="compare-row">
                        <span className="lbl">Prezzo originale</span>
                        <span className="val">{it.currency || 'EUR'} {fmtEur(it.prezzoOriginale)}</span>
                      </div>
                      {it._sc && <>
                        <div className="compare-row"><span className="lbl">FOB €</span><span className="val">{fmtEur(it._sc.fobEur)}</span></div>
                        <div className="compare-row"><span className="lbl">Nolo /pz</span><span className="val">{fmtEur(it._sc.noloPerPezzo)}</span></div>
                        <div className="compare-row"><span className="lbl">CIF (v.46)</span><span className="val"><b>{fmtEur(it._sc.valoreStatistico)}</b></span></div>
                        <div className="compare-row"><span className="lbl">Dazio</span><span className="val">{fmtEur(it._sc.dazio)}</span></div>
                        <div className="compare-row"><span className="lbl">IVA</span><span className="val">{fmtEur(it._sc.iva)}</span></div>
                        <div className="compare-row"><span className="lbl">Extra/Servizi</span><span className="val">{fmtEur(it._sc.extraNoloPerPezzo + it._sc.serviziIvaPerPezzo)}</span></div>
                        <div className="compare-row"><span className="lbl">PFU</span><span className="val">{fmtEur(it._sc.pfuPezzo)}</span></div>
                      </>}
                      <div className="compare-row total">
                        <span className="lbl">TOTALE{voci_escluse_labels.length > 0 ? ' (filtrato)' : ''}</span>
                        <span className="val total-val">€ {fmtEur(it._totVisible)}</span>
                      </div>
                      {!isMin && (
                        <div className="compare-row delta">
                          <span className="lbl">Δ vs miglior prezzo</span>
                          <span className="val">+{deltaPct.toFixed(1)}% (+{fmtEur(it._totVisible - minPrice)} €)</span>
                        </div>
                      )}
                      {isMin && compareItems.length > 1 && (
                        <div className="compare-row best-row">
                          <span style={{ flex: 1, color: '#1b5e20', fontWeight: 700 }}>🏆 MIGLIOR PREZZO</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}

      {/* ===== MODALE MODIFICA ARTICOLO ===== */}
      {editingItem && (
        <div className="guide-overlay" onClick={() => setEditingItem(null)}>
          <div className="guide-modal" style={{ maxWidth: 700 }} onClick={e => e.stopPropagation()}>
            <div className="guide-header" style={{ background: 'linear-gradient(to bottom, #1976d2, #0d47a1)' }}>
              <h2>✏️ Modifica Articolo</h2>
              <button className="sim-close" onClick={() => setEditingItem(null)}>✕</button>
            </div>
            <div className="guide-body">
              <div style={{ background: '#e3f2fd', padding: 8, marginBottom: 12, fontSize: 11, color: '#0d47a1' }}>
                <b>Origine:</b> <span className={`tag-origine ${editingItem.origine}`}>{editingItem.origine}</span> &nbsp; <b>Fornitore:</b> {editingItem.supplierName} &nbsp; <b>ID:</b> <code style={{ fontSize: 10 }}>{editingItem.id}</code>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="fld">
                  <label>Marca</label>
                  <input className="ctl" value={editingItem.marca || ''} onChange={e => setEditingItem({ ...editingItem, marca: e.target.value })} />
                </div>
                <div className="fld">
                  <label>Modello</label>
                  <input className="ctl" value={editingItem.modello || ''} onChange={e => setEditingItem({ ...editingItem, modello: e.target.value })} />
                </div>
                <div className="fld">
                  <label>Misura (formato libero, normalizzata in salvataggio)</label>
                  <input className="ctl" value={editingItem.misura || ''} onChange={e => setEditingItem({ ...editingItem, misura: e.target.value })} placeholder="Es. 205/55R16 o 2055516" />
                  {editingItem.misura && (
                    <div style={{ fontSize: 10, color: '#546e7a', marginTop: 2 }}>
                      → Salvata come: <b>{formatMisuraDisplay(editingItem.misura)}</b>
                    </div>
                  )}
                </div>
                <div className="fld">
                  <label>Fascia PFU (auto-calcolata)</label>
                  <select className="ctl" value={editingItem.pfuFascia || '7_15'} onChange={e => setEditingItem({ ...editingItem, pfuFascia: e.target.value })}>
                    <option value="fino7">fino a 7" (fino R14)</option>
                    <option value="7_15">7-15" (R14-R17)</option>
                    <option value="15_30">15-30" (R17-R21)</option>
                    <option value="30_60">30-60" (oltre R21)</option>
                  </select>
                </div>
                <div className="fld">
                  <label>Prezzo originale ({editingItem.currency || 'EUR'})</label>
                  <input className="ctl" type="number" step="0.01" value={editingItem.prezzoOriginale || 0} onChange={e => setEditingItem({ ...editingItem, prezzoOriginale: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="fld">
                  <label>Quantità disponibile</label>
                  <input className="ctl" type="number" step="2" min="0" value={editingItem.qtyDisponibile || 0} onChange={e => setEditingItem({ ...editingItem, qtyDisponibile: parseInt(e.target.value) || 0 })} />
                </div>
                <div className="fld">
                  <label>PFU € (override)</label>
                  <input className="ctl" type="number" step="0.05" value={editingItem.pfu || 0} onChange={e => setEditingItem({ ...editingItem, pfu: parseFloat(e.target.value) || 0 })} />
                </div>
              </div>
              <div style={{ marginTop: 12, padding: 8, background: '#fff8e1', fontSize: 11, color: '#bf360c' }}>
                💡 La fascia PFU viene ricalcolata automaticamente dalla misura al salvataggio. Il prezzo finale verrà ricalcolato in base ai parametri del fornitore.
              </div>
            </div>
            <div className="guide-footer" style={{ justifyContent: 'space-between' }}>
              <button className="tbtn" onClick={() => setEditingItem(null)}>Annulla</button>
              <button className="tbtn success" onClick={saveEditingItem}><Check size={12} /> Salva Modifiche</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== MODALE GUIDA RAPIDA ===== */}
      {showGuideModal && (
        <div className="guide-overlay" onClick={() => setShowGuideModal(false)}>
          <div className="guide-modal" onClick={e => e.stopPropagation()}>
            <div className="guide-header">
              <h2>📖 Guida Rapida — Gestionale Import v1.6</h2>
              <button className="sim-close" onClick={() => setShowGuideModal(false)}>✕</button>
            </div>
            <div className="guide-body">
              <h3>🇪🇺 Import Europa</h3>
              <p>Carica un listino da fornitore europeo (Excel/CSV). I prezzi sono già in <b>EUR</b>. Il sistema calcola solo PFU + trasporto + markup.</p>
              <ul>
                <li>Toolbar → <code>Import Europa</code> oppure menu <code>Archivio › Nuovo Import Europa</code></li>
                <li>Seleziona il file, poi mappa le colonne (Marca, Misura, Prezzo)</li>
                <li>Gli articoli finiscono nel <b>Catalogo</b> con un tag verde <code>EU</code></li>
              </ul>

              <h3>🇨🇳 Import Cina (Listino)</h3>
              <p>Carica un listino da fornitore cinese. I prezzi sono in <b>USD</b>. Il sistema calcola un prezzo EUR <b>stimato</b> con dazi+IVA+PFU standard.</p>
              <ul>
                <li>Toolbar → <code>Import Cina</code> oppure menu <code>Archivio › Nuovo Import Cina</code></li>
                <li>Mappa colonne + imposta cambio EUR/USD, dazio% e IVA% per la stima</li>
                <li>Gli articoli finiscono nel Catalogo con tag <code>CN</code> e badge arancione <code>STIMA</code></li>
              </ul>

              <h3>🛒 Selezione Articoli</h3>
              <p>Dal Catalogo clicca sulle righe che vuoi ordinare, imposta la quantità nella sezione <b>Selezione</b>.</p>

              <h3>📄 Genera Bolla Doganale (DAU)</h3>
              <p>Dalla Selezione → pulsante <code>Genera Bolla DAU</code> (rosso). Il wizard apre con:</p>
              <ul>
                <li><b>Preset nolo Savino Del Bene</b> preselezionato (HoChiMin/Cina × 20'/40')</li>
                <li>Costi fissi SDB precompilati (THC €210, Delivery €70, Dogana €95, Trasporto €315+10%)</li>
                <li>Anteprima DAU con tutti i calcoli (dazio A00, IVA B00, 9AJ, antidumping)</li>
                <li>Genera <b>PDF DAU ufficiale</b>, <b>PDF riepilogo</b> o <b>Excel dettaglio</b></li>
                <li>Opzione <b>"Aggiorna prezzi Catalogo"</b>: gli articoli diventano <code>REALE</code> (verde)</li>
              </ul>

              <h3>🔍 Simulatore What-If</h3>
              <p>Clicca sull'icona 🔍 accanto a qualsiasi articolo del Catalogo, o sul pulsante blu "Simulatore" in una bolla.</p>
              <ul>
                <li>Sinistra: tutti i parametri modificabili (cambio, nolo, dazio, IVA, PFU...)</li>
                <li>Destra: scomposizione con formula per ogni voce + grafico a barre</li>
                <li>I valori modificati sono <b>temporanei</b>: usa "Salva Modifiche" per applicarli davvero</li>
                <li>Verde = più economico del baseline · Rosso = più caro</li>
              </ul>

              <h3>📊 Confronto Prezzi</h3>
              <p>Menu <code>Visualizza › Confronto Prezzi</code>: raggruppa tutti gli articoli per misura e mostra il miglior prezzo con 🏆.</p>

              <h3>⌨️ Scorciatoie utili</h3>
              <ul>
                <li><code>Archivio › Esporta Parametri</code>: salva tutti i tuoi parametri in un file JSON (backup)</li>
                <li><code>Archivio › Importa Parametri</code>: ripristina un backup</li>
                <li><code>Modifica › Vista Compatta</code>: più righe a schermo</li>
                <li><code>Strumenti › Genera Bolla</code>: usa articoli Cina selezionati per bolla reale</li>
              </ul>

              <h3>💾 Dati</h3>
              <p>Tutti i tuoi dati sono salvati <b>localmente</b> nel browser (storage). Fai backup regolari con "Esporta Parametri" e "Export Catalogo Excel".</p>
            </div>
            <div className="guide-footer">
              <button className="tbtn primary" onClick={() => setShowGuideModal(false)}>Chiudi</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
