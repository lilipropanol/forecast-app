#!/bin/bash
set -e
cd "$(dirname "$0")"
python3 - <<'PY'
import markdown,re,base64
s=open("Assignment1_Report.md").read()
i=[0]
def rep(m):
    i[0]+=1
    b=base64.b64encode(open(f"fig{i[0]}.png","rb").read()).decode()
    w = "80%" if i[0]==1 else "58%"
    return f'<p class="fig"><img src="data:image/png;base64,{b}" style="width:{w}"></p>'
s=re.sub(r"```mermaid\n.*?```",rep,s,flags=re.S)
body=markdown.markdown(s,extensions=["tables","fenced_code"])
css=open("style.css").read()
open("report.html","w").write(f"<html><head><meta charset='utf-8'><style>{css}</style></head><body>{body}</body></html>")
PY
google-chrome --headless=new --no-sandbox --disable-gpu --no-pdf-header-footer --virtual-time-budget=8000 --print-to-pdf=Assignment1_Report.pdf report.html >/dev/null 2>&1
python3 -c "import re;d=open('Assignment1_Report.pdf','rb').read();print('pages:',len(re.findall(rb'/Type\s*/Page[^s]',d)))"
grep -v '^|' Assignment1_Report.md | grep -v '^\*\*Figure' | sed '/```mermaid/,/```/d' | wc -w
