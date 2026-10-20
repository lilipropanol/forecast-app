# Daymark Weather Planner

A small Vue and Express app for Internet Applications Assignment 1. It looks up a city, summarizes the next three local forecast days, gives simple packing advice and checks current air pollution.

## Run it

This project uses Node.js 22 or later.

1. Install the server dependency with npm install.
2. Put your OpenWeather API key in a local file named .env:

       OPENWEATHER_API_KEY=your_key_here

   A local .env file is ignored by Git. The key is read by the Express server and is not sent to the browser.
3. Start the app with npm start.
4. Open http://localhost:3000.

Vue is loaded from a CDN, so the browser needs an internet connection on first load.

## Structure

- server.js serves the page and provides GET /api/weather?city=...
- public/index.html contains the page structure and Vue directives.
- public/app.js sends a same-origin Fetch request and displays the returned JSON.
- public/style.css holds the responsive layout and visual styles.

The server uses OpenWeather Geocoding to find coordinates, then requests the five-day/three-hour forecast and current air-pollution reading. It keeps the first local forecast day for the sidebar and shows the following three local forecast days in the table.
