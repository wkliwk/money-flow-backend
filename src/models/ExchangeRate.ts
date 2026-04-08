import mongoose from 'mongoose';

const ExchangeRateSchema = new mongoose.Schema({
  base: { type: String, required: true, unique: true },
  rates: { type: Map, of: Number, required: true },
  fetchedAt: { type: Date, required: true },
});

export const ExchangeRateModel = mongoose.model('ExchangeRate', ExchangeRateSchema);
export default ExchangeRateModel;
