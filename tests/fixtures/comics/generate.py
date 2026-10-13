"""Generate original synthetic PNGs using canvas, no image library or downloaded artwork."""
import base64
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE=Path(__file__).resolve().parent

def main():
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        page=browser.new_page()
        for lang in ['jpn','kor','eng']:
            url=page.evaluate("""lang=>{
              const c=document.createElement('canvas');c.width=680;c.height=840;
              const g=c.getContext('2d');g.fillStyle='white';g.fillRect(0,0,680,840);
              g.strokeStyle='black';g.lineWidth=3;g.strokeRect(12,12,656,816);
              g.fillStyle='black';g.font='bold 48px Meiryo, "Malgun Gothic", Arial';
              if(lang==='jpn'){
                for(const [text,x,y] of [['こんにちは',540,100],['ありがとう',260,440]])
                  [...text].forEach((s,i)=>g.fillText(s,x,y+60*i));
              }else{
                const texts=lang==='kor'?['안녕하세요','감사합니다']:['HELLO FRIEND','GOOD MORNING'];
                g.fillText(texts[0],80,170);g.fillText(texts[1],80,570);
              }
              return c.toDataURL('image/png');
            }""",lang)
            (HERE/(lang+'.png')).write_bytes(base64.b64decode(url.split(',')[1]))
        browser.close()
    print('PASS generated 3 original comic PNG fixtures (canvas)')

if __name__=='__main__': main()
