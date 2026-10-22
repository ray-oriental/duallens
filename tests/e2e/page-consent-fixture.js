// Test-only user action for the pre-existing OCR regression suite. Never bundled/released.
// Dedicated page UI tests assert blocking/cancel behavior without this fixture.
(() => {
  const attach=Element.prototype.attachShadow;
  Element.prototype.attachShadow=function(init){
    const root=attach.call(this,init);
    if(this.localName==='dl-ui'){
      const observer=new MutationObserver(()=>{
        const button=root.querySelector('.confirm .primary');
        if(button){observer.disconnect();button.click();}
      });
      observer.observe(root,{childList:true,subtree:true});
    }
    return root;
  };
})();
