"""CasSama UI v2: four driver-app screens and the JMB portal, built as a FigCraft script."""
from fc import Doc

# ---- tokens (light) ----
BG, SURF, FG, MUTED, LINE = "#F3F6F5", "#FFFFFF", "#0F1F1B", "#5B6B66", "#E1E8E5"
ACC, ACC2, ACC_SOFT, ACC_INK = "#0B7A68", "#14937D", "#E1F3EE", "#FFFFFF"
AMBER, AMBER_SOFT, RED, RED_SOFT = "#B76E0B", "#FCF0DC", "#C23A2B", "#FBE6E3"
SHADOW = [{"type": "dropShadow", "color": "#0F1F1B1A", "offset": [0, 6], "radius": 20, "spread": 0}]
SHADOW_SM = [{"type": "dropShadow", "color": "#0F1F1B14", "offset": [0, 2], "radius": 8, "spread": 0}]

ICONS = {
    "bolt": "M13 2 4 14h6l-1 8 9-12h-6z",
    "pin": "M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
    "route": "M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 17h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7",
    "map": "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14",
    "clock": "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
    "home": "M4 11 12 4l8 7v9h-5v-6H9v6H4z",
    "search": "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM16 16l4 4",
    "nav": "M3 11 21 3l-8 18-2-8-8-2z",
    "bell": "M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0",
    "building": "M4 21V7l8-4 8 4v14M9 21v-5h6v5M8 10h2M14 10h2M8 13h2M14 13h2",
    "filter": "M4 6h16M7 12h10M10 18h4",
}

d = Doc()


def icon(parent, name, size=20, color=FG, filled=False):
    props = {"strokes": [] if filled else [color], "strokeWeight": 2 * size / 24, "strokeCap": "round", "strokeJoin": "round",
             "fills": [color] if filled else []}
    return d.vector(parent, ICONS[name], size, size, **props)


def t(parent, s, size=14, weight="Regular", color=FG, fill=False, **kw):
    if fill:
        kw.update(sizingH="fill", textAutoResize="height")
    return d.text(parent, s, size, weight, color, **kw)


def row(parent, gap=8, name="row", **kw):
    kw.setdefault("crossAlign", "center")
    return d.box(parent, name, layout="horizontal", gap=gap, **kw)


def col(parent, gap=8, name="col", **kw):
    return d.box(parent, name, layout="vertical", gap=gap, **kw)


def chip(parent, s, fg=ACC, bg=ACC_SOFT, ic=None):
    c = row(parent, 4, "chip", fills=[bg], cornerRadius=999, padding=[5, 10, 5, 10])
    if ic: icon(c, ic, 13, fg, filled=(ic == "bolt"))
    t(c, s, 12, "Semi Bold", fg)
    return c


def meta(parent, ic, s, filled=False):
    r = row(parent, 4, "meta")
    icon(r, ic, 15, MUTED, filled)
    t(r, s, 13, "Medium", MUTED)


def button(parent, s, primary=True, ic=None, grow=False, danger=False):
    color = RED if danger else ACC
    b = row(parent, 6, "button", fills=[color] if primary else [SURF], cornerRadius=14, padding=[14, 18, 14, 18], mainAlign="center",
            strokes=[] if primary else [LINE], strokeWeight=1, sizingH="fill" if grow else "hug")
    if ic: icon(b, ic, 18, ACC_INK if primary else color, filled=(ic == "bolt"))
    t(b, s, 15, "Semi Bold", ACC_INK if primary else color)
    return b


def phone(name, x):
    f = d.frame(None, name, w=390, h=844, x=x, y=0, fills=[BG], layout="vertical", gap=0, clip=True, cornerRadius=36)
    status = row(f, 0, "status bar", sizingH="fill", padding=[14, 24, 6, 24], mainAlign="spaceBetween")
    t(status, "9:41", 15, "Semi Bold", FG)
    t(status, "5G  ▮▮▮  87%", 12, "Semi Bold", FG)
    return f


def tabbar(f, active):
    bar = d.frame(f, "tab bar", w=390, h=86, x=0, y=758, absolute=True, fills=[SURF], layout="horizontal",
                  padding=[8, 12, 22, 12], mainAlign="spaceAround", crossAlign="center",
                  strokes=[LINE], strokeTopWeight=1)
    for ic, label in [("home", "Home"), ("map", "Map"), ("route", "Plan"), ("clock", "Activity")]:
        on = label == active
        it = col(bar, 3, label, crossAlign="center", padding=[6, 14, 6, 14], cornerRadius=14, fills=[ACC_SOFT] if on else [])
        icon(it, ic, 22, ACC if on else MUTED)
        t(it, label, 11, "Semi Bold" if on else "Medium", ACC if on else MUTED)


def section_head(parent, title, link=None):
    h = row(parent, 8, "section head", sizingH="fill", mainAlign="spaceBetween")
    t(h, title, 17, "Bold")
    if link: t(h, link, 14, "Semi Bold", ACC)


# ================= HOME =================
home = phone("Driver · Home", 0)
d.raw("node.set", {"ids": [home], "props": {"fills": [ACC]}})
hdr = col(home, 14, "header", sizingH="fill", padding=[6, 20, 22, 20],
          fills=[{"type": "linearGradient", "stops": [ACC, ACC2]}])
top = row(hdr, 10, "brand", sizingH="fill", mainAlign="spaceBetween")
brand = row(top, 10, "logo")
logo = d.box(brand, "logo mark", fills=["#FFFFFF2E"], cornerRadius=10, padding=6, layout="horizontal")
icon(logo, "bolt", 18, "#FFFFFF", filled=True)
t(brand, "CasSama", 19, "Bold", "#FFFFFF")
bell = d.box(top, "bell", fills=["#FFFFFF24"], cornerRadius=999, padding=8, layout="horizontal")
icon(bell, "bell", 18, "#FFFFFF")
t(hdr, "Good morning, Chee Yang", 14, "Medium", "#FFFFFFCC")
t(hdr, "Where are you charging today?", 24, "Bold", "#FFFFFF", fill=True)
search = row(hdr, 10, "search", sizingH="fill", fills=[SURF], cornerRadius=16, padding=[14, 16, 14, 16], effects=SHADOW_SM)
icon(search, "search", 20, MUTED)
t(search, "Atto 3 at 71%, going to Melaka…", 15, "Regular", MUTED)

body = col(home, 18, "body", sizingH="fill", sizingV="fill", fills=[BG], padding=[18, 20, 100, 20], cornerRadius=[24, 24, 0, 0])
quick = row(body, 0, "quick actions", sizingH="fill", mainAlign="spaceBetween")
for ic, label, filled in [("route", "Plan a trip", False), ("bolt", "Fast DC", True), ("building", "Condo bays", False), ("clock", "Bookings", False)]:
    q = col(quick, 6, label, crossAlign="center")
    tile = d.box(q, "tile", fills=[SURF], cornerRadius=18, padding=16, layout="horizontal", effects=SHADOW_SM)
    icon(tile, ic, 24, ACC, filled)
    t(q, label, 12, "Semi Bold", FG)

section_head(body, "Best for you now", "Change")
hero = col(body, 12, "hero pick", sizingH="fill", fills=[SURF], cornerRadius=22, padding=18, effects=SHADOW)
r = row(hero, 8, "tags")
chip(r, "CASSAMA PICK", ACC_INK, ACC)
chip(r, "Shared now", AMBER, AMBER_SOFT)
t(hero, "Wangsa Walk Mall AC", 21, "Bold", fill=True)
m = row(hero, 14, "meta row", wrap=True, sizingH="fill")
chip(m, "AC 2/4 free")
meta(m, "pin", "1.9 km")
meta(m, "bolt", "22 kW", True)
pr = row(hero, 6, "price", crossAlign="baseline")
t(pr, "RM0.90", 28, "Bold", FG)
t(pr, "/kWh · RM19.80 for 22 kWh", 14, "Medium", MUTED)
why = row(hero, 6, "reasons", wrap=True, sizingH="fill")
for s in ["+8 min detour", "+147 km in 2 h", "90% reliable"]:
    chip(why, s, MUTED, BG)
br = row(hero, 10, "actions", sizingH="fill")
button(br, "Book this bay", True, grow=True)
button(br, "Go", False, "nav")

section_head(body, "Condo bays near you", "See all")
cr = row(body, 12, "condo cards", sizingH="fill", crossAlign="min")
for name, free, km, status, on in [("Serini Park", "AC 3/12 free", "0.3 km", "Shared until 18:00", True), ("Residensi Lumina", "AC 4/10 free", "0.5 km", "Shared until 17:00", True)]:
    c = col(cr, 8, name, fills=[SURF], cornerRadius=18, padding=14, effects=SHADOW_SM, w=230, sizingH="fixed")
    t(c, name, 15, "Bold")
    rr = row(c, 8, "facts")
    chip(rr, free)
    meta(rr, "pin", km)
    t(c, "RM1.10/kWh visitor", 13, "Semi Bold", FG)
    chip(c, status, AMBER if not on else ACC, AMBER_SOFT if not on else ACC_SOFT, "clock")
tabbar(home, "Home")

# ================= MAP =================
mp = phone("Driver · Map", 440)
canvas = d.frame(mp, "map", w=390, h=844, x=0, y=0, index=0, absolute=True, fills=["#E7EEEA"])
for path, w, h, x, y in [("M0 120 C 120 140 220 60 390 90", 390, 120, 0, 160), ("M0 40 C 140 0 260 120 390 60", 390, 120, 0, 420),
                         ("M140 0 C 160 200 120 420 180 844", 120, 844, 120, 0), ("M60 0 C 90 300 300 500 330 844", 300, 844, 40, 0)]:
    v = d.vector(canvas, path, w, h, strokes=["#FFFFFF"], strokeWeight=10, fills=[])
    d.raw("node.set", {"ids": [v], "props": {"x": x, "y": y}})
d.raw("node.set", {"ids": [canvas], "props": {"clip": True}})
for label, x, y, kind in [("RM0.90", 70, 250, "pick"), ("⚡ RM1.30", 220, 330, "ok"), ("RM1.10 · Shared", 120, 410, "shared"),
                          ("RM1.00", 260, 210, "ok"), ("⚡ RM1.70", 40, 520, "busy"), ("RM1.10", 230, 560, "ok")]:
    bg, fg = {"pick": (ACC, "#FFFFFF"), "ok": (SURF, FG), "shared": (AMBER_SOFT, AMBER), "busy": (RED_SOFT, RED)}[kind]
    p = d.box(canvas, "pin " + label, fills=[bg], cornerRadius=999, padding=[6, 10, 6, 10], layout="horizontal", effects=SHADOW_SM)
    t(p, label, 12, "Bold", fg)
    d.raw("node.set", {"ids": [p], "props": {"x": x, "y": y}})
me = d.ellipse(canvas, 18, 18, fills=["#2563EB"], strokes=["#FFFFFF"], strokeWeight=3)
d.raw("node.set", {"ids": [me], "props": {"x": 180, "y": 300}})
over = col(mp, 10, "overlay", sizingH="fill", padding=[0, 16, 0, 16])
sb = row(over, 10, "search", sizingH="fill", fills=[SURF], cornerRadius=16, padding=[13, 16, 13, 16], effects=SHADOW)
icon(sb, "search", 20, MUTED)
t(sb, "Search chargers or places", 15, "Regular", MUTED)
fr = row(over, 8, "filters")
for s, on in [("Available", True), ("Fast DC", False), ("Condo shared", False), ("≤ RM1.00", False)]:
    c = row(fr, 4, "filter", fills=[ACC] if on else [SURF], cornerRadius=999, padding=[7, 12, 7, 12], effects=SHADOW_SM)
    t(c, s, 13, "Semi Bold", "#FFFFFF" if on else FG)
sheet = col(mp, 10, "bottom sheet", w=390, sizingH="fixed", fills=[SURF], cornerRadius=[26, 26, 0, 0], padding=[10, 20, 110, 20],
            effects=[{"type": "dropShadow", "color": "#0F1F1B26", "offset": [0, -6], "radius": 24, "spread": 0}], absolute=True, x=0, y=548,
            crossAlign="center")
grab = d.rect(sheet, 40, 5, fills=[LINE], cornerRadius=3)
hr = row(sheet, 8, "head", sizingH="fill", mainAlign="spaceBetween")
t(hr, "Wangsa Walk Mall AC", 19, "Bold")
chip(hr, "CasSama #1", ACC_INK, ACC)
t(sheet, "ChargEV · Type 2 · Level P1 · Open 24 h", 13, "Medium", MUTED)
m = row(sheet, 14, "facts", wrap=True, sizingH="fill")
chip(m, "AC 2/4 free")
meta(m, "pin", "1.9 km")
meta(m, "bolt", "22 kW", True)
t(m, "RM0.90/kWh", 14, "Bold")
ar = row(sheet, 10, "actions", sizingH="fill")
button(ar, "Book this bay", True, grow=True)
button(ar, "Navigate", False, "nav")
tabbar(mp, "Map")

# ================= PLAN (trip) =================
pl = phone("Driver · Plan", 880)
pb = col(pl, 16, "body", sizingH="fill", padding=[8, 20, 100, 20])
t(pb, "Plan", 28, "Bold")
seg = row(pb, 0, "segmented", sizingH="fill", fills=["#E7EEEA"], cornerRadius=14, padding=4)
for s, on in [("Charge nearby", False), ("Long trip", True)]:
    sgi = row(seg, 0, s, sizingH="fill", mainAlign="center", padding=[10, 0, 10, 0], cornerRadius=11, fills=[SURF] if on else [], effects=SHADOW_SM if on else [])
    t(sgi, s, 14, "Semi Bold", FG if on else MUTED)
route = col(pb, 0, "route card", sizingH="fill", fills=[SURF], cornerRadius=18, padding=[4, 16, 4, 16], effects=SHADOW_SM)
for ic, label, val, last in [("pin", "From", "KL East (current location)", False), ("pin", "To", "Melaka", True)]:
    rw = row(route, 12, label, sizingH="fill", padding=[12, 0, 12, 0], strokes=[] if last else [LINE], strokeTopWeight=0, strokeLeftWeight=0, strokeRightWeight=0, strokeBottomWeight=0 if last else 1)
    icon(rw, ic, 20, ACC)
    cc = col(rw, 2, "txt")
    t(cc, label, 12, "Medium", MUTED)
    t(cc, val, 15, "Semi Bold")
veh = col(pb, 12, "vehicle", sizingH="fill", fills=[SURF], cornerRadius=18, padding=16, effects=SHADOW_SM)
vr = row(veh, 8, "vehicle row", sizingH="fill", mainAlign="spaceBetween")
t(vr, "BYD Atto 3", 16, "Bold")
r2 = row(vr, 6, "specs")
chip(r2, "60.5 kWh", FG, BG)
chip(r2, "CCS2", FG, BG)
for label, val, pct in [("Battery now", "71%", 0.71), ("Arrive with at least", "23%", 0.23)]:
    lr = row(veh, 8, label, sizingH="fill", mainAlign="spaceBetween")
    t(lr, label, 14, "Medium", MUTED)
    t(lr, val, 18, "Bold", ACC)
    track = d.frame(veh, "track", w=318, h=6, fills=[LINE], cornerRadius=3, sizingH="fill")
    d.rect(track, int(318 * pct), 6, fills=[ACC], cornerRadius=3)
res = col(pb, 10, "result", sizingH="fill", fills=[SURF], cornerRadius=18, padding=16, effects=SHADOW)
rr = row(res, 6, "total", crossAlign="baseline")
t(rr, "1 h 58 min", 26, "Bold")
t(rr, "· 172 km", 15, "Medium", MUTED)
t(res, "1 stop · 4 min charging · RM5.77", 14, "Semi Bold", ACC)
for ic, title, sub, pctA, pctB in [("pin", "KL East", "Start", "71%", None), ("bolt", "Ayer Keroh R&R · DC 120 kW", "4 min · 23% → 30%", None, None), ("pin", "Melaka", "Arrive", "26%", None)]:
    st = row(res, 10, title, sizingH="fill")
    dot = d.box(st, "dot", fills=[ACC_SOFT], cornerRadius=999, padding=6, layout="horizontal")
    icon(dot, ic, 14, ACC, filled=(ic == "bolt"))
    cc = col(st, 1, "txt", sizingH="fill")
    t(cc, title, 14, "Semi Bold")
    t(cc, sub, 12, "Medium", MUTED)
    if pctA: chip(st, pctA)
button(pb, "Get directions", True, "nav", grow=True)
tabbar(pl, "Plan")

# ================= ACTIVITY (charging) =================
ac = phone("Driver · Activity", 1320)
ab = col(ac, 16, "body", sizingH="fill", padding=[8, 20, 100, 20], crossAlign="center")
hrow = row(ab, 8, "head", sizingH="fill", mainAlign="spaceBetween")
t(hrow, "Charging", 28, "Bold")
chip(hrow, "Live", ACC_INK, ACC)
t(ab, "KL East Mall DC · Bay 2 · Gentari", 14, "Medium", MUTED)
ring = d.frame(ab, "ring", w=220, h=220, fills=[])
d.ellipse(ring, 220, 220, fills=[LINE], arcInner=0.86)
arc = d.ellipse(ring, 220, 220, fills=[ACC], arcInner=0.86, arcStart=-90, arcSweep=0.43 * 360)
inner = col(ring, 2, "label", crossAlign="center", absolute=True, x=50, y=72, w=120, sizingH="fixed")
t(inner, "43%", 44, "Bold", FG, textAlign="center", sizingH="fill")
t(inner, "+5.0 kWh", 14, "Semi Bold", ACC, textAlign="center", sizingH="fill")
grid = d.box(ab, "stats", layout="grid", gridColumns=2, columnTracks=["1fr", "1fr"], gap=10, crossGap=10, sizingH="fill")
for label, val in [("Cost so far", "RM6.50"), ("Time", "5 min"), ("Full at", "11:32 am"), ("Slot ends", "1:30 pm")]:
    c = col(grid, 2, label, fills=[SURF], cornerRadius=16, padding=14, effects=SHADOW_SM, sizingH="fill")
    t(c, label, 12, "Medium", MUTED)
    t(c, val, 20, "Bold")
note = row(ab, 10, "notice", sizingH="fill", fills=[AMBER_SOFT], cornerRadius=14, padding=14)
icon(note, "clock", 20, AMBER)
t(note, "Move your car by 1:30 pm. After that it is RM1 per 10 min, so the next driver can charge.", 13, "Medium", "#6B4206", fill=True)
button(ab, "Stop charging", False, grow=True, danger=True)
tabbar(ac, "Activity")

# ================= JMB PORTAL =================
jm = d.frame(None, "JMB portal · laptop", w=1440, h=900, x=1800, y=0, fills=[BG], layout="horizontal", gap=0, clip=True, cornerRadius=16)
side = col(jm, 6, "sidebar", w=248, sizingH="fixed", sizingV="fill", fills=[SURF], padding=[24, 16, 24, 16], strokes=[LINE], strokeRightWeight=1)
b = row(side, 10, "brand", padding=[0, 8, 18, 8])
lm = d.box(b, "logo", fills=[ACC], cornerRadius=10, padding=7, layout="horizontal")
icon(lm, "bolt", 18, "#FFFFFF", True)
bc = col(b, 0, "name")
t(bc, "CasSama", 18, "Bold")
t(bc, "JMB PORTAL", 11, "Bold", AMBER, letterSpacing="6%")
for label, on in [("Overview", True), ("Sharing", False), ("Cost recovery", False), ("Live chargers", False), ("Charger health", False), ("Visitors & drivers", False), ("Reports", False)]:
    it = row(side, 10, label, sizingH="fill", padding=[11, 12, 11, 12], cornerRadius=10, fills=[ACC_SOFT] if on else [])
    t(it, label, 14, "Semi Bold" if on else "Medium", ACC if on else MUTED)
main = col(jm, 20, "main", sizingH="fill", sizingV="fill", padding=[28, 32, 28, 32])
top = row(main, 12, "title row", sizingH="fill", mainAlign="spaceBetween")
tc = col(top, 4, "title")
t(tc, "JMB DASHBOARD · OCTOBER 2026", 12, "Bold", MUTED, letterSpacing="6%")
t(tc, "Residensi Lumina", 30, "Bold")
t(tc, "300 units · 10 charging bays · JMB keeps 70% of the operating surplus", 14, "Medium", MUTED)
tr = row(top, 10, "controls")
sel = row(tr, 8, "condo select", fills=[SURF], strokes=[LINE], strokeWeight=1, cornerRadius=12, padding=[10, 14, 10, 14])
t(sel, "Residensi Lumina  ▾", 14, "Semi Bold")
chip(tr, "Logged in as JMB", ACC, ACC_SOFT)
k = row(main, 16, "kpis", sizingH="fill")
for label, val, hero_ in [("Charging income this month", "RM10,062", False), ("JMB share after all costs", "RM3,986", False), ("Saving per unit per month", "RM13.29", True), ("Energy delivered", "10,111 kWh", False)]:
    c = col(k, 6, label, sizingH="fill", fills=[ACC] if hero_ else [SURF], cornerRadius=18, padding=18, effects=SHADOW_SM)
    t(c, label, 13, "Medium", "#FFFFFFCC" if hero_ else MUTED)
    t(c, val, 28, "Bold", "#FFFFFF" if hero_ else FG)
grid2 = row(main, 16, "grid", sizingH="fill", crossAlign="min")
chart = col(grid2, 12, "day chart", sizingH="fill", fills=[SURF], cornerRadius=18, padding=20, effects=SHADOW_SM)
t(chart, "An average day: who charges when", 16, "Bold")
bars = row(chart, 6, "bars", crossAlign="max", h=170, sizingV="fixed", sizingH="fill")
res_ = [0.45, 0.42, 0.38, 0.33, 0.28, 0.24, 0.2, 0.12, 0.08, 0.08, 0.08, 0.1, 0.1, 0.1, 0.1, 0.12, 0.15, 0.25, 0.45, 0.7, 0.85, 0.85, 0.7, 0.55]
vis = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.3, 0.35, 0.36, 0.38, 0.38, 0.36, 0.33, 0.3, 0, 0, 0, 0, 0, 0, 0]
for i in range(24):
    st = col(bars, 0, f"h{i}", crossAlign="center")
    if vis[i]: d.rect(st, 14, int(150 * vis[i]), fills=[AMBER], cornerRadius=[3, 3, 0, 0])
    d.rect(st, 14, max(4, int(150 * res_[i])), fills=[ACC], cornerRadius=[3, 3, 0, 0] if not vis[i] else 0)
lg = row(chart, 16, "legend")
for s, c in [("Residents", ACC), ("Outside drivers (shared bays)", AMBER)]:
    li = row(lg, 6, s)
    d.rect(li, 10, 10, fills=[c], cornerRadius=2)
    t(li, s, 12, "Medium", MUTED)
rec = col(grid2, 8, "cost recovery", w=420, sizingH="fixed", fills=[SURF], cornerRadius=18, padding=20, effects=SHADOW_SM)
t(rec, "Maintenance cost recovery", 16, "Bold")
for label, val, kind in [("Gross charging receipts", "RM10,062", ""), ("− TNB electricity", "RM2,612", ""), ("− Other variable costs", "RM506", ""),
                         ("− Fixed costs", "RM1,250", ""), ("− Repairs logged", "RM0", ""), ("Operating surplus", "RM5,695", "total"), ("JMB share (70%) → maintenance fund", "RM3,986", "hero")]:
    lr = row(rec, 8, label, sizingH="fill", mainAlign="spaceBetween", padding=[7, 0, 7, 0], strokes=[LINE] if kind == "total" else [], strokeTopWeight=1, strokeLeftWeight=0, strokeRightWeight=0, strokeBottomWeight=0)
    col_ = ACC if kind == "hero" else FG
    t(lr, label, 14, "Bold" if kind else "Medium", col_ if kind else MUTED)
    t(lr, val, 14, "Bold" if kind else "Semi Bold", col_)
live = col(main, 12, "live chargers", sizingH="fill", fills=[SURF], cornerRadius=18, padding=20, effects=SHADOW_SM)
lh = row(live, 10, "head", sizingH="fill", mainAlign="spaceBetween")
t(lh, "Live chargers · OCPP 1.6", 16, "Bold")
t(lh, "Site load 34.1 kW of 42 kW", 14, "Semi Bold", AMBER)
bays = row(live, 10, "bays", sizingH="fill")
for i, (st, kw) in enumerate([("Charging", "6.7 kW"), ("Charging", "6.8 kW"), ("Faulted", "GroundFailure"), ("Charging", "6.9 kW"), ("Charging", "6.8 kW"),
                              ("Available", ""), ("Charging", "6.0 kW"), ("Available", ""), ("Available", ""), ("Charging", "6.0 kW")]):
    bg, fg = {"Charging": (ACC_SOFT, ACC), "Available": (BG, MUTED), "Faulted": (RED_SOFT, RED)}[st]
    c = col(bays, 4, f"Bay {i + 1}", sizingH="fill", fills=[bg], cornerRadius=12, padding=10)
    t(c, f"Bay {i + 1}", 12, "Bold", fg)
    t(c, st, 12, "Semi Bold", fg)
    t(c, kw or "—", 11, "Medium", fg)

d.save("design.json")
print("layers:", d.next_id - 2)
