require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const mqtt = require("mqtt");
const Measurement = require("./models/Measurement");

const app = express();

app.use(express.json());

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map(v => v.trim())
  : "*";

app.use(
  cors({
    origin: allowedOrigins
  })
);

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "backend-ttn-mongodb",
    time: new Date().toISOString()
  });
});

app.get("/api/measurements/latest", async (req, res) => {
  try {
    const item = await Measurement.findOne().sort({ receivedAt: -1 });
    res.json(item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/measurements", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || "50", 10), 500);
    const deviceId = req.query.deviceId;

    const filter = {};
    if (deviceId) filter.deviceId = deviceId;

    const items = await Measurement.find(filter)
      .sort({ receivedAt: -1 })
      .limit(limit);

    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/measurements/stats", async (req, res) => {
  try {
    const latest = await Measurement.findOne().sort({ receivedAt: -1 });

    const total = await Measurement.countDocuments();

    res.json({
      total,
      latestTimestamp: latest?.receivedAt || null,
      latestDevice: latest?.deviceId || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function connectMongo() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ MongoDB conectado");
}

function startMqtt() {
  const username = `${process.env.TTN_APP_ID}@${process.env.TTN_TENANT || "ttn"}`;
  const topic = `v3/${username}/devices/${process.env.TTN_DEVICE_ID || "+"}/up`;

  const client = mqtt.connect(`mqtts://${process.env.TTN_MQTT_HOST}:8883`, {
    username,
    password: process.env.TTN_API_KEY,
    protocolVersion: 4,
    clean: true,
    connectTimeout: 30000,
    reconnectPeriod: 5000
  });

  client.on("connect", () => {
    console.log("✅ MQTT conectado a TTN");
    console.log("📡 Topic:", topic);

    client.subscribe(topic, { qos: 0 }, err => {
      if (err) {
        console.error("❌ Error al suscribirse:", err.message);
      } else {
        console.log("✅ Suscripción exitosa");
      }
    });
  });

  client.on("message", async (_topic, messageBuffer) => {
    try {
      const text = messageBuffer.toString("utf8");
      const data = JSON.parse(text);

      const deviceId = data.end_device_ids?.device_id || "desconocido";
      const applicationId = data.end_device_ids?.application_ids?.application_id || "";
      const devEui = data.end_device_ids?.dev_eui || "";
      const receivedAt = data.received_at ? new Date(data.received_at) : new Date();

      const uplink = data.uplink_message || {};
      const decoded = uplink.decoded_payload || {};
      const rx0 = uplink.rx_metadata?.[0] || {};
      const lora = uplink.settings?.data_rate?.lora || {};

      const frmPayload = uplink.frm_payload || "";
      const rawHex = frmPayload
        ? Buffer.from(frmPayload, "base64").toString("hex")
        : "";

      const doc = {
        deviceId,
        applicationId,
        devEui,
        fCnt: uplink.f_cnt,
        receivedAt,

        temperatura: decoded.temperatura ?? null,
        humedad: decoded.humedad ?? null,
        radiacion_uv: decoded.radiacion_uv ?? null,
        sonido: decoded.sonido ?? null,
        voltaje: decoded.voltaje ?? null,

        rawMessage: decoded.raw_message ?? "",
        frmPayload,
        rawHex,

        gatewayId: rx0.gateway_ids?.gateway_id ?? "",
        rssi: rx0.rssi ?? null,
        snr: rx0.snr ?? null,
        frequency: uplink.settings?.frequency
          ? Number(uplink.settings.frequency)
          : null,
        spreadingFactor: lora.spreading_factor ?? null
      };

      await Measurement.updateOne(
        { deviceId: doc.deviceId, fCnt: doc.fCnt },
        { $set: doc },
        { upsert: true }
      );

      console.log(`💾 Guardado uplink ${doc.deviceId} fCnt=${doc.fCnt}`);
    } catch (error) {
      console.error("❌ Error procesando mensaje:", error.message);
    }
  });

  client.on("error", err => {
    console.error("❌ MQTT error:", err.message);
  });

  client.on("reconnect", () => {
    console.log("🔄 Reconectando a MQTT...");
  });
}

async function start() {
  await connectMongo();
  startMqtt();

  const port = process.env.PORT || 10000;
  app.listen(port, "0.0.0.0", () => {
    console.log(`🚀 API en puerto ${port}`);
  });
}

start().catch(err => {
  console.error("❌ Error de arranque:", err);
  process.exit(1);
});
