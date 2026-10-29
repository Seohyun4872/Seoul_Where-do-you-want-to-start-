// ============================
// 전역변수
// ============================
let AREAS = [];                 // areas_for_web.geojson
let CONFIG = {};                // config.json
let PREDICTED_MAP = {};         // predicted_money_map.json

let GRID_DATA = null;           // grid_250m_4326.geojson
let BOUNDARY_DATA = null;       // seoul_boundary_4326.geojson

let INDUSTRY_SENTENCES = {};    // 업종별 설명 문장 매핑

let map;
let gridLayer;
let boundaryLayer;
let top10Layer = L.layerGroup();
let topPointsLayer = L.layerGroup();
let homeLayer = L.layerGroup();

// ============================
// 거리 계산 (Haversine)
// ============================
function distanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;

    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ============================
// "선택 없음" 처리용 함수
// ============================
function isNoFilter(val) {
    return (
        val === null ||
        val === undefined ||
        val === "" ||
        val === "선택없음" ||
        val === "선택 없음" ||
        val === "선택 안 함"
    );
}

// ============================
// 스타일 함수들
// ============================

// 1) rank에 따라 상권 색상
function areaStyleFn(feature) {
    const props = feature.properties || {};
    let rankVal = props.rank;

    let rnk = null;
    if (rankVal !== undefined && rankVal !== null) {
        rnk = parseInt(rankVal, 10);
        if (isNaN(rnk)) rnk = null;
    }

    let color;
    if (rnk === null) {
        color = "#cccccc";          // 예외: 회색
    } else if (1 <= rnk && rnk <= 3) {
        color = "#e41a1c";          // 진한 빨강
    } else if (4 <= rnk && rnk <= 7) {
        color = "#ff7f0e";          // 주황
    } else if (8 <= rnk && rnk <= 10) {
        color = "#f781bf";          // 연핑크
    } else {
        color = "#cccccc";          // 범위 밖: 회색
    }

    return {
        fillColor: color,
        color: color,
        weight: 0.7,
        fillOpacity: 0.5,
    };
}

// 2) 격자 레이어 스타일
function gridStyleFn(feature) {
    return {
        fillColor: "transparent",
        color: "#cccccc",
        weight: 0.3,
        fillOpacity: 0,
        interactive: false
    };
}

// 3) 서울 외곽 경계 스타일
function seoulBoundaryStyleFn(feature) {
    return {
        fillColor: "transparent",
        color: "#000000",
        weight: 3,
        fillOpacity: 0,
        interactive: false
    };
}

// ============================
// 팝업 HTML 생성 (Colab make_popup_text 대응)
// ============================
function makePopupHtml(props, rank) {
    const industry = props["업종_대분류"];
    const areaName = props["상권_코드_명"];

    const key = `${areaName}||${industry}`;
    const pm = PREDICTED_MAP[key];

    const pmStr = (pm === null || pm === undefined || isNaN(pm))
        ? "예상 매출: 정보 없음"
        : `예상 매출(predicted): ${Number(pm).toLocaleString()} 원`;

    return `
        🌟 <mark> 순위 ${rank} | ${areaName}</mark><br>
        업종: ${industry}<br>
        ${pmStr}<br>
        최적 휴일: ${props["최적_휴일"]}<br>
        상권 변화 지표: ${props["상권_변화_지표_명"]}<br>
        집객시설: ${props["Top1"]}, ${props["Top2"]}
    `;
}

// ============================
// Top10 리스트 텍스트 패널 렌더링
// ============================
function renderTop10List(top10) {
    const container = document.getElementById("top10List");
    if (!container) return;

    container.innerHTML = "";

    if (!top10 || top10.length === 0) {
        container.innerHTML = "<p>추천 상권이 없습니다.</p>";
        return;
    }

    top10
        .sort((a, b) => a.properties.rank - b.properties.rank)
        .forEach(f => {
            const p = f.properties;
            const sales = Number(p["점포당_매출_num"]);
            const formattedSales = isNaN(sales)
                ? "정보 없음"
                : sales.toLocaleString() + " 원";

            const div = document.createElement("div");
            div.className = "top-item";

            div.innerHTML = `
                <strong>${p.rank}위 | ${p["상권_코드_명"]}</strong><br>
                피크시간대: ${p["피크_시간대_유형"]}<br>
                주중/주말: ${p["주중주말_유형"]}<br>
                가격대: ${p["가격대_유형"]}<br>
                점포당 매출: ${formattedSales}
            `;

            container.appendChild(div);
        });
}

// ============================
// 업종별 설명 문장 렌더링
// ============================
function renderIndustrySentence(industry) {
    const el = document.getElementById("industrySentence");
    if (!el) return;

    if (!industry) {
        el.textContent = "업종을 선택하고 “상권 추천” 버튼을 누르면 설명이 표시됩니다.";
        return;
    }

    const key = String(industry).trim();
    const sentence = INDUSTRY_SENTENCES[key];

    if (sentence) {
        el.textContent = "👉 " + sentence;
    } else {
        el.textContent = "해당 업종에 대한 설명 문장이 등록되어 있지 않습니다.";
    }
}

// ============================
// 인디케이터 필터링 → Top10
// ============================
function filterAreasForTop10(widgets, baseFeatures = null) {

    const selectedIndustry = widgets.industry;
    const allowedClusters = CONFIG.industry_cluster_map[selectedIndustry] || [];

    // 기본은 전체 상권(AREAS)이지만, baseFeatures가 들어오면 그 안에서만 필터링
    let df = [...(baseFeatures || AREAS)];

    // 1) 업종 → 클러스터 필터
    df = df.filter(f => allowedClusters.includes(f.properties.cluster));

    // 2) 피크시간대
    if (!isNoFilter(widgets.time)) {
        df = df.filter(f => f.properties["피크_시간대_유형"] === widgets.time);
    }

    // 3) 주중/주말
    if (!isNoFilter(widgets.weekday)) {
        df = df.filter(f => f.properties["주중주말_유형"] === widgets.weekday);
    }

    // 4) 가격대
    if (!isNoFilter(widgets.price)) {
        df = df.filter(f => f.properties["가격대_유형"] === widgets.price);
    }

    if (df.length === 0) return [];

    // 5) 점포당_매출_num 기준 정렬
    df = df
        .map(f => {
            const sales = Number(f.properties["점포당_매출_num"] || 0);
            return { feature: f, sales };
        })
        .filter(o => !isNaN(o.sales))
        .sort((a, b) => b.sales - a.sales)
        .slice(0, 10);

    // rank + 업종_대분류 세팅
    df.forEach((obj, idx) => {
        obj.feature.properties.rank = idx + 1;
        obj.feature.properties["업종_대분류"] = selectedIndustry;
    });

    return df.map(o => o.feature);
}

// ============================
// 지도에 Top10 + TOP1-3 + 집/반경 표시
// ============================
function drawTop10(top10, homeX, homeY, radiusKm) {
    top10Layer.clearLayers();
    topPointsLayer.clearLayers();
    homeLayer.clearLayers();

    // 1) 집 + 반경 원 (좌표만 제대로 들어오면 proximity 상관없이 항상 그림)
    if (radiusKm > 0 && !isNaN(homeX) && !isNaN(homeY)) {
        L.marker([homeY, homeX]).addTo(homeLayer);
        L.circle([homeY, homeX], { radius: radiusKm * 1000, color: "blue" })
            .addTo(homeLayer);
    }

    homeLayer.addTo(map);

    // 2) Top10 상권 폴리곤
    const top10Sorted = [...top10].sort((a, b) => a.properties.rank - b.properties.rank);

    top10Sorted.forEach((f) => {
        const rank = f.properties.rank;
        const popupHtml = makePopupHtml(f.properties, rank);

        const layer = L.geoJSON(f, {
            style: areaStyleFn,
            onEachFeature: (feature, lyr) => {
                const tt = `순위 ${rank} | ${feature.properties["상권_코드_명"]}`;
                lyr.bindTooltip(tt, { sticky: true });
                lyr.bindPopup(popupHtml, { maxWidth: 400 });
            }
        });

        layer.addTo(top10Layer);
    });

    top10Layer.addTo(map);

    // 3) TOP1-3 포인터 (컬러 뱃지 마커)
    top10Sorted.forEach(f => {
        const rnk = f.properties.rank;
        if (rnk > 3) return;

        const lat = f.properties.center_lat;
        const lon = f.properties.center_lon;
        const popupHtml = makePopupHtml(f.properties, rnk);

        const icon = L.divIcon({
            html: `<div class="top-marker rank-${rnk}">TOP${rnk}</div>`,
            className: "",
            iconSize: [60, 24],
            iconAnchor: [30, 12]
        });

        L.marker([lat, lon], {
            icon: icon,
            title: `TOP${rnk}: ${f.properties["상권_코드_명"]}`
        })
            .bindPopup(popupHtml, { maxWidth: 400 })
            .addTo(topPointsLayer);
    });

    topPointsLayer.addTo(map);

    // 4) 왼쪽 리스트 패널도 같이 업데이트
    renderTop10List(top10);
}

// ============================
// 메인 init
// ============================
async function init() {

    // 1) 지도 생성
    map = L.map("map").setView([37.5665, 126.9780], 11);

    L.tileLayer('https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=cb1_4xnd_1_2f0690a97ee28141bc531909', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attribution/">CARTO</a>',
        maxZoom: 19
    }).addTo(map);

    // 2) 최소 필수 데이터 + 업종 문장 로드
    let areasData, configData, predData, sentenceData;
    try {
        [areasData, configData, predData, sentenceData] = await Promise.all([
            fetch("./data/areas_for_web.geojson").then(r => {
                if (!r.ok) throw new Error("areas_for_web.geojson 로드 실패");
                return r.json();
            }),
            fetch("./data/config.json").then(r => {
                if (!r.ok) throw new Error("config.json 로드 실패");
                return r.json();
            }),
            fetch("./data/predicted_money_map.json").then(r => {
                if (!r.ok) throw new Error("predicted_money_map.json 로드 실패");
                return r.json();
            }),
            fetch("./data/industry_sentences.json").then(r => {
                if (!r.ok) {
                    console.warn("⚠ industry_sentences.json 로드 실패 (업종 설명 없음 상태로 진행)");
                    return [];
                }
                return r.json();
            }),
        ]);
    } catch (e) {
        console.error("❌ 필수 데이터 로드 중 오류:", e);
        alert("필수 데이터 파일을 불러오지 못했습니다. console을 확인해 주세요.");
        return;
    }

    AREAS = areasData.features;
    CONFIG = configData;
    PREDICTED_MAP = predData;

    // 업종별 문장: records 리스트 → {업종: 문장} 딕셔너리로 변환
    INDUSTRY_SENTENCES = {};
    if (Array.isArray(sentenceData)) {
        sentenceData.forEach(row => {
            const name = String(row["업종"] ?? "").trim();
            const text = row["문장"];
            if (name && text) {
                INDUSTRY_SENTENCES[name] = text;
            }
        });
    }

    // 3) 격자 / 경계는 있으면 쓰고, 없으면 경고만 찍고 넘어가기
    try {
        const gridRes = await fetch("./data/grid_250m_4326.geojson");
        if (gridRes.ok) {
            GRID_DATA = await gridRes.json();
            gridLayer = L.geoJSON(GRID_DATA, {
                style: gridStyleFn,
                interactive: false
            }).addTo(map);
        } else {
            console.warn("⚠ grid_250m_4326.geojson 없음 (지금은 건너뜀)");
        }
    } catch (e) {
        console.warn("⚠ grid_250m_4326.geojson 로드 실패 (지금은 건너뜀)", e);
    }

    try {
        const boundaryRes = await fetch("./data/seoul_boundary_4326.geojson");
        if (boundaryRes.ok) {
            BOUNDARY_DATA = await boundaryRes.json();
            boundaryLayer = L.geoJSON(BOUNDARY_DATA, {
                style: seoulBoundaryStyleFn,
                interactive: false
            }).addTo(map);
        } else {
            console.warn("⚠ seoul_boundary_4326.geojson 없음 (지금은 건너뜀)");
        }
    } catch (e) {
        console.warn("⚠ seoul_boundary_4326.geojson 로드 실패 (지금은 건너뜀)", e);
    }

    // 4) 드롭다운 채우기
    const industrySel = document.getElementById("industry");
    const timeSel = document.getElementById("time");
    const weekdaySel = document.getElementById("weekday");
    const priceSel = document.getElementById("price");
    const proximitySel = document.getElementById("proximity");

    Object.keys(CONFIG.industry_cluster_map).forEach(k => {
        const op = document.createElement("option");
        op.value = k;
        op.textContent = k;
        industrySel.appendChild(op);
    });

    CONFIG.time_options.forEach(v => {
        const op = document.createElement("option");
        op.value = v;
        op.textContent = v;
        timeSel.appendChild(op);
    });

    CONFIG.weekday_options.forEach(v => {
        const op = document.createElement("option");
        op.value = v;
        op.textContent = v;
        weekdaySel.appendChild(op);
    });

    CONFIG.price_options.forEach(v => {
        const op = document.createElement("option");
        op.value = v;
        op.textContent = v;
        priceSel.appendChild(op);
    });

    // 5) LayerControl
    const overlayMaps = {};
    if (gridLayer) overlayMaps["Grid (격자)"] = gridLayer;
    if (boundaryLayer) overlayMaps["서울 외곽 경계"] = boundaryLayer;
    overlayMaps["Top10 상권"] = top10Layer;
    overlayMaps["TOP1-3 포인터"] = topPointsLayer;
    overlayMaps["집/반경"] = homeLayer;

    L.control.layers(null, overlayMaps, { collapsed: false }).addTo(map);

    // 6) 버튼 클릭 이벤트 (직주근접 모드 반영)
    document.getElementById("runBtn").addEventListener("click", () => {

        const widgets = {
            industry: industrySel.value,
            time: timeSel.value,
            weekday: weekdaySel.value,
            price: priceSel.value,
        };

        const homeXVal = document.getElementById("homeX").value;
        const homeYVal = document.getElementById("homeY").value;
        const radiusVal = document.getElementById("radius").value;
        const proximityMode = proximitySel.value;   // "any" / "near" / "far"

        const homeX = parseFloat(homeXVal);
        const homeY = parseFloat(homeYVal);
        const radiusKm = parseFloat(radiusVal);

        console.log("🏠 homeX, homeY, radiusKm, mode =", homeX, homeY, radiusKm, proximityMode);

        // 집 좌표/반경이 유효한지 여부
        const hasHome =
            homeXVal !== "" &&
            homeYVal !== "" &&
            !isNaN(homeX) &&
            !isNaN(homeY) &&
            !isNaN(radiusKm) &&
            radiusKm > 0;

        // 1) 거리 기반으로 먼저 상권 후보 필터링
        let baseFeatures = [...AREAS];

        // 직주근접 상관없음이거나 집 정보가 없으면 → 거리 필터 사용 안 함
        if (!(proximityMode === "any" || !hasHome)) {
            const radiusM = radiusKm * 1000;

            baseFeatures = baseFeatures
                .map(f => {
                    const lat = Number(f.properties.center_lat);
                    const lon = Number(f.properties.center_lon);
                    const d = distanceMeters(homeY, homeX, lat, lon);
                    return { feature: f, dist: d };
                })
                .filter(obj => !isNaN(obj.dist))
                .filter(obj => {
                    if (proximityMode === "near") {
                        // 반경 이내 = 직주근접
                        return obj.dist <= radiusM;
                    } else {
                        // 반경 밖 = 직주분리
                        return obj.dist > radiusM;
                    }
                })
                .map(obj => obj.feature);

            if (baseFeatures.length === 0) {
                if (proximityMode === "near") {
                    alert(`집 기준 반경 ${radiusKm}km 이내(근접)에 존재하는 상권이 없습니다.\n반경을 키우거나 조건을 완화해 보세요.`);
                } else {
                    alert(`집 기준 반경 ${radiusKm}km 밖(비근접)에 존재하는 상권이 없습니다.\n반경을 줄이거나 조건을 완화해 보세요.`);
                }
                // 그래도 집 위치 + 링만 보여주고 종료
                drawTop10([], hasHome ? homeX : NaN, hasHome ? homeY : NaN, hasHome ? radiusKm : 0);
                renderTop10List([]);
                renderIndustrySentence(widgets.industry);
                return;
            }
        }

        // 2) 인디케이터 조건에 맞게 Top10 뽑기 (baseFeatures 내에서만)
        let top10 = filterAreasForTop10(widgets, baseFeatures);

        if (top10.length === 0) {
            alert("선택한 조건에 해당하는 상권이 없습니다.\n인디케이터를 조금 완화해서 다시 설정해 주세요.");
            top10Layer.clearLayers();
            topPointsLayer.clearLayers();
            homeLayer.clearLayers();
            renderTop10List([]);
            renderIndustrySentence(null);
            return;
        }

        if (top10.length > 10) {
            top10 = top10.slice(0, 10);
        }

        // 3) 지도 & 리스트 갱신
        drawTop10(
            top10,
            hasHome ? homeX : NaN,
            hasHome ? homeY : NaN,
            hasHome ? radiusKm : 0
        );

        // 4) 업종별 설명 문장 업데이트
        renderIndustrySentence(widgets.industry);
    });
}

init();
