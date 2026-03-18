import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Brush,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:10000";

const FILTERS = {
  minute: { label: "Último minuto", ms: 60 * 1000 },
  hour: { label: "Última hora", ms: 60 * 60 * 1000 },
  day: { label: "Último día", ms: 24 * 60 * 60 * 1000 },
};

const METRICS = [
  { key: "temperatura", title: "Temperatura", short: "Temp", unit: "°C", color: "#ff8a65" },
  { key: "humedad", title: "Humedad", short: "Hum", unit: "%", color: "#4fc3f7" },
  { key: "radiacion_uv", title: "Radiación UV", short: "Rad", unit: "mW/cm²", color: "#ffd54f" },
  { key: "sonido", title: "Sonido", short: "Son", unit: "dB", color: "#ba68c8" },
  { key: "voltaje", title: "Voltaje", short: "Volt", unit: "V", color: "#66bb6a" },
];

const DEVICE_STYLES = [
  { dot: "#90be6d", dash: "0" },
  { dot: "#577590", dash: "6 4" },
  { dot: "#f8961e", dash: "10 5" },
  { dot: "#43aa8b", dash: "3 5" },
  { dot: "#f94144", dash: "12 6" },
  { dot: "#277da1", dash: "2 4" },
];

function getMetricMeta(metricKey) {
  return METRICS.find((metric) => metric.key === metricKey) || METRICS[0];
}

function getMetricDigits(metricKey) {
  return metricKey === "voltaje" ? 2 : 1;
}

function buildSeriesKey(deviceId, metricKey) {
  return `${deviceId}__${metricKey}`;
}

function formatValue(value, digits = 1) {
  if (value === null || value === undefined || value === "") return "--";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return "--";
  return numeric.toFixed(digits);
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

function formatRelativeTime(date) {
  if (!date) return "Sin actividad reciente";

  const diffMs = Date.now() - new Date(date).getTime();
  if (diffMs < 0) return "Ahora";

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec} seg ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;

  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} d ago`;
}

function getDeviceStatus(date) {
  if (!date) return { text: "Sin datos", tone: "offline" };

  const diffMs = Date.now() - new Date(date).getTime();
  if (diffMs <= 3 * 60 * 1000) return { text: "Activo", tone: "online" };
  if (diffMs <= 30 * 60 * 1000) return { text: "Intermitente", tone: "warning" };
  return { text: "Sin actividad reciente", tone: "offline" };
}

function createDefaultSeriesVisibility(devices) {
  const visibleByDevice = {};

  devices.forEach((device) => {
    const defaults = {};
    device.variables.forEach((metricKey) => {
      defaults[metricKey] =
        metricKey === "temperatura" ||
        metricKey === "humedad" ||
        metricKey === "sonido";
    });
    visibleByDevice[device.deviceId] = defaults;
  });

  return visibleByDevice;
}

function DeviceMetricCard({ metricKey, value }) {
  const metric = getMetricMeta(metricKey);
  return (
    <div className="mini-metric-card">
      <div className="mini-metric-top">
        <span>{metric.title}</span>
        <span
          className="mini-metric-dot"
          style={{ backgroundColor: metric.color }}
        />
      </div>
      <strong>
        {formatValue(value, getMetricDigits(metricKey))}
        <small>{metric.unit}</small>
      </strong>
    </div>
  );
}

function DeviceRealtimeRow({ device, latest, deviceStyle }) {
  const status = getDeviceStatus(latest?.receivedAt);

  return (
    <article className="device-realtime-row">
      <div className="device-label-panel">
        <div className="device-label-top">
          <h3>{device.label}</h3>
          <span
            className={`device-status-badge ${status.tone}`}
            style={{ borderColor: deviceStyle.dot }}
          >
            <span
              className="device-status-dot"
              style={{ backgroundColor: deviceStyle.dot }}
            />
            {status.text}
          </span>
        </div>
        <p>{device.deviceId}</p>
        <small>
          Última actividad: {latest?.receivedAt ? formatRelativeTime(latest.receivedAt) : "--"}
        </small>
      </div>

      <div className="device-metrics-grid">
        {device.variables.map((metricKey) => (
          <DeviceMetricCard
            key={`${device.deviceId}-${metricKey}`}
            metricKey={metricKey}
            value={latest?.[metricKey]}
          />
        ))}
      </div>
    </article>
  );
}

export default function App() {
  const [devices, setDevices] = useState([]);
  const [latestDevices, setLatestDevices] = useState([]);
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("hour");
  const [seriesVisibility, setSeriesVisibility] = useState({});
  const [customRange, setCustomRange] = useState({ from: "", to: "" });
  const [darkMode, setDarkMode] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadData = useCallback(async () => {
    try {
      setError("");

      const [configRes, latestRes, listRes] = await Promise.all([
        fetch(`${API_URL}/api/devices/config`),
        fetch(`${API_URL}/api/devices/latest`),
        fetch(`${API_URL}/api/measurements?limit=5000&sort=asc`),
      ]);

      if (!configRes.ok || !latestRes.ok || !listRes.ok) {
        throw new Error("No se pudo cargar la información del backend");
      }

      const configData = await configRes.json();
      const latestData = await latestRes.json();
      const listData = await listRes.json();

      const safeDevices = Array.isArray(configData) ? configData : [];
      setDevices(safeDevices);
      setLatestDevices(Array.isArray(latestData) ? latestData : []);
      setItems(Array.isArray(listData) ? listData : []);
      setLastUpdated(new Date());

      setSeriesVisibility((prev) => {
        if (Object.keys(prev).length > 0) {
          return prev;
        }
        return createDefaultSeriesVisibility(safeDevices);
      });
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

  const deviceMap = useMemo(() => {
    return Object.fromEntries(devices.map((device) => [device.deviceId, device]));
  }, [devices]);

  const latestMap = useMemo(() => {
    return Object.fromEntries(
      latestDevices.map((device) => [device.deviceId, device.latest || null])
    );
  }, [latestDevices]);

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

      const from = customRange.from ? new Date(customRange.from).getTime() : -Infinity;
      const to = customRange.to ? new Date(customRange.to).getTime() : Infinity;

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
    return filteredItems.map((item) => {
      const row = {
        label: formatXAxisLabel(item.receivedAt, filter, isCustomRangeActive),
        receivedAt: item.receivedAt,
        deviceId: item.deviceId,
      };

      const device = deviceMap[item.deviceId];
      if (!device) return row;

      device.variables.forEach((metricKey) => {
        const rawValue = item[metricKey];
        const numeric = rawValue === null || rawValue === undefined ? null : Number(rawValue);
        row[buildSeriesKey(item.deviceId, metricKey)] = Number.isNaN(numeric) ? null : numeric;
      });

      return row;
    });
  }, [filteredItems, filter, isCustomRangeActive, deviceMap]);

  const visibleSeries = useMemo(() => {
    return devices.flatMap((device, index) => {
      const deviceStyle = DEVICE_STYLES[index % DEVICE_STYLES.length];

      return device.variables
        .filter((metricKey) => seriesVisibility[device.deviceId]?.[metricKey])
        .map((metricKey) => {
          const metric = getMetricMeta(metricKey);
          return {
            key: buildSeriesKey(device.deviceId, metricKey),
            metricKey,
            deviceId: device.deviceId,
            name: `${device.label} • ${metric.short}`,
            color: metric.color,
            dash: deviceStyle.dash,
          };
        });
    });
  }, [devices, seriesVisibility]);

  const historyRows = useMemo(() => {
    return filteredItems.slice().reverse().slice(0, 100);
  }, [filteredItems]);

  const rangeLabel = useMemo(() => {
    if (isCustomRangeActive) {
      const fromLabel = customRange.from ? formatDate(customRange.from) : "Inicio";
      const toLabel = customRange.to ? formatDate(customRange.to) : "Ahora";
      return `${fromLabel} → ${toLabel}`;
    }

    return FILTERS[filter].label;
  }, [customRange.from, customRange.to, filter, isCustomRangeActive]);

  const activeDeviceCount = useMemo(() => {
    return devices.filter((device) =>
      device.variables.some((metricKey) => seriesVisibility[device.deviceId]?.[metricKey])
    ).length;
  }, [devices, seriesVisibility]);

  const handleCustomRangeChange = (field, value) => {
    setCustomRange((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const clearCustomRange = () => {
    setCustomRange({ from: "", to: "" });
  };

  const toggleSeries = (deviceId, metricKey) => {
    setSeriesVisibility((prev) => ({
      ...prev,
      [deviceId]: {
        ...(prev[deviceId] || {}),
        [metricKey]: !prev[deviceId]?.[metricKey],
      },
    }));
  };

  const setAllSeries = (visible) => {
    setSeriesVisibility((prev) => {
      const next = { ...prev };
      devices.forEach((device) => {
        next[device.deviceId] = { ...(next[device.deviceId] || {}) };
        device.variables.forEach((metricKey) => {
          next[device.deviceId][metricKey] = visible;
        });
      });
      return next;
    });
  };

  return (
    <div className="app-shell">
      <header className="hero viva-hero">
        <div className="brand-mark">VIVA</div>

        <div className="hero-copy">
          <div className="hero-topbar">
            <span className="hero-chip">Sistema IoT · TTN + MongoDB + React</span>
            <button
              className="theme-toggle"
              onClick={() => setDarkMode((prev) => !prev)}
              type="button"
            >
              {darkMode ? "Modo claro" : "Modo oscuro"}
            </button>
          </div>

          <h1>Sistema de monitoreo ambiental LoRaWAN</h1>
          <p>
            Supervisión en tiempo real de <strong>6 dispositivos</strong>. Los
            dispositivos 1 y 2 reportan temperatura, humedad, radiación UV,
            sonido y voltaje; los dispositivos 3 al 6 reportan temperatura y
            humedad.
          </p>
        </div>

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
      </header>

      {(error || customRangeError) && (
        <div className="alert-box">Error: {customRangeError || error}</div>
      )}

      <section className="dashboard-grid">
        <section className="panel-card realtime-panel">
          <div className="section-header">
            <div>
              <h2>Datos en tiempo real</h2>
              <p>Último registro recibido por cada dispositivo.</p>
            </div>
            <div className="summary-pill-group">
              <span>{devices.length} dispositivos</span>
              <span>{latestDevices.filter((item) => item.latest).length} con datos</span>
            </div>
          </div>

          <div className="devices-stack">
            {devices.map((device, index) => (
              <DeviceRealtimeRow
                key={device.deviceId}
                device={device}
                latest={latestMap[device.deviceId]}
                deviceStyle={DEVICE_STYLES[index % DEVICE_STYLES.length]}
              />
            ))}
          </div>
        </section>

        <section className="panel-card chart-panel">
          <div className="section-header chart-header">
            <div>
              <h2>Gráfica principal en tiempo real</h2>
              <p>
                Rango activo: <strong>{rangeLabel}</strong>
              </p>
            </div>

            <div className="summary-pill-group">
              <span>{filteredItems.length} registros</span>
              <span>{visibleSeries.length} series visibles</span>
              <span>{activeDeviceCount} dispositivos en gráfica</span>
            </div>
          </div>

          <div className="chart-top-controls">
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
                  <button className="ghost-btn" onClick={clearCustomRange} type="button">
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
                    onChange={(e) => handleCustomRangeChange("from", e.target.value)}
                  />
                </label>

                <label>
                  <span>Hasta</span>
                  <input
                    type="datetime-local"
                    value={customRange.to}
                    onChange={(e) => handleCustomRangeChange("to", e.target.value)}
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="chart-box big-chart">
            {visibleSeries.length > 0 && chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? "#22324a" : "#d9e5d1"} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: darkMode ? "#9fb0c7" : "#6b7280" }}
                    minTickGap={24}
                  />
                  <YAxis tick={{ fontSize: 11, fill: darkMode ? "#9fb0c7" : "#6b7280" }} />
                  <Tooltip
                    labelFormatter={(_, payload) =>
                      payload?.[0]?.payload?.receivedAt
                        ? formatDate(payload[0].payload.receivedAt)
                        : "--"
                    }
                    formatter={(value, name) => {
                      const series = visibleSeries.find((item) => item.key === name);
                      const metric = getMetricMeta(series?.metricKey);
                      return [
                        `${formatValue(value, getMetricDigits(series?.metricKey))} ${metric?.unit || ""}`,
                        series?.name || name,
                      ];
                    }}
                    contentStyle={{
                      borderRadius: "14px",
                      border: `1px solid ${darkMode ? "#334155" : "#dce8d6"}`,
                      background: darkMode ? "#0f172a" : "#ffffff",
                    }}
                  />
                  <Legend />
                  {visibleSeries.map((series) => (
                    <Line
                      key={series.key}
                      type="monotone"
                      dataKey={series.key}
                      name={series.name}
                      stroke={series.color}
                      strokeDasharray={series.dash}
                      strokeWidth={2.4}
                      dot={false}
                      connectNulls={false}
                      activeDot={{ r: 4 }}
                    />
                  ))}
                  <Brush dataKey="label" height={26} stroke="#8a63ff" travellerWidth={10} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="chart-empty-state">
                {loading
                  ? "Cargando datos de la gráfica..."
                  : visibleSeries.length === 0
                  ? "No hay series activas. Selecciona al menos una variable para graficar."
                  : "No hay datos dentro del rango seleccionado."}
              </div>
            )}
          </div>

          <div className="series-toolbar">
            <button className="ghost-btn" type="button" onClick={() => setAllSeries(true)}>
              Mostrar todas
            </button>
            <button className="ghost-btn" type="button" onClick={() => setAllSeries(false)}>
              Ocultar todas
            </button>
          </div>

          <div className="series-control-list">
            {devices.map((device, index) => {
              const deviceStyle = DEVICE_STYLES[index % DEVICE_STYLES.length];
              return (
                <div className="series-device-row" key={device.deviceId}>
                  <div className="series-device-name">
                    <span
                      className="series-device-dot"
                      style={{ backgroundColor: deviceStyle.dot }}
                    />
                    <strong>{device.label}</strong>
                  </div>

                  <div className="series-device-options">
                    {device.variables.map((metricKey) => {
                      const metric = getMetricMeta(metricKey);
                      const checked = Boolean(seriesVisibility[device.deviceId]?.[metricKey]);

                      return (
                        <label className="series-option" key={`${device.deviceId}-${metricKey}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSeries(device.deviceId, metricKey)}
                          />
                          <span
                            className="series-option-dot"
                            style={{ backgroundColor: metric.color }}
                          />
                          <span>{metric.short}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </section>

      <section className="panel-card history-section">
        <div className="section-header">
          <div>
            <h2>Historial de variables</h2>
            <p>
              Registros dentro del rango seleccionado: <strong>{rangeLabel}</strong>
            </p>
          </div>
          <div className="summary-pill-group">
            <span>Mostrando {historyRows.length}</span>
            <span>Total filtrado {filteredItems.length}</span>
          </div>
        </div>

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Dispositivo</th>
                <th>Temperatura</th>
                <th>Humedad</th>
                <th>Radiación UV</th>
                <th>Sonido</th>
                <th>Voltaje</th>
              </tr>
            </thead>
            <tbody>
              {historyRows.length > 0 ? (
                historyRows.map((item) => (
                  <tr key={`${item.deviceId}-${item.fCnt}-${item.receivedAt}`}>
                    <td data-label="Fecha">{formatDate(item.receivedAt)}</td>
                    <td data-label="Dispositivo">{deviceMap[item.deviceId]?.label || item.deviceId}</td>
                    <td data-label="Temperatura">
                      {formatValue(item.temperatura, 1)} °C
                    </td>
                    <td data-label="Humedad">{formatValue(item.humedad, 1)} %</td>
                    <td data-label="Radiación UV">
                      {formatValue(item.radiacion_uv, 1)} mW/cm²
                    </td>
                    <td data-label="Sonido">{formatValue(item.sonido, 1)} dB</td>
                    <td data-label="Voltaje">{formatValue(item.voltaje, 2)} V</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="7" className="empty-row">
                    {loading
                      ? "Cargando historial..."
                      : customRangeError || "No hay registros dentro del rango seleccionado."}
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