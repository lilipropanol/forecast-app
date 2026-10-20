# Weather Planner

CSU44000 Internet Applications – Assignment 1
Liliana Berenguer Jin

---

## 1. Requirements

Weather Planner is a small reactive Internet Application for people about to travel. The user types a destination city and the app answers the questions you would ask before packing:

- **What is the weather going to be?** A table of the next three days with temperature, wind speed and rainfall.
- **Do I need an umbrella?** Yes if rain is forecast on any of those days.
- **What kind of clothes?** Cold, Mild or Hot, using the thresholds from the assignment (below 8 °C, 8–24 °C, above 24 °C).
- **Is the air safe?** A warning for each pollutant above OpenWeather's "Good" level, with how elevated it is and the associated health risk.
- **Which of two places is better?** The extra feature: a second city can be entered and both forecasts are shown side by side with a verdict.

The client is a Vue 3 page in the browser and the server is a Node.js / Express application that exposes a REST endpoint and does all the work: it calls the OpenWeather APIs, turns their raw responses into the answers above, and returns them as a single JSON object for the page to display.

To decide how to structure the project, I went through the requirements and worked out which OpenWeather API would provide the data for each one. Table 1 is the result. The one thing settled before that was *where* the API calls would be made. The assignment says they belong on the server, and the reason is the browser's same-origin policy: a page served from `localhost:3000` cannot `fetch` from `api.openweathermap.org`. Making the calls from the server also keeps the API key out of the browser, where anyone could read it from the page source.

**Table 1 – Core requirements and the OpenWeather API used for each**

| Requirement | OpenWeather API | What it provides |
|---|---|---|
| City name → location | Geocoding (`/geo/1.0/direct`) | Latitude and longitude |
| Three-day forecast (temperature, wind, rain) | 5-day / 3-hour Forecast (`/data/2.5/forecast`) | Around 40 readings at three-hour intervals |
| Umbrella and Cold / Mild / Hot advice | Forecast (same response) | Rain and temperature per reading |
| Pollutant warnings | Air Pollution (`/data/2.5/air_pollution`) | AQI (1–5) and the concentration of each pollutant |
| Compare two cities (extra) | All of the above, twice | Two summaries plus a comparison |

The table also fixed the order of the server's requests: Geocoding has to come first, because the other two APIs take coordinates rather than a city name.

---

## 2. System architecture

```mermaid
flowchart LR
    subgraph Browser
        V["Vue 3 app<br/>reactive state → template"]
    end
    subgraph Server["Node 22 + Express"]
        S["express.static<br/>/public"]
        W["GET /api/weather"]
        C["GET /api/compare"]
        K[(".env<br/>API key")]
    end
    subgraph OW["OpenWeather"]
        G["Geocoding"]
        F["Forecast"]
        A["Air Pollution"]
    end
    V -- "HTML, JS, CSS" --- S
    V -- "fetch, JSON<br/>same origin" --> W
    V -- "fetch, JSON<br/>same origin" --> C
    W --> G --> F --> A
    C -- "×2 in parallel" --> G
    K -.-> W
    K -.-> C
```

**Figure 1 – System architecture**

The relevant points of this design are:

- **Express has two responsibilities.** It serves the static files (`index.html`, `app.js`, CSS) from `/public` through `express.static`, and it exposes two routes, `/api/weather` and `/api/compare`, that call OpenWeather and reply with JSON.
- **Same origin.** The page and the API are served from the same host and port, so the client's `fetch` calls need no CORS configuration.
- **Stateless `GET` endpoints.** Both routes are safe and idempotent: repeating a request changes nothing and returns the same result. There are no sessions and no database, and each request carries everything it needs in the URL. I chose this for simplicity, but it also meant the API could be tested directly from the browser's address bar.
- **Thin client.** The server returns an already-processed object (`today`, `days`, `packing`, `airQuality`) and the client only renders it. The business rules live in one place and are never exposed to the browser.
- **Minimal stack.** Node 22, Express 4 and Vue 3 from a CDN. Node 22 provides `fetch` natively and loads `.env` with `--env-file`, so Express is the project's only dependency.

---

## 3. Design process

I built the server in three iterations, which I found useful because it separated three different questions: can I retrieve data from OpenWeather at all, what should be done with it, and what breaks once real cities are involved. The client took two.

### 3.1 Server

**Iteration 1 – retrieving the data.** The first version only fetched and returned. It reads the city from the query string, calls Geocoding, takes the first match, calls Forecast with its `lat` and `lon`, and returns the raw readings. There was no validation and no error handling, around eighty lines in total. The goal of this step was twofold:

- Get `async/await` working with two calls that depend on each other. `fetch` runs outside the JavaScript engine as a Web API, and `await` hands control back to the event loop until the reply arrives. Node is single-threaded, but the server is never blocked while waiting on OpenWeather.
- See what the data actually looks like. This is where I noticed that timestamps are in UTC, that `rain["3h"]` is only present when it rained, and that the forecast includes a `city.timezone` offset.

**Iteration 2 – processing the data.** This iteration delivered the core features:

- Readings are grouped into days, and for each day the server computes min, max and average temperature, average wind speed, total rainfall and whether rain is expected.
- The Cold / Mild / Hot thresholds from the brief are applied to each day's average. If the three days fall into different categories the advice becomes "pack layers". The umbrella flag is set if any day expects rain.
- The Air Pollution call was added. Each pollutant is compared with the upper limit of OpenWeather's "Good" band, and anything above it is reported with its band and a short health risk.
- Input validation and proper HTTP status codes (Table 2). A small `getOpenWeatherJson` helper wraps `fetch` and throws an error carrying a status when the network fails or OpenWeather replies with an error, which keeps the route handler readable.

**Table 2 – Responses from `GET /api/weather`**

| Status | Condition |
|---|---|
| 200 | Success: `city`, `today`, `days[3]`, `packing`, `airQuality` |
| 400 | City missing or over 100 characters |
| 404 | Geocoding returns no match |
| 500 | API key missing from `.env` |
| 502 | OpenWeather unreachable, returned an error, or returned too little data |

**Iteration 3 – refining.** Testing with more cities and at different times of day exposed three problems, each of which changed the code:

- *The first day was wrong.* Searching in the evening produced a "day" with one or two readings, and for Tokyo the grouping landed on the wrong date because I was grouping by UTC. Each reading is now shifted by `city.timezone` before its date is taken, the current partial day is shown separately as "today", and the table shows the next three full local days.
- *One failing API took down the page.* When Air Pollution returned an error, the forecast was lost as well. That call now sits in its own `try/catch` and returns `{ available: false }` on failure, so the forecast still renders with a note.
- *The route handler had grown too large.* Everything lived inside one `app.get`. I moved the lookup into `getWeatherForCity(city)`, which throws errors tagged with a status and a message that the route simply passes on. This refactor is what made the comparison feature cheap to add.

```mermaid
sequenceDiagram
    actor U as User
    participant C as Vue client
    participant S as Express
    participant O as OpenWeather
    U->>C: submit city
    C->>C: loading = true
    C->>S: GET /api/weather?city=Dublin
    S->>S: validate query
    S->>O: GET /geo/1.0/direct
    O-->>S: [{ lat, lon, name, country }]
    S->>O: GET /data/2.5/forecast
    O-->>S: { list[40], city.timezone }
    S->>S: makeDailySummaries, makePackingAdvice
    S->>O: GET /data/2.5/air_pollution
    alt success
        O-->>S: { list[0].components }
        S->>S: makeAirQualitySummary
    else failure
        S->>S: airQuality = { available: false }
    end
    S-->>C: 200 { city, today, days, packing, airQuality }
    C->>C: result = data, loading = false
    C-->>U: template re-renders
```

**Figure 2 – Sequence of one search against the final server**

### 3.2 Client

**Iteration 1 – rendering the JSON.** One input, one button and the raw response in a `<pre>` element: `v-model` on the input, a method calling `fetch`, and `{{ result }}` in the template. Its only purpose was to prove the round trip.

**Iteration 2 – a state-driven interface.** The final client keeps that skeleton, but the whole page is derived from a handful of reactive variables: `city`, `loading`, `result` and `error`. The template declares what each state looks like and Vue updates the DOM when the variables change; I never manipulate the DOM directly. This is the MVVM split that Vue is built around: the template is the view, the Vue instance with its data, computed properties and methods is the view-model, and the server's JSON is the model. Compared with the `XMLHttpRequest` approach of locating an element and setting its `innerHTML`, it removes an entire category of bugs where the page and the data disagree.

**Table 3 – Vue features used in the client**

| Feature | Used for |
|---|---|
| `v-model.trim` | Two-way binding on both city inputs |
| `@submit.prevent` | Running the search without a page reload |
| `:disabled` | Blocking buttons while a request is in flight |
| `v-if` / `v-else-if` / `v-else` | Loading, error, empty and result panels |
| `v-for` with `:key` | Forecast rows, pollutant warnings, comparison cards |
| `:class` | Colour badges for Cold / Mild / Hot, umbrella, AQI, "better forecast" |
| `{{ }}` | All text output |
| `computed` | `cityLabel` from city, state and country |
| `methods` | Fetch calls and formatting helpers |

`searchWeather` calls `fetch` inside `try / catch / finally`, so `loading` is always reset. A shared `readJsonResponse` helper parses the reply and throws the server's error message when the status is not OK, so the search and the comparison handle failures identically, each showing the message with a Retry button.

For the layout, today's summary sits on the left and the forecast table, packing advice and air quality on the right. Weather icons come from an SVG sprite mapped from OpenWeather's icon codes, and on narrow screens the table collapses into stacked cards.

**Figure 3 – Result view for Dublin** *(screenshot)*

### 3.3 Iteration 3 – comparing two destinations

Once a city is loaded, the user can enter a second one and see both forecasts side by side with a short verdict: which has the better weather, which needs an umbrella, and which has worse air. I chose this feature because deciding between places is the real reason someone would open the app, and it required non-trivial work on both sides.

- **Server.** A second route, `GET /api/compare?cities=A&cities=B`. It accepts repeated parameters so that names with country codes ("Dublin, IE") are not split on the comma. It runs `getWeatherForCity` for both cities with `Promise.all`, so the two lookups proceed concurrently rather than one after the other. `makeCityComparison` then ranks them: fewer rainy days wins, more Mild days breaks a tie, and the worse AQI is flagged. The verdict text is composed on the server so the wording stays consistent.
- **Client.** A second form bound to `comparisonCity`, with its own `comparing` and `comparisonError` state so it never interferes with the main search, and a `v-for` over the two results rendering a card each, with the winner highlighted through `:class`.

**Figure 4 – Dublin compared with Lisbon** *(screenshot)*

---

## 4. Testing, limitations and future work

I tested manually against a checklist: a known city (Dublin, IE), an ambiguous one (Paris vs Paris, US), a made-up city, a missing API key, the Air Pollution URL deliberately broken, Tokyo for the local-date grouping, and a comparison with one invalid city to confirm the 404 is reported cleanly. Because the API is stateless, I could also exercise the server on its own from the address bar.

Known limitations: only the first Geocoding match is used, air quality is the current reading rather than a forecast, and the comparison ranking is a simple heuristic. The natural next steps are deploying the server on AWS so the app no longer has to run locally, and caching OpenWeather responses for a few minutes, since a comparison currently costs six upstream calls.

What I mainly took from this assignment is that most of the work in an application like this happens on the server, reshaping someone else's data into exactly what the page needs, and that the client becomes much simpler once the UI is a function of its state.

---

**Appendix A – Source code** · **Appendix B – Academic integrity declaration**
