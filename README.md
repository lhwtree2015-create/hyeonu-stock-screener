# 혀누 주식 스크리너

모바일 우선 웹앱의 초기 프로젝트입니다. 실제 배포 전 아래의 제한과 검증 항목을 확인하세요.

- 원본 TradingView Pine Script V12와의 신호 일치 검증은 아직 완료되지 않았습니다.
- yfinance는 비공식 무료 데이터 접근으로 지연·누락·요청 제한이 있을 수 있습니다.
- 데이터가 없으면 임의의 주가나 신호를 만들지 않습니다.
- 현재 상세 페이지는 차트 영역 자리표시자입니다. 실제 캔들스틱/선 차트와 뉴스 기능은 추가 구현이 필요합니다.
- 수수료, 슬리피지, 체결 가능성을 반영하지 않는 가상 성과입니다.

## 배포 (아이폰 브라우저에서도 가능)
1. GitHub에서 새 Public repository를 만듭니다.
2. ZIP 압축을 풀고 모든 파일과 폴더를 업로드합니다. `.github` 폴더가 빠지지 않았는지 확인합니다.
3. Settings → Pages → Deploy from a branch → `main` → `/(root)`를 선택합니다.
4. Actions에서 `Daily market scan`을 수동 실행합니다.
5. 실행이 성공하면 `data/latest.json`이 생성되고 웹 화면이 데이터를 읽습니다.
6. Settings → Pages에 표시되는 실제 URL을 사용합니다.

GitHub Pages 주소는 일반적으로 `https://사용자이름.github.io/저장소이름/` 형태입니다. 실제 URL은 GitHub가 표시한 것을 확인해야 합니다.
