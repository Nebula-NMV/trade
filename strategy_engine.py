"""Shared technical strategy signals for the browser backtest and paper bot."""
from datetime import datetime, timedelta, timezone
from bisect import bisect_right
import math


STRATEGY_CATALOG = [
    {"id": "shortPullback", "label": "ย่อในแนวโน้ม · EMA 5/20 + RSI", "group": "ระยะสั้น · 1–20 วัน", "mode": "daily", "planType": "pullback", "entryRule": "EMA 5 > EMA 20, ราคาตัดกลับเหนือ EMA 5 และ RSI 45–68", "exitRule": "ปิดต่ำกว่า EMA 20, RSI < 40 หรือครบ 10 วัน", "warmup": 21, "stopAtr": 1.5, "rewardRisk": 2, "maxHoldingBars": 10},
    {"id": "shortBreakout", "label": "Breakout 20 วัน · SPY SMA 200", "group": "ระยะสั้น · 1–20 วัน", "mode": "daily", "planType": "breakout", "entryRule": "ปิดทะลุ High 20 วัน, RSI 50–75 และ SPY > SMA 200", "exitRule": "ปิดต่ำกว่า EMA 20, RSI < 40 หรือครบ 10 วัน", "warmup": 20, "regimeFilter": True, "stopAtr": 1.5, "rewardRisk": 2, "maxHoldingBars": 10, "channelPeriod": 20},
    {"id": "shortMacd", "label": "MACD Momentum · EMA 8/21", "group": "ระยะสั้น · 1–20 วัน", "mode": "daily", "planType": "momentum", "entryRule": "EMA 8 > EMA 21 และ MACD ตัดขึ้นเหนือ Signal", "exitRule": "MACD ตัดลงหรือ EMA 8 < EMA 21", "warmup": 35, "stopAtr": 1.5, "rewardRisk": 2, "maxHoldingBars": 10},
    {"id": "shortReversal", "label": "Oversold Reversal · Bollinger + RSI", "group": "ระยะสั้น · 1–20 วัน", "mode": "daily", "planType": "reversal", "entryRule": "ราคากลับเข้า Bollinger หลังหลุดแถบล่าง, RSI ฟื้นเหนือ 30 และหุ้นเหนือ EMA 200", "exitRule": "RSI ≥ 60 หรือปิดต่ำกว่า EMA 20", "warmup": 200, "stopAtr": 1.25, "rewardRisk": 1.8, "maxHoldingBars": 10},
    {"id": "shortMomentum", "label": "5-Day Momentum · EMA 10/20 + RSI", "group": "ระยะสั้น · 1–20 วัน", "mode": "daily", "planType": "momentum", "entryRule": "ปิดทะลุ High 5 วัน, EMA 10 > EMA 20 และ RSI 55–75", "exitRule": "ปิดต่ำกว่า EMA 10 หรือ RSI < 45", "warmup": 20, "stopAtr": 1.5, "rewardRisk": 2, "maxHoldingBars": 10, "channelPeriod": 5},
    {"id": "mediumPullback", "label": "ย่อในแนวโน้ม · EMA 20/50 + RSI", "group": "ระยะกลาง · หลายสัปดาห์/เดือน", "mode": "daily", "planType": "pullback", "entryRule": "EMA 20 > EMA 50, ราคาตัดกลับเหนือ EMA 20, RSI 45–70 และ SPY > SMA 200", "exitRule": "EMA 20 < EMA 50 หรือปิดต่ำกว่า EMA 50", "warmup": 50, "regimeFilter": True, "stopAtr": 2, "rewardRisk": 3},
    {"id": "mediumBreakout", "label": "Breakout 50 วัน · Trailing Low 20", "group": "ระยะกลาง · หลายสัปดาห์/เดือน", "mode": "daily", "planType": "breakout", "entryRule": "ปิดทะลุ High 50 วันและ SPY > SMA 200", "exitRule": "ปิดต่ำกว่า Low 20 วัน", "warmup": 50, "regimeFilter": True, "stopAtr": 2.5, "rewardRisk": 0, "noTarget": True, "channelPeriod": 50, "exitChannelPeriod": 20},
    {"id": "mediumMacd", "label": "MACD Trend · EMA 20/50", "group": "ระยะกลาง · หลายสัปดาห์/เดือน", "mode": "daily", "planType": "momentum", "entryRule": "EMA 20 > EMA 50 และ MACD ตัดขึ้นเหนือ Signal พร้อม SPY > SMA 200", "exitRule": "MACD ตัดลงหรือ EMA 20 < EMA 50", "warmup": 50, "regimeFilter": True, "stopAtr": 2, "rewardRisk": 3},
    {"id": "mediumRelative", "label": "Relative Strength · เหนือ SPY", "group": "ระยะกลาง · หลายสัปดาห์/เดือน", "mode": "daily", "planType": "relative", "entryRule": "แรงเทียบ SPY ตัดขึ้นค่าเฉลี่ย 20 วัน, หุ้นเหนือ EMA 50 และ SPY > SMA 200", "exitRule": "แรงเทียบ SPY ต่ำกว่าค่าเฉลี่ยหรือหุ้นต่ำกว่า EMA 50", "warmup": 50, "regimeFilter": True, "stopAtr": 2, "rewardRisk": 2.5},
    {"id": "mediumReclaim", "label": "SMA 50/200 Trend Reclaim · RSI", "group": "ระยะกลาง · หลายสัปดาห์/เดือน", "mode": "daily", "planType": "pullback", "entryRule": "SMA 50 > SMA 200, ราคากลับเหนือ EMA 20 และ RSI 45–70 พร้อม SPY > SMA 200", "exitRule": "ปิดต่ำกว่า EMA 50 หรือ SMA 50 < SMA 200", "warmup": 200, "regimeFilter": True, "stopAtr": 2.5, "rewardRisk": 3},
    {"id": "longTrend", "label": "ตามแนวโน้ม · EMA 50/200", "group": "ระยะยาว · หลายเดือนขึ้นไป", "mode": "daily", "planType": "trend", "entryRule": "EMA 50 และราคาปิดเหนือ EMA 200 พร้อม SPY > SMA 200", "exitRule": "SPY ต่ำกว่า SMA 200, EMA 50 < EMA 200 หรือปิดใต้ EMA 200 3 วัน", "warmup": 200, "regimeFilter": True, "stopAtr": 3, "rewardRisk": 0, "noTarget": True},
    {"id": "longBreakout", "label": "Breakout 100 วัน · Trailing Low 50", "group": "ระยะยาว · หลายเดือนขึ้นไป", "mode": "daily", "planType": "breakout", "entryRule": "ปิดทะลุ High 100 วันและ SPY > SMA 200", "exitRule": "ปิดต่ำกว่า Low 50 วัน", "warmup": 100, "regimeFilter": True, "stopAtr": 3, "rewardRisk": 0, "noTarget": True, "channelPeriod": 100, "exitChannelPeriod": 50},
    {"id": "longMacd", "label": "MACD Primary Trend · EMA 50/200", "group": "ระยะยาว · หลายเดือนขึ้นไป", "mode": "daily", "planType": "trend", "entryRule": "EMA 50 > EMA 200 และ MACD ตัดขึ้นเหนือ Signal พร้อม SPY > SMA 200", "exitRule": "MACD ตัดลงหรือ EMA 50 < EMA 200", "warmup": 200, "regimeFilter": True, "stopAtr": 3, "rewardRisk": 0, "noTarget": True},
    {"id": "longRelative", "label": "Relative Strength 50-Day · SPY", "group": "ระยะยาว · หลายเดือนขึ้นไป", "mode": "daily", "planType": "relative", "entryRule": "แรงเทียบ SPY ตัดขึ้นค่าเฉลี่ย 50 วันและหุ้นเหนือ EMA 200", "exitRule": "แรงเทียบ SPY ต่ำกว่าค่าเฉลี่ยหรือหุ้นต่ำกว่า EMA 100", "warmup": 200, "regimeFilter": True, "stopAtr": 3, "rewardRisk": 0, "noTarget": True},
    {"id": "longReclaim", "label": "Rising 200-Day · EMA 50 Reclaim", "group": "ระยะยาว · หลายเดือนขึ้นไป", "mode": "daily", "planType": "trend", "entryRule": "EMA 200 กำลังขึ้น, EMA 50 > EMA 200 และราคาตัดกลับเหนือ EMA 50", "exitRule": "ปิดต่ำกว่า EMA 200 ต่อเนื่อง 3 วันหรือ SPY < SMA 200", "warmup": 250, "regimeFilter": True, "stopAtr": 3, "rewardRisk": 0, "noTarget": True},
]
STRATEGIES = {item["id"] for item in STRATEGY_CATALOG}
STRATEGY_BY_ID = {item["id"]: item for item in STRATEGY_CATALOG}
REGIME_STRATEGIES = {item["id"] for item in STRATEGY_CATALOG if item.get("regimeFilter")}
NO_TARGET_STRATEGIES = {item["id"] for item in STRATEGY_CATALOG if item.get("noTarget")}
STRATEGY_WARMUP = {item["id"]: item["warmup"] for item in STRATEGY_CATALOG}

BOT_STRATEGY_CATALOG = [
    {"id": "botOrb15", "label": "Opening Range Breakout · 15 นาที", "group": "บอท Intraday · Breakout", "mode": "intraday", "entryRule": "ทะลุกรอบ 15 นาทีแรกเหนือ VWAP, SPY เหนือ VWAP และ Relative Volume ≥ 1.3x", "exitRule": "หลุด VWAP หรือ Stop/เป้ากำไร OCO; ปิดก่อนตลาดปิด", "needsSpy": True, "needsRelativeVolume": True, "stopAtr": 1.0, "rewardRisk": 1.5},
    {"id": "botEmaMomentum", "label": "EMA Momentum · 9/21 + VWAP", "group": "บอท Intraday · Momentum", "mode": "intraday", "entryRule": "EMA 9 > EMA 21, ราคาตัดขึ้นเหนือ EMA 9, RSI 52–70 และเหนือ VWAP/SPY VWAP", "exitRule": "หลุด EMA 21 หรือ RSI < 45 · ปิดก่อนตลาดปิด", "needsSpy": True, "stopAtr": 1.25, "rewardRisk": 1.8},
    {"id": "botVwapPullback", "label": "VWAP Trend Pullback · EMA 9/21", "group": "บอท Intraday · Pullback", "mode": "intraday", "entryRule": "EMA 9 > EMA 21, ย่อแตะ VWAP ใน 3 แท่งล่าสุดแล้วฟื้นเหนือ EMA 9 และ SPY เหนือ VWAP", "exitRule": "หลุด VWAP หรือ EMA 21 · ปิดก่อนตลาดปิด", "needsSpy": True, "stopAtr": 1.25, "rewardRisk": 2.0},
    {"id": "botVwapReclaim", "label": "VWAP Reclaim · RSI Recovery", "group": "บอท Intraday · Reversal", "mode": "intraday", "entryRule": "ราคาตัดกลับเหนือ VWAP, RSI 45–65 และ EMA 9 > EMA 21", "exitRule": "หลุด EMA 21 หรือ RSI < 40 · ปิดก่อนตลาดปิด", "needsSpy": False, "stopAtr": 1.0, "rewardRisk": 1.5},
    {"id": "botVwapMeanReversion", "label": "VWAP Mean Reversion · Oversold", "group": "บอท Intraday · Mean Reversion", "mode": "intraday", "entryRule": "ราคาฟื้นเหนือ EMA 9 หลังห่าง VWAP อย่างน้อย 0.75 ATR และ RSI ตัดขึ้นเหนือ 30", "exitRule": "แตะ VWAP, RSI ≥ 60 หรือ Stop · ปิดก่อนตลาดปิด", "needsSpy": False, "stopAtr": 1.0, "rewardRisk": 1.3},
]
BOT_STRATEGIES = {item["id"] for item in BOT_STRATEGY_CATALOG}
BOT_STRATEGY_BY_ID = {item["id"]: item for item in BOT_STRATEGY_CATALOG}


def _eastern_datetime(timestamp):
    """Convert UTC epoch to US Eastern without requiring system tzdata."""
    utc = datetime.fromtimestamp(timestamp, timezone.utc)
    year = utc.year
    march_first = datetime(year, 3, 1)
    november_first = datetime(year, 11, 1)
    dst_start_day = 1 + (6 - march_first.weekday()) % 7 + 7
    dst_end_day = 1 + (6 - november_first.weekday()) % 7
    dst_start = datetime(year, 3, dst_start_day, 7, tzinfo=timezone.utc)
    dst_end = datetime(year, 11, dst_end_day, 6, tzinfo=timezone.utc)
    offset = timedelta(hours=-4 if dst_start <= utc < dst_end else -5)
    return utc.astimezone(timezone(offset, "EDT" if offset.total_seconds() == -14400 else "EST"))


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


def _intraday_setup(previous_price, price, fast, slow, momentum, previous_fast):
    """Single intraday EMA/RSI predicate shared by history and live ticks."""
    if price <= 0 or previous_price is None or previous_price <= 0:
        return None
    if None in (fast, slow, momentum, previous_fast):
        return None
    buy = fast > slow and price > slow and previous_price <= previous_fast and price > fast and 50 <= momentum <= 70
    sell = price < slow or momentum < 45
    return {"buy": buy, "sell": sell, "fast": fast, "slow": slow, "rsi": momentum}


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


def _macd(values):
    fast, slow = _ema(values, 12), _ema(values, 26)
    line = [None if a is None or b is None else a - b for a, b in zip(fast, slow)]
    first = next((i for i, value in enumerate(line) if value is not None), len(values))
    signal = [None] * len(values)
    if first < len(values):
        for i, value in enumerate(_ema([x or 0 for x in line[first:]], 9)):
            signal[first + i] = value
    return {"line": line, "signal": signal,
            "histogram": [None if a is None or b is None else a - b for a, b in zip(line, signal)]}


def indicator_series(rows):
    """Indicator series used by strategies, mirrored by browser indicators.js."""
    bars = [{key: float(row[key]) for key in ("o", "h", "l", "c")}
            for row in rows]
    closes = [bar["c"] for bar in bars]
    macd = _macd(closes)
    return {
        "ema": {str(period): _ema(closes, period) for period in (9, 20, 21, 50, 200)},
        "sma": {str(period): _sma(closes, period) for period in (20, 50, 200)},
        "rsi14": _rsi(closes),
        "atr14": _atr(bars),
        "macd": macd,
    }


def _sma(values, period):
    out = [None] * len(values)
    if len(values) < period:
        return out
    total = sum(values[:period])
    out[period - 1] = total / period
    for index in range(period, len(values)):
        total += values[index] - values[index - period]
        out[index] = total / period
    return out


def _timestamp(row):
    value = row["t"]
    if isinstance(value, str):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp()
    return float(value)


def _opening_relative_volume(rows, session_day):
    """Opening 15-minute volume divided by the prior five-session average."""
    volumes, counts = {}, {}
    for row in rows:
        try:
            local = _eastern_datetime(_timestamp(row))
            if local.hour == 9 and 30 <= local.minute < 45:
                volumes[local.date()] = volumes.get(local.date(), 0.0) + max(0.0, float(row.get("v", 0) or 0))
                counts[local.date()] = counts.get(local.date(), 0) + 1
        except (KeyError, TypeError, ValueError, OverflowError):
            continue
    current = volumes.get(session_day)
    previous = [volume for day, volume in sorted(volumes.items())
                if day < session_day and counts.get(day, 0) >= 15 and volume > 0]
    if current is None or counts.get(session_day, 0) < 15 or len(previous) < 3:
        return None
    baseline = sum(previous[-5:]) / len(previous[-5:])
    return current / baseline if baseline > 0 else None


def opening_relative_volume(rows, session_day):
    """Public shared opening-volume calculation for Paper Bot and backtest."""
    return _opening_relative_volume(rows, session_day)


def _spy_regime_for_rows(rows, spy_rows):
    """Align completed stock bars to the latest SPY close and 200-bar SMA."""
    if not spy_rows:
        return [False] * len(rows)
    spy_rows = sorted(spy_rows, key=_timestamp)
    spy_times = [_timestamp(row) for row in spy_rows]
    spy_closes = [float(row["c"]) for row in spy_rows]
    spy_sma = _sma(spy_closes, 200)
    passed = []
    for row in rows:
        index = bisect_right(spy_times, _timestamp(row)) - 1
        passed.append(index >= 199 and spy_sma[index] is not None and spy_closes[index] > spy_sma[index])
    return passed


def _relative_strength(rows, spy_rows, period):
    if not spy_rows:
        return [None] * len(rows), [None] * len(rows)
    ordered = sorted(spy_rows, key=_timestamp)
    times = [_timestamp(row) for row in ordered]
    closes = [float(row["c"]) for row in ordered]
    ratios = []
    for row in rows:
        index = bisect_right(times, _timestamp(row)) - 1
        ratios.append(float(row["c"]) / closes[index] if index >= 0 and closes[index] > 0 else None)
    means = [None] * len(ratios)
    for i in range(period - 1, len(ratios)):
        window = ratios[i - period + 1:i + 1]
        if all(value is not None for value in window):
            means[i] = sum(window) / period
    return ratios, means


def _bollinger(values, period=20, deviations=2):
    middle = _sma(values, period)
    lower = [None] * len(values)
    for i in range(period - 1, len(values)):
        window = values[i - period + 1:i + 1]
        mean = middle[i]
        variance = sum((value - mean) ** 2 for value in window) / period
        lower[i] = mean - deviations * math.sqrt(variance)
    return middle, lower


def _cross_up(left, right, i):
    return (i > 0 and left[i - 1] is not None and right[i - 1] is not None
            and left[i] is not None and right[i] is not None
            and left[i - 1] <= right[i - 1] and left[i] > right[i])


def _cross_down(left, right, i):
    return (i > 0 and left[i - 1] is not None and right[i - 1] is not None
            and left[i] is not None and right[i] is not None
            and left[i - 1] >= right[i - 1] and left[i] < right[i])


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


def generate_signals(rows, strategy, spy_rows=None):
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
    begin = STRATEGY_WARMUP[strategy]
    regime_pass = _spy_regime_for_rows(bars, spy_rows) if strategy in REGIME_STRATEGIES else [True] * count
    fast5, ema10, ema20, ema21 = _ema(closes, 5), _ema(closes, 10), _ema(closes, 20), _ema(closes, 21)
    ema50, ema100, ema200 = _ema(closes, 50), _ema(closes, 100), _ema(closes, 200)
    sma50, sma200, momentum = _sma(closes, 50), _sma(closes, 200), _rsi(closes)
    macd = _macd(closes)
    if strategy == "shortPullback":
        for i in range(begin, count):
            reclaim = closes[i - 1] <= fast5[i - 1] and closes[i] > fast5[i]
            if fast5[i] > ema20[i] and reclaim and momentum[i] is not None and 45 <= momentum[i] <= 68:
                events[i] = 1
            elif closes[i] < ema20[i] or (momentum[i] is not None and momentum[i] < 40):
                events[i] = -1
    elif strategy == "shortBreakout":
        for i in range(begin, count):
            if closes[i] > max(highs[i - 20:i]) and momentum[i] is not None and 50 <= momentum[i] <= 75:
                events[i] = 1
            elif closes[i] < ema20[i] or (momentum[i] is not None and momentum[i] < 40):
                events[i] = -1
    elif strategy == "shortMacd":
        for i in range(begin, count):
            if ema10[i] > ema21[i] and _cross_up(macd["line"], macd["signal"], i):
                events[i] = 1
            elif _cross_down(macd["line"], macd["signal"], i) or ema10[i] < ema21[i]:
                events[i] = -1
    elif strategy == "shortReversal":
        middle, lower = _bollinger(closes)
        for i in range(begin, count):
            reclaimed = lower[i - 1] is not None and closes[i - 1] < lower[i - 1] and closes[i] >= lower[i]
            if reclaimed and closes[i] > ema200[i] and momentum[i] is not None and momentum[i] > 30:
                events[i] = 1
            elif (momentum[i] is not None and momentum[i] >= 60) or closes[i] < ema20[i]:
                events[i] = -1
    elif strategy == "shortMomentum":
        for i in range(begin, count):
            if (closes[i] > max(highs[i - 5:i]) and ema10[i] > ema20[i]
                    and momentum[i] is not None and 55 <= momentum[i] <= 75):
                events[i] = 1
            elif closes[i] < ema10[i] or (momentum[i] is not None and momentum[i] < 45):
                events[i] = -1
    elif strategy == "mediumPullback":
        for i in range(begin, count):
            reclaim = closes[i - 1] <= ema20[i - 1] and closes[i] > ema20[i]
            if ema20[i] > ema50[i] and reclaim and momentum[i] is not None and 45 <= momentum[i] < 70:
                events[i] = 1
            elif ema20[i] < ema50[i] or closes[i] < ema50[i]:
                events[i] = -1
    elif strategy == "mediumBreakout":
        for i in range(begin, count):
            if closes[i] > max(highs[i - 50:i]):
                events[i] = 1
            elif closes[i] < min(lows[i - 20:i]):
                events[i] = -1
    elif strategy == "mediumMacd":
        for i in range(begin, count):
            if ema20[i] > ema50[i] and _cross_up(macd["line"], macd["signal"], i):
                events[i] = 1
            elif _cross_down(macd["line"], macd["signal"], i) or ema20[i] < ema50[i]:
                events[i] = -1
    elif strategy == "mediumRelative":
        ratios, ratio_mean = _relative_strength(bars, spy_rows, 20)
        for i in range(begin, count):
            if _cross_up(ratios, ratio_mean, i) and closes[i] > ema50[i]:
                events[i] = 1
            elif ((ratios[i] is not None and ratio_mean[i] is not None and ratios[i] < ratio_mean[i])
                  or closes[i] < ema50[i]):
                events[i] = -1
    elif strategy == "mediumReclaim":
        for i in range(begin, count):
            reclaimed = closes[i - 1] <= ema20[i - 1] and closes[i] > ema20[i]
            if sma50[i] > sma200[i] and reclaimed and momentum[i] is not None and 45 <= momentum[i] <= 70:
                events[i] = 1
            elif closes[i] < ema50[i] or sma50[i] < sma200[i]:
                events[i] = -1
    elif strategy == "longTrend":
        for i in range(begin, count):
            was_uptrend = ema50[i - 1] > ema200[i - 1] and closes[i - 1] > ema200[i - 1]
            uptrend = ema50[i] > ema200[i] and closes[i] > ema200[i]
            if uptrend and not was_uptrend:
                events[i] = 1
            elif (not regime_pass[i] or ema50[i] < ema200[i]
                  or (i >= begin + 2 and closes[i] < ema200[i]
                      and closes[i - 1] < ema200[i - 1] and closes[i - 2] < ema200[i - 2])):
                events[i] = -1
    elif strategy == "longBreakout":
        for i in range(begin, count):
            if closes[i] > max(highs[i - 100:i]):
                events[i] = 1
            elif closes[i] < min(lows[i - 50:i]):
                events[i] = -1
    elif strategy == "longMacd":
        for i in range(begin, count):
            if ema50[i] > ema200[i] and _cross_up(macd["line"], macd["signal"], i):
                events[i] = 1
            elif _cross_down(macd["line"], macd["signal"], i) or ema50[i] < ema200[i]:
                events[i] = -1
    elif strategy == "longRelative":
        ratios, ratio_mean = _relative_strength(bars, spy_rows, 50)
        for i in range(begin, count):
            if _cross_up(ratios, ratio_mean, i) and closes[i] > ema200[i]:
                events[i] = 1
            elif ((ratios[i] is not None and ratio_mean[i] is not None and ratios[i] < ratio_mean[i])
                  or closes[i] < ema100[i]):
                events[i] = -1
    else:  # longReclaim
        for i in range(begin, count):
            reclaimed = closes[i - 1] <= ema50[i - 1] and closes[i] > ema50[i]
            rising = i >= 50 and ema200[i] > ema200[i - 50]
            if rising and ema50[i] > ema200[i] and reclaimed:
                events[i] = 1
            elif (not regime_pass[i] or closes[i] < ema200[i]
                  and i >= begin + 2 and closes[i - 1] < ema200[i - 1]
                  and closes[i - 2] < ema200[i - 2]):
                events[i] = -1
    raw_events = list(events)
    if strategy in REGIME_STRATEGIES:
        for i, event in enumerate(events):
            if event == 1 and not regime_pass[i]:
                events[i] = 0
    return {"events": events, "begin": begin,
            "raw_events": raw_events, "regime_pass": regime_pass,
            "regime_filter": "SPY close > SMA 200" if strategy in REGIME_STRATEGIES else None,
            "atr": _atr(bars), "riskAtr": STRATEGY_BY_ID[strategy]["stopAtr"],
            "rewardRisk": STRATEGY_BY_ID[strategy]["rewardRisk"],
            "entryBufferPct": .01, "entryBufferAbsolute": .02, "pendingDays": 7,
            "no_target": strategy in NO_TARGET_STRATEGIES,
            "maxHoldingBars": STRATEGY_BY_ID[strategy].get("maxHoldingBars"),
            "planType": STRATEGY_BY_ID[strategy]["planType"], "signalVersion": 4}


def intraday_live_signal(rows, price, previous_price, owned):
    """Evaluate the intraday EMA/RSI setup on each new live market update."""
    if len(rows) < 23 or price <= 0:
        return None, "รอข้อมูล 1 นาทีให้พอคำนวณ EMA/RSI"
    closes = [float(row["c"]) for row in rows]
    if previous_price is None:
        return None, "รอข้อมูลตัวชี้วัดระหว่างวัน"
    current = closes + [float(price)]
    previous = closes + [float(previous_price)]
    setup = _intraday_setup(previous_price, price, _ema(current, 9)[-1], _ema(current, 21)[-1],
                            _rsi(current)[-1], _ema(previous, 9)[-1])
    if setup is None:
        return None, "รอข้อมูลตัวชี้วัดระหว่างวัน"
    if owned:
        # The entry is made from the live price after the latest completed
        # bar. Keep watching ticks, but do not let that same bar's setup turn
        # into an immediate strategy exit. Alpaca's OCO stop/target protect
        # the position during this short confirmation window.
        entry_bar = owned.get("entry_bar")
        if entry_bar and rows[-1].get("t", "") <= entry_bar:
            return None, "ถือสถานะหลังซื้อ · รอแท่ง 1 นาทีถัดไปยืนยันสัญญาณขาย"
        if setup["sell"] and price < setup["slow"]:
            return "sell", "ราคาล่าสุดหลุด EMA 21 ระหว่างแท่ง"
        if setup["sell"] and setup["rsi"] < 45:
            return "sell", "RSI ราคาล่าสุดต่ำกว่า 45"
        return None, "ยังไม่เกิดสัญญาณขาย"
    if setup["buy"]:
        return "buy", "ราคาตัดกลับเหนือ EMA 9 ในแนวโน้มขึ้น และ RSI อยู่ในช่วง 50–70"
    return None, "รอสัญญาณราคาแบบเรียลไทม์"


def intraday_atr(rows, period=14):
    """Latest ATR from regular-session one-minute bars."""
    values = _atr(rows, period)
    return values[-1] if values else None


def intraday_bot_signal(strategy, rows, price, previous_price, spy_rows=None,
                        relative_volume=None, elapsed_minutes=0, owned=None):
    """Evaluate dedicated bot-only strategies on the current regular session."""
    if strategy not in BOT_STRATEGIES:
        raise ValueError("ไม่รู้จักกลยุทธ์บอท Intraday นี้")
    if not rows or price <= 0:
        return None, "รอข้อมูลแท่งราคา 1 นาที"
    latest_local = _eastern_datetime(_timestamp(rows[-1]))
    latest_day = latest_local.date()
    session_start_ts = latest_local.replace(hour=9, minute=30, second=0, microsecond=0).timestamp()
    session = [row for row in rows if _timestamp(row) >= session_start_ts
               and _eastern_datetime(_timestamp(row)).date() == latest_day]
    if len(session) < 23:
        return None, "รอแท่ง 1 นาทีของวันนี้อย่างน้อย 23 แท่ง"
    closes = [float(row["c"]) for row in session]
    current = closes + [float(price)]
    fast, slow = _ema(current, 9)[-1], _ema(current, 21)[-1]
    prior = closes + [float(previous_price if previous_price and previous_price > 0 else closes[-1])]
    prior_fast = _ema(prior, 9)[-1]
    momentum = _rsi(current)[-1]
    atr = intraday_atr(session)
    if atr is None or atr <= 0 or momentum is None:
        return None, "รอตัวชี้วัด EMA/RSI/ATR จากแท่ง 1 นาที"

    def vwap(source):
        volume = sum(max(0.0, float(row.get("v", 0) or 0)) for row in source)
        if volume <= 0:
            return None
        return sum(((float(row["h"]) + float(row["l"]) + float(row["c"])) / 3)
                   * max(0.0, float(row.get("v", 0) or 0)) for row in source) / volume

    stock_vwap = vwap(session)
    spy_session = []
    if spy_rows:
        spy_session = [row for row in spy_rows if _eastern_datetime(_timestamp(row)).date() == latest_day
                       and _timestamp(row) >= session_start_ts]
    spy_vwap = vwap(spy_session)
    if stock_vwap is None:
        return None, "Volume ยังไม่พร้อมคำนวณ VWAP"
    if BOT_STRATEGY_BY_ID[strategy].get("needsSpy") and spy_vwap is None:
        return None, "รอข้อมูล SPY สำหรับยืนยันแนวโน้มตลาด"
    if owned:
        entry_bar = owned.get("entry_bar")
        if entry_bar and session[-1].get("t", "") <= entry_bar:
            return None, "ถือสถานะหลังซื้อ · รอแท่ง 1 นาทีถัดไป"
        if strategy == "botOrb15" and price < stock_vwap:
            return "sell", "ราคาหลุด VWAP หลังเข้า Opening Range Breakout"
        if strategy == "botEmaMomentum" and (price < slow or momentum < 45):
            return "sell", "EMA 21 หรือ RSI ยืนยันว่าโมเมนตัมอ่อนลง"
        if strategy == "botVwapPullback" and (price < stock_vwap or price < slow):
            return "sell", "ราคาหลุด VWAP/EMA 21 ของกลยุทธ์ Pullback"
        if strategy == "botVwapReclaim" and (price < slow or momentum < 40):
            return "sell", "VWAP Reclaim เสียแนว EMA 21 หรือ RSI อ่อน"
        if strategy == "botVwapMeanReversion" and (price >= stock_vwap or momentum >= 60):
            return "sell", "กลับถึง VWAP/RSI 60 ตามเป้ากลยุทธ์ Mean Reversion"
        return None, "ยังไม่เกิดเงื่อนไขออก · มี Stop/เป้ากำไร OCO คุ้มครอง"

    if strategy == "botOrb15":
        opening = [row for row in session if (_timestamp(row) - session_start_ts) < 15 * 60]
        if elapsed_minutes < 15 or len(opening) < 15:
            return None, "รอกรอบราคา 15 นาทีแรกให้ครบ"
        if relative_volume is None or relative_volume < 1.3:
            return None, "งดซื้อ · Relative Volume ต่ำกว่า 1.3x"
        opening_high = max(float(row["h"]) for row in opening)
        if price > opening_high and price > stock_vwap and spy_vwap is not None and float(spy_session[-1]["c"]) > spy_vwap:
            return "buy", f"ทะลุ High 15 นาทีแรกเหนือ VWAP · Relative Volume {relative_volume:.2f}x"
        return None, "รอทะลุ Opening Range High พร้อม VWAP/Volume ยืนยัน"
    if strategy == "botEmaMomentum":
        if fast > slow and price > fast and previous_price is not None and previous_price <= prior_fast and 52 <= momentum <= 70 and price > stock_vwap and (spy_vwap is None or float(spy_session[-1]["c"]) > spy_vwap):
            return "buy", "EMA 9/21 ขาขึ้น · ราคา reclaim EMA 9 · RSI/VWAP ยืนยัน"
        return None, "รอ EMA 9/21 และ VWAP ยืนยันโมเมนตัม"
    if strategy == "botVwapPullback":
        touched_vwap = min(float(row["l"]) for row in session[-3:]) <= stock_vwap * 1.002
        spy_ok = spy_vwap is None or float(spy_session[-1]["c"]) > spy_vwap
        if fast > slow and touched_vwap and price > fast and price > stock_vwap and spy_ok:
            return "buy", "ย่อแตะ VWAP แล้วฟื้นเหนือ EMA 9 · แนวโน้ม SPY สนับสนุน"
        return None, "รอย่อแตะ VWAP และฟื้นในแนวโน้ม EMA 9/21"
    if strategy == "botVwapReclaim":
        if previous_price is not None and previous_price <= stock_vwap and price > stock_vwap and fast > slow and 45 <= momentum <= 65:
            return "buy", "ราคาตัดกลับเหนือ VWAP · EMA 9/21 และ RSI ฟื้น"
        return None, "รอราคาตัดกลับเหนือ VWAP พร้อม RSI ฟื้น"
    prior_rsi = _rsi(prior)[-1]
    was_extended = min(float(row["l"]) for row in session[-5:]) <= stock_vwap - .75 * atr
    if previous_price is not None and was_extended and price > fast and prior_rsi is not None and prior_rsi <= 30 < momentum:
        return "buy", "Oversold ฟื้นเหนือ RSI 30 และ EMA 9 · กลับเข้าหา VWAP"
    return None, "รอภาวะ Oversold ห่าง VWAP ≥ 0.75 ATR แล้วฟื้นตัว"


def recommend_intraday_bot_strategy(rows, spy_rows=None, relative_volume=None):
    """Choose the bot setup that best fits the latest completed session data."""
    if not rows:
        return {"strategy": "botEmaMomentum", "reason": "ข้อมูลแท่ง 1 นาทีไม่พร้อม · ใช้ EMA Momentum เป็นค่าเริ่มต้น", "setup_active": False}
    latest_local = _eastern_datetime(_timestamp(rows[-1]))
    start_ts = latest_local.replace(hour=9, minute=30, second=0, microsecond=0).timestamp()
    session = [row for row in rows if _timestamp(row) >= start_ts
               and _eastern_datetime(_timestamp(row)).date() == latest_local.date()]
    if len(session) < 23:
        return {"strategy": "botEmaMomentum", "reason": "ข้อมูลวันนี้ยังไม่ถึง 23 แท่ง · ใช้ EMA Momentum เป็นค่าเริ่มต้น", "setup_active": False}
    price, previous = float(session[-1]["c"]), float(session[-2]["c"])
    elapsed = latest_local.hour * 60 + latest_local.minute - (9 * 60 + 30)
    active = []
    for item in BOT_STRATEGY_CATALOG:
        signal, reason = intraday_bot_signal(item["id"], rows, price, previous,
                                             spy_rows=spy_rows, relative_volume=relative_volume,
                                             elapsed_minutes=elapsed)
        if signal == "buy":
            active.append((item["id"], reason))
    if active:
        strategy, reason = active[0]
        return {"strategy": strategy, "reason": f"พบ setup เข้าได้ในข้อมูลล่าสุด · {reason}", "setup_active": True}

    closes = [float(row["c"]) for row in session]
    fast, slow = _ema(closes, 9)[-1], _ema(closes, 21)[-1]
    momentum, atr = _rsi(closes)[-1], intraday_atr(session)

    def vwap(source):
        volume = sum(max(0.0, float(row.get("v", 0) or 0)) for row in source)
        return (sum(((float(row["h"]) + float(row["l"]) + float(row["c"])) / 3)
                    * max(0.0, float(row.get("v", 0) or 0)) for row in source) / volume
                if volume > 0 else None)

    stock_vwap = vwap(session)
    if stock_vwap is None or atr is None or momentum is None:
        return {"strategy": "botEmaMomentum", "reason": "ตัวชี้วัดไม่ครบ · ใช้ EMA Momentum เป็นค่าเริ่มต้น", "setup_active": False}
    if price <= stock_vwap - .75 * atr and momentum < 40:
        return {"strategy": "botVwapMeanReversion", "reason": "ราคาห่างใต้ VWAP และ RSI อ่อน · เหมาะกับการรอจังหวะฟื้นตัว", "setup_active": False}
    touched = min(float(row["l"]) for row in session[-3:]) <= stock_vwap * 1.002
    if fast > slow and price > stock_vwap and price > fast and touched:
        return {"strategy": "botVwapPullback", "reason": "EMA 9/21 เป็นขาขึ้นและราคาย่อทดสอบ VWAP", "setup_active": False}
    if fast > slow and price > stock_vwap and 52 <= momentum <= 70:
        return {"strategy": "botEmaMomentum", "reason": "แนวโน้มและโมเมนตัมระหว่างวันเป็นบวก", "setup_active": False}
    if elapsed >= 15 and relative_volume is not None and relative_volume >= 1.3:
        return {"strategy": "botOrb15", "reason": f"ตลาดผ่าน 15 นาทีแรกและ Relative Volume {relative_volume:.2f}x", "setup_active": False}
    if 45 <= momentum <= 65 and abs(price - stock_vwap) <= .5 * atr:
        return {"strategy": "botVwapReclaim", "reason": "ราคาใกล้ VWAP และ RSI อยู่ในช่วงฟื้นตัว", "setup_active": False}
    if fast > slow:
        return {"strategy": "botVwapPullback", "reason": "EMA 9 อยู่เหนือ EMA 21 · รอจังหวะย่อใกล้ VWAP", "setup_active": False}
    return {"strategy": "botVwapReclaim", "reason": "ยังไม่พบแนวโน้มเด่น · ใช้ VWAP Reclaim รอสัญญาณกลับตัว", "setup_active": False}


def opening_range_breakout_signal(rows, spy_rows, price, previous_price, session_start, elapsed_minutes,
                                  opening_relative_volume, owned=None):
    """15-minute opening range breakout, confirmed by VWAP and SPY regime."""
    def session_bars(source):
        return [row for row in source if session_start <= _timestamp(row) < session_start + 6.5 * 3600]

    stock = session_bars(rows)
    spy = session_bars(spy_rows or [])
    if not stock or not spy or elapsed_minutes < 15:
        return None, "รอข้อมูลแท่งตลาดปกติครบสำหรับ Opening Range/VWAP"

    def vwap(source):
        volume = sum(max(0.0, float(row.get("v", 0) or 0)) for row in source)
        if volume <= 0:
            return None
        return sum(((float(row["h"]) + float(row["l"]) + float(row["c"])) / 3)
                   * max(0.0, float(row.get("v", 0) or 0)) for row in source) / volume

    opening = [row for row in stock if 0 <= (_timestamp(row) - session_start) / 60 < 15]
    opening_minutes = {int((_timestamp(row) - session_start) // 60) for row in opening}
    if len(opening_minutes) < 15:
        return None, "รอแท่ง 1 นาทีครบ 15 นาทีแรก"
    opening_high = max(float(row["h"]) for row in opening)
    stock_vwap, spy_vwap = vwap(stock), vwap(spy)
    if stock_vwap is None or spy_vwap is None:
        return None, "วอลุ่ม VWAP ยังไม่พร้อม"
    spy_last = float(spy[-1]["c"])
    if owned:
        if price < stock_vwap:
            return "sell", "ราคาหุ้นหลุด VWAP ระหว่างวัน"
        return None, "ถือสถานะ · รอ VWAP/Stop/เป้ากำไร"
    if opening_relative_volume is None or opening_relative_volume < 1.3:
        return None, "งดซื้อ · วอลุ่ม 15 นาทีแรกต่ำกว่า 1.3 เท่าค่าเฉลี่ย"
    if spy_last <= spy_vwap:
        return None, "งดซื้อ · SPY อยู่ใต้ VWAP"
    if price > opening_high and (previous_price is None or previous_price <= opening_high) and price > stock_vwap:
        return "buy", f"ทะลุ Opening Range High {opening_high:.2f} · เหนือ VWAP · Relative Volume {opening_relative_volume:.2f}x"
    return None, "รอทะลุ Opening Range High เหนือ VWAP"


def protective_prices(reference_price, atr, stop_atr=1.5, reward_r=2.0):
    if reference_price <= 0 or atr is None or atr <= 0:
        raise ValueError("คำนวณ Stop/Take Profit ไม่ได้: ATR หรือราคายังไม่พร้อม")
    risk = atr * stop_atr
    return reference_price - risk, reference_price + risk * reward_r


def risk_sized_quantity(notional_cap, account_equity, risk_pct, entry_price, stop_price):
    """Whole-share size bounded by both notional and planned stop risk."""
    values = (notional_cap, account_equity, risk_pct, entry_price, stop_price)
    if any(value is None or not math.isfinite(float(value)) for value in values):
        return 0
    notional_cap, account_equity, risk_pct, entry_price, stop_price = map(float, values)
    distance = entry_price - stop_price
    if notional_cap <= 0 or account_equity <= 0 or risk_pct <= 0 or entry_price <= 0 or stop_price <= 0 or distance <= 0:
        return 0
    risk_budget = account_equity * risk_pct / 100
    return max(0, min(math.floor(notional_cap / entry_price), math.floor(risk_budget / distance)))
