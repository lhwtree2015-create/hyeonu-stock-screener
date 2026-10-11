"""SEC EDGAR 13F-HR 공시에서 주요 기관의 포트폴리오를 정리해 data/13f.json 으로 저장한다.

- 제출 목록:  https://data.sec.gov/submissions/CIK##########.json
- 보유 내역:  각 공시의 Information Table(XML)
- CUSIP→티커: OpenFIGI(무료, 키 불필요) 결과를 data/cusip_map.json 에 캐시
SEC는 요청 시 연락처가 있는 User-Agent를 요구합니다. 저장소 변수 SEC_USER_AGENT 를
"이름 이메일" 형식으로 설정하는 것을 권장합니다.
"""
import json
import os
import re
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
OUTPUT_FILE = DATA_DIR / "13f.json"
CUSIP_FILE = DATA_DIR / "cusip_map.json"
KST = ZoneInfo("Asia/Seoul")
UA = os.getenv("SEC_USER_AGENT") or (
    "HyeonuStockScreener github-actions@users.noreply.github.com"
)
KEEP_PERIODS = 4
TOP_HOLDINGS = 30
TOP_CHANGES = 40
# (CIK, 영문명 확인용 키워드, 표시명, 한글명, 유형)
INSTITUTIONS = [
    ("1067983", "berkshire", "Berkshire Hathaway", "버크셔 해서웨이", "지주회사·투자"),
    ("1350694", "bridgewater", "Bridgewater Associates", "브리지워터", "헤지펀드"),
    ("1649339", "scion", "Scion Asset Management", "사이언 (마이클 버리)", "헤지펀드"),
    ("1336528", "pershing", "Pershing Square", "퍼싱 스퀘어", "헤지펀드"),
    ("1029160", "soros", "Soros Fund Management", "소로스 펀드", "패밀리오피스"),
    ("1037389", "renaissance", "Renaissance Technologies", "르네상스 테크놀로지스", "퀀트 헤지펀드"),
    ("1423053", "citadel", "Citadel Advisors", "시타델", "헤지펀드"),
    ("1167483", "tiger global", "Tiger Global Management", "타이거 글로벌", "헤지펀드"),
    ("1656456", "appaloosa", "Appaloosa", "애팔루사", "헤지펀드"),
    ("1040273", "third point", "Third Point", "서드 포인트", "헤지펀드"),
    ("1536411", "duquesne", "Duquesne Family Office", "듀케인 패밀리 오피스", "패밀리오피스"),
    ("1709323", "himalaya", "Himalaya Capital", "히말라야 캐피탈", "자산운용사"),
    ("1061768", "baupost", "Baupost Group", "바우포스트", "헤지펀드"),
    ("1079114", "greenlight", "Greenlight Capital", "그린라이트", "헤지펀드"),
    ("1135730", "coatue", "Coatue Management", "코튜", "헤지펀드"),
    ("1103804", "viking", "Viking Global Investors", "바이킹 글로벌", "헤지펀드"),
    ("1603466", "point72", "Point72 Asset Management", "포인트72", "헤지펀드"),
    ("1009207", "shaw", "D. E. Shaw & Co.", "디이쇼", "퀀트 헤지펀드"),
    ("1179392", "two sigma", "Two Sigma Investments", "투 시그마", "퀀트 헤지펀드"),
    ("1791786", "elliott", "Elliott Investment Management", "엘리엇", "행동주의 헤지펀드"),
    ("1697748", "ark invest", "ARK Investment Management", "아크 인베스트", "자산운용사"),
    ("1061165", "lone pine", "Lone Pine Capital", "론 파인", "헤지펀드"),
]
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
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    temp.replace(path)
def sec_get(url):
    """SEC 요청 (초당 10회 제한을 지키도록 간격을 둔다)."""
    last_error = None
    for attempt in range(3):
        try:
            time.sleep(0.2)
            request = urllib.request.Request(
                url, headers={"User-Agent": UA, "Accept-Encoding": "identity"}
            )
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.read()
        except Exception as exc:
            last_error = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"SEC 요청 실패: {url} ({last_error})")
def list_periods(cik):
    """제출 목록에서 분기(reportDate)별 13F-HR 정보를 최신순으로 돌려준다."""
    data = json.loads(sec_get(f"https://data.sec.gov/submissions/CIK{int(cik):010d}.json"))
    recent = data.get("filings", {}).get("recent", {})
    forms = recent.get("form", [])
    periods = {}
    for i, form in enumerate(forms):
        if form not in ("13F-HR", "13F-HR/A"):
            continue
        report = recent["reportDate"][i]
        entry = {
            "form": form,
            "accession": recent["accessionNumber"][i],
            "filing_date": recent["filingDate"][i],
            "report_date": report,
        }
        period = periods.setdefault(report, {"original": None, "amendments": []})
        if form == "13F-HR":
            if period["original"] is None or entry["filing_date"] < period["original"]["filing_date"]:
                period["original"] = entry
        else:
            period["amendments"].append(entry)
    result = []
    for report in sorted(periods, reverse=True):
        period = periods[report]
        base = period["original"] or (
            sorted(period["amendments"], key=lambda e: e["filing_date"])[0]
            if period["amendments"] else None
        )
        if base is None:
            continue
        amendments = sorted(period["amendments"], key=lambda e: e["filing_date"])
        result.append({
            **base,
            "amended": bool(amendments),
            "amendment_date": amendments[-1]["filing_date"] if amendments else None,
        })
    return data.get("name", ""), result
def local(tag):
    return tag.rsplit("}", 1)[-1]
def parse_info_table(xml_bytes, filing_date):
    """Information Table XML → {cusip: {name, value, shares}} (옵션 행은 제외)."""
    root = ET.fromstring(xml_bytes)
    multiplier = 1 if filing_date >= "2023-01-03" else 1000
    holdings = {}
    for elem in root.iter():
        if local(elem.tag) != "infoTable":
            continue
        fields = {}
        for child in elem.iter():
            name = local(child.tag)
            if name not in fields and (child.text or "").strip():
                fields[name] = child.text.strip()
        if fields.get("putCall"):
            continue
        cusip = fields.get("cusip", "").upper()
        try:
            value = int(float(fields.get("value", "0"))) * multiplier
        except ValueError:
            continue
        if not cusip or value <= 0:
            continue
        shares = None
        if fields.get("sshPrnamtType", "SH") == "SH":
            try:
                shares = int(float(fields.get("sshPrnamt", "0")))
            except ValueError:
                shares = None
        item = holdings.setdefault(
            cusip, {"name": fields.get("nameOfIssuer", cusip), "value": 0, "shares": 0}
        )
        item["value"] += value
        if shares:
            item["shares"] += shares
    return holdings
def fetch_holdings(cik, period):
    base = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{period['accession'].replace('-', '')}/"
    listing = json.loads(sec_get(base + "index.json"))
    files = [
        item for item in listing.get("directory", {}).get("item", [])
        if str(item.get("name", "")).lower().endswith(".xml")
        and "primary_doc" not in str(item.get("name", "")).lower()
    ]
    if not files:
        raise RuntimeError("Information Table XML을 찾지 못했습니다.")
    def score(item):
        name = str(item.get("name", "")).lower()
        try:
            size = int(item.get("size") or 0)
        except ValueError:
            size = 0
        return (("info" in name or "table" in name), size)
    files.sort(key=score, reverse=True)
    return parse_info_table(sec_get(base + files[0]["name"]), period["filing_date"])
def quarter_label(report_date):
    year, month = report_date[:4], int(report_date[5:7])
    return f"{year}년 {(month - 1) // 3 + 1}분기"
def build_quarter(period, holdings, prev_period, prev_holdings, cik):
    total = sum(item["value"] for item in holdings.values())
    prev_total = sum(item["value"] for item in prev_holdings.values()) if prev_holdings else None
    def weight(item, sum_value):
        return round(item["value"] / sum_value * 100, 3) if sum_value else 0.0
    rows = []
    for cusip, item in holdings.items():
        prev = prev_holdings.get(cusip) if prev_holdings else None
        prev_weight = weight(prev, prev_total) if prev else 0.0
        current_weight = weight(item, total)
        tags = []
        pct = None
        if prev_holdings is not None:
            if prev is None:
                tags.append("new")
            else:
                if item["shares"] and prev["shares"] and item["shares"] > prev["shares"]:
                    tags.append("shares_up")
                    pct = round((item["shares"] / prev["shares"] - 1) * 100, 1)
                if current_weight - prev_weight > 0.0005:
                    tags.append("weight_up")
        rows.append({
            "cusip": cusip, "name": item["name"], "value": item["value"],
            "shares": item["shares"] or None, "weight": current_weight,
            "prev_shares": (prev["shares"] or None) if prev else None,
            "prev_weight": prev_weight if prev else None,
            "weight_change_pp": round(current_weight - prev_weight, 3) if prev_holdings is not None else None,
            "shares_change_pct": pct, "tags": tags,
        })
    rows.sort(key=lambda r: r["value"], reverse=True)
    changed = [r for r in rows if r["tags"]]
    counts = {
        "all": len(changed),
        "new": sum("new" in r["tags"] for r in rows),
        "shares_up": sum("shares_up" in r["tags"] for r in rows),
        "weight_up": sum("weight_up" in r["tags"] for r in rows),
    }
    changed.sort(key=lambda r: (r["weight_change_pp"] or 0), reverse=True)
    return {
        "report_date": period["report_date"],
        "quarter": quarter_label(period["report_date"]),
        "filing_date": period["filing_date"],
        "form": period["form"],
        "amended": period["amended"],
        "amendment_date": period["amendment_date"],
        "accession": period["accession"],
        "edgar_url": (
            f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/"
            f"{period['accession'].replace('-', '')}/{period['accession']}-index.htm"
        ),
        "total_value": total,
        "positions": len(holdings),
        "prev_report_date": prev_period["report_date"] if prev_period else None,
        "prev_total_value": prev_total,
        "prev_positions": len(prev_holdings) if prev_holdings else None,
        "counts": counts,
        "holdings": rows[:TOP_HOLDINGS],
        "changes": changed[:TOP_CHANGES],
    }
def map_cusips(cusips, cache):
    """OpenFIGI로 CUSIP→티커 변환 (캐시에 없는 것만, 무료 한도 때문에 천천히)."""
    todo = [c for c in sorted(set(cusips)) if c not in cache]
    for start in range(0, len(todo), 10):
        batch = todo[start:start + 10]
        body = json.dumps([
            {"idType": "ID_CUSIP", "idValue": c, "exchCode": "US"} for c in batch
        ]).encode()
        try:
            request = urllib.request.Request(
                "https://api.openfigi.com/v3/mapping", data=body,
                headers={"Content-Type": "application/json", "User-Agent": UA},
            )
            with urllib.request.urlopen(request, timeout=30) as response:
                results = json.load(response)
        except Exception as exc:
            print(f"OpenFIGI 조회 실패: {exc}")
            time.sleep(10)
            continue
        for cusip, result in zip(batch, results):
            ticker = None
            for item in result.get("data", []) or []:
                if item.get("ticker") and item.get("marketSector") == "Equity":
                    ticker = item["ticker"].replace("/", "-")
                    break
            cache[cusip] = {"ticker": ticker}
        time.sleep(2.6)
    return cache
def process_institution(entry):
    cik, keyword, name, name_ko, kind = entry
    sec_name, periods = list_periods(cik)
    if keyword not in sec_name.lower():
        raise RuntimeError(f"SEC 등록명({sec_name})이 예상과 달라 건너뜁니다.")
    periods = periods[:KEEP_PERIODS]
    if not periods:
        raise RuntimeError("13F-HR 공시가 없습니다.")
    all_holdings = [fetch_holdings(cik, p) for p in periods]
    quarters = []
    for i in range(min(3, len(periods))):
        prev_period = periods[i + 1] if i + 1 < len(periods) else None
        prev_holdings = all_holdings[i + 1] if prev_period else None
        quarters.append(build_quarter(periods[i], all_holdings[i], prev_period, prev_holdings, cik))
    return {
        "cik": f"{int(cik):010d}", "sec_name": sec_name, "name": name,
        "name_ko": name_ko, "type": kind, "quarters": quarters,
    }
def main():
    old = read_json(OUTPUT_FILE, {})
    old_by_cik = {
        i.get("cik"): i for i in (old.get("institutions", []) if isinstance(old, dict) else [])
    }
    cache = read_json(CUSIP_FILE, {})
    institutions = []
    errors = []
    for entry in INSTITUTIONS:
        try:
            institution = process_institution(entry)
            institutions.append(institution)
            print(f"OK  {entry[2]}: {institution['quarters'][0]['quarter']}")
        except Exception as exc:
            errors.append(f"{entry[2]}: {exc}")
            print(f"실패 {entry[2]}: {exc}")
            previous = old_by_cik.get(f"{int(entry[0]):010d}")
            if previous:
                institutions.append(previous)
    if not institutions:
        raise RuntimeError("13F 데이터를 하나도 받지 못했습니다. 기존 파일을 유지합니다.")
    cusips = []
    for institution in institutions:
        for quarter in institution["quarters"]:
            cusips += [r["cusip"] for r in quarter["holdings"] + quarter["changes"]]
    cache = map_cusips(cusips, cache)
    write_json(CUSIP_FILE, cache)
    for institution in institutions:
        for quarter in institution["quarters"]:
            for row in quarter["holdings"] + quarter["changes"]:
                row["ticker"] = (cache.get(row["cusip"]) or {}).get("ticker")
    output = {
        "updated_at": datetime.now(KST).isoformat(timespec="seconds"),
        "source": "SEC EDGAR 13F-HR",
        "institutions": institutions,
        "meta": {"count": len(institutions), "errors": errors},
    }
    write_json(OUTPUT_FILE, output)
    print(f"저장 완료: 기관 {len(institutions)}곳 (실패 {len(errors)})")
if __name__ == "__main__":
    main()
