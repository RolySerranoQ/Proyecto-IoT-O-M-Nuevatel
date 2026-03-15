const mongoose = require("mongoose");

const measurementSchema = new mongoose.Schema(
  {
    deviceId: { type: String, index: true },
    applicationId: String,
    devEui: String,
    fCnt: Number,
    receivedAt: { type: Date, index: true },

    temperatura: Number,
    humedad: Number,
    radiacion_uv: Number,
    sonido: Number,
    voltaje: Number,

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

// Evita duplicados si Render reinicia el servicio
measurementSchema.index({ deviceId: 1, fCnt: 1 }, { unique: true });

module.exports = mongoose.model("Measurement", measurementSchema);
