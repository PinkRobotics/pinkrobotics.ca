import {planStatusText} from '../sim/index.js?v=fc85766f';
import {esc} from './dom.js?v=fc85766f';
export const inactiveText=m=>planStatusText({state:m.planState,reason:m.planReason});
export const figure=(m,quantity,value,text,basis='record')=>`<span data-energy-quantity="${quantity}" data-energy-value="${value}" data-energy-basis="${basis}" data-plan-hull="${esc(m.name)}">${text}</span>`;
