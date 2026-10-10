// Codici ICAO degli aeroporti, cercati per codice IATA.
// Un aeroporto che manca qui semplicemente non mostra il codice ICAO: aggiungerlo è una voce.
export const ICAO = {
  // Italia
  MXP: 'LIMC', BGY: 'LIME', LIN: 'LIML', BLQ: 'LIPE', FCO: 'LIRF', CIA: 'LIRA', NAP: 'LIRN',
  VCE: 'LIPZ', TSF: 'LIPH', VRN: 'LIPX', TRN: 'LIMF', PSA: 'LIRP', FLR: 'LIRQ', PSR: 'LIBP',
  RMI: 'LIPR', BRI: 'LIBD', BDS: 'LIBR', CTA: 'LICC', PMO: 'LICJ', TPS: 'LICT', CAG: 'LIEE',
  OLB: 'LIEO', AHO: 'LIEA', SUF: 'LICA', REG: 'LICR', CRV: 'LIBC', PMF: 'LIMP', TRS: 'LIPQ',
  AOI: 'LIPY', PEG: 'LIRZ', CIY: 'LICB', LMP: 'LICD', PNL: 'LICG', BZO: 'LIPB', GOA: 'LIMJ',
  FRL: 'LIPK', AVB: 'LIPA', EBA: 'LIRJ', PXO: 'LPPS',
  // Egitto
  CAI: 'HECA', HRG: 'HEGN', SSH: 'HESH', RMF: 'HEMA', LXR: 'HELX', ASW: 'HESN', HBE: 'HEBA',
  MUH: 'HEMM', TCP: 'HETB',
  // Spagna e Portogallo
  FUE: 'GCFV', ACE: 'GCRR', LPA: 'GCLP', TFS: 'GCTS', TFN: 'GCXO', SPC: 'GCLA', GMZ: 'GCGM',
  PMI: 'LEPA', IBZ: 'LEIB', MAH: 'LEMH', BCN: 'LEBL', MAD: 'LEMD', AGP: 'LEMG', ALC: 'LEAL',
  VLC: 'LEVC', SVQ: 'LEZL', LIS: 'LPPT', OPO: 'LPPR', FAO: 'LPFR', FNC: 'LPMA', PDL: 'LPPD',
  // Grecia, Cipro, Turchia, Malta, Balcani
  AOK: 'LGKP', RHO: 'LGRP', HER: 'LGIR', CFU: 'LGKR', ATH: 'LGAV', SKG: 'LGTS', JTR: 'LGSR',
  JMK: 'LGMK', KGS: 'LGKO', ZTH: 'LGZA', CHQ: 'LGSA', JSI: 'LGSK', EFL: 'LGKF', PVK: 'LGPZ',
  KVA: 'LGKV', SMI: 'LGSM', JNX: 'LGNX', MLO: 'LGML', PAS: 'LGPA', KLX: 'LGKL', MJT: 'LGMT',
  LCA: 'LCLK', PFO: 'LCPH', AYT: 'LTAI', DLM: 'LTBS', BJV: 'LTFE', IST: 'LTFM', SAW: 'LTFJ',
  MLA: 'LMML', TIA: 'LATI', SPU: 'LDSP', DBV: 'LDDU', ZAD: 'LDZD', PUY: 'LDPL', BOJ: 'LBBG',
  VAR: 'LBWN', OTP: 'LROP',
  // Nord Africa
  DJE: 'DTTJ', MIR: 'DTMB', NBE: 'DTNH', TUN: 'DTTA', TOE: 'DTTZ', RAK: 'GMMX', AGA: 'GMAD', CMN: 'GMMN',
  // Africa subsahariana e Oceano Indiano
  SID: 'GVAC', BVC: 'GVBA', RAI: 'GVNP', MBA: 'HKMO', NBO: 'HKJK', MYD: 'HKML', ZNZ: 'HTZA',
  JRO: 'HTKJ', DAR: 'HTDA', NOS: 'FMNN', TNR: 'FMMI', MLE: 'VRMM', MRU: 'FIMP', SEZ: 'FSIA',
  DSS: 'GOBD', BJL: 'GBYD', ACC: 'DGAA', WDH: 'FYWH', CPT: 'FACT', JNB: 'FAOR', ADD: 'HAAB',
  // Medio Oriente e Asia
  SLL: 'OOSA', MCT: 'OOMS', DXB: 'OMDB', AUH: 'OMAA', AQJ: 'OJAQ', AMM: 'OJAI', TLV: 'LLBG',
  DOH: 'OTHH', BKK: 'VTBS', HKT: 'VTSP', USM: 'VTSM', DEL: 'VIDP', BOM: 'VABB', GOI: 'VOGO',
  CMB: 'VCBI', SIN: 'WSSS', DPS: 'WADD', HAN: 'VVNB', SGN: 'VVTS',
  // Caraibi, Americhe
  PUJ: 'MDPC', SDQ: 'MDSD', LRM: 'MDLR', POP: 'MDPP', MBJ: 'MKJS', KIN: 'MKJP', HAV: 'MUHA',
  VRA: 'MUVR', CCC: 'MUCC', HOG: 'MUHG', CYO: 'MUCL', SNU: 'MUSC', CUN: 'MMUN', CZM: 'MMCZ',
  BGI: 'TBPB', ANU: 'TAPA', AUA: 'TNCA', CUR: 'TNCC', SXM: 'TNCM', NAS: 'MYNN', JFK: 'KJFK',
  EWR: 'KEWR', MIA: 'KMIA', BOS: 'KBOS', NAT: 'SBSG', FOR: 'SBFZ', REC: 'SBRF', MCZ: 'SBMO',
  SSA: 'SBSV', GRU: 'SBGR', GIG: 'SBGL',
  // Europa
  LHR: 'EGLL', LGW: 'EGKK', MAN: 'EGCC', DUB: 'EIDW', KEF: 'BIKF', CDG: 'LFPG', FRA: 'EDDF',
  MUC: 'EDDM', ZRH: 'LSZH', VIE: 'LOWW', AMS: 'EHAM', BRU: 'EBBR', ARN: 'ESSA', CPH: 'EKCH',
  OSL: 'ENGM', HEL: 'EFHK', WAW: 'EPWA', PRG: 'LKPR', BUD: 'LHBP',
};

export const icaoFor = (iata) => ICAO[iata] ?? null;
