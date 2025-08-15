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
  
  // Fas-specifika λ-justeringar
  phase1_factor: 1.0,  // 0-90 min (normal)
  phase2_factor: 0.7,  // 90-120 min (extra time, lägre måltakt)
  
  // Domareffekter
  ref_intensity: 1.0   // 0.5-1.5; påverkar kort och hörnor
};

// Hjälpfunktioner
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const safeExp = (x) => Math.exp(clamp(x, -6, 6));

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
export const calculatePredictions = (formData, refIntensity = CAL.ref_intensity) => {
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
  const homeEfficiency = (homeSot + homeSoff) > 0 ? homeSot / (homeSot + homeSoff) : 0.35;
  const awayEfficiency = (awaySot + awaySoff) > 0 ? awaySot / (awaySot + awaySoff) : 0.35;
  
  const effBonusH = clamp(1 + CAL.k_eff * (homeEfficiency - 0.35), 0.8, 1.4);
  const effBonusA = clamp(1 + CAL.k_eff * (awayEfficiency - 0.35), 0.8, 1.4);
  
  let f_sot_h = clamp(1 + CAL.k_sot * homeSot - CAL.k_sot * 0.5 * awaySot, 0.6, 2.0);
  let f_sot_a = clamp(1 + CAL.k_sot * awaySot - CAL.k_sot * 0.5 * homeSot, 0.6, 2.0);
  
  f_sot_h *= effBonusH;
  f_sot_a *= effBonusA;
  
  // 3) Skott utanför mål
  const f_soff_h = clamp(1 + CAL.k_soff * homeSoff, 0.7, 1.8);
  const f_soff_a = clamp(1 + CAL.k_soff * awaySoff, 0.7, 1.8);
  
  // 4) Hörnor
  const f_corner_h = clamp(1 + CAL.k_corner * (formData.homeCorners || 0), 0.7, 1.8);
  const f_corner_a = clamp(1 + CAL.k_corner * (formData.awayCorners || 0), 0.7, 1.8);
  
  // 5) Förbättrade kortfaktorer med timing och balans
  const timeWeight = clamp(1 + 1.5 * (1 - timeRemaining), 1, 2.5);
  
  // Red-card timing: tidigare kort har större effekt
  const redCardTiming = isExtraTime ? 1.2 : clamp(minute / 90, 0.3, 1.0); // approximation
  const redEffectH = CAL.k_r * (formData.homeRedCards || 0) * (2 - redCardTiming);
  const redEffectA = CAL.k_r * (formData.awayRedCards || 0) * (2 - redCardTiming);
  
  // Kortbalans: motståndarens kort ger liten positiv effekt
  const cardBalanceH = CAL.k_card_balance * ((formData.awayYellowCards || 0) + 2 * (formData.awayRedCards || 0));
  const cardBalanceA = CAL.k_card_balance * ((formData.homeYellowCards || 0) + 2 * (formData.homeRedCards || 0));
  
  const f_card_h = clamp(
    1 - (CAL.k_y * (formData.homeYellowCards || 0) + redEffectH) * timeWeight + cardBalanceH,
    0.3, 1.2
  );
  const f_card_a = clamp(
    1 - (CAL.k_y * (formData.awayYellowCards || 0) + redEffectA) * timeWeight + cardBalanceA,
    0.3, 1.2
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
  
  // 1X2 från joint
  let homeWin = 0, draw = 0, awayWin = 0;
  for (let h = 0; h <= maxK; h++) {
    for (let a = 0; a <= maxK; a++) {
      const prob = joint[h][a];
      const adjustedH = h + (formData.homeGoals || 0);
      const adjustedA = a + (formData.awayGoals || 0);
      
      if (adjustedH > adjustedA) homeWin += prob;
      else if (adjustedH === adjustedA) draw += prob;
      else awayWin += prob;
    }
  }
  
  const total1x2 = homeWin + draw + awayWin || 1;
  homeWin /= total1x2;
  draw /= total1x2;
  awayWin /= total1x2;
  
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
  
  // Över/Under 2.5 mål
  const over25Goals = totalGoalProbs.reduce((s, p, idx) => s + (idx >= 3 ? p : 0), 0);
  const under25Goals = 1 - over25Goals;
  
  // Separata modeller för hörnor och kort
  const expectedCorners = calculateCornersModel(formData, timeRemaining, refIntensity);
  const cornerProbs = poissonRecursive(expectedCorners, 15);
  const over85Corners = cornerProbs.slice(9).reduce((s, p) => s + p, 0); // 9+ hörnor
  
  const expectedCards = calculateCardsModel(formData, timeRemaining, refIntensity);
  const cardProbs = poissonRecursive(expectedCards, 12);
  const over45Cards = cardProbs.slice(5).reduce((s, p) => s + p, 0); // 5+ kort
  
  // Första mål
  const firstGoalHome = homeLambda / (homeLambda + awayLambda + 0.2);
  const firstGoalAway = awayLambda / (homeLambda + awayLambda + 0.2);
  const noMoreGoals = 0.2 / (homeLambda + awayLambda + 0.2);
  
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
      expectedCards
    },
    overUnder: {
      goals: { over: over25Goals, under: under25Goals },
      corners: { over: over85Corners, under: 1 - over85Corners },
      cards: { over: over45Cards, under: 1 - over45Cards }
    },
    firstGoalScorer: {
      home: firstGoalHome,
      away: firstGoalAway,
      none: noMoreGoals
    },
    specificResults: specificResults.slice(0, 5),
    joint: joint // för eventuell heatmap
  };
};