// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Edvin svenblad

//============================
// Core logic for the app
//============================

//============================
//=Energy sources=============
//============================
const EType = {
  ELECTRIC:    0,
  FJARRVARME:  1,
  FJARRKYLA:   2,
  BIOBRANSLE:  3,
  FOSSIL_OLJA: 4,
  FOSSIL_GAS:  5,
  E_TYPE_COUNT: 6
};

const E_wght = [
  /* ELECTRIC   */ 1.8,
  /* FJARRVARME */ 0.7,
  /* FJARRKYLA  */ 0.6,
  /* BIOBRANSLE */ 0.6,
  /* FOSSIL_OLJA*/ 1.8,
  /* FOSSIL_GAS */ 1.8
];

const E_name = [
  /* ELECTRIC    */ "El",
  /* FJARRVARME  */ "Fjärrvärme",
  /* FJARRKYLA   */ "Fjärrkyla",
  /* BIOBRANSLE  */ "Biobränslen",
  /* FOSSIL_OLJA */ "Fossil olja",
  /* FOSSIL_GAS  */ "Fossil gas"
];

//============================
//=Common numeric constants===
//============================
const FLOW_THRESHOLD      = 0.35; // l/s·m² base limit for flow calculations
const MAX_CREDITED_FLOW   = 0.6;  // highest q_medel allowed in ep4
const EP_FLOW_FACTOR      = 40;   // multiplier for ventilation additions to EP
const EL_FLOW_BASE        = 0.022; // base coefficient for EL increase due to flow
const EL_F_GEO_MULT       = 0.02; // factor applied to F_geo in EL formulas
const EL_AREA_BASE        = 0.025; // base coefficient for EL increase due to area
const ATEMP_LIMIT         = 130;  // area limit for certain EL calculations
const AREA_THRESHOLD      = 50;   // common area threshold for multi dwelling rules
const INFILTRATION_LIMIT  = 0.60; // air leakage limit for houses without EP req

//============================
//=Limit constants============
//============================
const SMALL_LIMIT_HIGH_ATEMP = 90;  // threshold for second EP band in small houses
const SMALL_EP_OVER_ATEMP_LIMIT = 90.0; // EP limit when Atemp > ATEMP_LIMIT
const SMALL_EP_MID_ATEMP = 95.0;   // EP limit when Atemp > SMALL_LIMIT_HIGH_ATEMP
const SMALL_EP_BASE = 100.0;       // EP limit when Atemp > AREA_THRESHOLD
const SMALL_U_VALUE = 0.30;        // U-value limit for small houses
const NO_REQ_U_VALUE = 0.33;       // U-value limit when no EP requirement applies
const MULTI_EP_BASE = 75.0;        // base EP requirement for multi-dwelling houses
const MULTI_U_VALUE = 0.40;        // U-value requirement for multi-dwelling houses
const LOCAL_EP_BASE = 70.0;        // base EP requirement for local premises
const LOCAL_U_VALUE = 0.50;        // U-value requirement for local premises

//============================
//=Tappvarmvatten=============
//============================
class TvvEntry {
  constructor(name, factor, etype) {
    this.name = name;
    this.factor = factor;
    this.etype = etype;
  }
}

const tvvFactors = [
  new TvvEntry("Fjärrvärme", 1.00, EType.FJARRVARME),
  new TvvEntry("El, direktverkande och elpanna", 1.00, EType.ELECTRIC),
  new TvvEntry("El, frånluftsvärmepump", 1.70, EType.ELECTRIC),
  new TvvEntry("El, uteluft-vattenvärmepump", 2.00, EType.ELECTRIC),
  new TvvEntry("El, markvärmepump (berg, mark, sjö)", 2.50, EType.ELECTRIC),
  new TvvEntry("Biobränslepanna (pellets, ved, flis m.m.)", 0.75, EType.BIOBRANSLE),
  new TvvEntry("Olja", 0.85, EType.FOSSIL_OLJA),
  new TvvEntry("Gaspanna", 0.90, EType.FOSSIL_GAS)
];

const TvvMult = [
  /* SMALL */ 20,
  /* MULTI */ 25,
  /* LOCAL */ 2
];

//============================
//=Location===================
//============================
class Location {
  constructor(name, F_geo) {
    this.name = name;
    this.F_geo = F_geo;
  }
}

const locations = [
  new Location("Åland",   1.1),
  new Location("none",    1.0)
];

//============================
//=House Type=================
//============================
const HouseType = {
  SMALL: 0,
  MULTI: 1,
  LOCAL: 2,
  HOUSE_TYPE_COUNT: 3
};

const HouseType_name = [
  /* SMALL */ "SMALL",
  /* MULTI */ "MULTI",
  /* LOCAL */ "LOCAL"
];

//============================
//=Energy Use=================
//============================
class Energy {
  constructor() {
    this.heat = Array(EType.E_TYPE_COUNT).fill(0);
    this.cool = Array(EType.E_TYPE_COUNT).fill(0);
    this.watr = Array(EType.E_TYPE_COUNT).fill(0);
    this.fast = Array(EType.E_TYPE_COUNT).fill(0);
    this.heat_ren = Array(EType.E_TYPE_COUNT).fill(0);
    this.cool_ren = Array(EType.E_TYPE_COUNT).fill(0);
    this.watr_ren = Array(EType.E_TYPE_COUNT).fill(0);
  }
}

//============================
//=House======================
//============================
class House {
  constructor(type, Atemp, location, tvvSrc = tvvFactors[0]) {
    this.type   = type;      // HouseType
    this.Atemp  = Atemp;     // Heated area in m²
    this.E      = new Energy(); // Energy uses
    this.L      = location;  // Location object
    this.flow   = 0.0;       // Instantaneous airflow (q) [l/s·m²]
    this.qavg   = 0.0;       // Average airflow (q_medel) [l/s·m²]
    this.Rooms  = 0;         // rooms+kitchens
    this.HouseHoldEnergy = 0.0; // placeholder for household energy
    this.uval   = { U_roof: 0.0 }; // list of u-values
    this.energyusage = null; // pointer/function for usage data
    this.foot2  = false;     // Footnote‐2 flag (LOCAL)
    this.foot3  = false;     // Footnote‐3 flag (LOCAL)
    this.foot4  = false;     // Footnote‐4 flag (MULTI)
    this.foot5  = false;     // Footnote‐5 flag (MULTI)
    this.tvvSrc = tvvSrc;    // source of hot water

    // standardised tappvarmvatten energy use
    this.E.watr[tvvSrc.etype] = Tvv(this);
  }
}

//============================
//=Limits Struct==============
//============================
class LimitVals {
  constructor(EP = 0.0, EL = 0.0, UM = 0.0, LL = 0.0) {
    this.EP = EP; // Primärenergital
    this.EL = EL; // Installerad eleffekt
    this.UM = UM; // U-värde
    this.LL = LL; // Luftläckage
  }
}

//============================
//=Helper Functions============
//============================
// “No requirement” value (falls back to large number if not configured)
const NoReq = CONFIG?.CONSTANTS?.NOREQ_VALUE ?? 999999999.0;
const seSec = -1.0;

function elBase(F_geo) {
  return (4.5 + 1.7 * (F_geo - 1.0));
}

function el1(F_geo, atemp) {
  // (0,025 + 0,02 × (F_geo − 1)) × (Atemp − 130) om Atemp > 130 m²
  if (atemp <= ATEMP_LIMIT) { return 0; }
  return (EL_AREA_BASE + EL_F_GEO_MULT * (F_geo - 1.0)) * (atemp - ATEMP_LIMIT);
}

function ep2(qavg) {
  // 40 × (q_medel − 0,35) om q_medel > 0,35
  if (qavg <= FLOW_THRESHOLD) { return 0; }
  return EP_FLOW_FACTOR * (qavg - FLOW_THRESHOLD);
}

function el3(F_geo, flow, atemp) {
  // (0,022 + 0,02 × (F_geo − 1)) × (flow − 0,35) × Atemp om flow > 0,35 l/s·m²
  if (flow <= FLOW_THRESHOLD) { return 0; }
  return (EL_FLOW_BASE + EL_F_GEO_MULT * (F_geo - 1.0)) * (flow - FLOW_THRESHOLD) * atemp;
}

function ep4(F_geo, flow, qavg, atemp, Foot4) {
  // ... i flerbostadshus där Atemp är 50 m² eller större
  if (atemp < AREA_THRESHOLD) { return 0; }
  // q_medel är uteluftsflödet i temperaturreglerade utrymmen överstiger 0,35 l/s·m²
  if (qavg <= FLOW_THRESHOLD) { return 0; }
  // Tillägget kan enbart användas på grund av krav på ventilation i särskilda utrymmen som badrum, toalett och kök
  if (!Foot4) { return 0; }
  // q_medel får högst tillgodoräknas upp till 0,6 l/s·m²
  if (qavg > MAX_CREDITED_FLOW) { qavg = MAX_CREDITED_FLOW; }
  return EP_FLOW_FACTOR * (qavg - FLOW_THRESHOLD);
}

function el5(F_geo, flow, atemp, Foot5) {
  // ... i flerbostadshus där Atemp är 50 m² eller större
  if (atemp < AREA_THRESHOLD) { return 0; }
  // Tillägget kan enbart användas då det maximala uteluftsflödet vid DVUT ... överstiger 0,35 l/s·m²
  if (flow <= FLOW_THRESHOLD) { return 0; }
  // på grund av krav på ventilation i särskilda utrymmen som badrum, toalett och kök
  // och som till övervägande delen (>50 % Atemp) inrymmer lägenheter med en boarea om högst 35 m² vardera
  if (!Foot5) { return 0; }
  // Tillägg får göras med (0,022 + 0,02 × (F_geo − 1)) × (flow − 0,35) × Atemp
  return (EL_FLOW_BASE + EL_F_GEO_MULT * (F_geo - 1.0)) * (flow - FLOW_THRESHOLD) * atemp;
}

function Tvv(house) {
  return TvvMult[house.type] * house.Atemp / house.tvvSrc.factor;
}

//============================
//=EPpet Calculation===========
//============================
function EPpet(house) {
  let total = 0.0;
  const F_geo = house.L.F_geo;
  const Atemp = house.Atemp;

  for (let i = 0; i < EType.E_TYPE_COUNT; i++) {
    const heat = house.E.heat[i] - house.E.heat_ren[i];
    const cool = house.E.cool[i] - house.E.cool_ren[i];
    const watr = house.E.watr[i] - house.E.watr_ren[i];
    const fast = house.E.fast[i];
    total += ((heat / F_geo) + cool + watr + fast) * (E_wght[i] / Atemp);
  }
  return Math.floor(total);
}

//============================
//=Limits Calculation=========
//============================
function limit(house) {
  const l = new LimitVals();
  const atemp = house.Atemp;
  const F_geo = house.L.F_geo;
  let flow  = house.flow;
  const qavg = house.qavg;

  if (house.type === HouseType.SMALL) {
    if (atemp > ATEMP_LIMIT) {
      l.EP = SMALL_EP_OVER_ATEMP_LIMIT;
      l.EL = elBase(F_geo) + el1(F_geo, atemp);
      l.UM = SMALL_U_VALUE;
      l.LL = seSec;
    } else if (atemp > SMALL_LIMIT_HIGH_ATEMP) {
      l.EP = SMALL_EP_MID_ATEMP;
      l.EL = elBase(F_geo) + el1(F_geo, atemp);
      l.UM = SMALL_U_VALUE;
      l.LL = seSec;
    } else if (atemp > AREA_THRESHOLD) {
      l.EP = SMALL_EP_BASE;
      l.EL = elBase(F_geo) + el1(F_geo, atemp);
      l.UM = SMALL_U_VALUE;
      l.LL = seSec;
    } else /* atemp >= 0 */ {
      l.EP = NoReq;
      l.EL = NoReq;
      l.UM = NO_REQ_U_VALUE;
      l.LL = INFILTRATION_LIMIT;
    }
  }
  else if (house.type === HouseType.MULTI) {
    if (atemp >= 0) {
      l.EP = MULTI_EP_BASE + ep4(F_geo, flow, qavg, atemp, house.foot4);
      l.EL = elBase(F_geo)
             + el1(F_geo, atemp)
             + el5(F_geo, flow, atemp, house.foot5);
      l.UM = MULTI_U_VALUE;
      l.LL = seSec;
    }
  }
  else if (house.type === HouseType.LOCAL) {
    if (atemp > AREA_THRESHOLD) {
      // Only add ep2(qavg) if foot2 is checked
      const ep_add = house.foot2 ? ep2(qavg) : 0;
      // Only add el3(...) if foot3 is checked
      const el_add = house.foot3 ? el3(F_geo, flow, atemp) : 0;

      l.EP = LOCAL_EP_BASE + ep_add;
      l.EL = elBase(F_geo)
             + el1(F_geo, atemp)
             + el_add;
      l.UM = LOCAL_U_VALUE;
      l.LL = seSec;
    } else /* atemp >= 0 */ {
      l.EP = NoReq;
      l.EL = NoReq;
      l.UM = NO_REQ_U_VALUE;
      l.LL = INFILTRATION_LIMIT;
    }
  }

  return l;
}


// Export for Node.js testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    EType,
    E_wght,
    E_name,
    Location,
    locations,
    HouseType,
    HouseType_name,
    Energy,
    House,
    LimitVals,
    elBase,
    el1,
    ep2,
    el3,
    ep4,
    el5,
    EPpet,
    limit
  };
}
