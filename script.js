async function loadRepositories(){
  const list=document.getElementById('repoList');
  try{
    const [repoRes,decaRes]=await Promise.all([fetch('repo.txt?'+Date.now()),fetch('deca.txt?'+Date.now())]);
    if(!repoRes.ok||!decaRes.ok) throw new Error('catalog');
    const repos=(await repoRes.text()).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    const deca=(await decaRes.text()).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    list.innerHTML='';
    repos.forEach((url,i)=>{
      const parts=(deca[i]||'Приложение|Другое|Описание отсутствует').split('|');
      const name=parts[0]||'Приложение'; const category=parts[1]||'Другое'; const description=parts.slice(2).join('|')||'Описание отсутствует';
      const card=document.createElement('article'); card.className='repo-card';
      const title=document.createElement('h2'); title.textContent=name;
      const cat=document.createElement('div'); cat.className='cat'; cat.textContent=category;
      const desc=document.createElement('p'); desc.textContent=description;
      const link=document.createElement('a'); link.href=url; link.target='_blank'; link.rel='noopener'; link.textContent='Открыть источник →';
      card.append(title,cat,desc,link); list.appendChild(card);
    });
    if(!repos.length) list.innerHTML='<div class="loading">Каталог пока пуст.</div>';
  }catch(e){list.innerHTML='<div class="loading">Не удалось загрузить каталог. Проверьте repo.txt и deca.txt.</div>';}
}
