import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Brush,
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

const DEFAULT_VISIBLE_METRICS = {
  temperatura: true,
  humedad: true,
  radiacion_uv: true,
  sonido: true,
  voltaje: true,
};

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

function formatXAxisLabel(date, filter, isCustomRange = false) {
  const d = new Date(date);

  if (isCustomRange) {
    return d.toLocaleString([], {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

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
  const [visibleMetrics, setVisibleMetrics] = useState(DEFAULT_VISIBLE_METRICS);
  const [customRange, setCustomRange] = useState({
    from: "",
    to: "",
  });
  const [darkMode, setDarkMode] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadData = useCallback(async () => {
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

      setLatest(latestData || null);
      setItems(Array.isArray(listData) ? listData : []);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message || "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const id = setInterval(loadData, 10000);
    return () => clearInterval(id);
  }, [loadData]);

  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(clock);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("dark-theme", darkMode);
    return () => document.body.classList.remove("dark-theme");
  }, [darkMode]);

  const isCustomRangeActive = useMemo(() => {
    return Boolean(customRange.from || customRange.to);
  }, [customRange]);

  const customRangeError = useMemo(() => {
    if (!customRange.from || !customRange.to) return "";
    const fromMs = new Date(customRange.from).getTime();
    const toMs = new Date(customRange.to).getTime();

    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
      return "El rango de fechas no es válido.";
    }

    if (fromMs > toMs) {
      return "La fecha 'Desde' no puede ser mayor que 'Hasta'.";
    }

    return "";
  }, [customRange]);

  const filteredItems = useMemo(() => {
    if (!Array.isArray(items) || items.length === 0) return [];

    if (isCustomRangeActive) {
      if (customRangeError) return [];

      const from = customRange.from
        ? new Date(customRange.from).getTime()
        : -Infinity;
      const to = customRange.to
        ? new Date(customRange.to).getTime()
        : Infinity;

      return items.filter((item) => {
        const time = new Date(item.receivedAt).getTime();
        return time >= from && time <= to;
      });
    }

    const nowMs = Date.now();
    const windowMs = FILTERS[filter].ms;

    return items.filter((item) => {
      const time = new Date(item.receivedAt).getTime();
      return nowMs - time <= windowMs;
    });
  }, [items, filter, customRange, isCustomRangeActive, customRangeError]);

  const chartData = useMemo(() => {
    return filteredItems
      .slice()
      .reverse()
      .map((item) => ({
        label: formatXAxisLabel(item.receivedAt, filter, isCustomRangeActive),
        temperatura: Number(item.temperatura),
        humedad: Number(item.humedad),
        radiacion_uv: Number(item.radiacion_uv),
        sonido: Number(item.sonido),
        voltaje: Number(item.voltaje),
        receivedAt: item.receivedAt,
      }));
  }, [filteredItems, filter, isCustomRangeActive]);

  const selectedMetricMeta =
    METRICS.find((metric) => metric.key === selectedMetric) || METRICS[0];

  const visibleMetricList = useMemo(() => {
    return METRICS.filter((metric) => visibleMetrics[metric.key]);
  }, [visibleMetrics]);

  const hasVisibleMetrics = visibleMetricList.length > 0;

  const chartTheme = useMemo(() => {
    return darkMode
      ? {
          grid: "#233044",
          axis: "#94a3b8",
          tooltipBg: "#0f172a",
          tooltipBorder: "#334155",
        }
      : {
          grid: "#dfe8d8",
          axis: "#6b7280",
          tooltipBg: "#ffffff",
          tooltipBorder: "#dce8d6",
        };
  }, [darkMode]);

  const rangeLabel = useMemo(() => {
    if (isCustomRangeActive) {
      const fromLabel = customRange.from ? formatDate(customRange.from) : "Inicio";
      const toLabel = customRange.to ? formatDate(customRange.to) : "Ahora";
      return `${fromLabel} → ${toLabel}`;
    }
    return FILTERS[filter].label;
  }, [isCustomRangeActive, customRange, filter]);

  const handleCustomRangeChange = (field, value) => {
    setCustomRange((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const clearCustomRange = () => {
    setCustomRange({
      from: "",
      to: "",
    });
  };

  const handleToggleMetric = (metricKey) => {
    setVisibleMetrics((prev) => {
      const next = {
        ...prev,
        [metricKey]: !prev[metricKey],
      };

      if (prev[metricKey] && selectedMetric === metricKey) {
        const nextVisible = METRICS.find(
          (metric) => metric.key !== metricKey && next[metric.key]
        );
        if (nextVisible) {
          setSelectedMetric(nextVisible.key);
        }
      }

      if (!prev[metricKey]) {
        setSelectedMetric(metricKey);
      }

      return next;
    });
  };

  const showAllMetrics = () => {
    setVisibleMetrics(DEFAULT_VISIBLE_METRICS);
  };

  const hideAllMetrics = () => {
    setVisibleMetrics({
      temperatura: false,
      humedad: false,
      radiacion_uv: false,
      sonido: false,
      voltaje: false,
    });
  };

  const handleSelectMetric = (metricKey) => {
    setSelectedMetric(metricKey);
    setVisibleMetrics((prev) => ({
      ...prev,
      [metricKey]: true,
    }));
  };

  return (
    <div className="app-shell">
      <header className="hero viva-hero">
        <div className="hero-left">
          <div className="hero-topbar">
            <span className="hero-chip">Equipo InHouse - Los Cracks</span>
            <button
              className="theme-toggle"
              onClick={() => setDarkMode((prev) => !prev)}
              type="button"
            >
              {darkMode ? "☀️ Modo claro" : "🌙 Modo oscuro"}
            </button>
          </div>

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
            <span className="last-update">
              Última actualización: {lastUpdated ? formatDate(lastUpdated) : "--"}
            </span>
          </div>
        </div>
      </header>

      {(error || customRangeError) && (
        <div className="alert-box">
          Error: {customRangeError || error}
        </div>
      )}

      <section className="filters-section">
        <div>
          <h2>Monitoreo dinámico</h2>
          <p>
            Usa filtros rápidos o define un rango personalizado por fecha y hora.
          </p>
        </div>

        <div className="filters-right">
          <div className="filter-buttons">
            {Object.entries(FILTERS).map(([key, value]) => (
              <button
                key={key}
                className={filter === key ? "filter-btn active" : "filter-btn"}
                onClick={() => setFilter(key)}
                type="button"
              >
                {value.label}
              </button>
            ))}
          </div>

          <div className="custom-range-box">
            <div className="custom-range-header">
              <span>Rango personalizado</span>
              {isCustomRangeActive && (
                <button
                  className="ghost-btn"
                  onClick={clearCustomRange}
                  type="button"
                >
                  Limpiar rango
                </button>
              )}
            </div>

            <div className="custom-range-inputs">
              <label>
                <span>Desde</span>
                <input
                  type="datetime-local"
                  value={customRange.from}
                  onChange={(e) =>
                    handleCustomRangeChange("from", e.target.value)
                  }
                />
              </label>

              <label>
                <span>Hasta</span>
                <input
                  type="datetime-local"
                  value={customRange.to}
                  onChange={(e) =>
                    handleCustomRangeChange("to", e.target.value)
                  }
                />
              </label>
            </div>
          </div>
        </div>
      </section>

      <section className="metrics-grid">
        {METRICS.map((metric) => (
          <MetricCard
            key={metric.key}
            title={metric.title}
            value={formatValue(
              latest?.[metric.key],
              metric.key === "voltaje" ? 2 : 1
            )}
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
                Rango activo: <strong>{rangeLabel}</strong>
              </p>
            </div>

            <div className="chart-summary-badges">
              <span>{filteredItems.length} registros</span>
              <span>{visibleMetricList.length} métricas visibles</span>
              <span>Métrica destacada: {selectedMetricMeta.title}</span>
            </div>
          </div>

          <div className="controls-grid">
            <div className="control-card">
              <div className="control-card-header">
                <h3>Métrica destacada</h3>
                <span>Selecciona la variable principal</span>
              </div>

              <div className="metric-tabs">
                {METRICS.map((metric) => (
                  <button
                    key={metric.key}
                    className={
                      selectedMetric === metric.key
                        ? "metric-tab active"
                        : visibleMetrics[metric.key]
                        ? "metric-tab"
                        : "metric-tab is-hidden"
                    }
                    onClick={() => handleSelectMetric(metric.key)}
                    type="button"
                  >
                    {metric.title}
                  </button>
                ))}
              </div>
            </div>

            <div className="control-card">
              <div className="control-card-header">
                <h3>Visibilidad de métricas</h3>
                <span>Muestra u oculta líneas en la gráfica principal</span>
              </div>

              <div className="visibility-actions">
                <button className="ghost-btn" onClick={showAllMetrics} type="button">
                  Mostrar todas
                </button>
                <button className="ghost-btn" onClick={hideAllMetrics} type="button">
                  Ocultar todas
                </button>
              </div>

              <div className="visibility-panel">
                {METRICS.map((metric) => (
                  <label className="visibility-item" key={metric.key}>
                    <input
                      type="checkbox"
                      checked={visibleMetrics[metric.key]}
                      onChange={() => handleToggleMetric(metric.key)}
                    />
                    <span
                      className="visibility-dot"
                      style={{ backgroundColor: metric.color }}
                    />
                    <span>{metric.title}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="chart-box big-chart">
            {hasVisibleMetrics && chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: chartTheme.axis }}
                    minTickGap={24}
                  />
                  <YAxis tick={{ fontSize: 11, fill: chartTheme.axis }} />
                  <Tooltip
                    labelFormatter={(_, payload) =>
                      payload?.[0]?.payload?.receivedAt
                        ? formatDate(payload[0].payload.receivedAt)
                        : "--"
                    }
                    formatter={(value, name) => {
                      const metric = METRICS.find((item) => item.key === name);
                      const digits = name === "voltaje" ? 2 : 1;
                      return [
                        `${formatValue(value, digits)} ${metric?.unit || ""}`,
                        metric?.title || name,
                      ];
                    }}
                    contentStyle={{
                      borderRadius: "14px",
                      border: `1px solid ${chartTheme.tooltipBorder}`,
                      background: chartTheme.tooltipBg,
                    }}
                  />
                  <Legend />
                  {visibleMetricList.map((metric) => (
                    <Line
                      key={metric.key}
                      type="monotone"
                      dataKey={metric.key}
                      stroke={metric.color}
                      strokeWidth={selectedMetric === metric.key ? 3.5 : 2.2}
                      strokeOpacity={
                        selectedMetric === metric.key
                          ? 1
                          : visibleMetricList.length > 1
                          ? 0.45
                          : 1
                      }
                      dot={false}
                      activeDot={{ r: selectedMetric === metric.key ? 5 : 3 }}
                    />
                  ))}
                  <Brush
                    dataKey="label"
                    height={28}
                    stroke={selectedMetricMeta.color}
                    travellerWidth={10}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="chart-empty-state">
                {loading
                  ? "Cargando datos de la gráfica..."
                  : hasVisibleMetrics
                  ? "No hay datos dentro del rango seleccionado."
                  : "No hay métricas visibles. Activa al menos una para mostrar la gráfica."}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="history-section">
        <div className="section-header">
          <div>
            <h2>Historial de variables</h2>
            <p>
              Registros del rango: <strong>{rangeLabel}</strong>.
            </p>
          </div>
          <div className="history-count">
            Mostrando {Math.min(filteredItems.length, 100)} de {filteredItems.length}
          </div>
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
                    <td data-label="Fecha">{formatDate(item.receivedAt)}</td>
                    <td data-label="Temperatura">
                      {formatValue(item.temperatura)} °C
                    </td>
                    <td data-label="Humedad">
                      {formatValue(item.humedad)} %
                    </td>
                    <td data-label="Radiación UV">
                      {formatValue(item.radiacion_uv)} mW/cm2
                    </td>
                    <td data-label="Sonido">
                      {formatValue(item.sonido)} dB
                    </td>
                    <td data-label="Voltaje">
                      {formatValue(item.voltaje, 2)} V
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6" className="empty-row">
                    {loading
                      ? "Cargando datos..."
                      : customRangeError
                      ? customRangeError
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