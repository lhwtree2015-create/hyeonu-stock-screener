
import os
import json
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pandas as pd
import yfinance as yf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
os.makedirs(DATA_DIR, exist_ok=True)

ET = ZoneInfo("America/New_York")
now = datetime.now(ET)

# 수동 실행은 시간 제한 없이 허용
force = os.getenv("FORCE_SCAN") == "1"

if not force and (
    now.weekday() >= 5
    or not (now.hour == 3 and 15 <= now.minute <= 59)
):
    print("예약 실행 시간이 아니므로 건너뜁니다:", now)
    raise SystemExit(0)


def download(ticker, period="1y"):
    try:
        df = yf.download(
            ticker,
            period=period,
            interval="1d",
            auto_adjust=True,
            progress=False,
            threads=False,
        )
        if df is None or df.empty:
            return None
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        return df.dropna(subset=["Close"])
    except Exception as exc:
        print("다운로드 실패:", ticker, str(exc)[:120])
        return None


def get_signal(df):
    if df is None or len(df) < 60:
        return None

    close = df["Close"].astype(float)
    low = df["Low"].astype(float)

    avg20 = close.rolling(20).mean()
    std20 = close.rolling(20).std(ddof=0)
    lower = avg20 - 2 * std20
    upper = avg20 + 2 * std20
    percent_b = (close - lower) / (upper - lower).replace(0, float("nan"))

    change = close.diff()
    gain = change.clip(lower=0).rolling(14).mean()
    loss = (-change.clip(upper=0)).rolling(14).mean()
    rs = gain / loss.replace(0, float("nan"))
    rsi = 100 - (100 / (1 + rs))

    drawdown = close / close.rolling(60).max() - 1
    i = len(df) - 1

    values = [rsi.iloc[i], percent_b.iloc[i], drawdown.iloc[i]]
    if any(pd.isna(x) for x in values):
        return None

    r = float(rsi.iloc[i])
    b = float(percent_b.iloc[i])
    dd = float(drawdown.iloc[i])

    # 강한 신호부터 하나만 표시하는 근사 규칙
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
        "date": str(df.index[-1].date()),
        "close": round(float(close.iloc[i]), 4),
        "rsi14": round(r, 2),
        "percent_b": round(b, 3),
        "drawdown60_pct": round(dd * 100, 2),
    }


def main():
    try:
        tables = pd.read_html("https://en.wikipedia.org/wiki/Nasdaq-100")
        table = next(t for t in tables if "Ticker" in t.columns)
        tickers = (
            table["Ticker"]
            .astype(str)
            .str.replace(".", "-", regex=False)
            .tolist()
        )
    except Exception as exc:
        print("종목 목록을 가져오지 못했습니다:", exc)
        tickers = [
            "AAPL", "MSFT", "NVDA", "AMZN", "META",
            "AVGO", "GOOGL", "GOOG", "COST", "NFLX",
            "TSLA", "AMD", "ADBE", "PEP", "CSCO",
            "QCOM", "INTC", "AMAT", "TXN", "INTU",
        ]

    signals = []

    for ticker in dict.fromkeys(tickers):
        df = download(ticker)
        result = get_signal(df)
        if result:
            try:
                name = yf.Ticker(ticker).info.get("shortName", ticker)
            except Exception:
                name = ticker

            signals.append({
                "ticker": ticker,
                "name": name,
                **result,
            })

    output = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "macro": {
            "state": "분석 대기",
            "reason": "거시지표 분석은 아직 연결되지 않았습니다.",
            "values": {},
        },
        "signals": signals,
        "warning": (
            "근사 신호입니다. 원본 Pine Script와 일치 여부는 "
            "검증되지 않았습니다."
        ),
    }

    with open(
        os.path.join(DATA_DIR, "latest.json"),
        "w",
        encoding="utf-8",
    ) as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    history_path = os.path.join(DATA_DIR, "signal_history.json")
    history = []
    if os.path.exists(history_path):
        try:
            with open(history_path, encoding="utf-8") as f:
                history = json.load(f)
        except Exception:
            history = []

    history.append({
        "scan_date": now.date().isoformat(),
        "signals": signals,
    })

    with open(history_path, "w", encoding="utf-8") as f:
        json.dump(history[-500:], f, ensure_ascii=False, indent=2)

    print("스캔 완료:", len(signals), "개 신호")


if __name__ == "__main__":
    main()
