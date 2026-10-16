#!/usr/bin/env python3
"""One ordinary headed visit per public URL; no translation/login/challenge actions."""
import argparse
import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import uuid

from run_acceptance import CACHE, DESKTOP_UA, load_sites, screenshot, unreachable


async def run(args):
    from playwright.async_api import async_playwright
    import run_e2e as canonical
    sites = load_sites()
    unknown = set(args.only)-{s['id'] for s in sites}
    if unknown:
        raise ValueError('Unknown site ids: '+', '.join(sorted(unknown)))
    sites = [s for s in sites if s['id'] in args.only]
    for value in args.url:
        name, sep, url = value.partition('=')
        if not sep or not url.startswith('https://') or name not in args.only:
            raise ValueError('--url requires an explicitly selected ID=https://public-url')
        next(s for s in sites if s['id']==name)['url'] = url
    out = (args.out or CACHE/'v04'/'acceptance'/('headed-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))).resolve()
    if not out.is_relative_to(CACHE.resolve()) or out.exists() and any(out.iterdir()):
        raise ValueError('Use an empty evidence directory inside the external E2E cache')
    out.mkdir(parents=True, exist_ok=True)
    runtime = CACHE/('run-acceptance-headed-'+uuid.uuid4().hex[:8])
    rows = []
    try:
        async with async_playwright() as pw:
            ctx = await pw.chromium.launch_persistent_context(str(runtime/'profile'), headless=False,
                viewport={'width':1280,'height':800}, user_agent=DESKTOP_UA,
                args=['--no-proxy-server','--no-first-run','--no-default-browser-check'])
            try:
                for site in sites:
                    page = await ctx.new_page()
                    await page.bring_to_front()
                    row = {'id':site['id'],'url':site['url'],'headed':True,'user_agent':DESKTOP_UA,
                           'utc':datetime.now(timezone.utc).isoformat(),'fallback_for':site.get('fallback_for')}
                    try:
                        response = await page.goto(site['url'],wait_until='domcontentloaded',timeout=25000)
                        await page.wait_for_timeout(2000)
                        reason = await unreachable(page,response)
                        row.update(status='UNREACHABLE' if reason else 'REACHABLE', reason=reason,
                                   http_status=response.status if response else None, final_url=page.url, title=await page.title())
                        if site['id'].startswith('nhk') and not reason:
                            row['article_links'] = await page.locator('a[href]').evaluate_all("es=>es.map(e=>({text:e.textContent.trim().slice(0,60),url:e.href})).filter(x=>/nhk/.test(x.url)&&/news|article/.test(x.url)).slice(0,100)")
                    except Exception as exc:
                        row.update(status='UNREACHABLE',reason=re.sub(r'https?://\S+','<url>',str(exc).split('Call log:')[0])[:260])
                    row['screenshots'],row['screenshot_errors'] = await screenshot(page,out,site['id']+'-headed',[])
                    rows.append(row)
                    (out/'reachability.json').write_text(json.dumps({'headed':True,'translation_test':False,'rows':rows},ensure_ascii=False,indent=2),encoding='utf-8')
                    print(f"REACHABILITY {row['id']} {row['status']} reason={row.get('reason')}",flush=True)
                    await page.close()
            finally:
                await ctx.close()
    finally:
        canonical.remove_runtime_dir(runtime)
    print(f'SUMMARY headed-reachability total={len(rows)} REACHABLE={sum(r["status"]=="REACHABLE" for r in rows)} UNREACHABLE={sum(r["status"]=="UNREACHABLE" for r in rows)} out={out}')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--only',action='append',required=True)
    ap.add_argument('--out',type=Path)
    ap.add_argument('--url',action='append',default=[],help='One explicit public URL override, ID=https://... (discovery only)')
    asyncio.run(run(ap.parse_args()))
