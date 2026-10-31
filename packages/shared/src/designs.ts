/** Review catalog. Concepts become selectable runtime themes only after implementation. */
export const DESIGN_CONCEPT_IDS = ['orbit-signature','noir-gold','arctic-glass','aurora-flow','monolith','rose-quartz'] as const;
export type DesignConceptId = typeof DESIGN_CONCEPT_IDS[number];
/** Only shipped designs may be published. Concepts remain a separate review catalog. */
export const MINIAPP_DESIGN_IDS = ['orbit-signature', 'arctic-glass'] as const;
export type MiniAppDesignId = typeof MINIAPP_DESIGN_IDS[number];
export const MINIAPP_DESIGNS = [
  { id: 'orbit-signature', code: 'A', name: 'Orbit Signature', mode: 'dark', background: '#09090f', surface: '#14141f', description: 'Тёмный хром, фиолетовые орбиты и мягкое свечение.' },
  { id: 'arctic-glass', code: 'C', name: 'Arctic Glass', mode: 'light', background: '#f2f7ff', surface: '#ffffff', description: 'Жемчужное стекло, голубой глобус и воздушные карточки.' },
] as const;
export function resolveMiniAppDesign(value: unknown): MiniAppDesignId {
  return value === 'arctic-glass' ? value : 'orbit-signature';
}
export function miniAppDesign(value: unknown) {
  return MINIAPP_DESIGNS.find(d => d.id === resolveMiniAppDesign(value))!;
}
export const DESIGN_CONCEPTS = [
  {id:'orbit-signature',code:'A',name:'Orbit Signature',description:'Фирменные орбиты, тёмный хром и фиолетовое свечение.',palette:['#09090f','#9671ff','#d9c7ff'],motion:'Плавное движение колец и мягкая подсветка.',image:'/design-concepts/a-orbit-signature.png',tone:'Тёмный · эффектный'},
  {id:'noir-gold',code:'B',name:'Noir Gold',description:'Матовый чёрный, шампань и спокойная редакционная типографика.',palette:['#111110','#c7a66a','#f5efe3'],motion:'Тонкий блик металла и мягкое появление элементов.',image:'/design-concepts/b-noir-gold.png',tone:'Тёмный · сдержанный'},
  {id:'arctic-glass',code:'C',name:'Arctic Glass',description:'Жемчужно-белый интерфейс, ледяное стекло и синий акцент.',palette:['#f5f8fc','#3979ec','#12233f'],motion:'Лёгкое движение стекла и плавные переходы.',image:'/design-concepts/c-arctic-glass.png',tone:'Светлый · воздушный'},
  {id:'aurora-flow',code:'D',name:'Aurora Flow',description:'Глубокий морской фон, мятный свет и текучие формы.',palette:['#071c20','#62e1be','#b5efff'],motion:'Медленное движение волны и переходы состояний.',image:'/design-concepts/d-aurora-flow.png',tone:'Тёмный · мягкий'},
  {id:'monolith',code:'E',name:'Monolith',description:'Графит, кобальт, точная сетка и крупные показатели.',palette:['#13161b','#4169ff','#c5cad3'],motion:'Короткие точные переходы и подсветка выбора.',image:'/design-concepts/e-monolith.png',tone:'Тёмный · строгий'},
  {id:'rose-quartz',code:'F',name:'Rose Quartz',description:'Слоновая кость, пыльная роза и тёплые тактильные поверхности.',palette:['#faf6f1','#ba7c8b','#332a2a'],motion:'Мягкий параллакс ленты и спокойные появления.',image:'/design-concepts/f-rose-quartz.png',tone:'Светлый · тёплый'},
] as const satisfies readonly {id:DesignConceptId;code:string;name:string;description:string;palette:readonly string[];motion:string;image:string;tone:string}[];
