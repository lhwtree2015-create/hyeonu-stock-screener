"""미국 정부윤리청(OGE) 공개 문서에서 트럼프 대통령의 주기적 거래 보고서(OGE Form 278-T)를 읽어 data/trump.json 으로 저장한다.

주의: 278-T는 스캔 PDF에 OCR 글자층이 붙은 문서라 글자 인식 오류가 있을 수 있습니다.
인식 가능한 행만 저장하며, 모든 행에 원문 PDF 링크를 남깁니다. 투자 판단의 근거로 쓰기 전에
반드시 원문을 확인하세요.

공시 PDF 주소는 아래 SEED_URLS, data/oge_sources.txt(한 줄에 URL 하나, # 주석 가능),
그리고 OGE 목록 페이지에서 자동으로 찾은 링크를 합쳐 사용합니다.
"""
import difflib
import io
import json
import re
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
OUTPUT_FILE = DATA_DIR / "trump.json"
SOURCES_FILE = DATA_DIR / "oge_sources.txt"
UNIVERSE_FILE = DATA_DIR / "universe.json"
KST = ZoneInfo("Asia/Seoul")
UA = "Mozilla/5.0 (HyeonuStockScreener)"
SEED_URLS = [
    "https://extapps2.oge.gov/201/Presiden.nsf/PAS+Index/AC43530823BD60D485258E27002DDEF7/$FILE/Donald-J-Trump-06.25.2026-278T.pdf",
    "https://extapps2.oge.gov/201/Presiden.nsf/PAS+Index/BCF60D94B8F1E59285258DB000347F61/%24FILE/Donald%20J.%20Trump%202.26.2026%20278-T%20(2).pdf",
    "https://www.whitehouse.gov/wp-content/uploads/2025/11/President-Donald-J.-Trump-Periodic-Transaction-Report-11.14.25.pdf",
    "https://extapps2.oge.gov/201/Presiden.nsf/PAS+Index/18353894FE440B3685258D430031A337/$FILE/Donald J. Trump 10.20.2025 278-T (2).pdf",
    "https://extapps2.oge.gov/201/Presiden.nsf/PAS+Index/2C89623DC721F62585258D430031A32A/$FILE/Donald J. Trump 10.20.2025 278-T.pdf",
    "https://extapps2.oge.gov/201/Presiden.nsf/PAS+Index/AA799A2729B4D1BE85258D430031A320/$FILE/Donald J. Trump 10.17.2025 278-T.pdf",
]
INDEX_PAGES = [
    "https://extapps2.oge.gov/201/Presiden.nsf/PAS+Index?OpenForm",
    "https://extapps2.oge.gov/201/Presiden.nsf/PAS+Index?OpenView&Count=500",
]
# OGE 신고 금액 구간 (하한, 상한)
BUCKETS = [
    (1001, 15000), (15001, 50000), (50001, 100000), (100001, 250000),
    (250001, 500000), (500001, 1000000), (1000001, 5000000),
    (5000001, 25000000), (25000001, 50000000),
]
ROW = re.compile(
    r"^\s*(?:(?P<num>\d{1,4})\s+)?(?:(?:YES|NO)\s+)?(?P<desc>.+?)\s+"
    r"(?P<type>\S*(?:urch|ourch)\S*|\S*sale\S*|sold|\S*xchang\S*)\s+"
    r"(?P<date>\d{1,2}/\d{1,2}[/1]?\d{4})(?P<rest>.*)$",
    re.IGNORECASE,
)
AMOUNT = re.compile(r"\$\s*([\d][\d,\. ]*)\s*[-–—•~]\s*\$?\s*([\d][\d,\. ]*)")
RECEIVED = re.compile(r"OGE\s+RECEIVED\s*:?\s*(\d{1,2}/\d{1,2}/\d{4})", re.IGNORECASE)
STOP_WORDS = {
    "INC", "INCORPORATED", "CORP", "CORPORATION", "CO", "COMPANY", "COM", "LTD",
    "PLC", "HOLDINGS", "HLDGS", "GROUP", "CL", "CLASS", "A", "B", "C", "THE",
    "NV", "SA", "LP", "ORD", "SHS", "COMMON", "STOCK", "NEW", "AND",
}
EXPAND = {
    "LABS": "LABORATORIES", "FINL": "FINANCIAL", "INTL": "INTERNATIONAL",
    "MFG": "MANUFACTURING", "TECH": "TECHNOLOGY", "SYS": "SYSTEMS",
    "ENERGY": "ENERGY", "PHARMACEUTICALS": "PHARMACEUTICALS",
}
def read_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default
def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    with open(temp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    temp.replace(path)
def http_get(url, timeout=60):
    safe_url = urllib.parse.quote(url, safe=":/%$&()=?+,;@'~!*-._#")
    request = urllib.request.Request(safe_url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()
def normalize_date(token):
    match = re.match(r"^(\d{1,2})/(\d{1,2})[/1]?(\d{4})$", token)
    if not match:
        return None
    month, day, year = (int(x) for x in match.groups())
    if not (1 <= month <= 12 and 1 <= day <= 31 and 2015 <= year <= 2035):
        return None
    try:
        return datetime(year, month, day).date().isoformat()
    except ValueError:
        return None
def classify_type(token):
    text = token.lower()
    if "urch" in text:
        return "buy"
    if "sale" in text or text == "sold":
        return "sell"
    if "xchang" in text:
        return "exchange"
    return None
def snap_amount(rest):
    """OCR로 흐트러진 금액 문구를 OGE 공식 금액 구간으로 맞춘다."""
    match = AMOUNT.search(rest)
    if not match:
        return None, None
    low_digits = re.sub(r"\D", "", match.group(1))
    if not low_digits:
        return None, None
    low = int(low_digits)
    if low > 50_000_000:
        return 50_000_001, None
    best = min(BUCKETS, key=lambda b: abs(b[0] - low) / max(b[0], 1))
    if abs(best[0] - low) / best[0] > 0.2:
        return None, None
    return best
def asset_kind(description):
    text = description.upper()
    if re.search(r"\b(ETF|ETN)\b|ISHARES|SPDR|VANGUARD|INVESCO|PROSHARES|SELECT SECTOR", text):
        return "etf"
    if re.search(r"\bDUE\b|\bDTD\b|\bNT\b|\bNOTE|\bBOND|\bBD\b|\bREV\b|\bTREAS|\bPERP|\d+(\.\d+)?\s*%", text):
        return "bond"
    return "stock"
def normalize_name(name):
    text = re.sub(r"[^A-Z0-9 ]", " ", name.upper().replace("&", " AND "))
    tokens = [EXPAND.get(t, t) for t in text.split() if t not in STOP_WORDS]
    return " ".join(tokens)
def build_name_index(stocks):
    index = {}
    for item in stocks:
        if isinstance(item, dict) and item.get("ticker") and item.get("name"):
            index[normalize_name(item["name"])] = item["ticker"]
    return index
def match_ticker(description, index):
    target = normalize_name(description)
    if not target:
        return None
    if target in index:
        return index[target]
    best, best_ratio = None, 0.0
    for name, ticker in index.items():
        ratio = difflib.SequenceMatcher(None, target, name).ratio()
        prefix = (
            len(min(target, name, key=len).split()) >= 2
            and (target.startswith(name) or name.startswith(target))
        )
        if prefix:
            ratio = max(ratio, 0.9)
        if ratio > best_ratio:
            best, best_ratio = ticker, ratio
    return best if best_ratio >= 0.88 else None
def parse_text(text, name_index):
    """PDF 글자층 → (접수일, 거래 목록, 통계)"""
    received = None
    match = RECEIVED.search(text)
    if match:
        month, day, year = (int(x) for x in match.group(1).split("/"))
        try:
            received = datetime(year, month, day).date().isoformat()
        except ValueError:
            received = None
    rows = []
    candidates = 0
    for line in text.splitlines():
        if re.search(r"urch|sale|xchang", line, re.IGNORECASE) and re.search(r"\d/\d", line):
            candidates += 1
        match = ROW.match(line)
        if not match:
            continue
        kind = classify_type(match.group("type"))
        date = normalize_date(match.group("date"))
        description = re.sub(r"\s+", " ", match.group("desc")).strip(" -")
        if not kind or not date or len(description) < 3:
            continue
        low, high = snap_amount(match.group("rest"))
        asset = asset_kind(description)
        rows.append({
            "date": date,
            "name": description,
            "ticker": match_ticker(description, name_index) if asset == "stock" else None,
            "type": kind,
            "asset": asset,
            "amount_min": low,
            "amount_max": high,
        })
    return received, rows, {"candidate_lines": candidates, "parsed_rows": len(rows)}
def extract_pdf_text(data):
    try:
        import pdfplumber
    except ImportError as exc:
        raise RuntimeError("pdfplumber가 설치되어 있지 않습니다.") from exc
    pages = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages:
            pages.append(page.extract_text() or "")
    return "\n".join(pages)
def discover_urls():
    """OGE 목록 페이지에서 트럼프 278-T PDF 링크를 찾아본다 (실패해도 무시)."""
    found = []
    for page in INDEX_PAGES:
        try:
            html = http_get(page, timeout=30).decode("utf-8", "ignore")
        except Exception as exc:
            print(f"목록 페이지 조회 실패: {page} ({exc})")
            continue
        for href in re.findall(r'href="([^"]+\.pdf)"', html, re.IGNORECASE):
            if re.search(r"trump", href, re.IGNORECASE) and "278" in href:
                found.append(urllib.parse.urljoin(page, href))
    return found
def load_sources():
    urls = list(SEED_URLS)
    try:
        for line in SOURCES_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                urls.append(line)
    except OSError:
        pass
    urls += discover_urls()
    return list(dict.fromkeys(urls))
def build_summary(transactions, reports):
    if not reports:
        return {}
    latest = max(reports, key=lambda r: r.get("received_date") or "")
    in_latest = [
        t for t in transactions
        if t["source_url"] == latest["url"] and t["asset"] != "bond"
    ]
    sums = [t["amount_min"] for t in in_latest if t["amount_min"]]
    maxes = [t["amount_max"] for t in in_latest if t["amount_max"]]
    return {
        "latest_received": latest.get("received_date"),
        "latest_report_url": latest["url"],
        "latest_trade_count": len(in_latest),
        "latest_buy": sum(t["type"] == "buy" for t in in_latest),
        "latest_sell": sum(t["type"] == "sell" for t in in_latest),
        "amount_min_sum": sum(sums) if sums else None,
        "amount_max_sum": sum(maxes) if maxes and len(maxes) == len(in_latest) else None,
        "amount_known": len(sums),
    }
def main():
    universe = read_json(UNIVERSE_FILE, {})
    name_index = build_name_index(universe.get("stocks", []) if isinstance(universe, dict) else [])
    transactions, reports, errors = [], [], []
    for url in load_sources():
        try:
            text = extract_pdf_text(http_get(url))
            received, rows, stats = parse_text(text, name_index)
            if not rows:
                raise RuntimeError(f"거래 행을 읽지 못했습니다 (후보 {stats['candidate_lines']}줄)")
            label = url.rsplit("/", 1)[-1]
            reports.append({
                "url": url, "label": urllib.parse.unquote(label),
                "received_date": received, **stats,
            })
            for row in rows:
                transactions.append({**row, "received_date": received, "source_url": url})
            print(f"OK  {label}: {stats['parsed_rows']}행 (후보 {stats['candidate_lines']})")
        except Exception as exc:
            errors.append(f"{url.rsplit('/', 1)[-1]}: {exc}")
            print(f"실패 {url}: {exc}")
    if not transactions:
        previous = read_json(OUTPUT_FILE, None)
        if previous:
            previous.setdefault("meta", {})["errors"] = errors
            write_json(OUTPUT_FILE, previous)
            print("새로 읽은 거래가 없어 기존 파일을 유지합니다.")
            return
        print("거래를 하나도 읽지 못했습니다. 빈 결과를 저장합니다.")
    seen, unique = set(), []
    for t in sorted(transactions, key=lambda x: (x["date"], x["name"]), reverse=True):
        key = (t["date"], t["name"], t["type"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(t)
    output = {
        "updated_at": datetime.now(KST).isoformat(timespec="seconds"),
        "source": "U.S. Office of Government Ethics (OGE Form 278-T)",
        "person": {"name": "Donald J. Trump", "title": "미국 제45·47대 대통령"},
        "search_url": "https://extapps2.oge.gov/201/Presiden.nsf/PAS+Index",
        "reports": sorted(reports, key=lambda r: r.get("received_date") or "", reverse=True),
        "transactions": unique[:1500],
        "summary": build_summary(unique, reports),
        "meta": {
            "errors": errors,
            "note": "스캔 PDF의 OCR 글자층을 읽은 결과라 인식 오류가 있을 수 있습니다. 원문을 확인하세요.",
        },
    }
    write_json(OUTPUT_FILE, output)
    print(f"저장 완료: 거래 {len(unique)}건 · 문서 {len(reports)}건 · 오류 {len(errors)}건")
if __name__ == "__main__":
    main()
