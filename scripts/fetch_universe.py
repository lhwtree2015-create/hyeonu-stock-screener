"""S&P 500 전 종목 + 지수/ETF + 암호화폐 시총 상위 10개의 요약과 가격 이력을 저장한다.

- data/universe.json          : 목록 화면용 요약 (가격·등락률·시총·섹터·30일 미니차트)
- data/prices/<A-Z,_>.json    : S&P 500 종목 1년 일봉 (첫 글자별 샤드, 상세 화면에서 필요할 때만 읽음)
- data/prices/_funds.json     : 지수·ETF 1년 일봉
- data/prices/_coins.json     : 코인 1년 일봉
실패한 항목은 이전 값을 유지하며, 신호 계산(scan.py)과는 완전히 분리되어 있다.
"""
import io
import json
import os
import time
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
import pandas as pd
import yfinance as yf
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
PRICE_DIR = DATA_DIR / "prices"
UNIVERSE_FILE = DATA_DIR / "universe.json"
KST = ZoneInfo("Asia/Seoul")
UA = "Mozilla/5.0 (HyeonuStockScreener)"
FUNDS = [
    ("^GSPC", "SPX", "S&P 500 지수", "지수"),
    ("^NDX", "NDX", "나스닥-100 지수", "지수"),
    ("^DJI", "DJI", "다우존스 지수", "지수"),
    ("SPY", "SPY", "SPDR S&P 500 ETF", "ETF"),
    ("VOO", "VOO", "Vanguard S&P 500 ETF", "ETF"),
    ("IVV", "IVV", "iShares Core S&P 500 ETF", "ETF"),
    ("QQQ", "QQQ", "Invesco QQQ Trust", "ETF"),
    ("QLD", "QLD", "ProShares Ultra QQQ (2x)", "ETF"),
    ("TQQQ", "TQQQ", "ProShares UltraPro QQQ (3x)", "ETF"),
    ("SQQQ", "SQQQ", "ProShares UltraPro Short QQQ (-3x)", "ETF"),
    ("SSO", "SSO", "ProShares Ultra S&P500 (2x)", "ETF"),
    ("SPXL", "SPXL", "Direxion Daily S&P 500 Bull 3X", "ETF"),
    ("SOXL", "SOXL", "Direxion Daily Semiconductor Bull 3X", "ETF"),
    ("DIA", "DIA", "SPDR Dow Jones Industrial Average ETF", "ETF"),
    ("IWM", "IWM", "iShares Russell 2000 ETF", "ETF"),
    ("VTI", "VTI", "Vanguard Total Stock Market ETF", "ETF"),
    ("SCHD", "SCHD", "Schwab U.S. Dividend Equity ETF", "ETF"),
    ("SMH", "SMH", "VanEck Semiconductor ETF", "ETF"),
    ("TLT", "TLT", "iShares 20+ Year Treasury Bond ETF", "ETF"),
    ("GLD", "GLD", "SPDR Gold Shares", "ETF"),
]
def read_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default
def write_json(path, data, compact=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    with open(temp, "w", encoding="utf-8") as f:
        if compact:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(data, f, ensure_ascii=False, indent=1)
    temp.replace(path)
def to_number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return None if pd.isna(number) else number
def sp500_table():
    """위키피디아의 S&P 500 구성 종목 표 (티커, 회사명, GICS 섹터·업종)."""
    request = urllib.request.Request(
        "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
        headers={"User-Agent": UA},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        html = response.read().decode("utf-8")
    for table in pd.read_html(io.StringIO(html)):
        columns = {str(c).strip().lower(): c for c in table.columns}
        if "symbol" in columns and "security" in columns:
            result = {}
            for _, row in table.iterrows():
                ticker = str(row[columns["symbol"]]).strip().replace(".", "-")
                if not ticker or ticker.lower() == "nan":
                    continue
                result[ticker] = {
                    "name": str(row[columns["security"]]).strip(),
                    "sector": str(row.get(columns.get("gics sector"), "")).strip(),
                    "industry": str(
                        row.get(columns.get("gics sub-industry"), "")
                    ).strip(),
                }
            if len(result) >= 400:
                return result
    raise RuntimeError("S&P 500 표를 찾지 못했습니다.")
def download_chunk(tickers, period="1y"):
    """여러 종목의 일봉을 한 번에 받는다. {ticker: DataFrame}"""
    for attempt in range(2):
        try:
            data = yf.download(
                tickers, period=period, interval="1d", auto_adjust=True,
                group_by="ticker", progress=False, threads=True,
            )
            break
        except Exception as exc:
            print(f"묶음 다운로드 실패({attempt + 1}/2): {exc}")
            data = None
            time.sleep(3)
    result = {}
    if data is None or data.empty:
        return result
    for ticker in tickers:
        try:
            if isinstance(data.columns, pd.MultiIndex):
                if ticker not in data.columns.get_level_values(0):
                    continue
                frame = data[ticker]
            else:
                frame = data
            frame = frame[["Open", "High", "Low", "Close", "Volume"]]
            frame = frame.dropna(subset=["Close"])
            if not frame.empty:
                result[ticker] = frame
        except Exception as exc:
            print(f"처리 실패 {ticker}: {exc}")
    return result
def price_digits(value):
    return 2 if value >= 1 else 4
def to_columns(frame):
    """샤드 저장용 컬럼 배열 (용량 절약)."""
    close = frame["Close"].astype(float)
    digits = price_digits(float(close.iloc[-1]))
    def col(name):
        series = frame[name].astype(float)
        series = series.fillna(close)
        return [round(float(v), digits) for v in series]
    volume = frame["Volume"].fillna(0)
    return {
        "d": [d.date().isoformat() for d in frame.index],
        "o": col("Open"),
        "h": col("High"),
        "l": col("Low"),
        "c": col("Close"),
        "v": [max(0, int(v)) for v in volume],
    }
def summarize(frame):
    close = frame["Close"].astype(float)
    last = float(close.iloc[-1])
    prev = float(close.iloc[-2]) if len(close) > 1 else None
    digits = price_digits(last)
    return {
        "price": round(last, digits),
        "change_pct": (
            round((last / prev - 1) * 100, 2) if prev and prev > 0 else None
        ),
        "volume": int(frame["Volume"].iloc[-1]) if not pd.isna(frame["Volume"].iloc[-1]) else 0,
        "date": frame.index[-1].date().isoformat(),
        "spark": [round(float(v), digits) for v in close.iloc[-30:]],
    }
def fetch_market_caps(tickers, previous, budget_seconds):
    """시가총액은 종목마다 한 번씩 조회해야 해서, 시간 한도 안에서 오래된 것부터 갱신한다."""
    caps = {k: v for k, v in previous.items() if isinstance(v, dict)}
    started = time.time()
    order = sorted(tickers, key=lambda t: caps.get(t, {}).get("t", "0000"))
    updated = 0
    for ticker in order:
        if time.time() - started > budget_seconds:
            break
        cap = None
        try:
            fast = yf.Ticker(ticker).fast_info
            try:
                cap = to_number(fast["marketCap"])
            except Exception:
                cap = to_number(getattr(fast, "market_cap", None))
        except Exception as exc:
            print(f"시가총액 조회 실패 {ticker}: {exc}")
        if cap and cap > 0:
            caps[ticker] = {"v": cap, "t": datetime.now(KST).date().isoformat()}
            updated += 1
    print(f"시가총액 갱신: {updated}개 (보유 {len(caps)}개)")
    return caps
def fetch_coins(previous):
    """CoinGecko(무료·키 불필요)에서 시총 상위 10개 코인."""
    try:
        url = (
            "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd"
            "&order=market_cap_desc&per_page=10&page=1&sparkline=true"
            "&price_change_percentage=24h"
        )
        request = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.load(response)
        coins = []
        for item in payload[:10]:
            symbol = str(item.get("symbol", "")).upper()
            if not symbol:
                continue
            spark_all = (item.get("sparkline_in_7d") or {}).get("price") or []
            step = max(1, len(spark_all) // 30)
            spark = [round(float(v), 6) for v in spark_all[::step][-30:]]
            coins.append({
                "ticker": f"{symbol}-USD",
                "display": symbol,
                "name": item.get("name") or symbol,
                "kind": "coin",
                "rank": item.get("market_cap_rank"),
                "price": to_number(item.get("current_price")),
                "change_pct": to_number(item.get("price_change_percentage_24h")),
                "market_cap": to_number(item.get("market_cap")),
                "volume": to_number(item.get("total_volume")),
                "spark": spark,
            })
        if coins:
            return coins
    except Exception as exc:
        print(f"코인 목록 조회 실패: {exc}")
    return previous if isinstance(previous, list) else []
ET = ZoneInfo("America/New_York")
def is_scan_time(now_et):
    """scan.py와 같은 기준: 미국 동부시간 평일 08:40~09:25."""
    if now_et.weekday() >= 5:
        return False
    minutes = now_et.hour * 60 + now_et.minute
    return 8 * 60 + 40 <= minutes <= 9 * 60 + 25
def main():
    if os.getenv("FORCE_SCAN", "0") != "1" and not is_scan_time(datetime.now(ET)):
        print("예약 실행 시간이 아니므로 건너뜁니다.")
        return
    old = read_json(UNIVERSE_FILE, {})
    budget = float(os.getenv("MARKET_CAP_BUDGET", "240"))
    table = sp500_table()
    tickers = list(table)
    print(f"S&P 500 종목 {len(tickers)}개")
    stocks = {}
    shards = {}
    for start in range(0, len(tickers), 50):
        chunk = tickers[start:start + 50]
        frames = download_chunk(chunk)
        for ticker, frame in frames.items():
            stocks[ticker] = summarize(frame)
            shards.setdefault(
                ticker[0] if ticker[0].isalpha() else "_", {}
            )[ticker] = to_columns(frame)
        print(f"  {min(start + 50, len(tickers))}/{len(tickers)} 완료")
        time.sleep(1)
    if len(stocks) < 100:
        raise RuntimeError("가격 데이터를 충분히 받지 못했습니다. 기존 파일을 유지합니다.")
    old_caps = old.get("market_caps", {}) if isinstance(old, dict) else {}
    caps = fetch_market_caps(list(stocks), old_caps, budget)
    old_by_ticker = {
        item.get("ticker"): item
        for item in (old.get("stocks", []) if isinstance(old, dict) else [])
        if isinstance(item, dict)
    }
    stock_list = []
    for ticker in tickers:
        info = table[ticker]
        summary = stocks.get(ticker)
        if summary is None:
            previous = old_by_ticker.get(ticker)
            if previous:
                stock_list.append(previous)
            continue
        stock_list.append({
            "ticker": ticker,
            "display": ticker,
            "name": info["name"],
            "kind": "stock",
            "sector": info["sector"],
            "industry": info["industry"],
            "market_cap": caps.get(ticker, {}).get("v"),
            **summary,
        })
    fund_frames = download_chunk([f[0] for f in FUNDS])
    fund_list = []
    fund_shard = {}
    for ticker, display, name, tag in FUNDS:
        frame = fund_frames.get(ticker)
        if frame is None:
            continue
        fund_shard[ticker] = to_columns(frame)
        fund_list.append({
            "ticker": ticker, "display": display, "name": name,
            "kind": "fund", "sector": tag, **summarize(frame),
        })
    coin_list = fetch_coins(old.get("coins") if isinstance(old, dict) else [])
    coin_shard = {}
    for coin in coin_list:
        frames = download_chunk([coin["ticker"]])
        frame = frames.get(coin["ticker"])
        if frame is not None:
            coin_shard[coin["ticker"]] = to_columns(frame)
    for letter, content in shards.items():
        write_json(PRICE_DIR / f"{letter}.json", content, compact=True)
    if fund_shard:
        write_json(PRICE_DIR / "_funds.json", fund_shard, compact=True)
    if coin_shard:
        write_json(PRICE_DIR / "_coins.json", coin_shard, compact=True)
    output = {
        "updated_at": datetime.now(KST).isoformat(timespec="seconds"),
        "source": "Yahoo Finance / Wikipedia / CoinGecko",
        "stocks": stock_list,
        "funds": fund_list,
        "coins": coin_list,
        "market_caps": caps,
        "meta": {
            "stocks": len(stock_list),
            "funds": len(fund_list),
            "coins": len(coin_list),
            "market_caps": len(caps),
        },
    }
    write_json(UNIVERSE_FILE, output)
    print(f"저장 완료: 종목 {len(stock_list)} · 지수/ETF {len(fund_list)} · 코인 {len(coin_list)}")
if __name__ == "__main__":
    main()
