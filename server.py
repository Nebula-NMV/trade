"""Tiny local server and Yahoo Finance chart-data proxy for Signal."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, unquote, urlparse, urlsplit
from urllib.request import Request, urlopen
from datetime import datetime, timedelta, timezone
from threading import Event, RLock, Thread
from urllib.parse import urlencode
import json
import base64
import hmac
import math
import os
import re
import time

from strategy_engine import (STRATEGIES as BOT_STRATEGIES, generate_signals,
                             intraday_live_signal, protective_prices)

ROOT = Path(__file__).resolve().parent
PAPER_API_BASE_URL = "https://paper-api.alpaca.markets/v2"
US_STOCKS_CACHE = {"expires_at": 0, "stocks": []}
US_STOCKS_CACHE_LOCK = RLock()


def load_dotenv():
    """Load local secrets without overriding variables already set by the OS."""
    try:
        lines = (ROOT / ".env").read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name, value = name.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        if re.fullmatch(r"[A-Z][A-Z0-9_]*", name):
            os.environ.setdefault(name, value)


load_dotenv()


def _nth_weekday(year, month, weekday, occurrence):
    first = datetime(year, month, 1)
    first_match = 1 + (weekday - first.weekday()) % 7
    return first_match + 7 * (occurrence - 1)


def eastern_timezone_for_date(day):
    """Return the current US Eastern offset without requiring Windows tzdata."""
    dst_start = datetime(day.year, 3, _nth_weekday(day.year, 3, 6, 2)).date()
    dst_end = datetime(day.year, 11, _nth_weekday(day.year, 11, 6, 1)).date()
    is_dst = dst_start <= day < dst_end
    hours = -4 if is_dst else -5
    return timezone(timedelta(hours=hours), "EDT" if is_dst else "EST")


def to_eastern(value):
    """Convert an aware timestamp to US Eastern time using current DST rules."""
    utc_value = value.astimezone(timezone.utc)
    year = utc_value.year
    start_day = _nth_weekday(year, 3, 6, 2)
    end_day = _nth_weekday(year, 11, 6, 1)
    standard = timezone(timedelta(hours=-5))
    daylight = timezone(timedelta(hours=-4))
    start_utc = datetime(year, 3, start_day, 2, tzinfo=standard).astimezone(timezone.utc)
    end_utc = datetime(year, 11, end_day, 2, tzinfo=daylight).astimezone(timezone.utc)
    return utc_value.astimezone(daylight if start_utc <= utc_value < end_utc else standard)

BOT_LOCK = RLock()
BOT_STATE_PATH = ROOT / ".signal-bot-state.json"
BOT = {
    "active": False, "strategy": None, "symbols": [], "per_trade_usd": 0,
    "max_total_usd": 0, "started_at": None, "last_check": None,
    "last_message": "บอทยังไม่ทำงาน", "events": [], "owned_positions": {},
    "thread": None, "stop_event": None, "market_stream_status": "stopped", "market_stream_socket": None,
}
BOT_MARKET_LOCK = RLock()
BOT_LIVE_TRADES = {}


def persist_bot_state():
    try:
        with BOT_LOCK:
            saved = {key: BOT.get(key) for key in (
                "strategy", "symbols", "per_trade_usd", "max_total_usd", "owned_positions", "processed",
            )}
            temporary = BOT_STATE_PATH.with_suffix(".tmp")
            temporary.write_text(json.dumps(saved, ensure_ascii=False), encoding="utf-8")
            os.replace(temporary, BOT_STATE_PATH)
    except OSError:
        pass


def restore_bot_state():
    try:
        saved = json.loads(BOT_STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    if not isinstance(saved, dict):
        return
    with BOT_LOCK:
        for key in ("strategy", "symbols", "per_trade_usd", "max_total_usd", "owned_positions", "processed"):
            if key in saved:
                BOT[key] = saved[key]
        BOT.update({"active": False, "thread": None, "stop_event": None,
                    "last_message": "กู้คืนข้อมูลบอทแล้ว · ยังไม่เริ่มทำงาน"})


def alpaca_request(path, method="GET", payload=None, market_data=False):
    key = os.environ.get("ALPACA_API_KEY", "").strip()
    secret = os.environ.get("ALPACA_SECRET_KEY", "").strip()
    if not key or not secret:
        raise RuntimeError("ยังไม่ได้ตั้งค่า ALPACA_API_KEY และ ALPACA_SECRET_KEY ในไฟล์ .env")
    base_url = os.environ.get("ALPACA_API_BASE_URL", PAPER_API_BASE_URL).strip().rstrip("/")
    if base_url != PAPER_API_BASE_URL:
        raise RuntimeError("รองรับเฉพาะ Alpaca Paper endpoint ในการตั้งค่านี้")
    root = ("https://data.alpaca.markets" if path.startswith("/v1/") else "https://data.alpaca.markets/v2") if market_data else base_url
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(root + path, data=body, method=method, headers={
        "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret,
        "Content-Type": "application/json", "Accept": "application/json",
    })
    try:
        with urlopen(request, timeout=20) as response:
            content = response.read()
            return json.loads(content) if content else {}
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        try:
            message = json.loads(detail).get("message", "")
        except (ValueError, AttributeError):
            message = ""
        raise ValueError(message or f"Alpaca ปฏิเสธคำขอ ({exc.code})") from None
    except (URLError, TimeoutError, OSError):
        raise RuntimeError("เชื่อมต่อ Alpaca ไม่ได้ กรุณาลองใหม่") from None


def response_bars(response):
    """Normalize Alpaca's no-data `bars: null` response to an empty list."""
    if not isinstance(response, dict):
        raise ValueError("รูปแบบข้อมูลแท่งราคาจาก Alpaca ไม่ถูกต้อง")
    bars = response.get("bars")
    if bars is None:
        return []
    if not isinstance(bars, list):
        raise ValueError("รายการแท่งราคาจาก Alpaca ไม่ถูกต้อง")
    return bars


def bot_snapshot():
    with BOT_LOCK:
        return {key: BOT[key] for key in (
            "active", "strategy", "symbols", "per_trade_usd", "max_total_usd",
            "started_at", "last_check", "last_message", "events", "owned_positions", "market_stream_status",
        )}


def bot_log(message):
    with BOT_LOCK:
        BOT["last_message"] = message
        BOT["events"] = ([{"time": datetime.now(timezone.utc).isoformat(), "message": message}] + BOT["events"])[:30]
    persist_bot_state()


restore_bot_state()


def bot_signal(bars, strategy, owned):
    result = generate_signals(bars, strategy)
    if len(bars) <= result["begin"]:
        return None, "ข้อมูลรายวันยังไม่พอสำหรับกลยุทธ์นี้"
    side = result["events"][-1]
    if owned:
        held = sum(1 for bar in bars if bar["t"] > owned.get("entry_bar", ""))
        if strategy == "shortSwing" and held >= 10:
            return "sell", "ครบกำหนดถือ 10 แท่งตามกติกา Swing"
        return ("sell", "เกิดสัญญาณขายตามกลยุทธ์") if side == -1 else (None, "ยังไม่มีสัญญาณขายใหม่")
    return ("buy", "เกิดสัญญาณซื้อตามกลยุทธ์") if side == 1 else (None, "ยังไม่มีสัญญาณซื้อใหม่")


def fetch_intraday_bars(symbol):
    """Return only completed regular-session one-minute bars."""
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=5)
    params = urlencode({"timeframe": "1Min", "start": start.isoformat(), "end": now.isoformat(),
                        "limit": 10000, "feed": "iex", "adjustment": "split", "sort": "asc"})
    response = alpaca_request(f"/stocks/{quote(symbol, safe='')}/bars?{params}", market_data=True)
    completed = []
    for bar in response_bars(response):
        timestamp = datetime.fromisoformat(bar["t"].replace("Z", "+00:00"))
        eastern = to_eastern(timestamp)
        minute_of_day = eastern.hour * 60 + eastern.minute
        # Alpaca timestamps bars by their opening time. Ignore unfinished,
        # pre/post-market and weekend bars so signals only use regular hours.
        if (timestamp + timedelta(minutes=1) <= now and eastern.weekday() < 5
                and 9 * 60 + 30 <= minute_of_day < 16 * 60):
            completed.append(bar)
    return completed[-1500:]


def alpaca_trade_stream(stop_event, symbols):
    """Stream IEX trades instead of waiting for the next minute bar to close."""
    try:
        import websocket
    except ImportError:
        with BOT_LOCK:
            BOT["market_stream_status"] = "dependency_missing"
        bot_log("Intraday Live ใช้ไม่ได้: ติดตั้งแพ็กเกจ websocket-client ใน Python environment ก่อน")
        return
    key = os.environ.get("ALPACA_API_KEY", "").strip()
    secret = os.environ.get("ALPACA_SECRET_KEY", "").strip()
    if not key or not secret:
        with BOT_LOCK:
            BOT["market_stream_status"] = "credentials_missing"
        bot_log("Intraday Live ใช้ไม่ได้: ไม่พบ Alpaca API key สำหรับสตรีมราคา")
        return
    while not stop_event.is_set():
        reported_error = False
        connected_logged = False

        def on_open(ws):
            with BOT_LOCK:
                BOT["market_stream_socket"] = ws
                BOT["market_stream_status"] = "authenticating"
            ws.send(json.dumps({"action": "auth", "key": key, "secret": secret}))

        def on_message(ws, message):
            nonlocal reported_error, connected_logged
            try:
                packets = json.loads(message)
                if not isinstance(packets, list):
                    packets = [packets]
            except (TypeError, ValueError):
                return
            for packet in packets:
                kind, status = packet.get("T"), packet.get("msg")
                if kind == "success" and status == "authenticated":
                    ws.send(json.dumps({"action": "subscribe", "trades": symbols}))
                    with BOT_LOCK:
                        BOT["market_stream_status"] = "subscribing"
                elif kind == "subscription" and packet.get("trades") is not None:
                    with BOT_LOCK:
                        BOT["market_stream_status"] = "connected"
                    if not connected_logged:
                        bot_log("สตรีมราคา Intraday Live เชื่อมต่อแล้ว · ใช้ราคาซื้อขาย IEX แบบเรียลไทม์")
                        connected_logged = True
                elif kind == "t":
                    symbol = str(packet.get("S", "")).upper()
                    try:
                        price = float(packet.get("p", 0))
                    except (TypeError, ValueError):
                        continue
                    if symbol in symbols and price > 0:
                        with BOT_MARKET_LOCK:
                            BOT_LIVE_TRADES[symbol] = {"price": price, "timestamp": packet.get("t"),
                                                       "received_at": time.monotonic()}
                elif kind == "error" and not reported_error:
                    with BOT_LOCK:
                        BOT["market_stream_status"] = "error"
                    bot_log(f"สตรีมราคา Alpaca ตอบข้อผิดพลาด · {status or packet.get('code', 'ไม่ทราบสาเหตุ')}")
                    reported_error = True

        def on_error(ws, error):
            nonlocal reported_error
            with BOT_LOCK:
                BOT["market_stream_status"] = "reconnecting"
            if not reported_error and not stop_event.is_set():
                bot_log(f"สตรีมราคาขาดการเชื่อมต่อ · กำลังลองใหม่ · {error}")
                reported_error = True

        def on_close(ws, status_code, message):
            with BOT_LOCK:
                if BOT.get("market_stream_socket") is ws:
                    BOT["market_stream_socket"] = None
                BOT["market_stream_status"] = "stopped" if stop_event.is_set() else "reconnecting"

        stream = websocket.WebSocketApp("wss://stream.data.alpaca.markets/v2/iex",
                                        on_open=on_open, on_message=on_message,
                                        on_error=on_error, on_close=on_close)
        stream.run_forever(ping_interval=20, ping_timeout=10)
        if not stop_event.is_set():
            stop_event.wait(2)
    with BOT_LOCK:
        BOT["market_stream_socket"] = None
        BOT["market_stream_status"] = "stopped"


def intraday_session_open(now=None):
    eastern = to_eastern(now or datetime.now(timezone.utc))
    minute_of_day = eastern.hour * 60 + eastern.minute
    return eastern.weekday() < 5 and 9 * 60 + 30 <= minute_of_day < 16 * 60


def fetch_daily_bars(symbol):
    today = to_eastern(datetime.now(timezone.utc)).date()
    start = today - timedelta(days=6 * 366)
    params = urlencode({"timeframe": "1Day", "start": start.isoformat(), "end": today.isoformat(), "limit": 10000, "feed": "iex", "adjustment": "split"})
    response = alpaca_request(f"/stocks/{quote(symbol, safe='')}/bars?{params}", market_data=True)
    bars = response_bars(response)
    completed = []
    for bar in bars:
        timestamp = datetime.fromisoformat(bar["t"].replace("Z", "+00:00"))
        if to_eastern(timestamp).date() < today:
            completed.append(bar)
    return completed[-1500:]


OPEN_ORDER_STATUSES = {"new", "accepted", "pending_new", "partially_filled", "pending_cancel", "pending_replace", "held"}


def flatten_orders(orders):
    flattened = []
    for order in orders:
        flattened.append(order)
        for leg in order.get("legs", []) or []:
            leg.setdefault("parent_order_id", order.get("id"))
            flattened.append(leg)
    return flattened


def order_price(value):
    precision = 2 if value >= 1 else 4
    return f"{value:.{precision}f}"


def cancel_order_and_wait(order_id):
    try:
        alpaca_request(f"/orders/{quote(str(order_id), safe='')}", method="DELETE")
    except (RuntimeError, ValueError):
        pass
    for _ in range(15):
        try:
            order = alpaca_request(f"/orders/{quote(str(order_id), safe='')}")
            if order.get("status") in {"canceled", "rejected", "expired", "filled"}:
                return order
        except (RuntimeError, ValueError):
            return None
        time.sleep(.25)
    return None


def place_oco_protection(symbol, position, owned):
    qty = float(position.get("qty", 0))
    stop = float(owned.get("stop", 0))
    target = float(owned.get("target", 0))
    if qty <= 0 or stop <= 0 or target <= stop:
        raise ValueError("ปริมาณหรือระดับ OCO ไม่ถูกต้อง")
    entry_id = re.sub(r"[^0-9A-Za-z]", "", str(owned.get("order_id", "")))[-10:]
    client_suffix = entry_id or re.sub(r"[^0-9A-Za-z]", "", str(owned.get("entry_date", "")))[-10:]
    result = alpaca_request("/orders", method="POST", payload={
        "symbol": symbol, "qty": f"{qty:.6f}".rstrip("0").rstrip("."), "side": "sell",
        "type": "limit", "time_in_force": "gtc", "order_class": "oco",
        "take_profit": {"limit_price": order_price(target)},
        "stop_loss": {"stop_price": order_price(stop)},
        "client_order_id": f"sg-{symbol.lower()}-{client_suffix}-oco",
    })
    owned["protection_order_id"] = result.get("id")
    return result


def close_intraday_unprotected(symbol, position, owned):
    qty = float(position.get("qty", 0))
    if qty <= 0:
        return None
    stamp = datetime.now(timezone.utc).strftime("%y%m%d%H%M%S")
    result = alpaca_request("/orders", method="POST", payload={"symbol": symbol,
        "qty": f"{qty:.6f}".rstrip("0").rstrip("."), "side": "sell", "type": "market",
        "time_in_force": "day", "client_order_id": f"sg-{symbol.lower()}-{stamp}-pf"})
    owned["exit_order_id"] = result.get("id")
    return result


def cleanup_bot_orders_on_stop():
    positions = {item["symbol"]: item for item in alpaca_request("/positions")}
    with BOT_LOCK:
        owned_positions = BOT.get("owned_positions", {})
    for symbol, owned in list(owned_positions.items()):
        position = positions.get(symbol)
        entry_id = owned.get("order_id")
        entry = alpaca_request(f"/orders/{quote(str(entry_id), safe='')}") if entry_id else {}
        status = entry.get("status")
        if status == "partially_filled" and position and not owned.get("protection_order_id"):
            cancel_order_and_wait(entry_id)
            position = {item["symbol"]: item for item in alpaca_request("/positions")}.get(symbol)
            if position:
                place_oco_protection(symbol, position, owned)
                owned["awaiting_fill"] = False
                bot_log(f"{symbol}: หยุดบอท · ยกเลิกส่วนคำสั่งที่เหลือและคง OCO ป้องกันหุ้นที่จับคู่แล้ว")
        elif not position and status in OPEN_ORDER_STATUSES:
            cancel_order_and_wait(entry_id)
            with BOT_LOCK:
                BOT.get("owned_positions", {}).pop(symbol, None)
            bot_log(f"{symbol}: หยุดบอท · ยกเลิกคำสั่งซื้อ Bracket ที่ยังไม่จับคู่")


def auto_bot_realtime_loop(stop_event):
    """Trade the live IEX stream while keeping account/order reconciliation bounded."""
    config = bot_snapshot()
    stream_thread = Thread(target=alpaca_trade_stream, args=(stop_event, config["symbols"]),
                           daemon=True, name="alpaca-market-stream")
    stream_thread.start()
    bars_cache, prior_prices, seen_ticks = {}, {}, {}
    account, positions, order_history, open_orders = {}, {}, [], []
    orders_by_id, pending = {}, set()
    next_sync = 0.0
    market_clock, next_clock_sync = None, 0.0
    while not stop_event.is_set():
        try:
            config = bot_snapshot()
            now_mono = time.monotonic()
            if now_mono >= next_clock_sync:
                next_clock_sync = now_mono + 30
                market_clock = alpaca_request("/clock")
            if now_mono >= next_sync:
                account = alpaca_request("/account")
                if account.get("trading_blocked") or account.get("account_blocked"):
                    bot_log("บัญชี Paper ถูกบล็อกการซื้อขาย · Intraday Live รอการปลดบล็อก")
                    stop_event.wait(5)
                    next_sync = time.monotonic() + 5
                    continue
                positions = {item["symbol"]: item for item in alpaca_request("/positions")}
                order_history = flatten_orders(alpaca_request("/orders?status=all&limit=500&direction=desc&nested=true"))
                open_orders = flatten_orders(alpaca_request("/orders?status=open&limit=500&direction=desc&nested=true"))
                orders_by_id = {item.get("id"): item for item in order_history}
                orders_by_id.update({item.get("id"): item for item in open_orders})
                open_orders = [item for item in open_orders if item.get("status") in OPEN_ORDER_STATUSES]
                pending = {item.get("symbol") for item in open_orders}
                with BOT_LOCK:
                    owned_positions = BOT["owned_positions"]
                    for owned_symbol, owned_data in list(owned_positions.items()):
                        position = positions.get(owned_symbol)
                        exit_id = owned_data.get("exit_order_id")
                        if exit_id:
                            exit_order = orders_by_id.get(exit_id, {})
                            if exit_order.get("status") == "filled" or not position:
                                owned_positions.pop(owned_symbol, None)
                                continue
                            if exit_order.get("status") in {"canceled", "rejected", "expired", "done_for_day"}:
                                owned_data.pop("exit_order_id", None)
                        entry_id = owned_data.get("order_id")
                        entry_order = orders_by_id.get(entry_id, {}) if entry_id else {}
                        protection_id = owned_data.get("protection_order_id")
                        linked_exit_filled = any(
                            item.get("symbol") == owned_symbol and item.get("side") == "sell" and item.get("status") == "filled"
                            and (item.get("parent_order_id") in {entry_id, protection_id} or item.get("id") == protection_id)
                            for item in order_history
                        )
                        if not position and linked_exit_filled:
                            owned_positions.pop(owned_symbol, None)
                            bot_log(f"{owned_symbol}: ล้างสถานะหลัง Stop/Take Profit ปิดแล้ว")
                            continue
                        if entry_order.get("status") in {"rejected", "canceled", "expired", "done_for_day"} and not position:
                            owned_positions.pop(owned_symbol, None)
                            continue
                        if position:
                            owned_data["qty"] = float(position.get("qty", 0))
                            owned_data["entry_price"] = float(position.get("avg_entry_price", owned_data.get("entry_price", 0)))
                            owned_data["notional"] = abs(float(position.get("market_value", owned_data.get("notional", 0))))
                            owned_data["awaiting_fill"] = entry_order.get("status") != "filled" and not protection_id
                            if (entry_order.get("status") == "filled" and not protection_id and not owned_data.get("exit_order_id")):
                                risk_distance = float(owned_data.get("risk_distance", 0))
                                fill_price = float(position.get("avg_entry_price", 0))
                                if risk_distance > 0 and fill_price > risk_distance:
                                    owned_data["stop"] = fill_price - risk_distance
                                    owned_data["target"] = fill_price + risk_distance * 1.5
                                    try:
                                        place_oco_protection(owned_symbol, position, owned_data)
                                        owned_data["awaiting_fill"] = False
                                        bot_log(f"{owned_symbol}: จับคู่แล้ว · ติด Stop/Take Profit OCO GTC")
                                    except (RuntimeError, ValueError) as exc:
                                        close_intraday_unprotected(owned_symbol, position, owned_data)
                                        bot_log(f"{owned_symbol}: ติด OCO ไม่สำเร็จ · ส่งคำสั่งปิด Paper · {exc}")
                                else:
                                    close_intraday_unprotected(owned_symbol, position, owned_data)
                                    bot_log(f"{owned_symbol}: คำนวณ Stop ไม่ได้ · ส่งคำสั่งปิด Paper")
                next_sync = time.monotonic() + (5 if intraday_session_open() else 60)

            now = datetime.now(timezone.utc)
            market_open = bool(market_clock and market_clock.get("is_open"))
            if market_open:
                eastern_now = to_eastern(now)
                minute_key = eastern_now.strftime("%Y-%m-%d %H:%M")
                market_close = datetime.fromisoformat(market_clock["next_close"].replace("Z", "+00:00")).astimezone(timezone.utc)
                minutes_to_close = (market_close - now).total_seconds() / 60
                for symbol in config["symbols"]:
                    if stop_event.is_set():
                        break
                    with BOT_LOCK:
                        owned_positions = BOT["owned_positions"]
                        owned = owned_positions.get(symbol)
                    position = positions.get(symbol)
                    if position and not owned:
                        continue
                    if owned and (owned.get("awaiting_fill") or owned.get("exit_order_id")):
                        continue
                    local_now = to_eastern(now)
                    force_close = bool(position and owned and minutes_to_close <= 10)
                    if force_close:
                        bars = []
                    else:
                        cached = bars_cache.get(symbol)
                        if not cached or cached["minute"] != minute_key:
                            bars = fetch_intraday_bars(symbol)
                            bars_cache[symbol] = {"minute": minute_key, "bars": bars}
                        else:
                            bars = cached["bars"]
                        if len(bars) < 23:
                            continue
                    with BOT_LOCK:
                        stream_connected = BOT.get("market_stream_status") == "connected"
                    tick = None
                    with BOT_MARKET_LOCK:
                        tick = BOT_LIVE_TRADES.get(symbol)
                    if not force_close:
                        if not stream_connected:
                            continue
                        if not tick or time.monotonic() - tick.get("received_at", 0) > 3:
                            continue
                        tick_timestamp = tick.get("timestamp") or str(tick.get("received_at"))
                        if seen_ticks.get(symbol) == tick_timestamp:
                            continue
                        price = float(tick["price"])
                        signal, reason = intraday_live_signal(bars, price, prior_prices.get(symbol), owned)
                        prior_prices[symbol] = price
                        seen_ticks[symbol] = tick_timestamp
                    else:
                        price = float(tick["price"]) if tick and tick.get("price") else float(position.get("current_price", 0))
                        signal, reason = "sell", "ปิดสถานะก่อนตลาดสหรัฐฯ ปิด"
                    if signal is None:
                        continue
                    if signal == "buy" and minutes_to_close <= 15:
                        continue
                    if symbol in pending and not (signal == "sell" and position and owned):
                        continue
                    stamp = datetime.now(timezone.utc).strftime("%y%m%d%H%M%S%f")[:16]
                    client_id = f"signalbot-{symbol.lower()}-{stamp}-{signal}"
                    if signal == "buy":
                        current_exposure = sum(float(positions[s].get("market_value", 0)) if s in positions else float(item.get("notional", 0))
                                               for s, item in owned_positions.items())
                        room = min(config["per_trade_usd"], config["max_total_usd"] - current_exposure,
                                   float(account.get("buying_power", 0)))
                        if room < 1:
                            continue
                        signal_data = generate_signals(bars, "intraday5m")
                        atr = signal_data["atr"][-1]
                        if atr is None or atr <= 0:
                            continue
                        stop, target = protective_prices(price, atr, 1.0, 1.5)
                        qty = math.floor(room / price)
                        if qty < 1:
                            continue
                        order = {"symbol": symbol, "qty": str(qty), "side": "buy", "type": "market",
                                 "time_in_force": "day", "client_order_id": client_id}
                        result = alpaca_request("/orders", method="POST", payload=order)
                        risk_distance = atr
                        owned_positions[symbol] = {"entry_bar": bars[-1]["t"], "entry_date": now.date().isoformat(),
                            "entry_price": price, "notional": qty * price, "qty": qty, "stop": stop, "target": target,
                            "risk_distance": risk_distance, "order_id": result.get("id"), "strategy": "intraday5m",
                            "awaiting_fill": True}
                        pending.add(symbol)
                        bot_log(f"{symbol}: ส่งคำสั่งซื้อ Market ทันที {qty} หุ้น · Stop 1 ATR / เป้า 1.5R · {reason}")
                        for _ in range(5):
                            time.sleep(.2)
                            entry = alpaca_request(f"/orders/{quote(str(result.get('id')), safe='')}")
                            if entry.get("status") == "filled":
                                positions = {item["symbol"]: item for item in alpaca_request("/positions")}
                                filled_position = positions.get(symbol)
                                if filled_position:
                                    actual = float(filled_position.get("avg_entry_price", price))
                                    owned_positions[symbol]["entry_price"] = actual
                                    if actual > risk_distance:
                                        owned_positions[symbol]["stop"] = actual - risk_distance
                                        owned_positions[symbol]["target"] = actual + risk_distance * 1.5
                                        try:
                                            place_oco_protection(symbol, filled_position, owned_positions[symbol])
                                            owned_positions[symbol]["awaiting_fill"] = False
                                            owned_positions[symbol]["notional"] = abs(float(filled_position.get("market_value", qty * actual)))
                                            bot_log(f"{symbol}: จับคู่แล้ว · วาง Stop/Take Profit OCO GTC ทันที")
                                        except (RuntimeError, ValueError) as exc:
                                            close_intraday_unprotected(symbol, filled_position, owned_positions[symbol])
                                            bot_log(f"{symbol}: OCO ไม่ผ่าน · ส่งคำสั่งปิด Paper · {exc}")
                                    else:
                                        close_intraday_unprotected(symbol, filled_position, owned_positions[symbol])
                                        bot_log(f"{symbol}: วาง Stop ที่ถูกต้องไม่ได้ · ส่งคำสั่งปิด Paper")
                                break
                            if entry.get("status") in {"rejected", "canceled", "expired", "done_for_day"}:
                                owned_positions.pop(symbol, None)
                                pending.discard(symbol)
                                bot_log(f"{symbol}: คำสั่งซื้อถูก {entry.get('status')}")
                                break
                    elif signal == "sell" and position and owned:
                        owned_exit_ids = {owned.get("protection_order_id"), owned.get("order_id")}
                        exits = [item for item in open_orders if item.get("symbol") == symbol and
                                 (item.get("id") == owned.get("protection_order_id") or item.get("parent_order_id") in owned_exit_ids)]
                        for exit_item in exits:
                            cancel_order_and_wait(exit_item.get("id"))
                        if exits:
                            time.sleep(.25)
                        positions = {item["symbol"]: item for item in alpaca_request("/positions")}
                        position = positions.get(symbol)
                        if not position:
                            owned_positions.pop(symbol, None)
                            continue
                        remaining = [item for item in flatten_orders(alpaca_request("/orders?status=open&limit=500&direction=desc&nested=true"))
                                     if item.get("symbol") == symbol and item.get("side") == "sell"]
                        if remaining:
                            continue
                        qty = float(position.get("qty", 0))
                        if qty <= 0:
                            continue
                        result = alpaca_request("/orders", method="POST", payload={"symbol": symbol,
                            "qty": f"{qty:.6f}".rstrip("0").rstrip("."), "side": "sell", "type": "market",
                            "time_in_force": "day", "client_order_id": client_id})
                        owned["exit_order_id"] = result.get("id")
                        pending.add(symbol)
                        bot_log(f"{symbol}: ส่งคำสั่งขาย Market ทันที {qty:g} หุ้น · {reason}")
            with BOT_LOCK:
                BOT["last_check"] = datetime.now(timezone.utc).isoformat()
            persist_bot_state()
        except (RuntimeError, ValueError, KeyError, TypeError) as exc:
            bot_log(f"Intraday Live รอบนี้มีข้อผิดพลาด · {exc}")
            if stop_event.wait(2):
                break
            continue
        except Exception as exc:
            bot_log(f"Intraday Live เกิดข้อผิดพลาดภายใน ({type(exc).__name__}) · {exc} · จะลองใหม่ใน 2 วินาที")
            if stop_event.wait(2):
                break
            continue
        if stop_event.wait(.25):
            break
    try:
        cleanup_bot_orders_on_stop()
    except (RuntimeError, ValueError, KeyError, TypeError) as exc:
        bot_log(f"หยุดบอทแล้ว แต่ตรวจคำสั่งค้างไม่สำเร็จ · {exc}")
    stream_thread.join(timeout=2)
    with BOT_LOCK:
        BOT["active"] = False
        BOT["thread"] = None
        BOT["stop_event"] = None
        BOT["market_stream_status"] = "stopped"
    persist_bot_state()
    bot_log("บอท Intraday Live หยุดทำงานแล้ว")


def auto_bot_loop(stop_event):
    if bot_snapshot().get("strategy") == "intraday5m":
        try:
            auto_bot_realtime_loop(stop_event)
        except Exception as exc:
            bot_log(f"บอท Intraday Live หยุดเพราะข้อผิดพลาด ({type(exc).__name__}) · {exc}")
            with BOT_LOCK:
                BOT["active"] = False
                BOT["thread"] = None
                BOT["stop_event"] = None
                BOT["market_stream_status"] = "error"
            persist_bot_state()
        return
    while not stop_event.is_set():
        try:
            config = bot_snapshot()
            account = alpaca_request("/account")
            if account.get("trading_blocked") or account.get("account_blocked"):
                bot_log("บัญชี Paper ถูกบล็อกการซื้อขาย · บอทหยุดตรวจสัญญาณ")
                stop_event.wait(60)
                continue
            positions = {item["symbol"]: item for item in alpaca_request("/positions")}
            order_history = flatten_orders(alpaca_request("/orders?status=all&limit=500&direction=desc&nested=true"))
            open_orders = flatten_orders(alpaca_request("/orders?status=open&limit=500&direction=desc&nested=true"))
            orders_by_id = {order.get("id"): order for order in order_history}
            orders_by_id.update({order.get("id"): order for order in open_orders})
            open_orders = [order for order in open_orders if order.get("status") in OPEN_ORDER_STATUSES]
            pending = {order["symbol"] for order in open_orders}
            with BOT_LOCK:
                owned_positions = BOT["owned_positions"]
                processed = BOT.setdefault("processed", {})
                for owned_symbol, owned_data in list(owned_positions.items()):
                    position = positions.get(owned_symbol)
                    exit_id = owned_data.get("exit_order_id")
                    if exit_id:
                        exit_order = orders_by_id.get(exit_id, {})
                        if exit_order.get("status") == "filled" or not position:
                            owned_positions.pop(owned_symbol, None)
                            continue
                        if exit_order.get("status") in ("canceled", "rejected", "expired", "done_for_day"):
                            owned_data.pop("exit_order_id", None)
                    entry_id = owned_data.get("order_id")
                    if entry_id:
                        entry_order = orders_by_id.get(entry_id, {})
                        protection_id = owned_data.get("protection_order_id")
                        linked_exit_filled = any(
                            order.get("symbol") == owned_symbol and order.get("side") == "sell"
                            and order.get("status") == "filled"
                            and (order.get("parent_order_id") in {entry_id, protection_id}
                                 or order.get("id") == protection_id)
                            for order in order_history
                        )
                        if not position and linked_exit_filled:
                            owned_positions.pop(owned_symbol, None)
                            bot_log(f"{owned_symbol}: ล้างสถานะบอทหลัง Stop/Take Profit ปิดสถานะแล้ว")
                            continue
                        if not position and entry_order.get("status") in OPEN_ORDER_STATUSES:
                            submitted_at = entry_order.get("submitted_at") or entry_order.get("created_at")
                            if submitted_at:
                                submitted = datetime.fromisoformat(submitted_at.replace("Z", "+00:00"))
                                if datetime.now(timezone.utc) - submitted.astimezone(timezone.utc) >= timedelta(days=7):
                                    cancel_order_and_wait(entry_id)
                                    entry_order = alpaca_request(f"/orders/{quote(str(entry_id), safe='')}")
                                    if entry_order.get("status") in {"canceled", "rejected", "expired"}:
                                        owned_positions.pop(owned_symbol, None)
                                        bot_log(f"{owned_symbol}: ยกเลิกคำสั่งซื้อ Bracket ที่ค้างเกิน 7 วัน")
                                        continue
                        if entry_order.get("status") in ("rejected", "canceled", "expired", "done_for_day") and not position:
                            owned_positions.pop(owned_symbol, None)
                            continue
                        if entry_order.get("status") == "partially_filled" and position:
                            cancel_order_and_wait(entry_id)
                            position = {item["symbol"]: item for item in alpaca_request("/positions")}.get(owned_symbol)
                            if position:
                                try:
                                    place_oco_protection(owned_symbol, position, owned_data)
                                    owned_data["awaiting_fill"] = False
                                    bot_log(f"{owned_symbol}: คำสั่งซื้อจับคู่บางส่วน · ยกเลิกส่วนที่เหลือและติด OCO ให้หุ้นที่จับคู่แล้ว")
                                except (RuntimeError, ValueError) as exc:
                                    qty = float(position.get("qty", 0))
                                    if qty > 0:
                                        alpaca_request("/orders", method="POST", payload={"symbol": owned_symbol,
                                            "qty": f"{qty:.6f}".rstrip("0").rstrip("."), "side": "sell", "type": "market",
                                            "time_in_force": "day", "client_order_id": f"signalbot-{owned_symbol.lower()}-partial-exit"})
                                    owned_positions.pop(owned_symbol, None)
                                    bot_log(f"{owned_symbol}: ติด OCO ไม่สำเร็จ จึงส่งคำสั่งปิด Paper · {exc}")
                        elif not position and entry_order.get("status") != "filled":
                            owned_data["awaiting_fill"] = True
                        elif position:
                            owned_data["awaiting_fill"] = entry_order.get("status") != "filled" and not owned_data.get("protection_order_id")
                            owned_data["qty"] = float(position.get("qty", 0))
                            owned_data["entry_price"] = float(position.get("avg_entry_price", owned_data.get("entry_price", 0)))
                            if not owned_data["awaiting_fill"]:
                                owned_data["notional"] = abs(float(position.get("market_value", owned_data.get("notional", 0))))
                            if (owned_data.get("strategy") == "intraday5m" and entry_order.get("status") == "filled"
                                    and not owned_data.get("protection_order_id") and not owned_data.get("exit_order_id")):
                                risk_distance = float(owned_data.get("risk_distance", 0))
                                entry_price = float(position.get("avg_entry_price", 0))
                                if risk_distance > 0 and entry_price > risk_distance:
                                    owned_data["stop"] = entry_price - risk_distance
                                    owned_data["target"] = entry_price + risk_distance * 1.5
                                    try:
                                        protection = place_oco_protection(owned_symbol, position, owned_data)
                                        bot_log(f"{owned_symbol}: ซื้อจับคู่แล้ว · ติด Stop/Take Profit แบบ OCO GTC")
                                    except (RuntimeError, ValueError) as exc:
                                        close_intraday_unprotected(owned_symbol, position, owned_data)
                                        bot_log(f"{owned_symbol}: ติด OCO ไม่สำเร็จ · ส่งคำสั่งปิด Paper เพื่อไม่ปล่อยสถานะไร้ Stop · {exc}")
                                else:
                                    close_intraday_unprotected(owned_symbol, position, owned_data)
                                    bot_log(f"{owned_symbol}: ราคา/ATR ทำ Stop ที่ถูกต้องไม่ได้ · ส่งคำสั่งปิด Paper")
            for symbol in config["symbols"]:
                if stop_event.is_set():
                    break
                held_position = positions.get(symbol)
                owned = owned_positions.get(symbol)
                strategy = owned.get("strategy", config["strategy"]) if owned else config["strategy"]
                intraday = strategy == "intraday5m"
                if intraday:
                    now = datetime.now(timezone.utc)
                    if not intraday_session_open(now):
                        continue
                    bars = fetch_intraday_bars(symbol)
                    if len(bars) < 23:
                        bot_log(f"{symbol}: แท่ง 5 นาทีที่ปิดแล้วมีไม่พอสำหรับ EMA 9/21 + RSI")
                        continue
                    latest_bar_time = datetime.fromisoformat(bars[-1]["t"].replace("Z", "+00:00"))
                    if now - latest_bar_time > timedelta(minutes=10):
                        continue
                    last_date = bars[-1]["t"]
                    eastern_now = to_eastern(now)
                    force_close = held_position and owned and eastern_now.hour * 60 + eastern_now.minute >= 15 * 60 + 50
                    processed_key = f"{last_date}:close" if force_close else last_date
                    if processed.get(symbol) == processed_key:
                        continue
                else:
                    bars = fetch_daily_bars(symbol)
                    if len(bars) < 56:
                        bot_log(f"{symbol}: ข้อมูลรายวันไม่พอสำหรับกลยุทธ์")
                        continue
                    last_date = to_eastern(datetime.fromisoformat(bars[-1]["t"].replace("Z", "+00:00"))).date().isoformat()
                    processed_key = last_date
                    force_close = False
                    if processed.get(symbol) == processed_key:
                        continue
                if owned and owned.get("awaiting_fill"):
                    bot_log(f"{symbol}: รอคำสั่งซื้อจับคู่")
                    processed[symbol] = processed_key
                    continue
                if held_position and not owned:
                    bot_log(f"{symbol}: มีสถานะที่ไม่ได้เปิดโดยบอท · ข้ามเพื่อไม่ขายหุ้นเดิม")
                    processed[symbol] = processed_key
                    continue
                if force_close:
                    signal, reason = "sell", "ปิดสถานะก่อนตลาดสหรัฐฯ ปิด"
                else:
                    signal, reason = bot_signal(bars, strategy, owned)
                if intraday and signal == "buy" and to_eastern(datetime.now(timezone.utc)).hour * 60 + to_eastern(datetime.now(timezone.utc)).minute >= 15 * 60 + 45:
                    signal, reason = None, "งดเปิดสถานะใหม่ใน 15 นาทีก่อนตลาดปิด"
                if signal is None:
                    bot_log(f"{symbol}: {reason}")
                    processed[symbol] = processed_key
                    continue
                if symbol in pending and not (signal == "sell" and held_position and owned):
                    bot_log(f"{symbol}: มีคำสั่งค้างอยู่ · ข้ามสัญญาณ {signal}")
                    processed[symbol] = processed_key
                    continue
                order_stamp = re.sub(r"[^0-9A-Za-z]", "", last_date)[:16]
                client_id = f"signalbot-{symbol.lower()}-{order_stamp}-{signal}"
                if signal == "buy":
                    current_exposure = sum(float(positions[s].get("market_value", 0)) if s in positions else float(owned.get("notional", 0)) for s, owned in owned_positions.items())
                    room = min(config["per_trade_usd"], config["max_total_usd"] - current_exposure, float(account.get("buying_power", 0)))
                    if room < 1:
                        bot_log(f"{symbol}: วงเงินบอทหรือ buying power ไม่พอสำหรับคำสั่งซื้อ")
                        processed[symbol] = processed_key
                        continue
                    signal_data = generate_signals(bars, strategy)
                    atr = signal_data["atr"][-1]
                    reference = float(bars[-1]["c"])
                    stop, target = protective_prices(reference, atr, signal_data["riskAtr"], signal_data["rewardRisk"])
                    entry_limit = max(reference * (1 + signal_data["entryBufferPct"]), reference + signal_data["entryBufferAbsolute"])
                    target = max(target, entry_limit + signal_data["entryBufferAbsolute"])
                    stop = min(stop, entry_limit - signal_data["entryBufferAbsolute"])
                    qty = math.floor(room / entry_limit)
                    if qty < 1:
                        bot_log(f"{symbol}: งบ ${room:.2f} ต่ำกว่าราคาหนึ่งหุ้น · ข้ามเพื่อไม่เกินวงเงิน")
                        processed[symbol] = processed_key
                        continue
                    if intraday:
                        # Market entry follows the closed-bar signal immediately;
                        # a separate GTC OCO is attached as soon as the fill is visible.
                        order = {"symbol": symbol, "qty": str(qty), "side": "buy", "type": "market",
                                 "time_in_force": "day", "client_order_id": client_id}
                    else:
                        order = {"symbol": symbol, "qty": str(qty), "side": "buy", "type": "limit", "limit_price": order_price(entry_limit),
                                 "time_in_force": "gtc", "order_class": "bracket",
                                 "take_profit": {"limit_price": order_price(target)},
                                 "stop_loss": {"stop_price": order_price(stop)}, "client_order_id": client_id}
                    result = alpaca_request("/orders", method="POST", payload=order)
                    risk_distance = atr * signal_data["riskAtr"]
                    owned_positions[symbol] = {"entry_bar": bars[-1]["t"], "entry_date": last_date, "entry_price": reference,
                                               "notional": min(room, qty * (reference if intraday else entry_limit)), "qty": qty, "stop": stop, "target": target,
                                               "risk_distance": risk_distance if intraday else None,
                                               "order_id": result.get("id"), "strategy": strategy, "awaiting_fill": True}
                    processed[symbol] = processed_key
                    if intraday:
                        bot_log(f"{symbol}: ส่ง Market Paper ซื้อ {qty} หุ้น · รอติด Stop {signal_data['riskAtr']:g} ATR / เป้า {signal_data['rewardRisk']:g}R · {reason}")
                        # Market orders normally fill immediately. Check promptly
                        # so the GTC OCO protection is live without waiting a full poll.
                        for _ in range(5):
                            time.sleep(.2)
                            entry_status = alpaca_request(f"/orders/{quote(str(result.get('id')), safe='')}")
                            if entry_status.get("status") == "filled":
                                positions = {item["symbol"]: item for item in alpaca_request("/positions")}
                                filled_position = positions.get(symbol)
                                if filled_position:
                                    actual_entry = float(filled_position.get("avg_entry_price", reference))
                                    owned_positions[symbol]["entry_price"] = actual_entry
                                    if risk_distance > 0 and actual_entry > risk_distance:
                                        owned_positions[symbol]["stop"] = actual_entry - risk_distance
                                        owned_positions[symbol]["target"] = actual_entry + risk_distance * signal_data["rewardRisk"]
                                        try:
                                            place_oco_protection(symbol, filled_position, owned_positions[symbol])
                                            owned_positions[symbol]["awaiting_fill"] = False
                                            owned_positions[symbol]["notional"] = abs(float(filled_position.get("market_value", qty * actual_entry)))
                                            bot_log(f"{symbol}: ซื้อจับคู่แล้ว · ติด Stop/Take Profit แบบ OCO GTC")
                                        except (RuntimeError, ValueError) as exc:
                                            close_intraday_unprotected(symbol, filled_position, owned_positions[symbol])
                                            bot_log(f"{symbol}: ติด OCO ไม่สำเร็จ · ส่งคำสั่งปิด Paper · {exc}")
                                    else:
                                        close_intraday_unprotected(symbol, filled_position, owned_positions[symbol])
                                        bot_log(f"{symbol}: ราคา/ATR ทำ Stop ที่ถูกต้องไม่ได้ · ส่งคำสั่งปิด Paper")
                                break
                            if entry_status.get("status") in {"rejected", "canceled", "expired"}:
                                owned_positions.pop(symbol, None)
                                bot_log(f"{symbol}: คำสั่ง Market ถูก {entry_status.get('status')} · ไม่เปิดสถานะ")
                                break
                    else:
                        bot_log(f"{symbol}: ส่ง Bracket Paper ซื้อ {qty} หุ้น · Limit ${order_price(entry_limit)} · Stop ${order_price(stop)} · Take Profit ${order_price(target)} · {reason}")
                elif signal == "sell" and held_position:
                    owned_exit_ids = {owned.get("protection_order_id"), owned.get("order_id")}
                    exit_orders = [order_item for order_item in open_orders if order_item.get("symbol") == symbol and
                                   (order_item.get("id") == owned.get("protection_order_id") or
                                    order_item.get("parent_order_id") in owned_exit_ids)]
                    for exit_order in exit_orders:
                        cancel_order_and_wait(exit_order.get("id"))
                    if exit_orders:
                        time.sleep(.5)
                    positions = {item["symbol"]: item for item in alpaca_request("/positions")}
                    held_position = positions.get(symbol)
                    if not held_position:
                        owned_positions.pop(symbol, None)
                        processed[symbol] = processed_key
                        bot_log(f"{symbol}: คำสั่ง Stop/Take Profit ปิดสถานะไปแล้วระหว่างยกเลิก OCO")
                        continue
                    remaining_exits = [order_item for order_item in flatten_orders(alpaca_request("/orders?status=open&limit=500&direction=desc&nested=true"))
                                       if order_item.get("symbol") == symbol and order_item.get("side") == "sell"]
                    if remaining_exits:
                        bot_log(f"{symbol}: ยังมีคำสั่งขายป้องกันที่ยกเลิกไม่เสร็จ · รอรอบถัดไปก่อนส่งสัญญาณขาย")
                        processed[symbol] = processed_key
                        continue
                    qty = float(held_position.get("qty", 0))
                    if qty <= 0:
                        processed[symbol] = processed_key
                        continue
                    order = {"symbol": symbol, "qty": f"{qty:.6f}".rstrip("0").rstrip("."), "side": "sell", "type": "market", "time_in_force": "day", "client_order_id": client_id}
                    result = alpaca_request("/orders", method="POST", payload=order)
                    owned_positions[symbol]["exit_order_id"] = result.get("id")
                    processed[symbol] = processed_key
                    bot_log(f"{symbol}: ส่งคำสั่งขาย Paper {qty:g} หุ้น · {reason}")
            with BOT_LOCK:
                BOT["last_check"] = datetime.now(timezone.utc).isoformat()
            persist_bot_state()
        except (RuntimeError, ValueError, KeyError, TypeError) as exc:
            bot_log(f"บอทหยุดรอบตรวจนี้: {exc}")
        if stop_event.wait(60):
            break
    try:
        cleanup_bot_orders_on_stop()
    except (RuntimeError, ValueError, KeyError, TypeError) as exc:
        bot_log(f"หยุดบอทแล้ว แต่ตรวจคำสั่งค้างไม่สำเร็จ · {exc}")
    with BOT_LOCK:
        BOT["active"] = False
        BOT["thread"] = None
        BOT["stop_event"] = None
    persist_bot_state()
    bot_log("บอทหยุดทำงานแล้ว")


def start_auto_bot(payload):
    strategy = str(payload.get("strategy", ""))
    symbols = payload.get("symbols", [])
    per_trade = float(payload.get("per_trade_usd", 0))
    max_total = float(payload.get("max_total_usd", 0))
    if strategy not in BOT_STRATEGIES or not isinstance(symbols, list) or not 1 <= len(symbols) <= 10:
        raise ValueError("เลือกกลยุทธ์และหุ้น 1–10 ตัวให้ถูกต้อง")
    if strategy == "intraday5m":
        try:
            import websocket  # noqa: F401
        except ImportError:
            raise RuntimeError("Intraday Live ต้องติดตั้งแพ็กเกจ websocket-client ใน Python environment ก่อน") from None
    symbols = list(dict.fromkeys(str(symbol).strip().upper() for symbol in symbols))
    if any(not re.fullmatch(r"[A-Z][A-Z0-9.-]{0,14}", symbol) for symbol in symbols):
        raise ValueError("สัญลักษณ์หุ้นไม่ถูกต้อง")
    with BOT_LOCK:
        previously_owned = list(BOT.get("owned_positions", {}).keys())
    symbols = list(dict.fromkeys(symbols + previously_owned))
    if len(symbols) > 10:
        raise ValueError("มีสถานะที่บอทดูแลจากรอบก่อนเกินขีดจำกัด 10 ตัว · ปิดสถานะก่อนเริ่มรอบใหม่")
    if not math.isfinite(per_trade) or not math.isfinite(max_total) or per_trade < 1 or per_trade > 10000 or max_total < per_trade or max_total > 100000:
        raise ValueError("วงเงินต่อหุ้นต้อง $1–$10,000 และวงเงินรวมต้องมากกว่าหรือเท่ากับวงเงินต่อหุ้น (ไม่เกิน $100,000)")
    account = alpaca_request("/account")
    if account.get("trading_blocked") or account.get("account_blocked"):
        raise ValueError("บัญชี Alpaca ไม่อนุญาตให้ซื้อขายในขณะนี้")
    for symbol in symbols:
        asset = alpaca_request("/assets/" + quote(symbol, safe=".-"))
        if asset.get("class") != "us_equity" or not asset.get("tradable"):
            raise ValueError(f"{symbol} ไม่ใช่หุ้นสหรัฐฯ ที่ซื้อขายได้")
    with BOT_LOCK:
        if BOT["active"]:
            raise ValueError("บอทกำลังทำงานอยู่แล้ว")
        stop_event = Event()
        initial_message = "เริ่มบอทแล้ว · กำลังเชื่อมต่อสตรีมราคา Live" if strategy == "intraday5m" else "เริ่มบอทแล้ว · รอตรวจแท่งรายวันปิด"
        if strategy == "intraday5m":
            with BOT_MARKET_LOCK:
                BOT_LIVE_TRADES.clear()
        BOT.update({"active": True, "strategy": strategy, "symbols": symbols, "per_trade_usd": per_trade,
                    "max_total_usd": max_total, "started_at": datetime.now(timezone.utc).isoformat(),
                    "last_check": None, "last_message": initial_message,
                    "market_stream_status": "connecting" if strategy == "intraday5m" else "stopped",
                    "events": [], "owned_positions": BOT.get("owned_positions", {}),
                    "processed": BOT.get("processed", {}), "stop_event": stop_event})
        thread = Thread(target=auto_bot_loop, args=(stop_event,), daemon=True, name="alpaca-paper-bot")
        BOT["thread"] = thread
        thread.start()
    bot_log(f"เริ่มบอท Paper · {strategy} · {', '.join(symbols)} · ต่อไม้ ${per_trade:.2f} · รวมสูงสุด ${max_total:.2f}")
    return bot_snapshot()


def stop_auto_bot():
    with BOT_LOCK:
        stop_event = BOT.get("stop_event")
        stream = BOT.get("market_stream_socket")
        if stop_event:
            stop_event.set()
    if stream:
        try:
            stream.close()
        except Exception:
            pass
    return bot_snapshot()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if not self.authorize_request():
            return
        parsed = urlparse(self.path)
        if any(part.casefold() in {".env", BOT_STATE_PATH.name.casefold()} for part in Path(unquote(parsed.path)).parts):
            return self.send_json(404, {"error": "ไม่พบไฟล์นี้"})
        if parsed.path.startswith("/api/alpaca/") and not self.valid_local_api_request():
            return self.send_json(403, {"error": "คำขอ API ต้องมาจากเว็บแอปในเครื่องนี้"})
        if parsed.path.startswith("/api/alpaca/"):
            return self.handle_alpaca_get(parsed.path, parse_qs(parsed.query))
        if parsed.path == "/api/universe/us-stocks":
            return self.handle_us_stock_universe()
        if parsed.path != "/api/chart":
            return super().do_GET()
        query = parse_qs(parsed.query)
        symbol = query.get("symbol", [""])[0].strip().upper()
        history_range = query.get("range", ["10y"])[0]
        if not re.fullmatch(r"[A-Z0-9^=._-]{1,24}", symbol):
            return self.send_json(400, {"error": "รูปแบบสัญลักษณ์หุ้นไม่ถูกต้อง"})
        if history_range not in {"10y", "max"}:
            return self.send_json(400, {"error": "ช่วงข้อมูลกราฟไม่ถูกต้อง"})
        url = ("https://query1.finance.yahoo.com/v8/finance/chart/"
               f"{quote(symbol, safe='^=._-')}?range={history_range}&interval=1d&events=div%2Csplits")
        try:
            request = Request(url, headers={"User-Agent": "Mozilla/5.0 SignalTechnicalAnalysis/1.0"})
            with urlopen(request, timeout=15) as response:
                body = response.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except HTTPError as exc:
            self.send_json(exc.code, {"error": "ผู้ให้บริการข้อมูลปฏิเสธคำขอ ลองอีกครั้งภายหลัง"})
        except (URLError, TimeoutError, OSError):
            self.send_json(502, {"error": "เชื่อมต่อผู้ให้บริการข้อมูลไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่"})

    def handle_us_stock_universe(self):
        with US_STOCKS_CACHE_LOCK:
            if US_STOCKS_CACHE["stocks"] and US_STOCKS_CACHE["expires_at"] > time.time():
                return self.send_json(200, {"stocks": US_STOCKS_CACHE["stocks"], "source": "Nasdaq Trader Symbol Directory",
                                            "updated_at": datetime.fromtimestamp(US_STOCKS_CACHE["expires_at"] - 43200, timezone.utc).isoformat()})
            sources = (
                ("https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt", "nasdaq"),
                ("https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt", "other"),
            )
            stocks, seen = [], set()
            try:
                for url, market in sources:
                    request = Request(url, headers={"User-Agent": "Mozilla/5.0 SignalTechnicalAnalysis/1.0"})
                    with urlopen(request, timeout=20) as response:
                        rows = response.read().decode("utf-8-sig", errors="replace").splitlines()
                    if not rows or "|" not in rows[0]:
                        raise ValueError("รูปแบบรายชื่อหุ้นจาก Nasdaq Trader ไม่ถูกต้อง")
                    headers = [value.strip().casefold() for value in rows[0].split("|")]
                    for line in rows[1:]:
                        columns = line.split("|")
                        if len(columns) < len(headers) or line.startswith("File Creation Time"):
                            continue
                        row = dict(zip(headers, columns))
                        symbol = (row.get("symbol") if market == "nasdaq" else row.get("cqs symbol") or row.get("act symbol") or "").strip().upper().replace("/", "-")
                        name = row.get("security name", "").strip()
                        if (row.get("test issue", "N").strip().upper() == "Y"
                                or row.get("etf", "N").strip().upper() == "Y"
                                or re.search(r"\b(warrants?|rights?|units?|preferred|debentures?|notes?|bonds?)\b", name, re.IGNORECASE)
                                or not re.fullmatch(r"[A-Z][A-Z0-9.-]{0,14}", symbol)
                                or symbol in seen or not name):
                            continue
                        seen.add(symbol)
                        stocks.append({"symbol": symbol, "name": name,
                                       "exchange": "NASDAQ" if market == "nasdaq" else row.get("exchange", "").strip()})
            except (HTTPError, URLError, TimeoutError, OSError, ValueError) as exc:
                return self.send_json(503, {"error": f"โหลดรายชื่อหุ้นสหรัฐฯ ไม่สำเร็จ · {exc}"})
            if not stocks:
                return self.send_json(503, {"error": "ไม่พบรายชื่อหุ้นใน Nasdaq Trader Symbol Directory"})
            expires_at = time.time() + 43200
            US_STOCKS_CACHE.update({"expires_at": expires_at, "stocks": stocks})
            return self.send_json(200, {"stocks": stocks, "source": "Nasdaq Trader Symbol Directory",
                                        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")})

    def do_POST(self):
        if not self.authorize_request():
            return
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/") and not self.valid_local_api_request():
            return self.send_json(403, {"error": "ปฏิเสธคำขอจากแหล่งที่มาอื่น"})
        if parsed.path == "/api/strategy/signals":
            return self.handle_strategy_signals()
        if parsed.path == "/api/alpaca/orders":
            return self.handle_alpaca_order()
        if parsed.path == "/api/alpaca/bot/start":
            return self.handle_bot_start()
        if parsed.path == "/api/alpaca/bot/stop":
            self.send_json(200, stop_auto_bot())
            return
        self.send_json(404, {"error": "ไม่พบ endpoint นี้"})

    def valid_local_api_request(self):
        """Reject cross-origin browser requests and Host-header rebinding."""
        try:
            host_header = self.headers.get("Host", "")
            host = urlsplit("//" + host_header).hostname
            if not host or host_header != self.headers.get("Host", ""):
                return False
            origin = self.headers.get("Origin")
            if origin:
                parsed_origin = urlsplit(origin)
                forwarded_proto = self.headers.get("X-Forwarded-Proto", "http").split(",", 1)[0].strip()
                if (parsed_origin.scheme not in {"http", "https"} or parsed_origin.hostname != host
                        or parsed_origin.scheme != forwarded_proto or parsed_origin.username or parsed_origin.password):
                    return False
            if self.headers.get("Sec-Fetch-Site", "").lower() == "cross-site":
                return False
            return True
        except (ValueError, TypeError):
            return False

    def handle_strategy_signals(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 4_000_000:
                return self.send_json(400, {"error": "ข้อมูลสำหรับคำนวณสัญญาณไม่ถูกต้อง"})
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict) or not isinstance(payload.get("rows"), list):
                return self.send_json(400, {"error": "รูปแบบข้อมูลแท่งราคาไม่ถูกต้อง"})
            rows = payload["rows"]
            if not 1 <= len(rows) <= 4000:
                return self.send_json(400, {"error": "รองรับข้อมูลไม่เกิน 4,000 แท่งต่อครั้ง"})
            previous_time = None
            for row in rows:
                if not isinstance(row, dict):
                    return self.send_json(400, {"error": "รูปแบบแท่งราคาไม่ถูกต้อง"})
                stamp = row.get("t")
                if not isinstance(stamp, (int, float)) or not math.isfinite(stamp):
                    return self.send_json(400, {"error": "เวลาในแท่งราคาไม่ถูกต้อง"})
                if previous_time is not None and stamp <= previous_time:
                    return self.send_json(400, {"error": "แท่งราคาต้องเรียงเวลาจากเก่าไปใหม่และไม่มีเวลาซ้ำ"})
                previous_time = stamp
                for key in ("o", "h", "l", "c"):
                    value = row.get(key)
                    if not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
                        return self.send_json(400, {"error": "ราคา OHLC ต้องเป็นตัวเลขบวก"})
                if (row["l"] > row["h"] or row["h"] < max(row["o"], row["c"])
                        or row["l"] > min(row["o"], row["c"])):
                    return self.send_json(400, {"error": "ช่วง High/Low ของแท่งราคาไม่ครอบคลุม Open/Close"})
            return self.send_json(200, generate_signals(rows, str(payload.get("strategy", ""))))
        except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
            return self.send_json(400, {"error": str(exc) or "คำนวณสัญญาณไม่ได้"})

    def alpaca_request(self, path, method="GET", payload=None):
        return alpaca_request(path, method, payload)

    def handle_alpaca_get(self, path, query=None):
        query = query or {}
        if path == "/api/alpaca/bot":
            return self.send_json(200, bot_snapshot())
        if path == "/api/alpaca/snapshot":
            symbol = query.get("symbol", [""])[0].strip().upper()
            if not re.fullmatch(r"[A-Z][A-Z0-9.-]{0,14}", symbol):
                return self.send_json(400, {"error": "รูปแบบสัญลักษณ์หุ้นไม่ถูกต้อง"})
            try:
                snapshot = alpaca_request(
                    f"/stocks/{quote(symbol, safe='.-')}/snapshot", market_data=True)
                return self.send_json(200, {"symbol": symbol, "feed": "subscription-default", **snapshot})
            except (RuntimeError, ValueError, KeyError, TypeError) as exc:
                return self.send_json(503, {"error": str(exc) or "โหลดราคาล่าสุดจาก Alpaca ไม่สำเร็จ"})
        if path == "/api/alpaca/dividends":
            symbols = sorted(set(item.strip().upper() for item in query.get("symbols", [""])[0].split(",") if item.strip()))
            if not symbols or len(symbols) > 100 or any(not re.fullmatch(r"[A-Z][A-Z0-9.-]{0,14}", item) for item in symbols):
                return self.send_json(400, {"error": "รายการ Ticker สำหรับค้นหาวัน XD ไม่ถูกต้อง"})
            today = datetime.now(timezone.utc).date()
            start_date, end_date = today - timedelta(days=365), today + timedelta(days=365)
            params = {"symbols": ",".join(symbols), "types": "cash_dividend", "start": start_date.isoformat(),
                      "end": end_date.isoformat(), "limit": 1000, "sort": "asc"}
            upcoming_by_key, page_token, page_count = {}, None, 0
            try:
                while page_count < 10:
                    page_params = dict(params)
                    if page_token:
                        page_params["page_token"] = page_token
                    result = alpaca_request(f"/v1/corporate-actions?{urlencode(page_params)}", market_data=True)
                    for action in result.get("cash_dividends") or []:
                        symbol = str(action.get("symbol") or "").upper()
                        ex_date = str(action.get("ex_date") or "")
                        amount = float(action.get("rate") or 0)
                        if symbol not in symbols or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", ex_date) or ex_date < today.isoformat() or amount <= 0:
                            continue
                        upcoming_by_key[(symbol, ex_date)] = {"date": ex_date, "amount": amount,
                                                              "payableDate": action.get("payable_date"),
                                                              "special": str(action.get("special", "")).lower() in {"true", "1", "yes"}}
                    page_count += 1
                    page_token = result.get("next_page_token")
                    if not page_token:
                        break
                upcoming = {}
                for (symbol, _), action in sorted(upcoming_by_key.items(), key=lambda item: item[0][1]):
                    upcoming.setdefault(symbol, action)
                payload = {"upcoming": upcoming, "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
                return self.send_json(200, payload)
            except (RuntimeError, ValueError, KeyError, TypeError) as exc:
                return self.send_json(503, {"error": str(exc) or "โหลดกำหนดการ XD ไม่สำเร็จ"})
        if path == "/api/alpaca/bars/batch":
            raw_symbols = query.get("symbols", [""])[0]
            symbols = list(dict.fromkeys(item.strip().upper() for item in raw_symbols.split(",") if item.strip()))
            timeframe = query.get("timeframe", [""])[0]
            if (not symbols or len(symbols) > 30 or
                    any(not re.fullmatch(r"[A-Z][A-Z0-9.-]{0,14}", item) for item in symbols)):
                return self.send_json(400, {"error": "รายการหุ้นสำหรับสแกนไม่ถูกต้อง (ส่งได้ครั้งละ 1–30 หุ้น)"})
            if timeframe not in {"1Day", "1Min", "5Min", "15Min"}:
                return self.send_json(400, {"error": "กรอบเวลาสแกนไม่ถูกต้อง"})
            now = datetime.now(timezone.utc)
            # Cover weekends/market holidays and enough regular-session bars for EMA 200.
            lookback_days = {"1Day": 400, "1Min": 7, "5Min": 8, "15Min": 16}[timeframe]
            start = now - timedelta(days=lookback_days)
            bars_by_symbol = {symbol: {} for symbol in symbols}
            feed = None
            page_token = None
            page_count = 0
            try:
                while page_count < 20:
                    params = {
                        "symbols": ",".join(symbols), "timeframe": timeframe,
                        "start": start.isoformat(timespec="seconds").replace("+00:00", "Z"),
                        "end": now.isoformat(timespec="seconds").replace("+00:00", "Z"),
                        "limit": 10000, "sort": "asc", "adjustment": "split",
                    }
                    if feed:
                        params["feed"] = feed
                    if page_token:
                        params["page_token"] = page_token
                    try:
                        result = alpaca_request(f"/stocks/bars?{urlencode(params)}", market_data=True)
                    except ValueError as exc:
                        if "subscription does not permit querying recent sip data" in str(exc).lower() and feed != "iex":
                            feed, page_token, page_count = "iex", None, 0
                            bars_by_symbol = {symbol: {} for symbol in symbols}
                            continue
                        raise
                    grouped = result.get("bars") or {}
                    if not isinstance(grouped, dict):
                        raise ValueError("รูปแบบข้อมูลแท่งราคาหลายหุ้นจาก Alpaca ไม่ถูกต้อง")
                    for symbol, items in grouped.items():
                        if symbol not in bars_by_symbol or not isinstance(items, list):
                            continue
                        for item in items:
                            try:
                                timestamp = int(datetime.fromisoformat(item["t"].replace("Z", "+00:00")).timestamp())
                                bars_by_symbol[symbol][timestamp] = {
                                    "t": timestamp, "o": item["o"], "h": item["h"], "l": item["l"],
                                    "c": item["c"], "v": item.get("v", 0),
                                }
                            except (KeyError, TypeError, ValueError):
                                continue
                    page_count += 1
                    page_token = result.get("next_page_token")
                    if not page_token:
                        break
                output = {symbol: [items[timestamp] for timestamp in sorted(items)]
                          for symbol, items in bars_by_symbol.items()}
                return self.send_json(200, {
                    "timeframe": timeframe, "feed": "IEX fallback" if feed == "iex" else "subscription-default",
                    "bars": output, "updated_at": now.isoformat(timespec="seconds"),
                })
            except (RuntimeError, ValueError, KeyError, TypeError) as exc:
                return self.send_json(503, {"error": str(exc) or "โหลดแท่งราคารวมจาก Alpaca ไม่สำเร็จ"})
        if path == "/api/alpaca/bars":
            symbol = query.get("symbol", [""])[0].strip().upper()
            timeframe = query.get("timeframe", [""])[0]
            days = query.get("range", ["1d"])[0]
            asof = query.get("asof", [""])[0].strip()
            if not re.fullmatch(r"[A-Z][A-Z0-9.-]{0,14}", symbol):
                return self.send_json(400, {"error": "รูปแบบสัญลักษณ์หุ้นไม่ถูกต้อง"})
            if timeframe not in {"1Min", "5Min", "15Min", "30Min", "1Hour", "5Hour"} or days not in {"1d", "5d", "ta"}:
                return self.send_json(400, {"error": "กรอบเวลาไม่ถูกต้อง"})
            lookback = {"1Min": 2, "5Min": 8, "15Min": 12, "30Min": 18, "1Hour": 35, "5Hour": 35}[timeframe]
            if days == "5d":
                lookback = max(lookback, {"1Min": 8, "5Min": 12, "15Min": 16, "30Min": 18, "1Hour": 35, "5Hour": 35}[timeframe])
            elif days == "ta":
                # Keep enough history to warm the longest 200-period averages,
                # without downloading many thousands of redundant minute bars.
                lookback = {"1Min": 10, "5Min": 20, "15Min": 35, "30Min": 45, "1Hour": 100, "5Hour": 365}[timeframe]
            now = datetime.now(timezone.utc)
            outcome_days = {"1Min": 4, "5Min": 4, "15Min": 5, "30Min": 6, "1Hour": 10, "5Hour": 35}[timeframe]
            if asof and (days != "ta" or not re.fullmatch(r"\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?", asof)):
                return self.send_json(400, {"error": "วันหรือเวลาย้อนหลังไม่ถูกต้อง"})
            try:
                if asof:
                    try:
                        asof_local = datetime.strptime(asof, "%Y-%m-%dT%H:%M") if "T" in asof else datetime.strptime(asof, "%Y-%m-%d").replace(hour=23, minute=59)
                    except ValueError:
                        return self.send_json(400, {"error": "วันหรือเวลาย้อนหลังไม่ถูกต้อง"})
                    bangkok = timezone(timedelta(hours=7))
                    asof_end = asof_local.replace(tzinfo=bangkok).astimezone(timezone.utc)
                    if asof_end > now:
                        return self.send_json(400, {"error": "เลือกวันหรือเวลาในอนาคตไม่ได้"})
                    request_end = min(now, asof_end + timedelta(days=outcome_days))
                    start = asof_end - timedelta(days=lookback)
                else:
                    asof_end = now
                    request_end = now
                    start = now - timedelta(days=lookback)
                cursor = start
                bars_by_time = {}
                feed_used = "subscription-default"
                # Keep technical-analysis history and its evaluation window in one
                # Alpaca request; the widest setting stays below the 10,000-bar cap.
                chunk_days = lookback + outcome_days + 1 if days == "ta" else lookback + 1
                while cursor < request_end:
                    chunk_end = min(request_end, cursor + timedelta(days=chunk_days))
                    params = urlencode({
                        "timeframe": timeframe,
                        "start": cursor.isoformat(timespec="seconds").replace("+00:00", "Z"),
                        "end": chunk_end.isoformat(timespec="seconds").replace("+00:00", "Z"),
                        "limit": 10000,
                        "sort": "asc",
                        "adjustment": "split",
                    })
                    try:
                        result = alpaca_request(f"/stocks/{quote(symbol, safe='.-')}/bars?{params}", market_data=True)
                    except ValueError as exc:
                        if "subscription does not permit querying recent sip data" not in str(exc).lower():
                            raise
                        page_params = dict(parse_qs(params))
                        page_params["feed"] = ["iex"]
                        fallback_params = urlencode({key: values[0] for key, values in page_params.items()})
                        result = alpaca_request(
                            f"/stocks/{quote(symbol, safe='.-')}/bars?{fallback_params}", market_data=True)
                        feed_used = "IEX fallback (SIP unavailable)"
                    for item in response_bars(result):
                        timestamp = int(datetime.fromisoformat(item["t"].replace("Z", "+00:00")).timestamp())
                        bars_by_time[timestamp] = {"t": timestamp, "o": item["o"], "h": item["h"], "l": item["l"], "c": item["c"], "v": item.get("v", 0)}
                    cursor = chunk_end
                bars = [bars_by_time[timestamp] for timestamp in sorted(bars_by_time)]
                return self.send_json(200, {"symbol": symbol, "timeframe": timeframe, "feed": feed_used, "bars": bars,
                                            "asof": asof or None, "updated_at": now.isoformat(timespec="seconds")})
            except (RuntimeError, ValueError, KeyError, TypeError) as exc:
                return self.send_json(503, {"error": str(exc)})
        routes = {
            "/api/alpaca/config": None,
            "/api/alpaca/account": "/account",
            "/api/alpaca/positions": "/positions",
            "/api/alpaca/orders": "/orders?status=all&limit=50&direction=desc",
        }
        if path not in routes:
            return self.send_json(404, {"error": "ไม่พบ endpoint นี้"})
        if path == "/api/alpaca/config":
            return self.send_json(200, {"configured": bool(os.environ.get("ALPACA_API_KEY") and os.environ.get("ALPACA_SECRET_KEY")), "mode": "paper"})
        try:
            result = self.alpaca_request(routes[path])
            self.send_json(200, result)
        except (RuntimeError, ValueError) as exc:
            self.send_json(503, {"error": str(exc)})

    def handle_bot_start(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 8192:
                return self.send_json(400, {"error": "ข้อมูลตั้งค่าบอทไม่ถูกต้อง"})
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                return self.send_json(400, {"error": "ข้อมูลตั้งค่าบอทไม่ถูกต้อง"})
            self.send_json(200, start_auto_bot(payload))
        except (ValueError, TypeError, KeyError, json.JSONDecodeError, RuntimeError) as exc:
            self.send_json(400, {"error": str(exc) or "เริ่มบอทไม่ได้"})

    def handle_alpaca_order(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 8192:
                return self.send_json(400, {"error": "ข้อมูลคำสั่งไม่ถูกต้อง"})
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                return self.send_json(400, {"error": "ข้อมูลคำสั่งไม่ถูกต้อง"})
            symbol = str(payload.get("symbol", "")).strip().upper()
            side = str(payload.get("side", "")).lower()
            order_type = str(payload.get("type", "market")).lower()
            tif = str(payload.get("time_in_force", "day")).lower()
            if not re.fullmatch(r"[A-Z][A-Z0-9.-]{0,14}", symbol):
                return self.send_json(400, {"error": "สัญลักษณ์หุ้นสหรัฐฯ ไม่ถูกต้อง"})
            if side not in ("buy", "sell") or order_type not in ("market", "limit"):
                return self.send_json(400, {"error": "เลือกด้านคำสั่งหรือประเภทคำสั่งไม่ถูกต้อง"})
            if tif not in ("day", "gtc"):
                return self.send_json(400, {"error": "รองรับ time-in-force แบบ DAY หรือ GTC"})
            if order_type == "limit" and tif != "day":
                return self.send_json(400, {"error": "คำสั่ง Limit ใช้ได้เฉพาะ DAY ในหน้านี้"})
            asset = self.alpaca_request("/assets/" + quote(symbol, safe=".-"))
            if asset.get("class") != "us_equity" or not asset.get("tradable"):
                return self.send_json(400, {"error": "สัญลักษณ์นี้ไม่ใช่หุ้นสหรัฐฯ ที่ซื้อขายได้ในบัญชี Alpaca"})
            order = {"symbol": symbol, "side": side, "type": order_type, "time_in_force": tif}
            if "notional" in payload and payload["notional"] not in (None, ""):
                notional = float(payload["notional"])
                if side != "buy" or order_type != "market" or not math.isfinite(notional) or notional < 1 or notional > 1_000_000:
                    return self.send_json(400, {"error": "มูลค่า notional ต้องอยู่ระหว่าง $1–$1,000,000 และใช้ได้กับ Market เท่านั้น"})
                order["notional"] = f"{notional:.2f}"
            else:
                qty = float(payload.get("qty", 0))
                if not math.isfinite(qty) or qty <= 0 or qty > 1_000_000:
                    return self.send_json(400, {"error": "จำนวนหุ้นต้องมากกว่า 0 และไม่เกิน 1,000,000"})
                order["qty"] = f"{qty:.6f}".rstrip("0").rstrip(".")
            if order_type == "limit":
                limit_price = float(payload.get("limit_price", 0))
                if not math.isfinite(limit_price) or limit_price <= 0 or limit_price > 1_000_000:
                    return self.send_json(400, {"error": "ราคา Limit ไม่ถูกต้อง"})
                order["limit_price"] = f"{limit_price:.4f}".rstrip("0").rstrip(".")
            result = self.alpaca_request("/orders", method="POST", payload=order)
            self.send_json(201, result)
        except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
            self.send_json(400, {"error": str(exc) or "ข้อมูลคำสั่งไม่ถูกต้อง"})
        except RuntimeError as exc:
            self.send_json(503, {"error": str(exc)})

    def authorize_request(self):
        """Require an access password on internet-facing deployments."""
        password = os.environ.get("APP_ACCESS_PASSWORD", "")
        if not password:
            return True
        supplied = self.headers.get("Authorization", "")
        scheme = ""
        try:
            scheme, encoded = supplied.split(" ", 1)
            _, candidate = base64.b64decode(encoded, validate=True).decode("utf-8").split(":", 1)
        except (ValueError, UnicodeError):
            candidate = ""
        if scheme.lower() == "basic" and hmac.compare_digest(candidate, password):
            return True
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="Signal", charset="UTF-8"')
        self.send_header("Content-Length", "0")
        self.end_headers()
        return False

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    deployment_port = os.environ.get("PORT")
    host = "0.0.0.0" if deployment_port else "127.0.0.1"
    ports = [int(deployment_port)] if deployment_port else range(8000, 8011)
    for port in ports:
        try:
            server = ThreadingHTTPServer((host, port), Handler)
            break
        except OSError:
            continue
    else:
        raise SystemExit("ไม่พบพอร์ตว่างระหว่าง 8000–8010 ปิดเซิร์ฟเวอร์เก่าหรือลองใหม่")

    print(f"Signal is ready on port {server.server_port}")
    server.serve_forever()
