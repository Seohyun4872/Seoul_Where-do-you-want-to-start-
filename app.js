// ==============================
// 기본 설정
// ==============================

const map = L.map("map").setView([37.56, 126.97], 11); // 서울 중앙 기준

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

let allFeatures = [];
let baseLayer = null;
let highlightLayer = null;
let layerControl = null;

// 상권별 중심 좌표 (집 반경 필터용)
const centerMap = new Map();

// Top 3 마커 레이어
let topMarkerLayer = null;

// ==============================
// GeoJSON 로딩
// ==============================

fetch("data/seoul_areas.geojson")
  .then((res) => res.json())
  .then((data) => {
    allFeatures = data.features;

    // 1) 전체 상권을 연한 색으로 배경에 깔기
    baseLayer = L.geoJSON(data, {
      style: {
        color: "#999",
        weight: 1,
        fillOpacity: 0.1,
      },
      onEachFeature: (feature, layer) => {
        const p = feature.properties;
        layer.bindPopup(`
          <b>${p["상권_코드_명"]}</b><br/>
          클러스터: ${p["cluster"] ?? "-"}<br/>
          피크 시간대: ${p["피크_시간대_유형"] ?? "-"}<br/>
          주중/주말: ${p["주중주말_유형"] ?? "-"}<br/>
          가격대: ${p["가격대_유형"] ?? "-"}<br/>
          평균 점포당 조정 매출: ${
            p["평균_점포당_조정_매출"]
              ? p["평균_점포당_조정_매출"].toLocaleString() + "원"
              : "정보 없음"
          }
        `);
      },
    }).addTo(map);

    // 1-1) 상권 중심점 계산해서 저장 (집 반경 필터 + Top 마커용)
    baseLayer.eachLayer((layer) => {
      const f = layer.feature;
      const p = f.properties;
      const center = layer.getBounds().getCenter(); // polygon의 중심
      centerMap.set(p["상권_코드_명"], center);
    });

    // 1-2) 레이어 컨트롤 생성 (전체 상권 오버레이 등록)
    const overlayMaps = {
      "전체 상권": baseLayer,
    };

    layerControl = L.control.layers(null, overlayMaps, {
      collapsed: false,
    }).addTo(map);

    // 2) 드롭다운 옵션 채우기
    fillIndicatorOptions(allFeatures);
  })
  .catch((err) => {
    console.error("GeoJSON 로드 실패:", err);
  });

// ==============================
// 인디케이터 옵션 채우기
// ==============================

function getUniqueValues(features, field) {
  const set = new Set();
  features.forEach((f) => {
    const v = f.properties[field];
    if (v !== null && v !== undefined && v !== "") {
      set.add(v);
    }
  });
  return Array.from(set).sort();
}

function appendOptions(selectEl, values) {
  values.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  });
}

function fillIndicatorOptions(features) {
  const industrySelect = document.getElementById("industrySelect");
  const timeSelect = document.getElementById("timeSelect");
  const weekdaySelect = document.getElementById("weekdaySelect");
  const priceSelect = document.getElementById("priceSelect");

  const industryField = "서비스_업종_코드_명"; // 실제 컬럼명 확인
  const timeField = "피크_시간대_유형";
  const weekdayField = "주중주말_유형";
  const priceField = "가격대_유형";

  if (features[0]?.properties[industryField] !== undefined) {
    appendOptions(industrySelect, getUniqueValues(features, industryField));
  } else {
    industrySelect.disabled = true;
  }

  appendOptions(timeSelect, getUniqueValues(features, timeField));
  appendOptions(weekdaySelect, getUniqueValues(features, weekdayField));
  appendOptions(priceSelect, getUniqueValues(features, priceField));
}

// ==============================
// 추천 로직
// ==============================

document.getElementById("runBtn").addEventListener("click", () => {
  if (!allFeatures.length) return;

  const industrySelect = document.getElementById("industrySelect");
  const timeSelect = document.getElementById("timeSelect");
  const weekdaySelect = document.getElementById("weekdaySelect");
  const priceSelect = document.getElementById("priceSelect");

  const homeXInput = document.getElementById("homeX");
  const homeYInput = document.getElementById("homeY");
  const radiusSelect = document.getElementById("radiusSelect");

  const industry = industrySelect.value;
  const time = timeSelect.value;
  const weekday = weekdaySelect.value;
  const price = priceSelect.value;

  const industryField = "서비스_업종_코드_명";
  const timeField = "피크_시간대_유형";
  const weekdayField = "주중주말_유형";
  const priceField = "가격대_유형";
  const salesField = "평균_점포당_조정_매출";

  // 🏠 집 좌표 + 반경 읽기
  const homeX = parseFloat(homeXInput.value);
  const homeY = parseFloat(homeYInput.value);
  const radiusKm = parseFloat(radiusSelect.value);

  const useHome =
    !Number.isNaN(homeX) &&
    !Number.isNaN(homeY) &&
    homeX !== 0 &&
    homeY !== 0;

  let homeLatLng = null;
  if (useHome) {
    homeLatLng = L.latLng(homeY, homeX);
  }

  // 1) 필터링 (인디케이터 + 집 반경 AND 조건)
  let filtered = allFeatures.filter((f) => {
    const p = f.properties;

    // 업종
    if (industry !== "ALL" && !industrySelect.disabled) {
      if (p[industryField] !== industry) return false;
    }
    // 피크 시간대
    if (time !== "ALL" && p[timeField] !== time) return false;
    // 주중/주말
    if (weekday !== "ALL" && p[weekdayField] !== weekday) return false;
    // 가격대
    if (price !== "ALL" && p[priceField] !== price) return false;

    // 🏠 집 반경 필터
    if (useHome) {
      const center = centerMap.get(p["상권_코드_명"]);
      if (!center) return false;
      const distMeters = map.distance(homeLatLng, center);
      if (distMeters > radiusKm * 1000) return false;
    }

    return true;
  });

  // 2) 매출 기준 내림차순 정렬
  filtered.sort((a, b) => {
    const aVal = Number(a.properties[salesField] || 0);
    const bVal = Number(b.properties[salesField] || 0);
    return bVal - aVal;
  });

  // 3) Top10만 사용
  const topN = filtered.slice(0, 10);

  updateHighlightLayer(topN, { useHome, radiusKm, homeLatLng });
  updateResultTable(topN, { industry, time, weekday, price, useHome, radiusKm });
});

// ==============================
// 지도 강조 레이어 갱신 + Top3 마커
// ==============================

function updateHighlightLayer(topFeatures, options) {
  // 이전 추천 레이어 제거
  if (highlightLayer) {
    map.removeLayer(highlightLayer);
    if (layerControl) {
      layerControl.removeLayer(highlightLayer);
    }
  }

  // 이전 Top3 마커 레이어 제거
  if (topMarkerLayer) {
    map.removeLayer(topMarkerLayer);
    if (layerControl) {
      layerControl.removeLayer(topMarkerLayer);
    }
  }

  if (!topFeatures.length) return;

  highlightLayer = L.geoJSON(topFeatures, {
    style: {
      color: "red",
      weight: 3,
      fillOpacity: 0.4,
    },
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      layer.bindPopup(`
        <b>${p["상권_코드_명"]}</b><br/>
        평균 점포당 조정 매출: ${
          p["평균_점포당_조정_매출"]
            ? p["평균_점포당_조정_매출"].toLocaleString() + "원"
            : "정보 없음"
        }<br/>
        클러스터: ${p["cluster"] ?? "-"}<br/>
        피크 시간대: ${p["피크_시간대_유형"] ?? "-"}<br/>
        주중/주말: ${p["주중주말_유형"] ?? "-"}<br/>
        가격대: ${p["가격대_유형"] ?? "-"}
      `);
    },
  }).addTo(map);

  // 레이어 컨트롤에 "추천 상권" 등록
  if (layerControl) {
    layerControl.addOverlay(highlightLayer, "추천 상권");
  }

  // ⭐ Top 3 마커 찍기
  topMarkerLayer = L.layerGroup().addTo(map);

  const topCount = Math.min(3, topFeatures.length);
  for (let i = 0; i < topCount; i++) {
    const f = topFeatures[i];
    const p = f.properties;
    const center = centerMap.get(p["상권_코드_명"]);
    if (!center) continue;

    const marker = L.marker(center, {
      icon: L.divIcon({
        className: "top-marker",
        html: `<div class="top-marker-inner">${i + 1}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      }),
    });

    marker.bindPopup(`TOP ${i + 1} - ${p["상권_코드_명"]}`);
    marker.addTo(topMarkerLayer);
  }

  if (layerControl) {
    layerControl.addOverlay(topMarkerLayer, "Top 3 마커");
  }

  // TOP 상권들 중심으로 줌 맞추기
  const bounds = highlightLayer.getBounds();
  if (bounds.isValid()) {
    map.fitBounds(bounds.pad(0.2));
  }
}

// ==============================
// 오른쪽 결과 표/요약
// ==============================

function updateResultTable(topFeatures, options) {
  const { industry, time, weekday, price, useHome, radiusKm } = options;
  const resultDiv = document.getElementById("result");

  if (!topFeatures.length) {
    resultDiv.innerHTML = `
      <p>⚠ 선택한 조건에 해당하는 상권이 없습니다.<br/>
      인디케이터 또는 반경 조건을 조금 완화해서 다시 시도해 보세요.</p>
    `;
    return;
  }

  const summaryHtml = `
    <p>
      <b>추천 결과</b><br/>
      업종: ${industry === "ALL" ? "전체" : industry}<br/>
      피크 시간대: ${time === "ALL" ? "전체" : time}<br/>
      주중/주말: ${weekday === "ALL" ? "전체" : weekday}<br/>
      가격대: ${price === "ALL" ? "전체" : price}<br/>
      ${
        useHome
          ? `반경: ${radiusKm} km 이내 상권만 포함`
          : `반경 조건: 사용 안 함`
      }
    </p>
    <p>조건에 가장 잘 맞는 상권 Top ${topFeatures.length} 목록입니다.</p>
  `;

  const rowsHtml = topFeatures
    .map((f, idx) => {
      const p = f.properties;
      return `
        <tr>
          <td>${idx + 1}</td>
          <td>${p["상권_코드_명"]}</td>
          <td>${
            p["평균_점포당_조정_매출"]
              ? p["평균_점포당_조정_매출"].toLocaleString() + "원"
              : "-"
          }</td>
          <td>${p["cluster"] ?? "-"}</td>
          <td>${p["피크_시간대_유형"] ?? "-"}</td>
          <td>${p["주중주말_유형"] ?? "-"}</td>
          <td>${p["가격대_유형"] ?? "-"}</td>
        </tr>
      `;
    })
    .join("");

  const tableHtml = `
    <table>
      <thead>
        <tr>
          <th>순위</th>
          <th>상권명</th>
          <th>평균 매출</th>
          <th>클러스터</th>
          <th>피크 시간대</th>
          <th>주중/주말</th>
          <th>가격대</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `;

  resultDiv.innerHTML = summaryHtml + tableHtml;
}
