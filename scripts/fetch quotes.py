"""5분마다 실행해 현재가 스냅샷(quotes.json)을 만든다. API 키가 필요 없다.

대상: 시장 지표(지수·금리·VIX·금·환율·비트코인·달러 인덱스),
      현재 매수 신호 종목, 전체 종목 페이지의 S&P 500·지수/ETF.
야후 일봉의 마지막 봉(장중에는 오늘 봉)을 현재가로 쓰므로 최대 15분 지연될 수 있다.
"""
import json
import time
from datetime import datetime, timezone
from pathlib import Path
import pandas as pd
import yfinance as yf
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
OUT_FILE = ROOT / "market_data" / "quotes.json"
MACRO = {
    "나스닥-100": "^NDX", "S&P 500": "^GSPC", "미국 10년물 금리": "^TNX",
    "VIX": "^VIX", "금": "GC=F", "원·달러 환율": "KRW=X",
    "비트코인": "BTC-USD", "달러 인덱스": "DX-Y.NYB",
}
CHUNK = 100
MAX_SYMBOLS = 900
def read_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}
def collect_symbols():
    symbols = list(MACRO.values())
    latest = read_json(DATA_DIR / "latest.json")
    for item in latest.get("signals", []) if isinstance(latest, dict) else []:
        if isinstance(item, dict) and item.get("ticker"):
            symbols.append(str(item["ticker"]))
    universe = read_json(DATA_DIR / "universe.json")
    if isinstance(universe, dict):
        for key in ("stocks", "funds"):
            for item in universe.get(key, []) or []:
                if isinstance(item, dict) and item.get("ticker"):
                    symbols.append(str(item["ticker"]))
    return list(dict.fromkeys(symbols))[:MAX_SYMBOLS]
def parse_frames(df, chunk):
    """yf.download 결과에서 종목별 현재가·전일 종가를 뽑는다."""
    out = {}
    if df is None or df.empty:
        return out
    multi = isinstance(df.columns, pd.MultiIndex)
    for symbol in chunk:
        try:
            sub = df[symbol] if multi else df
        except KeyError:
            continue
        if "Close" not in sub.columns:
            continue
        sub = sub.dropna(subset=["Close"])
        if sub.empty:
            continue
        last = sub.iloc[-1]
        prev = sub.iloc[-2] if len(sub) > 1 else None
        def num(value):
            return None if pd.isna(value) else round(float(value), 4)
        out[symbol] = {
            "p": num(last["Close"]),
            "pc": num(prev["Close"]) if prev is not None else None,
            "o": num(last.get("Open")), "h": num(last.get("High")), "l": num(last.get("Low")),
            "d": sub.index[-1].date().isoformat(),
        }
    return out
def main():
    symbols = collect_symbols()
    print(f"조회 대상 {len(symbols)}개")
    quotes = {}
    for start in range(0, len(symbols), CHUNK):
        chunk = symbols[start:start + CHUNK]
        try:
            df = yf.download(
                chunk if len(chunk) > 1 else chunk * 2,
                period="5d", interval="1d", auto_adjust=False,
                group_by="ticker", threads=True, progress=False,
            )
            quotes.update(parse_frames(df, chunk))
        except Exception as exc:
            print(f"일부 조회 실패: {exc}")
        time.sleep(1)
    if not quotes:
        raise RuntimeError("현재가를 하나도 받지 못했습니다.")
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "count": len(quotes),
        "quotes": quotes,
    }
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print(f"저장 완료: {len(quotes)}개 ({OUT_FILE})")
if __name__ == "__main__":
    main()
