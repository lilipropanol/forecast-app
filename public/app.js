const app = Vue.createApp({
  data() {
    return {
      city: "",
      result: null,
      error: "",
      loading: false
    };
  },
  computed: {
    cityLabel() {
      if (!this.result) {
        return "";
      }

      return [this.result.city.name, this.result.city.state, this.result.city.country]
        .filter(Boolean)
        .join(", ");
    }
  },
  methods: {
    async searchWeather() {
      const searchCity = this.city.trim();
      if (!searchCity || this.loading) {
        return;
      }

      this.loading = true;
      this.error = "";
      this.result = null;

      try {
        const response = await fetch("/api/weather?city=" + encodeURIComponent(searchCity));
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "The weather request failed. Please try again.");
        }
        this.result = data;
      } catch (requestError) {
        this.error =
          requestError.message ||
          "I couldn't reach the weather server. Check your connection and try again.";
      } finally {
        this.loading = false;
      }
    },
    formatDate(dateString) {
      const date = new Date(dateString + "T12:00:00Z");
      return new Intl.DateTimeFormat("en-IE", {
        weekday: "long",
        day: "numeric",
        month: "short",
        timeZone: "UTC"
      }).format(date);
    },
    weatherIcon(iconCode) {
      const code = String(iconCode || "");
      const group = code.slice(0, 2);
      const night = code.endsWith("n");

      if (group === "01") return night ? "moon" : "sun";
      if (group === "02" || group === "03") {
        return night ? "partly-cloudy-night" : "partly-cloudy-day";
      }
      if (group === "04") return "cloud";
      if (group === "09" || group === "10") return "rain";
      if (group === "11") return "storm";
      if (group === "13") return "snow";
      if (group === "50") return "mist";
      return "cloud";
    },
    formatNumber(value) {
      if (!Number.isFinite(value)) {
        return "—";
      }
      const cleanValue = Math.abs(value) < 0.05 ? 0 : value;
      return new Intl.NumberFormat("en-IE", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 1
      }).format(cleanValue);
    },
    formatTemperature(value) {
      if (!Number.isFinite(value)) {
        return "—°C";
      }
      const cleanValue = Math.abs(value) < 0.05 ? 0 : value;
      return (
        new Intl.NumberFormat("en-IE", { maximumFractionDigits: 1 }).format(cleanValue) +
        "°C"
      );
    },
    formatRainfall(value) {
      if (!Number.isFinite(value)) {
        return "—";
      }
      if (value === 0) {
        return "0";
      }
      if (value < 0.05) {
        return "<0.1";
      }
      return this.formatNumber(value);
    }
  }
});

app.mount("#app");
