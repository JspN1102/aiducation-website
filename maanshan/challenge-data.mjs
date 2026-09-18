// Questions are assessment content, not a claim that an entire phonics lesson is covered.
// Render only prompt/options/cards/slot labels before submission. Audio text, targets,
// explanations and curriculum metadata must never become pre-answer captions or aria labels.
import {DICTATION_BANK} from './challenge-dictation-bank.mjs?v=20260918c';
export const CHALLENGE_VERSION = 2;

const toneOptions = () => [
  {id: 'a', label: '第一聲', contour: 'level'},
  {id: 'b', label: '第二聲', contour: 'rising'},
  {id: 'c', label: '第三聲', contour: 'dipping'},
  {id: 'd', label: '第四聲', contour: 'falling'}
];
const options = (...labels) => labels.map((label, index) => ({id: String.fromCharCode(97 + index), label}));
const scene = (slug, number) => `media/${slug}/scene-${number}.webp`;

const LEGACY_SETS = {
  'yong-e': {
    grade: 1,
    title: '清波小遊記',
    curriculum: {unit: 1, lesson: 1, focus: '學習四聲', sampled: ['第二聲', '第三聲'], notSampled: ['第一聲', '第四聲'], source: '概覽：一年級第一學段第一單元第一課；教材照片 1-1.2（第4頁）。'},
    items: [
      {id: 'g1-s1', type: 'sound', focus: '第二聲', prompt: '聽一聽，這個字是第幾聲？', audio: {char: '鵝', pinyin: 'é'}, options: toneOptions(), answerId: 'b', explanation: '「鵝」讀 é，是第二聲。聲音向上揚，像走上一個小斜坡。'},
      {id: 'g1-d1', type: 'dictation', prompt: '聽一聽，寫出指定的字。', audio: {text: '請寫出「白色」的「白」。', char: '白', pinyin: 'bái'}, target: {char: '白', pinyin: 'bái', accept: ['白']}, explanation: '白色的「白」。詩裏寫的是白色的羽毛。'},
      {id: 'g1-s2', type: 'sound', focus: '第三聲', prompt: '再聽一個字，把聲音送到合適的聲調小站。', audio: {char: '水', pinyin: 'shuǐ'}, options: toneOptions(), answerId: 'c', explanation: '「水」單獨讀 shuǐ，是第三聲。聲音先往下，再往上。'},
      {id: 'g1-d2', type: 'dictation', prompt: '聽一聽，寫出指定的字。', audio: {text: '請寫出「羽毛」的「毛」。', char: '毛', pinyin: 'máo'}, target: {char: '毛', pinyin: 'máo', accept: ['毛']}, explanation: '羽毛的「毛」。最後一筆豎彎鈎，把小尾巴寫出來。'},
      {id: 'g1-m1', type: 'match', prompt: '白鵝的世界有甚麼顏色？把色彩卡放到合適的位置。', modelSlug: 'yong-e', cards: [{id: 'a', label: '白色', color: '#fffdf6'}, {id: 'b', label: '紅色', color: '#c7594c'}, {id: 'c', label: '綠色', color: '#689781'}], slots: [{id: 'one', label: '腳掌', accepts: 'b'}, {id: 'two', label: '羽毛', accepts: 'a'}, {id: 'three', label: '水面', accepts: 'c'}], explanation: '白毛、紅掌、綠水，三種顏色讓白鵝游水的畫面鮮明起來。'}
    ]
  },
  'zeng-wang-lun': {
    grade: 2,
    title: '桃花潭的來信',
    curriculum: {unit: 2, lesson: 4, focus: 'ua、uo、uai、ui（uei）', sampled: ['ua', 'ui（uei）'], notSampled: ['uo', 'uai'], source: '概覽：二年級第一學段第二單元第四課；教材照片 2-4.3（第27頁）。uai 在詩正文沒有直接例字，在朗讀活動以「快」作拓展練習。'},
    items: [
      {id: 'g2-s1', type: 'sound', focus: 'ua', prompt: '「花」的韻母是哪一個？', audio: {char: '花', pinyin: 'huā'}, options: options('uo', 'ua', 'uai'), answerId: 'b', explanation: '「花」讀 huā，韻母是 ua。「火」的韻母才是 uo，聽起來不一樣。'},
      {id: 'g2-d1', type: 'dictation', prompt: '聽一聽，寫出指定的字。', audio: {text: '請寫出「汪倫」的「汪」。', char: '汪', pinyin: 'wāng'}, target: {char: '汪', pinyin: 'wāng', accept: ['汪']}, explanation: '汪倫的「汪」。左邊是三點水，別和日字旁的「旺」混淆。'},
      {id: 'g2-s2', type: 'sound', focus: 'ui（uei）', prompt: '「水」的韻母，在拼音中寫成甚麼？', audio: {char: '水', pinyin: 'shuǐ'}, options: options('iu', 'uai', 'ui'), answerId: 'c', explanation: '「水」讀 shuǐ。uei 跟聲母相拼時寫成 ui；iu 的先後次序不同。'},
      {id: 'g2-d2', type: 'dictation', prompt: '聽一聽，寫出指定的字。', audio: {text: '請寫出「汪倫」的「倫」。', char: '倫', pinyin: 'lún'}, target: {char: '倫', pinyin: 'lún', accept: ['倫', '伦']}, explanation: '汪倫的「倫」，左邊是單人旁；「輪」的部首和意思都不同。'},
      {id: 'g2-m1', type: 'sequence', prompt: '這首詩怎樣展開？把三張故事卡依次放好。', modelSlug: 'zeng-wang-lun', cards: [{id: 'a', label: '準備乘船離開', image: scene('zeng-wang-lun', 1)}, {id: 'b', label: '聽見岸邊的歌聲', image: scene('zeng-wang-lun', 2)}, {id: 'c', label: '用潭水比友情', image: scene('zeng-wang-lun', 4)}], slots: [{id: 'one', label: '先', accepts: 'a'}, {id: 'two', label: '接着', accepts: 'b'}, {id: 'three', label: '最後', accepts: 'c'}], explanation: '詩先寫乘舟將走，再寫忽然聽見踏歌聲，最後用深潭水襯托友情。這是詩意展開的順序。'}
    ]
  },
  'ti-xi-lin-bi': {
    grade: 3,
    title: '山中觀察日記',
    curriculum: {unit: 2, lesson: 4, focus: '複習聲母 g、k、h', sampled: ['g', 'k'], notSampled: ['h'], source: '概覽：三年級第一學段第二單元第四課；教材照片 3-4.1（第25頁）、3-4.2。'},
    items: [
      {id: 'g3-s1', type: 'sound', focus: 'g', prompt: '聽清楚開頭的聲音，應送到哪個聲母貨架？', audio: {char: '高', pinyin: 'gāo'}, options: options('h', 'k', 'g'), answerId: 'c', explanation: '「高」讀 gāo，聲母是 g。g 不送氣，k 送氣，讀 k 時氣流較強。'},
      {id: 'g3-d1', type: 'dictation', prompt: '聽一聽，寫出指定的字。', audio: {text: '請寫出「山嶺」的「嶺」。', char: '嶺', pinyin: 'lǐng'}, target: {char: '嶺', pinyin: 'lǐng', accept: ['嶺', '岭']}, explanation: '山嶺的「嶺」，有山字旁。橫着看，山脈綿延，像一道長長的山嶺。'},
      {id: 'g3-s2', type: 'sound', focus: 'k', prompt: '再聽一個字，這次開頭的聲母是哪個？', audio: {char: '看', pinyin: 'kàn'}, options: options('k', 'g', 'h'), answerId: 'a', explanation: '這裏的「看」讀 kàn，聲母是 k。把手放在嘴前讀一讀，能感到較明顯的氣流。'},
      {id: 'g3-d2', type: 'dictation', prompt: '聽一聽，寫出指定的字。', audio: {text: '請寫出「側面」的「側」。', char: '側', pinyin: 'cè'}, target: {char: '側', pinyin: 'cè', accept: ['側', '侧']}, explanation: '側面的「側」，左邊是單人旁。「側看」就是換到側面去看。'},
      {id: 'g3-m1', type: 'match', prompt: '同一座山，兩個角度。轉轉模型，把照片放到對應的觀察位置。', modelSlug: 'ti-xi-lin-bi', cards: [{id: 'a', label: '照片甲', image: 'media/challenges/ti-xi-lin-bi-horizontal.webp'}, {id: 'b', label: '照片乙', image: 'media/challenges/ti-xi-lin-bi-side.webp'}], slots: [{id: 'one', label: '側看', accepts: 'b'}, {id: 'two', label: '橫看', accepts: 'a'}], explanation: '橫看是連綿的山嶺，側看是高聳的山峯。變的是觀察角度，不是山真的變了形。'}
    ]
  },
  'bo-chuan-gua-zhou': {
    grade: 4,
    title: '月光寄往江南',
    curriculum: {unit: 2, lesson: 3, focus: '複習韻母 u、ua、uo', sampled: ['u', 'uo'], notSampled: ['ua', '零聲母音節 wu、wa 的寫法'], source: '概覽：四年級第一學段第二單元第三課；教材照片 4-3.1（第20頁）。'},
    items: [
      {id: 'g4-s1', type: 'sound', focus: 'u', prompt: '「數重山」的「數」，韻母是哪一個？', audio: {char: '數', pinyin: 'shù'}, options: options('ua', 'u', 'uo'), answerId: 'b', explanation: '「數重山」指幾重山，「數」讀 shù，韻母是 u。這裏不是「數一數」的 shǔ。'},
      {id: 'g4-d1', type: 'dictation', prompt: '聽一聽，寫出指定的字。', audio: {text: '請寫出「新綠」的「綠」。', char: '綠', pinyin: 'lǜ'}, target: {char: '綠', pinyin: 'lǜ', accept: ['綠', '绿']}, explanation: '新綠的「綠」。詩裏把「綠」用作動詞，寫出春風使江岸草木變綠。'},
      {id: 'g4-s2', type: 'sound', focus: 'uo', prompt: '「我」的韻母是哪一個？仔細聽，再放入貨架。', audio: {char: '我', pinyin: 'wǒ'}, options: options('uo', 'u', 'ua'), answerId: 'a', explanation: '「我」讀 wǒ，韻母是 uo。uo 前面沒有聲母時，寫成 wo，不能只把 o 當作完整韻母。'},
      {id: 'g4-d2', type: 'dictation', prompt: '聽一聽，寫出指定的字。', audio: {text: '請寫出「還鄉」的「還」。', char: '還', pinyin: 'huán'}, target: {char: '還', pinyin: 'huán', accept: ['還', '还']}, explanation: '還鄉的「還」，意思是回去，讀 huán。詩人盼望回到家鄉。'},
      {id: 'g4-m1', type: 'match', prompt: '替三張畫配上心聲：哪張寫距離，哪張寫春意，哪張寫思念？', modelSlug: 'bo-chuan-gua-zhou', cards: [{id: 'a', label: '畫片甲', image: scene('bo-chuan-gua-zhou', 1)}, {id: 'b', label: '畫片乙', image: scene('bo-chuan-gua-zhou', 3)}, {id: 'c', label: '畫片丙', image: scene('bo-chuan-gua-zhou', 4)}], slots: [{id: 'one', label: '春天又回來了', accepts: 'b'}, {id: 'two', label: '兩地只隔一江水', accepts: 'a'}, {id: 'three', label: '盼望回到家鄉', accepts: 'c'}], explanation: '隔江相望寫距離，江岸新綠寫春意，明月照歸途寫思鄉。同一首詩，風景也能帶出心情。'}
    ]
  },
  'gui-yuan-tian-ju': {
    grade: 5,
    title: '田園的一日',
    curriculum: {unit: 2, lesson: 3, focus: '分辨聲母 n、l', sampled: ['n', 'l'], notSampled: ['句子中的 n、l 連續辨讀及口語產出'], source: '概覽：五年級第一學段第二單元第三課；教材照片 5-3.1（第20頁）。兩道聽辨只記錄辨認表現，不能推斷實際發音能力。'},
    items: [
      {id: 'g5-s1', type: 'sound', focus: 'n', prompt: '只靠耳朵找聲母：這個聲音應放到哪一格？', audio: {char: '南', pinyin: 'nán'}, options: options('l', 'n'), answerId: 'b', explanation: '聽到的是「南」nán，聲母是鼻音 n；「蘭」lán 的聲母是 l。n 的氣流經鼻腔發出。'},
      {id: 'g5-d1', type: 'dictation', prompt: '聽一聽，寫出指定的字。', audio: {text: '請寫出「稀疏」的「稀」。', char: '稀', pinyin: 'xī'}, target: {char: '稀', pinyin: 'xī', accept: ['稀']}, explanation: '稀疏的「稀」，左邊是禾字旁。豆苗長得少，不能把它想成茂密的一大片。'},
      {id: 'g5-s2', type: 'sound', focus: 'l', prompt: '留意字音的開頭，這次應放到哪一格？', audio: {char: '露', pinyin: 'lù'}, options: options('n', 'l'), answerId: 'b', explanation: '「夕露」的「露」讀 lù，聲母是 l，氣流從舌頭兩側通過。不要和聲母是 n 的「怒」nù 混淆。'},
      {id: 'g5-d2', type: 'dictation', prompt: '聽一聽，寫出指定的字。', audio: {text: '請寫出「鋤頭」的「鋤」。', char: '鋤', pinyin: 'chú'}, target: {char: '鋤', pinyin: 'chú', accept: ['鋤', '锄']}, explanation: '鋤頭的「鋤」，有金字旁。「帶月荷鋤歸」中的「荷」讀 hè，意思是扛着。'},
      {id: 'g5-m1', type: 'scene-builder', prompt: '把田地變成詩中的樣子。分別調整野草和豆苗，看看畫面怎樣變。', modelSlug: 'gui-yuan-tian-ju', layers: [{id: 'grass', label: '野草', choices: [{id: 'sparse', label: '稀疏'}, {id: 'dense', label: '茂盛'}]}, {id: 'beans', label: '豆苗', choices: [{id: 'sparse', label: '稀疏'}, {id: 'dense', label: '茂盛'}]}], answer: {grass: 'dense', beans: 'sparse'}, explanation: '草盛豆苗稀：茂盛的是野草，稀疏的是豆苗。耕種並不輕鬆，這才接得上詩人清晨除草、月下歸家的辛勞。'}
    ]
  },
  'zao-chun': {
    grade: 6,
    title: '收集一點春色',
    curriculum: {unit: 2, lesson: 3, focus: '分辨聲母 x、s、sh', sampled: ['x', 's'], notSampled: ['sh 的獨立聽辨', 'x 與 ü 行韻母相拼的省點規則'], source: '概覽：六年級第一學段第二單元第三課；教材照片 6-3.1（第20頁）。sh 作干擾項不等於已獨立考查 sh。'},
    items: [
      {id: 'g6-s1', type: 'sound', focus: 'x', prompt: '不看漢字，只聽開頭。這個字的聲母是哪一個？', audio: {char: '小', pinyin: 'xiǎo'}, options: options('s', 'sh', 'x'), answerId: 'c', explanation: '聽到的是「小」xiǎo，聲母是舌面音 x。「少」shǎo 用的是翹舌音 sh，兩個字的聲母不同。'},
      {id: 'g6-d1', type: 'dictation', prompt: '聽一聽，寫出指定的字。', audio: {text: '請寫出「滋潤」的「潤」。', char: '潤', pinyin: 'rùn'}, target: {char: '潤', pinyin: 'rùn', accept: ['潤', '润']}, explanation: '滋潤的「潤」，左邊是三點水。「潤如酥」寫出細雨柔和、細膩地滋養大地的感覺。'},
      {id: 'g6-s2', type: 'sound', focus: 's', prompt: '再分辨一次：把聽到的聲音送到合適的聲母貨架。', audio: {char: '酥', pinyin: 'sū'}, options: options('sh', 's', 'x'), answerId: 'b', explanation: '聽到的是「酥」sū，聲母是平舌音 s；「書」shū 的聲母才是翹舌音 sh。'},
      {id: 'g6-d2', type: 'dictation', prompt: '聽一聽，寫出指定的字。', audio: {text: '請寫出「遙望」的「遙」。', char: '遙', pinyin: 'yáo'}, target: {char: '遙', pinyin: 'yáo', accept: ['遙', '遥']}, explanation: '遙望的「遙」，有走之旁，表示從遠處看。別與提手旁的「搖」混淆。'},
      {id: 'g6-m1', type: 'match', prompt: '同一片早春草地，兩次觀察。比較照片，把它們放到合適的距離。', modelSlug: 'zao-chun', cards: [{id: 'a', label: '照片甲', image: 'media/challenges/zao-chun-far.webp'}, {id: 'b', label: '照片乙', image: 'media/challenges/zao-chun-near.webp'}], slots: [{id: 'one', label: '走近細看', accepts: 'b'}, {id: 'two', label: '站遠眺望', accepts: 'a'}], explanation: '遠處，細小草芽的綠意彷彿連成一片；走近，草芽仍稀疏，泥土清楚可見。「近卻無」不是草突然消失，而是連成一片的草色不明顯。'}
    ]
  }
};

const extraSound = (grade, index, char, pinyin, focus, labels, answerId, explanation) => ({
  id: `g${grade}-s${index}`, type: 'sound', focus,
  prompt: grade === 1 ? '聽一聽，這個字是第幾聲？' : grade === 2 || grade === 4 ? '聽清楚，找出這個字的韻母。' : '聽開頭，找出這個字的聲母。',
  audio: {char, pinyin}, options: labels || toneOptions(), answerId, explanation
});
const MORE_SOUNDS = {
  'yong-e': [
    extraSound(1, 3, '歌', 'gē', '第一聲', null, 'a', '「歌」讀 gē，是第一聲。聲音平平地保持住。'),
    extraSound(1, 4, '綠', 'lǜ', '第四聲', null, 'd', '「綠」讀 lǜ，是第四聲。聲音從高處往下降。')
  ],
  'zeng-wang-lun': [
    extraSound(2, 3, '我', 'wǒ', 'uo', options('ua', 'uai', 'uo'), 'c', '「我」讀 wǒ，韻母是 uo。uo 前面沒有聲母時，音節寫成 wo。'),
    extraSound(2, 4, '快', 'kuài', 'uai', options('uai', 'ui', 'ua'), 'a', '拓展字「快」讀 kuài，韻母是 uai。這個字也可以在讀詩時點來聽。')
  ],
  'ti-xi-lin-bi': [
    extraSound(3, 3, '橫', 'héng', 'h', options('g', 'h', 'k'), 'b', '「橫」讀 héng，聲母是 h。讀 h 時，氣流從舌根和軟顎之間摩擦出來。'),
    {...extraSound(3, 4, '各', 'gè', 'g、k、h 聽辨', options('各', '客', '賀'), 'a', '聽到的是「各」gè。三個字分別讀 gè、kè、hè，開頭的聲母不同。'), prompt: '聽一聽，剛才讀的是哪個字？'}
  ],
  'bo-chuan-gua-zhou': [
    extraSound(4, 3, '瓜', 'guā', 'ua', options('uo', 'ua', 'u'), 'b', '「瓜洲」的「瓜」讀 guā，韻母是 ua，嘴形由圓唇轉向張開。'),
    extraSound(4, 4, '不', 'bù', 'u', options('u', 'uo', 'ua'), 'a', '「不」單獨讀 bù，韻母是 u。嘴唇向前收圓，聲音保持集中。')
  ],
  'gui-yuan-tian-ju': [
    extraSound(5, 3, '年', 'nián', 'n', options('l', 'n'), 'b', '拓展字「年」讀 nián，聲母是 n。讀 n 時，氣流經鼻腔發出。'),
    extraSound(5, 4, '理', 'lǐ', 'l', options('n', 'l'), 'b', '「晨興理荒穢」的「理」讀 lǐ，聲母是 l，氣流從舌頭兩側通過。')
  ],
  'zao-chun': [
    extraSound(6, 3, '勝', 'shèng', 'sh', options('x', 's', 'sh'), 'c', '「絕勝」的「勝」讀 shèng，聲母是翹舌音 sh，舌尖輕輕翹起。'),
    extraSound(6, 4, '色', 'sè', 's', options('sh', 's', 'x'), 'b', '「草色」的「色」讀 sè，聲母是平舌音 s，舌尖不翹起。')
  ]
};

// The second level asks children to distinguish complete, closely related
// syllables. It uses the same curriculum and the same recorded female voice.
const contrast = (grade, index, char, pinyin, focus, labels, answerId, explanation) => ({
  ...extraSound(grade, index, char, pinyin, focus, options(...labels), answerId, explanation),
  difficulty: 2, prompt: grade === 1 ? '聽一聽，找出一樣的聲調。' : '仔細聽，哪個拼音和聲音一樣？'
});
const VARIED_SOUNDS = {
  'yong-e': [
    extraSound(1, 5, '毛', 'máo', '第二聲', null, 'b', '「毛」讀 máo，是第二聲，聲音往上揚。'),
    extraSound(1, 6, '掌', 'zhǎng', '第三聲', null, 'c', '「掌」單獨讀 zhǎng，是第三聲，先低下來，再往上揚。'),
    contrast(1, 7, '曲', 'qū', '第一聲', ['qǔ', 'qū', 'qù', 'qú'], 'b', '「曲項」的「曲」讀 qū。第一聲的聲調符號是平平的一橫。'),
    contrast(1, 8, '紅', 'hóng', '第二聲', ['hòng', 'hōng', 'hóng', 'hǒng'], 'c', '「紅」讀 hóng。第二聲的聲調符號向上揚。'),
    contrast(1, 9, '水', 'shuǐ', '第三聲', ['shuī', 'shuí', 'shuǐ', 'shuì'], 'c', '「水」單獨讀 shuǐ。第三聲的符號先往下，再往上。'),
    contrast(1, 10, '綠', 'lǜ', '第四聲', ['lǜ', 'lǘ', 'lǚ', 'lǖ'], 'a', '「綠」讀 lǜ。第四聲的聲調符號從高處往下降。'),
    contrast(1, 11, '白', 'bái', '第二聲', ['bāi', 'bǎi', 'bài', 'bái'], 'd', '「白」讀 bái。留意聲調符號向上揚，是第二聲。')
  ],
  'zeng-wang-lun': [
    extraSound(2, 5, '歸', 'guī', 'ui（uei）', options('ua', 'ui', 'uo'), 'b', '拓展字「歸」讀 guī，韻母 uei 跟聲母相拼時寫成 ui。'),
    extraSound(2, 6, '瓜', 'guā', 'ua', options('ui', 'uo', 'ua'), 'c', '拓展字「瓜」讀 guā，韻母是 ua，和「花」的韻母一樣。'),
    contrast(2, 7, '鍋', 'guō', 'uo、ua、ui 聽辨', ['guā', 'guī', 'guō'], 'c', '拓展字「鍋」讀 guō，韻母是 uo；guā 的韻母是 ua，guī 的韻母寫作 ui。'),
    contrast(2, 8, '快', 'kuài', 'uai、ua、ui 聽辨', ['kuī', 'kuài', 'kuā'], 'b', '「快」讀 kuài，韻母是 uai。不要漏掉尾音 i，讀成 kuā。'),
    contrast(2, 9, '水', 'shuǐ', 'ui、uai 聽辨', ['shuǐ', 'shuǎi', 'shuǎ'], 'a', '「水」讀 shuǐ，韻母寫作 ui；shuǎi 的韻母是 uai。'),
    contrast(2, 10, '花', 'huā', 'ua、uo、ui 聽辨', ['huī', 'huō', 'huā'], 'c', '「花」讀 huā，韻母是 ua。huī 和 huō 的韻母分別是 ui 和 uo。'),
    contrast(2, 11, '歸', 'guī', 'ui、ua、uo 聽辨', ['guī', 'guā', 'guō'], 'a', '拓展字「歸」讀 guī，韻母寫作 ui。聽清收尾的聲音，再和 ua、uo 分辨。')
  ],
  'ti-xi-lin-bi': [
    extraSound(3, 5, '口', 'kǒu', 'k', options('h', 'g', 'k'), 'c', '拓展字「口」讀 kǒu，聲母是 k，讀時能感到較明顯的氣流。'),
    extraSound(3, 6, '隔', 'gé', 'g', options('k', 'g', 'h'), 'b', '拓展字「隔」讀 gé，聲母是 g；它和送氣的 k 不同。'),
    contrast(3, 7, '看', 'kàn', 'g、k、h 聽辨', ['gàn', 'hàn', 'kàn'], 'c', '這裏聽到 kàn，聲母是 k。三個拼音的韻母、聲調相同，要聽清開頭。'),
    contrast(3, 8, '各', 'gè', 'g、k、h 聽辨', ['hè', 'gè', 'kè'], 'b', '「各」讀 gè，開頭是 g，不是送氣的 k，也不是摩擦音 h。'),
    contrast(3, 9, '何', 'hé', 'g、k、h 聽辨', ['hé', 'ké', 'gé'], 'a', '拓展字「何」讀 hé，聲母是 h。三個選項只換了開頭的聲母。'),
    contrast(3, 10, '口', 'kǒu', 'g、k、h 聽辨', ['gǒu', 'kǒu', 'hǒu'], 'b', '拓展字「口」讀 kǒu，聲母 k 要送氣；gǒu 和 hǒu 的開頭不同。'),
    contrast(3, 11, '隔', 'gé', 'g、k、h 聽辨', ['hé', 'ké', 'gé'], 'c', '拓展字「隔」讀 gé，聲母是 g。不要把開頭讀成 h 或送氣的 k。')
  ],
  'bo-chuan-gua-zhou': [
    extraSound(4, 5, '無', 'wú', 'u', options('uo', 'u', 'ua'), 'b', '拓展字「無」讀 wú，韻母是 u；沒有聲母時，音節寫成 wu。'),
    extraSound(4, 6, '鍋', 'guō', 'uo', options('uo', 'ua', 'u'), 'a', '拓展字「鍋」讀 guō，韻母是 uo。'),
    contrast(4, 7, '瓜', 'guā', 'u、ua、uo 聽辨', ['gū', 'guō', 'guā'], 'c', '「瓜」讀 guā，韻母是 ua。三個選項聲母、聲調相同，韻母不同。'),
    contrast(4, 8, '我', 'wǒ', 'u、ua、uo 聽辨', ['wǎ', 'wǒ', 'wǔ'], 'b', '「我」讀 wǒ，韻母是 uo。uo 沒有聲母時，音節寫成 wo。'),
    {...contrast(4, 9, '無', 'wú', '零聲母 u 的寫法', ['wú', 'ú', 'wó'], 'a', '拓展字「無」讀 wú。韻母 u 單獨成音節時，前面要加 w，寫作 wu。'), prompt: '聽一聽，「無」的拼音應怎樣寫？'},
    contrast(4, 10, '鍋', 'guō', 'u、ua、uo 聽辨', ['guā', 'gū', 'guō'], 'c', '拓展字「鍋」讀 guō，韻母是 uo。聽清從 u 滑向 o 的聲音。')
  ],
  'gui-yuan-tian-ju': [
    extraSound(5, 5, '廬', 'lú', 'l', options('n', 'l'), 'b', '拓展字「廬」讀 lú，聲母是 l，氣流從舌頭兩側通過。'),
    extraSound(5, 6, '柳', 'liǔ', 'l', options('l', 'n'), 'a', '拓展字「柳」讀 liǔ，聲母是 l，不是鼻音 n。'),
    contrast(5, 7, '南', 'nán', 'n、l 聽辨', ['lán', 'nán'], 'b', '「南」讀 nán，「蘭」讀 lán。韻母和聲調相同，要聽清鼻音 n 和邊音 l。'),
    contrast(5, 8, '年', 'nián', 'n、l 聽辨', ['nián', 'lián'], 'a', '拓展字「年」讀 nián，「連」讀 lián。年字的開頭是鼻音 n。'),
    contrast(5, 9, '露', 'lù', 'n、l 聽辨', ['nù', 'lù'], 'b', '「夕露」的「露」讀 lù；「怒」讀 nù。這次聽到的是邊音 l。'),
    contrast(5, 10, '理', 'lǐ', 'n、l 聽辨', ['lǐ', 'nǐ'], 'a', '「理」讀 lǐ，「你」讀 nǐ。仔細分辨開頭，兩個字的韻母和聲調相同。')
  ],
  'zao-chun': [
    extraSound(6, 5, '惜', 'xī', 'x', options('sh', 'x', 's'), 'b', '拓展字「惜」讀 xī，聲母是舌面音 x。'),
    extraSound(6, 6, '是', 'shì', 'sh', options('s', 'sh', 'x'), 'b', '「最是」的「是」讀 shì，聲母是翹舌音 sh。'),
    contrast(6, 7, '稀', 'xī', 'x、s、sh 聽辨', ['shī', 'sī', 'xī'], 'c', '拓展字「稀」讀 xī，是舌面音 x；shī 的聲母是 sh，sī 的聲母是 s。'),
    contrast(6, 8, '酥', 'sū', 's、sh 聽辨', ['shū', 'sū'], 'b', '「酥」讀 sū，「書」讀 shū。韻母和聲調相同，要分辨平舌音和翹舌音。'),
    contrast(6, 9, '是', 'shì', 'x、s、sh 聽辨', ['shì', 'sì', 'xì'], 'a', '「是」讀 shì，聲母是 sh；不要讀成「四」sì 或「細」xì。'),
    contrast(6, 10, '細', 'xì', 'x、s、sh 聽辨', ['sì', 'xì', 'shì'], 'b', '拓展字「細」讀 xì，聲母是 x。平舌音 s 和翹舌音 sh 都不是這個聲音。')
  ]
};

export const POEM_GAME_ITEMS = Object.freeze(Object.fromEntries([
  ['yong-e', 1, '白鵝的調色盤', '替白鵝、紅掌和水面上色。', '白毛、紅掌、綠水。邊聽邊上色，把詩裏的畫面找出來。'],
  ['zeng-wang-lun', 2, '踏歌送朋友', '跟着聲音，送朋友一程。', '李白乘舟，汪倫踏歌。岸上的歌聲把送別的友情送得很遠。'],
  ['ti-xi-lin-bi', 3, '山中小攝影師', '換個角度，拍下山的樣子。', '橫看成嶺，側看成峯。同一座山，從不同位置看，樣子也不同。'],
  ['bo-chuan-gua-zhou', 4, '春風染江南', '用指尖的春風，染綠江岸。', '春風又綠江南岸。「綠」寫出春風吹來，草木重新變綠。'],
  ['gui-yuan-tian-ju', 5, '豆苗小園丁', '照顧小豆苗，整理詩中的田地。', '草盛豆苗稀。野草茂盛，豆苗稀疏；詩人一早起來整理田地。'],
  ['zao-chun', 6, '把春天找出來', '讓春雨落下，再找一找草色。', '草色遙看近卻無。遠看有一片淡綠，近看仍是稀疏小草和泥土。']
].map(([slug, grade, title, prompt, explanation]) => [slug, Object.freeze({
  id: `g${grade}-play-20260918`, type: 'microgame', slug, title, prompt, explanation, difficulty: 1
})])));

// Keep the original five IDs available for version-one saved attempts. New attempts
// draw from bank and store their five selected IDs; set.items is never a live attempt.
export const CHALLENGE_SETS = Object.freeze(Object.fromEntries(Object.entries(LEGACY_SETS).map(([slug, set]) => {
  const additions = DICTATION_BANK[slug].filter(word => !set.items.some(item => item.type === 'dictation' && item.target.char === word.char)).map(word => ({
    id: `g${set.grade}-d-${word.char.codePointAt(0).toString(16)}`, type: 'dictation',
    prompt: '聽一聽，寫出指定的字。',
    audio: {text: `${word.word}，${word.word}的${word.char}。`, char: word.char, pinyin: word.pinyin},
    target: {char: word.char, pinyin: word.pinyin, accept: word.accept},
    explanation: `「${word.word}」的「${word.char}」。聽清讀音，再看看這個字怎樣寫。`
  }));
  const bank = [...set.items, ...MORE_SOUNDS[slug], ...VARIED_SOUNDS[slug], ...additions, POEM_GAME_ITEMS[slug]].map(item => ({difficulty: 1, ...item}));
  const {sampled, notSampled, ...curriculum} = set.curriculum;
  return [slug, Object.freeze({...set, curriculum: {...curriculum, legacySampled: sampled, legacyNotSampled: notSampled,
    bankFocus: [...new Set(bank.filter(item => item.type === 'sound').map(item => item.focus))],
    assessmentNote: '題庫輪換抽題。聽辨結果只表示本輪題目的表現，不能代表已掌握整課或實際發音能力。'}, bank: Object.freeze(bank)})];
})));
