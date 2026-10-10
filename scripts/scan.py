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
# 미국 동부시간 기준 정규장(09:30) 30분 전 = 09:00 ET.
# GitHub Actions 예약 실행은 지연될 수 있어 08:40~09:25 ET 사이에 시작된 실행만 인정한다.
SCAN_WINDOW_START = 8 * 60 + 40
SCAN_WINDOW_END = 9 * 60 + 25
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
def read_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default
def write_json(path, data):
    temp = path.with_suffix(path.suffix + ".tmp")
    with open(temp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    temp.replace(path)
def is_scan_time(now_et):
    """미국 동부시간 평일 08:40~09:25 사이인지 확인한다."""
    if now_et.weekday() >= 5:
        return False
    minutes = now_et.hour * 60 + now_et.minute
    return SCAN_WINDOW_START <= minutes <= SCAN_WINDOW_END
def get_tickers():
    try:
        tables = pd.read_html(
            "https://en.wikipedia.org/wiki/Nasdaq-100"
        )
        for table in tables:
            columns = {
                str(column).strip().lower(): column
                for column in table.columns
            }
            column = columns.get("ticker") or columns.get("symbol")
            if column is None:
                continue
            tickers = (
                table[column]
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
                print(f"나스닥-100 종목 목록 확보: {len(tickers)}개")
                return tickers, True
    except Exception as exc:
        print(f"종목 목록 조회 실패: {exc}")
    print("주의: 대체 종목 목록을 사용합니다.")
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
        print(f"다운로드 실패 {symbol}: {exc}")
        return None
def serialise_prices(df):
    rows = []
    for date, row in df.iterrows():
        close = float(row["Close"])
        def price(column):
            value = row[column]
            return close if pd.isna(value) else round(float(value), 4)
        raw_volume = row["Volume"]
        volume = 0 if pd.isna(raw_volume) else max(0, int(raw_volume))
        rows.append({
            "date": date.date().isoformat(),
            "open": price("Open"),
            "high": price("High"),
            "low": price("Low"),
            "close": round(close, 4),
            "volume": volume
        })
    return rows
def download_fred_2y():
    """FRED DGS2에서 미국 2년물 국채 수익률(%)을 조회합니다."""
    try:
        url = (
            "https://fred.stlouisfed.org/graph/"
            "fredgraph.csv?id=DGS2"
        )
        df = pd.read_csv(url)
        if "observation_date" not in df.columns:
            return None
        if "DGS2" not in df.columns:
            return None
        df["observation_date"] = pd.to_datetime(
            df["observation_date"], errors="coerce"
        )
        df["DGS2"] = pd.to_numeric(df["DGS2"], errors="coerce")
        df = df.dropna(subset=["observation_date", "DGS2"])
        if df.empty:
            return None
        rows = []
        for _, row in df.iterrows():
            value = float(row["DGS2"])
            rows.append({
                "date": row["observation_date"].date().isoformat(),
                "open": value,
                "high": value,
                "low": value,
                "close": value,
                "volume": 0
            })
        latest = rows[-1]
        return {
            "value": latest["close"],
            "updated_at": latest["date"],
            "source": "FRED DGS2",
            "symbol": "DGS2"
        }, rows
    except Exception as exc:
        print(f"FRED 2년물 조회 실패: {exc}")
        return None
def get_macro(old_data):
    values = {}
    histories = {}
    old_values = old_data.get("macro", {}).get("values", {})
    old_histories = old_data.get("macro_history", {})
    for name, symbol in MACRO_SYMBOLS.items():
        df = download(symbol, "1y")
        if df is not None and not df.empty:
            rows = serialise_prices(df)
            latest = rows[-1]
            values[name] = {
                "value": latest["close"],
                "updated_at": latest["date"],
                "source": "Yahoo Finance",
                "symbol": symbol
            }
            histories[name] = rows
            print(f"시장 지표 수집 성공: {name}")
            continue
        if name == "미국 2년물 금리":
            result = download_fred_2y()
            if result is not None:
                values[name], histories[name] = result
                print("미국 2년물 금리: FRED 대체 데이터 사용")
                continue
        # 일시적인 오류가 발생하면 기존 저장 데이터 유지
        if name in old_values:
            values[name] = old_values[name]
        if name in old_histories:
            histories[name] = old_histories[name]
        print(f"시장 지표 신규 수집 실패: {name}")
    count = len(values)
    if count == len(MACRO_SYMBOLS):
        state = "시장 지표 수집 완료"
        reason = "8개 지표의 데이터가 있습니다. 각 기준일을 확인하세요."
    elif count > 0:
        state = "시장 지표 일부 수집"
        reason = f"8개 지표 중 {count}개 데이터를 확보했습니다."
    else:
        state = "시장 지표 수집 실패"
        reason = "시장 지표를 확보하지 못했습니다."
    return {
        "state": state,
        "reason": reason,
        "values": values
    }, histories
def calculate_signal(df):
    if df is None or len(df) < 60:
        return None
    close = df["Close"].astype(float)
    ma20 = close.rolling(20).mean()
    ma50 = close.rolling(50).mean()
    ma200 = close.rolling(200).mean()
    std20 = close.rolling(20).std(ddof=0)
    upper = ma20 + 2 * std20
    lower = ma20 - 2 * std20
    band_width = (upper - lower).replace(0, float("nan"))
    percent_b = (close - lower) / band_width
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss = (-delta.clip(upper=0)).rolling(14).mean()
    rs = gain / loss.replace(0, float("nan"))
    rsi = 100 - 100 / (1 + rs)
    # 0으로 나누는 경우 RSI 계산을 안정적으로 처리
    rsi = rsi.mask((loss == 0) & (gain > 0), 100)
    rsi = rsi.mask((loss == 0) & (gain == 0), 50)
    high60 = close.rolling(60).max()
    drawdown = close / high60 - 1
    i = len(df) - 1
    if any(pd.isna(series.iloc[i]) for series in (
        ma20, ma50, percent_b, rsi, drawdown
    )):
        return None
    current_rsi = float(rsi.iloc[i])
    current_band = float(percent_b.iloc[i])
    current_drawdown = float(drawdown.iloc[i])
    signal = None
    if (
        current_drawdown <= -0.23
        and current_rsi <= 28
        and current_band <= -0.05
    ):
        signal = "패닉셀"
    elif (
        current_drawdown <= -0.17
        and current_rsi <= 33
        and current_band <= 0.15
    ):
        signal = "급락"
    elif current_rsi <= 35 and current_band <= 0.20:
        signal = "조정"
    elif current_rsi <= 42 and current_band <= 0.25:
        signal = "단기조정"
    if signal is None:
        return None
    volume20 = df["Volume"].rolling(20).mean().iloc[i]
    volume = df["Volume"].iloc[i]
    return {
        "signal": signal,
        "date": df.index[i].date().isoformat(),
        "close": round(float(close.iloc[i]), 2),
        "rsi14": round(current_rsi, 2),
        "drawdown": round(current_drawdown * 100, 2),
        "drawdown60_pct": round(current_drawdown * 100, 2),
        "percent_b": round(current_band, 3),
        "ma20": round(float(ma20.iloc[i]), 2),
        "ma50": round(float(ma50.iloc[i]), 2),
        "ma200": (
            round(float(ma200.iloc[i]), 2)
            if not pd.isna(ma200.iloc[i]) else None
        ),
        "volume": 0 if pd.isna(volume) else int(volume),
        "avg_volume20": (
            round(float(volume20), 0)
            if not pd.isna(volume20) else None
        )
    }
def get_company_name(ticker):
    # 개별 종목마다 추가 API를 호출하지 않도록 ticker를 기본 이름으로 사용
    return ticker
_INFO_CACHE = {}
def fetch_info(ticker):
    """yfinance 종목 정보를 한 번만 조회해 재사용한다. 실패하면 빈 딕셔너리."""
    if ticker in _INFO_CACHE:
        return _INFO_CACHE[ticker]
    try:
        info = yf.Ticker(ticker).info or {}
    except Exception as exc:
        print(f"종목 정보 조회 실패 {ticker}: {exc}")
        info = {}
    _INFO_CACHE[ticker] = info if isinstance(info, dict) else {}
    return _INFO_CACHE[ticker]
def to_number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if pd.isna(number) or number in (float("inf"), float("-inf")):
        return None
    return number
def get_company_info(tickers, old_info):
    """신호가 발생한 종목에 한해 섹터·회사명·시가총액을 조회한다.

    신호 계산에는 영향을 주지 않는 표시용 정보이며,
    조회에 실패하면 이전에 저장된 값을 그대로 유지한다.
    """
    info_map = {}
    if isinstance(old_info, dict):
        for ticker, value in old_info.items():
            if isinstance(value, dict):
                info_map[ticker] = value
    for ticker in tickers:
        raw = fetch_info(ticker)
        if not raw:
            continue
        entry = dict(info_map.get(ticker, {}))
        sector = raw.get("sector")
        if isinstance(sector, str) and sector.strip():
            entry["sector"] = sector.strip()
        industry = raw.get("industry")
        if isinstance(industry, str) and industry.strip():
            entry["industry"] = industry.strip()
        name = raw.get("longName") or raw.get("shortName")
        if isinstance(name, str) and name.strip():
            entry["company_name"] = name.strip()
        cap = raw.get("marketCap")
        if (
            isinstance(cap, (int, float))
            and not isinstance(cap, bool)
            and cap > 0
        ):
            entry["market_cap"] = cap
        if entry:
            info_map[ticker] = entry
    return info_map
def get_analyst_info(tickers, old_info):
    """신호가 발생한 종목의 애널리스트 의견·목표가·증권사별 의견을 조회한다.

    표시용 정보이며 신호 계산에는 영향을 주지 않는다.
    조회에 실패하거나 데이터가 없으면 이전에 저장된 값을 그대로 유지한다.
    """
    result = {}
    if isinstance(old_info, dict):
        for ticker, value in old_info.items():
            if isinstance(value, dict):
                result[ticker] = value
    today = datetime.now(KST).date().isoformat()
    for ticker in tickers:
        stock = yf.Ticker(ticker)
        summary = {}
        brokers = []
        # 1) Buy / Hold / Sell 인원 수 (가장 최근 월)
        try:
            recs = stock.recommendations_summary
            if recs is not None and not recs.empty:
                row = recs.iloc[0]
                for key in ("strongBuy", "buy", "hold", "sell", "strongSell"):
                    if key in recs.columns:
                        value = to_number(row[key])
                        if value is not None:
                            summary[key] = int(value)
        except Exception as exc:
            print(f"투자의견 요약 조회 실패 {ticker}: {exc}")
        # 2) 목표가
        try:
            targets = stock.analyst_price_targets
            if isinstance(targets, dict):
                for key, source in (
                    ("targetMean", "mean"),
                    ("targetLow", "low"),
                    ("targetHigh", "high"),
                ):
                    value = to_number(targets.get(source))
                    if value is not None and value > 0:
                        summary[key] = round(value, 2)
        except Exception as exc:
            print(f"목표가 조회 실패 {ticker}: {exc}")
        info = fetch_info(ticker)
        count = to_number(info.get("numberOfAnalystOpinions"))
        if count is not None and count > 0:
            summary["numberAnalysts"] = int(count)
        for key, source in (
            ("targetMean", "targetMeanPrice"),
            ("targetLow", "targetLowPrice"),
            ("targetHigh", "targetHighPrice"),
        ):
            if key not in summary:
                value = to_number(info.get(source))
                if value is not None and value > 0:
                    summary[key] = round(value, 2)
        # 3) 증권사별 최신 의견 (증권사마다 가장 최근 1건, 최대 30곳)
        try:
            changes = stock.upgrades_downgrades
            if changes is not None and not changes.empty:
                changes = changes.sort_index(ascending=False)
                seen = set()
                for date, row in changes.iterrows():
                    firm = row.get("Firm")
                    if not isinstance(firm, str) or not firm.strip():
                        continue
                    firm = firm.strip()
                    if firm in seen:
                        continue
                    seen.add(firm)
                    rating = row.get("ToGrade")
                    rating = (
                        rating.strip()
                        if isinstance(rating, str) and rating.strip()
                        else "의견 미확인"
                    )
                    entry = {
                        "firm": firm,
                        "rating": rating,
                        "date": (
                            date.date().isoformat()
                            if hasattr(date, "date")
                            else str(date)[:10]
                        ),
                    }
                    target = to_number(row.get("currentPriceTarget"))
                    if target is not None and target > 0:
                        entry["target_price"] = round(target, 2)
                    brokers.append(entry)
                    if len(brokers) >= 30:
                        break
        except Exception as exc:
            print(f"증권사별 의견 조회 실패 {ticker}: {exc}")
        if summary or brokers:
            result[ticker] = {
                "updated_at": today,
                "summary": summary,
                "brokers": brokers,
            }
    return result
def main():
    now_et = datetime.now(ET)
    force = os.getenv("FORCE_SCAN", "0") == "1"
    if not force and not is_scan_time(now_et):
        print(f"예약 실행 시간이 아니므로 건너뜁니다: {now_et}")
        return
    old_data = read_json(LATEST_FILE, {})
    tickers, is_full_nasdaq100 = get_tickers()
    signals = []
    price_history = {}
    failures = 0
    for index, ticker in enumerate(tickers, start=1):
        print(f"[{index}/{len(tickers)}] {ticker}")
        df = download(ticker, "1y")
        if df is None or df.empty:
            failures += 1
            print(f"주가 데이터 없음: {ticker}")
            # 일시적인 실패라면 이전 가격 이력을 보존
            old_prices = old_data.get("price_history", {}).get(ticker)
            if isinstance(old_prices, list) and old_prices:
                price_history[ticker] = old_prices
            continue
        price_history[ticker] = serialise_prices(df)
        result = calculate_signal(df)
        if result is not None:
            signals.append({
                "ticker": ticker,
                "name": get_company_name(ticker),
                **result
            })
    if not price_history:
        raise RuntimeError(
            "주가 데이터를 확보하지 못했습니다. "
            "기존 latest.json을 덮어쓰지 않습니다."
        )
    macro, macro_history = get_macro(old_data)
    company_info = get_company_info(
        [item["ticker"] for item in signals],
        old_data.get("company_info", {})
    )
    analyst_info = get_analyst_info(
        [item["ticker"] for item in signals],
        old_data.get("analyst_info", {})
    )
    output = {
        "updated_at": datetime.now(KST).isoformat(timespec="seconds"),
        "source": "Yahoo Finance / FRED",
        "ticker_count": len(price_history),
        "signals": signals,
        "company_info": company_info,
        "analyst_info": analyst_info,
        "macro": macro,
        "macro_history": macro_history,
        "price_history": price_history,
        "scan_meta": {
            "universe": (
                "Nasdaq-100"
                if is_full_nasdaq100
                else "대체 종목 목록"
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
    print("================================")
    print("스캔 완료")
    print(f"저장된 종목: {len(price_history)}")
    print(f"매수 신호: {len(signals)}")
    print(f"수집 실패: {failures}")
    print(f"시장 지표: {len(macro['values'])}/8")
    print(f"전체 나스닥-100 목록: {is_full_nasdaq100}")
    print(f"저장 파일: {LATEST_FILE}")
    print("================================")
if __name__ == "__main__":
    main()
