require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const mqtt = require("mqtt");
const Measurement = require("./models/Measurement");

const requiredEnv = [
  "MONGODB_URI",
  "TTN_MQTT_HOST",
  "TTN_APP_ID",
  "TTN_API_KEY"
];

const missingEnv = requiredEnv.filter((name) => !process.env[name]);

if (missingEnv.length > 0) {
  console.error("Faltan variables de entorno:", missingEnv.join(", "));
  process.exit(1);
}

/**
 * Catálogo de dispositivos esperados
 * Ajusta aquí si tus IDs reales en TTN son distintos.
 */
const DEVICE_CATALOG = {
  "dispositivo-1n": {
    label: "Dispositivo 1",
    profile: "full",
    variables: ["temperatura", "humedad", "radiacion_uv", "sonido", "voltaje"]
  },
  "dispositivo-2": {
    label: "Dispositivo 2",
    profile: "full",
    variables: ["temperatura", "humedad", "radiacion_uv", "sonido", "voltaje"]
  },
  "dispositivo-3": {
    label: "Dispositivo 3",
    profile: "basic",
    variables: ["temperatura", "humedad"]
  },
  "dispositivo-4": {
    label: "Dispositivo 4",
    profile: "basic",
    variables: ["temperatura", "humedad"]
  },
  "dispositivo-5": {
    label: "Dispositivo 5",
    profile: "basic",
    variables: ["temperatura", "humedad"]
  },
  "dispositivo-6": {
    label: "Dispositivo 6",
    profile: "basic",
    variables: ["temperatura", "humedad"]
  }
};

const DEVICE_IDS = Object.keys(DEVICE_CATALOG);

const app = express();
app.use(express.json());

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((v) => v.trim())
  : "*";

app.use(
  cors({
    origin: allowedOrigins
  })
);

function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstDefined(obj, keys = []) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== "") {
      return obj[key];
    }
  }
  return null;
}

function getDecodedValue(decoded, candidates) {
  return toNumber(firstDefined(decoded, candidates));
}

function isValidDate(date) {
  return date instanceof Date && !Number.isNaN(date.getTime());
}

function buildMeasurementDoc(data) {
  const deviceId = data.end_device_ids?.device_id || "desconocido";
  const config = DEVICE_CATALOG[deviceId];

  // Si quieres aceptar cualquier dispositivo, aquí podrías quitar esta validación.
  if (!config) {
    return null;
  }

  const applicationId =
    data.end_device_ids?.application_ids?.application_id || "";
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

  const temperatura = getDecodedValue(decoded, [
    "temperatura",
    "temperature",
    "temp"
  ]);

  const humedad = getDecodedValue(decoded, [
    "humedad",
    "humidity",
    "hum"
  ]);

  const radiacion_uv =
    config.profile === "full"
      ? getDecodedValue(decoded, [
          "radiacion_uv",
          "radiacionUV",
          "radiacionUv",
          "uv",
          "uv_index"
        ])
      : null;

  const sonido =
    config.profile === "full"
      ? getDecodedValue(decoded, [
          "sonido",
          "sound",
          "ruido"
        ])
      : null;

  const voltaje =
    config.profile === "full"
      ? getDecodedValue(decoded, [
          "voltaje",
          "voltage",
          "battery",
          "bateria"
        ])
      : null;

  return {
    deviceId,
    deviceProfile: config.profile,
    applicationId,
    devEui,
    fCnt: uplink.f_cnt ?? null,
    receivedAt: isValidDate(receivedAt) ? receivedAt : new Date(),

    temperatura,
    humedad,
    radiacion_uv,
    sonido,
    voltaje,

    rawMessage: firstDefined(decoded, ["raw_message", "rawMessage"]) || "",
    frmPayload,
    rawHex,

    gatewayId: rx0.gateway_ids?.gateway_id ?? "",
    rssi: toNumber(rx0.rssi),
    snr: toNumber(rx0.snr),
    frequency: toNumber(uplink.settings?.frequency),
    spreadingFactor: toNumber(lora.spreading_factor)
  };
}

async function persistMeasurement(doc) {
  // Si no llega fCnt, guarda como documento nuevo
  if (doc.fCnt === null || doc.fCnt === undefined) {
    await Measurement.create(doc);
    return;
  }

  await Measurement.updateOne(
    { deviceId: doc.deviceId, fCnt: doc.fCnt },
    { $set: doc },
    { upsert: true }
  );
}

/* =========================
   ENDPOINTS
========================= */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "backend-ttn-mongodb",
    expectedDevices: DEVICE_IDS.length,
    devices: DEVICE_IDS,
    time: new Date().toISOString()
  });
});

app.get("/api/devices/config", (req, res) => {
  const devices = DEVICE_IDS.map((deviceId) => ({
    deviceId,
    label: DEVICE_CATALOG[deviceId].label,
    profile: DEVICE_CATALOG[deviceId].profile,
    variables: DEVICE_CATALOG[deviceId].variables
  }));

  res.json(devices);
});

app.get("/api/devices/latest", async (req, res) => {
  try {
    const latestDocs = await Measurement.aggregate([
      {
        $match: {
          deviceId: { $in: DEVICE_IDS }
        }
      },
      {
        $sort: {
          receivedAt: -1,
          createdAt: -1
        }
      },
      {
        $group: {
          _id: "$deviceId",
          latest: { $first: "$$ROOT" }
        }
      }
    ]);

    const latestMap = Object.fromEntries(
      latestDocs.map((item) => [item._id, item.latest])
    );

    const response = DEVICE_IDS.map((deviceId) => ({
      deviceId,
      label: DEVICE_CATALOG[deviceId].label,
      profile: DEVICE_CATALOG[deviceId].profile,
      variables: DEVICE_CATALOG[deviceId].variables,
      latest: latestMap[deviceId] || null
    }));

    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/measurements/latest", async (req, res) => {
  try {
    const deviceId = req.query.deviceId;
    const filter = {};

    if (deviceId) {
      filter.deviceId = deviceId;
    }

    const item = await Measurement.findOne(filter).sort({
      receivedAt: -1,
      createdAt: -1
    });

    res.json(item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/measurements", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || "500", 10), 5000);
    const sort = req.query.sort === "asc" ? 1 : -1;

    const deviceIdParam = req.query.deviceId;
    const fromParam = req.query.from;
    const toParam = req.query.to;

    const filter = {};

    if (deviceIdParam) {
      const deviceIds = deviceIdParam
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);

      if (deviceIds.length === 1) {
        filter.deviceId = deviceIds[0];
      } else if (deviceIds.length > 1) {
        filter.deviceId = { $in: deviceIds };
      }
    }

    if (fromParam || toParam) {
      filter.receivedAt = {};

      if (fromParam) {
        const from = new Date(fromParam);
        if (!isValidDate(from)) {
          return res.status(400).json({ error: "Fecha 'from' inválida" });
        }
        filter.receivedAt.$gte = from;
      }

      if (toParam) {
        const to = new Date(toParam);
        if (!isValidDate(to)) {
          return res.status(400).json({ error: "Fecha 'to' inválida" });
        }
        filter.receivedAt.$lte = to;
      }
    }

    const items = await Measurement.find(filter)
      .sort({ receivedAt: sort, createdAt: sort })
      .limit(limit);

    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/measurements/stats", async (req, res) => {
  try {
    const total = await Measurement.countDocuments({
      deviceId: { $in: DEVICE_IDS }
    });

    const latest = await Measurement.findOne({
      deviceId: { $in: DEVICE_IDS }
    }).sort({ receivedAt: -1, createdAt: -1 });

    const byDeviceAgg = await Measurement.aggregate([
      {
        $match: {
          deviceId: { $in: DEVICE_IDS }
        }
      },
      {
        $group: {
          _id: "$deviceId",
          total: { $sum: 1 },
          latestTimestamp: { $max: "$receivedAt" }
        }
      }
    ]);

    const byDeviceMap = Object.fromEntries(
      byDeviceAgg.map((item) => [
        item._id,
        {
          total: item.total,
          latestTimestamp: item.latestTimestamp
        }
      ])
    );

    const devices = DEVICE_IDS.map((deviceId) => ({
      deviceId,
      label: DEVICE_CATALOG[deviceId].label,
      profile: DEVICE_CATALOG[deviceId].profile,
      variables: DEVICE_CATALOG[deviceId].variables,
      total: byDeviceMap[deviceId]?.total || 0,
      latestTimestamp: byDeviceMap[deviceId]?.latestTimestamp || null
    }));

    res.json({
      total,
      latestTimestamp: latest?.receivedAt || null,
      latestDevice: latest?.deviceId || null,
      devices
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* =========================
   MONGODB
========================= */

async function connectMongo() {
  console.log("Intentando conectar a MongoDB...");
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Conectado a MongoDB");
}

/* =========================
   MQTT TTN
========================= */

function startMqtt() {
  const username = `${process.env.TTN_APP_ID}@${process.env.TTN_TENANT || "ttn"}`;
  const topicDevice =
    (process.env.TTN_DEVICE_ID || "+").trim().toLowerCase() === "all"
      ? "+"
      : (process.env.TTN_DEVICE_ID || "+").trim();

  const topic = `v3/${username}/devices/${topicDevice}/up`;

  const client = mqtt.connect(`mqtts://${process.env.TTN_MQTT_HOST}:8883`, {
    username,
    password: process.env.TTN_API_KEY,
    protocolVersion: 4,
    clean: true,
    connectTimeout: 30000,
    reconnectPeriod: 5000
  });

  client.on("connect", () => {
    console.log("MQTT conectado a TTN");
    console.log("Topic:", topic);

    client.subscribe(topic, { qos: 0 }, (err) => {
      if (err) {
        console.error("Error al suscribirse:", err.message);
      } else {
        console.log("Suscripción exitosa");
      }
    });
  });

  client.on("message", async (_topic, messageBuffer) => {
    try {
      const text = messageBuffer.toString("utf8");
      const data = JSON.parse(text);

      const incomingDeviceId = data.end_device_ids?.device_id || "desconocido";
      const doc = buildMeasurementDoc(data);

      if (!doc) {
        console.warn(
          `Uplink ignorado de '${incomingDeviceId}': no está en el catálogo de 6 dispositivos`
        );
        return;
      }

      await persistMeasurement(doc);

      console.log(
        `Guardado uplink ${doc.deviceId} | perfil=${doc.deviceProfile} | fCnt=${doc.fCnt}`
      );
    } catch (error) {
      if (error?.code === 11000) {
        console.warn("Uplink duplicado ignorado");
        return;
      }

      console.error("Error procesando mensaje MQTT:", error.message);
    }
  });

  client.on("error", (err) => {
    console.error("MQTT error:", err.message);
  });

  client.on("reconnect", () => {
    console.log("Reconectando a MQTT...");
  });
}

/* =========================
   START
========================= */

async function startServer() {
  console.log("Iniciando backend...");
  await connectMongo();
  startMqtt();

  const port = process.env.PORT || 10000;
  app.listen(port, "0.0.0.0", () => {
    console.log(`API escuchando en puerto ${port}`);
  });
}

startServer().catch((err) => {
  console.error("Error al iniciar backend:", err);
  process.exit(1);
});