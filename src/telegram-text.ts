import {t} from './i18n.ts';
const escape=(text:string)=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
// Format readable text as escaped HTML with shortened explorer links.
export function telegramHtml(text:string):string {
  const pattern=/https:\/\/monadscan\.com\/(?:tx\/0x[0-9a-fA-F]{64}|address\/0x[0-9a-fA-F]{40}|block\/[0-9]+)(?![0-9a-fA-F/])|(?<![0-9a-zA-Z])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
  let result='',end=0;
  for(const match of text.matchAll(pattern)){
    result+=escape(text.slice(end,match.index));const value=match[0];
    const href=value.startsWith('https:')?value:'https://monadscan.com/address/'+value;
    const label=value.includes('/tx/')?t('交易详情'):value.includes('/block/')?t('区块 ')+value.split('/').at(-1):value.split('/').at(-1)!;
    const display=label.startsWith('0x')?label.slice(0,6)+'…'+label.slice(-4):label;
    result+=`<a href="${escape(href)}">${escape(display)}</a>`;end=match.index+value.length;
  }
  return result+escape(text.slice(end));
}
