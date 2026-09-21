import {createApp} from 'vue';
import ModelCompare from './ModelCompare.vue';

let activeApp=null;
export function stopModelCompare(){activeApp?.unmount();activeApp=null;}
export function renderModelCompare({root,choices,token,tenantId,onSwitch}){
 stopModelCompare();
 activeApp=createApp(ModelCompare,{choices,token,tenantId,onSwitch});
 activeApp.mount(root);
}
