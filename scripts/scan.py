import json
import os
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import yfinance as yf
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
LATEST_FILE = DATA_DIR / "latest.json"
HISTORY_FILE = DATA_DIR / "signal_history.json"
KST = ZoneInfo("Asia/Seoul")
# 현재 스캔 대상: 우선 30개 종목
TICKERS = [
    "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL",
    "GOOG", "AVGO", "TSLA", "COST", "NFLX", "AMD",
    "ADBE", "PEP", "CSCO", "TMUS", "INTC", "QCOM",
    "TXN", "AMGN", "HON", "INTU", "BKNG", "SBUX",
    "ISRG", "REGN", "VRTX", "PANW", "ADI", "LRCX"
]
MACRO_SYMBOLS = {
    "나스닥-100": "^NDX",
    "S&P 500": "^GSPC",
    "VIX": "^VIX",
    "비트코인": "BTC-USD",
}
SIGNAL_PRIORITY = {
    "단기조정": 1,
    "조정": 2,
    "급락": 3,
    "패닉셀": 4,
}
def now_kst():
    return datetime.now(KST).isoformat(timespec="seconds")
def get_close_series(symbol, period="6mo"):
    frame = yf.Ticker(symbol).history(
        period=period,
        interval="1d",
        auto_adjust=True
    )
    if frame.empty or "Close" not in frame:
        return None
    close = frame["Close"].dropna()
    return close if not close.empty else None
def get_macro():
    values = {}
    failures = []
    for name, symbol in MACRO_SYMBOLS.items():
        try:
            close = get_close_series(symbol, "5d")
            if close is None:
                raise ValueError("가격 데이터가 비어 있습니다.")
            latest_value = float(close.iloc[-1])
            data_date = close.index[-1].date().isoformat()
            values[name] = {
                "value": round(latest_value, 4),
                "updated_at": data_date,
                "source": "Yahoo Finance",
                "symbol": symbol,
            }
        except Exception as exc:
            failures.append(name)
            print(f"[WARN] {name} 데이터 수집 실패: {exc}")
    if len(values) == len(MACRO_SYMBOLS):
        state = "시장 지표 수집 완료"
        reason = (
            "나스닥-100, S&P 500, VIX, 비트코인 데이터를 수집했습니다. "
            "이 상태는 매수·매도 판단 등급이 아니라 데이터 연결 상태입니다."
        )
    elif values:
        state = "일부 시장 지표 수집"
        reason = (
            "수집에 실패한 지표: " + ", ".join(failures)
            if failures else "일부 지표만 수집했습니다."
        )
    else:
        state = "시장 데이터 수집 실패"
        reason = "현재 지표를 가져오지 못했습니다. 나중에 다시 시도합니다."
    return {
        "state": state,
        "reason": reason,
        "values": values,
    }
def calculate_rsi(close, period=14):
    delta = close.diff()
    gains = delta.clip(lower=0)
    losses = -delta.clip(upper=0)
    avg_gain = gains.rolling(period).mean()
    avg_loss = losses.rolling(period).mean()
    rs = avg_gain / avg_loss.replace(0, float("nan"))
    rsi = 100 - (100 / (1 + rs))
    if rsi.empty or rsi.iloc[-1] != rsi.iloc[-1]:
        return None
    return float(rsi.iloc[-1])
def scan_stock(ticker):
    close = get_close_series(ticker, "6mo")
    if close is None or len(close) < 30:
        print(f"[WARN] {ticker}: 거래 데이터 부족")
        return None
    price = float(close.iloc[-1])
    high_60 = float(close.tail(60).max())
    drawdown = ((price / high_60) - 1) * 100
    rsi = calculate_rsi(close)
    # 초기 버전의 근사 신호 기준
    signal = None
    if drawdown <= -25 and rsi is not None and rsi < 30:
        signal = "패닉셀"
    elif drawdown <= -18:
        signal = "급락"
    elif drawdown <= -10:
        signal = "조정"
    elif drawdown <= -5:
        signal = "단기조정"
    if signal is None:
        return None
    try:
        name = yf.Ticker(ticker).info.get("longName") or ticker
    except Exception:
        name = ticker
    return {
        "ticker": ticker,
        "name": name,
        "signal": signal,
        "date": close.index[-1].date().isoformat(),
        "close": round(price, 2),
        "drawdown": round(drawdown, 2),
        "rsi14": round(rsi, 2) if rsi is not None else None,
    }
def read_json(path, default):
    try:
        with path.open("r", encoding="utf-8") as file:
            return json.load(file)
    except (OSError, json.JSONDecodeError):
        return default
def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)
    temporary.replace(path)
def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print("[INFO] 시장 지표 수집 시작")
    macro = get_macro()
    print("[INFO] 종목 신호 스캔 시작")
    signals = []
    for ticker in TICKERS:
        try:
            result = scan_stock(ticker)
            if result:
                signals.append(result)
                print(f"[SIGNAL] {ticker}: {result['signal']}")
        except Exception as exc:
            print(f"[WARN] {ticker} 스캔 실패: {exc}")
    signals.sort(
        key=lambda item: SIGNAL_PRIORITY.get(item["signal"], 0),
        reverse=True
    )
    latest = {
        "updated_at": now_kst(),
        "source": "Yahoo Finance",
        "ticker_count": len(TICKERS),
        "signals": signals,
        "macro": macro,
    }
    write_json(LATEST_FILE, latest)
    history = read_json(HISTORY_FILE, [])
    if not isinstance(history, list):
        history = []
    scan_date = datetime.now(KST).date().isoformat()
    # 같은 날짜의 수동·자동 실행은 기록을 중복 추가하지 않음
    record = {
        "scan_date": scan_date,
        "signals": signals,
    }
    if history and history[-1].get("scan_date") == scan_date:
        history[-1] = record
    else:
        history.append(record)
    write_json(HISTORY_FILE, history)
    print(f"[DONE] 스캔 대상 {len(TICKERS)}개")
    print(f"[DONE] 발견한 신호 {len(signals)}개")
    print(f"[DONE] 시장 지표 {len(macro['values'])}/{len(MACRO_SYMBOLS)}개 수집")
    print(f"[DONE] 결과 저장: {LATEST_FILE}")
if __name__ == "__main__":
    main()
