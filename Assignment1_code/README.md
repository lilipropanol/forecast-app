# Weather Planner

A small Vue and Express app for Internet Applications Assignment 1. It looks up a city, summarizes the next three local forecast days, gives simple packing advice, checks air quality and shows current weather on a map.

## Run it

This project uses Node.js 22 or later.

1. Install the server dependency with `npm install`.
2. Put your OpenWeather API key and Mapbox public token in a local file named `.env`:

       OPENWEATHER_API_KEY=your_openweather_key_here
       MAPBOX_ACCESS_TOKEN=your_mapbox_public_token_here

   A local `.env` file is ignored by Git. The OpenWeather key stays on the server. The Mapbox public token is sent to the browser at runtime because Mapbox needs it to load the map.
3. Start the app with `npm start`.
4. Open http://localhost:3000.

Vue, Mapbox GL JS and Swagger UI load from CDNs, so the browser needs an internet connection. Restrict the Mapbox public token to your site in the Mapbox account settings.

## API documentation

Start the server and open http://localhost:3000/api-docs.html to view and try the API routes in Swagger UI. The OpenAPI description is in `public/openapi.json`.

## Structure

- `server.js` serves the page and provides `GET /api/weather?city=...`, `GET /api/weather-at?lat=...&lon=...` and the weather map tile route.
- `public/index.html` contains the page structure and Vue directives.
- `public/app.js` sends a same-origin Fetch request, displays the returned JSON and creates the map.
- `public/style.css` holds the responsive layout and visual styles.
- `public/openapi.json` describes the API routes and their responses.
- `public/api-docs.html` displays the API documentation in Swagger UI.

The server uses OpenWeather Geocoding to find coordinates, then requests current weather, the five-day/three-hour forecast and current air-pollution data. It keeps the first local forecast day for the sidebar and shows the following three local forecast days in the table. Clicking the map requests the same weather data for that point. The map uses Mapbox Standard as its base, with OpenWeather temperature and precipitation layers that can be turned on or off. Express proxies those tile requests so the OpenWeather key is not exposed in the browser.
