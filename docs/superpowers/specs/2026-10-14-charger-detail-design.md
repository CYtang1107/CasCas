# Driver page: one column and PlugShare-style charger details

Date: 14 Oct 2026 · Status: approved design

## Layout
Single scrolling column: trip bar (fields in one wrapping row) → map row (tall map; a detail panel beside it on desktop, under it on phones, only while a charger is selected) → best picks (three cards side by side, stacked on phones), "Choose another charger", "Not suitable right now". Booking stages replace the picks and the page scrolls to them.

## Pin click
- Leaflet popup: name, operator, plugs, kW, price/kWh, "Shared now", **Details** button.
- Detail panel: name, address, operator, AC/DC, kW, plugs, bays, pilot label; reliability score with check-in count and the last 3 check-ins; right now (price this hour + peak note, busy %, estimated wait, condo sharing state); for your trip (cost, kWh and range in your stop, walk to destination, detour); verdict ("CasCas pick #2", "Ranked #5 of 14", or the reason it is not suitable); Book this bay (when bookable), Directions (Google Maps), Close.
- Pick cards and the "Choose another charger" list get a Details link that opens the panel and centres the map.

## Code
`engine/detail.js` → `describeCharger({ charger, ranking, condo, date, isResident, checkins })`, pure and unit-tested. The view only renders it. Works in local and shared mode (check-ins from the active source).

Out of scope: photos, in-app navigation.
