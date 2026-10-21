// This is a small version of server.js, just to show the request flow.
// Run it with: node --env-file=.env server-first-iteration.js

// Express lets us make routes for the browser to call.
const express = require("express");

const app = express();

// Node reads the key from .env when the server starts.
// The browser does not get the key.
const apiKey = process.env.OPENWEATHER_API_KEY;

// Use a different port so this can run alongside server.js.
const port = 3001;

// Try http://localhost:3001/api/weather?city=Dublin
// req is the request; res is how we send the reply.
// async lets this function wait for OpenWeather with await.
app.get("/api/weather", async (req, res) => {
    // The city is in the URL, after ?city=.
    const city = req.query.city;

    // Look up the city's coordinates first.
    const locationUrl = new URL("https://api.openweathermap.org/geo/1.0/direct");

    // These are added after the ? in the URL.
    // q is the city, limit asks for one match, appid is the key.
    locationUrl.search = new URLSearchParams({
        q: city,
        limit: "1",
        appid: apiKey
    });

    // fetch sends the request and .json() reads the reply.
    const locationResponse = await fetch(locationUrl);
    const locations = await locationResponse.json();

    // Geocoding returns a list. We asked for one result, so use the first one.
    const location = locations[0];

    // The forecast request needs the latitude and longitude.
    const forecastUrl = new URL("https://api.openweathermap.org/data/2.5/forecast");

    // units=metric gives temperatures in Celsius.
    forecastUrl.search = new URLSearchParams({
        lat: location.lat,
        lon: location.lon,
        units: "metric",
        appid: apiKey
    });

    const forecastResponse = await fetch(forecastUrl);
    const forecastData = await forecastResponse.json();

    // The list has readings every three hours. Keep only what the page needs.
    const readings = forecastData.list.map((reading) => ({
        // dt_txt is the time, main.temp is the temperature, and description is the weather.
        time: reading.dt_txt,
        temperature: reading.main.temp,
        description: reading.weather[0].description
    }));

    // Send the shorter version back to the browser.
    res.json({
        city: location.name,
        readings
    });
});

// Start the server so it can receive requests.
app.listen(port, () => {
    console.log("Simple example server running at http://localhost:" + port);
});
