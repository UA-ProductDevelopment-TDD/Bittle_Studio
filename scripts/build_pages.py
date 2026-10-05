"""Build the GitHub Pages site into _site/: a landing page plus the standalone Bittle Link console.

Bittle Link is plain static files, and GitHub Pages is served over HTTPS, so Web Bluetooth works there.
The packs in saved-motions/ are copied read-only (saving a pack needs the local launcher).
The Studio itself needs its Python simulator, so the landing page points to the download instead.

    python scripts/build_pages.py [--repo-url https://github.com/owner/repo]
"""
import argparse
import html
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'app'))
from packs import list_packs  # noqa: E402

SITE = ROOT / '_site'

LANDING = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bittle Studio</title>
<style>
:root {{ --bg: #f6f7f9; --card: #fff; --text: #1d232b; --muted: #5b6573; --accent: #1f7a4d; --line: #dde2e8; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg: #14181d; --card: #1d232b; --text: #e8ecf1; --muted: #9aa5b3; --accent: #4cc38a; --line: #2c343e; }} }}
* {{ box-sizing: border-box; }}
body {{ margin: 0; background: var(--bg); color: var(--text); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }}
main {{ max-width: 860px; margin: 0 auto; padding: 48px 16px; }}
h1 {{ font-size: 2.2rem; margin: 0 0 8px; }}
.lead {{ color: var(--muted); font-size: 1.1rem; margin: 0 0 32px; }}
.cards {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }}
.card {{ background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 20px; display: flex; flex-direction: column; gap: 8px; }}
.card h2 {{ margin: 0; font-size: 1.2rem; }}
.card p {{ margin: 0; color: var(--muted); flex: 1; }}
.button {{ display: inline-block; align-self: flex-start; background: var(--accent); color: #fff; text-decoration: none; padding: 9px 16px; border-radius: 8px; font-weight: 600; }}
.button.secondary {{ background: transparent; color: var(--accent); border: 1px solid var(--accent); }}
.note {{ color: var(--muted); font-size: .9rem; margin-top: 32px; }}
code {{ background: var(--line); padding: 1px 5px; border-radius: 4px; }}
</style></head>
<body><main>
<h1>Bittle Studio</h1>
<p class="lead">Design, simulate and send motions to a Petoi Bittle robot dog.</p>
<div class="cards">
  <section class="card"><h2>Bittle Link</h2><p>The robot console in your browser: connect over Bluetooth, drive gaits, play Petoi skills and your own saved functions, with a serial monitor. Nothing to install.</p><a class="button" href="bittle-link/">Open Bittle Link</a></section>
  <section class="card"><h2>Bittle Studio</h2><p>The full studio with a 3D viewport and physics simulation runs on your own computer. Download it, run <code>setup.cmd</code>, then <code>launch-studio.cmd</code>.</p><a class="button secondary" href="{repo}">Get it on GitHub</a></section>
  <section class="card"><h2>User guide</h2><p>How to set up servos, build motions, compose buttons and control the robot.</p><a class="button secondary" href="{repo}/blob/master/docs/user-guide.md">Read the guide</a></section>
</div>
<p class="note">Bluetooth from a web page needs Chrome or Edge on desktop or Android. Packs from the repository's <code>saved-motions/</code> folder can be loaded here; to save packs to that folder, use the local launcher.</p>
</main></body></html>
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--repo-url', default='https://github.com/UA-ProductDevelopment-TDD/Bittle_Studio')
    args = parser.parse_args()
    if SITE.exists():
        shutil.rmtree(SITE)
    console = SITE / 'bittle-link'
    shutil.copytree(ROOT / 'app' / 'web' / 'bittle-link', console)
    packs = console / 'saved-motions'
    packs.mkdir()
    listing = list_packs(ROOT / 'saved-motions')
    for item in listing:
        shutil.copy2(ROOT / 'saved-motions' / item['file'], packs / item['file'])
    (packs / 'index.json').write_text(json.dumps({'packs': listing}), encoding='utf-8')
    (SITE / 'index.html').write_text(LANDING.format(repo=html.escape(args.repo_url.rstrip('/'))), encoding='utf-8')
    (SITE / '.nojekyll').write_text('', encoding='utf-8')
    print(f'Site built in {SITE} ({len(listing)} pack(s))')


if __name__ == '__main__':
    main()
