import json
import os
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import pandas as pd
import yfinance as yf
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(exist_ok=True)
LATEST_FILE = DATA_DIR / "latest.json"
HISTORY_FILE = DATA_DIR / "signal_history.json"
KST = ZoneInfo("Asia/Seoul")
ET = ZoneInfo("America/New_York")
TICKERS = [
    "AAPL", "MSFT", "NVDA", "AMZN", "META",
    "AVGO", "GOOGL", "GOOG", "COST", "NFLX",
    "TSLA", "AMD", "ADBE", "PEP", "CSCO",
    "QCOM", "INTC", "AMAT", "TXN", "INTU",
    "AMGN", "HON", "BKNG", "SBUX", "ADP",
    "GILD", "VRTX", "ADI", "REGN", "PANW"
]
MACRO_SYMBOLS = {
    "나스닥-100": "^NDX",
    "S&P 500": "^GSPC",
    "VIX": "^VIX",
    "비트코인": "BTC-USD"
}
def download(symbol, period="1y"):
    try:
        df = yf.download(
            symbol,
            period=period,
            interval="1d",
            auto_adjust=True,
            progress=False,
            threads=False
        )
        if df is None or df.empty:
            return None
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        needed = ["Open", "High", "Low", "Close", "Volume"]
        if not all(c in df.columns for c in needed):
            return None
        df = df[needed].dropna(subset=["Close"])
        df.index = pd.to_datetime(df.index)
        return df if not df.empty else None
    except Exception as exc:
        print(f"다운로드 실패 {symbol}: {str(exc)[:120]}")
        return None
def serialise_prices(df):
    result = []
    for date, row in df.iterrows():
        result.append({
            "date": date.date().isoformat(),
            "open": round(float(row["Open"]), 4),
            "high": round(float(row["High"]), 4),
            "low": round(float(row["Low"]), 4),
            "close": round(float(row["Close"]), 4),
            "volume": int(row["Volume"])
        })
    return result
def calculate_signal(df):
    if df is None or len(df) < 60:
        return None
    close = df["Close"].astype(float)
    avg20 = close.rolling(20).mean()
    std20 = close.rolling(20).std(ddof=0)
    upper = avg20 + 2 * std20
    lower = avg20 - 2 * std20
    percent_b = (close - lower) / (upper - lower).replace(0, float("nan"))
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss = (-delta.clip(upper=0)).rolling(14).mean()
    rs = gain / loss.replace(0, float("nan"))
    rsi = 100 - (100 / (1 + rs))
    drawdown = close / close.rolling(60).max() - 1
    i = len(df) - 1
    values = [rsi.iloc[i], percent_b.iloc[i], drawdown.iloc[i]]
    if any(pd.isna(v) for v in values):
        return None
    r = float(rsi.iloc[i])
    b = float(percent_b.iloc[i])
    dd = float(drawdown.iloc[i])
    signal = None
    if dd <= -0.23 and r <= 28 and b <= -0.05:
        signal = "패닉셀"
    elif dd <= -0.17 and r <= 33 and b <= 0.15:
        signal = "급락"
    elif r <= 35 and b <= 0.20:
        signal = "조정"
    elif r <= 42 and b <= 0.25:
        signal = "단기조정"
    if signal is None:
        return None
    return {
        "signal": signal,
        "date": df.index[-1].date().isoformat(),
        "close": round(float(close.iloc[i]), 2),
        "rsi14": round(r, 2),
        "drawdown": round(dd * 100, 2),
        "drawdown60_pct": round(dd * 100, 2),
        "percent_b": round(b, 3),
        "ma20": round(float(close.rolling(20).mean().iloc[i]), 2),
        "ma50": round(float(close.rolling(50).mean().iloc[i]), 2),
        "ma200": (
            round(float(close.rolling(200).mean().iloc[i]), 2)
            if len(close) >= 200 else None
        ),
        "volume": int(df["Volume"].iloc[i]),
        "avg_volume20": round(float(df["Volume"].rolling(20).mean().iloc[i]), 0)
    }
def get_macro():
    values = {}
    for name, symbol in MACRO_SYMBOLS.items():
        try:
            df = download(symbol, "5d")
            if df is None:
                continue
            values[name] = {
                "value": round(float(df["Close"].iloc[-1]), 4),
                "updated_at": df.index[-1].date().isoformat(),
                "source": "Yahoo Finance",
                "symbol": symbol
            }
        except Exception as exc:
            print(f"시장 지표 실패 {name}: {str(exc)[:100]}")
    if len(values) == 4:
        state = "시장 지표 수집 완료"
        reason = "나스닥-100, S&P 500, VIX, 비트코인 데이터를 수집했습니다. 매수·매도 등급은 아닙니다."
    elif values:
        state = "시장 지표 일부 수집"
        reason = f"4개 중 {len(values)}개 지표를 수집했습니다. 누락된 지표는 임의로 채우지 않습니다."
    else:
        state = "시장 지표 수집 실패"
        reason = "시장 데이터를 가져오지 못했습니다. 잠시 후 다시 실행하세요."
    return {
        "state": state,
        "reason": reason,
        "values": values
    }
def read_json(path, fallback):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return fallback
def write_json(path, value):
    temp = path.with_suffix(path.suffix + ".tmp")
    with open(temp, "w", encoding="utf-8") as f:
        json.dump(value, f, ensure_ascii=False, indent=2)
    temp.replace(path)
def main():
    now_et = datetime.now(ET)
    force = os.getenv("FORCE_SCAN") == "1"
    if not force and (
        now_et.weekday() >= 5
        or not (now_et.hour == 3 and 15 <= now_et.minute <= 59)
    ):
        print("예약 실행 시간이 아니므로 건너뜁니다:", now_et)
        return
    signals = []
    price_history = {}
    failures = 0
    print("종목 데이터 수집 시작:", len(TICKERS))
    for ticker in TICKERS:
        df = download(ticker)
        if df is None:
            failures += 1
            print("데이터 없음:", ticker)
            continue
        price_history[ticker] = serialise_prices(df)
        result = calculate_signal(df)
        if result:
            try:
                name = yf.Ticker(ticker).info.get("shortName", ticker)
            except Exception:
                name = ticker
            signals.append({
                "ticker": ticker,
                "name": name,
                **result
            })
        print("완료:", ticker)
    if not price_history:
        raise RuntimeError("주가 데이터를 하나도 받지 못해 저장을 중단합니다.")
    old_data = read_json(LATEST_FILE, {})
    macro = get_macro()
    # 시장 지표 조회가 일시 실패해도 이전에 수집한 값을 보존합니다.
    old_macro_values = old_data.get("macro", {}).get("values", {})
    for name, item in old_macro_values.items():
        if name not in macro["values"]:
            macro["values"][name] = item
    if len(macro["values"]) == 4:
        macro["state"] = "시장 지표 수집 완료"
        macro["reason"] = "저장된 시장 지표 4개를 표시합니다. 최신 수집 여부는 각 날짜를 확인하세요."
    output = {
        "updated_at": datetime.now(KST).isoformat(timespec="seconds"),
        "source": "Yahoo Finance",
        "ticker_count": len(TICKERS),
        "signals": signals,
        "macro": macro,
        "price_history": price_history,
        "scan_meta": {
            "universe": "임시 종목 목록 30개",
            "symbols_attempted": len(TICKERS),
            "symbols_failed": failures,
            "warning": "30개 종목만 검색하며 나스닥-100 전체는 아닙니다."
        }
    }
    write_json(LATEST_FILE, output)
    history = read_json(HISTORY_FILE, [])
    if not isinstance(history, list):
        history = []
    today = datetime.now(KST).date().isoformat()
    record = {
        "scan_date": today,
        "signals": signals
    }
    if history and history[-1].get("scan_date") == today:
        history[-1] = record
    else:
        history.append(record)
    write_json(HISTORY_FILE, history[-500:])
    print("스캔 완료:", len(signals), "개 신호")
    print("가격 데이터:", len(price_history), "개 종목")
    print("다운로드 실패:", failures)
    print("저장 완료:", LATEST_FILE)
if __name__ == "__main__":
    main()
