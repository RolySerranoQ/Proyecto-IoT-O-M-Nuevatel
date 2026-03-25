const mongoose = require("mongoose");

const measurementSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, trim: true },
    receivedAt: { type: Date, required: true, default: Date.now },

    temperatura: Number,
    humedad: Number,

    // Solo para Disp. 1
    radiacion_uv: Number,
    sonido: Number,
    voltaje: Number
  },
  {
    versionKey: false,
    timestamps: false
  }
);

// Para consultas por dispositivo y fecha
measurementSchema.index({ deviceId: 1, receivedAt: -1 });

// Para evitar duplicados exactos del mismo dispositivo en la misma fecha/hora
measurementSchema.index({ deviceId: 1, receivedAt: 1 }, { unique: true });

module.exports = mongoose.model("Measurement", measurementSchema);  //hola