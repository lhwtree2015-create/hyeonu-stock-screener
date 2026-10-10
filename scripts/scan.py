import json
import os
from datetime import datetime
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

FALLBACK_TICKERS = [
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
    "미국 2년물 금리": "^UST2Y",
    "미국 10년물 금리": "^TNX",
    "VIX": "^VIX",
    "금": "GC=F",
    "원·달러 환율": "KRW=X",
    "비트코인": "BTC-USD",
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


def get_tickers():
    try:
        tables = pd.read_html(
            "https://en.wikipedia.org/wiki/Nasdaq-100"
        )

        for table in tables:
            columns = {
                str(c).strip().lower(): c
                for c in table.columns
            }

            col = columns.get("ticker") or columns.get("symbol")
            if col is None:
                continue

            tickers = (
                table[col].astype(str).str.strip()
                .str.replace(".", "-", regex=False).tolist()
            )

            tickers = list(dict.fromkeys(
                t for t in tickers if t and t.lower() != "nan"
            ))

            if len(tickers) >= 90:
                print("나스닥-100 구성 종목:", len(tickers))
                return tickers, True

    except Exception as exc:
        print("종목 목록 조회 실패:", str(exc)[:150])

    print("주의: 대체 종목 30개 사용")
    return FALLBACK_TICKERS, False


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

        if "Close" not in df.columns:
            return None

        for column in ("Open", "High", "Low"):
            if column not in df.columns:
                df[column] = df["Close"]

        if "Volume" not in df.columns:
            df["Volume"] = 0

        df = df[["Open", "High", "Low", "Close", "Volume"]]
        df = df.dropna(subset=["Close"])
        df.index = pd.to_datetime(df.index)

        return df if not df.empty else None

    except Exception as exc:
        print(f"다운로드 실패 {symbol}: {str(exc)[:120]}")
        return None


def download_fred_2y():
    """FRED D
