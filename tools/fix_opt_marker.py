from pathlib import Path
p=Path('tools/optimize_ui_reads.py')
s=p.read_text(encoding='utf-8')
s=s.replace("// 4. แปลงข้อมูล Firestore → JS", "// 4. แปลงข้อมูลเป็น Firestore Format")
p.write_text(s,encoding='utf-8')
print('optimization helper marker normalized')
