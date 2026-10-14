// 혀누 주식 스크리너 설정 (선택 사항)
//
// 실시간 현재가 설정 방법 (둘 중 하나만 해도 됩니다)
//  1) finnhubKey : https://finnhub.io 에서 무료 가입 후 API 키를 붙여넣기
//                  (미국 주식·ETF 현재가. 무료 한도: 분당 60회)
//  2) quoteProxy : 직접 만든 시세 프록시 주소 (예: Cloudflare Worker).
//                  GET {주소}?symbols=AAPL,MSFT  →  {"AAPL":{"price":1,"change":0.1,"changePct":0.5}}
// 둘 다 비워 두면 Actions의 'Live Quotes'가 만든 5분 단위 시세 스냅샷을 사용합니다(키 불필요).
// 암호화폐는 키 없이 CoinGecko에서 가져옵니다.
// 주의: 이 파일은 공개 저장소에 올라가므로, 읽기 전용 무료 키만 사용하세요.
window.HYEONU_CONFIG = {
  finnhubKey: "",
  quoteProxy: "",
  // 5분마다 갱신되는 시세 스냅샷 주소 (비워 두면 github.io 주소에서 자동 계산)
  snapshotUrl: "",
  pollSeconds: 15
};
