# Livebet calculator

Publik demo: https://thille6.github.io/Livebet-calculator/

Snabbstart lokalt:
- Installera: `npm install`
- Utvecklingsläge: `npm run dev` (öppnas på http://localhost:5173/)
- Bygg: `npm run build`
- Förhandsgranska build: `npm run preview`

GitHub Pages (Project Pages) är konfigurerat via Vite base: `/Livebet-calculator/`.
Om du ändrar repo-namn, uppdatera `vite.config.js` base accordingly.

## Funktioner

- Formulär för inmatning av matchdata (lag, bollinnehav, skott, hörnor, kort, matchminut)
- Prediktionsberäkningar för matchutfall (1X2), förväntade mål, över/under-marknader, specifika resultat och första målgörare
- Visualisering av resultat med cirkel- och stapeldiagram
- Interaktiva funktioner som modal med minidiagram för att förklara specifika resultat
- Historik och export av prediktioner
- Responsiv design med mörkt tema och animationer

## Installation

1. Klona detta repository
2. Installera beroenden med `npm install`
3. Starta utvecklingsservern med `npm run dev`

## Teknologier

- React
- Tailwind CSS för styling
- Chart.js för diagram
- Framer Motion för animationer
- Vite som byggverktyg

## Användning

1. Fyll i matchdata i formuläret
2. Klicka på "Generera prediktioner"
3. Utforska resultaten i diagrammen och textresultaten
4. Klicka på specifika resultat för att se detaljerad information
5. Exportera prediktioner som JSON-fil
6. Titta på historik över tidigare prediktioner