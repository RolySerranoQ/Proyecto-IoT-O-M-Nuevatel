import { useEffect, useMemo, useState } from "react";
import "./App.css";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  AreaChart,
  Area,
} from "recharts";

const API_URL = import.meta.env.VITE_API_URL;

const FILTERS = {
  minute: { label: "Último minuto", ms: 60 * 1000 },
  hour: { label: "Última hora", ms: 60 * 60 * 1000 },
  day: { label: "Último día", ms: 24 * 60 * 60 * 1000 },
};

const METRICS = [
  { key: "temperatura", title: "Temperatura", unit: "°C", color: "#ff8a65" },
  { key: "humedad", title: "Humedad", unit: "%", color: "#4fc3f7" },
  { key: "radiacion_uv", title: "Radiación UV", unit: "mW/cm2", color: "#ffd54f" },
  { key: "sonido", title: "Sonido", unit: "dB", color: "#ba68c8" },
  { key: "voltaje", title: "Voltaje", unit: "V", color: "#66bb6a" },
];

function formatValue(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "--";
  }
  return Number(value).toFixed(digits);
}

function formatDate(date) {
  if (!date) return "--";
  return new Date(date).toLocaleString();
}

function formatXAxisLabel(date, filter) {
  const d = new Date(date);

  if (filter === "minute") {
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  if (filter === "hour") {
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return d.toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MetricCard({ title, value, unit, color }) {
  return (
    <div className="metric-card dynamic-card">
      <div className="metric-title-row">
        <span className="metric-title">{title}</span>
        <span className="metric-dot" style={{ backgroundColor: color }} />
      </div>
      <div className="metric-value">
        {value} <small>{unit}</small>
      </div>
    </div>
  );
}

export default function App() {
  const [latest, setLatest] = useState(null);
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("hour");
  const [selectedMetric, setSelectedMetric] = useState("temperatura");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());

  async function loadData() {
    try {
      setError("");

      const [latestRes, listRes] = await Promise.all([
        fetch(`${API_URL}/api/measurements/latest`),
        fetch(`${API_URL}/api/measurements?limit=2000`),
      ]);

      if (!latestRes.ok || !listRes.ok) {
        throw new Error("No se pudo cargar la información del backend");
      }

      const latestData = await latestRes.json();
      const listData = await listRes.json();

      setLatest(latestData);
      setItems(Array.isArray(listData) ? listData : []);
    } catch (err) {
      setError(err.message || "Error desconocido");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    const id = setInterval(loadData, 10000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(clock);
  }, []);

  const filteredItems = useMemo(() => {
    const nowMs = Date.now();
    const windowMs = FILTERS[filter].ms;

    return items.filter((item) => {
      const time = new Date(item.receivedAt).getTime();
      return nowMs - time <= windowMs;
    });
  }, [items, filter]);

  const chartData = useMemo(() => {
    return filteredItems
      .slice()
      .reverse()
      .map((item) => ({
        label: formatXAxisLabel(item.receivedAt, filter),
        temperatura: Number(item.temperatura),
        humedad: Number(item.humedad),
        radiacion_uv: Number(item.radiacion_uv),
        sonido: Number(item.sonido),
        voltaje: Number(item.voltaje),
        receivedAt: item.receivedAt,
      }));
  }, [filteredItems, filter]);

  const selectedMetricMeta =
    METRICS.find((metric) => metric.key === selectedMetric) || METRICS[0];

  return (
    <div className="app-shell">
      <header className="hero viva-hero">
        <div className="hero-left">
          <span className="hero-chip">Equipo InHouse - Los Cracks</span>
          <h1>Sistema de monitoreo ambiental LoRaWAN</h1>
          <p>
            Plataforma de visualización en tiempo real para monitoreo de
            <strong> temperatura</strong>, <strong>humedad</strong>,
            <strong> radiación UV</strong>, <strong>sonido</strong> y
            <strong> voltaje</strong>, con historial y filtros temporales para
            supervisión operativa del nodo IoT.
          </p>

          <div className="hero-tags">
            <span>LoRaWAN</span>
            <span>Tiempo real</span>
            <span>Telemetría ambiental</span>
            <span>Dashboard IoT</span>
          </div>
        </div>

        <div className="hero-right">
          <img src="/viva/logo-viva.png" alt="Viva" className="hero-logo" />
          <div className="live-panel">
            <div className="live-pill">
              <span className="live-dot" />
              Sistema en línea
            </div>
            <strong>{now.toLocaleTimeString()}</strong>
            <small>{now.toLocaleDateString()}</small>
          </div>
        </div>
      </header>

      {error && <div className="alert-box">Error: {error}</div>}

      <section className="filters-section">
        <div>
          <h2>Monitoreo dinámico</h2>
          <p>
            Visualización en tiempo real e histórico filtrado por rango de tiempo.
          </p>
        </div>

        <div className="filter-buttons">
          {Object.entries(FILTERS).map(([key, value]) => (
            <button
              key={key}
              className={filter === key ? "filter-btn active" : "filter-btn"}
              onClick={() => setFilter(key)}
            >
              {value.label}
            </button>
          ))}
        </div>
      </section>

      <section className="metrics-grid">
        {METRICS.map((metric) => (
          <MetricCard
            key={metric.key}
            title={metric.title}
            value={formatValue(latest?.[metric.key], metric.key === "voltaje" ? 2 : 1)}
            unit={metric.unit}
            color={metric.color}
          />
        ))}
      </section>

      <section className="main-visual-grid">
        <div className="featured-chart-card">
          <div className="section-header">
            <div>
              <h2>Gráfica principal en tiempo real</h2>
              <p>
                Variable activa: <strong>{selectedMetricMeta.title}</strong>
              </p>
            </div>

            <div className="metric-tabs">
              {METRICS.map((metric) => (
                <button
                  key={metric.key}
                  className={
                    selectedMetric === metric.key ? "metric-tab active" : "metric-tab"
                  }
                  onClick={() => setSelectedMetric(metric.key)}
                >
                  {metric.title}
                </button>
              ))}
            </div>
          </div>

          <div className="chart-box big-chart">
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient
                    id="mainMetricFill"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor={selectedMetricMeta.color}
                      stopOpacity={0.35}
                    />
                    <stop
                      offset="100%"
                      stopColor={selectedMetricMeta.color}
                      stopOpacity={0.05}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#dfe8d8" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7280" }} />
                <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} />
                <Tooltip
                  contentStyle={{
                    borderRadius: "12px",
                    border: "1px solid #dce8d6",
                    background: "#ffffff",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey={selectedMetric}
                  stroke={selectedMetricMeta.color}
                  fill="url(#mainMetricFill)"
                  strokeWidth={3}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        
      </section>

      <section className="charts-grid">
        {METRICS.map((metric) => (
          <div className="chart-card" key={metric.key}>
            <div className="chart-header">
              <h3>{metric.title}</h3>
              <span className="chart-unit">{metric.unit || "valor"}</span>
            </div>

            <div className="chart-box">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dfe8d8" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "#6b7280" }}
                    minTickGap={20}
                  />
                  <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: "12px",
                      border: "1px solid #dce8d6",
                      background: "#ffffff",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey={metric.key}
                    stroke={metric.color}
                    strokeWidth={3}
                    dot={false}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </section>

      <section className="history-section">
        <div className="section-header">
          <h2>Historial de variables</h2>
          <p>
            Registros del <strong>{FILTERS[filter].label.toLowerCase()}</strong>.
          </p>
        </div>

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Temperatura</th>
                <th>Humedad</th>
                <th>Radiación UV</th>
                <th>Sonido</th>
                <th>Voltaje</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length > 0 ? (
                filteredItems.slice(0, 100).map((item) => (
                  <tr key={`${item.deviceId}-${item.fCnt}-${item.receivedAt}`}>
                    <td>{formatDate(item.receivedAt)}</td>
                    <td>{formatValue(item.temperatura)} °C</td>
                    <td>{formatValue(item.humedad)} %</td>
                    <td>{formatValue(item.radiacion_uv)} mW/cm2</td>
                    <td>{formatValue(item.sonido)} dB</td>
                    <td>{formatValue(item.voltaje, 2)} V</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6" className="empty-row">
                    {loading
                      ? "Cargando datos..."
                      : "No hay registros dentro del rango seleccionado."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}