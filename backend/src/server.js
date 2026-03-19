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

/* =========================
   CATÁLOGO DE DISPOSITIVOS
========================= */

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

/* =========================
   REGLAS DE ALERTA
========================= */

const ALERT_RULES = {
  temperatura: {
    idealMin: 19,
    idealMax: 27,
    elevatedMax: 32,
    unit: "°C"
  },
  humedad: {
    idealMin: 33,
    idealMax: 70,
    unit: "%"
  }
};

const SEVERITY_RANK = {
  unknown: -1,
  ideal: 0,
  baja: 1,
  elevado: 2,
  critico: 3
};

/**
 * Cache en memoria para detectar cambios de estado.
 * Más adelante aquí es donde debes enganchar WhatsApp
 * para enviar solo cuando cambie el nivel.
 */
const alertStateCache = new Map();

/* =========================
   APP
========================= */

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

/* =========================
   HELPERS GENERALES
========================= */

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

function isValidDate(date) {
  return date instanceof Date && !Number.isNaN(date.getTime());
}

function normalizeDeviceId(value) {
  if (!value || typeof value !== "string") return "";
  return value.trim();
}

function decodeFrmPayloadUtf8(frmPayload) {
  try {
    if (!frmPayload) return "";
    return Buffer.from(frmPayload, "base64").toString("utf8").trim();
  } catch {
    return "";
  }
}

function decodeFrmPayloadHex(frmPayload) {
  try {
    if (!frmPayload) return "";
    return Buffer.from(frmPayload, "base64").toString("hex");
  } catch {
    return "";
  }
}

function parseRawMessage(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";

  const get = (label) => {
    const match = text.match(new RegExp(`${label}:\\s*([-\\d.]+)`, "i"));
    return match ? toNumber(match[1]) : null;
  };

  return {
    temperatura: get("T"),
    humedad: get("H"),
    radiacion_uv: get("R"),
    sonido: get("S"),
    voltaje: get("V")
  };
}

function getDecodedValue(decoded, candidates) {
  return toNumber(firstDefined(decoded, candidates));
}

function pickMetric(decoded, parsedRaw, decodedKeys, rawKey) {
  const decodedValue = getDecodedValue(decoded, decodedKeys);
  if (decodedValue !== null) return decodedValue;
  return parsedRaw[rawKey] ?? null;
}

/* =========================
   HELPERS DE ALERTA
========================= */

function buildMetricStatusBase(metric, value, unit) {
  return {
    metric,
    value: value ?? null,
    unit,
    level: "unknown",
    label: "Sin dato",
    color: "secondary",
    modalColor: "secondary",
    shouldAlert: false,
    message: `Sin dato de ${metric}`
  };
}

function evaluateTemperatura(value, deviceId, deviceLabel) {
  const n = toNumber(value);
  const unit = ALERT_RULES.temperatura.unit;

  if (n === null) {
    return buildMetricStatusBase("temperatura", null, unit);
  }

  if (n > ALERT_RULES.temperatura.elevatedMax) {
    return {
      metric: "temperatura",
      value: n,
      unit,
      level: "critico",
      label: "Crítico",
      color: "danger",
      modalColor: "danger",
      shouldAlert: true,
      message: `Temperatura crítica en ${deviceLabel || deviceId}: ${n} ${unit}`
    };
  }

  if (n > ALERT_RULES.temperatura.idealMax && n <= ALERT_RULES.temperatura.elevatedMax) {
    return {
      metric: "temperatura",
      value: n,
      unit,
      level: "elevado",
      label: "Elevado",
      color: "warning",
      modalColor: "warning",
      shouldAlert: true,
      message: `Temperatura elevada en ${deviceLabel || deviceId}: ${n} ${unit}`
    };
  }

  if (n >= ALERT_RULES.temperatura.idealMin && n <= ALERT_RULES.temperatura.idealMax) {
    return {
      metric: "temperatura",
      value: n,
      unit,
      level: "ideal",
      label: "Ideal",
      color: "success",
      modalColor: "success",
      shouldAlert: false,
      message: `Temperatura ideal en ${deviceLabel || deviceId}: ${n} ${unit}`
    };
  }

  return {
    metric: "temperatura",
    value: n,
    unit,
    level: "baja",
    label: "Baja",
    color: "info",
    modalColor: "info",
    shouldAlert: false,
    message: `Temperatura baja en ${deviceLabel || deviceId}: ${n} ${unit}`
  };
}

function evaluateHumedad(value, deviceId, deviceLabel) {
  const n = toNumber(value);
  const unit = ALERT_RULES.humedad.unit;

  if (n === null) {
    return buildMetricStatusBase("humedad", null, unit);
  }

  if (n > ALERT_RULES.humedad.idealMax) {
    return {
      metric: "humedad",
      value: n,
      unit,
      level: "critico",
      label: "Crítico",
      color: "danger",
      modalColor: "danger",
      shouldAlert: true,
      message: `Humedad crítica en ${deviceLabel || deviceId}: ${n} ${unit}`
    };
  }

  if (n >= ALERT_RULES.humedad.idealMin && n <= ALERT_RULES.humedad.idealMax) {
    return {
      metric: "humedad",
      value: n,
      unit,
      level: "ideal",
      label: "Ideal",
      color: "success",
      modalColor: "success",
      shouldAlert: false,
      message: `Humedad ideal en ${deviceLabel || deviceId}: ${n} ${unit}`
    };
  }

  return {
    metric: "humedad",
    value: n,
    unit,
    level: "baja",
    label: "Baja",
    color: "info",
    modalColor: "info",
    shouldAlert: false,
    message: `Humedad baja en ${deviceLabel || deviceId}: ${n} ${unit}`
  };
}

function buildAlertsFromMeasurement(doc) {
  const deviceId = doc?.deviceId || "desconocido";
  const deviceLabel = DEVICE_CATALOG[deviceId]?.label || deviceId;

  const temperaturaStatus = evaluateTemperatura(doc?.temperatura, deviceId, deviceLabel);
  const humedadStatus = evaluateHumedad(doc?.humedad, deviceId, deviceLabel);

  const alerts = [temperaturaStatus, humedadStatus]
    .filter((item) => item.shouldAlert)
    .map((item) => ({
      metric: item.metric,
      value: item.value,
      unit: item.unit,
      level: item.level,
      label: item.label,
      color: item.color,
      modalColor: item.modalColor,
      message: item.message
    }));

  const highestSeverity = [temperaturaStatus, humedadStatus].reduce((acc, curr) => {
    const accRank = SEVERITY_RANK[acc.level] ?? -1;
    const currRank = SEVERITY_RANK[curr.level] ?? -1;
    return currRank > accRank ? curr : acc;
  }, buildMetricStatusBase("none", null, ""));

  return {
    temperatura: temperaturaStatus,
    humedad: humedadStatus,
    hasAlerts: alerts.length > 0,
    highestSeverity: highestSeverity.level,
    alerts
  };
}

function buildEmptyAlertBundle() {
  return {
    temperatura: buildMetricStatusBase("temperatura", null, ALERT_RULES.temperatura.unit),
    humedad: buildMetricStatusBase("humedad", null, ALERT_RULES.humedad.unit),
    hasAlerts: false,
    highestSeverity: "unknown",
    alerts: []
  };
}

function trackAlertTransitions(doc, alertBundle) {
  const candidates = [alertBundle.temperatura, alertBundle.humedad];

  candidates.forEach((status) => {
    const key = `${doc.deviceId}:${status.metric}`;
    const previousLevel = alertStateCache.get(key) || "unknown";
    const currentLevel = status.level;

    if (previousLevel !== currentLevel) {
      alertStateCache.set(key, currentLevel);

      if (status.shouldAlert) {
        console.warn(
          `[ALERTA] ${doc.deviceId} | ${status.metric} | ${previousLevel} -> ${currentLevel} | valor=${status.value}${status.unit}`
        );

        /**
         * AQUÍ va tu futura integración con WhatsApp
         * Solo se ejecutará cuando cambie el estado,
         * no en cada minuto repetido.
         */
      } else if (previousLevel === "elevado" || previousLevel === "critico") {
        console.log(
          `[ALERTA RESUELTA] ${doc.deviceId} | ${status.metric} | ${previousLevel} -> ${currentLevel}`
        );
      }
    }
  });
}

/* =========================
   DOCUMENTO DE MEDICIÓN
========================= */

function buildMeasurementDoc(data) {
  const deviceId = normalizeDeviceId(data?.end_device_ids?.device_id);
  const config = DEVICE_CATALOG[deviceId];

  if (!config) {
    return null;
  }

  const applicationId =
    data?.end_device_ids?.application_ids?.application_id?.trim() || "";

  const devEui = data?.end_device_ids?.dev_eui?.trim() || "";
  const uplink = data?.uplink_message || {};
  const decoded =
    uplink.decoded_payload && typeof uplink.decoded_payload === "object"
      ? uplink.decoded_payload
      : {};

  const rx0 = Array.isArray(uplink.rx_metadata) ? uplink.rx_metadata[0] || {} : {};
  const lora = uplink?.settings?.data_rate?.lora || {};
  const frmPayload = uplink.frm_payload || "";
  const rawHex = decodeFrmPayloadHex(frmPayload);

  const rawMessage =
    firstDefined(decoded, ["raw_message", "rawMessage"]) ||
    decodeFrmPayloadUtf8(frmPayload) ||
    "";

  const parsedRaw = parseRawMessage(rawMessage);

  const receivedAt = data?.received_at ? new Date(data.received_at) : new Date();

  const temperatura = pickMetric(
    decoded,
    parsedRaw,
    ["temperatura", "temperature", "temp"],
    "temperatura"
  );

  const humedad = pickMetric(
    decoded,
    parsedRaw,
    ["humedad", "humidity", "hum"],
    "humedad"
  );

  const radiacion_uv =
    config.profile === "full"
      ? pickMetric(
          decoded,
          parsedRaw,
          ["radiacion_uv", "radiacionUV", "radiacionUv", "uv", "uv_index"],
          "radiacion_uv"
        )
      : null;

  const sonido =
    config.profile === "full"
      ? pickMetric(decoded, parsedRaw, ["sonido", "sound", "ruido"], "sonido")
      : null;

  const voltaje =
    config.profile === "full"
      ? pickMetric(
          decoded,
          parsedRaw,
          ["voltaje", "voltage", "battery", "bateria"],
          "voltaje"
        )
      : null;

  return {
    deviceId,
    deviceProfile: config.profile,
    applicationId,
    devEui,
    fCnt: toNumber(uplink.f_cnt),
    receivedAt: isValidDate(receivedAt) ? receivedAt : new Date(),

    temperatura,
    humedad,
    radiacion_uv,
    sonido,
    voltaje,

    rawMessage,
    frmPayload,
    rawHex,

    gatewayId: rx0?.gateway_ids?.gateway_id || "",
    rssi: toNumber(rx0?.rssi),
    snr: toNumber(rx0?.snr),
    frequency: toNumber(uplink?.settings?.frequency),
    spreadingFactor: toNumber(lora?.spreading_factor)
  };
}

async function persistMeasurement(doc) {
  if (doc.fCnt === null || doc.fCnt === undefined) {
    await Measurement.create(doc);
    return;
  }

  await Measurement.findOneAndUpdate(
    {
      applicationId: doc.applicationId,
      deviceId: doc.deviceId,
      fCnt: doc.fCnt
    },
    { $set: doc },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  );
}

/* =========================
   HELPERS DE RESPUESTA
========================= */

async function getLatestDocsByDevice() {
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

  return Object.fromEntries(latestDocs.map((item) => [item._id, item.latest]));
}

function buildDeviceLatestResponse(deviceId, latest) {
  const config = DEVICE_CATALOG[deviceId];
  const alertBundle = latest ? buildAlertsFromMeasurement(latest) : buildEmptyAlertBundle();

  return {
    deviceId,
    label: config.label,
    profile: config.profile,
    variables: config.variables,
    latest: latest || null,
    alertStatus: {
      temperatura: alertBundle.temperatura,
      humedad: alertBundle.humedad,
      hasAlerts: alertBundle.hasAlerts,
      highestSeverity: alertBundle.highestSeverity
    },
    alerts: alertBundle.alerts
  };
}

/* =========================
   ENDPOINTS
========================= */

app.get("/api/health", async (req, res) => {
  try {
    const total = await Measurement.countDocuments({
      deviceId: { $in: DEVICE_IDS }
    });

    res.json({
      ok: true,
      service: "backend-ttn-mongodb",
      expectedDevices: DEVICE_IDS.length,
      devices: DEVICE_IDS,
      totalMeasurements: total,
      time: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
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
    const latestMap = await getLatestDocsByDevice();

    const response = DEVICE_IDS.map((deviceId) =>
      buildDeviceLatestResponse(deviceId, latestMap[deviceId] || null)
    );

    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/alerts/active", async (req, res) => {
  try {
    const latestMap = await getLatestDocsByDevice();

    const devices = DEVICE_IDS.map((deviceId) =>
      buildDeviceLatestResponse(deviceId, latestMap[deviceId] || null)
    );

    const items = devices
      .flatMap((device) =>
        (device.alerts || []).map((alert) => ({
          deviceId: device.deviceId,
          deviceLabel: device.label,
          receivedAt: device.latest?.receivedAt || null,
          ...alert
        }))
      )
      .sort((a, b) => {
        const rankA = SEVERITY_RANK[a.level] ?? -1;
        const rankB = SEVERITY_RANK[b.level] ?? -1;

        if (rankA !== rankB) return rankB - rankA;

        const timeA = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
        const timeB = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
        return timeB - timeA;
      });

    res.json({
      total: items.length,
      items
    });
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

    if (!item) {
      return res.json(null);
    }

    const plain = item.toObject();
    const alertBundle = buildAlertsFromMeasurement(plain);

    res.json({
      ...plain,
      alertStatus: {
        temperatura: alertBundle.temperatura,
        humedad: alertBundle.humedad,
        hasAlerts: alertBundle.hasAlerts,
        highestSeverity: alertBundle.highestSeverity
      },
      alerts: alertBundle.alerts
    });
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

  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 30000
  });

  console.log("Conectado a MongoDB");

  await Measurement.syncIndexes();
  console.log("Índices sincronizados en MongoDB");
}

/* =========================
   MQTT TTN
========================= */

function startMqtt() {
  const username = `${process.env.TTN_APP_ID}@${process.env.TTN_TENANT || "ttn"}`;
  const topic = `v3/${username}/devices/+/up`;

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
        console.log("Suscripción exitosa a todos los dispositivos");
      }
    });
  });

  client.on("message", async (topicName, messageBuffer) => {
    try {
      const text = messageBuffer.toString("utf8");
      const data = JSON.parse(text);

      const incomingDeviceId = normalizeDeviceId(
        data?.end_device_ids?.device_id || "desconocido"
      );

      console.log(`[MQTT] topic=${topicName} device=${incomingDeviceId}`);

      const doc = buildMeasurementDoc(data);

      if (!doc) {
        console.warn(
          `[MQTT] uplink ignorado de '${incomingDeviceId}': no está en el catálogo`
        );
        return;
      }

      await persistMeasurement(doc);

      const alertBundle = buildAlertsFromMeasurement(doc);
      trackAlertTransitions(doc, alertBundle);

      console.log(
        `[MONGO] guardado device=${doc.deviceId} fCnt=${doc.fCnt} temp=${doc.temperatura} hum=${doc.humedad}`
      );
    } catch (error) {
      if (error?.code === 11000) {
        console.warn("[MONGO] duplicado ignorado");
        return;
      }

      console.error("Error procesando mensaje MQTT:", error);
    }
  });

  client.on("error", (err) => {
    console.error("MQTT error:", err.message);
  });

  client.on("reconnect", () => {
    console.log("Reconectando a MQTT...");
  });

  client.on("close", () => {
    console.log("Conexión MQTT cerrada");
  });

  client.on("offline", () => {
    console.log("MQTT offline");
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