# Seoul — Where Do You Want to Start?

### Restaurant Startup Location Indicator

[**Explore the live map →**](https://seohyun4872.github.io/Seoul_Where-do-you-want-to-start-/) · [한국어](README.ko.md)

An interactive map that helps prospective restaurant owners explore commercial districts in Seoul. The project brings the final outputs of a commercial-area analysis into a web interface, making it easier to compare locations that match a planned business concept.

## Why this project?

Choosing where to open a restaurant involves more than finding an area with high sales. The location also needs to fit the type of food, peak trading hours, weekday/weekend demand, price positioning, and the owner's preferred distance from home.

This indicator lets users explore those conditions together and view matching areas on a map.

## Team project and my role

A **team project for the DArt-B Fall 2025 Academic Showcase**.

- **Team members:** 김미정, 김태연, 권남정, 노동희, 박서현, 신혜성
- **Seohyun Park's role:** Data preprocessing and implementation of the web-based startup indicator

The team worked on commercial-area analysis and indicator design. My responsibilities covered preprocessing the analysis data and building the web interface that lets users explore the final results through location and operating-preference filters.

## Data sources

| Item | Details |
| --- | --- |
| Source | Seoul commercial-area public datasets from the [Seoul Open Data Plaza](https://data.seoul.go.kr/) |
| Reference period | Q4 2024 |
| Integration keys | Commercial-area and business-category identifiers |
| Main inputs | Sales, transactions, store counts, floating/resident/working populations, income, expenditure, facilities, and commercial-area change indicators |
| Final analysis sample | 1,026 commercial areas with at least three food-service categories |

## Analytical approach

| Stage | Method and purpose |
| --- | --- |
| Missing values | Checked component values against totals before assigning zeros. Used earlier observations from the same area where available and random forest regression for remaining gaps. For expenditure fields, estimated totals and component shares to preserve consistency. |
| Outlier review | Checked total sales against time-slot sales, alongside store counts and operating patterns. Reviewed unusually large values and zeros in context. |
| Business-type clusters | Applied Robust scaling and PCA to category sales shares, then formed ten K-means clusters. Compared configurations with Silhouette, Calinski–Harabasz, and Davies–Bouldin metrics and mapped business categories to clusters using their profiles. |
| Price positioning | Compared category-specific K-means, Gaussian mixture models, and IQR-based methods to define budget, mid-range, and premium groups. |
| Trading hours | Used the Friedman test to examine differences in time-slot sales and distribution-based thresholds to distinguish lunch, evening, late-night, and balanced patterns. |
| Trading days | Defined Friday–Saturday as the analytical weekend and Sunday–Thursday as weekdays based on observed patterns. Used average daily sales, MinMax scaling, HDBSCAN, and IQR thresholds to identify weekday/weekend/balanced and stronger patterns. |
| Population indicators | Examined floating, resident, and working-population variables. Checked multicollinearity with VIF and selected variables whose importance appeared across multiple models for the industry explanations. |
| Days off and context | Examined sales differences across days and clusters to suggest possible days off. Added facility and commercial-area change information to help interpret locations. |

The presentation defines an **adjusted representative sales indicator** using sales per store, local category sales shares, and location quotients (LQ). The current website orders recommendations using the stored `점포당_매출_num` field. Popup sales estimates come from a separate data lookup.

## What you can do

| Feature | What it shows |
| --- | --- |
| Business type | Ten categories, including Korean, Western, Japanese, Chinese, snack food, chicken, coffee, bakery, fast food, and pubs |
| Trading patterns | Filters for peak hours, weekday/weekend patterns, and price positioning |
| Distance preferences | Optional home coordinates and a 3, 5, or 10 km radius, with nearby or outside-radius options |
| Top 10 areas | Matching districts ranked by the stored sales-per-store indicator |
| Map details | Area name, estimated sales where available, suggested day off, commercial-area change indicator, and major visitor-attracting facilities |
| Industry notes | Prewritten explanations accompanying each business type |

## Try it

1. [Open the live map](https://seohyun4872.github.io/Seoul_Where-do-you-want-to-start-/). The interface is in Korean.
2. Select a business type. Leave the other filters at **선택없음** (no preference) for a broad starting point.
3. Optionally narrow the peak hours, weekday/weekend pattern, and price range.
4. For distance-based filtering, enter longitude in **집 X(경도)** and latitude in **집 Y(위도)**, then choose a radius and proximity preference. Otherwise leave **직주근접** at **상관없음**.
5. Click **상권 추천** (recommend areas). Compare the Top 10 list and click highlighted districts or TOP 1–3 markers for details.

If no areas match, relax one or more filters.

## How recommendations work

The browser loads the prepared analysis outputs, matches the selected business type to configured clusters, and applies the user's trading-pattern and optional distance filters. It then returns up to ten areas sorted by the stored sales-per-store value.

Estimated sales are loaded separately for each area/business-type pair and shown in the map popup. They do **not** determine the Top 10 ordering. Distance is measured from the entered coordinates to each area's center, rather than by road or travel time.

## From analysis to an accessible tool

This repository contains the web presentation of the analysis results: a filter-based interface, interactive geographic visualization, and supporting JSON/GeoJSON data. The page reads prepared outputs rather than retraining a model when a visitor changes the filters.

## Built with

**HTML · CSS · JavaScript · Leaflet · JSON / GeoJSON · GitHub Pages**

| File | Purpose |
| --- | --- |
| [index.html](index.html) | Page layout, controls, and styles |
| [app.js](app.js) | Data loading, filtering, ranking, distance calculations, and map interactions |
| [data/areas_for_web.geojson](data/areas_for_web.geojson) | Area geometries and analysis attributes |
| [data/config.json](data/config.json) | Business-type/cluster mapping and filter options |
| [data/predicted_money_map.json](data/predicted_money_map.json) | Prepared estimated-sales values by area and business type |
| [data/industry_sentences.json](data/industry_sentences.json) | Business-type explanations |

The map is an exploratory aid for comparing candidate locations. Sales values and rankings reflect the supplied analysis data rather than a live market feed or guaranteed future revenue.

## References

References listed in the team's presentation. Original Korean titles are retained for identification.

1. 간형식, 양재형, 안영진(2020). 「국내 외식 자영업의 문제점 연구와 마케팅 극복전략」. 상품학연구, 38(3), 89–98.
2. 김양기(2024). 「자영업자의 창업준비과정이 경영성과에 미치는 영향에 관한 연구」. 산업혁신연구, 40(2), 254–265.
3. 오흥록, 배범석, 문혜정(2017). 「빅데이터 분석을 통한 서울시 골목상권 분석」. 한국경영학회 융합학술대회, 2017(8), 344–372.
