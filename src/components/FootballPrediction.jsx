import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement } from 'chart.js';
import { Pie, Bar } from 'react-chartjs-2';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement);

const FootballPrediction = () => {
  const [formData, setFormData] = useState({
    homeTeam: '',
    awayTeam: '',
    homePossession: 50,
    awayPossession: 50,
    homeShotsOnTarget: 0,
    awayShotsOnTarget: 0,
    homeShotsOffTarget: 0,
    awayShotsOffTarget: 0,
    homeCorners: 0,
    awayCorners: 0,
    homeYellowCards: 0,
    awayYellowCards: 0,
    homeRedCards: 0,
    awayRedCards: 0,
    homeGoals: 0,
    awayGoals: 0,
    matchMinute: 0,
    venue: 'home',
    modelMode: 'poisson'
  });

  const [predictions, setPredictions] = useState(null);
  const [history, setHistory] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalData, setModalData] = useState(null);

  useEffect(() => {
    const savedHistory = localStorage.getItem('footballPredictionHistory');
    if (savedHistory) {
      setHistory(JSON.parse(savedHistory));
    }
  }, []);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    
    if (name === 'homePossession') {
      setFormData(prev => ({
        ...prev,
        homePossession: parseInt(value) || 0,
        awayPossession: 100 - (parseInt(value) || 0)
      }));
    } else if (name === 'awayPossession') {
      setFormData(prev => ({
        ...prev,
        awayPossession: parseInt(value) || 0,
        homePossession: 100 - (parseInt(value) || 0)
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: name.includes('Team') || name === 'venue' || name === 'modelMode' ? value : (parseInt(value) || 0)
      }));
    }
  };

  const poissonProbability = (lambda, k) => {
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
  };

  const factorial = (n) => {
    if (n <= 1) return 1;
    let result = 1;
    for (let i = 2; i <= n; i++) {
      result *= i;
    }
    return result;
  };

  const generatePredictions = () => {
    const timeRemaining = (120 - formData.matchMinute) / 90;
    const adjustmentFactor = Math.max(0.1, timeRemaining);
    
    let homeLambda = 1.4;
    let awayLambda = 1.2;

    if (formData.venue === 'home') {
      homeLambda *= 1.1;
    } else {
      awayLambda *= 1.1;
    }

    const homeAttackStrength = (formData.homeShotsOnTarget + formData.homeShotsOffTarget * 0.3) * 0.15 +
                               formData.homeCorners * 0.05 +
                               (formData.homePossession / 100) * 0.5;
    
    const awayAttackStrength = (formData.awayShotsOnTarget + formData.awayShotsOffTarget * 0.3) * 0.15 +
                               formData.awayCorners * 0.05 +
                               (formData.awayPossession / 100) * 0.5;

    homeLambda += homeAttackStrength;
    awayLambda += awayAttackStrength;

    if (formData.homeRedCards > 0) {
      homeLambda *= Math.pow(0.8, formData.homeRedCards);
    }
    if (formData.awayRedCards > 0) {
      awayLambda *= Math.pow(0.8, formData.awayRedCards);
    }

    homeLambda *= adjustmentFactor;
    awayLambda *= adjustmentFactor;

    const homeGoalProbs = [];
    const awayGoalProbs = [];
    const totalGoalProbs = [];

    for (let i = 0; i <= 4; i++) {
      homeGoalProbs.push(i === 4 ? 
        1 - homeGoalProbs.reduce((sum, prob) => sum + prob, 0) : 
        poissonProbability(homeLambda, i)
      );
      awayGoalProbs.push(i === 4 ? 
        1 - awayGoalProbs.reduce((sum, prob) => sum + prob, 0) : 
        poissonProbability(awayLambda, i)
      );
    }

    for (let i = 0; i <= 4; i++) {
      let totalProb = 0;
      for (let h = 0; h <= 4; h++) {
        for (let a = 0; a <= 4; a++) {
          if (h + a === i) {
            totalProb += homeGoalProbs[h] * awayGoalProbs[a];
          }
        }
      }
      totalGoalProbs.push(totalProb);
    }

    let homeWin = 0;
    let draw = 0;
    let awayWin = 0;

    for (let h = 0; h <= 4; h++) {
      for (let a = 0; a <= 4; a++) {
        const prob = homeGoalProbs[h] * awayGoalProbs[a];
        const adjustedHomeGoals = h + formData.homeGoals;
        const adjustedAwayGoals = a + formData.awayGoals;
        
        if (adjustedHomeGoals > adjustedAwayGoals) {
          homeWin += prob;
        } else if (adjustedHomeGoals === adjustedAwayGoals) {
          draw += prob;
        } else {
          awayWin += prob;
        }
      }
    }

    const total = homeWin + draw + awayWin;
    homeWin /= total;
    draw /= total;
    awayWin /= total;

    const specificResults = [];
    for (let h = 0; h <= 3; h++) {
      for (let a = 0; a <= 3; a++) {
        const prob = homeGoalProbs[h] * awayGoalProbs[a];
        specificResults.push({
          result: `${h + formData.homeGoals}-${a + formData.awayGoals}`,
          probability: prob,
          homeGoals: h + formData.homeGoals,
          awayGoals: a + formData.awayGoals
        });
      }
    }

    specificResults.sort((a, b) => b.probability - a.probability);

    const over25Goals = totalGoalProbs[3] + totalGoalProbs[4];
    const under25Goals = 1 - over25Goals;

    const totalCorners = formData.homeCorners + formData.awayCorners;
    const remainingCornerRate = Math.max(2, 8 - totalCorners) * adjustmentFactor;
    const over85Corners = remainingCornerRate > 1.5 ? 0.6 : 0.35;

    const totalCards = formData.homeYellowCards + formData.awayYellowCards + 
                      (formData.homeRedCards + formData.awayRedCards) * 2;
    const over45Cards = totalCards > 2 ? 0.7 : 0.4;

    const firstGoalHome = homeLambda / (homeLambda + awayLambda + 0.2);
    const firstGoalAway = awayLambda / (homeLambda + awayLambda + 0.2);
    const noMoreGoals = 0.2 / (homeLambda + awayLambda + 0.2);

    const bettingTips = [];
    if (over25Goals > 0.6) {
      bettingTips.push("Över 2.5 mål ser troligt ut");
    }
    if (homeWin > 0.5) {
      bettingTips.push(`${formData.homeTeam} har god chans att vinna`);
    }
    if (draw > 0.35) {
      bettingTips.push("Oavgjort är ett starkt alternativ");
    }

    const result = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      formData: { ...formData },
      results: {
        matchOutcome: { homeWin, draw, awayWin },
        expectedGoals: {
          home: homeGoalProbs,
          away: awayGoalProbs,
          total: totalGoalProbs
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
        bettingTips
      },
      timestamp: new Date().toLocaleString('sv-SE')
    };

    setPredictions(result);

    const newHistory = [result, ...history.slice(0, 9)];
    setHistory(newHistory);
    localStorage.setItem('footballPredictionHistory', JSON.stringify(newHistory));
  };

  const openModal = (result) => {
    setModalData(result);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setModalData(null);
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem('footballPredictionHistory');
  };

  const exportPredictions = () => {
    if (predictions) {
      const dataStr = JSON.stringify(predictions, null, 2);
      const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
      const exportFileDefaultName = `predictions_${formData.homeTeam}_vs_${formData.awayTeam}_${Date.now()}.json`;
      
      const linkElement = document.createElement('a');
      linkElement.setAttribute('href', dataUri);
      linkElement.setAttribute('download', exportFileDefaultName);
      linkElement.click();
    }
  };

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
      
      {/* Inmatningsformulär + Generella scenarier */}
      <div className="w-full max-w-7xl flex flex-col xl:flex-row gap-6 mb-8">
        {/* Inmatningsformulär */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="bg-gray-800 p-6 rounded-lg shadow-lg max-w-md w-full"
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
        
        {/* Generella scenarier */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="bg-gray-800 p-6 rounded-lg shadow-lg max-w-md w-full"
        >
          <h2 className="text-xl font-semibold mb-4">Fördelaktiga scenarier</h2>
          <div className="space-y-4">
            <div className="bg-gray-700 p-4 rounded-lg">
              <h3 className="font-medium text-green-400 mb-2">Över 2.5 mål</h3>
              <p className="text-sm text-gray-300">Båda lagen har hög offensiv kapacitet och svag defensiv. Tidig målproduktion tyder på öppet spel.</p>
            </div>
            
            <div className="bg-gray-700 p-4 rounded-lg">
              <h3 className="font-medium text-blue-400 mb-2">Båda lagen gör mål</h3>
              <p className="text-sm text-gray-300">Jämn match med bra anfallsspel från båda sidor. Inga extrema defensive strukturer.</p>
            </div>
            
            <div className="bg-gray-700 p-4 rounded-lg">
              <h3 className="font-medium text-yellow-400 mb-2">Under 2.5 mål</h3>
              <p className="text-sm text-gray-300">Lågt tempo, stark defensiv från båda lag eller tidigt ledande lag som låser matchen.</p>
            </div>
            
            <div className="bg-gray-700 p-4 rounded-lg">
              <h3 className="font-medium text-purple-400 mb-2">Oavgjort</h3>
              <p className="text-sm text-gray-300">Jämna styrkeförhållanden, defensivt spel eller sen utjämning som begränsar tiden för fler mål.</p>
            </div>

            {/* Nya scenarier */}
            <div className="bg-gray-700 p-4 rounded-lg">
              <h3 className="font-medium text-orange-400 mb-2">Favorit vinner med marginal</h3>
              <p className="text-sm text-gray-300">Ett lag är tydligt starkare och kontrollerar matchbilden. Passar spel som -1 (handikapp) eller vinst med minst två mål.</p>
            </div>

            <div className="bg-gray-700 p-4 rounded-lg">
              <h3 className="font-medium text-cyan-400 mb-2">Många hörnor</h3>
              <p className="text-sm text-gray-300">Högt tryck och många inlägg/skott som styrs ut. Offensiva ytterzoner och flera fasta situationer.</p>
            </div>

            <div className="bg-gray-700 p-4 rounded-lg">
              <h3 className="font-medium text-pink-400 mb-2">Få kort</h3>
              <p className="text-sm text-gray-300">Lågintensivt spel med färre dueller och avbrott. Domare med låg benägenhet att varna gynnar underspel på kort.</p>
            </div>
          </div>
        </motion.div>
      </div>
      
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
                  key={result.result}
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
                  <li key={`${tip}-${index}`}>{tip}</li>
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
                key={item.id || `${item.formData?.homeTeam}-${item.formData?.awayTeam}-${item.timestamp}-${index}`}
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
      
      {/* Versionsstämpel */}
      <div className="text-center text-xs text-gray-500 mt-4">
        v{new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC
      </div>
      
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
