# Daymark: a reactive weather and packing planner

**CSU44000 Internet Applications – Assignment 1 technical report**
Liliana Berenguer Jin · October 2026

---

## 1. Requirements

### 1.1 What the app is for

The idea is simple: you are about to travel somewhere, you type the city, and the app tells you what to pack. It shows the next three days of weather, says whether you need an umbrella, tells you whether to pack for cold, mild or hot weather, and warns you if the air quality there is bad. That is the brief, and I kept the product exactly that size on purpose. The interesting part of the assignment is not the feature list but *how* the pieces talk to each other, so I wanted the pieces to be small enough that the design is visible.

### 1.2 Core requirements and where the data comes from

My first job was to map every requirement in the brief to something OpenWeather actually provides, because that decides what the server has to compute and what the client only has to display. Table 1 is the result of that exercise, after reading the OpenWeather documentation and playing with the endpoints in the browser.

**Table 1 – Core requirements and the OpenWeather API used for each**

| Requirement | OpenWeather API | What it gives us |
|---|---|---|
| City name → location | Geocoding (`/geo/1.0/direct`) | Latitude and longitude of the city |
| Three-day forecast (temperature, wind, rain) | 5-day / 3-hour Forecast (`/data/2.5/forecast`) | About 40 readings, one every three hours, that the server groups into days |
| Umbrella and Cold / Mild / Hot advice | Forecast (same response) | Rain and temperature per reading, turned into daily rules on the server |
| Pollutant warnings with health risk | Air Pollution (`/data/2.5/air_pollution`) | AQI (1–5) and concentrations of SO₂, NO₂, PM₁₀, PM₂.₅, O₃ and CO |

Two things became clear from the table. The Geocoding call has to come first because the other two need its coordinates, and three of the four rows come out of a single Forecast response, so one request can feed most of the page. Both of these shaped the server design in Section 3.

### 1.3 What the app deliberately does not do

Borrowing the "NOT list" idea from requirements engineering, I wrote down what was out of scope so I would not drift: no user accounts, no database, no saved searches, no hourly view. Every request is independent, which, as it turned out, is exactly the statelessness that REST asks for (Section 2).

---

## 2. System architecture

**Figure 1 – System architecture.** *Block diagram with three boxes. Left: the browser, containing the Vue app (reactive state → template). Middle: the Express server, split into "static files from `/public`" and the single route `GET /api/weather`. Right: OpenWeather, with its three endpoints. A double arrow between browser and server labelled "same origin, JSON over HTTP"; three numbered arrows from the server to OpenWeather labelled Geocoding, Forecast, Air Pollution; a padlock on the server box labelled "`.env` API key".*

The architecture is the client–server model from the very first HTTP lecture, with one decision that drives everything else: the browser never talks to OpenWeather. The Vue lecture pointed out that `fetch` is subject to the same-origin policy, so a page served from `localhost:3000` cannot simply call `api.openweathermap.org`. Even if it could, the API key would be visible in the browser's developer tools. So the server became a small proxy that does all three calls and hands the client a single, already-digested JSON object. In the formative quiz about "server side or client side", this is the "proprietary control" answer: the key and the business rules stay where I control them.

The server follows the Express pattern from W2L2 almost line for line: `express.static` serves `index.html`, `app.js` and the CSS from `/public`, and one `app.get` route reads `req.query.city` and answers with `res.json`. Because both the page and the API live on the same origin, there is no CORS configuration at all, which I was pleasantly surprised by after expecting that to be a headache.

In REST terms (W3L2) the endpoint is a resource identified by its URI, read with `GET`, so it is safe and idempotent: asking for Dublin twice gives the same answer and changes nothing on the server. It is stateless in Fielding's sense, each request carries everything it needs. I found it reassuring that the "no database, no sessions" choice I made for simplicity was also the textbook-correct one.

Technology-wise the stack is deliberately minimal: Node.js 22, Express 4, and Vue 3 loaded from a CDN as the Vue slides show, with no build step. Node 22 ships `fetch` natively and reads `.env` with `--env-file`, so Express is the only dependency in `package.json`.

---

## 3. Server design

The server went through two clear iterations, both kept in the repository as `server-first-iteration.js` and `server.js`.

### 3.1 First iteration: just see the data

The first version does the minimum: read the city from the query string, build the Geocoding URL with `URLSearchParams`, `await` the reply, take the first match, build the Forecast URL from its `lat` and `lon`, `await` again, and return the forty readings as `{ time, temperature, description }`. Eighty lines, no error handling.

What I wanted from this step was to feel the asynchronous model from W3L1 in practice. `fetch` is a Web API that lives outside the JavaScript engine; `await` hands control back to the event loop while the request is in flight, and the handler is resumed from the message queue when the reply arrives. So even though Node is single-threaded, the server is never blocked waiting for OpenWeather. Writing it with `async/await` instead of `.then()` chains made the two dependent calls read top to bottom, which the slides describe as the whole point of the syntax.

### 3.2 What the raw data taught me

Looking at the raw readings exposed a problem I had not expected. OpenWeather's timestamps are in UTC and the first "day" is almost always partial (whatever is left of today). Grouping by UTC date gives the wrong first day for a city like Tokyo. The brief says "the next three days", so I decided that the current partial day belongs in the sidebar as "today" and the table shows the next three *full* local days. Doing this properly means shifting each reading by the `city.timezone` offset before taking the date.

**Figure 2 – Sequence diagram for a search.** *UML sequence with four lifelines: User, Vue client, Express server, OpenWeather. User submits the form → client sets `loading = true` and calls `fetch('/api/weather?city=…')` → server validates the input → Geocoding request and response → Forecast request and response → Air Pollution request and response inside an `alt` frame (success / fallback message) → server `res.json(...)` → client sets `result`, Vue re-renders the template.*

### 3.3 Second iteration: business logic and resilience

The final `server.js` keeps the same three-call chain and adds everything the brief asks for.

- **Daily summaries.** `makeDailySummaries` groups readings by local date and computes min, max and average temperature, average wind, total rainfall from `rain.3h`, and a `rainExpected` flag that is true if any reading has rain or a weather type of Rain, Drizzle or Thunderstorm.
- **Packing rules.** The Cold / Mild / Hot thresholds are applied to each day's average. If the three days fall into different categories the advice becomes "pack layers", which felt more honest than picking one. The umbrella flag is set if any day expects rain.
- **Air quality.** Each pollutant is compared with the upper limit of OpenWeather's "Good" band; anything above it is reported with its band (Fair to Very poor) and a one-line health risk.
- **Error handling.** The HTTP lecture lists status code classes, and I used them properly: 400 for a missing city, 404 when Geocoding finds nothing, 502 when OpenWeather cannot be reached, and OpenWeather's own 401 and 429 passed through. A small `getOpenWeatherJson` wrapper turns every failure into an error with a status, so the route handler stays readable. The air-pollution call sits in its own `try/catch`: if that API fails the user still gets the forecast with a note, rather than a blank page.

**Table 2 – Responses from `GET /api/weather`**

| Status | When | What the client shows |
|---|---|---|
| 200 | Success | `city`, `today`, `days[3]`, `packing`, `airQuality` |
| 400 | City missing or over 100 characters | "Enter a city name, optionally followed by a country code." |
| 404 | No Geocoding match | "I couldn't find that city. Try adding its country code…" |
| 401 / 429 | Passed through from OpenWeather | Bad API key / too many requests |
| 502 | Network failure or empty forecast | "I couldn't reach OpenWeather…" |

Using the right codes paid off on the client side: a single `if (!response.ok)` handles every failure the same way.

---

## 4. Client design

The slides describe reactive frameworks as borrowing the spreadsheet idea, dependencies are tracked and the page updates itself. That is exactly how the client is built. There is one Vue instance created with `createApp` using the Options API, and only four reactive variables in `data()`: `city`, `loading`, `result` and `error`. The whole interface is a function of those four. I never touch the DOM; I describe what the page should look like in each state and Vue's virtual DOM works out what to re-render. Coming from the AJAX / `XMLHttpRequest` history in W1L2, where every update meant finding an element and setting its `innerHTML`, this was the part of the module that genuinely changed how I think about front ends.

**Table 3 – Vue features used in the client**

| Feature | Used for |
|---|---|
| `v-model.trim` | Two-way binding of the city input |
| `@submit.prevent` | Run `searchWeather()` without a page reload |
| `:disabled` | Block the Search button while `loading` |
| `v-if` / `v-else-if` / `v-else` | Switch between loading, error, empty and result panels; the three air-quality states |
| `v-for` with `:key` | Forecast rows and the pollutant warning list |
| `:class` | Colour badges for Cold / Mild / Hot, umbrella advice, AQI indicator |
| `{{ }}` mustache syntax | All text output |
| `computed` | `cityLabel`, joining city, state and country |
| `methods` | `searchWeather` and the formatting helpers |

`searchWeather` is an `async` method that calls the Fetch API inside `try / catch / finally`, so `loading` is always reset whatever happens. A non-OK response surfaces the server's `error` message in a panel with a Retry button.

For the visual side I wanted it to look like a weather app rather than a form. There is a two-panel layout, today on the left and the forecast table with packing and air-quality cards on the right, an SVG icon sprite mapped from OpenWeather's icon codes, and colour-coded badges. On narrow screens the table collapses into stacked cards. **Figure 3** *(screenshot of the result view for Dublin)* shows the final interface.

---

## 5. Innovative feature

*To be written once implemented. Planned structure: what it does in one sentence, why a traveller wants it, what changed on the server, what changed on the client, and a screenshot.*

---

## 6. Testing and reflection

I tested by hand with a short checklist: a known city (Dublin, IE), an ambiguous one (Paris vs Paris, US), a made-up city, a deliberately missing API key, and the air-pollution URL broken on purpose to check the forecast still renders. I also used Tokyo to confirm the local-date grouping, and tried the API directly in the browser, which the stateless design makes trivial.

Two limitations I am aware of: only the first Geocoding match is used, and the air-quality reading is current rather than forecast. Given more time I would deploy the server on AWS, which the recent lectures covered, so the app does not need to run locally.

The biggest things I take from this assignment are how much simpler a UI becomes when state drives rendering instead of the other way round, and how much of an Internet application is really about reshaping someone else's data into exactly what your client needs.

---

**Appendix A – Source code** · **Appendix B – Academic integrity declaration**
