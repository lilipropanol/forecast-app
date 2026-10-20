const express = require("express");
const path = require("node:path");

const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || "127.0.0.1";
const apiKey = process.env.OPENWEATHER_API_KEY;

// Search one city and send its weather data back as JSON.
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

// The browser sends two "cities" values, one for each place.
app.get("/api/compare", async (req, res) => {
  const cities = getRequestedCities(req.query.cities);

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
    // Start both lookups together and wait for both results.
    const destinations = await Promise.all(
      cities.map((city) => getWeatherForCity(city))
    );

    return res.json({
      destinations,
      comparison: makeCityComparison(destinations)
    });
  } catch (error) {
    return res.status(error.status || 502).json({ error: error.message });
  }
});

app.use(express.static(path.join(__dirname, "public")));

// Repeated values keep commas in names like "Dublin, IE" together.
function getRequestedCities(value) {
  if (Array.isArray(value)) {
    return value.map((city) => String(city).trim());
  }
  if (typeof value === "string") {
    return value.split(",").map((city) => city.trim());
  }
  return [];
}

// Both routes use the same function to get a city's forecast.
async function getWeatherForCity(city) {
  const locationUrl = new URL("https://api.openweathermap.org/geo/1.0/direct");
  locationUrl.search = new URLSearchParams({ q: city, limit: "1", appid: apiKey });
  const places = await getOpenWeatherJson(locationUrl);

  if (!places.length) {
    const error = new Error("City not found. Try adding its country code.");
    error.status = 404;
    throw error;
  }

  const place = places[0];
  const forecastUrl = new URL("https://api.openweathermap.org/data/2.5/forecast");
  forecastUrl.search = new URLSearchParams({
    lat: String(place.lat),
    lon: String(place.lon),
    units: "metric",
    appid: apiKey
  });
  const forecast = await getOpenWeatherJson(forecastUrl);
  const summaries = makeDailySummaries(
    forecast.list,
    forecast.city.timezone || 0
  );
  const today = summaries[0];
  const days = summaries.slice(1, 4);

  if (!today || !days.length) {
    const error = new Error("OpenWeather did not return enough forecast data.");
    error.status = 502;
    throw error;
  }

  // The forecast is still useful if the separate air-quality request fails.
  let airQuality;
  try {
    const airUrl = new URL("https://api.openweathermap.org/data/2.5/air_pollution");
    airUrl.search = new URLSearchParams({
      lat: String(place.lat),
      lon: String(place.lon),
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

function formatCityName(city) {
  return [city.name, city.state, city.country].filter(Boolean).join(", ");
}

// Fewer rainy days wins; if tied, more Mild days wins.
function makeCityComparison(destinations) {
  const metrics = destinations.map((destination) => {
    const days = destination.days;
    return {
      averageTemperature:
        days.reduce((total, day) => total + day.averageTemperature, 0) / days.length,
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

  let worseAirIndex = null;
  if (
    metrics[0].aqi !== null &&
    metrics[1].aqi !== null &&
    metrics[0].aqi !== metrics[1].aqi
  ) {
    worseAirIndex = metrics[0].aqi > metrics[1].aqi ? 0 : 1;
  }

  const names = destinations.map((destination) => formatCityName(destination.city));
  const weatherVerdict = betterWeatherIndex === null
    ? "Neither forecast has a clear weather advantage"
    : names[betterWeatherIndex] + " has the better forecast";

  let umbrellaVerdict;
  if (metrics[0].rainDays && metrics[1].rainDays) {
    umbrellaVerdict = "Both cities may need an umbrella";
  } else if (metrics[0].rainDays) {
    umbrellaVerdict = names[0] + " may need an umbrella";
  } else if (metrics[1].rainDays) {
    umbrellaVerdict = names[1] + " may need an umbrella";
  } else {
    umbrellaVerdict = "Neither city is forecast to have rain";
  }

  let airVerdict;
  if (metrics[0].aqi === null || metrics[1].aqi === null) {
    airVerdict = "Air quality is unavailable for comparison";
  } else if (worseAirIndex === null) {
    airVerdict = "Both cities have the same AQI";
  } else {
    airVerdict = names[worseAirIndex] + " has worse air quality";
  }

  return {
    metrics,
    temperatureDifference: Math.abs(
      metrics[0].averageTemperature - metrics[1].averageTemperature
    ),
    betterWeatherIndex,
    worseAirIndex,
    verdict: [weatherVerdict, umbrellaVerdict, airVerdict].join(". ") + "."
  };
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

// OpenWeather sends readings every three hours, so combine them by local date.
function makeDailySummaries(readings, timezoneOffset) {
  const daysByDate = new Map();

  for (const reading of readings || []) {
    const date = new Date((reading.dt + timezoneOffset) * 1000)
      .toISOString()
      .slice(0, 10);
    if (!daysByDate.has(date)) daysByDate.set(date, []);
    daysByDate.get(date).push(reading);
  }

  return Array.from(daysByDate, ([date, points]) => {
    const middle = points[Math.floor(points.length / 2)];
    const condition = middle.weather[0];
    const temperatures = points.map((point) => point.main.temp);
    const lows = points.map((point) => point.main.temp_min ?? point.main.temp);
    const highs = points.map((point) => point.main.temp_max ?? point.main.temp);
    const average = (values) =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    const rainfall = points.reduce(
      (total, point) => total + (point.rain?.["3h"] || 0),
      0
    );
    const rainExpected = points.some((point) => {
      const weather = point.weather[0].main;
      return (
        (point.rain?.["3h"] || 0) > 0 ||
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
      averageWindSpeed: average(points.map((point) => point.wind.speed)),
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

    const level = pollutant.limits.findIndex((limit) => value < limit);
    const categories = ["Fair", "Moderate", "Poor", "Very poor"];
    warnings.push({
      name: pollutant.name,
      value,
      category: level === -1 ? "Very poor" : categories[Math.max(0, level - 1)],
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
