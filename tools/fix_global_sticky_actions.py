from pathlib import Path

p = Path('Styles.html')
s = p.read_text(encoding='utf-8')

old = """.table-compact .col-sticky-right{position:static;box-shadow:none}\n.table-standard th,.table-standard td{white-space:nowrap}\n.table-wide th,.table-wide td{white-space:nowrap}\n.table-wide .product-name-cell,.table-wide .models-cell{white-space:normal}\ntbody tr:last-child td{border-bottom:none}\ntbody tr:hover td{background:#f8fbfe}\ntbody tr:hover td:first-child{box-shadow:inset 3px 0 0 var(--primary)}\ntbody tr.sel td{background:#f8fbfe}\ntbody tr.sel td:first-child{box-shadow:inset 3px 0 0 var(--primary)}\n.col-sticky-right{position:sticky;right:0;background:#fff;box-shadow:-2px 0 4px rgba(15,23,42,.04)}\nth.col-sticky-right{z-index:12;background:var(--line-soft)}\ntbody tr:hover td.col-sticky-right{background:#f8fbfe}"""

new = """.table-compact tbody td.col-sticky-right{position:static;box-shadow:none}\n.table-standard th,.table-standard td{white-space:nowrap}\n.table-wide th,.table-wide td{white-space:nowrap}\n.table-wide .product-name-cell,.table-wide .models-cell{white-space:normal}\ntbody tr:last-child td{border-bottom:none}\ntbody tr:hover td{background:#f8fbfe}\ntbody tr:hover td:first-child{box-shadow:inset 3px 0 0 var(--primary)}\ntbody tr.sel td{background:#f8fbfe}\ntbody tr.sel td:first-child{box-shadow:inset 3px 0 0 var(--primary)}\n.col-sticky-right{position:sticky;right:0;background:#fff;background-clip:padding-box;box-shadow:-2px 0 5px rgba(15,23,42,.08)}\ntd.col-sticky-right{z-index:4}\nth.col-sticky-right{position:sticky;top:0;right:0;z-index:30;background:var(--line-soft);background-clip:padding-box;box-shadow:-2px 1px 6px rgba(15,23,42,.10)}\ntbody tr:hover td.col-sticky-right{background:#f8fbfe}"""

if old not in s:
    raise SystemExit('global sticky action CSS marker not found')

s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
