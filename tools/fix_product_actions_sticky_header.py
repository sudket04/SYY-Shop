from pathlib import Path

p=Path('Master_Products.html')
s=p.read_text(encoding='utf-8')
old="#productTable .col-sticky-right{position:sticky;right:0;box-shadow:-2px 0 4px rgba(15,23,42,.05)}"
new="""#productTable{isolation:isolate}\n  #productTable .col-sticky-right{position:sticky;right:0;min-width:120px;width:120px;max-width:120px;box-shadow:-2px 0 4px rgba(15,23,42,.08);background:#fff;background-clip:padding-box}\n  #productTable tbody td.col-sticky-right{z-index:4}\n  #productTable tbody tr:hover td.col-sticky-right{background:#f8fbfe}\n  #productTable thead th.col-sticky-right{position:sticky;top:0;right:0;z-index:25;background:var(--line-soft);background-clip:padding-box;box-shadow:-2px 1px 5px rgba(15,23,42,.10)}\n  #productTable.table-compact thead th.col-sticky-right{position:sticky;top:0;right:0;z-index:25}\n  #productTable.table-compact tbody td.col-sticky-right{position:static;box-shadow:none}"""
if old not in s:
    raise SystemExit('product sticky marker not found')
s=s.replace(old,new,1)
p.write_text(s,encoding='utf-8')
