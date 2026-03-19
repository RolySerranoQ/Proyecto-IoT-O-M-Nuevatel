const mongoose = require("mongoose");

const measurementSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true },
    deviceProfile: {
      type: String,
      enum: ["full", "basic"],
      required: true
    },

    applicationId: { type: String, default: "" },
    devEui: { type: String, default: "" },
    fCnt: { type: Number, default: null },
    receivedAt: { type: Date, default: Date.now },

    temperatura: { type: Number, default: null },
    humedad: { type: Number, default: null },
    radiacion_uv: { type: Number, default: null },
    sonido: { type: Number, default: null },
    voltaje: { type: Number, default: null },

    rawMessage: { type: String, default: "" },
    frmPayload: { type: String, default: "" },
    rawHex: { type: String, default: "" },

    gatewayId: { type: String, default: "" },
    rssi: { type: Number, default: null },
    snr: { type: Number, default: null },
    frequency: { type: Number, default: null },
    spreadingFactor: { type: Number, default: null }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

measurementSchema.index({ deviceId: 1, receivedAt: -1 });
measurementSchema.index({ receivedAt: -1 });

measurementSchema.index(
  { applicationId: 1, deviceId: 1, fCnt: 1 },
  {
    unique: true,
    partialFilterExpression: {
      fCnt: { $type: "number" }
    }
  }
);

module.exports = mongoose.model("Measurement", measurementSchema);