# 자동 스캔 파일 추가 안내

이 묶음은 기존 저장소에 **추가할 파일**입니다. ZIP 자체를 GitHub에 올리지 마세요.

포함 파일:
- `scripts/scan.py`: Yahoo Finance에서 일봉 데이터와 일부 지표를 수집하고 근사 신호를 계산합니다.
- `.github/workflows/daily-scan.yml`: 평일 자동 실행과 수동 실행을 설정합니다.
- `requirements.txt`: 파이썬 패키지 목록
- `data/.gitkeep`: data 폴더가 저장소에 남도록 합니다.

## 중요한 한계
이 코드는 사용자가 설명한 Pine Script 원본과 신호가 완전히 일치하는지 검증되지 않은 **근사 구현**입니다. 특히 원본의 추가 진입/매도 상태 로직, 동일 신호 에피소드 성과 계산, 완전한 거시지표 데이터 검증은 포함되지 않았습니다. 실제 투자 판단에 사용하기 전에 원본 전략과 대조 테스트가 필요합니다.

## GitHub Actions 사용
파일을 저장소의 동일한 경로로 업로드한 뒤 Actions 탭에서 `Daily Stock Scan`을 선택하고 `Run workflow`로 수동 실행합니다. 실행이 끝나면 `data/latest.json`과 `data/signal_history.json`이 생성/갱신됩니다.

GitHub Pages는 데이터 JSON 파일을 표시할 수 있지만, 첫 실행 전에는 지표가 비어 있을 수 있습니다. Yahoo Finance/Wikipedia 접근 제한이나 API 변경으로 수집이 실패할 수 있습니다.
