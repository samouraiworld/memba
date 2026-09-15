"""Collect selected browser evidence without changing image pixels or retaining metadata."""
from pathlib import Path
import re, json, html, struct
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/design/professional-mainnet-2026-09/complete-review'
OUT.mkdir(parents=True, exist_ok=True)
# Selection is deliberately small; the full route matrix remains a CI artifact.
selections = [
 ('home', 'Home', 'core', 'route', 'Synthetic governance and network reads'),
 ('dao', 'DAO directory', 'core', 'route', 'Synthetic DAO directory'),
 ('dao-gno.land-r-gov-dao', 'DAO overview', 'core', 'route', 'Synthetic governance fixture'),
 ('dao-gno.land-r-gov-dao-proposal-4', 'Proposal reader', 'core', 'route', 'Synthetic governance fixture'),
 ('validators-populated', 'Validators', 'core', 'populated-validator', 'Synthetic mixed-health validator roster'),
 ('validators-hacker', 'Advanced monitoring', 'core', 'route', 'Intercepted reads; unavailable monitoring state'),
 ('multisig', 'Multisig workspace', 'account', 'protected', 'Synthetic account; wallet actions disabled'),
 ('tx-7', 'Transaction review', 'account', 'protected', 'Synthetic transfer; wallet actions disabled'),
 ('create-token', 'Token creation', 'account', 'protected', 'Synthetic account; wallet actions disabled'),
 ('dao-create', 'DAO creation', 'account', 'protected', 'Synthetic account; wallet actions disabled'),
 ('settings', 'Settings', 'account', 'protected', 'Synthetic account; wallet actions disabled'),
 ('nft-studio', 'Creator studio', 'ecosystem', 'route-feature', 'Feature fixture; empty or guarded state'),
 ('marketplace', 'Marketplace', 'ecosystem', 'route-feature', 'Feature fixture; empty catalogue'),
 ('apps', 'App Store', 'ecosystem', 'route-feature', 'Feature fixture; empty catalogue'),
 ('feed-timeline', 'Community feed', 'ecosystem', 'populated-community', 'Synthetic public posts; feature fixture'),
 ('feedback', 'Feedback', 'community', 'route', 'Form presentation; no submission'),
 ('quests', 'Quests', 'community', 'route', 'Available and locked quest presentation'),
]
entries=[]
for stem,title,family,kind,state in selections:
 for theme in ['dark','light']:
  for viewport in (['desktop'] if kind=='protected' else ['desktop','mobile']):
   width='1600' if viewport=='desktop' else '390'
   feature=kind in ['route-feature','populated-community']
   base=ROOT/'frontend'/('test-results-complete-features' if feature else 'test-results-complete')
   prefix={'route':'route-coverage','route-feature':'route-coverage','protected':'protected-workflow','populated-validator':'populated-validator-roster','populated-community':'populated-community-feed'}[kind]
   match=f'*{prefix}-{theme}-*chromium/{stem}.png' if kind=='protected' else f'*{prefix}-{theme}-{width}px*chromium/{stem}.png'
   candidates=list(base.glob(match))
   # Targeted follow-up runs keep their evidence separate from the complete matrix.
   for extra in ['test-results-complete-populated','test-results-complete-feature-populated','test-results-complete-protected']:
    candidates.extend((ROOT/'frontend'/extra).glob(match))
   if not candidates: continue
   source=max(candidates,key=lambda p:p.stat().st_mtime)
   raw=source.read_bytes(); clean=raw[:8]; pos=8
   while pos<len(raw):
    size=struct.unpack('>I',raw[pos:pos+4])[0]; tag=raw[pos+4:pos+8]
    chunk=raw[pos:pos+size+12]
    if tag not in [b'eXIf',b'iTXt',b'tEXt',b'zTXt',b'dSIG',b'caBX']: clean+=chunk
    pos+=size+12
   name=f'{stem}-{theme}-{viewport}.png'; (OUT/name).write_bytes(clean)
   entries.append(dict(title=title,family=family,theme='Black' if theme=='dark' else 'Light',viewport=viewport,state=state,image=name,source=str(source.relative_to(ROOT))))
(OUT/'manifest.json').write_text(json.dumps(entries,indent=2)+'\n')
cards='\n'.join(f'<article data-family="{e["family"]}" data-theme="{e["theme"]}" data-viewport="{e["viewport"]}"><h2>{html.escape(e["title"])}</h2><p>{e["theme"]} · {e["viewport"]}</p><a href="{e["image"]}" target="_blank" rel="noopener"><img src="{e["image"]}" loading="lazy" alt="{html.escape(e["title"])} in {e["theme"]}"></a><p class="caption">{html.escape(e["state"])}</p></article>' for e in entries)
page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Memba · Complete design review</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f7f6;color:#18251f;font:16px/1.6 system-ui,sans-serif}header,main{max-width:1500px;margin:auto;padding:32px}header{padding-top:56px}h1{font-size:40px;line-height:1.15;letter-spacing:-1.2px}h2{font-size:20px;margin:0}p{max-width:850px}a{color:#006e57}nav{display:flex;gap:16px;flex-wrap:wrap;margin:24px 0}select{padding:10px;min-height:44px;border:1px solid #718379;border-radius:8px;background:white;font:inherit}label{display:grid;gap:4px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,520px),1fr));gap:24px;padding-top:0}article{background:white;border:1px solid #cfd8d2;border-radius:14px;padding:24px;min-width:0}article img{display:block;width:100%;max-height:650px;object-fit:contain;object-position:top;background:#e9edea;border-radius:8px}article[data-viewport="mobile"] img{max-height:750px}article[hidden]{display:none}.caption{font-size:14px;color:#4c6054}footer{padding:32px;text-align:center}button:focus-visible,a:focus-visible,select:focus-visible{outline:3px solid #006e57;outline-offset:4px}@media(max-width:600px){header,main{padding:20px}h1{font-size:32px}}
</style><header><p>Memba / Professional mainnet design</p><h1>One system. Every workspace.</h1><p>Quiet Confidence, the approved Folded M, and true Black plus Light themes. This selected evidence covers the complete presentation rollout. Images use deterministic fixtures and are labelled below; they do not show real balances, votes or completed transactions.</p><p><a href="https://github.com/samouraiworld/memba/pull/1200">Consolidated PR #1200</a> · <a href="https://deploy-preview-1200--memba-multisig.netlify.app/mainnet/validators">Live PR preview</a> · <a href="../COMPLETE-HANDOFF.md">Technical handoff</a></p><nav aria-label="Filter design evidence"><label>Area<select id="family"><option value="">All areas</option><option value="core">Core workspaces</option><option value="account">Account and treasury</option><option value="ecosystem">Ecosystem</option><option value="community">Community</option></select></label><label>Theme<select id="theme"><option value="">Both themes</option><option>Black</option><option>Light</option></select></label><label>Viewport<select id="viewport"><option value="">All sizes</option><option value="desktop">Desktop</option><option value="mobile">Mobile</option></select></label></nav><p id="count" aria-live="polite"></p></header><main>CARDS</main><footer>Full route screenshots and traces are retained as PR CI artifacts. Production activation is a separate release decision.</footer><script>const selects=[...document.querySelectorAll('select')],cards=[...document.querySelectorAll('article')];function filter(){cards.forEach(c=>c.hidden=selects.some(s=>s.value&&c.dataset[s.id]!==s.value));document.querySelector('#count').textContent=cards.filter(c=>!c.hidden).length+' screens';}selects.forEach(s=>s.addEventListener('change',filter));filter();</script></html>'''
(OUT/'index.html').write_text(page.replace('CARDS',cards))
lines=['# Complete design review','', 'Review the [interactive gallery](complete-review/index.html), [PR #1200](https://github.com/samouraiworld/memba/pull/1200), and [live preview](https://deploy-preview-1200--memba-multisig.netlify.app/mainnet/validators).','', 'All images below are deterministic interface fixtures. Wallet actions are disabled. Capability fixture builds are separate from the hosted preview.','', '| Surface | Theme / size | Evidence |','|---|---|---|']
for e in entries: lines.append(f'| [{e["title"]}](complete-review/{e["image"]}) | {e["theme"]} / {e["viewport"]} | {e["state"]} |')
(OUT.parent/'COMPLETE-REVIEW.md').write_text('\n'.join(lines)+'\n')
print(f'Collected {len(entries)} screenshots in {OUT}')
