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
const DEFAULT_WINDOW_MS = 60 * 60 * 1000; // 1 hora
const MAX_CHART_POINTS = 700;

const METRICS = [
  {
    key: "temperatura",
    title: "Temperatura",
    short: "Temp",
    unit: "°C",
  },
  {
    key: "humedad",
    title: "Humedad",
    short: "Humedad",
    unit: "%",
  },
  {
    key: "radiacion_uv",
    title: "Radiación UV",
    short: "Rad UV",
    unit: "mW/cm²",
  },
  {
    key: "sonido",
    title: "Sonido",
    short: "Sonido",
    unit: "dB",
  },
];

const DEVICE_LABELS = {
  "dispositivo-1n": "Disp. 1",
  "dispositivo-2": "Disp. 2",
  "dispositivo-3": "V-One",
  "dispositivo-4": "Datacon",
  "dispositivo-5": "RNC",
  "dispositivo-6": "Casita IT",
};

const DEVICE_COLOR_PALETTE = [
  "#3b82f6", // azul
  "#f59e0b", // amarillo
  "#84cc16", // verde
  "#ef4444", // rojo
  "#7c3aed", // morado
  "#94a3b8", // gris
  "#06b6d4",
  "#ec4899",
];

function getDeviceLabel(deviceOrId) {
  const deviceId =
    typeof deviceOrId === "string" ? deviceOrId : deviceOrId?.deviceId;

  if (!deviceId) return "Sin nombre";
  return DEVICE_LABELS[deviceId] || deviceId;
}

function getAvailableMetrics(device) {
  const vars = Array.isArray(device?.variables) ? device.variables : [];
  return METRICS.filter((metric) => vars.includes(metric.key)).map(
    (metric) => metric.key
  );
}

function getMetricMeta(metricKey) {
  return METRICS.find((metric) => metric.key === metricKey) || METRICS[0];
}

function getMetricDigits() {
  return 1;
}

function formatValue(value, digits = 1) {
  if (value === null || value === undefined || value === "") return "--";
  const n = Number(value);
  if (Number.isNaN(n)) return "--";
  return n.toFixed(digits);
}

function formatDate(date) {
  if (!date) return "--";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleString("es-BO");
}

function formatXAxisLabel(date, customRangeActive, spanMs = DEFAULT_WINDOW_MS) {
  const d = new Date(date);

  if (customRangeActive || spanMs > 24 * 60 * 60 * 1000) {
    return d.toLocaleString("es-BO", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return d.toLocaleTimeString("es-BO", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildSeriesKey(deviceId, metricKey) {
  return `${deviceId}__${metricKey}`;
}

function getDeviceStatus(date) {
  if (!date) return { text: "Sin datos", tone: "offline" };

  const diffMs = Date.now() - new Date(date).getTime();

  if (diffMs <= 3 * 60 * 1000) {
    return { text: "Activo", tone: "online" };
  }

  if (diffMs <= 30 * 60 * 1000) {
    return { text: "Intermitente", tone: "warning" };
  }

  return { text: "Inactivo", tone: "offline" };
}

function getBucketMs(spanMs) {
  if (spanMs <= 3 * 60 * 60 * 1000) return 60 * 1000; // 1 min
  if (spanMs <= 12 * 60 * 60 * 1000) return 5 * 60 * 1000; // 5 min
  if (spanMs <= 48 * 60 * 60 * 1000) return 15 * 60 * 1000; // 15 min
  return 60 * 60 * 1000; // 1 hora
}

function reducePoints(rows, maxPoints = MAX_CHART_POINTS) {
  if (rows.length <= maxPoints) return rows;
  const step = Math.ceil(rows.length / maxPoints);
  return rows.filter((_, index) => index % step === 0 || index === rows.length - 1);
}

function createInitialSelections(devices) {
  const next = {};

  devices.forEach((device, index) => {
    next[device.deviceId] = index < 2 || devices.length <= 2;
  });

  return next;
}

function getDeviceColor(deviceId, devices) {
  const deviceIndex = devices.findIndex((d) => d.deviceId === deviceId);
  const safeIndex = deviceIndex >= 0 ? deviceIndex : 0;
  return DEVICE_COLOR_PALETTE[safeIndex % DEVICE_COLOR_PALETTE.length];
}

function RealtimeRow({ device, latest }) {
  const status = getDeviceStatus(latest?.receivedAt);
  const metrics = getAvailableMetrics(device);

  return (
    <div className="realtime-row">
      <div className="device-name-cell" translate="no">
        {getDeviceLabel(device)}
      </div>

      <div className="value-cell">
        {metrics.includes("temperatura")
          ? `${formatValue(latest?.temperatura, 1)} °C`
          : "--"}
      </div>

      <div className="value-cell">
        {metrics.includes("humedad")
          ? `${formatValue(latest?.humedad, 1)} %`
          : "--"}
      </div>

      <div className="value-cell">
        {metrics.includes("radiacion_uv")
          ? `${formatValue(latest?.radiacion_uv, 1)}`
          : "--"}
      </div>

      <div className="value-cell">
        {metrics.includes("sonido")
          ? `${formatValue(latest?.sonido, 1)} dB`
          : "--"}
      </div>

      <div className="status-cell">
        <span className={`status-pill ${status.tone}`}>{status.text}</span>
      </div>
    </div>
  );
}

function MetricChart({ metric, data, series, loading }) {
  if (!series.length || !data.length) {
    return (
      <div className="metric-chart-empty">
        {loading
          ? "Cargando gráfica..."
          : "Selecciona uno o varios dispositivos para comparar."}
      </div>
    );
  }

  return (
    <div className="metric-chart-box">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          syncId="realtime-metrics"
          margin={{ top: 8, right: 14, left: 0, bottom: 8 }}
        >
          <CartesianGrid strokeDasharray="4 4" stroke="#e6eaf2" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "#6b7280" }}
            minTickGap={22}
          />
          <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} width={52} />
          <Tooltip
            labelFormatter={(_, payload) =>
              payload?.[0]?.payload?.receivedAt
                ? formatDate(payload[0].payload.receivedAt)
                : "--"
            }
            formatter={(value, _name, entry) => {
              const currentSeries = series.find((item) => item.key === entry?.dataKey);
              return [
                `${formatValue(value, getMetricDigits(metric.key))} ${metric.unit}`,
                currentSeries?.name || "",
              ];
            }}
            contentStyle={{
              borderRadius: "14px",
              border: "1px solid #dce3ef",
              background: "#ffffff",
              boxShadow: "0 12px 30px rgba(15, 23, 42, 0.10)",
            }}
          />
          <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
          {series.map((item) => (
            <Line
              key={item.key}
              type="monotone"
              dataKey={item.key}
              name={item.name}
              stroke={item.color}
              strokeWidth={2.5}
              dot={false}
              connectNulls
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          ))}
          {data.length > 16 && (
            <Brush
              dataKey="label"
              height={22}
              stroke="#8b5cf6"
              travellerWidth={10}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function App() {
  const [devices, setDevices] = useState([]);
  const [latestDevices, setLatestDevices] = useState([]);
  const [items, setItems] = useState([]);
  const [selectedDevices, setSelectedDevices] = useState({});
  const [customRange, setCustomRange] = useState({ from: "", to: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    document.documentElement.lang = "es";
    document.documentElement.setAttribute("translate", "no");
    document.body.setAttribute("translate", "no");
  }, []);

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
      const safeLatest = Array.isArray(latestData) ? latestData : [];
      const safeItems = Array.isArray(listData) ? listData : [];

      setDevices(safeDevices);
      setLatestDevices(safeLatest);
      setItems(safeItems);
      setLastUpdated(new Date());

      setSelectedDevices((prev) => {
        const next = { ...prev };

        if (Object.keys(next).length === 0) {
          return createInitialSelections(safeDevices);
        }

        safeDevices.forEach((device, index) => {
          if (typeof next[device.deviceId] === "undefined") {
            next[device.deviceId] = index < 2 || safeDevices.length <= 2;
          }
        });

        return next;
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

  const latestMap = useMemo(() => {
    return Object.fromEntries(
      latestDevices.map((device) => [device.deviceId, device.latest || null])
    );
  }, [latestDevices]);

  const deviceMetricsMap = useMemo(() => {
    return Object.fromEntries(
      devices.map((device) => [device.deviceId, getAvailableMetrics(device)])
    );
  }, [devices]);

  const deviceColorMap = useMemo(() => {
    return Object.fromEntries(
      devices.map((device) => [device.deviceId, getDeviceColor(device.deviceId, devices)])
    );
  }, [devices]);

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

  const customRangeActive = useMemo(() => {
    return Boolean(customRange.from || customRange.to);
  }, [customRange]);

  const selectedDeviceIds = useMemo(() => {
    return devices
      .map((device) => device.deviceId)
      .filter((deviceId) => selectedDevices[deviceId]);
  }, [devices, selectedDevices]);

  const filteredItems = useMemo(() => {
    if (!Array.isArray(items) || items.length === 0) return [];
    if (customRangeError) return [];

    const nowMs = Date.now();
    const fromMs = customRange.from
      ? new Date(customRange.from).getTime()
      : -Infinity;
    const toMs = customRange.to ? new Date(customRange.to).getTime() : Infinity;

    return items.filter((item) => {
      if (!selectedDevices[item.deviceId]) return false;

      const time = new Date(item.receivedAt).getTime();
      if (Number.isNaN(time)) return false;

      if (customRangeActive) {
        return time >= fromMs && time <= toMs;
      }

      return nowMs - time <= DEFAULT_WINDOW_MS;
    });
  }, [items, selectedDevices, customRange, customRangeActive, customRangeError]);

  const spanMs = useMemo(() => {
    if (filteredItems.length === 0) return DEFAULT_WINDOW_MS;

    const firstTs = customRange.from
      ? new Date(customRange.from).getTime()
      : new Date(filteredItems[0]?.receivedAt).getTime();

    const lastTs = customRange.to
      ? new Date(customRange.to).getTime()
      : new Date(filteredItems[filteredItems.length - 1]?.receivedAt).getTime();

    if (!Number.isFinite(firstTs) || !Number.isFinite(lastTs) || lastTs <= firstTs) {
      return DEFAULT_WINDOW_MS;
    }

    return lastTs - firstTs;
  }, [filteredItems, customRange.from, customRange.to]);

  const chartData = useMemo(() => {
    if (filteredItems.length === 0) return [];

    const bucketMs = getBucketMs(spanMs);
    const grouped = new Map();

    filteredItems.forEach((item) => {
      const itemTs = new Date(item.receivedAt).getTime();
      if (Number.isNaN(itemTs)) return;

      const bucketTs = Math.floor(itemTs / bucketMs) * bucketMs;

      if (!grouped.has(bucketTs)) {
        grouped.set(bucketTs, {
          ts: bucketTs,
          label: formatXAxisLabel(bucketTs, customRangeActive, spanMs),
          receivedAt: new Date(bucketTs).toISOString(),
        });
      }

      const row = grouped.get(bucketTs);
      const metrics = deviceMetricsMap[item.deviceId] || [];

      metrics.forEach((metricKey) => {
        const rawValue = item[metricKey];
        const numeric =
          rawValue === null || rawValue === undefined ? null : Number(rawValue);

        row[buildSeriesKey(item.deviceId, metricKey)] = Number.isNaN(numeric)
          ? null
          : numeric;
      });
    });

    const rows = Array.from(grouped.values()).sort((a, b) => a.ts - b.ts);
    return reducePoints(rows);
  }, [filteredItems, deviceMetricsMap, customRangeActive, spanMs]);

  const visibleSeriesByMetric = useMemo(() => {
    const result = {};

    METRICS.forEach((metric) => {
      result[metric.key] = devices
        .filter((device) => selectedDevices[device.deviceId])
        .filter((device) => (deviceMetricsMap[device.deviceId] || []).includes(metric.key))
        .map((device) => ({
          key: buildSeriesKey(device.deviceId, metric.key),
          deviceId: device.deviceId,
          metricKey: metric.key,
          name: getDeviceLabel(device),
          color: deviceColorMap[device.deviceId] || "#64748b",
        }));
    });

    return result;
  }, [devices, selectedDevices, deviceMetricsMap, deviceColorMap]);

  const handleRangeChange = (field, value) => {
    setCustomRange((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const clearRange = () => {
    setCustomRange({ from: "", to: "" });
  };

  const toggleDevice = (deviceId) => {
    setSelectedDevices((prev) => ({
      ...prev,
      [deviceId]: !prev[deviceId],
    }));
  };

  const showAllDevices = () => {
    const next = {};
    devices.forEach((device) => {
      next[device.deviceId] = true;
    });
    setSelectedDevices(next);
  };

  const hideAllDevices = () => {
    const next = {};
    devices.forEach((device) => {
      next[device.deviceId] = false;
    });
    setSelectedDevices(next);
  };

  const activeDevicesCount = useMemo(() => {
    return devices.filter((device) => latestMap[device.deviceId]).length;
  }, [devices, latestMap]);

  return (
    <div className="app-shell" translate="no">
      <header className="top-header">
        <div className="brand-box" translate="no">
          VIVA
        </div>

        <div className="title-box">
          <h1>Sistema de monitoreo ambiental</h1>
          <h2>LoRaWAN</h2>
        </div>

        <div className="header-status">
          <span className="status-bullet online-bullet" />
          <span>Sistema en línea</span>
        </div>
      </header>

      {(error || customRangeError) && (
        <div className="alert-box">Error: {customRangeError || error}</div>
      )}

      <section className="section-card">
        <div className="section-title center-title">
          <h3>Datos en tiempo real</h3>
          <p>Vista resumida por dispositivo</p>
        </div>

        <div className="realtime-table">
          <div className="realtime-header">
            <div>Dispositivo</div>
            <div>Temperatura</div>
            <div>Humedad</div>
            <div>Radiación UV</div>
            <div>Sonido</div>
            <div>Estado</div>
          </div>

          <div className="realtime-body">
            {devices.map((device) => (
              <RealtimeRow
                key={device.deviceId}
                device={device}
                latest={latestMap[device.deviceId]}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="section-card chart-section">
        <div className="chart-head">
          <div>
            <h3>Gráficas principales en tiempo real</h3>
            <p>
              Activa uno o varios dispositivos para compararlos sobre las mismas
              gráficas en tiempo real.
            </p>
          </div>

          <div className="range-box">
            <div className="range-title">Rango personalizado</div>

            <div className="range-inputs">
              <label>
                <span>Desde</span>
                <input
                  type="datetime-local"
                  value={customRange.from}
                  onChange={(e) => handleRangeChange("from", e.target.value)}
                />
              </label>

              <label>
                <span>Hasta</span>
                <input
                  type="datetime-local"
                  value={customRange.to}
                  onChange={(e) => handleRangeChange("to", e.target.value)}
                />
              </label>
            </div>

            {(customRange.from || customRange.to) && (
              <button type="button" className="clear-range-btn" onClick={clearRange}>
                Limpiar rango
              </button>
            )}
          </div>
        </div>

        <div className="device-toggle-wrap">
          <div className="selector-actions">
            <button type="button" className="action-btn primary-btn" onClick={showAllDevices}>
              Mostrar todos
            </button>
            <button type="button" className="action-btn" onClick={hideAllDevices}>
              Ocultar todos
            </button>
          </div>

          <div className="device-toggle-bar">
            {devices.map((device) => {
              const checked = Boolean(selectedDevices[device.deviceId]);
              const color = deviceColorMap[device.deviceId] || "#64748b";

              return (
                <label
                  className={`device-toggle-chip ${checked ? "active" : ""}`}
                  key={device.deviceId}
                  translate="no"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleDevice(device.deviceId)}
                  />
                  <span className="device-toggle-name">{getDeviceLabel(device)}</span>
                  <span
                    className="device-toggle-color"
                    style={{ backgroundColor: color }}
                  />
                </label>
              );
            })}
          </div>
        </div>

        <div className="metrics-grid">
          {METRICS.map((metric) => (
            <div className="metric-chart-card" key={metric.key}>
              <div className="metric-chart-title">
                <h4>{metric.title}</h4>
                <span>
                  {(visibleSeriesByMetric[metric.key] || []).length} dispositivo(s)
                </span>
              </div>

              <MetricChart
                metric={metric}
                data={chartData}
                series={visibleSeriesByMetric[metric.key] || []}
                loading={loading}
              />
            </div>
          ))}
        </div>
      </section>

      <footer className="footer-box">
        <div className="footer-brand" translate="no">
          VIVA
        </div>

        <div className="footer-info">
          <h4>Monitoreo ambiental LoRaWAN</h4>
          <p>Panel web para supervisión de variables ambientales en tiempo real.</p>
        </div>

        <div className="footer-stats">
          <div className="footer-chip">
            <strong>{devices.length}</strong>
            <span>Dispositivos</span>
          </div>
          <div className="footer-chip">
            <strong>{activeDevicesCount}</strong>
            <span>Con datos</span>
          </div>
          <div className="footer-chip">
            <strong>{selectedDeviceIds.length}</strong>
            <span>Seleccionados</span>
          </div>
        </div>

        <div className="footer-update">
          Última actualización: {lastUpdated ? formatDate(lastUpdated) : "--"}
        </div>
      </footer>
    </div>
  );
}