import { useEffect, useState } from "react";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL;

function MetricCard({ title, value, unit }) {
  return (
    <div className="card metric-card">
      <h3>{title}</h3>
      <p className="metric-value">
        {value ?? "--"} {unit || ""}
      </p>
    </div>
  );
}

function App() {
  const [latest, setLatest] = useState(null);
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

  async function loadData() {
    try {
      setError("");

      const [latestRes, listRes, statsRes] = await Promise.all([
        fetch(`${API_URL}/api/measurements/latest`),
        fetch(`${API_URL}/api/measurements?limit=20`),
        fetch(`${API_URL}/api/measurements/stats`)
      ]);

      if (!latestRes.ok || !listRes.ok || !statsRes.ok) {
        throw new Error("No se pudo cargar la API");
      }

      const latestData = await latestRes.json();
      const listData = await listRes.json();
      const statsData = await statsRes.json();

      setLatest(latestData);
      setItems(listData);
      setStats(statsData);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadData();
    const id = setInterval(loadData, 10000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="container">
      <header className="header">
        <h1>Dashboard IoT LoRaWAN</h1>
        <p>TTN → Node.js → MongoDB → React</p>
      </header>

      {error && <div className="error">Error: {error}</div>}

      {stats && (
        <section className="grid">
          <MetricCard title="Registros totales" value={stats.total} />
          <MetricCard title="Último dispositivo" value={stats.latestDevice} />
          <MetricCard
            title="Última actualización"
            value={
              stats.latestTimestamp
                ? new Date(stats.latestTimestamp).toLocaleString()
                : "--"
            }
          />
        </section>
      )}

      {latest && (
        <>
          <section className="grid">
            <MetricCard title="Temperatura" value={latest.temperatura} unit="°C" />
            <MetricCard title="Humedad" value={latest.humedad} unit="%" />
            <MetricCard title="Radiación UV" value={latest.radiacion_uv} />
            <MetricCard title="Sonido" value={latest.sonido} />
            <MetricCard title="Voltaje" value={latest.voltaje} unit="V" />
            <MetricCard title="RSSI" value={latest.rssi} unit="dBm" />
            <MetricCard title="SNR" value={latest.snr} unit="dB" />
          </section>

          <section className="card">
            <h2>Última medición</h2>
            <p><strong>Dispositivo:</strong> {latest.deviceId}</p>
            <p><strong>Gateway:</strong> {latest.gatewayId}</p>
            <p><strong>Fecha:</strong> {new Date(latest.receivedAt).toLocaleString()}</p>
            <p><strong>Payload Base64:</strong> {latest.frmPayload}</p>
            <p><strong>Payload Hex:</strong> {latest.rawHex}</p>
          </section>
        </>
      )}

      <section className="card">
        <h2>Últimos registros</h2>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Dispositivo</th>
                <th>Temp</th>
                <th>Hum</th>
                <th>UV</th>
                <th>Sonido</th>
                <th>Voltaje</th>
                <th>RSSI</th>
                <th>SNR</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.deviceId}-${item.fCnt}`}>
                  <td>{new Date(item.receivedAt).toLocaleString()}</td>
                  <td>{item.deviceId}</td>
                  <td>{item.temperatura}</td>
                  <td>{item.humedad}</td>
                  <td>{item.radiacion_uv}</td>
                  <td>{item.sonido}</td>
                  <td>{item.voltaje}</td>
                  <td>{item.rssi}</td>
                  <td>{item.snr}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default App;
