import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

async function harness({value='',suggestion=''}={}) {
    let current=true;const saved=[];
    class Node {
        constructor(tag){this.tagName=tag;this.children=[];this.value='';this.textContent='';this.listeners={};}
        append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
        setAttribute(key,value){this[key]=value;}
        addEventListener(type,listener){this.listeners[type]=listener;}
        click(){this.listeners.click?.();}
        focus(){this.focused=true;}
        showModal(){this.open=true;}
        close(){this.open=false;}
        remove(){this.parent.children=this.parent.children.filter(node=>node!==this);}
    }
    const body=new Node('body');
    const nodes=()=>{const result=[];const walk=node=>{result.push(node);node.children.forEach(walk);};walk(body);return result;};
    const document={body,createElement:tag=>new Node(tag),querySelector:()=>nodes().find(node=>node.tagName==='dialog')};
    const sandbox=createContext({document});
    const module=new SourceTextModule(readFileSync(new URL('../modules/relationship-status-ui.js',import.meta.url),'utf8'),{context:sandbox});
    const mocks={
        './i18n.js':{t:text=>text},
        './social.js':{createRelationshipStatusSession:()=>({value,suggestion,save:label=>{if(!current)return false;saved.push(label);return true;}})},
    };
    await module.link(name=>new SyntheticModule(Object.keys(mocks[name]),function(){for(const[key,value]of Object.entries(mocks[name]))this.setExport(key,value);},{context:sandbox}));
    await module.evaluate();
    return {api:module.namespace,nodes,saved,button:text=>nodes().find(node=>node.tagName==='button'&&node.textContent===text),invalidate(){current=false;}};
}

test('status dialog offers rejected model text safely and saves the user choice',async()=>{
    const h=await harness({suggestion:'<img src=x onerror=alert(1)>'});
    h.api.openRelationshipStatusEditor('<Alex>');h.api.openRelationshipStatusEditor('Other');
    assert.equal(h.nodes().filter(node=>node.tagName==='dialog').length,1);
    assert.ok(h.nodes().some(node=>node.textContent.includes('<Alex>')));
    const input=h.nodes().find(node=>node.tagName==='input');
    assert.equal(input.value,'<img src=x onerror=alert(1)>');
    assert.equal(h.nodes().some(node=>node.tagName==='img'),false);
    input.value='Любимая дочь';h.button('Сохранить').click();
    assert.deepEqual(h.saved,['Любимая дочь']);
    assert.equal(h.nodes().some(node=>node.tagName==='dialog'),false);
});

test('status dialog validates empty input, supports automatic mode and cancels without saving',async()=>{
    const h=await harness();h.api.openRelationshipStatusEditor('Alex');h.button('Сохранить').click();
    assert.deepEqual(h.saved,[]);
    assert.ok(h.nodes().some(node=>node.textContent.includes('Введите статус')));
    h.button('Автоматически').click();assert.deepEqual(h.saved,['']);
    const cancelled=await harness();cancelled.api.openRelationshipStatusEditor('Alex');cancelled.button('Закрыть').click();
    assert.deepEqual(cancelled.saved,[]);
});

test('stale dialog explains why saving was refused and preserves the input',async()=>{
    const h=await harness({value:'Любимая дочь'});h.api.openRelationshipStatusEditor('Alex');h.invalidate();h.button('Сохранить').click();
    assert.deepEqual(h.saved,[]);
    assert.equal(h.nodes().find(node=>node.tagName==='input').value,'Любимая дочь');
    assert.ok(h.nodes().some(node=>node.textContent.includes('Откройте редактор заново')));
});
