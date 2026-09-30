"""Shared technical strategy signals for the browser backtest and paper bot."""
from datetime import datetime, timezone


STRATEGIES = {"shortSwing", "ema", "rsi", "macdTrend", "donchian20", "donchian50", "donchian50Calendar", "intraday5m"}


def _ema(values, period):
    out = [None] * len(values)
    if len(values) < period:
        return out
    current = sum(values[:period]) / period
    out[period - 1] = current
    alpha = 2 / (period + 1)
    for index in range(period, len(values)):
        current = values[index] * alpha + current * (1 - alpha)
        out[index] = current
    return out


def _rsi(values, period=14):
    out = [None] * len(values)
    if len(values) <= period:
        return out
    gain = loss = 0.0
    for index in range(1, period + 1):
        delta = values[index] - values[index - 1]
        gain += max(delta, 0)
        loss += max(-delta, 0)
    gain /= period
    loss /= period

    def value():
        if loss == 0:
            return 50 if gain == 0 else 100
        return 100 - 100 / (1 + gain / loss)

    out[period] = value()
    for index in range(period + 1, len(values)):
        delta = values[index] - values[index - 1]
        gain = (gain * (period - 1) + max(delta, 0)) / period
        loss = (loss * (period - 1) + max(-delta, 0)) / period
        out[index] = value()
    return out


def _atr(rows, period=14):
    out = [None] * len(rows)
    if len(rows) <= period:
        return out
    ranges = [0.0]
    for index in range(1, len(rows)):
        previous = rows[index - 1]["c"]
        ranges.append(max(rows[index]["h"] - rows[index]["l"],
                          abs(rows[index]["h"] - previous), abs(rows[index]["l"] - previous)))
    current = sum(ranges[1:period + 1]) / period
    out[period] = current
    for index in range(period + 1, len(rows)):
        current = (current * (period - 1) + ranges[index]) / period
        out[index] = current
    return out


def _utc_date(row):
    stamp = row["t"]
    if isinstance(stamp, str):
        value = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        return value.astimezone(timezone.utc).date()
    return datetime.fromtimestamp(float(stamp), timezone.utc).date()


def _period(day):
    return 0 if day.day <= 10 else 1 if day.day <= 20 else 2


def _calendar_samples(rows):
    grouped = {}
    for index in range(1, len(rows)):
        day = _utc_date(rows[index])
        key = (day.year, day.month, _period(day))
        group = grouped.get(key)
        if group is None:
            grouped[key] = [rows[index - 1]["c"], rows[index]["c"], index]
        else:
            group[1] = rows[index]["c"]
            group[2] = index
    samples = {}
    for (year, month, period), (start, end, end_index) in grouped.items():
        if start > 0:
            samples.setdefault((month, period), []).append((year, end_index, (end / start - 1) * 100))
    return samples


def _calendar_bias(samples, day, index):
    period = _period(day)
    past = [value for year, end_index, value in samples.get((day.month, period), [])
            if end_index < index and year <= day.year]
    if len(past) < 3:
        return "unknown"
    mean = sum(past) / len(past)
    up = sum(value > 0 for value in past) / len(past)
    if mean > 0 and up >= .6:
        return "strong"
    if mean < 0 and up <= .4:
        return "weak"
    return "mixed"


def generate_signals(rows, strategy):
    """Return close-of-bar events, ATR and warmup index using one rule set."""
    if strategy not in STRATEGIES:
        raise ValueError("ไม่รู้จักกลยุทธ์นี้")
    bars = [{key: float(row[key]) if key != "t" and key in row else row[key]
             for key in ("t", "o", "h", "l", "c", "v") if key in row} for row in rows]
    if any(not all(key in bar for key in ("t", "o", "h", "l", "c")) for bar in bars):
        raise ValueError("แท่งราคาต้องมีเวลาและ OHLC ครบ")
    closes = [bar["c"] for bar in bars]
    highs = [bar["h"] for bar in bars]
    lows = [bar["l"] for bar in bars]
    count = len(bars)
    events = [0] * count
    channel = 50 if strategy in ("donchian50", "donchian50Calendar") else 20
    begin = {"shortSwing": 21, "ema": 50, "rsi": 15, "macdTrend": 50,
             "donchian20": 20, "donchian50": 50, "donchian50Calendar": 50,
             "intraday5m": 22}[strategy]

    if strategy == "intraday5m":
        fast, slow, momentum = _ema(closes, 9), _ema(closes, 21), _rsi(closes)
        for i in range(begin, count):
            # Buy the first close back above EMA 9 during an EMA 9 > EMA 21
            # trend. This is a repeatable intraday pullback setup, not a
            # continuously true condition that would trigger on every bar.
            bounced = closes[i - 1] <= fast[i - 1] and closes[i] > fast[i]
            if fast[i] > slow[i] and bounced and 50 <= momentum[i] <= 70:
                events[i] = 1
            elif closes[i] < slow[i] or momentum[i] < 45:
                events[i] = -1
    elif strategy == "shortSwing":
        fast, slow, momentum = _ema(closes, 9), _ema(closes, 21), _rsi(closes)
        for i in range(begin, count):
            crossed_up = fast[i - 1] <= slow[i - 1] and fast[i] > slow[i]
            crossed_down = fast[i - 1] >= slow[i - 1] and fast[i] < slow[i]
            if crossed_up and closes[i] > slow[i] and 50 <= momentum[i] <= 70:
                events[i] = 1
            elif crossed_down or momentum[i] < 45:
                events[i] = -1
    elif strategy == "ema":
        fast, slow = _ema(closes, 20), _ema(closes, 50)
        for i in range(begin, count):
            if fast[i - 1] <= slow[i - 1] and fast[i] > slow[i]:
                events[i] = 1
            elif fast[i - 1] >= slow[i - 1] and fast[i] < slow[i]:
                events[i] = -1
    elif strategy == "rsi":
        values = _rsi(closes)
        for i in range(begin, count):
            if values[i] is not None and values[i] <= 30:
                events[i] = 1
            elif values[i] is not None and values[i] >= 70:
                events[i] = -1
    elif strategy == "macdTrend":
        fast12, slow26 = _ema(closes, 12), _ema(closes, 26)
        line = [None if a is None or b is None else a - b for a, b in zip(fast12, slow26)]
        first = next((i for i, value in enumerate(line) if value is not None), count)
        signal = [None] * count
        if first < count:
            for i, value in enumerate(_ema([x or 0 for x in line[first:]], 9)):
                signal[first + i] = value
        fast20, slow50 = _ema(closes, 20), _ema(closes, 50)
        for i in range(begin, count):
            up = line[i - 1] is not None and signal[i - 1] is not None and line[i - 1] <= signal[i - 1] and line[i] > signal[i]
            down = line[i - 1] is not None and signal[i - 1] is not None and line[i - 1] >= signal[i - 1] and line[i] < signal[i]
            if up and line[i] > 0 and fast20[i] > slow50[i]:
                events[i] = 1
            elif down or fast20[i - 1] >= slow50[i - 1] and fast20[i] < slow50[i]:
                events[i] = -1
    elif strategy in ("donchian20", "donchian50"):
        for i in range(channel, count):
            prior_high = max(highs[i - channel:i])
            prior_low = min(lows[i - channel:i])
            if closes[i] > prior_high:
                events[i] = 1
            elif closes[i] < prior_low:
                events[i] = -1
    else:
        samples = _calendar_samples(bars)
        for i in range(channel, count):
            prior_low = min(lows[i - channel:i])
            day, previous = _utc_date(bars[i]), _utc_date(bars[i - 1])
            bias = _calendar_bias(samples, day, i)
            previous_bias = _calendar_bias(samples, previous, i - 1)
            entering_weak = bias == "weak" and (_period(previous) != _period(day) or previous.month != day.month or previous_bias != "weak")
            if closes[i] < prior_low:
                events[i] = -1
            elif entering_weak:
                events[i] = 1
    intraday = strategy == "intraday5m"
    return {"events": events, "begin": begin, "channelPeriod": channel,
            "atr": _atr(bars), "riskAtr": 1.0 if intraday else 1.5, "rewardRisk": 1.5 if intraday else 2.0,
            "entryBufferPct": 0 if intraday else .01, "entryBufferAbsolute": 0 if intraday else .02, "pendingDays": 7,
            "signalVersion": 1}


def intraday_live_signal(rows, price, previous_price, owned):
    """Evaluate the intraday EMA/RSI setup on each new live market update."""
    if len(rows) < 23 or price <= 0:
        return None, "รอข้อมูล 1 นาทีให้พอคำนวณ EMA/RSI"
    closes = [float(row["c"]) for row in rows]
    live_closes = closes + [float(price)]
    fast = _ema(live_closes, 9)[-1]
    slow = _ema(live_closes, 21)[-1]
    momentum = _rsi(live_closes)[-1]
    if fast is None or slow is None or momentum is None:
        return None, "รอข้อมูลตัวชี้วัดระหว่างวัน"
    if owned:
        if price < slow:
            return "sell", "ราคาล่าสุดหลุด EMA 21 ระหว่างแท่ง"
        if momentum < 45:
            return "sell", "RSI ราคาล่าสุดต่ำกว่า 45"
        return None, "ยังไม่เกิดสัญญาณขาย"
    if previous_price is None:
        return None, "รอราคาอัปเดตถัดไปเพื่อยืนยันจังหวะเข้า"
    previous_fast = _ema(closes + [float(previous_price)], 9)[-1]
    crossed_up = previous_price <= previous_fast and price > fast
    if fast > slow and crossed_up and 50 <= momentum <= 70:
        return "buy", "ราคาตัดกลับเหนือ EMA 9 ในแนวโน้มขึ้น และ RSI อยู่ในช่วง 50–70"
    return None, "รอสัญญาณราคาแบบเรียลไทม์"


def protective_prices(reference_price, atr, stop_atr=1.5, reward_r=2.0):
    if reference_price <= 0 or atr is None or atr <= 0:
        raise ValueError("คำนวณ Stop/Take Profit ไม่ได้: ATR หรือราคายังไม่พร้อม")
    risk = atr * stop_atr
    return reference_price - risk, reference_price + risk * reward_r
