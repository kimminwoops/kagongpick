/*
 * 카공픽 지역 설정
 * 지역마다 카페 CSV 파일 하나. 새 지역은 아래 배열에 추가하면 상단 지역 선택에 나타납니다.
 * anchor: 거리 계산 기준점 (내 위치를 켜지 않았을 때)
 */
window.KAGONGPICK_CONFIG = {
  regions: [
    {
      id: "knu-north",
      name: "경북대 북문",
      school: "경북대학교",
      csv: "data/cafes.csv",
      anchor: { name: "경북대 북문", lat: 35.8927, lng: 128.6097 }
    }
  ]
};
