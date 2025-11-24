// ============================
// 전역변수
// ============================
let AREAS = [];                 // areas_for_web.geojson
let CONFIG = {};                // config.json
let PREDICTED_MAP = {};         // predicted_money_map.json

let map;
let top10Layer = L.layerGroup();

// ============================
// 거리 계산 함수 (Haversine)
// ============================
function distanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat/2)**2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon/2)**2;

    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ============================
// 팝업 HTML 생성
// ============================
function makePopupHtml(props, rank) {
    const key = `${props["상권_코드_명"]}||${props["업종_대분류"]}`;
    const pm = PREDICTED_MAP[key];

    const pmStr = (pm === null || pm === undefined || isNaN(pm))
        ? "예상 매출: 정보 없음"
        : `예상 매출(predicted): ${Number(pm).toLocaleString()} 원`;

    return `
        🌟 <mark> 순위 ${rank} | ${props["상권_코드_명"]}</mark><br>
        업종: ${props["업종_대분류"]}<br>
        ${pmStr}<br>
        최적 휴일: ${props["최적_휴일"]}<br>
        상권 변화 지표: ${props["상권_변화_지표_명"]}<br>
        집객시설: ${props["Top1"]}, ${props["Top2"]}
    `;
}

// ============================
// 인디케이터 필터링 → Top10 계산
// ============================
function filterAreasForTop10(widgets) {

    const selectedIndustry = widgets.industry;
    const allowedClusters = CONFIG.industry_cluster_map[selectedIndustry] || [];

    let df = [...AREAS];

    // 1) 업종 → 클러스터 필터
    df = df.filter(f => allowedClusters.includes(f.properties.cluster));

    // 2) 피크시간대 필터
    if (widgets.time !== "선택없음") {
        df = df.filter(f => f.properties["피크_시간대_유형"] === widgets.time);
    }

    // 3) 주중/주말 필터
    if (widgets.weekday !== "선택없음") {
        df = df.filter(f => f.properties["주중주말_유형"] === widgets.weekday);
    }

    // 4) 가격대 필터
    if (widgets.price !== "선택없음") {
        df = df.filter(f => f.properties["가격대_유형"] === widgets.price);
    }

    // 빈 경우
    if (df.length === 0) return [];

    // 5) 점포당_매출_num 기반 정렬
    df = df
        .map(f => {
            const sales = Number(f.properties["점포당_매출_num"] || 0);
            return { feature: f, sales };
        })
        .filter(o => !isNaN(o.sales))
        .sort((a, b) => b.sales - a.sales)
        .slice(0, 10);

    // rank + 업종 대분류
    df.forEach((obj, idx) => {
        obj.feature.properties.rank = idx + 1;
        obj.feature.properties["업종_대분류"] = selectedIndustry;
    });

    return df.map(o => o.feature);
}

// ============================
// 지도에 Top10 표시
// ============================
function drawTop10(top10, homeX, homeY, radiusKm) {
    top10Layer.clearLayers();

    const homeLayer = L.layerGroup();

    // 1) 집 + 반경 원
    if (radiusKm > 0 && homeX && homeY) {
        L.marker([homeY, homeX]).addTo(homeLayer);
        L.circle([homeY, homeX], { radius: radiusKm * 1000, color: "blue" })
            .addTo(homeLayer);
    }

    homeLayer.addTo(map);

    // =====================
    // 2) Top10 상권 표시
    // =====================
    top10.forEach((f, idx) => {
        const html = makePopupHtml(f.properties, idx + 1);

        L.geoJSON(f, {
            style: {
                color: "#FF5733",
                weight: 2,
                fillOpacity: 0.3
            },
            onEachFeature: (feature, layer) => {
                layer.bindPopup(html);
            }
        }).addTo(top10Layer);
    });

    top10Layer.addTo(map);
}

// ============================
// 메인 실행
// ============================
async function init() {

    // 지도 생성
    map = L.map("map").setView([37.5665, 126.9780], 11);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')
        .addTo(map);

    // ---- JSON 파일 로드 ----
    const areasData = await fetch("./data/areas_for_web.geojson").then(r => r.json());
    const configData = await fetch("./data/config.json").then(r => r.json());
    const predData = await fetch("./data/predicted_money_map.json").then(r => r.json());

    AREAS = areasData.features;
    CONFIG = configData;
    PREDICTED_MAP = predData;

    // ---- 드롭다운 채우기 ----
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

    // =======================
    // 버튼 클릭 이벤트
    // =======================
    document.getElementById("runBtn").addEventListener("click", () => {

        const widgets = {
            industry: industrySel.value,
            time: timeSel.value,
            weekday: weekdaySel.value,
            price: priceSel.value,
        };

        const homeX = parseFloat(document.getElementById("homeX").value);
        const homeY = parseFloat(document.getElementById("homeY").value);
        const radiusKm = parseFloat(document.getElementById("radius").value);

        let top10 = filterAreasForTop10(widgets);

        // 집 반경 필터
        if (radiusKm > 0 && !isNaN(homeX) && !isNaN(homeY)) {
            top10 = top10.filter(f => {
                const lat = f.properties.center_lat;
                const lon = f.properties.center_lon;
                const d = distanceMeters(homeY, homeX, lat, lon);
                return d <= radiusKm * 1000;
            });
        }

        drawTop10(top10, homeX, homeY, radiusKm);
    });
}

init();
