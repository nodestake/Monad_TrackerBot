import {AsyncLocalStorage} from 'node:async_hooks';
import {ENGLISH} from './i18n-catalog.ts';

export type Language = 'en'|'zh';
// Context is isolated per async operation, including concurrent chats and alarm jobs.
const languageContext = new AsyncLocalStorage<Language>();
export const language = ():Language => languageContext.getStore() ?? 'en';
export const normalizeLanguage = (value:unknown):Language => value === 'zh' ? 'zh' : 'en';
export function withLanguage<T>(value:unknown,run:()=>T):T {
  return languageContext.run(normalizeLanguage(value),run);
}
export function t(source:string|TemplateStringsArray,...values:unknown[]):string {
  const key=typeof source==='string'?source:source.reduce((text,part,index)=>text+(index?`{${index-1}}`:'')+part,'');
  const template=language()==='zh'?key:Object.hasOwn(ENGLISH,key)?ENGLISH[key]:undefined;
  if(template===undefined&&/[\p{Script=Han}：，。？；、（）]/u.test(key))throw new Error('missing_ui_translation');
  return (template??key).replace(/\{([0-9]+)\}/g,(_,index:string)=>typeof source==='string'?`{${index}}`:String(values[Number(index)]));
}
export const maximumTextLength=(render:()=>string):number => Math.max(withLanguage('en',render).length,withLanguage('zh',render).length);
