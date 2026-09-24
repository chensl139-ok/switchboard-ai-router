const valid=new Set(['openai','responses','anthropic']);

export function inferModelProtocol(model){
 const id=String(model||'').toLowerCase().split('/').at(-1);
 if(/^claude(?:[-_.]|$)/.test(id))return 'anthropic';
 if(/^(?:gpt-[56](?:[-.]|$)|o[134](?:[-.]|$)|codex(?:[-.]|$))/.test(id))return 'responses';
 return undefined;
}

export function protocolForModel(provider,model){
 const configured=provider.modelProtocols?.[model];
 return valid.has(configured)?configured:inferModelProtocol(model)||provider.protocol;
}

export function modelProtocolMap(provider,models){
 return Object.fromEntries(models.map(model=>[model,protocolForModel(provider,model)]).filter(([,protocol])=>valid.has(protocol)));
}
