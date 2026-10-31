import { createServer,type Server } from 'node:http';
import { Bot,InlineKeyboard } from 'grammy';
import { beforeAll,beforeEach,afterAll,it,expect } from 'vitest';
import { screenNavigation } from '../src/screens.js';
let server:Server,url:string,bot:Bot,seq=0,update=1,failSend=false,failDelete=false;
let messages:Map<number,{text:string;photo:boolean}>,calls:{method:string;body:any}[];
const kb=new InlineKeyboard().text('Меню','menu');
const chat={id:10,type:'private' as const};
const from={id:10,is_bot:false,first_name:'Tester'};
const send=(text:string)=>bot.handleUpdate({update_id:update++,message:{message_id:10000+update,date:1,chat,from,text}} as any);
const click=(id:number,data='menu')=>bot.handleUpdate({update_id:update++,callback_query:{id:'q'+update,from,chat_instance:'x',data,message:{message_id:id,date:1,chat,...(messages.get(id)?.photo?{photo:[{file_id:'p'}]}:{text:messages.get(id)?.text})}}} as any);
beforeAll(async()=>{
 server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw),method=req.url!.split('/').at(-1)!;calls.push({method,body});
  let result:any={ok:true,result:true};
  if(method==='sendMessage'||method==='sendPhoto'){
   if(failSend) result={ok:false,error_code:500,description:'send failed'};
   else{const message_id=++seq;messages.set(message_id,{text:body.text??body.caption,photo:method==='sendPhoto'});result={ok:true,result:{message_id,chat}};}
  }else if(method==='editMessageText'){
   const message=messages.get(body.message_id);
   if(!message||message.photo)result={ok:false,error_code:400,description:'message cannot be edited'};
   else if(message.text===body.text)result={ok:false,error_code:400,description:'Bad Request: message is not modified'};
   else{message.text=body.text;result={ok:true,result:{message_id:body.message_id,chat}};}
  }else if(method==='deleteMessage'){
   if(failDelete)result={ok:false,error_code:500,description:'temporary error'};
   else messages.delete(body.message_id);
  }
  res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(result));
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${(server.address() as any).port}`;
});
beforeEach(()=>{
 messages=new Map();calls=[];seq=0;failSend=false;failDelete=false;
 bot=new Bot('1:T',{client:{apiRoot:url},botInfo:{id:1,is_bot:true,first_name:'Bot',username:'test_bot'} as any});
 bot.use(screenNavigation());
 bot.on('message:text',async ctx=>{
  if(ctx.message.text==='/start auth_token')return void await ctx.reply('Confirm login');
  await ctx.reply(ctx.message.text,{reply_markup:kb});
 });
 bot.on('callback_query:data',async ctx=>{
  const action=ctx.callbackQuery.data;
  if(action==='photo')await ctx.replyWithPhoto('https://example.test/image.png',{caption:'Photo',reply_markup:kb});
  else if(action==='multi'){await ctx.reply('First');await ctx.reply('Second',{reply_markup:kb});}
  else if(action==='checkout')await ctx.reply('Choose payment',{reply_markup:new InlineKeyboard().text('Pay','pay:p1:balance')});
  else await ctx.reply(action,{reply_markup:kb});
 });
});
afterAll(()=>{server.close();});
it('replaces text screens and keeps independently sent admin notifications',async()=>{
 await send('Screen1');const first=seq;
 await bot.api.sendMessage(10,'Daily report');const report=seq;
 await click(first,'plans');await click(first,'connect');
 expect(messages.size).toBe(2);expect(messages.get(first)!.text).toBe('connect');expect(messages.get(report)!.text).toBe('Daily report');
 expect(calls.filter(c=>c.method==='deleteMessage').some(c=>c.body.message_id===report)).toBe(false);
});
it('sends replacement for photo and deletes the old photo only after success',async()=>{
 await send('Text');await click(seq,'photo');const photo=seq;expect(messages.size).toBe(1);
 await click(photo,'menu');expect(messages.size).toBe(1);expect(messages.get(seq)!.text).toBe('menu');
 const events=calls.slice(calls.findIndex(c=>c.method==='sendPhoto')+1);expect(events.findIndex(c=>c.method==='sendMessage')).toBeLessThan(events.findLastIndex(c=>c.method==='deleteMessage'));
});
it('preserves the previous screen if replacement fails',async()=>{
 await send('Text');failSend=true;await expect(click(seq,'photo')).rejects.toThrow();expect(messages.size).toBe(1);expect(messages.get(seq)!.text).toBe('Text');
});
it('cleans all messages belonging to a multi-message screen on the next transition',async()=>{
 await send('Text');await click(seq,'multi');expect(messages.size).toBe(2);await click(seq,'next');expect(messages.size).toBe(1);expect([...messages.values()][0]!.text).toBe('next');
});
it('does not create duplicates when the screen text is unchanged',async()=>{
 await send('menu');await click(seq,'menu');expect(messages.size).toBe(1);expect(calls.filter(c=>c.method==='sendMessage')).toHaveLength(1);
});
it('assigns a new message ID to every checkout, preserving existing payment operation keys',async()=>{
 await send('Menu');await click(seq,'checkout');const first=seq;await click(seq,'menu');await click(seq,'checkout');expect(seq).toBeGreaterThan(first);expect(messages.size).toBe(1);
});
it('keeps login security notices separate from navigation',async()=>{
 await send('Menu');const menu=seq;await send('/start auth_token');const security=seq;await click(menu,'plans');expect(messages.get(security)!.text).toBe('Confirm login');expect(messages.size).toBe(2);
});
it('retries a temporary failure to remove an old screen on the next transition',async()=>{
 await send('Menu');const old=seq;failDelete=true;await click(seq,'photo');expect(messages.size).toBe(2);failDelete=false;await click(seq,'next');expect(messages.has(old)).toBe(false);expect(messages.size).toBe(1);
});
it('can replace the clicked photo even after the in-memory menu cache is lost',async()=>{
 await send('Menu');await click(seq,'photo');const old=seq;
 const fresh=new Bot('1:T',{client:{apiRoot:url},botInfo:{id:1,is_bot:true,first_name:'Bot',username:'test_bot'} as any});
 fresh.use(screenNavigation());fresh.on('callback_query:data',async ctx=>{await ctx.reply('After restart',{reply_markup:kb});});
 await fresh.handleUpdate({update_id:update++,callback_query:{id:'q'+update,from,chat_instance:'x',data:'menu',message:{message_id:old,date:1,chat,photo:[{file_id:'p'}]}}} as any);
 expect(messages.has(old)).toBe(false);expect(messages.size).toBe(1);expect(messages.get(seq)!.text).toBe('After restart');
});
it('serializes simultaneous menu transitions in one chat',async()=>{
 await send('Menu');const first=seq;await Promise.all([click(first,'photo'),click(first,'next')]);
 expect(messages.size).toBe(1);expect([...messages.values()][0]!.text).toBe('next');
});
