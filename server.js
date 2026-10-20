const express = require("express");
const path = require("node:path");

// Create the Express app and choose where it listens for browser requests.
const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || "127.0.0.1";

// Main route: receive a city, get its weather, and return one JSON response.
app.get("/api/weather", async (req, res) => {
  // Read the city from a URL like /api/weather?city=Dublin.
  const city = typeof req.query.city === "string" ? req.query.city.trim() : "";
  const apiKey = process.env.OPENWEATHER_API_KEY;

  // Stop early if the browser did not send a usable city name.
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
    return res.json(await getWeatherForCity(city, apiKey));
  } catch (error) {
    return sendApiError(res, error, "the forecast");
  }
});

// Compare two cities. Repeated cities parameters allow country codes with commas:
// /api/compare?cities=Dublin%2C%20IE&cities=Lisbon%2C%20PT
// A simple comma-separated request such as ?cities=Dublin,Lisbon also works.
app.get("/api/compare", async (req, res) => {
  const cities = getRequestedCities(req.query.cities);
  const apiKey = process.env.OPENWEATHER_API_KEY;

  if (cities.length !== 2 || cities.some((city) => !city || city.length > 100)) {
    return res.status(400).json({
      error: "Enter two city names, for example Dublin and Lisbon."
    });
  }

  if (!apiKey) {
    return res.status(500).json({
      error: "The OpenWeather API key is missing. Add it to the .env file and restart the server."
    });
  }

  try {
    // Promise.all starts both city lookups together and waits for both results.
    const destinations = await Promise.all(
      cities.map((city) => getWeatherForCity(city, apiKey))
    );

    return res.json({
      destinations,
      comparison: makeCityComparison(destinations)
    });
  } catch (error) {
    return sendApiError(res, error, "the comparison");
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(port, host, () => {
  console.log("Weather planner running at http://localhost:" + port);
});

// The compare route accepts either two repeated values or two comma-separated names.
function getRequestedCities(value) {
  if (Array.isArray(value)) {
    return value.map((city) => String(city).trim());
  }
  if (typeof value === "string") {
    return value.split(",").map((city) => city.trim());
  }
  return [];
}

// Load the forecast and air quality for one city. Both routes reuse this function.
async function getWeatherForCity(city, apiKey) {
  const locationUrl = new URL("https://api.openweathermap.org/geo/1.0/direct");
  locationUrl.search = new URLSearchParams({ q: city, limit: "1", appid: apiKey });
  const matches = await getOpenWeatherJson(locationUrl);

  if (!Array.isArray(matches) || matches.length === 0) {
    throw createRequestError(
      404,
      "I couldn't find that city. Try adding its country code, for example Dublin, IE."
    );
  }

  const place = matches[0];
  const forecastUrl = new URL("https://api.openweathermap.org/data/2.5/forecast");
  forecastUrl.search = new URLSearchParams({
    lat: String(place.lat),
    lon: String(place.lon),
    units: "metric",
    appid: apiKey
  });
  const forecast = await getOpenWeatherJson(forecastUrl);
  const dailySummaries = makeDailySummaries(
    forecast.list || [],
    forecast.city.timezone || 0
  );
  const today = dailySummaries[0];
  const days = dailySummaries.slice(1, 4);

  if (!today || days.length === 0) {
    throw createRequestError(
      502,
      "OpenWeather returned no forecast readings for this city. Please try again."
    );
  }

  // Air quality is optional: if it fails, return the forecast with an unavailable message.
  let airQuality;
  try {
    const airUrl = new URL("https://api.openweathermap.org/data/2.5/air_pollution");
    airUrl.search = new URLSearchParams({
      lat: String(place.lat),
      lon: String(place.lon),
      appid: apiKey
    });
    const airResponse = await getOpenWeatherJson(airUrl);
    const currentReading = Array.isArray(airResponse.list) ? airResponse.list[0] : null;

    airQuality = currentReading
      ? makeAirQualitySummary(currentReading)
      : {
          available: false,
          message: "OpenWeather did not return a current air-quality reading for this city."
        };
  } catch (error) {
    airQuality = {
      available: false,
      message: messageForApiError(error, "air-quality data")
    };
  }

  return {
    city: {
      name: place.name,
      state: place.state || "",
      country: place.country || ""
    },
    today,
    days,
    packing: makePackingAdvice(days),
    airQuality,
    hasThreeDays: days.length === 3
  };
}

function createRequestError(status, clientMessage) {
  const error = new Error(clientMessage);
  error.status = status;
  error.clientMessage = clientMessage;
  return error;
}

function sendApiError(res, error, dataName) {
  const status = Number.isInteger(error.status) ? error.status : 502;
  const message = error.clientMessage || messageForApiError(error, dataName);
  return res.status(status).json({ error: message });
}

function formatCityName(city) {
  return [city.name, city.state, city.country].filter(Boolean).join(", ");
}

// Compare rain days first, then use the assignment's Mild category to break a tie.
function makeCityComparison(destinations) {
  const metrics = destinations.map((destination) => {
    const days = destination.days;
    const averageTemperature =
      days.reduce((total, day) => total + day.averageTemperature, 0) / days.length;

    return {
      averageTemperature,
      rainDays: days.filter((day) => day.rainExpected).length,
      mildDays: days.filter((day) => day.temperatureCategory === "Mild").length,
      aqi: destination.airQuality.available ? destination.airQuality.aqi : null
    };
  });

  let betterWeatherIndex = null;
  if (metrics[0].rainDays !== metrics[1].rainDays) {
    betterWeatherIndex = metrics[0].rainDays < metrics[1].rainDays ? 0 : 1;
  } else if (metrics[0].mildDays !== metrics[1].mildDays) {
    betterWeatherIndex = metrics[0].mildDays > metrics[1].mildDays ? 0 : 1;
  }

  const umbrellaCityIndexes = metrics
    .map((city, index) => (city.rainDays > 0 ? index : -1))
    .filter((index) => index !== -1);

  let worseAirIndex = null;
  if (metrics[0].aqi !== null && metrics[1].aqi !== null && metrics[0].aqi !== metrics[1].aqi) {
    worseAirIndex = metrics[0].aqi > metrics[1].aqi ? 0 : 1;
  }

  const cityNames = destinations.map((destination) => formatCityName(destination.city));
  const weatherVerdict =
    betterWeatherIndex === null
      ? "Neither forecast has a clear weather advantage"
      : cityNames[betterWeatherIndex] + " has the better forecast";
  let umbrellaVerdict;
  if (umbrellaCityIndexes.length === 0) {
    umbrellaVerdict = "Neither city is forecast to have rain";
  } else if (umbrellaCityIndexes.length === 2) {
    umbrellaVerdict = "Both cities may need an umbrella";
  } else {
    umbrellaVerdict = cityNames[umbrellaCityIndexes[0]] + " may need an umbrella";
  }

  let airVerdict;
  if (metrics[0].aqi === null || metrics[1].aqi === null) {
    airVerdict = "Air quality is unavailable for comparison";
  } else if (worseAirIndex === null) {
    airVerdict = "Both cities have the same AQI";
  } else {
    airVerdict = cityNames[worseAirIndex] + " has worse air quality";
  }

  const temperatureDifference = Math.abs(
    metrics[0].averageTemperature - metrics[1].averageTemperature
  );

  return {
    metrics,
    temperatureDifference,
    betterWeatherIndex,
    worseAirIndex,
    verdict: [weatherVerdict, umbrellaVerdict, airVerdict].join(". ") + "."
  };
}

async function getOpenWeatherJson(url) {
  let response;

  try {
    response = await fetch(url);
  } catch (error) {
    const networkError = new Error("Could not connect to OpenWeather.");
    networkError.isNetworkError = true;
    throw networkError;
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    data = {};
  }

  if (!response.ok) {
    const apiError = new Error("OpenWeather returned an error.");
    apiError.status = response.status;
    throw apiError;
  }

  return data;
}

// Turn technical API failures into short messages the page can display.
function messageForApiError(error, dataName) {
  if (error.isNetworkError) {
    return "I couldn't reach OpenWeather. Check your connection and try again.";
  }
  if (error.status === 401) {
    return "OpenWeather rejected the API key. Check that the key in .env is correct and active.";
  }
  if (error.status === 429) {
    return "OpenWeather has received too many requests. Please wait a little and try again.";
  }
  if (error.status >= 500) {
    return "OpenWeather is temporarily unavailable. Please try again shortly.";
  }
  return "I couldn't load " + dataName + " from OpenWeather. Please try again.";
}

// Combine all three-hour readings for each local calendar date into one daily summary.
function makeDailySummaries(readings, timezoneOffset) {
  const daysByDate = new Map();

  for (const reading of readings) {
    const date = new Date((reading.dt + timezoneOffset) * 1000)
      .toISOString()
      .slice(0, 10);
    if (!daysByDate.has(date)) {
      daysByDate.set(date, []);
    }
    daysByDate.get(date).push(reading);
  }

  return Array.from(daysByDate.entries()).map(([date, points]) => {
    const representativePoint = points[Math.floor(points.length / 2)];
    const condition = representativePoint.weather?.[0] || {};
    const temperatures = points.map((point) => point.main.temp);
    const lows = points.map((point) => point.main.temp_min ?? point.main.temp);
    const highs = points.map((point) => point.main.temp_max ?? point.main.temp);
    const windSpeeds = points.map((point) => point.wind.speed);
    const rainfall = points.reduce((total, point) => {
      return total + (point.rain && point.rain["3h"] ? point.rain["3h"] : 0);
    }, 0);
    const averageTemperature =
      temperatures.reduce((total, temperature) => total + temperature, 0) /
      temperatures.length;
    const averageWindSpeed =
      windSpeeds.reduce((total, speed) => total + speed, 0) / windSpeeds.length;
    const rainExpected = points.some((point) => {
      const mainWeather = point.weather?.[0]?.main;
      return (
        (point.rain && point.rain["3h"] > 0) ||
        mainWeather === "Rain" ||
        mainWeather === "Drizzle" ||
        mainWeather === "Thunderstorm"
      );
    });

    return {
      date,
      icon: condition.icon || "03d",
      conditionDescription: condition.description || "Cloudy",
      minTemperature: Math.min(...lows),
      maxTemperature: Math.max(...highs),
      averageTemperature,
      temperatureCategory: getTemperatureCategory(averageTemperature),
      averageWindSpeed,
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

// Choose clothing advice from the temperatures and rain in the next three days.
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
    temperatureAdvice,
    temperatureCategories: categories
  };
}

// Convert OpenWeather's air-quality data into a label and any pollutant warnings.
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

  const components = reading.components || {};
  const warnings = pollutants
    .filter((pollutant) => Number.isFinite(components[pollutant.key]))
    .filter((pollutant) => components[pollutant.key] >= pollutant.limits[0])
    .map((pollutant) => {
      const value = components[pollutant.key];
      const level = pollutant.limits.findIndex((limit) => value < limit);
      const categories = ["Fair", "Moderate", "Poor", "Very poor"];
      return {
        name: pollutant.name,
        value,
        category: level === -1 ? "Very poor" : categories[Math.max(0, level - 1)],
        healthRisk: pollutant.healthRisk
      };
    });
  const aqi = Math.round(reading.main?.aqi || 0);

  return {
    available: true,
    aqi,
    aqiLabel: aqiLabels[aqi] || "Unknown",
    warnings
  };
}
