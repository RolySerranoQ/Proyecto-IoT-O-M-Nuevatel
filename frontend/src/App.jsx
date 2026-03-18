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
    title: "Rad. UV",
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

const METRIC_COLOR_FAMILIES = {
  temperatura: ["#ff6b6b", "#ff8e72", "#ff9f43", "#f97316", "#fb7185", "#ef4444"],
  humedad: ["#3b82f6", "#38bdf8", "#60a5fa", "#2563eb", "#0ea5e9", "#1d4ed8"],
  radiacion_uv: ["#f59e0b", "#facc15", "#eab308", "#fbbf24", "#d97706", "#f4b000"],
  sonido: ["#a855f7", "#c084fc", "#d946ef", "#9333ea", "#8b5cf6", "#b45309"],
};

function getDeviceLabel(deviceOrId) {
  const deviceId =
    typeof deviceOrId === "string" ? deviceOrId : deviceOrId?.deviceId;

  if (!deviceId) return "Sin nombre";
  return DEVICE_LABELS[deviceId] || deviceId;
}

function getMetricMeta(metricKey) {
  return METRICS.find((metric) => metric.key === metricKey) || METRICS[0];
}

function getMetricDigits(metricKey) {
  if (metricKey === "temperatura") return 1;
  if (metricKey === "humedad") return 1;
  if (metricKey === "radiacion_uv") return 1;
  if (metricKey === "sonido") return 1;
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

function getAvailableMetrics(device) {
  const vars = Array.isArray(device?.variables) ? device.variables : [];
  return METRICS.filter((metric) => vars.includes(metric.key)).map(
    (metric) => metric.key
  );
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
  const selectedDevices = {};
  const selectedMetrics = {};

  devices.forEach((device, index) => {
    const metrics = getAvailableMetrics(device);

    selectedDevices[device.deviceId] = index === 0;
    selectedMetrics[device.deviceId] = {};

    metrics.forEach((metricKey) => {
      selectedMetrics[device.deviceId][metricKey] =
        index === 0 && (metricKey === "temperatura" || metricKey === "humedad");
    });
  });

  return { selectedDevices, selectedMetrics };
}

function getSeriesColor(metricKey, deviceId, devices) {
  const deviceIndex = devices.findIndex((d) => d.deviceId === deviceId);
  const family = METRIC_COLOR_FAMILIES[metricKey] || ["#64748b"];
  return family[Math.max(0, deviceIndex) % family.length];
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

export default function App() {
  const [devices, setDevices] = useState([]);
  const [latestDevices, setLatestDevices] = useState([]);
  const [items, setItems] = useState([]);
  const [selectedDevices, setSelectedDevices] = useState({});
  const [selectedMetrics, setSelectedMetrics] = useState({});
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
        if (Object.keys(prev).length > 0) return prev;
        return createInitialSelections(safeDevices).selectedDevices;
      });

      setSelectedMetrics((prev) => {
        if (Object.keys(prev).length > 0) return prev;
        return createInitialSelections(safeDevices).selectedMetrics;
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

  const chartData = useMemo(() => {
    if (filteredItems.length === 0) return [];

    const firstTs = customRange.from
      ? new Date(customRange.from).getTime()
      : new Date(filteredItems[0]?.receivedAt).getTime();

    const lastTs = customRange.to
      ? new Date(customRange.to).getTime()
      : new Date(filteredItems[filteredItems.length - 1]?.receivedAt).getTime();

    const safeSpan =
      Number.isFinite(firstTs) && Number.isFinite(lastTs) && lastTs > firstTs
        ? lastTs - firstTs
        : DEFAULT_WINDOW_MS;

    const bucketMs = getBucketMs(safeSpan);
    const grouped = new Map();

    filteredItems.forEach((item) => {
      const itemTs = new Date(item.receivedAt).getTime();
      if (Number.isNaN(itemTs)) return;

      const bucketTs = Math.floor(itemTs / bucketMs) * bucketMs;

      if (!grouped.has(bucketTs)) {
        grouped.set(bucketTs, {
          ts: bucketTs,
          label: formatXAxisLabel(bucketTs, customRangeActive, safeSpan),
          receivedAt: new Date(bucketTs).toISOString(),
        });
      }

      const row = grouped.get(bucketTs);
      const device = devices.find((d) => d.deviceId === item.deviceId);
      if (!device) return;

      const metrics = getAvailableMetrics(device);

      metrics.forEach((metricKey) => {
        if (!selectedMetrics[item.deviceId]?.[metricKey]) return;

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
  }, [
    filteredItems,
    devices,
    selectedMetrics,
    customRange.from,
    customRange.to,
    customRangeActive,
  ]);

  const visibleSeries = useMemo(() => {
    return devices.flatMap((device) => {
      if (!selectedDevices[device.deviceId]) return [];

      return getAvailableMetrics(device)
        .filter((metricKey) => selectedMetrics[device.deviceId]?.[metricKey])
        .map((metricKey) => {
          const metric = getMetricMeta(metricKey);

          return {
            key: buildSeriesKey(device.deviceId, metricKey),
            deviceId: device.deviceId,
            metricKey,
            name: `${getDeviceLabel(device)} • ${metric.short}`,
            color: getSeriesColor(metricKey, device.deviceId, devices),
          };
        });
    });
  }, [devices, selectedDevices, selectedMetrics]);

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

  const toggleMetric = (deviceId, metricKey) => {
    const nextValue = !selectedMetrics[deviceId]?.[metricKey];

    setSelectedMetrics((prev) => ({
      ...prev,
      [deviceId]: {
        ...(prev[deviceId] || {}),
        [metricKey]: nextValue,
      },
    }));

    if (nextValue) {
      setSelectedDevices((prev) => ({
        ...prev,
        [deviceId]: true,
      }));
    }
  };

  const showAllSeries = () => {
    const nextDevices = {};
    const nextMetrics = {};

    devices.forEach((device) => {
      nextDevices[device.deviceId] = true;
      nextMetrics[device.deviceId] = {};

      getAvailableMetrics(device).forEach((metricKey) => {
        nextMetrics[device.deviceId][metricKey] = true;
      });
    });

    setSelectedDevices(nextDevices);
    setSelectedMetrics(nextMetrics);
  };

  const hideAllSeries = () => {
    const nextDevices = {};
    const nextMetrics = {};

    devices.forEach((device) => {
      nextDevices[device.deviceId] = false;
      nextMetrics[device.deviceId] = {};

      getAvailableMetrics(device).forEach((metricKey) => {
        nextMetrics[device.deviceId][metricKey] = false;
      });
    });

    setSelectedDevices(nextDevices);
    setSelectedMetrics(nextMetrics);
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
            <h3>Gráfica principal en tiempo real</h3>
            <p>
              Selecciona varios dispositivos y variables para compararlos en la
              misma gráfica.
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

        <div className="chart-box">
          {visibleSeries.length > 0 && chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 20, left: 4, bottom: 8 }}>
                <CartesianGrid strokeDasharray="4 4" stroke="#e6eaf2" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  minTickGap={22}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#6b7280" }}
                  width={50}
                />
                <Tooltip
                  labelFormatter={(_, payload) =>
                    payload?.[0]?.payload?.receivedAt
                      ? formatDate(payload[0].payload.receivedAt)
                      : "--"
                  }
                  formatter={(value, _name, entry) => {
                    const series = visibleSeries.find(
                      (item) => item.key === entry?.dataKey
                    );
                    const metric = getMetricMeta(series?.metricKey);

                    return [
                      `${formatValue(value, getMetricDigits(series?.metricKey))} ${
                        metric?.unit || ""
                      }`,
                      series?.name || "",
                    ];
                  }}
                  contentStyle={{
                    borderRadius: "14px",
                    border: "1px solid #dce3ef",
                    background: "#ffffff",
                    boxShadow: "0 12px 30px rgba(15, 23, 42, 0.10)",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                {visibleSeries.map((series) => (
                  <Line
                    key={series.key}
                    type="monotone"
                    dataKey={series.key}
                    name={series.name}
                    stroke={series.color}
                    strokeWidth={2.6}
                    dot={false}
                    connectNulls
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                ))}
                {chartData.length > 16 && (
                  <Brush
                    dataKey="label"
                    height={24}
                    stroke="#8b5cf6"
                    travellerWidth={10}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="chart-empty">
              {loading
                ? "Cargando gráfica..."
                : "Selecciona uno o varios dispositivos y variables para comparar."}
            </div>
          )}
        </div>

        <div className="selector-panel">
          <div className="selector-actions">
            <button type="button" className="action-btn primary-btn" onClick={showAllSeries}>
              Mostrar todas
            </button>
            <button type="button" className="action-btn" onClick={hideAllSeries}>
              Ocultar todas
            </button>
          </div>

          <div className="selector-list">
            {devices.map((device) => {
              const metrics = getAvailableMetrics(device);

              return (
                <div className="selector-row" key={device.deviceId}>
                  <label className="device-selector" translate="no">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedDevices[device.deviceId])}
                      onChange={() => toggleDevice(device.deviceId)}
                    />
                    <span className="device-selector-name">
                      {getDeviceLabel(device)}
                    </span>
                  </label>

                  <div className="metric-selector-group">
                    {metrics.map((metricKey) => {
                      const metric = getMetricMeta(metricKey);
                      const color = getSeriesColor(metricKey, device.deviceId, devices);

                      return (
                        <label
                          key={`${device.deviceId}-${metricKey}`}
                          className="metric-selector"
                        >
                          <input
                            type="checkbox"
                            checked={Boolean(selectedMetrics[device.deviceId]?.[metricKey])}
                            onChange={() => toggleMetric(device.deviceId, metricKey)}
                          />
                          <span
                            className="metric-color-dot"
                            style={{ backgroundColor: color }}
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
            <span>En gráfica</span>
          </div>
        </div>

        <div className="footer-update">
          Última actualización: {lastUpdated ? formatDate(lastUpdated) : "--"}
        </div>
      </footer>
    </div>
  );
}