
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

# GitHub Actions 수동 실행은 시간 제한을 적용하지 않습니다.
force = os.getenv("FORCE_SCAN") == "1"

if not force and (
    now.weekday() >= 5
    or not (now.hour == 3 and 15 <= now.minute <= 59)
):
    print("예약 실행 시간이 아니므로 건너뜁니다:", now)
    raise SystemExit(0)

# 임시 종목 목록: 나스닥-100 전체가 아닌 일부 종목입니다.
TICKERS = [
    "AAPL", "MSFT", "NVDA", "AMZN", "META",
    "AVGO", "GOOGL", "GOOG", "COST", "NFLX",
    "TSLA", "AMD", "ADBE", "PEP", "CSCO",
    "QCOM", "INTC", "AMAT", "TXN", "INTU",
    "AMGN", "HON", "BKNG", "SBUX", "ADP",
    "GILD", "VRTX", "ADI", "REGN", "PANW"
]


def download(ticker):
    try:
        df = yf.download(
            ticker,
            period="1y",
            interval="1d",
            auto_adjust=True,
            progress=False,
            threads=False
        )

        if df is None or df.empty:
            print("주가 데이터 없음:", ticker)
            return None

        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)

        return df.dropna(subset=["Close"])

    except Exception as exc:
        print("주가 다운로드 실패:", ticker, str(exc)[:150])
        return None


def calculate_signal(df):
    if df is None or len(df) < 60:
        return None

    close = df["Close"].astype(float)
    low = df["Low"].astype(float)

    avg20 = close.rolling(20).mean()
    std20 = close.rolling(20).std(ddof=0)

    upper = avg20 + 2 * std20
    lower = avg20 - 2 * std20

    percent_b = (
        (close - lower) / (upper - lower).replace(0, float("nan"))
    )

    change = close.diff()
    gain = change.clip(lower=0).rolling(14).mean()
    loss = (-change.clip(upper=0)).rolling(14).mean()

    rs = gain / loss.replace(0, float("nan"))
    rsi = 100 - (100 / (1 + rs))

    drawdown = close / close.rolling(60).max() - 1

    i = len(df) - 1

    values = [
        rsi.iloc[i],
        percent_b.iloc[i],
        drawdown.iloc[i]
    ]

    if any(pd.isna(value) for value in values):
        return None

    r = float(rsi.iloc[i])
    b = float(percent_b.iloc[i])
    dd = float(drawdown.iloc[i])

    signal = None

    # 강한 신호부터 우선 표시합니다.
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
        "drawdown60_pct": round(dd * 100, 2)
    }


def main():
    signals = []
    failures = 0

    print("스캔 시작:", len(TICKERS), "개 종목")

    for ticker in TICKERS:
        df = download(ticker)

        if df is None:
            failures += 1
            continue

        result = calculate_signal(df)

        if result:
            try:
                name = yf.Ticker(ticker).info.get(
                    "shortName", ticker
                )
            except Exception:
                name = ticker

            signals.append({
                "ticker": ticker,
                "name": name,
                **result
            })

        print("확인 완료:", ticker)

    if failures == len(TICKERS):
        raise RuntimeError(
            "모든 종목의 주가 데이터를 받지 못했습니다. "
            "실패한 스캔 결과를 정상 결과로 저장하지 않습니다."
        )

    output = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "macro": {
            "state": "분석 대기",
            "reason": "거시지표 수집은 아직 연결되지 않았습니다.",
            "values": {}
        },
        "signals": signals,
        "scan_meta": {
            "universe": "임시 종목 목록 30개",
            "symbols_attempted": len(TICKERS),
            "symbols_failed": failures,
            "warning": (
                "근사 신호이며 원본 Pine Script와의 일치 여부는 "
                "검증되지 않았습니다."
            )
        }
    }

    latest_path = os.path.join(DATA_DIR, "latest.json")

    with open(latest_path, "w", encoding="utf-8") as f:
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
        "signals": signals
    })

    with open(history_path, "w", encoding="utf-8") as f:
        json.dump(history[-500:], f, ensure_ascii=False, indent=2)

    print("스캔 완료:", len(signals), "개 신호")
    print("주가 데이터 다운로드 실패:", failures, "개")
    print("결과 저장:", latest_path)


if __name__ == "__main__":
    main()
