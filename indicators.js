/* Shared browser/Node indicators so parity tests exercise the production code. */
(function attachIndicators(root) {
  const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

  function ema(values, period) {
    const out = Array(values.length).fill(null);
    if (values.length < period) return out;
    const alpha = 2 / (period + 1);
    let value = average(values.slice(0, period));
    out[period - 1] = value;
    for (let i = period; i < values.length; i++) {
      value = values[i] * alpha + value * (1 - alpha);
      out[i] = value;
    }
    return out;
  }

  function rsiSeries(values, period = 14) {
    const out = Array(values.length).fill(null);
    if (values.length <= period) return out;
    let gain = 0, loss = 0;
    for (let i = 1; i <= period; i++) {
      const delta = values[i] - values[i - 1];
      gain += Math.max(delta, 0);
      loss += Math.max(-delta, 0);
    }
    gain /= period;
    loss /= period;
    const value = () => loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
    out[period] = value();
    for (let i = period + 1; i < values.length; i++) {
      const delta = values[i] - values[i - 1];
      gain = (gain * (period - 1) + Math.max(delta, 0)) / period;
      loss = (loss * (period - 1) + Math.max(-delta, 0)) / period;
      out[i] = value();
    }
    return out;
  }

  function rsi(values, period = 14) {
    if (values.length < period + 1) return 50;
    return rsiSeries(values, period).at(-1);
  }

  function macdSeries(values) {
    const fast = ema(values, 12), slow = ema(values, 26);
    const line = values.map((_, i) => fast[i] != null && slow[i] != null ? fast[i] - slow[i] : null);
    const first = line.findIndex(Number.isFinite), signal = Array(values.length).fill(null);
    if (first >= 0) ema(line.slice(first), 9).forEach((value, i) => { signal[first + i] = value; });
    return {line, signal};
  }

  function macd(values) {
    const series = macdSeries(values);
    const index = values.length - 1;
    const line = series.line[index] ?? 0, signal = series.signal[index] ?? 0;
    return {line, signal, hist: line - signal};
  }

  function atrSeries(rows, period = 14) {
    const tr = Array(rows.length).fill(null), out = Array(rows.length).fill(null);
    for (let i = 1; i < rows.length; i++) {
      tr[i] = Math.max(rows[i].h - rows[i].l,
        Math.abs(rows[i].h - rows[i - 1].c), Math.abs(rows[i].l - rows[i - 1].c));
    }
    if (rows.length <= period) return out;
    let value = average(tr.slice(1, period + 1));
    out[period] = value;
    for (let i = period + 1; i < rows.length; i++) {
      value = (value * (period - 1) + tr[i]) / period;
      out[i] = value;
    }
    return out;
  }

  function sma(values, period) {
    const out = Array(values.length).fill(null);
    if (values.length < period) return out;
    let total = values.slice(0, period).reduce((sum, value) => sum + value, 0);
    out[period - 1] = total / period;
    for (let i = period; i < values.length; i++) {
      total += values[i] - values[i - period];
      out[i] = total / period;
    }
    return out;
  }

  function calculate(rows) {
    const closes = rows.map(row => row.c), momentum = macdSeries(closes);
    return {
      ema: Object.fromEntries([9, 20, 21, 50, 200].map(period => [period, ema(closes, period)])),
      sma: Object.fromEntries([20, 50, 200].map(period => [period, sma(closes, period)])),
      rsi14: rsiSeries(closes),
      atr14: atrSeries(rows),
      macd: {line: momentum.line, signal: momentum.signal,
        histogram: momentum.line.map((value, i) => value == null || momentum.signal[i] == null ? null : value - momentum.signal[i])}
    };
  }

  const api = {ema, rsi, rsiSeries, macd, macdSeries, atrSeries, sma, calculate};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SignalIndicators = api;
})(globalThis);
