// A small learning example, separate from the app's full server.js.
// Run it with: node --env-file=.env server-first-iteration.js

// Express lets us make a web server and add routes such as /api/weather.
const express = require("express");

const app = express();

// Node reads this value from .env when we use the run command above.
// The key is sent from this server to OpenWeather; the browser never sees it.
const apiKey = process.env.OPENWEATHER_API_KEY;

// This example uses port 3001 so it can be separate from the main app on 3000.
const port = 3001;

// The browser can request this route with, for example:
// http://localhost:3001/api/weather?city=Dublin
// req is the incoming request; res is how this route sends a response back.
// async lets us use await while waiting for OpenWeather's replies.
app.get("/api/weather", async (req, res) => {
  // Read "Dublin" from the ?city=Dublin part of the request URL.
  const city = req.query.city;

  // First, ask the Geocoding API to turn the city name into coordinates.
  // new URL creates a URL object that we can add query parameters to.
  const locationUrl = new URL("https://api.openweathermap.org/geo/1.0/direct");

  // URLSearchParams builds the part after the question mark in the URL.
  // q is the place to search for, limit asks for one match, and appid is the key.
  // The finished URL is roughly: .../direct?q=Dublin&limit=1&appid=YOUR_KEY
  locationUrl.search = new URLSearchParams({
    q: city,
    limit: "1",
    appid: apiKey
  });

  // fetch sends the request; .json() turns OpenWeather's JSON reply into JS data.
  const locationResponse = await fetch(locationUrl);
  const locations = await locationResponse.json();

  // The Geocoding API returns an array of matching places.
  // Each place can include name, lat, lon, country, and sometimes state.
  // limit=1 means we use the first match in that array.
  const location = locations[0];

  // Then build a second URL for the forecast, this time using the coordinates.
  const forecastUrl = new URL("https://api.openweathermap.org/data/2.5/forecast");

  // lat and lon tell OpenWeather which place; units=metric asks for Celsius.
  // search works the same way here: it adds these values after the URL's ?.
  forecastUrl.search = new URLSearchParams({
    lat: location.lat,
    lon: location.lon,
    units: "metric",
    appid: apiKey
  });

  const forecastResponse = await fetch(forecastUrl);
  const forecastData = await forecastResponse.json();

  // forecastData.list is an array of forecast readings, one every three hours.
  // map goes through that array and makes a simpler object for each reading.
  const readings = forecastData.list.map((reading) => ({
    // dt_txt is the date and time; main.temp is the temperature in Celsius.
    // weather[0].description is a short phrase such as "light rain".
    time: reading.dt_txt,
    temperature: reading.main.temp,
    description: reading.weather[0].description
  }));

  // Send a smaller JSON response back to the browser.
  // res.json converts this JavaScript object to JSON for the HTTP response.
  res.json({
    city: location.name,
    readings
  });
});

// Start listening for requests. The callback runs once the server is ready.
app.listen(port, () => {
  console.log("Simple example server running at http://localhost:" + port);
});
