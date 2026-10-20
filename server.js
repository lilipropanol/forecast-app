const express = require("express");
const path = require("node:path");

const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || "127.0.0.1";

app.get("/api/weather", async (req, res) => {
  const city = typeof req.query.city === "string" ? req.query.city.trim() : "";
  const apiKey = process.env.OPENWEATHER_API_KEY;

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
    const locationUrl = new URL("https://api.openweathermap.org/geo/1.0/direct");
    locationUrl.search = new URLSearchParams({ q: city, limit: "1", appid: apiKey });
    const matches = await getOpenWeatherJson(locationUrl);

    if (!Array.isArray(matches) || matches.length === 0) {
      return res.status(404).json({
        error: "I couldn't find that city. Try adding its country code, for example Dublin, IE."
      });
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
    const days = makeThreeDaySummary(forecast.list || [], forecast.city.timezone || 0);

    if (days.length === 0) {
      return res.status(502).json({
        error: "OpenWeather returned no forecast readings for this city. Please try again."
      });
    }

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

    return res.json({
      city: {
        name: place.name,
        state: place.state || "",
        country: place.country || ""
      },
      days,
      packing: makePackingAdvice(days),
      airQuality,
      hasThreeDays: days.length === 3
    });
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 502;
    return res.status(status).json({
      error: messageForApiError(error, "the forecast")
    });
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(port, host, () => {
  console.log("Weather planner running at http://localhost:" + port);
});

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

function makeThreeDaySummary(readings, timezoneOffset) {
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

  return Array.from(daysByDate.entries())
    .slice(0, 3)
    .map(([date, points]) => {
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
