import { t } from './i18n.ts';
import type { Language } from './i18n.ts';
import { ServiceError } from './errors.ts';
import { address } from './monad.ts';
import { parseMinimumMon } from './notifications.ts';

export type Command = {kind:"start"|"help"|"list"|"status"|"menu"|"cancel"} | {kind:'language';language?:Language} |
  {kind:"add"|"rename"; address:string; name:string} |
  {kind:"pause"|"resume"|"delete"; address:string} | {kind:"confirm"; nonce:string} |
  {kind:"min";address:string;wei:string}|{kind:'erc20'|'approval'|'nft'|'permit'|'internal'|'signatures';address:string;enabled:boolean}|{kind:'monitor_group';address:string;group:'mon'|'assets'|'approvals'|'staking';enabled:boolean};

export function parseCommand(text: string): Command {
  const parts = text.trim().split(/\s+/);
  const command = parts.shift()?.toLowerCase().replace(/@monad_trackerbot$/, "");
  if(command==='/language') {
    if(!parts.length)return {kind:'language'};
    if(parts.length===1&&['en','zh'].includes(parts[0]!.toLowerCase()))return {kind:'language',language:parts[0]!.toLowerCase() as Language};
    throw new ServiceError('invalid_language');
  }
  if (["/start","/help","/list","/status","/menu","/cancel"].includes(command ?? "") && parts.length === 0) {
    return {kind:command!.slice(1)} as Command;
  }
  if (command === "/confirm" && parts.length === 1 && /^[a-f0-9]{16}$/.test(parts[0])) return {kind:"confirm",nonce:parts[0]};
  if(command==='/min') {
    const walletAddress=address(parts.shift());
    if(parts.length!==1)throw new ServiceError('invalid_minimum_mon');
    return {kind:'min',address:walletAddress,wei:parseMinimumMon(parts[0]!)};
  }
  if(command&&['/erc20','/approval','/nft','/permit','/internal','/signatures'].includes(command)){
    const walletAddress=address(parts.shift());
    if(parts.length!==1||!['on','off'].includes(parts[0]!))throw new ServiceError('invalid_erc20_command');
    return {kind:command.slice(1) as 'erc20'|'approval'|'nft'|'permit'|'internal'|'signatures',address:walletAddress,enabled:parts[0]==='on'};
  }
  if (["/add","/rename","/pause","/resume","/delete"].includes(command ?? "")) {
    const walletAddress = address(parts.shift());
    if (command === "/add" || command === "/rename") {
      const name=parts.join(" ") || (command === "/add" ? t("我的钱包") : "");
      if (!name || Array.from(name).length > 32 || /[\x00-\x1f\x7f]/.test(name)) throw new ServiceError("invalid_wallet_name");
      return {kind:command.slice(1) as "add"|"rename",address:walletAddress,name};
    }
    if (parts.length) throw new ServiceError("invalid_command");
    return {kind:command!.slice(1) as "pause"|"resume"|"delete",address:walletAddress};
  }
  throw new ServiceError("invalid_command");
}
