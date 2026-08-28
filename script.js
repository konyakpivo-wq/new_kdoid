async function loadRepositories(){
  const list=document.getElementById('repoList');
  try{
    const entries=[];
    for(let id=1; id<=1000; id++){
      const repoRes=await fetch(`apprepo/${id}_repo.txt?${Date.now()}`);
      if(!repoRes.ok){
        if(id>10) break;
        continue;
      }
      const decaRes=await fetch(`apprepo/${id}_deca.txt?${Date.now()}`);
      if(!decaRes.ok) continue;
      const repoText=(await repoRes.text()).trim();
      const decaText=(await decaRes.text()).trim();
      const repoMatch=repoText.match(/repo:\s*(\S+)/i);
      const idMatch=decaText.match(/^id:\s*(\d+)/mi);
      const cidMatch=decaText.match(/^cid:\s*(\d+)/mi);
      const descMatch=decaText.match(/^d:\s*(.*)$/mi);
      if(!repoMatch) continue;
      entries.push({
        id:idMatch?Number(idMatch[1]):id,
        cid:cidMatch?Number(cidMatch[1]):0,
        repo:repoMatch[1],
        description:descMatch?descMatch[1].trim():'Описание отсутствует'
      });
    }
    list.innerHTML='';
    entries.forEach(item=>{
      const card=document.createElement('article'); card.className='repo-card';
      const title=document.createElement('h2'); title.textContent=`ID ${item.id}`;
      const meta=document.createElement('div'); meta.className='cat'; meta.textContent=`CID ${item.cid}`;
      const desc=document.createElement('p'); desc.textContent=item.description;
      const link=document.createElement('a'); link.href=item.repo; link.target='_blank'; link.rel='noopener'; link.textContent='Открыть источник →';
      card.append(title,meta,desc,link); list.appendChild(card);
    });
    if(!entries.length) list.innerHTML='<div class="loading">Каталог пока пуст.</div>';
  }catch(e){
    list.innerHTML='<div class="loading">Не удалось загрузить каталог из apprepo.</div>';
  }
}
