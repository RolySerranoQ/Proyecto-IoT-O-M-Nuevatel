const mongoose = require("mongoose");

const measurementSchema = new mongoose.Schema(
  {
    deviceId: { type: String, index: true, required: true },
    deviceProfile: {
      type: String,
      enum: ["full", "basic"],
      index: true,
      required: true
    },

    applicationId: String,
    devEui: String,
    fCnt: Number,
    receivedAt: { type: Date, index: true },

    temperatura: { type: Number, default: null },
    humedad: { type: Number, default: null },
    radiacion_uv: { type: Number, default: null },
    sonido: { type: Number, default: null },
    voltaje: { type: Number, default: null },

    rawMessage: String,
    frmPayload: String,
    rawHex: String,

    gatewayId: String,
    rssi: Number,
    snr: Number,
    frequency: Number,
    spreadingFactor: Number
  },
  {
    timestamps: true,
    versionKey: false
  }
);

// Para evitar duplicados por reinicios o reintentos
measurementSchema.index({ deviceId: 1, fCnt: 1 }, { unique: true });

// Para consultas rápidas por dispositivo + tiempo
measurementSchema.index({ deviceId: 1, receivedAt: -1 });

module.exports = mongoose.model("Measurement", measurementSchema);