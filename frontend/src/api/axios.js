import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:3000/api",
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
  },
});

// ---- Request interceptor: attach auth token ----
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ---- Response interceptor: unwrap data + handle errors globally ----
api.interceptors.response.use(
  (response) => response.data, // no more res.data.data everywhere
  async (error) => {
    const { response } = error;

    if (!response) {
      // network error / server down / CORS
      console.error("Network error:", error.message);
      return Promise.reject({ message: "Network error, please try again." });
    }

    const { status, data } = response;

    switch (status) {
      case 401:
        // token expired/invalid — clear and redirect to login
        localStorage.removeItem("token");
        window.location.href = "/login";
        break;
      case 403:
        console.error("Forbidden:", data?.message);
        break;
      case 404:
        console.error("Not found:", data?.message);
        break;
      case 422:
        console.error("Validation error:", data?.errors);
        break;
      case 429:
        const retryAfter = response.headers["retry-after"];
        console.warn(`Rate limited. Retry after ${retryAfter || "some time"}s`);
        // optional: auto-retry once after the delay
        break;
      case 500:
        console.error("Server error:", data?.message);
        break;
      default:
        console.error("API error:", data?.message || error.message);
    }

    return Promise.reject(data || error);
  }
);

export default api;