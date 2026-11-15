/* مساعدي — مساعد شخصي مصري.
   وضعين: فوري مجاني من غير مفتاح (مزود عام)، أو أقوى بمفتاح Gemini المجاني بتاع المستخدمة.
   المهام والملاحظات والتنبيهات والذاكرة والمحادثة محفوظة على الجهاز (localStorage).
   نص المحادثة بيتبعت للمزود عشان يرد — مفيش سيرفر لينا في النص. */
'use strict';

/* ============ تخزين ============ */
const store = {
  get(k, d){ try{ const v = localStorage.getItem('oa_'+k); return v===null? d : JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ localStorage.setItem('oa_'+k, JSON.stringify(v)); },
  del(k){ localStorage.removeItem('oa_'+k); }
};

/* ============ نماذج جوجل المجانية: اكتشاف تلقائي + ترتيب ============ */
function rankModels(list){
  const bad = /(embed|aqa|bison|gecko|tts|image|imagen|veo|audio|robot|computer-use|vision-)/i;
  const ok = list.filter(m => (m.supportedGenerationMethods||[]).includes('generateContent')
    && /gemini/i.test(m.name||'') && !bad.test(m.name||''));
  const score = m => {
    const n = (m.name||'').toLowerCase();
    let s = 0;
    const nums = n.match(/\d+(\.\d+)?/g); if(nums) s += Math.max(...nums.map(Number))*100;
    if(n.includes('flash')) s += 50;
    if(n.includes('pro')) s -= 30;
    if(n.includes('lite')) s -= 20;
    if(n.includes('preview')||n.includes('exp')) s -= 15;
    return s;
  };
  return ok.sort((a,b)=>score(b)-score(a)).map(m=>(m.name||'').replace(/^models\//,''));
}
const FALLBACK_MODELS = ['gemini-2.5-flash','gemini-2.5-flash-lite','gemini-2.0-flash','gemini-2.0-flash-lite'];

async function discoverModels(key){
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {headers:{'x-goog-api-key':key}});
  if(!res.ok) throw new Error('list '+res.status);
  const data = await res.json();
  const ranked = rankModels(data.models||[]);
  if(ranked.length) store.set('modelrank', ranked);
  return ranked;
}
function modelChain(){
  const out = [];
  const last = store.get('lastgood', null);
  if(last) out.push(last);
  (store.get('modelrank', [])||[]).forEach(m=>{ if(!out.includes(m)) out.push(m); });
  FALLBACK_MODELS.forEach(m=>{ if(!out.includes(m)) out.push(m); });
  return out;
}

/* ============ وصف الأدوات (للوضعين) ============ */
const FN_DECLS = [
  {name:'get_datetime', description:'يرجع التاريخ والوقت الحاليين', parameters:{type:'OBJECT',properties:{}}},
  {name:'calculate', description:'عملية حسابية: جمع وطرح وضرب وقسمة وأقواس', parameters:{type:'OBJECT',properties:{expression:{type:'STRING',description:'مثال: (2500*12)/7'}},required:['expression']}},
  {name:'add_task', description:'يضيف مهمة جديدة لقائمة مهامها', parameters:{type:'OBJECT',properties:{title:{type:'STRING'}},required:['title']}},
  {name:'list_tasks', description:'يرجع كل المهام المفتوحة والمخلصة بأرقامها', parameters:{type:'OBJECT',properties:{}}},
  {name:'complete_task', description:'يخلّص مهمة برقمها أو جزء من اسمها', parameters:{type:'OBJECT',properties:{task:{type:'STRING'}},required:['task']}},
  {name:'delete_task', description:'يمسح مهمة برقمها أو جزء من اسمها', parameters:{type:'OBJECT',properties:{task:{type:'STRING'}},required:['task']}},
  {name:'save_note', description:'يحفظ ملاحظة أو نص حرفي زي ما اتكتب', parameters:{type:'OBJECT',properties:{title:{type:'STRING'},body:{type:'STRING'}},required:['title','body']}},
  {name:'list_notes', description:'يرجع عناوين كل الملاحظات المحفوظة', parameters:{type:'OBJECT',properties:{}}},
  {name:'read_note', description:'يقرأ ملاحظة بعنوانها أو جزء منه', parameters:{type:'OBJECT',properties:{title:{type:'STRING'}},required:['title']}},
  {name:'delete_note', description:'يمسح ملاحظة بعنوانها أو جزء منه', parameters:{type:'OBJECT',properties:{title:{type:'STRING'}},required:['title']}},
  {name:'set_reminder', description:'ينبهها برسالة في وقت معين. بينفذ طالما التطبيق مفتوح على الجهاز', parameters:{type:'OBJECT',properties:{text:{type:'STRING'},in_minutes:{type:'NUMBER',description:'بعد كام دقيقة من دلوقتي'},at:{type:'STRING',description:'تاريخ ووقت بصيغة ISO مثل 2026-11-15T18:30:00'}},required:['text']}},
  {name:'list_reminders', description:'يرجع التنبيهات اللي لسه جاية', parameters:{type:'OBJECT',properties:{}}},
  {name:'cancel_reminder', description:'يلغي تنبيه برقمه أو جزء من نصه', parameters:{type:'OBJECT',properties:{which:{type:'STRING'}},required:['which']}},
  {name:'remember', description:'يحفظ معلومة دائمة عنها (ذوق، اسم، عادة، رقم مهم)', parameters:{type:'OBJECT',properties:{fact:{type:'STRING'}},required:['fact']}},
  {name:'forget', description:'ينسى معلومة محفوظة عنها', parameters:{type:'OBJECT',properties:{fact:{type:'STRING'}},required:['fact']}},
  {name:'search_web', description:'يدور على النت عن معلومة حالية أو خبر أو سعر (محتاج مفتاح جوجل)', parameters:{type:'OBJECT',properties:{query:{type:'STRING'}},required:['query']}}
];

/* ============ شخصية المساعد ============ */
function personaBlock(){
  const name = store.get('name','مساعدي') || 'مساعدي';
  const mem = store.get('memory', []);
  const now = new Date().toLocaleString('ar-EG', {weekday:'long', year:'numeric', month:'long', day:'numeric', hour:'numeric', minute:'2-digit'});
  return [
    `انت "${name}" — مساعد شخصي لوحدها، بتتكلم بالعامية المصرية وبتنفذ مهام حقيقية بالأدوات اللي معاك.`,
    `قواعدك:`,
    `- ردودك قصيرة ومباشرة، من غير تطبيل ولا كلام حلو فاضي. لو حاجة مش هتعرف تعملها قولها صراحة.`,
    `- لو طلبت حاجة ليها أداة، نفذ بالأداة على طول من غير ما تستأذن، وبعد التنفيذ قولها اتعمل إيه في سطر.`,
    `- لو طلبت تحفظ نص، احفظه حرفي زي ما هي كاتباه بالضبط من غير أي تغيير.`,
    `- لو سألت عن الوقت أو التاريخ استخدم get_datetime. لو عملية حسابية استخدم calculate.`,
    `- لو سألت عن خبر أو معلومة بتتغير استخدم search_web لو متاح.`,
    `- لو قالتلك معلومة عنها تستاهل تفتكرها استخدم remember.`,
    `- التنبيهات بتشتغل طالما التطبيق مفتوح بس.`,
    `- ممنوع تدّعي إنك عملت حاجة معملتاش. ممنوع إيموجي إلا لو هي بدأت.`,
    `دلوقتي: ${now} (توقيت القاهرة).`,
    mem.length ? `معلومات محفوظة عنها:\n` + mem.map(m=>'- '+m).join('\n') : ''
  ].filter(Boolean).join('\n');
}
function systemPromptGemini(){ return personaBlock(); }


/* ============ تنفيذ الأدوات محليًا ============ */
function safeCalc(expr){
  const e = String(expr).replace(/[٠-٩]/g, d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[×✕]/g,'*').replace(/÷/g,'/').replace(/,/g,'');
  if(!/^[\d\s+\-*/().%^]+$/.test(e)) return {error:'صيغة مش مفهومة'};
  try{
    const val = Function('"use strict"; return ('+ e.replace(/\^/g,'**') +')')();
    if(typeof val !== 'number' || !isFinite(val)) return {error:'النتيجة مش رقم'};
    return {result: Math.round(val*1e10)/1e10};
  }catch(_){ return {error:'صيغة مش مفهومة'}; }
}
function findByNumOrText(list, q, label){
  q = String(q||'').trim();
  const n = parseInt(q, 10);
  if(!isNaN(n) && n>=1 && n<=list.length) return list[n-1];
  return list.find(x => (x[label]||'').includes(q)) || null;
}

const timers = {};
const Tools = {
  get_datetime(){ return {now: new Date().toLocaleString('ar-EG',{weekday:'long',year:'numeric',month:'long',day:'numeric',hour:'numeric',minute:'2-digit'}), iso: new Date().toISOString()}; },
  calculate(a){ return safeCalc(a.expression); },
  add_task(a){ const t = store.get('tasks',[]); t.push({title:String(a.title).trim(), done:false, at:Date.now()}); store.set('tasks',t); return {ok:true, count:t.length}; },
  list_tasks(){ const t = store.get('tasks',[]); if(!t.length) return {result:'مفيش مهام'}; return {tasks: t.map((x,i)=>({n:i+1, title:x.title, done:x.done}))}; },
  complete_task(a){ const t = store.get('tasks',[]); const hit = findByNumOrText(t, a.task, 'title'); if(!hit) return {error:'ملقيتش المهمة دي'}; hit.done = true; store.set('tasks',t); return {ok:true, task:hit.title}; },
  delete_task(a){ let t = store.get('tasks',[]); const hit = findByNumOrText(t, a.task, 'title'); if(!hit) return {error:'ملقيتش المهمة دي'}; t = t.filter(x=>x!==hit); store.set('tasks',t); return {ok:true}; },
  save_note(a){ const n = store.get('notes',[]); const ex = n.find(x=>x.title===String(a.title).trim()); if(ex){ ex.body = String(a.body); } else { n.push({title:String(a.title).trim(), body:String(a.body), at:Date.now()}); } store.set('notes',n); return {ok:true}; },
  list_notes(){ const n = store.get('notes',[]); if(!n.length) return {result:'مفيش ملاحظات'}; return {notes: n.map((x,i)=>({n:i+1, title:x.title}))}; },
  read_note(a){ const n = store.get('notes',[]); const hit = findByNumOrText(n, a.title, 'title'); if(!hit) return {error:'ملقيتش الملاحظة دي'}; return {title:hit.title, body:hit.body}; },
  delete_note(a){ let n = store.get('notes',[]); const hit = findByNumOrText(n, a.title, 'title'); if(!hit) return {error:'ملقيتش الملاحظة دي'}; n = n.filter(x=>x!==hit); store.set('notes',n); return {ok:true}; },
  set_reminder(a){
    let when;
    if(typeof a.in_minutes === 'number') when = Date.now() + a.in_minutes*60000;
    else if(a.at){ when = new Date(a.at).getTime(); }
    if(!when || isNaN(when)) return {error:'مش فاهم المعاد'};
    if(when <= Date.now()) return {error:'المعاد عدّى خلاص'};
    const r = store.get('reminders',[]);
    const item = {id:'r'+Date.now()+Math.floor(Math.random()*1000), text:String(a.text), at:when};
    r.push(item); store.set('reminders',r); scheduleReminder(item);
    return {ok:true, at:new Date(when).toLocaleString('ar-EG',{weekday:'long',hour:'numeric',minute:'2-digit',day:'numeric',month:'numeric'}), note:'هيوصل طالما التطبيق مفتوح'};
  },
  list_reminders(){ const r = store.get('reminders',[]).filter(x=>x.at>Date.now()); if(!r.length) return {result:'مفيش تنبيهات'}; return {reminders: r.map((x,i)=>({n:i+1, text:x.text, at:new Date(x.at).toLocaleString('ar-EG')}))}; },
  cancel_reminder(a){ let r = store.get('reminders',[]); const hit = findByNumOrText(r, a.which, 'text'); if(!hit) return {error:'ملقيتش التنبيه ده'}; if(timers[hit.id]) clearTimeout(timers[hit.id]); r = r.filter(x=>x!==hit); store.set('reminders',r); return {ok:true}; },
  remember(a){ const m = store.get('memory',[]); const f = String(a.fact).trim(); if(!m.includes(f)) m.push(f); store.set('memory',m); return {ok:true}; },
  forget(a){ let m = store.get('memory',[]); const hit = m.find(x=>x.includes(String(a.fact).trim())); if(!hit) return {error:'ملقيتش المعلومة دي'}; m = m.filter(x=>x!==hit); store.set('memory',m); return {ok:true}; },
  async search_web(a){
    if(!hasKey()) return {error:'البحث على النت محتاج مفتاح جوجل المجاني. من القائمة ← الإعدادات'};
    try{
      const out = await geminiSearch(a.query);
      return {result: out || 'ملقيتش إجابة واضحة'};
    }catch(e){ return {error:'البحث مش متاح دلوقتي ('+e.message+')'}; }
  }
};

function scheduleReminder(item){
  const delay = item.at - Date.now();
  if(delay < 0) return;
  if(delay > 2147483647) return;
  if(timers[item.id]) clearTimeout(timers[item.id]);
  timers[item.id] = setTimeout(()=>fireReminder(item), delay);
}
function fireReminder(item){
  let r = store.get('reminders',[]);
  r = r.filter(x=>x.id!==item.id); store.set('reminders',r);
  beep();
  if('Notification' in window && Notification.permission==='granted'){
    try{ new Notification(store.get('name','مساعدي'), {body:item.text}); }catch(_){}
  }
  addMsg('ai', 'تنبيه: '+item.text);
}
function beep(){
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination); o.frequency.value = 880;
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    o.start(); o.stop(ctx.currentTime+0.25);
  }catch(_){}
}

/* ============ مزود جوجل (بمفتاح) ============ */
const API = 'https://generativelanguage.googleapis.com/v1beta/models/';
function hasKey(){ return !!store.get('key',''); }
function hasGroqKey(){ return !!store.get('groq_key',''); }

async function rawGenerate(key, model, body){
  const res = await fetch(API+encodeURIComponent(model)+':generateContent', {
    method:'POST', headers:{'Content-Type':'application/json','x-goog-api-key':key}, body:JSON.stringify(body)
  });
  if(!res.ok){
    let msg = 'خطأ '+res.status;
    try{ const j = await res.json(); msg = (j.error&&j.error.message)||msg; }catch(_){}
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return res.json();
}
async function callGeminiRaw(body){
  const key = store.get('key','');
  if(!key) throw new Error('مفيش مفتاح');
  let lastErr = null;
  for(const model of modelChain()){
    try{
      const out = await rawGenerate(key, model, body);
      store.set('lastgood', model);
      return out;
    }catch(e){
      lastErr = e;
      if(e.status===401||e.status===403) throw e;
      if(e.status===400 && /api key|key not valid|permission/i.test(e.message)) throw e;
      // غير كده (ضغط/مش موجود/خطأ سيرفر): جرب اللي بعده
    }
  }
  throw lastErr || new Error('كل النماذج مشغولة دلوقتي');
}
async function geminiSearch(query){
  const body = {contents:[{role:'user', parts:[{text:'دور ورد عليّ: '+query+'\n\nجاوب بالمصري في ٣ أسطر بالمعلومة الحالية، ولو ملقتش حاجة مؤكدة قول كده.'}]}],
    tools:[{google_search:{}}], generationConfig:{temperature:0.4, maxOutputTokens:1024}};
  let data;
  try{ data = await callGeminiRaw(body); }
  catch(e){ delete body.tools; data = await callGeminiRaw(body); }
  const cand = data.candidates && data.candidates[0];
  return cand && cand.content ? (cand.content.parts||[]).map(p=>p.text||'').join('').trim() : '';
}
// دورة شات كاملة بموديل جوجل مع function calling أصلي
async function geminiChatRound(chatLog, userParts){
  const contents = chatLog.slice(-18).map(m=>({role: m.role==='user'?'user':'model', parts:[{text:m.text}]}));
  contents.push({role:'user', parts:userParts});
  let rounds = 0;
  while(rounds < 6){
    rounds++;
    const data = await callGeminiRaw({
      contents,
      systemInstruction:{parts:[{text:systemPromptGemini()}]},
      tools:[{functionDeclarations:FN_DECLS}],
      generationConfig:{temperature:0.7, maxOutputTokens:2048}
    });
    const cand = data.candidates && data.candidates[0];
    if(!cand || !cand.content) throw new Error('مفيش رد');
    contents.push(cand.content);
    const fns = (cand.content.parts||[]).filter(p=>p.functionCall);
    if(!fns.length){
      return (cand.content.parts||[]).map(p=>p.text||'').join('').trim() || 'تم.';
    }
    const respParts = [];
    for(const p of fns){
      const {name, args} = p.functionCall;
      addToolLine('بينفذ: '+name);
      let out;
      try{ out = await (Tools[name] ? Tools[name](args||{}) : {error:'أداة مش معروفة'}); }
      catch(e){ out = {error:String(e.message||e)}; }
      respParts.push({functionResponse:{name, response:out}});
    }
    contents.push({role:'user', parts:respParts});
  }
  return 'عملت اللي أقدر عليه. لو في حاجة ناقصة قوليلي.';
}

/* ============ الوضع الفوري المجاني (من غير مفتاح) ============ */
const FREE_URL = 'https://text.pollinations.ai/';
function parseToolCall(text){
  if(!text) return null;
  let t = text.trim().replace(/^```(?:json)?/i,'').replace(/```$/,'').trim();
  const tryParse = s => { try{ const o = JSON.parse(s); return (o && typeof o.tool==='string') ? o : null; }catch(_){ return null; } };
  let o = tryParse(t);
  if(o) return o;
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  if(i>=0 && j>i) return tryParse(t.slice(i, j+1));
  return null;
}
// المزود المجاني OpenAI-compatible وبيدعم tool calling أصلي — بنحول وصف الأدوات لصيغته
const FREE_TOOLS = FN_DECLS.map(f=>({type:'function', function:{
  name:f.name, description:f.description,
  parameters:Object.assign({}, f.parameters, {type:String(f.parameters&&f.parameters.type||'object').toLowerCase()})
}}));
// توحيد أشكال رد المزود: نص عادي، كائن فيه content، أو tool_calls
function parseFreeResponse(txt){
  const t = (txt||'').trim();
  let o = null;
  if(t.startsWith('{')){ try{ o = JSON.parse(t); }catch(_){}}
  if(o){
    const msg = (o.choices && o.choices[0] && o.choices[0].message) ? o.choices[0].message : o;
    const tcs = msg.tool_calls || [];
    const calls = tcs.filter(tc=>tc.function && Tools[tc.function.name]).map(tc=>{
      let args = {}; try{ args = JSON.parse(tc.function.arguments||'{}'); }catch(_){}
      return {name:tc.function.name, args};
    });
    if(calls.length) return {calls};
    // ردود بتخفي النص جوه استدعاء وهمي اسمه final
    const finalTc = tcs.find(tc=>tc.function && /final/i.test(tc.function.name||''));
    if(finalTc){
      const a = finalTc.function.arguments || '';
      const legacy = parseToolCall(a);
      if(legacy && Tools[legacy.tool]) return {calls:[{name:legacy.tool, args:legacy.args||{}}]};
      try{ const ao = JSON.parse(a); if(ao && typeof ao.content==='string') return {text:ao.content}; }catch(_){}
      if(a.trim()) return {text:a};
    }
    if(typeof msg.content === 'string' && msg.content.trim()) return {text:msg.content.trim()};
    if(typeof o.content === 'string' && o.content.trim()) return {text:o.content.trim()};
  }
  const legacy = parseToolCall(t);
  if(legacy && Tools[legacy.tool]) return {calls:[{name:legacy.tool, args:legacy.args||{}}]};
  return {text:t};
}
async function freeChat(messages, retryAfterSec){
  const res = await fetch(FREE_URL, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({messages, model:'openai', private:true, tools:FREE_TOOLS})
  });
  const txt = await res.text();
  const m = txt.match(/Free limit reached: 1 reply every 45 seconds.*?wait (\d+) seconds/i);
  if(m){
    const wait = (+m[1] + 2);
    if((retryAfterSec||0) + wait > 120) throw new Error('الخدمة المجانية عليها ضغط دلوقتي، جربي بعد دقيقة');
    setTyping('الخدمة المجانية عليها ضغط، مستنية '+wait+' ثانية…');
    await new Promise(r=>setTimeout(r, wait*1000));
    return freeChat(messages, (retryAfterSec||0)+wait);
  }
  if(!res.ok) throw new Error('خطأ '+res.status);
  if(/^error/i.test(txt.trim())) throw new Error(txt.trim().slice(0,120));
  return parseFreeResponse(txt);
}
/* ============ مزود Groq (بمفتاح مجاني، OpenAI-compatible) ============ */
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
async function groqChat(messages, retryAfterSec){
  const res = await fetch(GROQ_URL, {
    method:'POST',
    headers:{'Content-Type':'application/json', 'Authorization':'Bearer '+store.get('groq_key','')},
    body: JSON.stringify({model:'openai/gpt-oss-120b', messages, tools:FREE_TOOLS})
  });
  if(res.status===429){
    const ra = parseFloat(res.headers.get('retry-after')) || 20;
    const wait = Math.min(Math.ceil(ra)+2, 60);
    if((retryAfterSec||0) + wait > 120) throw new Error('الخدمة عليها ضغط دلوقتي، جربي بعد دقيقة');
    setTyping('ضغط مؤقت، مستنية '+wait+' ثانية…');
    await new Promise(r=>setTimeout(r, wait*1000));
    return groqChat(messages, (retryAfterSec||0)+wait);
  }
  if(res.status===401 || res.status===403){ const err = new Error('مفتاح Groq مش شغال'); err.status = res.status; throw err; }
  const txt = await res.text();
  if(!res.ok) throw new Error('خطأ '+res.status);
  return parseFreeResponse(txt);
}
// صياغة محلية فورية لنتيجة الأداة — من غير مكالمة ثانية للمزود
function renderToolResult(name, args, out){
  args = args||{}; out = out||{};
  if(out.error) return String(out.error);
  switch(name){
    case 'add_task': return 'سجلتها في المهام: '+args.title;
    case 'complete_task': return 'خلّصتها: '+out.task;
    case 'delete_task': return 'اتمسحت من المهام.';
    case 'list_tasks': {
      if(!out.tasks) return 'مفيش مهام مسجلة.';
      const open = out.tasks.filter(t=>!t.done), done = out.tasks.filter(t=>t.done);
      let s = open.length ? 'المهام المفتوحة:\n'+open.map(t=>t.n+'- '+t.title).join('\n') : 'مفيش مهام مفتوحة.';
      if(done.length) s += '\nالمخلّصة: '+done.map(t=>t.title).join('، ');
      return s;
    }
    case 'save_note': return 'اتحفظت في الملاحظات: '+args.title;
    case 'read_note': return out.title+':\n'+out.body;
    case 'list_notes': return out.notes ? 'الملاحظات المحفوظة:\n'+out.notes.map(n=>n.n+'- '+n.title).join('\n') : 'مفيش ملاحظات.';
    case 'delete_note': return 'اتمسحت من الملاحظات.';
    case 'set_reminder': return 'هفكرك: '+args.text+' — '+out.at+' (طالما التطبيق مفتوح).';
    case 'list_reminders': return out.reminders ? 'التنبيهات الجاية:\n'+out.reminders.map(r=>r.n+'- '+r.text+' ('+r.at+')').join('\n') : 'مفيش تنبيهات.';
    case 'cancel_reminder': return 'التنبيه اتلغى.';
    case 'remember': return 'هفتكر: '+args.fact;
    case 'forget': return 'نسيتها خلاص.';
    case 'calculate': return '= '+out.result;
    case 'get_datetime': return out.now;
    case 'search_web': return out.result || 'ملقيتش إجابة واضحة';
    default: return 'تم.';
  }
}
async function freeChatRound(chatLog, userText, chatFn){
  chatFn = chatFn || freeChat;
  const messages = [{role:'system', content:personaBlock()+'\nنفذ بالأدوات اللي معاك على طول من غير ما تستأذن.'}];
  chatLog.slice(-14).forEach(m=> messages.push({role: m.role==='user'?'user':'assistant', content:m.text}));
  messages.push({role:'user', content:userText});
  setTyping('بيفكر…');
  const reply = await chatFn(messages);
  if(reply.text) return reply.text;
  // مكالمة واحدة بس: نفذ وصيغ الرد محليًا فورًا
  const lines = [];
  for(const call of reply.calls){
    addToolLine('بينفذ: '+call.name);
    let out;
    try{ out = await Tools[call.name](call.args||{}); }
    catch(e){ out = {error:String(e.message||e)}; }
    lines.push(renderToolResult(call.name, call.args, out));
  }
  return lines.join('\n');
}

/* ============ واجهة الشات ============ */
const $ = id => document.getElementById(id);
function esc(s){ return String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function addMsg(role, text, attDataUrl){
  const div = document.createElement('div');
  div.className = 'msg '+(role==='user'?'me':'ai');
  let html = esc(text);
  if(attDataUrl) html += '<img class="att" src="'+attDataUrl+'">';
  if(role!=='user' && window.speechSynthesis) html += '<button class="speak">اسمعها</button>';
  div.innerHTML = html;
  const sp = div.querySelector('.speak');
  if(sp) sp.onclick = ()=>speak(text);
  $('chat').appendChild(div);
  $('chat').scrollTop = $('chat').scrollHeight;
  saveTurn(role, text);
}
function addToolLine(t){
  const div = document.createElement('div');
  div.className = 'tool-line'; div.textContent = t;
  $('chat').appendChild(div); $('chat').scrollTop = $('chat').scrollHeight;
}
function saveTurn(role, text){
  const log = store.get('chatlog', []);
  log.push({role, text, at:Date.now()});
  while(log.length > 100) log.shift();
  store.set('chatlog', log);
}
function speak(text){
  try{
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.slice(0,400));
    u.lang = 'ar-EG'; u.rate = 1;
    const v = speechSynthesis.getVoices().find(v=>/^ar/i.test(v.lang));
    if(v) u.voice = v;
    speechSynthesis.speak(u);
  }catch(_){}
}
function setTyping(t){ const el=$('typing'); if(!t){el.classList.add('hidden');} else {el.textContent=t; el.classList.remove('hidden');} }

/* ============ إرسال رسالة ============ */
let pendingAttachment = null; // {mime, data(base64), preview, name}

async function sendUserMessage(text){
  text = (text||'').trim();
  if(pendingAttachment && !hasKey()){
    addMsg('model','قراءة الصور والملفات شغالة مع مفتاح جوجل بس دلوقتي. تقدري تضيفيه من القائمة ← الإعدادات، أو ابعتيلي الملف من غير ما تتوقعي إني أقراه.');
    pendingAttachment = null; renderAttachPreview();
    if(!text) return;
  }
  const att = pendingAttachment;
  pendingAttachment = null; renderAttachPreview();
  if(!text && !att) return;
  addMsg('user', text || '(مرفق)', att && att.preview);
  setTyping('بيفكر…');
  const chatLog = store.get('chatlog', []).slice(0,-1); // الرسالة اتحفظت فوق
  try{
    let reply;
    if(hasKey()){
      const parts = [];
      if(att) parts.push({inlineData:{mimeType:att.mime, data:att.data}});
      if(text) parts.push({text});
      reply = await geminiChatRound(chatLog, parts);
    }else if(hasGroqKey()){
      reply = await freeChatRound(chatLog, text || 'اتفضل المرفق', groqChat);
    }else{
      reply = await freeChatRound(chatLog, text || 'اتفضل المرفق');
    }
    setTyping(null);
    addMsg('model', reply);
  }catch(e){
    setTyping(null);
    if(e.status===400||e.status===401||e.status===403){
      addMsg('model', hasGroqKey() && !hasKey()
        ? 'مفتاح Groq مش شغال. حدثيه من الإعدادات، أو شيليه واشتغلي بالوضع الفوري.'
        : 'مفتاح جوجل مش شغال. جربي تعملي واحد جديد من aistudio.google.com/apikey وحدثيه من الإعدادات، أو شيليه واشتغلي بالوضع الفوري.');
    }else{
      addMsg('model', e.message && /ضغط|مشغول/.test(e.message) ? e.message : 'حصلت مشكلة في الاتصال. جربي تاني بعد شوية.');
    }
  }
}

/* ============ المايك ============ */
let recog = null, recOn = false;
function setupMic(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ $('micBtn').classList.add('hidden'); return; }
  recog = new SR();
  recog.lang = 'ar-EG'; recog.interimResults = true; recog.continuous = false;
  recog.onresult = ev=>{
    let t = '';
    for(const r of ev.results) t += r[0].transcript;
    $('input').value = t;
  };
  recog.onend = ()=>{ recOn = false; $('micBtn').style.opacity = 1; };
  recog.onerror = ()=>{ recOn = false; $('micBtn').style.opacity = 1; };
}

/* ============ المرفقات ============ */
function renderAttachPreview(){
  const box = $('attachPreview');
  if(!pendingAttachment){ box.classList.add('hidden'); box.innerHTML=''; return; }
  box.classList.remove('hidden');
  box.innerHTML = (pendingAttachment.preview? '<img src="'+pendingAttachment.preview+'">' : '')
    + '<span>'+esc(pendingAttachment.name||'ملف')+'</span><button id="attX">شيل</button>';
  $('attX').onclick = ()=>{ pendingAttachment = null; renderAttachPreview(); };
}
function handleFile(file){
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    const url = reader.result;
    pendingAttachment = {mime:file.type||'application/octet-stream', data:url.split(',')[1], name:file.name,
      preview: /^image\//.test(file.type)? url : null};
    renderAttachPreview();
  };
  reader.readAsDataURL(file);
}

/* ============ القائمة الجانبية ============ */
const panels = {
  tasks(){
    const t = store.get('tasks',[]);
    if(!t.length) return '<p class="empty">مفيش مهام لسه</p>';
    return '<h3>المهام</h3>' + t.map((x,i)=>
      `<div class="item ${x.done?'done':''}"><div class="body">${i+1}. ${esc(x.title)}</div>
       <button data-act="doneTask" data-i="${i}">✓</button><button data-act="delTask" data-i="${i}">✕</button></div>`).join('');
  },
  notes(){
    const n = store.get('notes',[]);
    if(!n.length) return '<p class="empty">مفيش ملاحظات لسه</p>';
    return '<h3>الملاحظات</h3>' + n.map((x,i)=>
      `<div class="item"><div class="body">${esc(x.title)}<div class="sub">${esc(x.body.slice(0,80))}</div></div>
       <button data-act="delNote" data-i="${i}">✕</button></div>`).join('');
  },
  reminders(){
    const r = store.get('reminders',[]).filter(x=>x.at>Date.now());
    return '<h3>التنبيهات</h3><p class="sub" style="color:var(--muted);font-size:.8rem;margin-bottom:10px">التنبيه بيوصل طالما التطبيق مفتوح.</p>'
      + (r.length ? r.map((x,i)=>
      `<div class="item"><div class="body">${esc(x.text)}<div class="sub">${new Date(x.at).toLocaleString('ar-EG')}</div></div>
       <button data-act="delRem" data-id="${x.id}">✕</button></div>`).join('') : '<p class="empty">مفيش تنبيهات</p>');
  },
  memory(){
    const m = store.get('memory',[]);
    return '<h3>الذاكرة</h3><p class="sub" style="color:var(--muted);font-size:.8rem;margin-bottom:10px">معلومات عنك المساعد بيفتكرها.</p>'
      + (m.length ? m.map((x,i)=>
      `<div class="item"><div class="body">${esc(x)}</div><button data-act="delMem" data-i="${i}">✕</button></div>`).join('') : '<p class="empty">مفيش حاجة محفوظة</p>');
  },
  settings(){
    const mode = hasKey() ? 'جوجل (بمفتاحك)' : hasGroqKey() ? 'Groq (بمفتاحك)' : 'فوري مجاني — Pollinations (من غير مفتاح)';
    return `<h3>الإعدادات</h3>
      <p class="sub" style="color:var(--muted);font-size:.85rem">الوضع الحالي: ${mode}</p>
      <label class="lbl">اسم المساعد</label>
      <input type="text" id="setName" value="${esc(store.get('name','مساعدي'))}">
      <label class="lbl">مفتاح Gemini (اختياري — ردود أقوى + صور وملفات وبحث)</label>
      <input type="password" id="setKey" value="${esc(store.get('key',''))}" dir="ltr" placeholder="من aistudio.google.com/apikey">
      <label class="lbl">مفتاح Groq (اختياري — ردود أسرع، نص بس)</label>
      <input type="password" id="setGroqKey" value="${esc(store.get('groq_key',''))}" dir="ltr" placeholder="من console.groq.com/keys">
      <button class="btn" data-act="saveSettings">احفظ</button>
      ${(hasKey()||hasGroqKey())? '<button class="btn" data-act="clearKey" style="margin-top:8px">شيل المفاتيح وارجعي للوضع الفوري</button>':''}
      <button class="btn" data-act="exportData" style="margin-top:8px">صدّر بياناتي</button>
      <button class="btn" data-act="wipe" style="margin-top:8px;background:var(--danger)">امسح كل حاجة</button>`;
  },
  about(){
    return `<h3>عن التطبيق</h3>
      <p>مساعد شخصي بيتكلم مصري وبينفّذ: مهام، ملاحظات، تنبيهات، ذاكرة عنك، حسابات، وكتابة بالصوت. ومع مفتاح جوجل: بحث على النت وقراءة صور وملفات.</p>
      <p>الوضع الفوري مجاني بخدمة Pollinations (Myceli.AI، إستونيا)، وفيه حد للسرعة وقت الضغط. كلامك وآخر المحادثة والمعلومات المحفوظة في الذاكرة بتتبعتلهم وللمزود اللي بيشغل النموذج عندهم. سياسيتهم: مفيش تدريب على بياناتك من غير موافقة صريحة، معالجة مؤقتة، كاش حتى 30 يوم، والـ IP بيتسجل مشفر — لكن مزود النموذج النهائي خارج سيطرتهم، فمتشاركيش أسرار في الوضع ده. pollinations.ai/privacy</p>
      <p>مفتاح جوجل مجاني ضمن حدود استخدام يومية، وكلامك بيتبعت لجوجل. في الخطة المجانية جوجل ممكن تستخدم المحتوى لتحسين منتجاتها (ده لا ينطبق على مستخدمي الاتحاد الأوروبي وبريطانيا وسويسرا)، وتنصح رسميًا متبعتش معلومات حساسة أو شخصية. المفتاح بيتخزن على جهازك وبيتبعت لجوجل مع كل طلب. لو موديل عليه ضغط التطبيق بيحاول اللي بعده، ولو كله واقف بيقولك صراحة.</p>
      <p>وضع Groq بمفتاح مجاني (شركة Groq الأمريكية): كلامك وآخر المحادثة بتتبعت لسيرفراتهم في أمريكا عشان يردوا. شروطهم الرسمية: ممنوع عليهم يدربوا النماذج على المحادثات من غير إذن صريح، والمحادثة مش بتتحفظ عندهم افتراضيًا — ممكن تسجيل مؤقت حتى 30 يوم بس لو في عطل أو اشتباه إساءة، وفيه إعداد Zero Data Retention في حسابك يلغي ده كمان. المفتاح بيتخزن على جهازك وبيتبعت لـ Groq مع كل طلب. console.groq.com/docs/your-data</p>
      <p>المهام والملاحظات والتنبيهات محفوظة على جهازك بس ومش بتتبعت إلا لو طلبتي منه يشوفها. التنبيهات بتشتغل والتطبيق مفتوح.</p>`;
  }
};
function openPanel(name){
  $('drawer').classList.remove('hidden');
  document.querySelectorAll('.drawer-nav button').forEach(b=>b.classList.toggle('on', b.dataset.panel===name));
  $('panel').innerHTML = panels[name]();
}
document.addEventListener('click', ev=>{
  const b = ev.target.closest('[data-act]');
  if(!b) return;
  const act = b.dataset.act, i = +b.dataset.i;
  if(act==='doneTask'){ const t=store.get('tasks',[]); if(t[i]){t[i].done=true; store.set('tasks',t);} openPanel('tasks'); }
  if(act==='delTask'){ const t=store.get('tasks',[]); t.splice(i,1); store.set('tasks',t); openPanel('tasks'); }
  if(act==='delNote'){ const n=store.get('notes',[]); n.splice(i,1); store.set('notes',n); openPanel('notes'); }
  if(act==='delRem'){ let r=store.get('reminders',[]); const hit=r.find(x=>x.id===b.dataset.id); if(hit&&timers[hit.id]) clearTimeout(timers[hit.id]); r=r.filter(x=>x.id!==b.dataset.id); store.set('reminders',r); openPanel('reminders'); }
  if(act==='delMem'){ const m=store.get('memory',[]); m.splice(i,1); store.set('memory',m); openPanel('memory'); }
  if(act==='saveSettings'){
    store.set('name', $('setName').value.trim()||'مساعدي');
    store.set('key', $('setKey').value.trim());
    store.set('groq_key', $('setGroqKey').value.trim());
    $('appTitle').textContent = store.get('name','مساعدي');
    openPanel('settings');
  }
  if(act==='clearKey'){ store.del('key'); store.del('lastgood'); store.del('groq_key'); openPanel('settings'); }
  if(act==='exportData'){
    const data = {tasks:store.get('tasks',[]), notes:store.get('notes',[]), reminders:store.get('reminders',[]), memory:store.get('memory',[])};
    const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download='بياناتي.json'; a.click();
  }
  if(act==='wipe'){ if(confirm('متأكدة؟ كل المهام والملاحظات والذاكرة هيتمسحوا.')){ ['tasks','notes','reminders','memory','chatlog'].forEach(k=>store.del(k)); location.reload(); } }
});

/* ============ إقلاع ============ */
async function boot(){
  const theme = store.get('theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark':'light');
  document.documentElement.dataset.theme = theme;
  $('themeBtn').onclick = ()=>{
    const t = document.documentElement.dataset.theme === 'dark' ? 'light':'dark';
    document.documentElement.dataset.theme = t; store.set('theme', t);
  };

  if(!store.get('started', false)){ $('setup').classList.remove('hidden'); }
  else { startApp(); }

  $('setupGo').onclick = async ()=>{
    const k = $('setupKey').value.trim();
    const gk = ($('setupGroqKey') ? $('setupGroqKey').value.trim() : '');
    store.set('name', $('setupName').value.trim()||'مساعدي');
    if(k){
      if(k.length < 20){ $('setupErr').textContent = 'المفتاح قصير أوي، اتأكدي إنك نسختيه كامل.'; return; }
      $('setupErr').textContent = 'بنجرب المفتاح…';
      try{
        const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=5', {headers:{'x-goog-api-key':k}});
        if(!res.ok) throw new Error('bad');
        store.set('key', k);
      }catch(_){ $('setupErr').textContent = 'المفتاح مش شغال. اتأكدي إنه من aistudio.google.com/apikey — أو ابدئي من غيره بالزرار التاني.'; return; }
    }
    if(gk){
      if(gk.length < 20){ $('setupErr').textContent = 'مفتاح Groq قصير أوي، اتأكدي إنك نسختيه كامل.'; return; }
      $('setupErr').textContent = 'بنجرب مفتاح Groq…';
      try{
        const res = await fetch('https://api.groq.com/openai/v1/models', {headers:{'Authorization':'Bearer '+gk}});
        if(!res.ok) throw new Error('bad');
        store.set('groq_key', gk);
      }catch(_){ $('setupErr').textContent = 'مفتاح Groq مش شغال. اتأكدي إنه من console.groq.com/keys — أو ابدئي من غيره بالزرار التاني.'; return; }
    }
    store.set('started', true);
    $('setup').classList.add('hidden');
    startApp();
  };
  $('setupFree').onclick = ()=>{
    store.set('name', $('setupName').value.trim()||'مساعدي');
    store.set('started', true);
    $('setup').classList.add('hidden');
    startApp();
  };
}
function startApp(){
  $('app').classList.remove('hidden');
  $('appTitle').textContent = store.get('name','مساعدي');
  const log = store.get('chatlog', []);
  log.slice(-50).forEach(m=>addMsgNoSave(m.role, m.text));
  store.get('reminders',[]).forEach(scheduleReminder);
  if(hasKey()) discoverModels(store.get('key','')).catch(()=>{});
  if('Notification' in window && Notification.permission==='default'){ try{ Notification.requestPermission(); }catch(_){} }
  setupMic();

  $('sendBtn').onclick = fire;
  $('input').addEventListener('keydown', e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); fire(); } });
  $('input').addEventListener('input', ()=>{ const t=$('input'); t.style.height='auto'; t.style.height=Math.min(t.scrollHeight,120)+'px'; });
  $('micBtn').onclick = ()=>{
    if(!recog) return;
    if(recOn){ recog.stop(); return; }
    try{ recog.start(); recOn = true; $('micBtn').style.opacity = .4; }catch(_){}
  };
  $('attachBtn').onclick = ()=>$('fileInput').click();
  $('fileInput').onchange = e=>{ handleFile(e.target.files[0]); e.target.value=''; };
  $('menuBtn').onclick = ()=>openPanel('tasks');
  $('drawerClose').onclick = ()=>$('drawer').classList.add('hidden');
  document.querySelectorAll('.drawer-nav button').forEach(b=> b.onclick = ()=>openPanel(b.dataset.panel));

  if(!log.length){
    addMsg('model','أهلًا! أنا '+store.get('name','مساعدي')+'. قوليلي عايزة إيه — أسجل مهام وملاحظات، أفكرك بمعاد، أحسب، وأفتكر معلومات عنك.'
      + (hasKey()? ' وأقدر كمان أدور على النت وأقرا صور وملفات.' : ''));
  }
}
function addMsgNoSave(role, text){
  const div = document.createElement('div');
  div.className = 'msg '+(role==='user'?'me':'ai');
  div.innerHTML = esc(text);
  $('chat').appendChild(div);
  $('chat').scrollTop = $('chat').scrollHeight;
}
function fire(){
  const t = $('input').value.trim();
  $('input').value = ''; $('input').style.height = 'auto';
  sendUserMessage(t);
}

document.addEventListener('DOMContentLoaded', boot);

/* تصدير للاختبارات */
if(typeof module !== 'undefined'){ module.exports = {rankModels, safeCalc, findByNumOrText, parseToolCall, modelChain, parseFreeResponse, renderToolResult, groqChat}; }
