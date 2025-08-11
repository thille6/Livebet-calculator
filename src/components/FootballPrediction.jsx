import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement } from 'chart.js';
import { Pie, Bar } from 'react-chartjs-2';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement);

const FootballPrediction = () => {
  // State för formulärinmatning
  const [formData, setFormData] = useState({
    homeTeam: '',
    awayTeam: '',
    homePossession: 50,
    awayPossession: 50,
    homeShotsOnTarget: 0,
    awayShotsOnTarget: 0,
    homeShotsOffTarget: 0, // Nya fält för skott utanför mål
    awayShotsOffTarget: 0, // Nya fält för skott utanför mål
    homeCorners: 0,
    awayCorners: 0,
    homeYellowCards: 0,
    awayYellowCards: 0,
    homeRedCards: 0,
    awayRedCards: 0,
    homeGoals: 0,  // Fält för redan gjorda mål
    awayGoals: 0,  // Fält för redan gjorda mål
    matchMinute: 0,
    venue: 'home', // 'home' eller 'away'
    modelMode: 'poisson' // 'poisson' or 'heuristic'
  });

  // State för prediktionsresultat
  const [predictions, setPredictions] = useState(null);
  
  // State för historik
  const [history, setHistory] = useState([]);
  
  // State för modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modalData, setModalData] = useState(null);

  // Ladda historik från localStorage vid uppstart
  useEffect(() => {
    const savedHistory = localStorage.getItem('predictionHistory');
    if (savedHistory) {
      setHistory(JSON.parse(savedHistory));
    }
  }, []);

  // Hantera formulärinmatning
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    let newValue = value;
    
    // Konvertera numeriska värden
    if (name !== 'homeTeam' && name !== 'awayTeam' && name !== 'venue') {
      newValue = parseInt(value) || 0;
      
      // Validera bollinnehav
      if (name === 'homePossession') {
        const awayPossession = 100 - newValue;
        setFormData(prev => ({
          ...prev,
          homePossession: Math.max(0, Math.min(100, newValue)),
          awayPossession: Math.max(0, Math.min(100, awayPossession))
        }));
        return;
      } else if (name === 'awayPossession') {
        const homePossession = 100 - newValue;
        setFormData(prev => ({
          ...prev,
          awayPossession: Math.max(0, Math.min(100, newValue)),
          homePossession: Math.max(0, Math.min(100, homePossession))
        }));
        return;
      }
      
      // Validera matchminut
      if (name === 'matchMinute') {
        newValue = Math.max(0, Math.min(120, newValue));
      }
      
      // Validera negativa värden
      if (name !== 'matchMinute') {
        newValue = Math.max(0, newValue);
      }
    }
    
    setFormData(prev => ({
      ...prev,
      [name]: newValue
    }));
  };

  // Beräkna Poisson-sannolikhet
  const poissonProbability = (lambda, k) => {
    return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
  };

  // Hjälpfunktion för fakultet
  const factorial = (n) => {
    if (n === 0 || n === 1) return 1;
    let result = 1;
    for (let i = 2; i <= n; i++) {
      result *= i;
    }
    return result;
  };

  // Generera prediktioner
  const generatePredictions = () => {
    // Validera obligatoriska fält
    if (!formData.homeTeam || !formData.awayTeam) {
      alert('Lagnamn är obligatoriska!');
      return;
    }

    // Beräkna matchutfall (1X2)
    const homePossessionWeight = 0.4;
    const shotsWeight = 0.3;
    const cornersWeight = 0.2;
    const cardsWeight = -0.1;
    const homeAdvantage = formData.venue === 'home' ? 0.1 : 0;
    const lateGameDrawBonus = formData.matchMinute > 80 ? 0.05 : 0;

    // Beräkna totalvärden för varje lag
    const homeTotalCards = formData.homeYellowCards + formData.homeRedCards * 2;
    const awayTotalCards = formData.awayYellowCards + formData.awayRedCards * 2;
    
    // Beräkna normaliserade värden för varje faktor
    const possessionFactor = (formData.homePossession / 100) * homePossessionWeight;
    
    // Inkludera både skott på mål och utanför mål, men med olika vikt
    const homeTotalShots = formData.homeShotsOnTarget + formData.homeShotsOffTarget * 0.5;
    const awayTotalShots = formData.awayShotsOnTarget + formData.awayShotsOffTarget * 0.5;
    const totalShots = homeTotalShots + awayTotalShots;
    
    const shotsFactor = totalShots > 0 
      ? (homeTotalShots / totalShots) * shotsWeight 
      : shotsWeight / 2;
    
    const totalCorners = formData.homeCorners + formData.awayCorners;
    const cornersFactor = totalCorners > 0 
      ? (formData.homeCorners / totalCorners) * cornersWeight 
      : cornersWeight / 2;
    
    const totalCards = homeTotalCards + awayTotalCards;
    const cardsFactor = totalCards > 0 
      ? (1 - (homeTotalCards / totalCards)) * cardsWeight 
      : 0;

    // Beräkna lambda-värden först för Poisson-fördelning (förbättrade vikter)
    const homeAttacks = (
      formData.homeShotsOnTarget * 1.0 +
      formData.homeShotsOffTarget * 0.35 +
      formData.homeCorners * 0.15 +
      (formData.venue === 'home' ? 0.2 : 0)
    );
    const awayAttacks = (
      formData.awayShotsOnTarget * 1.0 +
      formData.awayShotsOffTarget * 0.35 +
      formData.awayCorners * 0.15 +
      (formData.venue === 'away' ? 0.0 : 0) // bortaplan ger ingen bonus
    );
    
    // Justera för kort (negativ påverkan på anfallseffektivitet)
    const homeCardsPenalty = formData.homeYellowCards * 0.08 + formData.homeRedCards * 0.4;
    const awayCardsPenalty = formData.awayYellowCards * 0.08 + formData.awayRedCards * 0.4;

    // Multiplikativ dämpning vid rött kort
    const homeRedFactor = formData.homeRedCards > 0 ? 0.8 : 1.0;
    const awayRedFactor = formData.awayRedCards > 0 ? 0.8 : 1.0;

    // Tidsfaktor (skala med kvarvarande minuter, max 120 för förlängning)
    const minutesLeft = Math.max(0, 90 - formData.matchMinute);
    const timeFactor = Math.max(0.15, Math.min(1, minutesLeft / 90));

    // Lambda-värden för Poisson (förväntade mål) med skalningsfaktor och clamp
    const scale = 0.40;
    const rawHomeLambda = Math.max(0, (homeAttacks - homeCardsPenalty)) * scale * timeFactor * homeRedFactor;
    const rawAwayLambda = Math.max(0, (awayAttacks - awayCardsPenalty)) * scale * timeFactor * awayRedFactor;
    const homeLambda = Math.max(0.15, Math.min(2.2, rawHomeLambda));
    const awayLambda = Math.max(0.15, Math.min(2.2, rawAwayLambda));
    
    console.log('=== POISSON-BASERAD 1X2 BERÄKNING ===');
    console.log('Lambda-värden:', { 
      homeAttacks, 
      awayAttacks, 
      homeLambda, 
      awayLambda 
    });


    
    // Räkna fram 1X2 direkt från Poisson genom att summera sannolikheter för exakta resultat
    // Vi beaktar nuvarande ställning genom att endast räkna återstående mål (prognos från nu)
    const startHome = formData.homeGoals;
    const startAway = formData.awayGoals;
    
    let homeWinProb = 0;
    let drawProb = 0;
    let awayWinProb = 0;
    
    // Adaptivt spann för återstående mål för att täcka ~99.9% av massan
    const coverage = 0.999;
    const calcMaxK = (lambda) => {
      let cum = 0;
      let k = 0;
      while (cum < coverage && k < 15) {
        cum += poissonProbability(lambda, k);
        k++;
      }
      return Math.max(6, k); // minst 6, annars dynamiskt baserat på lambda
    };
    const maxH = calcMaxK(homeLambda);
    const maxA = calcMaxK(awayLambda);

    for (let h = 0; h <= maxH; h++) {
      const pH = poissonProbability(homeLambda, h);
      for (let a = 0; a <= maxA; a++) {
        const pA = poissonProbability(awayLambda, a);
        const prob = pH * pA;
        const finalHome = startHome + h;
        const finalAway = startAway + a;
        if (finalHome > finalAway) homeWinProb += prob;
        else if (finalHome === finalAway) drawProb += prob;
        else awayWinProb += prob;
      }
    }
    
    // Bonus för oavgjort sent i matchen (små justeringar, normaliseras efteråt)
    if (formData.matchMinute > 80) {
      drawProb *= 1.05;
    }
    
    // Normalisera
    const sum1x2 = homeWinProb + drawProb + awayWinProb;
    homeWinProb /= sum1x2;
    drawProb /= sum1x2;
    awayWinProb /= sum1x2;
    
    console.log('Poisson 1X2:', { homeWinProb, drawProb, awayWinProb, sum: homeWinProb + drawProb + awayWinProb });
    
    // Beräkna sannolikheter för antal mål
    const homeGoalProbs = [];
    const awayGoalProbs = [];
    const totalGoalProbs = [];
    
    for (let i = 0; i <= 4; i++) {
      // Sannolikhet för exakt i mål
      homeGoalProbs[i] = poissonProbability(homeLambda, i);
      awayGoalProbs[i] = poissonProbability(awayLambda, i);
      
      // Sannolikhet för totalt i mål (konvolution av hemma- och bortamål)
      let totalProb = 0;
      for (let j = 0; j <= i; j++) {
        totalProb += poissonProbability(homeLambda, j) * poissonProbability(awayLambda, i - j);
      }
      totalGoalProbs[i] = totalProb;
    }
    
    // Sannolikhet för 4+ mål
    homeGoalProbs[4] = 1 - homeGoalProbs.slice(0, 4).reduce((a, b) => a + b, 0);
    awayGoalProbs[4] = 1 - awayGoalProbs.slice(0, 4).reduce((a, b) => a + b, 0);
    totalGoalProbs[4] = 1 - totalGoalProbs.slice(0, 4).reduce((a, b) => a + b, 0);

    // Beräkna över/under-marknader
    const overUnderGoals = {
      over: 1 - (totalGoalProbs[0] + totalGoalProbs[1] + totalGoalProbs[2] * 0.5),
      under: totalGoalProbs[0] + totalGoalProbs[1] + totalGoalProbs[2] * 0.5
    };
    
    const totalCornerExpectation = formData.homeCorners + formData.awayCorners + 
      (formData.homeShotsOnTarget + formData.awayShotsOnTarget) * 0.2 * (1 - formData.matchMinute / 120) +
      (formData.homeShotsOffTarget + formData.awayShotsOffTarget) * 0.1 * (1 - formData.matchMinute / 120);
    
    const overUnderCorners = {
      over: totalCornerExpectation > 8.5 ? 0.6 : 0.4,
      under: totalCornerExpectation <= 8.5 ? 0.6 : 0.4
    };
    
    const totalCardExpectation = homeTotalCards + awayTotalCards + 
      (formData.matchMinute / 120) * 2;
    
    const overUnderCards = {
      over: totalCardExpectation > 4.5 ? 0.6 : 0.4,
      under: totalCardExpectation <= 4.5 ? 0.6 : 0.4
    };

    // Beräkna specifika resultat med hänsyn till redan gjorda mål
    const specificResults = [];
    console.log('Beräkning av specifika resultat:');
    for (let home = 0; home <= 3; home++) {
      for (let away = 0; away <= 3; away++) {
        const homePoisson = poissonProbability(homeLambda, home);
        const awayPoisson = poissonProbability(awayLambda, away);
        const resultProb = homePoisson * awayPoisson;
        
        console.log(`Resultat ${formData.homeGoals + home}-${formData.awayGoals + away}:`, { 
          homePoisson, 
          awayPoisson, 
          resultProb 
        });
        
        specificResults.push({
          result: `${formData.homeTeam} ${formData.homeGoals + home} - ${formData.awayTeam} ${formData.awayGoals + away}`,
          probability: resultProb,
          homeGoals: formData.homeGoals + home,
          awayGoals: formData.awayGoals + away
        });
      }
    }
    
    // Sortera och ta de 5 mest sannolika resultaten
    specificResults.sort((a, b) => b.probability - a.probability);
    const top5Results = specificResults.slice(0, 5);

    // Beräkna första målgörare (lag) eller nästa målgörare om det redan finns mål
    let homeFirstGoalProb, awayFirstGoalProb, noGoalProb;
    
    console.log('Beräkning av första/nästa målgörare:');
    
    if (formData.homeGoals === 0 && formData.awayGoals === 0) {
      // Inga mål gjorda än - beräkna första målgörare
      const totalLambda = homeLambda + awayLambda;
      const noGoalRaw = Math.exp(-totalLambda);
      const goalScoredProb = 1 - noGoalRaw;
      
      homeFirstGoalProb = homeLambda / totalLambda * goalScoredProb;
      awayFirstGoalProb = awayLambda / totalLambda * goalScoredProb;
      noGoalProb = noGoalRaw;
      
      console.log('Första målgörare (inga mål gjorda):', { 
        totalLambda,
        goalScoredProb,
        noGoalRaw,
        hemmaRatio: homeLambda / totalLambda,
        bortaRatio: awayLambda / totalLambda,
        hemma: homeFirstGoalProb, 
        borta: awayFirstGoalProb, 
        ingaMål: noGoalProb 
      });
    } else {
      // Mål redan gjorda - beräkna nästa målgörare
      const totalLambda = homeLambda + awayLambda;
      const noGoalRaw = Math.exp(-totalLambda);
      homeFirstGoalProb = (homeLambda / totalLambda) * (1 - noGoalRaw);
      awayFirstGoalProb = (awayLambda / totalLambda) * (1 - noGoalRaw);
      noGoalProb = noGoalRaw;
      
      console.log('Nästa målgörare (mål redan gjorda):', { 
        totalLambda,
        hemmaRatio: homeLambda / totalLambda,
        bortaRatio: awayLambda / totalLambda,
        hemmaFöreNormalisering: homeFirstGoalProb, 
        bortaFöreNormalisering: awayFirstGoalProb, 
        ingaMålFöreNormalisering: noGoalProb 
      });
      
      // Normalisering inte nödvändig: komponenter summerar redan till 1
      
      console.log('Efter normalisering:', { 
        hemma: homeFirstGoalProb, 
        borta: awayFirstGoalProb, 
        ingaMer: noGoalProb 
      });
    }

    // Generera betting-tips
    const bettingTips = [];
    // Kontrollera att lagnamn är angivna, annars använd generiska namn
    const homeTeamName = formData.homeTeam.trim() || 'Hemmalag';
    const awayTeamName = formData.awayTeam.trim() || 'Bortalag';
    
    if (homeWinProb > 0.6) bettingTips.push(`${homeTeamName} vinst (${(homeWinProb * 100).toFixed(1)}%)`);
    if (awayWinProb > 0.6) bettingTips.push(`${awayTeamName} vinst (${(awayWinProb * 100).toFixed(1)}%)`);
    if (drawProb > 0.3) bettingTips.push(`Oavgjort (${(drawProb * 100).toFixed(1)}%)`);
    if (overUnderGoals.over > 0.7) bettingTips.push(`Över 2.5 mål (${(overUnderGoals.over * 100).toFixed(1)}%)`);
    if (overUnderGoals.under > 0.7) bettingTips.push(`Under 2.5 mål (${(overUnderGoals.under * 100).toFixed(1)}%)`);
    if (overUnderCorners.over > 0.7) bettingTips.push(`Över 8.5 hörnor (${(overUnderCorners.over * 100).toFixed(1)}%)`);
    if (overUnderCorners.under > 0.7) bettingTips.push(`Under 8.5 hörnor (${(overUnderCorners.under * 100).toFixed(1)}%)`);
    if (overUnderCards.over > 0.7) bettingTips.push(`Över 4.5 kort (${(overUnderCards.over * 100).toFixed(1)}%)`);
    if (overUnderCards.under > 0.7) bettingTips.push(`Under 4.5 kort (${(overUnderCards.under * 100).toFixed(1)}%)`);
    
    // Lägg till specifika resultat med hög sannolikhet
    top5Results.forEach(result => {
      if (result.probability > 0.05) {
        bettingTips.push(`Resultat ${result.result} (${(result.probability * 100).toFixed(1)}%)`);
      }
    });
    
    // Anpassa texten baserat på om det redan finns mål i matchen
    if (formData.homeGoals === 0 && formData.awayGoals === 0) {
      if (homeFirstGoalProb > 0.6) bettingTips.push(`${homeTeamName} gör första målet (${(homeFirstGoalProb * 100).toFixed(1)}%)`);
      if (awayFirstGoalProb > 0.6) bettingTips.push(`${awayTeamName} gör första målet (${(awayFirstGoalProb * 100).toFixed(1)}%)`);
    } else {
      if (homeFirstGoalProb > 0.6) bettingTips.push(`${homeTeamName} gör nästa mål (${(homeFirstGoalProb * 100).toFixed(1)}%)`);
      if (awayFirstGoalProb > 0.6) bettingTips.push(`${awayTeamName} gör nästa mål (${(awayFirstGoalProb * 100).toFixed(1)}%)`);
      if (noGoalProb > 0.3) bettingTips.push(`Inga fler mål (${(noGoalProb * 100).toFixed(1)}%)`);
    }

    // Logga inmatade värden och beräkningsresultat för felsökning
    console.log('=== INMATADE VÄRDEN ===');
    console.log('Lagnamn:', { hemmalag: homeTeamName, bortalag: awayTeamName });
    console.log('Statistik:', { 
      possession: { hemma: formData.homePossession, borta: formData.awayPossession },
      shotsOnTarget: { hemma: formData.homeShotsOnTarget, borta: formData.awayShotsOnTarget },
      shotsOffTarget: { hemma: formData.homeShotsOffTarget, borta: formData.awayShotsOffTarget },
      corners: { hemma: formData.homeCorners, borta: formData.awayCorners },
      cards: { 
        hemmaGula: formData.homeYellowCards, 
        hemmaRöda: formData.homeRedCards,
        bortaGula: formData.awayYellowCards, 
        bortaRöda: formData.awayRedCards 
      },
      goals: { hemma: formData.homeGoals, borta: formData.awayGoals },
      matchMinute: formData.matchMinute,
      venue: formData.venue
    });
    
    console.log('=== BERÄKNINGSRESULTAT ===');
    console.log('Matchutfall:', { 
      hemmavinst: homeWinProb, 
      oavgjort: drawProb, 
      bortavinst: awayWinProb 
    });
    console.log('Lambda-värden:', { hemma: homeLambda, borta: awayLambda });
    console.log('Förväntade mål:', { 
      hemma: homeGoalProbs, 
      borta: awayGoalProbs, 
      totalt: totalGoalProbs 
    });
    console.log('Över/Under:', { 
      mål: overUnderGoals, 
      hörnor: overUnderCorners, 
      kort: overUnderCards 
    });
    console.log('Topp 5 resultat:', top5Results);
    console.log('Första/nästa målgörare:', { 
      hemma: homeFirstGoalProb, 
      borta: awayFirstGoalProb, 
      ingaMer: noGoalProb 
    });
    console.log('Betting-tips:', bettingTips);
    
    // Samla alla prediktioner
    const newPrediction = {
      id: Date.now(),
      timestamp: new Date().toLocaleString(),
      formData: { ...formData },
      results: {
        matchOutcome: { homeWin: homeWinProb, draw: drawProb, awayWin: awayWinProb },
        expectedGoals: {
          home: homeGoalProbs,
          away: awayGoalProbs,
          total: totalGoalProbs
        },
        overUnder: {
          goals: overUnderGoals,
          corners: overUnderCorners,
          cards: overUnderCards
        },
        specificResults: top5Results,
        firstGoalScorer: {
          home: homeFirstGoalProb,
          away: awayFirstGoalProb,
          none: noGoalProb
        },
        bettingTips
      }
    };

    // Uppdatera state med nya prediktioner
    setPredictions(newPrediction);

    // Uppdatera historik
    const updatedHistory = [newPrediction, ...history].slice(0, 5);
    setHistory(updatedHistory);
    localStorage.setItem('predictionHistory', JSON.stringify(updatedHistory));
  };

  // Öppna modal med detaljerad information
  const openModal = (result) => {
    setModalData(result);
    setModalOpen(true);
  };

  // Stäng modal
  const closeModal = () => {
    setModalOpen(false);
    setModalData(null);
  };

  // Radera historik
  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem('predictionHistory');
  };

  // Exportera prediktioner som JSON
  const exportPredictions = () => {
    if (!predictions) return;
    
    const dataStr = JSON.stringify(predictions, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `football-prediction-${formData.homeTeam}-vs-${formData.awayTeam}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  // Ladda historisk prediktion
  const loadPrediction = (prediction) => {
    setFormData(prediction.formData);
    setPredictions(prediction);
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center min-h-screen p-4"
    >
      <h1 className="text-3xl font-bold mb-6">Livebet Calculator</h1>
      
      {/* Inmatningsformulär */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="bg-gray-800 p-6 rounded-lg shadow-lg max-w-md w-full mb-8"
      >
        <h2 className="text-xl font-semibold mb-4">Matchdata</h2>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Lagnamn */}
          <div>
            <label className="block text-sm font-medium mb-1">Hemmalag</label>
            <input 
              type="text" 
              name="homeTeam" 
              value={formData.homeTeam} 
              onChange={handleInputChange} 
              className="w-full bg-gray-700 rounded p-2 text-white"
              placeholder="t.ex. Man United"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Bortalag</label>
            <input 
              type="text" 
              name="awayTeam" 
              value={formData.awayTeam} 
              onChange={handleInputChange} 
              className="w-full bg-gray-700 rounded p-2 text-white"
              placeholder="t.ex. Arsenal"
            />
          </div>
          
          {/* Bollinnehav */}
          <div>
            <label className="block text-sm font-medium mb-1">Hemmalag bollinnehav (%)</label>
            <input 
              type="number" 
              name="homePossession" 
              value={formData.homePossession} 
              onChange={handleInputChange} 
              min="0" 
              max="100" 
              className="w-full bg-gray-700 rounded p-2 text-white"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Bortalag bollinnehav (%)</label>
            <input 
              type="number" 
              name="awayPossession" 
              value={formData.awayPossession} 
              onChange={handleInputChange} 
              min="0" 
              max="100" 
              className="w-full bg-gray-700 rounded p-2 text-white"
            />
          </div>
          
          {/* Skott på mål */}
          <div>
            <label className="block text-sm font-medium mb-1">Hemmalag skott på mål</label>
            <input 
              type="number" 
              name="homeShotsOnTarget" 
              value={formData.homeShotsOnTarget} 
              onChange={handleInputChange} 
              min="0" 
              className="w-full bg-gray-700 rounded p-2 text-white"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Bortalag skott på mål</label>
            <input 
              type="number" 
              name="awayShotsOnTarget" 
              value={formData.awayShotsOnTarget} 
              onChange={handleInputChange} 
              min="0" 
              className="w-full bg-gray-700 rounded p-2 text-white"
            />
          </div>
          
          {/* Skott utanför mål */}
          <div>
            <label className="block text-sm font-medium mb-1">Hemmalag skott utanför mål</label>
            <input 
              type="number" 
              name="homeShotsOffTarget" 
              value={formData.homeShotsOffTarget} 
              onChange={handleInputChange} 
              min="0" 
              className="w-full bg-gray-700 rounded p-2 text-white"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Bortalag skott utanför mål</label>
            <input 
              type="number" 
              name="awayShotsOffTarget" 
              value={formData.awayShotsOffTarget} 
              onChange={handleInputChange} 
              min="0" 
              className="w-full bg-gray-700 rounded p-2 text-white"
            />
          </div>
          
          {/* Hörnor */}
          <div>
            <label className="block text-sm font-medium mb-1">Hemmalag hörnor</label>
            <input 
              type="number" 
              name="homeCorners" 
              value={formData.homeCorners} 
              onChange={handleInputChange} 
              min="0" 
              className="w-full bg-gray-700 rounded p-2 text-white"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Bortalag hörnor</label>
            <input 
              type="number" 
              name="awayCorners" 
              value={formData.awayCorners} 
              onChange={handleInputChange} 
              min="0" 
              className="w-full bg-gray-700 rounded p-2 text-white"
            />
          </div>
          
          {/* Redan gjorda mål */}
          <div>
            <label className="block text-sm font-medium mb-1">Hemmalag mål</label>
            <input 
              type="number" 
              name="homeGoals" 
              value={formData.homeGoals} 
              onChange={handleInputChange} 
              min="0" 
              className="w-full bg-gray-700 rounded p-2 text-white"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Bortalag mål</label>
            <input 
              type="number" 
              name="awayGoals" 
              value={formData.awayGoals} 
              onChange={handleInputChange} 
              min="0" 
              className="w-full bg-gray-700 rounded p-2 text-white"
            />
          </div>
          
          {/* Gula kort */}
          <div>
            <label className="block text-sm font-medium mb-1">Hemmalag gula kort</label>
            <input 
              type="number" 
              name="homeYellowCards" 
              value={formData.homeYellowCards} 
              onChange={handleInputChange} 
              min="0" 
              className="w-full bg-gray-700 rounded p-2 text-white"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Bortalag gula kort</label>
            <input 
              type="number" 
              name="awayYellowCards" 
              value={formData.awayYellowCards} 
              onChange={handleInputChange} 
              min="0" 
              className="w-full bg-gray-700 rounded p-2 text-white"
            />
          </div>
          
          {/* Röda kort */}
          <div>
            <label className="block text-sm font-medium mb-1">Hemmalag röda kort</label>
            <input 
              type="number" 
              name="homeRedCards" 
              value={formData.homeRedCards} 
              onChange={handleInputChange} 
              min="0" 
              className="w-full bg-gray-700 rounded p-2 text-white"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">Bortalag röda kort</label>
            <input 
              type="number" 
              name="awayRedCards" 
              value={formData.awayRedCards} 
              onChange={handleInputChange} 
              min="0" 
              className="w-full bg-gray-700 rounded p-2 text-white"
            />
          </div>
          
          {/* Matchminut */}
          <div>
            <label className="block text-sm font-medium mb-1">Matchminut (0-120)</label>
            <input 
              type="number" 
              name="matchMinute" 
              value={formData.matchMinute} 
              onChange={handleInputChange} 
              min="0" 
              max="120" 
              className="w-full bg-gray-700 rounded p-2 text-white"
            />
          </div>
          
          {/* Hemma/borta-status */}
          <div>
            <label className="block text-sm font-medium mb-1">Spelplats</label>
            <select 
              name="venue" 
              value={formData.venue} 
              onChange={handleInputChange} 
              className="w-full bg-gray-700 rounded p-2 text-white"
            >
              <option value="home">Hemmaplan</option>
              <option value="away">Bortaplan</option>
            </select>
          </div>

          {/* Modell-läge */}
          <div>
            <label className="block text-sm font-medium mb-1">Modell-läge</label>
            <select 
              name="modelMode" 
              value={formData.modelMode} 
              onChange={handleInputChange} 
              className="w-full bg-gray-700 rounded p-2 text-white"
            >
              <option value="poisson">Poisson</option>
              <option value="heuristic">Heuristik</option>
            </select>
          </div>
        </div>
        
        <button 
          onClick={generatePredictions} 
          className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded mt-6 transition-transform hover:scale-105 active:scale-95"
        >
          Generera prediktioner
        </button>
      </motion.div>
      
      {/* Tolkningsguide */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="bg-gray-800 p-6 rounded-lg shadow-lg max-w-md w-full mb-8"
      >
        <h2 className="text-xl font-semibold mb-4">Kort tolkningsguide</h2>
        <div className="space-y-4 text-sm text-gray-200">
          <div>
            <h3 className="font-medium text-white">1) Tidigt rött kort (0–30’)</h3>
            <ul className="list-disc list-inside">
              <li>Lag med rött: deras lambda ska ned ~15–30%; motståndaren kan stiga något.</li>
              <li>1X2: favoritskifte eller tydlig försvagning för laget med rött.</li>
              <li>Nästa mål: gynnar laget utan rött; “inga mer mål” beror främst på total lambda och tid.</li>
            </ul>
          </div>
          <div>
            <h3 className="font-medium text-white">2) Sen 1–1 (80’+)</h3>
            <ul className="list-disc list-inside">
              <li>Oavgjort bör vara förhöjt (ofta 40–55% beroende på tempo).</li>
              <li>“Inga mer mål” ≈ exp(-totalLambda); kan vara betydande om tempot sjunkit.</li>
              <li>Toppresultat: 1–1 dominerar; 2–1/1–2 som nästa alternativ.</li>
            </ul>
          </div>
          <div>
            <h3 className="font-medium text-white">3) Tidig dominans utan mål (0–30’)</h3>
            <ul className="list-disc list-inside">
              <li>Hög SOT/hörnor för ett lag → högre lambda för det laget.</li>
              <li>1X2: moderat fördel (t.ex. 45–60%) till det dominerande laget.</li>
              <li>Nästa mål: lutar 55–70% mot det dominerande laget; “inga mer mål” relativt låg tidigt.</li>
            </ul>
          </div>
          <div>
            <h3 className="font-medium text-white">4) Målrik första halva</h3>
            <ul className="list-disc list-inside">
              <li>TotalLambda för återstoden bör vara måttlig (tempo avtar ofta efter paus).</li>
              <li>1X2: nära 50–50 om ställningen är jämn; annars följer favorit laget med övertag.</li>
              <li>Nästa mål: nära lambda-fördelning; “inga mer mål” styrs av återstående tid/tempo.</li>
            </ul>
          </div>
          <p className="text-gray-300">Snabbkoll: 1X2 ska summera till 1.0, “inga mer mål” ≈ exp(-(homeLambda+awayLambda)), och toppresultaten ska vara konsistenta med 1X2 och matchminut.</p>
        </div>
      </motion.div>
      
      {/* Resultatsektion */}
      {predictions && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="bg-gray-800 p-6 rounded-lg shadow-lg max-w-md w-full mb-8"
        >
          <h2 className="text-xl font-semibold mb-4">Prediktioner: {predictions.formData.homeTeam} vs {predictions.formData.awayTeam}</h2>
          
          <div className="mb-6">
            <h3 className="text-lg font-medium mb-2">Matchutfall (1X2)</h3>
            <motion.div 
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="h-64"
            >
              <Pie 
                data={{
                  labels: [
                    `${predictions.formData.homeTeam} vinst`, 
                    'Oavgjort', 
                    `${predictions.formData.awayTeam} vinst`
                  ],
                  datasets: [{
                    data: [
                      predictions.results.matchOutcome.homeWin,
                      predictions.results.matchOutcome.draw,
                      predictions.results.matchOutcome.awayWin
                    ],
                    backgroundColor: ['#34D399', '#60A5FA', '#F87171'],
                    borderWidth: 0
                  }]
                }}
                options={{
                  plugins: {
                    legend: {
                      position: 'bottom',
                      labels: {
                        color: 'white'
                      }
                    },
                    tooltip: {
                      callbacks: {
                        label: (context) => {
                          const value = context.raw;
                          return `${context.label}: ${(value * 100).toFixed(1)}%`;
                        }
                      }
                    }
                  }
                }}
              />
            </motion.div>
          </div>
          
          <div className="mb-6">
            <h3 className="text-lg font-medium mb-2">Förväntade mål</h3>
            <motion.div 
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="h-64"
            >
              <Bar 
                data={{
                  labels: ['0', '1', '2', '3', '4+'],
                  datasets: [
                    {
                      label: `${predictions.formData.homeTeam}`,
                      data: predictions.results.expectedGoals.home,
                      backgroundColor: '#34D399'
                    },
                    {
                      label: `${predictions.formData.awayTeam}`,
                      data: predictions.results.expectedGoals.away,
                      backgroundColor: '#F87171'
                    },
                    {
                      label: 'Totalt',
                      data: predictions.results.expectedGoals.total,
                      backgroundColor: '#60A5FA'
                    }
                  ]
                }}
                options={{
                  scales: {
                    y: {
                      beginAtZero: true,
                      max: 1,
                      ticks: {
                        callback: (value) => `${(value * 100).toFixed(0)}%`,
                        color: 'white'
                      },
                      grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                      }
                    },
                    x: {
                      ticks: {
                        color: 'white'
                      },
                      grid: {
                        color: 'rgba(255, 255, 255, 0.1)'
                      }
                    }
                  },
                  plugins: {
                    legend: {
                      position: 'bottom',
                      labels: {
                        color: 'white'
                      }
                    },
                    tooltip: {
                      callbacks: {
                        label: (context) => {
                          const value = context.raw;
                          return `${context.dataset.label}: ${(value * 100).toFixed(1)}%`;
                        }
                      }
                    }
                  }
                }}
              />
            </motion.div>
          </div>
          
          <div className="mb-6">
            <h3 className="text-lg font-medium mb-2">Över/Under-marknader</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-gray-700 p-3 rounded">
                <p className="font-medium">Över 2.5 mål</p>
                <p className="text-xl">{(predictions.results.overUnder.goals.over * 100).toFixed(1)}%</p>
              </div>
              <div className="bg-gray-700 p-3 rounded">
                <p className="font-medium">Under 2.5 mål</p>
                <p className="text-xl">{(predictions.results.overUnder.goals.under * 100).toFixed(1)}%</p>
              </div>
              <div className="bg-gray-700 p-3 rounded">
                <p className="font-medium">Över 8.5 hörnor</p>
                <p className="text-xl">{(predictions.results.overUnder.corners.over * 100).toFixed(1)}%</p>
              </div>
              <div className="bg-gray-700 p-3 rounded">
                <p className="font-medium">Under 8.5 hörnor</p>
                <p className="text-xl">{(predictions.results.overUnder.corners.under * 100).toFixed(1)}%</p>
              </div>
              <div className="bg-gray-700 p-3 rounded">
                <p className="font-medium">Över 4.5 kort</p>
                <p className="text-xl">{(predictions.results.overUnder.cards.over * 100).toFixed(1)}%</p>
              </div>
              <div className="bg-gray-700 p-3 rounded">
                <p className="font-medium">Under 4.5 kort</p>
                <p className="text-xl">{(predictions.results.overUnder.cards.under * 100).toFixed(1)}%</p>
              </div>
            </div>
          </div>
          
          <div className="mb-6">
            <h3 className="text-lg font-medium mb-2">Första målgörare (lag)</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-gray-700 p-3 rounded">
                <p className="font-medium">{predictions.formData.homeTeam}</p>
                <p className="text-xl">{(predictions.results.firstGoalScorer.home * 100).toFixed(1)}%</p>
              </div>
              <div className="bg-gray-700 p-3 rounded">
                <p className="font-medium">{predictions.formData.awayTeam}</p>
                <p className="text-xl">{(predictions.results.firstGoalScorer.away * 100).toFixed(1)}%</p>
              </div>
              <div className="bg-gray-700 p-3 rounded">
                <p className="font-medium">Inget mål</p>
                <p className="text-xl">{(predictions.results.firstGoalScorer.none * 100).toFixed(1)}%</p>
              </div>
            </div>
          </div>
          
          <div className="mb-6">
            <h3 className="text-lg font-medium mb-2">Topp 5 specifika resultat</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {predictions.results.specificResults.map((result, index) => (
                <motion.button
                  key={index}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="bg-gray-700 p-3 rounded text-center hover:bg-gray-600 transition-colors"
                  onClick={() => openModal(result)}
                >
                  <p className="font-medium">{result.result}</p>
                  <p className="text-lg">{(result.probability * 100).toFixed(1)}%</p>
                </motion.button>
              ))}
            </div>
          </div>
          
          <div className="mb-6">
            <h3 className="text-lg font-medium mb-2">Betting-tips</h3>
            {predictions.results.bettingTips.length > 0 ? (
              <ul className="list-disc pl-5 space-y-1">
                {predictions.results.bettingTips.map((tip, index) => (
                  <li key={index}>{tip}</li>
                ))}
              </ul>
            ) : (
              <p className="text-gray-400">Inga tydliga tips för denna match</p>
            )}
          </div>
          
          <div className="flex space-x-4">
            <button 
              onClick={exportPredictions} 
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition-transform hover:scale-105 active:scale-95"
            >
              Exportera JSON
            </button>
          </div>
        </motion.div>
      )}
      
      {/* Historiksektion */}
      {history.length > 0 && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="bg-gray-800 p-6 rounded-lg shadow-lg max-w-md w-full"
        >
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">Historik</h2>
            <button 
              onClick={clearHistory} 
              className="bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-3 rounded text-sm transition-transform hover:scale-105 active:scale-95"
            >
              Radera historik
            </button>
          </div>
          
          <div className="space-y-3">
            {history.map((item, index) => (
              <motion.div 
                key={item.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: index * 0.1 }}
                className="bg-gray-700 p-3 rounded cursor-pointer hover:bg-gray-600 transition-colors"
                onClick={() => loadPrediction(item)}
              >
                <p className="font-medium">{item.formData.homeTeam} vs {item.formData.awayTeam}</p>
                <p className="text-sm text-gray-400">{item.timestamp}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}
      
      {/* Modal för detaljerad information */}
      <AnimatePresence>
        {modalOpen && modalData && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
            onClick={closeModal}
          >
            <motion.div 
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.3 }}
              className="bg-gray-800 p-6 rounded-lg shadow-lg max-w-md w-full"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-semibold">Resultat {modalData.result}</h3>
                <button 
                  onClick={closeModal}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  Stäng
                </button>
              </div>
              
              <div className="mb-4">
                <p>Detta resultat har en sannolikhet på {(modalData.probability * 100).toFixed(1)}%.</p>
                <p className="mt-2">Beräkningen baseras på:</p>
                <ul className="list-disc pl-5 mt-1 space-y-1">
                  <li>{predictions.formData.homeTeam} gör {modalData.homeGoals} mål (Poisson-sannolikhet)</li>
                  <li>{predictions.formData.awayTeam} gör {modalData.awayGoals} mål (Poisson-sannolikhet)</li>
                  <li>Matchutfallssannolikheter (1X2) påverkar också detta resultat</li>
                </ul>
              </div>
              
              <div className="mb-4">
                <h4 className="font-medium mb-2">Bidragande faktorer</h4>
                <motion.div 
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.5 }}
                  className="h-48"
                >
                  <Bar 
                    data={{
                      labels: ['Bollinnehav', 'Skott', 'Hörnor', 'Kort'],
                      datasets: [
                        {
                          label: 'Bidrag till resultat',
                          data: [
                            predictions.formData.homePossession / 100 * 0.4,
                            predictions.formData.homeShotsOnTarget / (predictions.formData.homeShotsOnTarget + predictions.formData.awayShotsOnTarget || 1) * 0.3,
                            predictions.formData.homeCorners / (predictions.formData.homeCorners + predictions.formData.awayCorners || 1) * 0.2,
                            (1 - (predictions.formData.homeYellowCards + predictions.formData.homeRedCards * 2) / 
                              ((predictions.formData.homeYellowCards + predictions.formData.homeRedCards * 2) + 
                               (predictions.formData.awayYellowCards + predictions.formData.awayRedCards * 2) || 1)) * 0.1
                          ],
                          backgroundColor: ['#34D399', '#FBBF24', '#60A5FA', '#F87171']
                        }
                      ]
                    }}
                    options={{
                      scales: {
                        y: {
                          beginAtZero: true,
                          max: 0.5,
                          ticks: {
                            callback: (value) => `${(value * 100).toFixed(0)}%`,
                            color: 'white'
                          },
                          grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                          }
                        },
                        x: {
                          ticks: {
                            color: 'white'
                          },
                          grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                          }
                        }
                      },
                      plugins: {
                        legend: {
                          display: false
                        },
                        tooltip: {
                          callbacks: {
                            label: (context) => {
                              const value = context.raw;
                              return `Bidrag: ${(value * 100).toFixed(1)}%`;
                            }
                          }
                        }
                      }
                    }}
                  />
                </motion.div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default FootballPrediction;