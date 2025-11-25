// ============================
// 전역변수
// ============================
let AREAS = [];                 // areas_for_web.geojson
let CONFIG = {};                // config.json
let PREDICTED_MAP = {};         // predicted_money_map.json

let GRID_DATA = null;           // grid_250m_4326.geojson
let BOUNDARY_DATA = null;       // seoul_boundary_4326.geojson

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
    const dLon = toRad(lat2 - lon1);
    const a =
        Math.sin(dLat/2)**2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon/2)**2;

    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ============================
// 스타일 함수들 (folium 대응)
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
// 인디케이터 필터링 → Top10
// ============================
function filterAreasForTop10(widgets) {

    const selectedIndustry = widgets.industry;
    const allowedClusters = CONFIG.industry_cluster_map[selectedIndustry] || [];

    let df = [...AREAS];

    // 1) 업종 → 클러스터 필터
    df = df.filter(f => allowedClusters.includes(f.properties.cluster));

    // 2) 피크시간대
    if (widgets.time !== "선택없음") {
        df = df.filter(f => f.properties["피크_시간대_유형"] === widgets.time);
    }

    // 3) 주중/주말
    if (widgets.weekday !== "선택없음") {
        df = df.filter(f => f.properties["주중주말_유형"] === widgets.weekday);
    }

    // 4) 가격대
    if (widgets.price !== "선택없음") {
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

    // 1) 집 + 반경 원
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
                // 팝업
                lyr.bindPopup(popupHtml, { maxWidth: 400 });
                // 툴팁 (순위 + 상권명)
                const tt = `순위 ${rank} | ${feature.properties["상권_코드_명"]}`;
                lyr.bindTooltip(tt, { sticky: true });
            }
        });

        layer.addTo(top10Layer);
    });

    top10Layer.addTo(map);

function renderTop10List(top10) {
    const container = document.getElementById("top10List");
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


    // 3) TOP1-3 포인터 (별 마커)
    const starIcon = L.divIcon({
        html: "🎯",
        className: "top-star-icon",
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });

    top10Sorted.forEach(f => {
        const rnk = f.properties.rank;
        if (rnk > 3) return;

        const lat = f.properties.center_lat;
        const lon = f.properties.center_lon;
        const popupHtml = makePopupHtml(f.properties, rnk);

        L.marker([lat, lon], {
            icon: starIcon,
            title: `TOP${rnk}: ${f.properties["상권_코드_명"]}`
        })
        .bindPopup(popupHtml, { maxWidth: 400 })
        .addTo(topPointsLayer);
    });

    topPointsLayer.addTo(map);
}

// ============================
// 메인 init (⚠ 수정된 버전)
// ============================
async function init() {

    // 1) 지도 생성 (folium의 CartoDB positron 느낌)
    map = L.map("map").setView([37.5665, 126.9780], 11);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19
    }).addTo(map);

    // 2) 최소 필수 데이터 3개 먼저 로드
    let areasData, configData, predData;
    try {
        [areasData, configData, predData] = await Promise.all([
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
        ]);
    } catch (e) {
        console.error("❌ 필수 데이터 로드 중 오류:", e);
        alert("필수 데이터 파일을 불러오지 못했습니다. console을 확인해 주세요.");
        return;
    }

    AREAS = areasData.features;
    CONFIG = configData;
    PREDICTED_MAP = predData;

    // 3) 격자 / 경계는 있으면 쓰고, 없으면 경고만 띄우기
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

    // 5) LayerControl (grid/boundary 없는 경우도 대비)
    const overlayMaps = {};
    if (gridLayer) overlayMaps["Grid (격자)"] = gridLayer;
    if (boundaryLayer) overlayMaps["서울 외곽 경계"] = boundaryLayer;
    overlayMaps["Top10 상권"] = top10Layer;
    overlayMaps["TOP1-3 포인터"] = topPointsLayer;
    overlayMaps["집/반경"] = homeLayer;

    L.control.layers(null, overlayMaps, { collapsed: false }).addTo(map);

    // 6) 버튼 클릭 이벤트 (조금 더 견고하게)
    document.getElementById("runBtn").addEventListener("click", () => {

        const widgets = {
            industry: industrySel.value,
            time: timeSel.value,
            weekday: weekdaySel.value,
            price: priceSel.value,
        };

        let top10 = filterAreasForTop10(widgets);

        if (top10.length === 0) {
            alert("조건에 맞는 상권이 없습니다. 인디케이터를 다시 선택해 주세요.");
            top10Layer.clearLayers();
            topPointsLayer.clearLayers();
            homeLayer.clearLayers();
            return;
        }

        const homeXVal = document.getElementById("homeX").value;
        const homeYVal = document.getElementById("homeY").value;
        const radiusVal = document.getElementById("radius").value;

        const homeX = parseFloat(homeXVal);
        const homeY = parseFloat(homeYVal);
        const radiusKm = parseFloat(radiusVal);

        console.log("🏠 homeX, homeY, radiusKm =", homeX, homeY, radiusKm);

        let useHomeFilter = false;
        if (!isNaN(radiusKm) && radiusKm > 0 && homeXVal !== "" && homeYVal !== "") {
            if (!isNaN(homeX) && !isNaN(homeY)) {
                useHomeFilter = true;
            }
        }

        if (useHomeFilter) {
            top10 = top10
                .map(f => {
                    const lat = Number(f.properties.center_lat);
                    const lon = Number(f.properties.center_lon);
                    const d = distanceMeters(homeY, homeX, lat, lon);
                    return { feature: f, dist: d };
                })
                .filter(obj => !isNaN(obj.dist) && obj.dist <= radiusKm * 1000)
                .sort((a, b) => a.dist - b.dist)
                .map(obj => obj.feature);

            if (top10.length === 0) {
                alert("선택한 반경 안에 추천 상권이 없습니다.");
            }
        }

        if (top10.length > 10) {
            top10 = top10.slice(0, 10);
        }

        drawTop10(
            top10,
            useHomeFilter ? homeX : NaN,
            useHomeFilter ? homeY : NaN,
            useHomeFilter ? radiusKm : 0
        );
    });
}

init();
