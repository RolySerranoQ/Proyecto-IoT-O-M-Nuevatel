require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const mqtt = require("mqtt");
const twilio = require("twilio");
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
/*
  Ajusta las claves si en TTN tus device_id reales son otros.
*/
const DEVICE_CATALOG = {
  "dispositivo-1n": {
    label: "Disp. 1",
    profile: "full",
    variables: ["temperatura", "humedad", "radiacion_uv", "sonido", "voltaje"]
  },
  "dispositivo-3": {
    label: "V-One",
    profile: "basic",
    variables: ["temperatura", "humedad"]
  },
  "dispositivo-4": {
    label: "Datacon",
    profile: "basic",
    variables: ["temperatura", "humedad"]
  },
  "dispositivo-5": {
    label: "RNC",
    profile: "basic",
    variables: ["temperatura", "humedad"]
  },
  "dispositivo-6": {
    label: "Casita IT",
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

const alertStateCache = new Map();

/* =========================
   WHATSAPP / TWILIO
========================= */

const whatsappClient =
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

const whatsappCooldownCache = new Map();

function isWhatsAppEnabled() {
  return Boolean(
    whatsappClient &&
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_WHATSAPP_FROM
  );
}

function normalizeWhatsAppNumber(value) {
  if (!value || typeof value !== "string") return "";
  const clean = value.trim();
  if (!clean) return "";
  return clean.startsWith("whatsapp:") ? clean : `whatsapp:${clean}`;
}

function getWhatsAppFrom() {
  return normalizeWhatsAppNumber(process.env.TWILIO_WHATSAPP_FROM);
}

function getWhatsAppAlertRecipients() {
  return (process.env.WHATSAPP_ALERT_TO || "")
    .split(",")
    .map((v) => normalizeWhatsAppNumber(v))
    .filter(Boolean);
}

function getWhatsAppCooldownMs() {
  const value = Number(process.env.WHATSAPP_ALERT_COOLDOWN_MS || "900000");
  return Number.isFinite(value) && value >= 0 ? value : 900000;
}

function isWhatsAppCooldownActive(key) {
  const now = Date.now();
  const expiresAt = whatsappCooldownCache.get(key);

  if (!expiresAt) return false;
  if (expiresAt <= now) {
    whatsappCooldownCache.delete(key);
    return false;
  }

  return true;
}

function activateWhatsAppCooldown(key, ms = getWhatsAppCooldownMs()) {
  whatsappCooldownCache.set(key, Date.now() + ms);
}

function formatWhatsAppDate(value) {
  const d = new Date(value || Date.now());

  if (Number.isNaN(d.getTime())) {
    return new Date().toLocaleString("es-BO", {
      timeZone: process.env.APP_TIMEZONE || "America/La_Paz",
      hour12: false
    });
  }

  return d.toLocaleString("es-BO", {
    timeZone: process.env.APP_TIMEZONE || "America/La_Paz",
    hour12: false
  });
}

function buildWhatsAppAlertMessage({ doc, status, previousLevel, isResolved = false }) {
  const deviceLabel = DEVICE_CATALOG[doc.deviceId]?.label || doc.deviceId;
  const value = status.value ?? "N/D";
  const unit = status.unit || "";
  const when = formatWhatsAppDate(doc.receivedAt);

  if (isResolved) {
    return [
      "✅ ALERTA RESUELTA",
      `Dispositivo: ${deviceLabel} (${doc.deviceId})`,
      `Variable: ${status.metric}`,
      `Estado anterior: ${previousLevel}`,
      `Estado actual: ${status.level}`,
      `Valor actual: ${value} ${unit}`.trim(),
      `Fecha: ${when}`
    ].join("\n");
  }

  return [
    "🚨 ALERTA",
    `Dispositivo: ${deviceLabel} (${doc.deviceId})`,
    `Variable: ${status.metric}`,
    `Nivel: ${status.label}`,
    `Transición: ${previousLevel} -> ${status.level}`,
    `Valor: ${value} ${unit}`.trim(),
    `Fecha: ${when}`
  ].join("\n");
}

async function sendWhatsAppMessage({ to, body, contentSid, contentVariables }) {
  if (!isWhatsAppEnabled()) {
    throw new Error(
      "Twilio WhatsApp no está configurado. Revisa TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN y TWILIO_WHATSAPP_FROM."
    );
  }

  const payload = {
    from: getWhatsAppFrom(),
    to: normalizeWhatsAppNumber(to)
  };

  if (!payload.to) {
    throw new Error("Número destino inválido para WhatsApp.");
  }

  if (process.env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL) {
    payload.statusCallback = process.env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL;
  }

  if (contentSid) {
    payload.contentSid = contentSid;
    if (contentVariables) {
      payload.contentVariables =
        typeof contentVariables === "string"
          ? contentVariables
          : JSON.stringify(contentVariables);
    }
  } else if (body) {
    payload.body = body;
  } else {
    throw new Error("Debes enviar 'body' o 'contentSid'.");
  }

  return whatsappClient.messages.create(payload);
}

async function notifyWhatsAppAlertTransition({ doc, status, previousLevel, isResolved = false }) {
  const recipients = getWhatsAppAlertRecipients();

  if (!recipients.length) {
    return;
  }

  if (!isWhatsAppEnabled()) {
    console.warn("[WHATSAPP] No configurado. Se omite el envío.");
    return;
  }

  const cooldownKey = isResolved
    ? `${doc.deviceId}:${status.metric}:resolved`
    : `${doc.deviceId}:${status.metric}:${status.level}`;

  if (isWhatsAppCooldownActive(cooldownKey)) {
    console.log(`[WHATSAPP] alerta omitida por cooldown: ${cooldownKey}`);
    return;
  }

  const body = buildWhatsAppAlertMessage({
    doc,
    status,
    previousLevel,
    isResolved
  });

  let sentOk = false;

  for (const to of recipients) {
    try {
      const msg = await sendWhatsAppMessage({ to, body });
      sentOk = true;

      console.log(
        `[WHATSAPP] enviado sid=${msg.sid} to=${msg.to} status=${msg.status}`
      );
    } catch (error) {
      console.error(
        `[WHATSAPP] error enviando a ${to}:`,
        error?.message || error
      );
    }
  }

  if (sentOk) {
    activateWhatsAppCooldown(cooldownKey);
  }
}


/* =========================
   APP
========================= */

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

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

function assignIfPresent(target, key, value) {
  if (value !== null && value !== undefined) {
    target[key] = value;
  }
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

async function trackAlertTransitions(doc, alertBundle) {
  const candidates = [alertBundle.temperatura, alertBundle.humedad];

  for (const status of candidates) {
    const key = `${doc.deviceId}:${status.metric}`;
    const previousLevel = alertStateCache.get(key) || "unknown";
    const currentLevel = status.level;

    if (previousLevel !== currentLevel) {
      alertStateCache.set(key, currentLevel);

      if (status.shouldAlert) {
        console.warn(
          `[ALERTA] ${doc.deviceId} | ${status.metric} | ${previousLevel} -> ${currentLevel} | valor=${status.value}${status.unit}`
        );

        await notifyWhatsAppAlertTransition({
          doc,
          status,
          previousLevel,
          isResolved: false
        });
      } else if (previousLevel === "elevado" || previousLevel === "critico") {
        console.log(
          `[ALERTA RESUELTA] ${doc.deviceId} | ${status.metric} | ${previousLevel} -> ${currentLevel}`
        );

        await notifyWhatsAppAlertTransition({
          doc,
          status,
          previousLevel,
          isResolved: true
        });
      }
    }
  }
}

/* =========================
   DOCUMENTO DE MEDICIÓN
========================= */

function buildMeasurementDoc(data) {
  const deviceId = normalizeDeviceId(data?.end_device_ids?.device_id);
  const config = DEVICE_CATALOG[deviceId];

  // Si no está en catálogo, se ignora.
  // Aquí cae automáticamente "dispositivo-2"
  if (!config) {
    return null;
  }

  const uplink = data?.uplink_message || {};
  const decoded =
    uplink.decoded_payload && typeof uplink.decoded_payload === "object"
      ? uplink.decoded_payload
      : {};

  const frmPayload = uplink.frm_payload || "";

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

  const doc = {
    deviceId,
    receivedAt: isValidDate(receivedAt) ? receivedAt : new Date()
  };

  assignIfPresent(doc, "temperatura", temperatura);
  assignIfPresent(doc, "humedad", humedad);

  if (config.profile === "full") {
    const radiacion_uv = pickMetric(
      decoded,
      parsedRaw,
      ["radiacion_uv", "radiacionUV", "radiacionUv", "uv", "uv_index"],
      "radiacion_uv"
    );

    const sonido = pickMetric(
      decoded,
      parsedRaw,
      ["sonido", "sound", "ruido"],
      "sonido"
    );

    const voltaje = pickMetric(
      decoded,
      parsedRaw,
      ["voltaje", "voltage", "battery", "bateria"],
      "voltaje"
    );

    assignIfPresent(doc, "radiacion_uv", radiacion_uv);
    assignIfPresent(doc, "sonido", sonido);
    assignIfPresent(doc, "voltaje", voltaje);
  }

  return doc;
}

async function persistMeasurement(doc) {
  await Measurement.findOneAndUpdate(
    {
      deviceId: doc.deviceId,
      receivedAt: doc.receivedAt
    },
    {
      $setOnInsert: doc
    },
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
        receivedAt: -1
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
////////////////////////////////////////////////////
app.post("/api/whatsapp/send", async (req, res) => {
  try {
    const { to, body, contentSid, contentVariables } = req.body || {};

    if (!to) {
      return res.status(400).json({
        ok: false,
        error: "El campo 'to' es obligatorio."
      });
    }

    if (!body && !contentSid) {
      return res.status(400).json({
        ok: false,
        error: "Debes enviar 'body' para texto libre o 'contentSid' para plantilla."
      });
    }

    const msg = await sendWhatsAppMessage({
      to,
      body,
      contentSid,
      contentVariables
    });

    res.status(201).json({
      ok: true,
      sid: msg.sid,
      status: msg.status,
      from: msg.from,
      to: msg.to,
      body: msg.body ?? null
    });
  } catch (error) {
    const status = Number(error?.status || error?.statusCode || 500);

    res.status(status >= 400 ? status : 500).json({
      ok: false,
      error: error?.message || "Error enviando WhatsApp",
      code: error?.code || null,
      moreInfo: error?.moreInfo || null
    });
  }
});

app.post("/api/whatsapp/status", (req, res) => {
  const { MessageSid, MessageStatus, ErrorCode, To, From, EventType } = req.body || {};

  console.log(
    `[TWILIO STATUS] sid=${MessageSid} status=${MessageStatus} event=${EventType || "N/A"} from=${From || "N/A"} to=${To || "N/A"} error=${ErrorCode || "none"}`
  );

  res.sendStatus(200);
});

app.post("/api/whatsapp/inbound", (req, res) => {
  const { From, Body, ProfileName } = req.body || {};

  console.log(
    `[TWILIO INBOUND] from=${From || "N/A"} profile=${ProfileName || "N/A"} body=${Body || ""}`
  );

  res.sendStatus(200);
});

////////////////////////////////////////////////////////////7

app.get("/api/measurements/latest", async (req, res) => {
  try {
    const deviceId = req.query.deviceId;
    const filter = {};

    if (deviceId) {
      filter.deviceId = deviceId;
    }

    const item = await Measurement.findOne(filter).sort({
      receivedAt: -1
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
      .sort({ receivedAt: sort })
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
    }).sort({ receivedAt: -1 });

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
      await trackAlertTransitions(doc, alertBundle);

      console.log(
        `[MONGO] guardado device=${doc.deviceId} temp=${doc.temperatura ?? "N/D"} hum=${doc.humedad ?? "N/D"}`
      );
    } catch (error) {
      if (error?.code === 11000) {
        console.warn("[MONGO] duplicado exacto ignorado");
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