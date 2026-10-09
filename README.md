# Signal · วิเคราะห์ทางเทคนิค

เว็บแอพสำหรับวิเคราะห์หุ้นสหรัฐฯ ดูกราฟ แนวโน้ม อินดิเคเตอร์ แนวรับ/แนวต้าน กลยุทธ์ย้อนหลัง และเชื่อม Alpaca Paper หรือ Alpaca Live Trading ตามโหมดที่ตั้งบนเซิร์ฟเวอร์

## เปิดแอพ

ต้องมี Python 3.9 ขึ้นไปและการเชื่อมต่ออินเทอร์เน็ตเพื่อดึงข้อมูลราคา

1. เปิด PowerShell ในโฟลเดอร์นี้
2. เรียก `python server.py`
3. เปิด URL ที่แสดงใน Terminal เช่น `http://127.0.0.1:8000` ในเบราว์เซอร์ หากพอร์ต 8000 ถูกใช้อยู่ เซิร์ฟเวอร์จะเลือกพอร์ตถัดไปให้อัตโนมัติ

ค้นหาสัญลักษณ์หุ้นสหรัฐฯ เช่น `AAPL`, `MSFT`, `NVDA` หรือ `SPY` แล้วกด Enter/ปุ่มวิเคราะห์ สามารถเพิ่มหรือลบสัญลักษณ์ในรายการติดตามได้ รายการจะบันทึกไว้ในเบราว์เซอร์และคงอยู่หลังปิด/เปิดแอพ เลือกกราฟรายวัน รายสัปดาห์ หรือรายเดือนได้

## เปิดใช้จากที่ไหนก็ได้

โปรเจกต์มีไฟล์ `render.yaml` สำหรับเผยแพร่เป็นเว็บบน Render:

1. Push โปรเจกต์ขึ้น GitHub โดยตรวจให้แน่ใจว่า `.env` และ `.signal-bot-state.json` ไม่ได้ถูก commit
2. ใน Render เลือก **New + → Blueprint** แล้วเชื่อม repository นี้
3. รอจน Render เผยแพร่เสร็จ จากนั้นเปิด URL `https://...onrender.com` ที่ Render แสดง
4. ครั้งแรก เบราว์เซอร์จะแสดงหน้าต่างรหัสผ่าน ให้ดูค่า `APP_ACCESS_PASSWORD` ใน Environment ของ Web Service บน Render

เซิร์ฟเวอร์จะฟังพอร์ตที่ Render กำหนด และขอรหัสผ่านก่อนแสดงหน้าเว็บหรือเรียก API เพื่อกันบุคคลอื่นใช้บริการ/บัญชี Paper ที่ตั้งค่าไว้ แนะนำให้เปิด **2FA** ในบัญชี Render และเก็บค่า `APP_ACCESS_PASSWORD` เป็นความลับ หากต้องการใช้ Alpaca Paper บนเว็บ ให้เพิ่ม `ALPACA_API_KEY` และ `ALPACA_SECRET_KEY` เป็น Environment Variables ใน Render แทนการอัปโหลด `.env`; ใช้ Paper keys เท่านั้น

แผน Free อาจพักบริการเมื่อไม่มีคนใช้ ทำให้ครั้งแรกที่เปิดหลังพักใช้เวลารอเริ่มระบบ และบอทจะทำงานต่อเนื่องไม่ได้ขณะบริการพัก/รีสตาร์ต ข้อมูล Watchlist และการตั้งค่าที่เก็บในเบราว์เซอร์จะไม่ซิงก์ข้ามอุปกรณ์ ส่วนสถานะบอทบนดิสก์อาจหายเมื่อ Render แทนที่ instance

## Alpaca Paper Trading




หน้า **Alpaca Trading** ใช้ดูยอดบัญชี สถานะหุ้น คำสั่งล่าสุด ส่งคำสั่ง Market/Limit และเปิดบอทซื้อขาย เซิร์ฟเวอร์อ่านคีย์จากไฟล์ `.env` ในโฟลเดอร์โปรเจกต์ และ `.gitignore` กันไฟล์ความลับออกจาก Git แล้ว ห้ามใส่คีย์ใน `app.js` หรือ HTML โหมดเริ่มต้นคือ Paper

1. สร้างบัญชี Paper ใน Alpaca แล้วคัดลอก Paper API Key และ Secret จากหน้า Dashboard
2. เปิดไฟล์ `.env` ด้วยโปรแกรมแก้ไขข้อความ แล้วใส่คีย์ Paper:

   ```dotenv
   ALPACA_API_BASE_URL=https://paper-api.alpaca.markets/v2
   ALPACA_API_KEY=ใส่_Paper_API_Key
   ALPACA_SECRET_KEY=ใส่_Paper_Secret
   TELEGRAM_BOT_TOKEN=
   TELEGRAM_CHAT_ID=
   DISCORD_WEBHOOK_URL=
   ```

ค่า Telegram/Discord เป็นตัวเลือก: ใส่ Telegram bot token คู่กับ chat ID หรือใส่ Discord webhook URL เพื่อรับแจ้งเตือนเมื่อบอทส่งคำสั่งซื้อ/ขาย, ปิดสถานะฉุกเฉิน, IEX WebSocket ขาดการเชื่อมต่อเกิน 150 วินาทีระหว่างตลาดเปิด หรือ heartbeat ของบอทขาดช่วง (150 วินาทีสำหรับ Intraday, 10 นาทีสำหรับ Daily) ระบบส่ง Daily PnL Summary หลังเวลาปิดตลาดสหรัฐฯ โดยรายงาน Equity เปลี่ยนแปลงเทียบ `last_equity`, realized P/L จากราคา fill ที่จับคู่ FIFO ก่อนค่าธรรมเนียม, จำนวนคำสั่งซื้อที่จับคู่แล้ว และสถานะพอร์ต ระบบบันทึกเหตุการณ์และคำสั่งลง `.signal-bot-journal.sqlite3` ในเครื่องเดียวกัน โดยอัปเดตสถานะ/ราคา fill เมื่อดึงประวัติคำสั่งจาก Alpaca; Slippage เทียบกับราคาอ้างอิงตอนส่งคำสั่ง ไม่ใช่ค่าประมาณผล backtest ฐานข้อมูลนี้เป็นไฟล์ในเครื่องและไม่ซิงก์ข้าม instance เช่น Render

   มีไฟล์ `.env.example` เป็นแม่แบบ หากเปลี่ยนคีย์ใน `.env` ระหว่างที่เซิร์ฟเวอร์เปิดอยู่ ให้ปิดแล้วเริ่ม `python server.py` ใหม่

3. เปิดเว็บ เลือก **Alpaca Trading** แล้วกดรีเฟรชบัญชี

#### เตรียมบัญชี Live (เงินจริง)

Live ถูกปิดเป็นค่าเริ่มต้น หากต้องการเปิดใช้งาน ต้องตั้ง `ALPACA_TRADING_MODE=live`, `ALPACA_LIVE_TRADING_ENABLED=true`, รหัสผ่านเว็บที่คาดเดายากใน `APP_ACCESS_PASSWORD` และ credentials แยกของบัญชี Live (`ALPACA_LIVE_API_KEY`, `ALPACA_LIVE_SECRET_KEY`) จากหน้า Environment Variables ของโฮสต์ แล้วรีสตาร์ตเซิร์ฟเวอร์ ห้ามใช้ Paper keys กับ Live endpoint และอย่า commit credentials

บนโฮสต์ที่กำหนด `PORT` (เช่น Render) Live จะเริ่มไม่ได้หากไม่มี `ALPACA_LIVE_DATA_DIR` ที่เป็น absolute path ของ persistent disk ซึ่ง mount แล้วและเขียนได้ อย่าใช้แผนที่หยุด/พัก service ระหว่างตลาดเปิด เพราะบอทต้องออนไลน์เพื่อจัดการ exit signals

โหมด Live จำกัดคำสั่งซื้อไม่เกิน `$ALPACA_LIVE_MAX_ORDER_USD` (ค่าเริ่มต้น $500, ปรับได้สูงสุด $10,000), บอทจำกัด risk ต่อรายการ 0.5%, daily loss 1% และ 3 รายการต่อวัน; การขายด้วยมือจำกัดไม่ให้เปิด Short และทุกคำสั่งซื้อ/เริ่มบอทต้องยืนยันข้อความ `I UNDERSTAND LIVE TRADING` สถานะและ journal ของ Live แยกจาก Paper

ขั้นตอนนี้ทำให้โค้ดรองรับการเชื่อม Live แต่ไม่ได้ทดสอบด้วย Live credentials หรือส่งคำสั่งเงินจริง ต้องทดสอบจนจบใน Paper และตรวจบัญชี/การสมัครข้อมูล/สิทธิ์ซื้อขายกับ Alpaca ก่อนเปิด Live คำสั่ง Market อาจจับคู่ต่างจากราคาประเมิน และ Stop เป็นเพียงระดับกระตุ้น ไม่ใช่ราคาขายที่รับประกัน

The Plan and Backtest share 15 daily strategies, five per holding horizon. Short term: EMA pullback, 20-day breakout, MACD momentum, Bollinger/RSI reversal, and 5-day momentum. Medium term: EMA pullback, 50-day breakout, MACD trend, relative strength versus SPY, and SMA 50/200 reclaim. Long term: EMA 50/200 trend, 100-day breakout, MACD primary trend, relative strength versus SPY, and rising 200-day reclaim. The Paper Bot also retains these daily strategies and adds five separate Intraday strategies that use the IEX trade stream and completed one-minute bars: 15-minute Opening Range Breakout, EMA Momentum, VWAP Pullback, VWAP Reclaim, and VWAP Mean Reversion. Intraday entries use their own stop/target settings and close before market close.

รัน unit tests และตรวจความตรงกันของตัวชี้วัด JavaScript/Python ด้วยข้อมูลเดียวกันด้วย `python -m unittest discover -s tests -v` (ต้องมี Node.js สำหรับ parity test)

เซิร์ฟเวอร์เลือก endpoint จาก `ALPACA_TRADING_MODE`: Paper ใช้ `https://paper-api.alpaca.markets/v2`, Live ใช้ `https://api.alpaca.markets/v2` พร้อม credentials คนละชุด และ Live ต้องเปิด kill switch เพิ่มอีกชั้น

API คำสั่งซื้อและควบคุมบอทรับเฉพาะ `Host` ในเครื่องนี้ ปฏิเสธ `Origin` ที่ไม่ตรงกับหน้าเว็บ และบล็อกคำขอที่ระบุว่าเป็น cross-site

### บอทซื้อขายอัตโนมัติ

ในหน้า **Alpaca Trading** เลือกหุ้น 1–10 ตัว แล้วเลือกกลยุทธ์แยกในแต่ละหุ้น (ค่าเริ่มต้นคือ **อัตโนมัติ · ให้ระบบเลือก**) พร้อมกำหนดวงเงินและความเสี่ยงก่อนเริ่มบอท ระบบอัตโนมัติใช้แท่ง IEX 1 นาทีล่าสุด, VWAP/EMA/RSI, Relative Volume และ SPY เพื่อเลือกหนึ่งในห้ากลยุทธ์ Intraday พร้อมแสดงเหตุผลไว้ใต้หุ้นและในบันทึกเหตุการณ์ การเลือกนี้เป็นการจับคู่สภาพข้อมูลล่าสุดกับกฎของกลยุทธ์ ไม่ใช่การจัดอันดับกำไรหรือการรับประกันผล กลยุทธ์ที่เลือกจะคงที่ตลอดรอบบอท; สถานะที่เปิดอยู่จะคงกลยุทธ์เดิมเพื่อจัดการทางออก

หุ้นทั้งหมดในหนึ่งรอบต้องใช้กรอบเวลาเดียวกัน (รายวันหรือ Intraday Live) เพราะรอบบอทหนึ่งใช้ตัวประมวลผลกรอบเวลาเดียว กด **หยุดบอท** เพื่อหยุดการตรวจสัญญาณและส่งคำสั่งใหม่ บอททำงานอยู่ในโปรเซส `server.py`; ต้องเปิดเซิร์ฟเวอร์ค้างไว้ บอทจะหยุดเมื่อปิดหรือเริ่มเซิร์ฟเวอร์ใหม่

In Strategy Lab, **Compare all 15 strategies** evaluates the daily strategies on the same price window, ranks by median walk-forward return in the training period, and reports a separate untouched out-of-sample period, closed trade count, and drawdown. Intraday bot strategies use a different one-minute signal path and are not included in this daily comparison. A winner is shown only when the minimum trade/sample requirements are met. Position sizing and daily risk caps remain bot controls.

Daily Paper strategies use a GTC limit entry and ATR protective orders; the five Intraday strategies use the live IEX trade stream for signal timing, submit market entries, attach an OCO stop/target based on that strategy's ATR/R settings, and close before the regular session ends. Live fills can differ from one-minute bar-close estimates. A stop is a trigger price, not a guaranteed fill.
Protective stop orders remain at Alpaca if the server stops; stopping the bot cancels pending entries but does not liquidate held shares. Trend-based exits require the server to keep running. Bot state is restored after restart, but the bot does not restart automatically.
ราคา Stop เป็นระดับกระตุ้น ไม่ใช่ราคาที่รับประกันการขาย โดยเฉพาะเมื่อราคาเปิดกระโดดข้ามระดับหรือหุ้นหยุดซื้อขาย · ใช้ Paper ทดสอบก่อนเปิด Live เสมอ

กด **นำเข้า CSV** เพื่อวิเคราะห์ข้อมูลจากไฟล์ของคุณ รองรับคอลัมน์ `Date`, `Open`, `High`, `Low`, `Close`, `Adj Close`, `Volume` รวมถึงชื่อภาษาไทย เช่น `วันที่`, `ราคาเปิด`, `ราคาสูงสุด`, `ราคาต่ำสุด`, `ราคาปิด`, `ปริมาณซื้อขาย` ต้องมีวันที่และราคาปิด และมีข้อมูลที่อ่านได้อย่างน้อย 60 วัน; แนะนำ 200 วันขึ้นไปเพื่อให้คำนวณ EMA 200 ได้ครบ หากมีเฉพาะวันที่กับราคาปิด ระบบจะสร้างแท่งราคาโดยประมาณให้

## วิธีคำนวณ

- ราคาหุ้นและกราฟ: Yahoo Finance Chart API; โหลดข้อมูลย้อนหลัง 10 ปีสำหรับการวิเคราะห์ และขอประวัติเต็มที่ Yahoo มีเมื่อเลือกช่วง MAX บนกราฟ ใช้ OHLC ที่ปรับ split แต่ไม่ปรับเงินปันผลให้ตรงกับราคาซื้อขาย และเก็บ Adj Close แยกเป็นชุด total return ที่ไม่ใช้คำนวณกราฟ/สัญญาณ/Backtest ราคาล่าสุดอาจล่าช้าตามตลาดและผู้ให้บริการ
- แนวโน้ม: เปรียบเทียบราคากับ EMA 20/50 และทิศทางราคาในช่วง 10 แท่งล่าสุด สำหรับรายสัปดาห์รวมข้อมูลแท่งรายวันเป็นรายสัปดาห์
- แนวรับ: Low ของแท่งล่าสุด, EMA ที่อยู่ใกล้ราคา และระดับจิตวิทยาด้านล่าง; แนวต้าน: swing high ล่าสุดและระดับจิตวิทยา 3 ขั้นเหนือราคาปัจจุบัน
- วาดแนวรับ (เส้นประสีเขียว S1–S3) และแนวต้าน (เส้นประสีแดง R1–R4) ทับบนกราฟ พร้อมเส้นแนวโน้มที่เชื่อมจุดกลับตัวของ Low/High อย่างน้อย 3 จุด; ชี้ที่เส้นหรือจุดเพื่อดูราคา
- ซูมด้วยล้อเมาส์หรือปุ่ม +/−, ลากกราฟเพื่อเลื่อนดูข้อมูลย้อนหลัง, กด ↺ เพื่อคืนมุมมอง; ชี้ตำแหน่งบนกราฟเพื่อดูราคาตาม crosshair, OHLC และ EMA
- RSI (14), MACD (12, 26, 9) และ EMA (20, 50, 200) คำนวณจากราคาปิดย้อนหลัง
- สรุปสัญญาณรายวัน/รายสัปดาห์/รายเดือน และกรอบระหว่างวัน 1/5/15/30 นาที, 1/5 ชั่วโมง โดยแท่งระหว่างวันโหลดจาก Alpaca IEX ในคำขอเดียวต่อกรอบเวลา แล้วนำมาคำนวณ RSI(14), STOCH(9,6), STOCHRSI(14), MACD(12,26), ADX(14), Williams %R, CCI(14), ATR(14), Highs/Lows(14), Ultimate Oscillator, ROC, Bull/Bear Power(13), SMA/EMA 5, 10, 20, 50, 100, 200 และ Classic Pivot
- ส่วนวิเคราะห์ทางเทคนิคเลือกวันและเวลาไทยย้อนหลังได้ โดยตัดแท่งที่ยังไม่ปิดและข้อมูลหลังเวลาที่เลือกออกก่อนคำนวณสัญญาณ แล้วเทียบผลตอบแทนจริงหลัง 1, 5 และ 20 แท่งถัดไป; เป็นการตรวจหนึ่งจุดเวลาที่เลือก ไม่ใช่อัตราความแม่นยำรวม
- รูปแบบราคาตามฤดูกาลเปรียบเทียบผลตอบแทนเดือนปฏิทินเดียวกันจากข้อมูลไม่เกิน 5 ปีล่าสุด (สูงสุด 5 ตัวอย่างต่อเดือน) แสดงค่าเฉลี่ย สัดส่วนปีที่ปิดบวก และจำนวนปี; เดือนปัจจุบันถูกเน้นแต่ไม่นำมาคำนวณจนกว่าจะปิดเดือน โดยระบุ “มักขึ้น/มักลง” เมื่อมีอย่างน้อย 3 ปีและผลตอบแทนเป็นทิศเดียวกันอย่างน้อย 60% ของตัวอย่าง
- ตารางรูปแบบวันในสัปดาห์จัดผลตอบแทนรายวันตามเดือนปฏิทินและวันจันทร์–ศุกร์ ใช้ราคาปิดเทียบราคาปิดวันซื้อขายก่อนหน้า รวมข้อมูลเดือนเดียวกันจากทุกปี แสดงผลตอบแทนเฉลี่ย อัตราปิดบวก และจำนวนตัวอย่าง; จัดว่า “มักขึ้น/ลง” เมื่อมีอย่างน้อย 8 ตัวอย่าง และผลเป็นทิศเดียวกันอย่างน้อย 60%; เสาร์–อาทิตย์แสดงว่าตลาดปิด
- จังหวะลงทุนและขายตามปฏิทินจัดวันซื้อขายย้อนหลังเป็นต้นเดือน (1–10), กลางเดือน (11–20) และท้ายเดือน (21–สิ้นเดือน) คำนวณผลตอบแทนของแต่ละช่วงแยกตามเดือนปฏิทิน พร้อมหาช่วงที่อ่อน/แข็งเด่นเมื่อมีอย่างน้อย 3 ปีและผลไปทิศเดียวกันอย่างน้อย 60%; ตารางวันที่แสดงวันที่ของเดือนที่ผลตอบแทนรายวันอ่อน/แข็งเด่น โดยต้องมีอย่างน้อย 5 ตัวอย่าง; ไม่รวมเดือนปัจจุบันที่ยังไม่ปิด
- ราคาการเปลี่ยนแปลง “วันนี้” เปรียบเทียบราคาล่าสุดกับราคาปิดวันก่อนหน้าจาก OHLC ดิบชุดเดียวกัน เพื่อไม่ผสมราคาที่ปรับเงินปันผลย้อนหลังกับราคาตลาดปัจจุบัน
- หน้า **ภาพรวมพอร์ต** รวมรายการซื้อหลายไม้ต่อหุ้นเป็นจำนวนหุ้น ราคาเฉลี่ย มูลค่าตลาด และกำไร/ขาดทุน แยกยอดตามสกุลเงินและอ่านราคาล่าสุดจากข้อมูลที่โหลดได้
- Backtest and Paper Bot share the same strategy catalog, signal engine, daily timeframe, and Alpaca IEX bars. Backtest models limit entries and one all-capital position; it does not apply the bot?s per-symbol caps or daily guard, and excludes dividends.
- แบ่งข้อมูลตามเวลา โดยค่าเริ่มต้นกัน 30% ล่าสุดไว้เป็นช่วงทดสอบนอกตัวอย่าง (เลือก 20%, 40% หรือใช้ข้อมูลทั้งหมดได้); ช่วงก่อนหน้าช่วย warm-up อินดิเคเตอร์และแสดงผลช่วงฝึก แต่ไม่ได้ใช้ปรับพารามิเตอร์อัตโนมัติ
Paper only: fixed-target strategies use GTC bracket orders; trailing/trend strategies use a GTC entry with a protective ATR stop and exit on the shared strategy signal. Entries use a limit about 1% above the signal close and expire after 7 days. A stop is a trigger price, not a guaranteed fill.
- แสดงผลตอบแทน, CAGR, win rate, maximum drawdown, profit factor, expectancy ต่อรอบ, เวลาอยู่ในตลาด และเทียบซื้อแล้วถือ โดยรวมค่าธรรมเนียมและ slippage ที่ตั้งไว้ ผลทดสอบไม่รวมเงินปันผล ภาษี สภาพคล่อง และไม่ทำนายผลในอนาคต
- ตารางความน่าเชื่อถือของสัญญาณคำนวณจากหลายจุดเวลาย้อนหลังแยกรายวัน/สัปดาห์/เดือน วัดผลหลัง 1, 5 และ 20 แท่ง นับเฉพาะสัญญาณที่เอนเอียงชัดและมีผลลัพธ์ครบ พร้อมจำนวนตัวอย่างและผลตอบแทนเฉลี่ย; จุดเวลาทับซ้อนกันได้และไม่ใช่การรับประกันผล
- หน้าแผนลงทุนบันทึก Buy Zone, Stop, Target และการเปลี่ยนสัญญาณของ Watchlist ไว้ในเบราว์เซอร์ สแกน Watchlist ทุก 15 นาทีขณะเปิดแอพ และตรวจ Stop/Target จากแท่งราคาที่ได้รับ; ถ้าแท่งเดียวแตะทั้งสองระดับจะแสดงว่าลำดับไม่ชัด การแจ้งเตือนบนเดสก์ท็อปทำงานเมื่อเปิดแอพและอนุญาตสิทธิ์แล้ว ไม่ใช่บริการแจ้งเตือนเบื้องหลัง
- Backtest uses daily bars to match the Paper Bot; users can select a date range and see warm-up, training, and out-of-sample bar counts.
- The strategy projection shows holding/waiting status and relevant EMA levels for the short, medium, and long strategies, with a heuristic 1-60 day price range. It is not a probability estimate or guaranteed execution price.
- ตารางจุดกลับตัวสูตร Classic แสดง S3, S2, S1, จุดกลับตัว, R1, R2, R3 โดยใช้ High/Low/Close ของแท่งก่อนหน้าในกรอบเวลารายวัน รายสัปดาห์ หรือรายเดือนที่เลือก
- เลือกความละเอียดแท่งวัน/สัปดาห์/เดือน และช่วงย้อนหลัง 1 เดือน, 3 เดือน, 6 เดือน, 1 ปี, 2 ปี, 5 ปี หรือ MAX ได้แยกกัน
- กราฟระหว่างวันเลือกแท่ง 1, 5, 15 นาที หรือ 1 ชั่วโมง และดูช่วงวันนี้/5 วันได้; ดึงแท่งจาก Alpaca Market Data (IEX) และรีเฟรชทุก 15 วินาทีระหว่างเปิดกราฟ ต้องใส่ ALPACA_API_KEY และ ALPACA_SECRET_KEY ใน `.env` แล้วเริ่ม `python server.py` ใหม่ ข้อมูล IEX ครอบคลุมตลาดเดียวและอาจต่างจากราคาตลาดรวมทุกตลาด ส่วน CSV มีเฉพาะกรอบเวลาตามข้อมูลในไฟล์
- กำหนดระยะประมาณการได้ 1–60 วันทำการ โดยผสมโมเมนตัมผลตอบแทน 5/20 วัน, EMA 20/50, MACD, RSI และระยะถึงแนวรับ/แนวต้าน Swing high ใกล้ ๆ จะกดทิศทางคาดการณ์ลง ส่วนแนวรับใกล้และภาวะ oversold จะเพิ่มแรงหนุนขึ้น ช่วงราคาอิงความผันผวนรายวัน 20 วันคูณรากที่สองของจำนวนวัน เป็น heuristic เพื่อประกอบการศึกษา ไม่ได้ยืนยันความน่าจะเป็นหรือรับประกันราคา
- หน้าแผนลงทุนเลือกสแกนหุ้นใน Watchlist หรือสแกนหุ้น S&P 500 ทั้งจักรวาล โดยแสดงความคืบหน้า ค้นหาผลตามชื่อ/Ticker และทยอยแสดงการ์ดครั้งละ 50 หุ้น; รายชื่อปัจจุบันมี 503 ticker เพราะบางบริษัทมีหุ้นหลาย class จาก [datasets/s-and-p-500-companies](https://github.com/datasets/s-and-p-500-companies) ซึ่งอ้างอิง Wikipedia และบันทึกวันที่ปรับปรุงไว้ใน `sp500.json`
- เมนู **หุ้นสหรัฐฯ ทั้งตลาด** แยกจาก S&P 500 ใช้รายชื่อ Nasdaq และตลาดจดทะเบียนอื่นจาก [Nasdaq Trader Symbol Directory](https://www.nasdaqtrader.com/Trader.aspx?id=symboldirdefs) ตัด ETF, หุ้นทดสอบ, warrant, right, unit และตราสารหนี้ออก แล้วสแกนหุ้นทุกตัวที่เหลือด้วย Yahoo Finance; รายชื่อแคช 12 ชั่วโมง และหุ้นที่ไม่มีข้อมูลราคาจะถูกรายงาน/ข้ามตามผลที่ดึงได้
- หน้าแผนลงทุนแสดงสถานะตามสัญญาณ โซนซื้อ จุดหยุดขาดทุน เป้าขาย และช่วงวันถือเร็ว/ค่ากลาง/ช้าแบบสถานการณ์จำลอง กรอกงบต่อสกุลเงินเพื่อคำนวณจำนวนหุ้นจาก % ความเสี่ยงและเพดานงบต่อหุ้น
- หน้าแผนลงทุนกรองหุ้นทั้งหมด/เฉพาะในโซนซื้อ/เฉพาะสัญญาณน่าสนใจ และเรียงตามคะแนน, R:R, อยู่ในโซนซื้อ หรือสัญญาณแนะนำ
- เมื่อสแกน Watchlist แอพเทียบ EMA, RSI, MACD และโซนซื้อกับ snapshot ครั้งก่อน แล้วไฮไลต์การเปลี่ยนสถานะใหม่; การสแกนครั้งแรกจะเก็บ baseline และไม่ตีความสถานะเดิมว่าเพิ่งเกิด
- มุมซูม/เลื่อน ช่วงข้อมูล และความละเอียดกราฟบันทึกแยกตามหุ้นไว้ใน localStorage เพื่อคงมุมมองเมื่อสลับสัญลักษณ์หรือกลับมาเปิดใหม่
- ในการ์ดหุ้นแต่ละตัว บันทึกการซื้อได้หลายไม้ด้วยยอดเงินและราคาต่อหุ้น แอพคำนวณจำนวนหุ้นรวมและราคาเฉลี่ยถ่วงน้ำหนัก พร้อมแสดงมูลค่าปัจจุบัน กำไร/ขาดทุน เป้าขายจากแนวต้าน และ Stop จากแนวรับ ข้อมูลบันทึกในเบราว์เซอร์เดียวกัน แสดงสกุลเงินตามหุ้น และไม่รวมค่าธรรมเนียมหรือภาษี
- การ์ดแผนกลยุทธ์ในหน้าวิเคราะห์เลือกได้ระหว่างซื้อแนวรับ/ขายแนวต้าน, ซื้อเมื่อ Breakout พร้อมเป้า 2R, รอซื้อย่อใกล้ EMA 20, แผนความเสี่ยงคงที่ 1:2 หรือ Donchian Breakout 20/50 วัน; Donchian ใช้ High N วันเป็นจุดเข้า, Low N วันเป็น trailing exit และ Stop Loss แยก 2 ATR; เปลี่ยนแผนแล้วคำนวณ Buy zone, Stop loss, เป้าขาย และ R:R ใหม่ทันที และจดจำตัวเลือกไว้ในเบราว์เซอร์
- Buy zone, stop loss และ take profit เป็นตัวอย่างจากระดับราคาและอัตราส่วนความเสี่ยงต่อผลตอบแทน ไม่ใช่คำแนะนำหรือการรับประกันผลลัพธ์
