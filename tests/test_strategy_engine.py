import json
import math
import shutil
import subprocess
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from strategy_engine import (BOT_STRATEGIES, BOT_STRATEGY_CATALOG, REGIME_STRATEGIES,
                             STRATEGIES, STRATEGY_CATALOG, generate_signals,
                             indicator_series, intraday_bot_signal, recommend_intraday_bot_strategy,
                             risk_sized_quantity)


ROOT = Path(__file__).resolve().parents[1]


def make_rows(closes, start=datetime(2020, 1, 1, tzinfo=timezone.utc)):
    rows = []
    for i, close in enumerate(closes):
        stamp = start + timedelta(days=i)
        rows.append({"t": int(stamp.timestamp()), "o": close, "h": close + 1.2,
                     "l": close - 1.1, "c": close, "v": 1_000_000 + i})
    return rows


def spy_rows(closes):
    return make_rows(closes, datetime(2020, 1, 1, tzinfo=timezone.utc))


def make_intraday_rows(start=datetime(2025, 1, 6, 14, 30, tzinfo=timezone.utc), count=60):
    rows = []
    for i in range(count):
        close = 100 + i * .015 + .12 * math.sin(i / 2.5)
        stamp = start + timedelta(minutes=i)
        rows.append({"t": int(stamp.timestamp()), "o": close - .02, "h": close + .15,
                     "l": close - .15, "c": close, "v": 1200 + i * 3})
    return rows


class GenerateSignalsTests(unittest.TestCase):
    def test_auto_bot_recommendation_uses_registered_strategy_and_explains_choice(self):
        rows = make_intraday_rows()
        recommendation = recommend_intraday_bot_strategy(rows, spy_rows=rows, relative_volume=1.5)
        self.assertIn(recommendation["strategy"], BOT_STRATEGIES)
        self.assertTrue(recommendation["reason"])
        self.assertIsInstance(recommendation["setup_active"], bool)

    def test_bot_intraday_strategies_are_separate_and_evaluable(self):
        rows = make_intraday_rows()
        spy = make_intraday_rows(count=len(rows))
        self.assertEqual(len(BOT_STRATEGIES), 5)
        self.assertTrue(BOT_STRATEGIES.isdisjoint(STRATEGIES))
        for item in BOT_STRATEGY_CATALOG:
            with self.subTest(strategy=item["id"]):
                signal, reason = intraday_bot_signal(
                    item["id"], rows, rows[-1]["c"] + .03, rows[-1]["c"], spy_rows=spy,
                    relative_volume=1.5, elapsed_minutes=60)
                self.assertIn(signal, (None, "buy", "sell"))
                self.assertTrue(reason)

    def test_bot_opening_range_strategy_requires_volume_and_confirmed_breakout(self):
        start = datetime(2025, 1, 6, 14, 30, tzinfo=timezone.utc)

        def session(base):
            rows = []
            for i in range(60):
                close = base if i < 15 else base + (i - 14) * .05
                stamp = start + timedelta(minutes=i)
                rows.append({"t": int(stamp.timestamp()), "o": close, "h": close + .02,
                             "l": close - .02, "c": close, "v": 1000})
            return rows

        stock, spy = session(100), session(200)
        price = stock[-1]["c"] + .05
        signal, _ = intraday_bot_signal("botOrb15", stock, price, stock[-1]["c"], spy,
                                        relative_volume=1.5, elapsed_minutes=60)
        self.assertEqual(signal, "buy")
        blocked, reason = intraday_bot_signal("botOrb15", stock, price, stock[-1]["c"], spy,
                                              relative_volume=1.0, elapsed_minutes=60)
        self.assertIsNone(blocked)
        self.assertIn("Relative Volume", reason)

    def test_all_registered_strategies_return_valid_event_series(self):
        closes = [100 + i * 0.04 + 2 * math.sin(i / 7) for i in range(320)]
        rows = make_rows(closes)
        spy = spy_rows([200 + i * 0.12 + 3 * math.sin(i / 13) for i in range(320)])
        for strategy in STRATEGIES:
            with self.subTest(strategy=strategy):
                result = generate_signals(rows, strategy, spy_rows=spy)
                self.assertEqual(len(result["events"]), len(rows))
                self.assertEqual(len(result["atr"]), len(rows))
                self.assertTrue(all(event in (-1, 0, 1) for event in result["events"]))

    def test_risk_sizing_obeys_both_risk_budget_and_notional_cap(self):
        # $50 risk budget / $5 stop distance = 10 shares; $1,000 cap permits 20.
        self.assertEqual(risk_sized_quantity(1000, 10000, .5, 50, 45), 10)
        # Notional cap can be the tighter constraint.
        self.assertEqual(risk_sized_quantity(250, 10000, 5, 50, 45), 5)
        self.assertEqual(risk_sized_quantity(1000, 10000, .5, 50, 50), 0)

    def test_multiple_strategies_are_registered_for_each_horizon(self):
        self.assertEqual(len(STRATEGIES), 15)
        self.assertEqual(len([item for item in STRATEGY_CATALOG if item["group"].startswith("ระยะสั้น")]), 5)
        self.assertEqual(len([item for item in STRATEGY_CATALOG if item["group"].startswith("ระยะกลาง")]), 5)
        self.assertEqual(len([item for item in STRATEGY_CATALOG if item["group"].startswith("ระยะยาว")]), 5)
        self.assertTrue(all(item.get("entryRule") and item.get("exitRule") for item in STRATEGY_CATALOG))

    def test_unknown_strategy_is_rejected(self):
        with self.assertRaises(ValueError):
            generate_signals(make_rows([100.0] * 5), "not-a-strategy")

    def test_old_strategy_keys_are_rejected(self):
        for strategy in ("intraday5m", "orb5m", "botOrb15", "botEmaMomentum", "botVwapPullback",
                         "botVwapReclaim", "botVwapMeanReversion", "ema", "rsi", "donchian50Calendar",
                         "shortTerm", "mediumTerm", "longTerm"):
            with self.subTest(strategy=strategy), self.assertRaises(ValueError):
                generate_signals(make_rows([100.0] * 250), strategy)

    def test_long_term_entry_needs_stock_and_spy_above_trend_filters(self):
        closes = [100.0] * 205 + [100 + i * .8 for i in range(1, 31)]
        stock = make_rows(closes)
        spy_up = spy_rows([100 + i * .15 for i in range(len(closes))])
        spy_down = spy_rows([300 - i * .15 for i in range(len(closes))])
        allowed = generate_signals(stock, "longTrend", spy_rows=spy_up)
        blocked = generate_signals(stock, "longTrend", spy_rows=spy_down)
        self.assertIn(1, allowed["events"])
        self.assertNotIn(1, blocked["events"])
        self.assertTrue(blocked["no_target"])
        self.assertEqual(allowed["riskAtr"], 3.0)

    def test_breakout_strategy_stops_and_targets_match_the_horizon(self):
        closes = [100.0 + 0.2 * math.sin(i) for i in range(260)]
        rows = make_rows(closes)
        spy = spy_rows([100.0 + i * .1 for i in range(260)])
        expected = {"shortBreakout": (1.5, 2.0, False),
                    "mediumBreakout": (2.5, 0.0, True),
                    "longBreakout": (3.0, 0.0, True)}
        for strategy, values in expected.items():
            with self.subTest(strategy=strategy):
                result = generate_signals(rows, strategy, spy_rows=spy)
                self.assertEqual((result["riskAtr"], result["rewardRisk"], result["no_target"]), values)


class IndicatorParityTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "Node.js is required to compare browser indicators")
    def test_browser_and_python_indicator_series_match_on_same_ohlc(self):
        closes = [80 + i * .11 + 4 * math.sin(i / 8) + 1.3 * math.cos(i / 17) for i in range(320)]
        rows = make_rows(closes)
        js = subprocess.run(
            ["node", str(ROOT / "tests" / "js_indicator_runner.cjs")],
            input=json.dumps({"rows": rows}), text=True, capture_output=True,
            cwd=ROOT, check=True,
        )
        actual = json.loads(js.stdout)
        expected = indicator_series(rows)

        def assert_series(js_values, py_values):
            self.assertEqual(len(js_values), len(py_values))
            for index, (js_value, py_value) in enumerate(zip(js_values, py_values)):
                with self.subTest(index=index):
                    if js_value is None or py_value is None:
                        self.assertIsNone(js_value)
                        self.assertIsNone(py_value)
                    else:
                        self.assertAlmostEqual(js_value, py_value, places=10)

        for period in expected["ema"]:
            assert_series(actual["ema"][period], expected["ema"][period])
        for period in expected["sma"]:
            assert_series(actual["sma"][period], expected["sma"][period])
        assert_series(actual["rsi14"], expected["rsi14"])
        assert_series(actual["atr14"], expected["atr14"])
        for name in ("line", "signal", "histogram"):
            assert_series(actual["macd"][name], expected["macd"][name])


if __name__ == "__main__":
    unittest.main()
