import json
import os
import re
import time
import urllib.request
from datetime import datetime, timedelta
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
    "달러 인덱스": "DX-Y.NYB",
}
# 공포·탐욕지수: 주식(CNN)은 공식 API가 없어 비트코인 공포·탐욕지수(alternative.me)를 사용한다.
FEAR_GREED_NAME = "비트코인 공포지수"
MACRO_TOTAL = len(MACRO_SYMBOLS) + 1
# 화면의 진단 문구용 (데이터가 새 scan.py로 만들어졌는지 확인)
SCAN_VERSION = "2026-10-12.1"
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
def download(symbol, period="1y", auto_adjust=False):
    try:
        df = yf.download(
            symbol,
            period=period,
            interval="1d",
            auto_adjust=auto_adjust,
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
def download_fear_greed():
    """alternative.me의 비트코인 공포·탐욕지수(무료 공개 API, 키 불필요).

    일별 값 하나만 제공되므로 전날 값을 시가로 삼아 캔들용 행을 만든다.
    """
    try:
        request = urllib.request.Request(
            "https://api.alternative.me/fng/?limit=400&format=json",
            headers={"User-Agent": "Mozilla/5.0"}
        )
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.load(response)
        points = []
        for item in payload.get("data", []):
            value = to_number(item.get("value"))
            stamp = to_number(item.get("timestamp"))
            if value is None or stamp is None:
                continue
            date = datetime.fromtimestamp(
                int(stamp), tz=ZoneInfo("UTC")
            ).date().isoformat()
            points.append((
                date, value, str(item.get("value_classification") or "")
            ))
        points.sort()
        if len(points) < 2:
            return None
        rows = []
        previous = None
        for date, value, _ in points:
            open_value = previous if previous is not None else value
            rows.append({
                "date": date,
                "open": open_value,
                "high": max(open_value, value),
                "low": min(open_value, value),
                "close": value,
                "volume": 0
            })
            previous = value
        latest = rows[-1]
        return {
            "value": latest["close"],
            "updated_at": latest["date"],
            "source": "alternative.me (Bitcoin Fear & Greed)",
            "symbol": "FNG",
            "classification": points[-1][2]
        }, rows
    except Exception as exc:
        print(f"비트코인 공포지수 조회 실패: {exc}")
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
    fear = download_fear_greed()
    if fear is not None:
        values[FEAR_GREED_NAME], histories[FEAR_GREED_NAME] = fear
        print(f"시장 지표 수집 성공: {FEAR_GREED_NAME}")
    else:
        if FEAR_GREED_NAME in old_values:
            values[FEAR_GREED_NAME] = old_values[FEAR_GREED_NAME]
        if FEAR_GREED_NAME in old_histories:
            histories[FEAR_GREED_NAME] = old_histories[FEAR_GREED_NAME]
        print(f"시장 지표 신규 수집 실패: {FEAR_GREED_NAME}")
    count = len(values)
    if count == MACRO_TOTAL:
        state = "시장 지표 수집 완료"
        reason = f"{MACRO_TOTAL}개 지표의 데이터가 있습니다. 각 기준일을 확인하세요."
    elif count > 0:
        state = "시장 지표 일부 수집"
        reason = f"{MACRO_TOTAL}개 지표 중 {count}개 데이터를 확보했습니다."
    else:
        state = "시장 지표 수집 실패"
        reason = "시장 지표를 확보하지 못했습니다."
    return {
        "state": state,
        "reason": reason,
        "values": values
    }, histories
# =====================================================
# 웅덩이매매법 V12 (TradingView Pine 전략을 그대로 옮긴 신호 엔진)
# 4단계: 웅줍 < 강웅줍 < 급락웅줍 < 급락웅줍+
# =====================================================
TIERS = ["웅줍", "강웅줍", "급락웅줍", "급락웅줍+"]
V12 = {
    "normal_rsi": 42.0, "strong_rsi": 35.0, "crash_rsi": 33.0, "extreme_rsi": 28.0,
    "normal_bb": 0.25, "strong_bb": 0.20, "crash_bb": 0.15, "extreme_bb": -0.05,
    "near_ma20": 2.0, "near_ma50": 3.0, "near_ma100": 4.0, "near_ma200": 5.0,
    "dd_lookback": 60, "panic_drop": 14.0, "panic_rsi": 42.0, "panic_bb": 0.15,
    "normal_cooldown": 12, "add_drop": 4.0,
}
def drop_unconfirmed(df, now_et=None):
    """장중에 실행되면 아직 마감되지 않은 오늘 봉을 제외한다 (확정 봉 기준)."""
    if df is None or df.empty:
        return df
    now_et = now_et or datetime.now(ET)
    minutes = now_et.hour * 60 + now_et.minute
    if (
        now_et.weekday() < 5
        and df.index[-1].date() == now_et.date()
        and 9 * 60 + 30 <= minutes < 16 * 60 + 5
    ):
        return df.iloc[:-1]
    return df
def wilder_rsi(close, length=14):
    """Pine ta.rsi와 같은 Wilder(RMA) 방식 RSI."""
    values = [float(x) for x in close]
    n = len(values)
    out = [float("nan")] * n
    if n <= length:
        return out
    up = [0.0] * n
    down = [0.0] * n
    for i in range(1, n):
        delta = values[i] - values[i - 1]
        up[i] = delta if delta > 0 else 0.0
        down[i] = -delta if delta < 0 else 0.0
    avg_up = sum(up[1:length + 1]) / length
    avg_down = sum(down[1:length + 1]) / length
    def rsi_value(a, b):
        if b == 0:
            return 100.0
        if a == 0:
            return 0.0
        return 100 - 100 / (1 + a / b)
    out[length] = rsi_value(avg_up, avg_down)
    for i in range(length + 1, n):
        avg_up = (avg_up * (length - 1) + up[i]) / length
        avg_down = (avg_down * (length - 1) + down[i]) / length
        out[i] = rsi_value(avg_up, avg_down)
    return out
def run_v12(df, cfg=V12):
    """모든 봉에 대해 V12 매수 신호를 계산한다 (Pine과 같은 상태 변수 사용)."""
    n = len(df)
    close = df["Close"].astype(float)
    high = df["High"].astype(float).to_numpy()
    low = df["Low"].astype(float).to_numpy()
    c = close.to_numpy()
    ma = {k: close.rolling(k).mean().to_numpy() for k in (10, 20, 50, 100, 200)}
    sd = close.rolling(20).std(ddof=0).to_numpy()
    peak = close.rolling(cfg["dd_lookback"]).max().to_numpy()
    rsi = wilder_rsi(c)
    nan = float("nan")
    res = {k: [None] * n for k in ("labels", "extra")}
    res.update({"rsi": rsi, "pctb": [nan] * n, "dd": [0.0] * n, "score": [0] * n, "ma": ma})
    last_normal = None
    last_strong = None
    last_extreme = None
    armed = False
    was_below10 = False
    prev_normal_raw = False
    for i in range(n):
        ci, hi_, li = c[i], high[i], low[i]
        below = ci < ma[20][i]
        width = 4 * sd[i]
        if width != width or width == 0:        # NaN 또는 0이면 Pine처럼 0.5
            pctb, low_pctb = 0.5, 0.5
        else:
            lower = ma[20][i] - 2 * sd[i]
            pctb = (ci - lower) / width
            low_pctb = (li - lower) / width
        score = 0
        for k, key, tol in ((20, "near_ma20", 1), (50, "near_ma50", 2), (100, "near_ma100", 3), (200, "near_ma200", 4)):
            m = ma[k][i]
            if m == m and abs(ci - m) / m * 100 <= cfg[key]:
                score = tol
                break
        p = peak[i]
        dd = (p - ci) / p * 100 if p == p and p > 0 else 0.0
        low_dd = (p - li) / p * 100 if p == p and p > 0 else 0.0
        rebound = (ci - li) / li * 100 if li > 0 else 0.0
        r = rsi[i]
        res["pctb"][i], res["dd"][i], res["score"][i] = pctb, dd, score
        panic = low_dd >= cfg["panic_drop"] and low_pctb <= cfg["panic_bb"] and r <= cfg["panic_rsi"] and below and rebound >= 0.5
        classic = dd >= 17 and r <= cfg["crash_rsi"] and pctb <= cfg["crash_bb"] and below
        normal_raw = below and score >= 1 and r <= cfg["normal_rsi"] and pctb <= cfg["normal_bb"]
        strong_raw = below and score >= 1 and r <= cfg["strong_rsi"] and pctb <= cfg["strong_bb"]
        crash_raw = classic or panic
        extreme_raw = dd >= 23 and r <= cfg["extreme_rsi"] and pctb <= cfg["extreme_bb"] and below
        # 웅줍: 첫 신호 + 최소 12봉 간격
        normal_entry = normal_raw and not prev_normal_raw and (last_normal is None or i - last_normal >= cfg["normal_cooldown"])
        if normal_entry:
            last_normal = i
        # 강웅줍: 첫 신호, 이후 직전 신호가 대비 4% 추가 하락
        factor = 1 - cfg["add_drop"] / 100
        strong_first = strong_raw and last_strong is None
        strong_add = strong_raw and last_strong is not None and ci <= last_strong * factor
        strong_entry = strong_first or strong_add
        if strong_entry:
            last_strong = ci
        if ci > ma[20][i]:
            last_strong = None
        # 급락웅줍: 첫 신호, 이후 MA10 아래로 내려갔다가 MA10 상향 돌파하면 재신호
        crash_first = crash_raw and not armed
        if armed and ci < ma[10][i]:
            was_below10 = True
        cross = i > 0 and ci > ma[10][i] and c[i - 1] <= ma[10][i - 1]
        crash_add = armed and was_below10 and cross
        crash_entry = crash_first or crash_add
        if crash_first:
            armed, was_below10 = True, False
        if crash_add:
            was_below10 = False
        if ci > ma[20][i] and r > 50:
            armed, was_below10 = False, False
        # 급락웅줍+
        ext_first = extreme_raw and last_extreme is None
        ext_add = extreme_raw and last_extreme is not None and ci <= last_extreme * factor
        extreme_entry = ext_first or ext_add
        if extreme_entry:
            last_extreme = ci
        if ci > ma[20][i] and r > 50:
            last_extreme = None
        prev_normal_raw = normal_raw
        fired = [t for t, f in zip(TIERS, (normal_entry, strong_entry, crash_entry, extreme_entry)) if f]
        res["labels"][i] = fired[-1] if fired else None
        res["extra"][i] = {
            "fired": fired, "panic_only": bool(panic and not classic),
            "classic": bool(classic), "crash_first": bool(crash_first),
            "strong_add": bool(strong_add), "crash_add": bool(crash_add), "extreme_add": bool(ext_add),
            "low_dd": low_dd,
        }
    return res
def _reasons(res, i, label):
    """신호가 발동한 이유(조건 값)를 사람이 읽을 문장으로 만든다."""
    cfg = V12
    r, b, dd, ex = res["rsi"][i], res["pctb"][i], res["dd"][i], res["extra"][i]
    out = []
    if label == "웅줍":
        out += [f"RSI {r:.1f} ≤ {cfg['normal_rsi']:.0f}", f"BB %B {b:.2f} ≤ {cfg['normal_bb']}"]
    elif label == "강웅줍":
        out += [f"RSI {r:.1f} ≤ {cfg['strong_rsi']:.0f}", f"BB %B {b:.2f} ≤ {cfg['strong_bb']}"]
        if ex["strong_add"]:
            out.append("직전 신호가 대비 4% 추가 하락")
    elif label == "급락웅줍":
        if ex["crash_first"] and ex["classic"]:
            out += [f"60일 고점 대비 -{dd:.1f}% (≥17%)", f"RSI {r:.1f} ≤ {cfg['crash_rsi']:.0f}", f"BB %B {b:.2f} ≤ {cfg['crash_bb']}"]
        elif ex["crash_first"]:
            out += [f"패닉 저점: 저가 낙폭 {ex['low_dd']:.1f}% ≥ {cfg['panic_drop']:.0f}%", f"RSI {r:.1f} ≤ {cfg['panic_rsi']:.0f}"]
        elif ex["crash_add"]:
            out.append("첫 급락웅줍 이후 MA10 아래로 내려갔다가 MA10 상향 돌파(재신호)")
    elif label == "급락웅줍+":
        out += [f"60일 고점 대비 -{dd:.1f}% (≥23%)", f"RSI {r:.1f} ≤ {cfg['extreme_rsi']:.0f}", f"BB %B {b:.2f} ≤ {cfg['extreme_bb']}"]
        if ex["extreme_add"]:
            out.append("직전 신호가 대비 4% 추가 하락")
    if label in ("웅줍", "강웅줍"):
        names = {1: "MA20", 2: "MA50", 3: "MA100", 4: "MA200"}
        out.append(f"{names.get(res['score'][i], 'MA')} 근접")
    return out
def latest_signal(df, res):
    """마지막(확정) 봉에서 V12 매수 신호가 발동했다면 화면용 딕셔너리를 돌려준다."""
    if df is None or len(df) < 61:
        return None
    i = len(df) - 1
    label = res["labels"][i]
    r = res["rsi"][i]
    if label is None or r != r:
        return None
    ma = res["ma"]
    volume20 = df["Volume"].rolling(20).mean().iloc[i]
    volume = df["Volume"].iloc[i]
    def m(k):
        v = ma[k][i]
        return round(float(v), 2) if v == v else None
    return {
        "signal": label,
        "tiers": res["extra"][i]["fired"],
        "date": df.index[i].date().isoformat(),
        "close": round(float(df["Close"].iloc[i]), 2),
        "rsi14": round(float(r), 2),
        "drawdown": round(-res["dd"][i], 2),
        "drawdown60_pct": round(-res["dd"][i], 2),
        "percent_b": round(float(res["pctb"][i]), 3),
        "ma10": m(10), "ma20": m(20), "ma50": m(50), "ma100": m(100), "ma200": m(200),
        "reasons": _reasons(res, i, label),
        "rule": "웅덩이매매법 V12",
        "volume": 0 if pd.isna(volume) else int(volume),
        "avg_volume20": round(float(volume20), 0) if not pd.isna(volume20) else None,
    }
def past_signal_cases(df, res, signal, horizons=(3, 5, 10, 20), limit=20):
    """같은 단계의 V12 신호가 과거에 발동했을 때 다음날 시가에 샀다면? (최근 limit건)"""
    if df is None or len(df) < 61:
        return None
    n = len(df)
    idxs = [i for i in range(n - 1) if res["labels"][i] == signal]   # 현재 봉은 제외
    opens = df["Open"].astype(float)
    closes = df["Close"].astype(float)
    cases = []
    for i in idxs:
        entry = i + 1
        entry_price = float(opens.iloc[entry])
        if pd.isna(entry_price) or entry_price <= 0:
            continue
        returns = {}
        for days in horizons:
            exit_index = entry + days
            returns[str(days)] = (
                round((float(closes.iloc[exit_index]) / entry_price - 1) * 100, 2)
                if exit_index < n else None
            )
        cases.append({
            "date": df.index[i].date().isoformat(),
            "entry_date": df.index[entry].date().isoformat(),
            "entry_price": round(entry_price, 2),
            "returns": returns,
        })
    return {"signal": signal, "years": 3, "total": len(idxs), "cases": list(reversed(cases[-limit:]))}
def get_company_name(ticker):
    # 개별 종목마다 추가 API를 호출하지 않도록 ticker를 기본 이름으로 사용
    return ticker
_INFO_CACHE = {}
def fetch_info(ticker):
    """yfinance 종목 정보를 한 번만 조회해 재사용한다. 실패하면 빈 딕셔너리."""
    if ticker in _INFO_CACHE:
        return _INFO_CACHE[ticker]
    info = {}
    for attempt in range(3):
        try:
            info = yf.Ticker(ticker).info or {}
            if isinstance(info, dict) and info:
                break
        except Exception as exc:
            print(f"종목 정보 조회 실패 {ticker} (시도 {attempt + 1}/3): {exc}")
        time.sleep(1.5 * (attempt + 1))
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
_BUY_RATINGS = {
    "buy", "strong buy", "outperform", "overweight", "positive",
    "market outperform", "sector outperform", "accumulate", "add",
    "long term buy", "top pick", "conviction buy", "moderate buy",
    "speculative buy", "trading buy", "recommended list",
}
_HOLD_RATINGS = {
    "hold", "neutral", "market perform", "equal weight", "equalweight",
    "sector perform", "in line", "peer perform", "perform",
    "sector weight", "mixed", "fair value",
}
_SELL_RATINGS = {
    "sell", "strong sell", "underperform", "underweight", "reduce",
    "negative", "market underperform", "sector underperform",
}
def _rating_bucket(grade):
    """증권사 등급 문구를 buy / hold / sell 중 하나로 분류한다. 모르면 None."""
    if not isinstance(grade, str):
        return None
    text = re.sub(r"\s+", " ", re.sub(r"[-_/]", " ", grade.lower())).strip()
    if text in _BUY_RATINGS:
        return "buy"
    if text in _HOLD_RATINGS:
        return "hold"
    if text in _SELL_RATINGS:
        return "sell"
    return None
def _yahoo_consensus(stock, info):
    """증권사별 1년 이내 기록이 없을 때만 쓰는 야후 컨센서스(대체 수단)."""
    summary = {}
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
        print(f"투자의견 요약 조회 실패: {exc}")
    try:
        targets = stock.analyst_price_targets
        if isinstance(targets, dict):
            for key, source in (
                ("targetMean", "mean"), ("targetLow", "low"),
                ("targetHigh", "high"),
            ):
                value = to_number(targets.get(source))
                if value is not None and value > 0:
                    summary[key] = round(value, 2)
    except Exception as exc:
        print(f"목표가 조회 실패: {exc}")
    count = to_number(info.get("numberOfAnalystOpinions"))
    if count is not None and count > 0:
        summary["numberAnalysts"] = int(count)
    for key, source in (
        ("targetMean", "targetMeanPrice"), ("targetLow", "targetLowPrice"),
        ("targetHigh", "targetHighPrice"),
    ):
        if key not in summary:
            value = to_number(info.get(source))
            if value is not None and value > 0:
                summary[key] = round(value, 2)
    return summary
def get_analyst_info(tickers, old_info):
    """신호가 발생한 종목의 애널리스트 의견을 '현재 날짜 기준 최근 1년 이내'만 종합한다.

    증권사마다 1년 이내 가장 최근 의견 1건만 사용해 Buy/Hold/Sell 인원과
    평균·최저·최고 목표가를 직접 계산한다. 표시용 정보이며 신호 계산에는 영향이 없다.
    조회에 실패하면 이전에 저장된 값을 그대로 유지한다.
    """
    result = {}
    if isinstance(old_info, dict):
        for ticker, value in old_info.items():
            if isinstance(value, dict):
                result[ticker] = value
    today_date = datetime.now(KST).date()
    today = today_date.isoformat()
    cutoff = (today_date - timedelta(days=365)).isoformat()
    stats = {"attempted": 0, "ok": 0, "failed": []}
    for ticker in tickers:
        stats["attempted"] += 1
        time.sleep(0.3)
        stock = yf.Ticker(ticker)
        brokers = []
        try:
            changes = stock.upgrades_downgrades
            if changes is not None and not changes.empty:
                changes = changes.sort_index(ascending=False)
                seen = set()
                for date, row in changes.iterrows():
                    date_iso = (
                        date.date().isoformat()
                        if hasattr(date, "date") else str(date)[:10]
                    )
                    if date_iso < cutoff:
                        break
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
                    entry = {"firm": firm, "rating": rating, "date": date_iso}
                    action = row.get("Action")
                    if isinstance(action, str) and action.strip():
                        entry["action"] = action.strip()
                    target = to_number(row.get("currentPriceTarget"))
                    if target is not None and target > 0:
                        entry["target_price"] = round(target, 2)
                    brokers.append(entry)
                    if len(brokers) >= 60:
                        break
        except Exception as exc:
            print(f"증권사별 의견 조회 실패 {ticker}: {exc}")
        summary = {}
        source = "upgrades_downgrades"
        counts = {"buy": 0, "hold": 0, "sell": 0}
        targets = []
        for entry in brokers:
            bucket = _rating_bucket(entry["rating"])
            if bucket:
                counts[bucket] += 1
            if entry.get("target_price"):
                targets.append(entry["target_price"])
        if sum(counts.values()) > 0:
            summary.update(counts)
        if targets:
            summary["targetMean"] = round(sum(targets) / len(targets), 2)
            summary["targetLow"] = min(targets)
            summary["targetHigh"] = max(targets)
        if brokers:
            summary["numberAnalysts"] = len(brokers)
        if not summary:
            summary = _yahoo_consensus(stock, fetch_info(ticker))
            source = "yahoo_consensus"
        if summary or brokers:
            result[ticker] = {
                "updated_at": today,
                "window_days": 365,
                "source": source,
                "summary": summary,
                "brokers": brokers,
            }
            stats["ok"] += 1
        else:
            stats["failed"].append(ticker)
            print(f"애널리스트 데이터 없음: {ticker}")
    print(f"애널리스트 수집: {stats['ok']}/{stats['attempted']}")
    return result, stats
def main():
    now_et = datetime.now(ET)
    force = os.getenv("FORCE_SCAN", "0") == "1"
    if not force and not is_scan_time(now_et):
        print(f"예약 실행 시간이 아니므로 건너뜁니다: {now_et}")
        return
    old_data = read_json(LATEST_FILE, {})
    tickers, is_full_nasdaq100 = get_tickers()
    signals = []
    signal_cases = {}
    price_history = {}
    failures = 0
    for index, ticker in enumerate(tickers, start=1):
        print(f"[{index}/{len(tickers)}] {ticker}")
        df = drop_unconfirmed(download(ticker, "3y"))
        if df is None or df.empty:
            failures += 1
            print(f"주가 데이터 없음: {ticker}")
            # 일시적인 실패라면 이전 가격 이력을 보존
            old_prices = old_data.get("price_history", {}).get(ticker)
            if isinstance(old_prices, list) and old_prices:
                price_history[ticker] = old_prices
            continue
        price_history[ticker] = serialise_prices(df.tail(252))
        engine = run_v12(df) if len(df) >= 61 else None
        result = latest_signal(df, engine) if engine else None
        if result is not None:
            signals.append({
                "ticker": ticker,
                "name": get_company_name(ticker),
                **result
            })
            cases = past_signal_cases(df, engine, result["signal"])
            if cases is not None:
                signal_cases[ticker] = cases
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
    analyst_info, analyst_stats = get_analyst_info(
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
        "signal_cases": signal_cases,
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
            "analyst": analyst_stats,
            "version": SCAN_VERSION,
            "rule": "웅덩이매매법 V12",
            "cases": {
                "attempted": len(signals),
                "ok": len(signal_cases),
            },
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
    print(f"시장 지표: {len(macro['values'])}/{MACRO_TOTAL}")
    print(f"전체 나스닥-100 목록: {is_full_nasdaq100}")
    print(f"저장 파일: {LATEST_FILE}")
    print("================================")
if __name__ == "__main__":
    main()
