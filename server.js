const express = require("express");
const path = require("node:path");

const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || "127.0.0.1";
const apiKey = process.env.OPENWEATHER_API_KEY;
const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN || "";

// The browser needs this public token to load the Mapbox map.
app.get("/api/config", (req, res) => {
    res.json({ mapboxToken });
});

// The browser calls this route with a city name.
app.get("/api/weather", async (req, res) => {
    const city = typeof req.query.city === "string" ? req.query.city.trim() : "";

    if (!city || city.length > 100) {
        return res.status(400).json({
            error: "Enter a city name, optionally followed by a country code."
        });
    }

    if (!apiKey) {
        return res.status(500).json({
            error: "The OpenWeather API key is missing. Add it to the .env file and restart the server."
        });
    }

    try {
        return res.json(await getWeatherForCity(city));
    } catch (error) {
        return res.status(error.status || 502).json({ error: error.message });
    }
});

// The map calls this route when someone clicks a point.
app.get("/api/weather-at", async (req, res) => {
    const latitude = typeof req.query.lat === "string" ? req.query.lat.trim() : "";
    const longitude = typeof req.query.lon === "string" ? req.query.lon.trim() : "";
    const lat = latitude ? Number(latitude) : NaN;
    const lon = longitude ? Number(longitude) : NaN;

    if (
        !Number.isFinite(lat) || !Number.isFinite(lon) ||
        lat < -90 || lat > 90 || lon < -180 || lon > 180
    ) {
        return res.status(400).json({ error: "Choose a valid point on the map." });
    }

    if (!apiKey) {
        return res.status(500).json({
            error: "The OpenWeather API key is missing. Add it to the .env file and restart the server."
        });
    }

    try {
        const location = await getLocationForCoordinates(lat, lon);
        return res.json(await getWeatherForCoordinates(lat, lon, location));
    } catch (error) {
        return res.status(error.status || 502).json({ error: error.message });
    }
});

// Mapbox asks our server for each visible weather tile.
app.get("/api/weather-map/:layer/:z/:x/:y.png", async (req, res) => {
    const layer = req.params.layer;
    const zoom = Number(req.params.z);
    const tileX = Number(req.params.x);
    const tileY = Number(req.params.y);
    const tilesAtZoom = 2 ** zoom;

    if (
        !["precipitation_new", "temp_new"].includes(layer) ||
        ![zoom, tileX, tileY].every(Number.isInteger) ||
        zoom < 0 || zoom > 18 ||
        tileX < 0 || tileY < 0 ||
        tileX >= tilesAtZoom || tileY >= tilesAtZoom
    ) {
        return res.sendStatus(400);
    }

    if (!apiKey) {
        return res.sendStatus(500);
    }

    const tileUrl = new URL(
        `https://tile.openweathermap.org/map/${layer}/${zoom}/${tileX}/${tileY}.png`
    );
    tileUrl.search = new URLSearchParams({ appid: apiKey });

    try {
        const tileResponse = await fetch(tileUrl);
        if (!tileResponse.ok) {
            return res.sendStatus(tileResponse.status);
        }

        // Keep the image in memory and pass it back to Mapbox.
        const image = Buffer.from(await tileResponse.arrayBuffer());
        return res.type("png").send(image);
    } catch {
        return res.sendStatus(502);
    }
});

app.use(express.static(path.join(__dirname, "public")));

// A city name must be converted to coordinates before requesting its forecast.
async function getWeatherForCity(city) {
    // The forecast API needs coordinates, so look up the city first.
    const locationUrl = new URL("https://api.openweathermap.org/geo/1.0/direct");
    locationUrl.search = new URLSearchParams({ q: city, limit: "1", appid: apiKey });
    const locations = await getOpenWeatherJson(locationUrl);

    if (!locations.length) {
        const error = new Error("City not found. Try adding its country code.");
        error.status = 404;
        throw error;
    }

    const location = locations[0];
    return getWeatherForCoordinates(location.lat, location.lon, location);
}

// City searches and map pins use the same forecast steps here.
async function getWeatherForCoordinates(lat, lon, location) {
    const currentUrl = new URL("https://api.openweathermap.org/data/2.5/weather");
    currentUrl.search = new URLSearchParams({
        lat: String(lat),
        lon: String(lon),
        units: "metric",
        appid: apiKey
    });
    const forecastUrl = new URL("https://api.openweathermap.org/data/2.5/forecast");
    forecastUrl.search = new URLSearchParams({
        lat: String(lat),
        lon: String(lon),
        units: "metric",
        appid: apiKey
    });
    // Both requests use the same coordinates, so start them together.
    const [current, forecast] = await Promise.all([
        getOpenWeatherJson(currentUrl),
        getOpenWeatherJson(forecastUrl)
    ]);
    const timezoneOffset = forecast.city.timezone || 0;
    // Make daily summaries, then keep today separate from the next three days.
    const dailySummaries = makeDailySummaries(
        forecast.list,
        timezoneOffset
    );
    const today = dailySummaries[0];
    const days = dailySummaries.slice(1, 4);

    if (!today || !days.length) {
        const error = new Error("OpenWeather did not return enough forecast data.");
        error.status = 502;
        throw error;
    }

    // Air quality is separate, so the forecast can still load if this fails.
    let airQuality;
    try {
        const airUrl = new URL("https://api.openweathermap.org/data/2.5/air_pollution");
        airUrl.search = new URLSearchParams({
            lat: String(lat),
            lon: String(lon),
            appid: apiKey
        });
        const airData = await getOpenWeatherJson(airUrl);
        airQuality = makeAirQualitySummary(airData.list[0]);
    } catch {
        airQuality = {
            available: false,
            message: "Air-quality data is unavailable."
        };
    }

    return {
        city: {
            name: location.name,
            state: location.state || "",
            country: location.country || ""
        },
        coordinates: {
            lat,
            lon
        },
        currentWeather: {
            temperature: current.main.temp,
            conditionDescription: current.weather[0].description,
            icon: current.weather[0].icon
        },
        mapSummary: makeMapSummary(forecast.list, timezoneOffset),
        today,
        days,
        packing: makePackingAdvice(days),
        airQuality,
        hasThreeDays: days.length === 3
    };
}

// Find the next forecast period with a good chance of rain for the map card.
function makeMapSummary(readings, timezoneOffset) {
    const now = Math.floor(Date.now() / 1000);
    const nextThreeDays = (readings || []).filter(
        (reading) => reading.dt >= now && reading.dt <= now + 3 * 24 * 60 * 60
    );
    // Only call it likely when the forecast gives it at least a 50% chance.
    const nextRain = nextThreeDays.find((reading) => (reading.pop || 0) >= 0.5);

    return {
        timezoneOffset,
        nextRain: nextRain
            ? {
                time: nextRain.dt,
                chance: Math.round((nextRain.pop || 0) * 100)
            }
            : null
    };
}

// Reverse geocoding is only used for the place name shown beside the pin.
async function getLocationForCoordinates(lat, lon) {
    try {
        const locationUrl = new URL("https://api.openweathermap.org/geo/1.0/reverse");
        locationUrl.search = new URLSearchParams({
            lat: String(lat),
            lon: String(lon),
            limit: "1",
            appid: apiKey
        });
        const locations = await getOpenWeatherJson(locationUrl);
        if (locations.length) return locations[0];
    } catch {
        // A nearby place name is helpful, but the coordinates are enough for a forecast.
    }

    return { name: "Pinned location", state: "", country: "" };
}

async function getOpenWeatherJson(url) {
    let response;
    try {
        response = await fetch(url);
    } catch {
        const networkError = new Error("Could not connect to OpenWeather.");
        networkError.status = 502;
        throw networkError;
    }

    // Convert OpenWeather's JSON response into a JavaScript object.
    const data = await response.json();
    if (!response.ok) {
        const error = new Error(
            "OpenWeather request failed with status " + response.status + "."
        );
        error.status = response.status;
        throw error;
    }
    return data;
}

// The forecast has readings every three hours, so group them by local date.
function makeDailySummaries(readings, timezoneOffset) {
    const daysByDate = new Map();

    for (const reading of readings || []) {
        const date = new Date((reading.dt + timezoneOffset) * 1000)
            .toISOString()
            .slice(0, 10);
        if (!daysByDate.has(date)) daysByDate.set(date, []);
        daysByDate.get(date).push(reading);
    }

    return Array.from(daysByDate, ([date, dayReadings]) => {
        const middleReading = dayReadings[Math.floor(dayReadings.length / 2)];
        const condition = middleReading.weather[0];
        const temperatures = dayReadings.map((reading) => reading.main.temp);
        const lows = dayReadings.map((reading) => reading.main.temp_min ?? reading.main.temp);
        const highs = dayReadings.map((reading) => reading.main.temp_max ?? reading.main.temp);
        const average = (values) =>
            values.reduce((sum, value) => sum + value, 0) / values.length;
        const rainfall = dayReadings.reduce(
            (total, reading) => total + (reading.rain?.["3h"] || 0),
            0
        );
        const rainExpected = dayReadings.some((reading) => {
            const weather = reading.weather[0].main;
            return (
                (reading.rain?.["3h"] || 0) > 0 ||
                ["Rain", "Drizzle", "Thunderstorm"].includes(weather)
            );
        });
        const averageTemperature = average(temperatures);

        return {
            date,
            icon: condition.icon,
            conditionDescription: condition.description,
            minTemperature: Math.min(...lows),
            maxTemperature: Math.max(...highs),
            averageTemperature,
            temperatureCategory: getTemperatureCategory(averageTemperature),
            averageWindSpeed: average(dayReadings.map((reading) => reading.wind.speed)),
            rainfall,
            rainExpected
        };
    });
}

function getTemperatureCategory(temperature) {
    if (temperature < 8) return "Cold";
    if (temperature <= 24) return "Mild";
    return "Hot";
}

function makePackingAdvice(days) {
    const categories = [...new Set(days.map((day) => day.temperatureCategory))];
    let temperatureAdvice;

    if (categories.length > 1) {
        temperatureAdvice =
            "Pack layers. The daily average moves between " + categories.join(" and ") + ".";
    } else if (categories[0] === "Cold") {
        temperatureAdvice = "Pack a warm coat. The daily average is below 8°C.";
    } else if (categories[0] === "Hot") {
        temperatureAdvice = "Pack for warm weather. The daily average is above 24°C.";
    } else {
        temperatureAdvice = "A light layer should be enough for mild temperatures.";
    }

    const umbrellaNeeded = days.some((day) => day.rainExpected);
    return {
        umbrellaNeeded,
        umbrellaAdvice: umbrellaNeeded
            ? "Rain is forecast. Bring an umbrella."
            : "No rain is forecast in these three days.",
        temperatureAdvice
    };
}

function makeAirQualitySummary(reading) {
    const aqiLabels = ["", "Good", "Fair", "Moderate", "Poor", "Very poor"];
    const pollutants = [
        {
            key: "so2",
            name: "Sulphur dioxide (SO₂)",
            limits: [20, 80, 250, 350],
            healthRisk: "Can irritate airways and may worsen asthma symptoms."
        },
        {
            key: "no2",
            name: "Nitrogen dioxide (NO₂)",
            limits: [40, 70, 150, 200],
            healthRisk: "Can irritate airways and worsen respiratory symptoms."
        },
        {
            key: "pm10",
            name: "Particulate matter (PM₁₀)",
            limits: [20, 50, 100, 200],
            healthRisk: "Can affect the lungs and aggravate heart or lung conditions."
        },
        {
            key: "pm2_5",
            name: "Fine particulate matter (PM₂.₅)",
            limits: [10, 25, 50, 75],
            healthRisk: "Fine particles can enter the lungs and aggravate heart or lung conditions."
        },
        {
            key: "o3",
            name: "Ozone (O₃)",
            limits: [60, 100, 140, 180],
            healthRisk: "Can irritate the lungs and make breathing harder."
        },
        {
            key: "co",
            name: "Carbon monoxide (CO)",
            limits: [4400, 9400, 12400, 15400],
            healthRisk: "At high exposure, it can reduce the oxygen carried through the body."
        }
    ];

    const warnings = [];
    for (const pollutant of pollutants) {
        const value = reading.components[pollutant.key];
        if (!Number.isFinite(value) || value < pollutant.limits[0]) continue;

        const limitIndex = pollutant.limits.findIndex((limit) => value < limit);
        const categories = ["Fair", "Moderate", "Poor", "Very poor"];
        warnings.push({
            name: pollutant.name,
            value,
            category: limitIndex === -1 ? "Very poor" : categories[Math.max(0, limitIndex - 1)],
            healthRisk: pollutant.healthRisk
        });
    }

    const aqi = reading.main.aqi;
    return {
        available: true,
        aqi,
        aqiLabel: aqiLabels[aqi] || "Unknown",
        warnings
    };
}

app.listen(port, host, () => {
    console.log("Weather planner running at http://localhost:" + port);
});
