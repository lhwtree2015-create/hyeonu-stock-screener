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
    "미국 10년물 금리": "^TNX",
    "VIX": "^VIX",
    "금": "GC=F",
    "원·달러 환율": "KRW=X",
    "비트코인": "BTC-USD",
}


def read_json(path, fallback):
    try:
        with open(path, encoding="utf-8") as file:
            return json.load(file)
    except (OSError, ValueError):
        return fallback


def write_json(path, value):
    temp = path.with_suffix(path.suffix + ".tmp")

    with open(temp, "w", encoding="utf-8") as file:
        json.dump(value, file, ensure_ascii=False, indent=2)

    temp.replace(path)


def get_tickers():
    """나스닥-100 구성 종목을 가져오고 실패 시 대체 목록 사용."""
    try:
        tables = pd.read_html(
            "https://en.wikipedia.org/wiki/Nasdaq-100"
        )

        for table in tables:
            columns = {
                str(column).strip().lower(): column
                for column in table.columns
            }

            ticker_column = next(
                (
                    columns[key]
                    for key in ("ticker", "symbol")
                    if key in columns
                ),
                None
            )

            if ticker_column is None:
                continue

            tickers = (
                table[ticker_column]
                .astype(str)
                .str.strip()
                .str.replace(".", "-", regex=False)
                .tolist()
            )

            tickers = list(dict.fromkeys(
                ticker for ticker in tickers
                if ticker and ticker.lower() != "nan"
            ))

            if len(tickers) >= 90:
                print("나스닥-100 구성 종목:", len(tickers))
                return tickers, True

    except Exception as exc:
        print("나스닥-100 목록 조회 실패:", str(exc)[:150])

    print("주의: 대체 종목 목록 30개를 사용합니다.")
    return FALLBACK_TICKERS, False


def download(symbol, period="1y"):
    """일반 주식 가격 다운로드."""
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

        # 거래량이 없는 지표도 처리할 수 있도록 기본값 지정
        for column in ("Open", "High", "Low"):
            if column not in df.columns:
                df[column] = df["Close"]

        if "Volume" not in df.columns:
            df["Volume"] = 0

        df = df[["Open", "High", "Low", "Close", "Volume"]]
        df = df.dropna(subset=["Close"])

        if df.empty:
            return None

        df.index = pd.to_datetime(df.index)
        return df

    except Exception as exc:
        print(f"다운로드 실패 {symbol}: {str(exc)[:150]}")
        return None


def serialise_prices(df):
    result = []

    for date, row in df.iterrows():
        close = float(row["Close"])

        def price(column):
            value = row[column]
            return close if pd.isna(value) else round(float(value), 4)

        volume_value = row["Volume"]
        volume = (
            0 if pd.isna(volume_value)
            else max(0, int(volume_value))
        )

        result.append({
            "date": date.date().isoformat(),
            "open": price("Open"),
            "high": price("High"),
            "low": price("Low"),
            "close": round(close, 4),
            "volume": volume
        })

    return result


def get_macro(old_data):
    """현재 시장 지표와 과거 일봉을 수집."""
    values = {}
    macro_history = {}

    old_macro = old_data.get("macro", {}).get("values", {})
    old_history = old_data.get("macro_history", {})

    for name, symbol in MACRO_SYMBOLS.items():
        try:
            # 과거 차트용 데이터
            df = download(symbol, "1y")

            if df is None or df.empty:
                print("시장 지표 수집 실패:", name)

                # 다운로드 실패 시 과거 저장 데이터 보존
                if name in old_history:
                    macro_history[name] = old_history[name]

                if name in old_macro:
                    values[name] = old_macro[name]

                continue

            rows = serialise_prices(df)
            macro_history[name] = rows

            last = df.iloc[-1]
            last_date = df.index[-1].date().isoformat()
            current_value = round(float(last["Close"]), 4)

            # 미국 10년물 금리(^TNX)는 보통 퍼센트 단위로 표시
            values[name] = {
                "value": current_value,
                "updated_at": last_date,
                "source": "Yahoo Finance",
                "symbol": symbol
            }

            print(
                f"시장 지표 완료: {name}, "
                f"현재값={current_value}, "
                f"과거 데이터={len(rows)}개"
            )

        except Exception as exc:
            print(f"시장 지표 오류 {name}: {str(exc)[:150]}")

            if name in old_history:
                macro_history[name] = old_history[name]

            if name in old_macro:
                values[name] = old_macro[name]

    collected = len(values)

    if collected == len(MACRO_SYMBOLS):
        state = "시장 지표 수집 완료"
        reason = "7개 시장 지표의 저장 데이터를 표시합니다. 날짜를 확인하세요."
    elif collected:
        state = "시장 지표 일부 수집"
        reason = (
            f"7개 지표 중 {collected}개를 확보했습니다. "
            "누락된 지표는 데이터 수집을 확인하세요."
        )
    else:
        state = "시장 지표 수집 실패"
        reason = "시장 데이터를 가져오지 못했습니다."

    return {
        "state": state,
        "reason": reason,
        "values": values
    }, macro_history


def calculate_signal(df):
    if df is None or len(df) < 60:
        return None

    close = df["Close"].astype(float)

    avg20 = close.rolling(20).mean()
    std20 = close.rolling(20).std(ddof=0)

    upper = avg20 + 2 * std20
    lower = avg20 - 2 * std20

    percent_b = (
        (close - lower) /
        (upper - lower).replace(0, float("nan"))
    )

    delta = close.diff()

    gain = delta.clip(lower=0).rolling(14).mean()
    loss = (-delta.clip(upper=0)).rolling(14).mean()

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
        "ma20": round(float(avg20.iloc[i]), 2),
        "ma50": round(float(close.rolling(50).mean().iloc[i]), 2),
        "ma200": (
            round(float(close.rolling(200).mean().iloc[i]), 2)
            if len(close) >= 200 else None
        ),
        "volume": int(df["Volume"].iloc[i]),
        "avg_volume20": round(
            float(df["Volume"].rolling(20).mean().iloc[i]), 0
        )
    }


def main():
    now_et = datetime.now(ET)

    force = os.getenv("FORCE_SCAN") == "1"

    if not force and (
        now_et.weekday() >= 5
        or not (
            now_et.hour == 3
            and 15 <= now_et.minute <= 59
        )
    ):
        print("예약 실행 시간이 아니므로 건너뜁니다:", now_et)
        return

    old_data = read_json(LATEST_FILE, {})

    tickers, is_full_nasdaq100 = get_tickers()

    signals = []
    price_history = {}
    failures = 0

    print("종목 데이터 수집 시작:", len(tickers))

    for ticker in tickers:
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
        raise RuntimeError(
            "주가 데이터를 하나도 받지 못해 저장을 중단합니다."
        )

    macro, macro_history = get_macro(old_data)

    output = {
        "updated_at": datetime.now(KST).isoformat(timespec="seconds"),
        "source": "Yahoo Finance",
        "ticker_count": len(price_history),
        "signals": signals,
        "macro": macro,
        "macro_history": macro_history,
        "price_history": price_history,
        "scan_meta": {
            "universe": (
                "Nasdaq-100"
                if is_full_nasdaq100
                else "대체 종목 목록 30개"
            ),
            "is_full_nasdaq100": is_full_nasdaq100,
            "symbols_attempted": len(tickers),
            "symbols_failed": failures,
            "warning": (
                ""
                if is_full_nasdaq100
                else "나스닥-100 전체가 아닌 대체 종목 목록입니다."
            )
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
    print("시장 지표:", len(macro["values"]), "개")
    print("시장 과거 데이터:", len(macro_history), "개")
    print("저장 완료:", LATEST_FILE)


if __name__ == "__main__":
    main()
