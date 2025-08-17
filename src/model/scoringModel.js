// Avancerad fotbollsprediktionsmodell med Dixon-Coles, tempo, domareffekter och förbättrad numerik

// Utökade kalibreringskonstanter
export const CAL = {
  // Bas faktorer
  k_sot: 0.10,
  k_soff: 0.04,
  k_poss: 0.50,
  k_corner: 0.03,
  k_y: 0.06,
  k_r: 0.35,
  
  // Dixon-Coles parameter (ersätter rho_draw)
  tau: 0.12, // 0..0.3 typiskt; justerar 0-0, 1-1 specifikt
  
  // Nya förbättringar
  k_eff: 0.25,     // skott-effektivitetsbonus
  k_tempo: 0.15,   // tempo-mod slutminut/game management
  k_card_balance: 0.03, // motståndarkort positiv effekt
  
  // Shrink-konstanter för robusthet
  prior_shots: 10,     // antal shots för shrink mot 0.35 efficiency
  prior_corners: 5,    // antal corners för shrink mot baslinje
  prior_cards: 3,      // antal cards för shrink mot baslinje
  max_factor_change: 0.3, // max ±30% per minut för stabilitet
  
  // Fas-specifika λ-justeringar
  phase1_factor: 1.0,  // 0-90 min (normal)
  phase2_factor: 0.7,  // 90-120 min (extra time, lägre måltakt)
  
  // Domareffekter
  ref_intensity: 1.0,  // 0.5-1.5; påverkar kort och hörnor

  // Konfidensnivå för Wilson-intervall (default 95%)
  confidence_z: 1.96
};

// Hjälpfunktioner
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const safeExp = (x) => Math.exp(clamp(x, -6, 6));

// Kalibreringslageret - mappar råa sannolikheter till kalibrerade
let calibrationCurves = null;

const loadCalibrationCurves = async () => {
  try {
    // Försök läsa calibration.json från public/calibration.json
    const response = await fetch('/calibration.json');
    if (response.ok) {
      calibrationCurves = await response.json();
      // Om _config.confidence_z finns, uppdatera CAL.confidence_z
      if (calibrationCurves && calibrationCurves._config && typeof calibrationCurves._config.confidence_z === 'number') {
        CAL.confidence_z = calibrationCurves._config.confidence_z;
        console.log('Satte confidence_z från calibration.json:', CAL.confidence_z);
      }
      console.log('Kalibreringskurvor laddade:', calibrationCurves);
    } else {
      console.log('Ingen calibration.json hittad - använder identity');
      calibrationCurves = 'identity';
    }
  } catch (error) {
    console.log('Fel vid läsning av kalibreringskurvor - använder identity:', error.message);
    calibrationCurves = 'identity';
  }
};

// Initiera kalibreringskurvor asynkront (ingen await behövs)
loadCalibrationCurves();

// Enkel linjär interpolation för kalibreringskurvor
const interpolate = (x, xPoints, yPoints) => {
  if (xPoints.length !== yPoints.length || xPoints.length === 0) return x;
  
  // Clamp till intervallet
  if (x <= xPoints[0]) return yPoints[0];
  if (x >= xPoints[xPoints.length - 1]) return yPoints[yPoints.length - 1];
  
  // Hitta intervall
  for (let i = 0; i < xPoints.length - 1; i++) {
    if (x >= xPoints[i] && x <= xPoints[i + 1]) {
      const t = (x - xPoints[i]) / (xPoints[i + 1] - xPoints[i]);
      return yPoints[i] + t * (yPoints[i + 1] - yPoints[i]);
    }
  }
  return x; // fallback
};

// Applicera kalibrering på en sannolikhet
const applyCalibartion = (rawProb, market) => {
  if (!calibrationCurves || calibrationCurves === 'identity') {
    return rawProb; // ingen kalibrering
  }
  
  const curve = calibrationCurves[market];
  if (!curve || !curve.x || !curve.y) {
    return rawProb; // ingen kurva för denna marknad
  }
  
  return clamp(interpolate(rawProb, curve.x, curve.y), 0, 1);
};

// Rekursiv Poisson för numerisk stabilitet
const poissonRecursive = (lambda, maxK) => {
  const probs = new Array(maxK + 1);
  probs[0] = safeExp(-lambda);
  
  for (let k = 1; k <= maxK; k++) {
    probs[k] = probs[k - 1] * lambda / k;
  }
  
  return probs;
};

// Dixon-Coles korrektion för specifika resultat
const applyDixonColes = (joint, maxK, tau) => {
  if (!tau || tau <= 0) return joint;
  
  // DC-faktorer för låga resultat
  const dcFactor = (h, a) => {
    if (h === 0 && a === 0) return 1 + tau;      // 0-0 boost
    if (h === 1 && a === 1) return 1 + tau * 0.7; // 1-1 boost (mindre)
    if ((h === 1 && a === 0) || (h === 0 && a === 1)) return 1 + tau * 0.3; // 1-0, 0-1 liten boost
    return 1;
  };
  
  // Applicera DC-korrektion
  let sumJoint = 0;
  for (let h = 0; h <= maxK; h++) {
    for (let a = 0; a <= maxK; a++) {
      joint[h][a] *= dcFactor(h, a);
      sumJoint += joint[h][a];
    }
  }
  
  // Renormalisera
  for (let h = 0; h <= maxK; h++) {
    for (let a = 0; a <= maxK; a++) {
      joint[h][a] /= sumJoint;
    }
  }
  
  return joint;
};

// Separata Poisson-modeller för hörnor och kort
const calculateCornersModel = (formData, timeRemaining, refIntensity) => {
  const totalCorners = (formData.homeCorners || 0) + (formData.awayCorners || 0);
  const remainingTime = clamp(timeRemaining, 0.05, 1);
  
  // Bas-rate justerad för domaren och tempo
  const baseRate = 4.5 * remainingTime * refIntensity;
  const tempoFactor = 1 + 0.3 * (1 - remainingTime); // högre rate sent i matchen
  
  const expectedCorners = Math.max(0.5, baseRate * tempoFactor - totalCorners);
  return expectedCorners;
};

const calculateCardsModel = (formData, timeRemaining, refIntensity) => {
  const totalCards = (formData.homeYellowCards || 0) + (formData.awayYellowCards || 0) + 
                    ((formData.homeRedCards || 0) + (formData.awayRedCards || 0)) * 2;
  const remainingTime = clamp(timeRemaining, 0.05, 1);
  
  // Bas-rate justerad för domaren
  const baseRate = 2.8 * remainingTime * refIntensity;
  const expectedCards = Math.max(0.2, baseRate - totalCards);
  return expectedCards;
};

// Huvudmodell
export const calculatePredictions = (formData) => {
  const minute = clamp(formData.matchMinute || 0, 0, 120);
  
  // Fas-hantering: 0-90 vs 90-120
  const isExtraTime = minute > 90;
  const phaseMinute = isExtraTime ? minute - 90 : minute;
  const phaseDuration = isExtraTime ? 30 : 90;
  const timeRemaining = clamp((phaseDuration - phaseMinute) / phaseDuration, 0.05, 1);
  const phaseFactor = isExtraTime ? CAL.phase2_factor : CAL.phase1_factor;
  
  // Bas-lambda med fas-justering
  let homeLambda = 1.4 * phaseFactor;
  let awayLambda = 1.2 * phaseFactor;
  
  // Hemmafördel
  if (formData.venue === 'home') {
    homeLambda *= 1.1;
  } else {
    awayLambda *= 1.1;
  }
  
  // Separata faktorer
  
  // 1) Possession
  const possDiffH = clamp((formData.homePossession || 50) - 50, -50, 50) / 50;
  const possDiffA = -possDiffH;
  const f_poss_h = clamp(1 + CAL.k_poss * possDiffH, 0.5, 1.5);
  const f_poss_a = clamp(1 + CAL.k_poss * possDiffA, 0.5, 1.5);
  
  // 2) Skott på mål med effektivitetsbonus
  const homeSot = formData.homeShotsOnTarget || 0;
  const awaySot = formData.awayShotsOnTarget || 0;
  const homeSoff = formData.homeShotsOffTarget || 0;
  const awaySoff = formData.awayShotsOffTarget || 0;
  
  // Skott-effektivitet: SOT/(SOT+SOFF)
  const priorShots = CAL.prior_shots;
  const homeShotsTotal = homeSot + homeSoff;
  const awayShotsTotal = awaySot + awaySoff;
  const homeEffRaw = homeShotsTotal > 0 ? homeSot / homeShotsTotal : 0.35;
  const awayEffRaw = awayShotsTotal > 0 ? awaySot / awayShotsTotal : 0.35;
  const homeEfficiency = (homeEffRaw * homeShotsTotal + 0.35 * priorShots) / (homeShotsTotal + priorShots);
  const awayEfficiency = (awayEffRaw * awayShotsTotal + 0.35 * priorShots) / (awayShotsTotal + priorShots);
  
  const effBonusH = clamp(1 + CAL.k_eff * (homeEfficiency - 0.35), 0.9, 1.2);
  const effBonusA = clamp(1 + CAL.k_eff * (awayEfficiency - 0.35), 0.9, 1.2);
  
  // Mjuk clip per minut på SOT-påverkan
  const perMinuteCap = 1 + CAL.max_factor_change * (minute / 90);
  let f_sot_h = clamp(1 + CAL.k_sot * homeSot - CAL.k_sot * 0.5 * awaySot, 1 / perMinuteCap, perMinuteCap);
  let f_sot_a = clamp(1 + CAL.k_sot * awaySot - CAL.k_sot * 0.5 * homeSot, 1 / perMinuteCap, perMinuteCap);
  
  f_sot_h *= effBonusH;
  f_sot_a *= effBonusA;
  
  // 3) Skott utanför mål
  const f_soff_h = clamp(1 + CAL.k_soff * homeSoff, 1 / perMinuteCap, perMinuteCap);
  const f_soff_a = clamp(1 + CAL.k_soff * awaySoff, 1 / perMinuteCap, perMinuteCap);
  
  // 4) Hörnor med förbättrad shrink
  const homeCorners = formData.homeCorners || 0;
  const awayCorners = formData.awayCorners || 0;
  const totalCornersObs = homeCorners + awayCorners;
  
  // Shrink mot baslinje baserat på förfluten tid och observerade events
  const cornerBaseline = 9; // typisk totala hörnor per match
  const expectedCornersByTime = (cornerBaseline / 90) * minute;
  const cornerShrink = CAL.prior_corners / (minute / 10 + CAL.prior_corners); // shrink minskar över tid
  
  // Justera individuella bidrag med shrink
  const cornerRateAdj = (totalCornersObs + cornerShrink * expectedCornersByTime) / (minute + cornerShrink * minute / 10);
  const homeCornerAdj = (homeCorners + cornerShrink * expectedCornersByTime * 0.5) / (minute / 10 + cornerShrink);
  const awayCornerAdj = (awayCorners + cornerShrink * expectedCornersByTime * 0.5) / (minute / 10 + cornerShrink);
  
  const f_corner_h = clamp(1 + CAL.k_corner * homeCornerAdj, 1 / perMinuteCap, perMinuteCap);
  const f_corner_a = clamp(1 + CAL.k_corner * awayCornerAdj, 1 / perMinuteCap, perMinuteCap);
  
  // 5) Förbättrade kortfaktorer med timing och balans
  const timeWeight = clamp(1 + 1.5 * (1 - timeRemaining), 1, 2.5);
  
  // Red-card timing: tidigare kort har större effekt
  const redCardTiming = isExtraTime ? 1.2 : clamp(minute / 90, 0.3, 1.0); // approximation
  const redEffectH = CAL.k_r * (formData.homeRedCards || 0) * (2 - redCardTiming);
  const redEffectA = CAL.k_r * (formData.awayRedCards || 0) * (2 - redCardTiming);
  
  // Kortbalans: motståndarens kort ger liten positiv effekt
  const cardBalanceH = CAL.k_card_balance * ((formData.awayYellowCards || 0) + 2 * (formData.awayRedCards || 0));
  const cardBalanceA = CAL.k_card_balance * ((formData.homeYellowCards || 0) + 2 * (formData.homeRedCards || 0));
  
  // Shrink för kort: tidigt i matchen dras effekten mot baseline
  const cardBaselinePer90 = 4.5; // totala kort per match
  const expectedCardsByTime = (cardBaselinePer90 / 90) * minute;
  const totalCardsObs = (formData.homeYellowCards || 0) + (formData.awayYellowCards || 0) + 2 * ((formData.homeRedCards || 0) + (formData.awayRedCards || 0));
  const cardShrink = CAL.prior_cards / (minute / 10 + CAL.prior_cards);
  const cardsAdj = (totalCardsObs + cardShrink * expectedCardsByTime) / (minute / 10 + cardShrink);
  
  const homeYCAdj = ((formData.homeYellowCards || 0) + 0.5 * cardShrink * expectedCardsByTime) / (minute / 10 + cardShrink);
  const awayYCAdj = ((formData.awayYellowCards || 0) + 0.5 * cardShrink * expectedCardsByTime) / (minute / 10 + cardShrink);
  
  const f_card_h = clamp(
    1 - (CAL.k_y * homeYCAdj + redEffectH) * timeWeight + cardBalanceH,
    1 / perMinuteCap, perMinuteCap
  );
  const f_card_a = clamp(
    1 - (CAL.k_y * awayYCAdj + redEffectA) * timeWeight + cardBalanceA,
    1 / perMinuteCap, perMinuteCap
  );
  
  // 6) Förbättrad match state med tempo-mod
  const goalDiff = (formData.homeGoals || 0) - (formData.awayGoals || 0);
  const stateIntensity = 0.25 * (1 - timeRemaining);
  
  // Tempo-mod: slutminut oavgjort ökar båda λ, ledning minskar leaderns λ
  let tempoMod = 1;
  if (minute > 75) {
    if (goalDiff === 0) {
      tempoMod = 1 + CAL.k_tempo * (minute - 75) / 15; // öka båda
    } else {
      // Game management när man leder
      tempoMod = 1 - CAL.k_tempo * 0.5 * Math.min(Math.abs(goalDiff), 2) * (minute - 75) / 15;
      tempoMod = clamp(tempoMod, 0.7, 1.3);
    }
  }
  
  let f_state_h = 1;
  let f_state_a = 1;
  
  if (goalDiff > 0) {
    f_state_h = clamp((1 - stateIntensity * Math.min(goalDiff, 3)) * tempoMod, 0.6, 1.4);
    f_state_a = clamp((1 + stateIntensity * Math.min(goalDiff, 3)) * tempoMod, 0.8, 1.6);
  } else if (goalDiff < 0) {
    const gd = Math.min(-goalDiff, 3);
    f_state_h = clamp((1 + stateIntensity * gd) * tempoMod, 0.8, 1.6);
    f_state_a = clamp((1 - stateIntensity * gd) * tempoMod, 0.6, 1.4);
  } else {
    // Oavgjort: applicera tempo-mod på båda
    f_state_h *= tempoMod;
    f_state_a *= tempoMod;
  }
  
  // Multiplicera in alla faktorer
  homeLambda = homeLambda * f_poss_h * f_sot_h * f_soff_h * f_corner_h * f_card_h * f_state_h;
  awayLambda = awayLambda * f_poss_a * f_sot_a * f_soff_a * f_corner_a * f_card_a * f_state_a;
  
  // Säkra rimliga λ-intervall
  homeLambda = clamp(homeLambda, 0.05, 8);
  awayLambda = clamp(awayLambda, 0.05, 8);
  
  // Bygg Poisson-fördelningar med dynamiskt målintervall
  let maxK = 6;
  const coverageTarget = 0.999;
  
  let homeGoalProbs = poissonRecursive(homeLambda, maxK);
  let awayGoalProbs = poissonRecursive(awayLambda, maxK);
  
  // Utöka tills täckning uppnås
  let coverage = homeGoalProbs.reduce((s, p) => s + p, 0);
  while (coverage < coverageTarget && maxK < 15) {
    maxK += 1;
    homeGoalProbs = poissonRecursive(homeLambda, maxK);
    awayGoalProbs = poissonRecursive(awayLambda, maxK);
    coverage = Math.min(
      homeGoalProbs.reduce((s, p) => s + p, 0),
      awayGoalProbs.reduce((s, p) => s + p, 0)
    );
  }
  
  // Normalisera
  const sumH = homeGoalProbs.reduce((s, p) => s + p, 0);
  const sumA = awayGoalProbs.reduce((s, p) => s + p, 0);
  for (let i = 0; i <= maxK; i++) {
    homeGoalProbs[i] /= sumH;
    awayGoalProbs[i] /= sumA;
  }
  
  // Bygg joint distribution
  const joint = Array.from({ length: maxK + 1 }, () => Array(maxK + 1).fill(0));
  for (let h = 0; h <= maxK; h++) {
    for (let a = 0; a <= maxK; a++) {
      joint[h][a] = homeGoalProbs[h] * awayGoalProbs[a];
    }
  }
  
  // Applicera Dixon-Coles korrektion
  applyDixonColes(joint, maxK, CAL.tau);
  
  // Summera marginaler för total-mål distribution
  const totalGoalProbs = Array(maxK + 1).fill(0);
  for (let t = 0; t <= maxK; t++) {
    for (let h = 0; h <= maxK; h++) {
      for (let a = 0; a <= maxK; a++) {
        if (h + a === t) totalGoalProbs[t] += joint[h][a];
      }
    }
  }
  
  // 1X2 från joint (råa sannolikheter)
  let rawHomeWin = 0, rawDraw = 0, rawAwayWin = 0;
  for (let h = 0; h <= maxK; h++) {
    for (let a = 0; a <= maxK; a++) {
      const prob = joint[h][a];
      const adjustedH = h + (formData.homeGoals || 0);
      const adjustedA = a + (formData.awayGoals || 0);
      
      if (adjustedH > adjustedA) rawHomeWin += prob;
      else if (adjustedH === adjustedA) rawDraw += prob;
      else rawAwayWin += prob;
    }
  }
  
  const total1x2 = rawHomeWin + rawDraw + rawAwayWin || 1;
  rawHomeWin /= total1x2;
  rawDraw /= total1x2;
  rawAwayWin /= total1x2;
  
  // Kalibrera 1X2 med eventuella kurvor
  const homeWin = applyCalibartion(rawHomeWin, '1_home');
  const draw = applyCalibartion(rawDraw, '1_draw');
  const awayWin = applyCalibartion(rawAwayWin, '1_away');
  
  // Specifika resultat (begränsat för UI)
  const specificResults = [];
  for (let h = 0; h <= Math.min(3, maxK); h++) {
    for (let a = 0; a <= Math.min(3, maxK); a++) {
      const prob = joint[h][a];
      specificResults.push({
        result: `${h + (formData.homeGoals || 0)}-${a + (formData.awayGoals || 0)}`,
        probability: prob,
        homeGoals: h + (formData.homeGoals || 0),
        awayGoals: a + (formData.awayGoals || 0)
      });
    }
  }
  specificResults.sort((a, b) => b.probability - a.probability);
  
  // Över/Under 2.5 mål (råa)
  const rawOver25Goals = totalGoalProbs.reduce((s, p, idx) => s + (idx >= 3 ? p : 0), 0);
  const rawUnder25Goals = 1 - rawOver25Goals;
  
  // Kalibrera OU 2.5
  const over25Goals = applyCalibartion(rawOver25Goals, 'ou25_over');
  const under25Goals = applyCalibartion(rawUnder25Goals, 'ou25_under');
  
  // Över/Under 3.5 mål (råa)
  const rawOver35Goals = totalGoalProbs.reduce((s, p, idx) => s + (idx >= 4 ? p : 0), 0);
  const rawUnder35Goals = 1 - rawOver35Goals;
  
  // Kalibrera OU 3.5
  const over35Goals = applyCalibartion(rawOver35Goals, 'ou35_over');
  const under35Goals = applyCalibartion(rawUnder35Goals, 'ou35_under');
  
  // Separata modeller för hörnor och kort
  const expectedCorners = calculateCornersModel(formData, timeRemaining, 1.0);
  const cornerProbs = poissonRecursive(expectedCorners, 15);
  const over85Corners = cornerProbs.slice(9).reduce((s, p) => s + p, 0); // 9+ hörnor
  
  const expectedCards = calculateCardsModel(formData, timeRemaining, 1.0);
  const cardProbs = poissonRecursive(expectedCards, 12);
  const over45Cards = cardProbs.slice(5).reduce((s, p) => s + p, 0); // 5+ kort
  
  // Första mål
  const firstGoalHome = homeLambda / (homeLambda + awayLambda + 0.2);
  const firstGoalAway = awayLambda / (homeLambda + awayLambda + 0.2);
  const noMoreGoals = 0.2 / (homeLambda + awayLambda + 0.2);

  // Bettingtips-regler (enkla heuristiker baserade på sannolikheter)
  const tips = [];
  const addTip = (text, score) => tips.push({ text, score });

  // Osäkerhetsintervall (Wilson score) och evidensvikt
  const wilson = (p, n, z = CAL.confidence_z) => {
    const nz = Math.max(10, n);
    const z2 = z * z;
    const denom = 1 + z2 / nz;
    const center = p + z2 / (2 * nz);
    const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * nz)) / nz);
    const lower = clamp((center - margin) / denom, 0, 1);
    const upper = clamp((center + margin) / denom, 0, 1);
    return { lower, upper };
  };
  const N_main = 30 + 70 * (1 - timeRemaining); // mer säkerhet senare i matchen
  const lb = (p, n = N_main) => wilson(p, n).lower;
  const ub = (p, n = N_main) => wilson(p, n).upper;

  // Event- och intensitets-trösklar för robustare tips
  const sumLambda = homeLambda + awayLambda;
  const cornersGuardOver = expectedCorners > 6;
  const cornersGuardUnder = expectedCorners < 10;
  const cardsGuardOver = expectedCards > 4;
  const cardsGuardUnder = expectedCards < 5;

  // 1X2
  if (lb(homeWin) > 0.55) addTip(`1 (hemmaseger) ${Math.round(homeWin*100)}%`, homeWin);
  if (lb(awayWin) > 0.55) addTip(`2 (bortaseger) ${Math.round(awayWin*100)}%`, awayWin);
  if (minute >= 70 && lb(draw) > 0.50) addTip(`Live: X (oavgjort) ${Math.round(draw*100)}%`, draw);

  // Över/Under 2.5
  if (minute < 75 && sumLambda > 2.4 && lb(over25Goals) > 0.60) addTip(`Över 2.5 mål ${Math.round(over25Goals*100)}%`, over25Goals);
  if (minute < 75 && sumLambda < 2.0 && lb(under25Goals) > 0.60) addTip(`Under 2.5 mål ${Math.round(under25Goals*100)}%`, under25Goals);
  
  // Över/Under 3.5
  if (minute < 70 && sumLambda > 3.1 && lb(over35Goals) > 0.60) addTip(`Över 3.5 mål ${Math.round(over35Goals*100)}%`, over35Goals);
  if (minute < 70 && sumLambda < 2.9 && lb(under35Goals) > 0.60) addTip(`Under 3.5 mål ${Math.round(under35Goals*100)}%`, under35Goals);
  
  // Double Chance
  const dc1x = applyCalibartion(homeWin + draw, 'dc_1x');
  const dc12 = applyCalibartion(homeWin + awayWin, 'dc_12');
  const dcx2 = applyCalibartion(draw + awayWin, 'dc_x2');
  if (lb(dc1x) > 0.70) addTip(`Double Chance 1X ${Math.round(dc1x*100)}%`, dc1x);
  if (lb(dc12) > 0.70) addTip(`Double Chance 12 ${Math.round(dc12*100)}%`, dc12);
  if (lb(dcx2) > 0.70) addTip(`Double Chance X2 ${Math.round(dcx2*100)}%`, dcx2);
  
  // Draw No Bet
  const dnbHome = applyCalibartion(homeWin / (homeWin + awayWin || 1), 'dnb_home');
  const dnbAway = applyCalibartion(awayWin / (homeWin + awayWin || 1), 'dnb_away');
  if (minute < 80 && lb(dnbHome) > 0.65) addTip(`Draw No Bet (Hemma) ${Math.round(dnbHome*100)}%`, dnbHome);
  if (minute < 80 && lb(dnbAway) > 0.65) addTip(`Draw No Bet (Borta) ${Math.round(dnbAway*100)}%`, dnbAway);

  // BTTS
  const pHome0 = homeGoalProbs[0] ?? 0;
  const pAway0 = awayGoalProbs[0] ?? 0;
  const p00 = joint[0] && joint[0][0] ? joint[0][0] : pHome0 * pAway0;
  const rawBtts = 1 - pHome0 - pAway0 + p00;
  const btts = applyCalibartion(rawBtts, 'btts_yes');
  if (minute < 80 && sumLambda > 1.8 && lb(btts) > 0.60) addTip(`BTTS: Ja ${Math.round(btts*100)}%`, btts);
  if (minute < 80 && sumLambda < 1.6 && lb(1 - btts) > 0.60) addTip(`BTTS: Nej ${Math.round((1-btts)*100)}%`, 1 - btts);

  // Hörnor och kort
  if (cornersGuardOver && lb(over85Corners) > 0.60) addTip(`Över 8.5 hörnor ${Math.round(over85Corners*100)}%`, over85Corners);
  if (cornersGuardUnder && lb(1 - over85Corners) > 0.60) addTip(`Under 8.5 hörnor ${Math.round((1-over85Corners)*100)}%`, 1 - over85Corners);

  if (cardsGuardOver && lb(over45Cards) > 0.60) addTip(`Över 4.5 kort ${Math.round(over45Cards*100)}%`, over45Cards);
  if (cardsGuardUnder && lb(1 - over45Cards) > 0.60) addTip(`Under 4.5 kort ${Math.round((1-over45Cards)*100)}%`, 1 - over45Cards);

  // Första målet
  if (minute < 70 && lb(firstGoalHome) > 0.60) addTip(`Första målet: ${formData.homeTeam || 'Hemma'} (${Math.round(firstGoalHome*100)}%)`, firstGoalHome);
  if (minute < 70 && lb(firstGoalAway) > 0.60) addTip(`Första målet: ${formData.awayTeam || 'Borta'} (${Math.round(firstGoalAway*100)}%)`, firstGoalAway);

  // Specifikt resultat (endast om väldigt tydligt)
  if (specificResults.length > 0 && specificResults[0].probability >= 0.12) {
    addTip(`Korrekt resultat ${specificResults[0].result} (${Math.round(specificResults[0].probability*100)}%)`, specificResults[0].probability);
  }

  // Rangordna och begränsa antal tips
  tips.sort((a, b) => b.score - a.score);
  const bettingTips = tips.slice(0, 6).map(t => t.text);
  
  return {
    matchOutcome: { homeWin, draw, awayWin },
    expectedGoals: {
      home: homeGoalProbs,
      away: awayGoalProbs,
      total: totalGoalProbs
    },
    meta: {
      maxK,
      lambdas: { home: homeLambda, away: awayLambda },
      factors: {
        f_poss: { home: f_poss_h, away: f_poss_a },
        f_sot: { home: f_sot_h, away: f_sot_a },
        f_soff: { home: f_soff_h, away: f_soff_a },
        f_corner: { home: f_corner_h, away: f_corner_a },
        f_card: { home: f_card_h, away: f_card_a },
        f_state: { home: f_state_h, away: f_state_a },
        efficiency: { home: homeEfficiency, away: awayEfficiency },
        timeRemaining,
        isExtraTime,
        tempoMod,
        dixonColes: CAL.tau
      },
      expectedCorners,
      expectedCards,
      calibration: calibrationCurves ? (calibrationCurves === 'identity' ? 'identity' : 'loaded') : 'unloaded'
    },
    overUnder: {
      goals: { over: over25Goals, under: under25Goals },
      goals35: { over: over35Goals, under: under35Goals },
      corners: { over: over85Corners, under: 1 - over85Corners },
      cards: { over: over45Cards, under: 1 - over45Cards }
    },
    doubleChance: {
      dc_1x: applyCalibartion(homeWin + draw, 'dc_1x'),
      dc_12: applyCalibartion(homeWin + awayWin, 'dc_12'),
      dc_x2: applyCalibartion(draw + awayWin, 'dc_x2')
    },
    drawNoBet: {
      home: applyCalibartion(homeWin / (homeWin + awayWin || 1), 'dnb_home'),
      away: applyCalibartion(awayWin / (homeWin + awayWin || 1), 'dnb_away')
    },
    firstGoalScorer: {
      home: firstGoalHome,
      away: firstGoalAway,
      none: noMoreGoals
    },
    specificResults: specificResults.slice(0, 5),
    joint: joint, // för eventuell heatmap
    bettingTips
  };
};